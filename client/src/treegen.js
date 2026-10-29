import * as THREE from 'three';
import { seasonOfDate } from './season.js';
import { drain } from './slice.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Parametric trees in the spirit of Weber & Penn 1995, "Creation and Rendering of Realistic Trees".
// Each species is a parameter file in library/species/<id>.json (schema: docs/species-library.md).
// An agent or a local resident writes the file from the species' morphology; every region that has
// the species gets the tree for free. Nothing here is species-specific.
//
// A tree is grown once per (species, seed) as a skeleton: trunk(s) as level 0, then branch levels
// from the file, then foliage cards placed along the outer branches. The skeleton is shared by the
// meshings so the LOD switch changes detail, not shape:
//   close: a denser canopy (lod.close_factor times the near cards, lod.close_scale their size, with
//          a texture drawn for the smaller card so single leaves keep their real size) and, for a
//          species with a `twigs` block, a third (shrubs: second) level of short twigs that the close
//          cards hang from; the near trunk is drawn with it. Used within about 90 m of the camera
//          (vegetation.js).
//   leaf:  (2026-10-28) inside a few metres of the camera (vegetation.js: 15 m for a deer, 24 m for a squirrel), each
//          close card's single leaves, recorded as its texture is drawn, as quads with their own depth and orientation
//          (needle tufts as crossed quads, fir and cedar sprays as flat segments), fluttering in the wind; see "Leaf
//          level" below. The close cards' twigs stay.
//   near: tapered curved tubes for trunk and branches, leaf cards (alpha-tested spray textures)
//   mid:  trunk and the main limbs as thin straight tubes (lod.mid_sides, lod.mid_segments,
//         lod.mid_branches), foliage as one card per clump, merged down to lod.mid_cards per tree
//         (or a few ellipsoid blobs fitted to the cards, lod.mid_canopy 'blobs')

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const srgbToLin = v => Math.pow(v / 255, 2.2);   // colours are authored as sRGB 0..255; lighting is linear

// ---------------------------------------------------------------------------------------------
// Built-in fallback: the same parameter sets as library/species, so the client works offline or
// from a static host without the library folder. Regenerate after editing a species file (the
// command is in docs/species-library.md); the lineup page warns when the two differ.
// BEGIN BUILTIN
export const BUILTIN = {
  "quercus_douglasii": {"id":"quercus_douglasii","aliases":["blue_oak"],"scientific":"Quercus douglasii","common":"blue oak","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[6,12],"variants":[{"name":"sapling","weight":0.08,"height_m":[2,4],"trunk_radius":0.4,"branches":0.6,"leaf_density":0.8,"set":{"trunk":{"length_ratio":0.6,"split_prob":0.1,"lean_deg":4},"crown":{"envelope":{"profile":[[0.15,0.2],[0.35,0.32],[0.55,0.35],[0.75,0.3],[0.9,0.2],[1.0,0.06]]}},"levels":[{"down_angle_deg":48,"down_angle_tip_deg":30,"droop_deg":0}],"foliage":{"clumps":{"radius_m":0.55}},"epiphytes":{"mistletoe":{"prob":0}}},"note":"a slender stem keeping its leader, narrow upright crown"},{"name":"young","weight":0.22,"height_m":[5,8],"trunk_radius":0.6,"crown_scale":0.85,"branches":0.85,"set":{"trunk":{"length_ratio":0.45,"split_prob":0.3},"foliage":{"clumps":{"radius_m":0.8}},"epiphytes":{"mistletoe":{"prob":0.1}}},"note":"a rounded crown still taller than wide"},{"name":"mature","weight":0.55,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[10,14],"trunk_radius":1.3,"crown_scale":1.1,"gnarl":1.35,"deadwood":{"fraction":0.2,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.7,"lean_deg":9},"epiphytes":{"mistletoe":{"prob":0.7,"count":[2,5]}}},"note":"gnarled and broad, a few dead limbs in a thinning crown, more mistletoe"}],"snag":{"fraction":0.03,"from":"veteran","height_m":[8,13],"limbs":0.6,"twigs":0.3,"levels":1,"shorten":[0.45,0.95],"rgb":[168,164,156]},"description":"A small, round-crowned oak with blue-green, shallowly lobed leaves and pale gray bark broken into small checks, usually 6-12 m tall here. It covers the dry, rocky slopes of the foothill woodland below about 1,200 m, often as open savanna with grass between the trees, and its acorns feed deer, western gray squirrels, scrub-jays and acorn woodpeckers.","season_notes":{"winter":"Bare: blue oak drops its leaves in late fall, and the checkered gray bark and clumps of oak mistletoe show until leaf-out in March.","spring":"Leafing out in pale green with hanging catkins (March-April); this year's acorns start on the new twigs.","summer":"In full blue-gray leaf, the colour that names it; in a dry year it drops leaves early to save water.","fall":"Acorns ripen and drop (September-October), then the leaves brown and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.34,"radius_ratio":0.075,"taper":0.6,"flare":1.3,"bole_ratio":0.5,"base_size":0.42,"curve_deg":12,"curve_var_deg":18,"segments":5,"lean_deg":6,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.45,"split_count":2,"split_angle_deg":32,"bark_rgb":[152,150,146],"bark_pattern":"checkered","twig_rgb":[150,142,132],"bark":{"tile_m":[0.35,0.7],"plate_m":[0.05,0.08],"fissure":0.5,"contrast":1.0,"lichen":0.8,"relief":1.2}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.06,0.48],[0.2,0.7],[0.35,0.76],[0.5,0.74],[0.65,0.67],[0.78,0.55],[0.9,0.37],[1.0,0.12]],"lobes":4,"lobe_depth":0.12,"asymmetry":0.1,"fill":0.6,"edge":1.08}},"levels":[{"count":7,"down_angle_deg":66,"down_angle_tip_deg":38,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.6,"length_var":0.25,"curve_deg":6,"curve_var_deg":24,"zigzag_deg":10,"tropism":0.02,"droop_deg":14,"taper":0.9,"radius_ratio":0.6,"segments":5},{"count":6,"start":0.15,"down_angle_deg":46,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":0,"curve_var_deg":26,"zigzag_deg":16,"tropism":0.05,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.06,"leaf_shape":"oblong_wavy","cluster_m":0.95,"density":9,"cards_per_m2":1.6,"leaf_fill":3.2,"roll_deg":90,"start":0.3,"orientation":"outward","colors":{"winter":[149,119,105],"spring":[144,157,100],"summer":[127,137,122],"fall":[168,135,98]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.85},"parent_start":0.6,"clumps":{"radius_m":0.85,"cards_per_clump":7,"shell":0.2,"flatten":0.75,"tip_bias":1.4},"palette":[[0.8,[1,1,1]],[0.2,[1.05,1.08,0.95]]],"winter_twigs":0.45,"ao_min":0.7,"color_var":[0.1,0.06],"leaf_on_var":0.6},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[150,146,138]},"epiphytes":{"mistletoe":{"prob":0.4,"count":[1,3],"radius_m":0.35}},"twigs":{"count":[1,2],"length":0.65,"down_deg":50,"down_var_deg":18,"curve_var_deg":25,"segments":2,"radius_m":0.012,"taper":0.55,"fan_deg":55,"jitter":0.2,"zigzag_deg":28,"tris":1140},"lod":{"near_tris_budget":1900,"near_sides":[7,4,3],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.15,"porosity":0.2,"foliage_rg":0.9,"foliage_bg":0.78,"from":"reference photographs, docs/tree-likeness-review.md: 01 Mount Diablo (W/H 1.59, porosity 0.21), 02 Shingle Springs, 04 savanna; woodland trees nearer 1.0"},"license":"CC BY-SA 4.0"},
  "quercus_wislizeni": {"id":"quercus_wislizeni","aliases":["live_oak"],"scientific":"Quercus wislizeni","common":"interior live oak","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[8,15],"variants":[{"name":"young","weight":0.25,"height_m":[4,8],"trunk_radius":0.7,"crown_scale":0.9,"branches":0.85,"set":{"trunk":{"stems":[1,2]}},"note":"dense, rounded and low, from one or two stems"},{"name":"mature","weight":0.55,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[11,16],"trunk_radius":1.25,"crown_scale":1.08,"gnarl":1.15,"deadwood":{"fraction":0.12,"levels":[1,2],"where":"inner","rgb":[118,112,104]},"set":{"trunk":{"stems":[2,4]},"lod":{"near_tris_budget":2800}},"note":"several heavy stems, a few dead limbs"}],"description":"An evergreen oak with a dense, dark green, rounded crown, often several trunks, and small shiny leaves that are smooth-edged or spiny like holly; 8-15 m tall here. It grows on steeper, moister slopes and along ravines through the blue oak woodland and up into the lower conifer forest, and California scrub-jays bury its acorns, planting new oaks with the ones they never come back for.","season_notes":{"winter":"Evergreen: still in full dark leaf, the green that picks it out among the bare blue oaks.","spring":"New pale leaves and catkins (March-May); the flowers become acorns that take two years to ripen.","summer":"A dense crown casting the deepest shade in the woodland; last year's flowers are now small green acorns.","fall":"Acorns that began in the spring of last year ripen and drop (September-November)."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.42,"radius_ratio":0.05,"taper":0.6,"flare":1.35,"bole_ratio":0.3,"base_size":0.2,"curve_deg":18,"curve_var_deg":15,"segments":5,"lean_deg":8,"stems":[1,3],"stem_spread_deg":22,"split_prob":0.5,"split_count":2,"split_angle_deg":30,"bark_rgb":[100,96,88],"bark_pattern":"furrowed","twig_rgb":[85,80,72],"bark":{"tile_m":[0.3,0.6],"ridge_m":0.03,"block_m":0.06,"fissure":0.3,"contrast":0.7,"lichen":0.4,"relief":0.8}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.04,0.493],[0.15,0.638],[0.35,0.683],[0.55,0.65],[0.72,0.538],[0.86,0.358],[1.0,0.09]],"lobes":5,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.5,"edge":1.06}},"levels":[{"count":11,"down_angle_deg":64,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":1.9,"length_var":0.2,"curve_deg":15,"curve_var_deg":15,"tropism":0.04,"taper":0.9,"radius_ratio":0.45,"segments":4,"down_angle_tip_deg":36,"droop_deg":10,"zigzag_deg":6},{"count":7,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":20,"curve_var_deg":15,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2,"zigzag_deg":10}],"foliage":{"type":"broadleaf","leaf_size_m":0.04,"leaf_shape":"elliptic_glossy","cluster_m":1.4,"density":20,"start":0.0,"parent_start":0.4,"orientation":"outward","colors":{"winter":[80,88,66],"spring":[118,125,80],"summer":[86,95,69],"fall":[89,95,69]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":1.1,"cards_per_clump":12,"shell":0.2,"flatten":0.8,"tip_bias":1.3},"palette":[[0.85,[1,1,1]],[0.1,[1.35,1.25,0.7]],[0.05,[1.3,1.0,0.6]]],"ao_min":0.72,"color_var":[0.08,0.03]},"twigs":{"count":[3,4],"length":0.5,"down_deg":55,"down_var_deg":20,"curve_var_deg":20,"segments":1,"radius_m":0.005,"fan_deg":60,"jitter":0.28},"lod":{"near_tris_budget":2000,"near_sides":[6,4,0],"mid_blobs":5,"mid_branches":2,"mid_sides":[3,3],"mid_segments":[2,1],"mid_blob_scale":0.95,"close_factor":2},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.08,"porosity":0.12,"foliage_rg":0.85,"foliage_bg":0.5,"from":"reference photographs, docs/tree-likeness-review.md: 01 Pilot Hill (W/H 1.13), 02 park tree (about 1.5), 04 crown on slope"},"license":"CC BY-SA 4.0"},
  "pinus_sabiniana": {"id":"pinus_sabiniana","aliases":["gray_pine"],"scientific":"Pinus sabiniana","common":"gray pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[12,22],"variants":[{"name":"young","weight":0.3,"height_m":[6,12],"trunk_radius":0.8,"crown_scale":0.8,"branches":0.8,"deadwood":0.12,"set":{"trunk":{"split_prob":0.15,"lean_deg":8}},"note":"a single leaning leader, crown open and narrow"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[15,24],"trunk_radius":1.25,"crown_scale":1.15,"deadwood":0.32,"set":{"trunk":{"split_prob":1.0,"split_count":3,"split_height":0.42,"split_angle_deg":24,"lean_deg":18}},"note":"forked into three leaders, many dead lower limbs"}],"snag":{"fraction":0.05,"from":"veteran","limbs":0.45,"twigs":0,"levels":1,"broken_top":[0.7,0.95],"shorten":[0.4,0.9],"rgb":[150,146,138],"height_m":[12,20]},"description":"A thin, often forked or leaning pine whose sparse gray-green needles, 20-30 cm long in bundles of three, make a crown you can see the sky through; 12-22 m tall here. It grows only in California, scattered among blue oaks on the hottest, driest foothill slopes, and its heavy cones hold large, hard-shelled seeds eaten by squirrels and jays and long gathered as food by Native Californians.","season_notes":{"winter":"Evergreen: the gray-green needles look hazy against the hills, and heavy cones from past years still hang in the crown.","spring":"Pollen cones shed yellow pollen (March-April) and new needles grow at the branch tips.","summer":"Second-year cones swell to full size; the open crown gives little shade.","fall":"Ripe cones open and drop big, hard-shelled seeds that squirrels, jays and woodpeckers gather."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.95,"radius_ratio":0.03,"taper":0.9,"flare":1.2,"bole_ratio":0.25,"base_size":0.28,"curve_deg":25,"curve_var_deg":25,"segments":6,"lean_deg":14,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.6,"split_count":2,"split_angle_deg":18,"bark_rgb":[112,104,92],"bark_pattern":"furrowed","twig_rgb":[106,100,90],"split_height":0.55,"bark":{"tile_m":[0.5,1.0],"ridge_m":0.09,"block_m":0.12,"fissure":0.7,"contrast":1.2,"relief":1.5}},"crown":{"shape":"spherical","envelope":{"profile":[[0.22,0.16],[0.38,0.29],[0.55,0.33],[0.7,0.31],[0.84,0.23],[0.94,0.13],[1.0,0.04]],"lobes":3,"lobe_depth":0.16,"asymmetry":0.15,"fill":0.35,"edge":1.1}},"levels":[{"count":30,"whorl":2,"down_angle_deg":72,"down_angle_tip_deg":40,"down_angle_var_deg":18,"rotation_deg":70,"rotation_var_deg":40,"length_ratio":0.3,"length_var":0.35,"curve_deg":10,"curve_var_deg":28,"tropism":0.05,"taper":0.95,"radius_ratio":0.4,"segments":2},{"count":4,"start":0.35,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":40,"length_ratio":0.45,"length_var":0.3,"curve_deg":15,"curve_var_deg":20,"tropism":0.03,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.27,"leaf_shape":"needle_drooping","cluster_m":1.3,"density":12,"start":0.45,"parent_start":0.55,"orientation":"along","droop":0.8,"needle_planes":2,"tuft_spread_deg":28,"cards_per_m2":0.83,"needle_normal":0.65,"needle_wrap":0.6,"translucency":3.5,"needle_scatter":0.3,"translucency_rgb":[1.0,1.06,0.95],"colors":{"winter":[116,129,116],"spring":[121,135,116],"summer":[125,133,121],"fall":[123,131,119]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":70,"clumps":{"radius_m":0.5,"cards_per_clump":2,"shell":0,"flatten":0.85,"tip_bias":2.0},"palette":[[0.9,[1,1,1]],[0.1,[1.3,1.1,0.8]]],"ao_min":0.75,"color_var":[0.08,0.03]},"deadwood":{"fraction":0.22,"where":"lower","levels":[1],"shorten":0.7,"rgb":[138,132,122]},"twigs":{"count":[1,2],"length":0.6,"down_deg":25,"down_var_deg":10,"tropism":-0.25,"segments":1,"radius_m":0.01,"taper":0.5,"fan_deg":15,"jitter":0.08},"lod":{"near_tris_budget":1800,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":3,"mid_blob_scale":0.7,"close_factor":2,"mid_planes":1,"mid_cards":32},"targets":{"crown_width_ratio":0.65,"crown_base_ratio":0.3,"porosity":0.4,"foliage_rg":0.88,"foliage_bg":0.82,"from":"reference photographs, docs/tree-likeness-review.md: 01 with blue oaks, 02 leaning (crown porosity 0.53), 03 single (0.32), 05 Mt Diablo"},"license":"CC BY-SA 4.0"},
  "pinus_ponderosa": {"id":"pinus_ponderosa","aliases":["ponderosa"],"scientific":"Pinus ponderosa","common":"ponderosa pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[22,38],"variants":[{"name":"pole","weight":0.25,"height_m":[8,15],"trunk_radius":0.8,"branches":0.7,"set":{"trunk":{"base_size":0.22,"bole_ratio":0.15,"bark_rgb":[98,80,68],"stubs":{"count":[0,3]}},"crown":{"envelope":{"profile":[[0.18,0.2],[0.4,0.19],[0.6,0.15],[0.8,0.09],[1.0,0.02]]}},"levels":[{"droop_deg":20,"upturn_deg":30}]},"note":"blackjack: dark bark, a conical crown reaching down to a quarter of the height"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"old-growth","weight":0.2,"height_m":[30,40],"trunk_radius":1.35,"branches":0.8,"deadwood":{"fraction":0.12,"levels":[1],"where":"lower","shorten":0.5,"rgb":[130,118,104]},"set":{"trunk":{"base_size":0.62,"bole_ratio":0.6,"bark_rgb":[188,132,92],"stubs":{"count":[10,20]},"length_ratio":0.92},"crown":{"envelope":{"profile":[[0.58,0.2],[0.72,0.25],[0.86,0.26],[0.95,0.21],[1.0,0.12]]},"shape":"cylindrical"},"levels":[{"droop_deg":40,"upturn_deg":30}]},"note":"flat-topped, a long clear bole of pale yellow plates, heavy limbs"}],"snag":{"fraction":0.04,"from":"mature","limbs":0.3,"twigs":0,"levels":1,"broken_top":[0.55,0.85],"shorten":[0.3,0.8],"rgb":[140,124,108]},"description":"A tall, straight pine with a clear trunk, thick bark broken into cinnamon-orange plates between black fissures, and long needles (12-25 cm, in threes) in tufts at the branch tips; 22-38 m tall here. It grows above the oak woodland in the lower conifer forest, from about 600 m up, and its thick bark lets old trees survive the frequent low fires that once kept these forests open.","season_notes":{"winter":"Evergreen: needles stay on for about three years, so the crown is full in every season.","spring":"Pollen cones release clouds of yellow pollen (May-June) and new shoots extend at the branch tips.","summer":"Second-year seed cones grow to full size and turn from green to red-brown.","fall":"Cones open and drop winged seeds (September-October) for squirrels, chipmunks and birds; the oldest needles yellow and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.03,"taper":1.0,"flare":1.25,"bole_ratio":0.45,"base_size":0.48,"curve_deg":4,"curve_var_deg":4,"segments":7,"lean_deg":3,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.03,"split_count":2,"split_angle_deg":12,"bark_rgb":[168,116,82],"bark_pattern":"plates","twig_rgb":[92,74,60],"stubs":{"count":[6,14],"length_m":0.5,"radius_ratio":0.12},"bark":{"tile_m":[0.7,1.4],"plate_m":[0.2,0.6],"fissure":0.95,"contrast":1.15,"relief":1.4}},"crown":{"shape":"tapered_cylindrical","envelope":{"profile":[[0.4,0.2],[0.6,0.22],[0.8,0.2],[0.92,0.13],[1.0,0.04]],"lobes":3,"lobe_depth":0.1,"asymmetry":0.1,"fill":0.15,"edge":1.1}},"levels":[{"count":30,"whorl":3,"down_angle_deg":92,"down_angle_tip_deg":58,"down_angle_var_deg":10,"rotation_deg":37,"rotation_var_deg":25,"length_ratio":0.26,"length_var":0.2,"curve_deg":0,"curve_var_deg":16,"tropism":0.02,"droop_deg":34,"upturn_deg":40,"taper":0.95,"radius_ratio":0.32,"segments":3},{"count":6,"start":0.5,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":-90,"rotation_var_deg":30,"length_ratio":0.3,"length_var":0.3,"curve_deg":10,"curve_var_deg":10,"tropism":0.12,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.2,"leaf_shape":"needle_brush","cluster_m":1.8,"density":7,"start":0.4,"parent_start":0.6,"orientation":"along","needle_planes":2,"tuft_spread_deg":22,"tuft_up":0.45,"needle_normal":0.55,"needle_wrap":0.35,"translucency":2.5,"needle_scatter":0.15,"colors":{"winter":[76,77,59],"spring":[95,95,65],"summer":[82,86,62],"fall":[91,86,59]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":50,"clumps":{"radius_m":0.6,"cards_per_clump":2,"shell":0,"flatten":0.75,"tip_bias":1.6},"ao_min":0.7,"color_var":[0.07,0.03]},"twigs":{"count":[1,2],"whorl":true,"length":0.6,"down_deg":45,"down_var_deg":10,"tropism":0.2,"segments":1,"radius_m":0.014,"taper":0.4,"fan_deg":40,"jitter":0.05},"lod":{"near_tris_budget":2200,"near_sides":[8,3,0],"mid_blobs":5,"mid_branches":2,"mid_blob_scale":0.7,"close_factor":2,"mid_planes":1,"mid_cards":28},"targets":{"crown_width_ratio":0.4,"crown_base_ratio":0.45,"porosity":0.35,"foliage_rg":0.95,"foliage_bg":0.47,"from":"reference photographs, docs/tree-likeness-review.md: 02, 03 mature (clear bole 40-60%), 04 old flat top (crown porosity 0.14); young trees are conical to the ground"},"license":"CC BY-SA 4.0"},
  "arctostaphylos_viscida": {"id":"arctostaphylos_viscida","aliases":["manzanita"],"scientific":"Arctostaphylos viscida","common":"whiteleaf manzanita","form":"shrub","architectural_model":"Leeuwenberg","deciduous":false,"height_m":[1.5,3.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.7,1.5],"deadwood":0.05,"set":{"trunk":{"stems":[3,5]}},"note":"a low rounded young shrub"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"decadent","weight":0.25,"height_m":[2,3.5],"gnarl":1.15,"leaf_density":0.75,"deadwood":{"fraction":0.35,"levels":[0,1,2]},"note":"an old shrub: grey dead stems among the red"}],"description":"A crooked, many-stemmed shrub with smooth, polished red-brown bark and stiff, round, pale gray-green (almost white) leaves held edge-on to the sun; 1.5-3.5 m tall here. It grows in chaparral and in openings of the woodland and pine forest on dry, rocky ridges, and its late-winter flowers are among the first nectar of the year for hummingbirds and native bees, while its berries feed birds, foxes, coyotes and bears.","season_notes":{"winter":"Flowering in late winter (February-March): small white-to-pink urn-shaped flowers, early nectar for hummingbirds and native bees.","spring":"Flowers give way to sticky green berries.","summer":"The berries ('little apples', which is what manzanita means) ripen red-brown, and the red bark peels in thin curls.","fall":"Evergreen and dormant through the dry season; next winter's flower buds are already set at the branch tips."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.03,"oak_woodland":0.45,"chaparral":1.0,"mixed_forest":0.4,"conifer_forest":0.25,"riparian":0.0},"floor":0.4,"mid":1.0,"steep":1.3,"north":0.7,"shade":0.15,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"berries","seasons":["summer","fall"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["summer","fall"]},{"animal":"canis_latrans","part":"berries","seasons":["summer","fall"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["summer","fall"]},{"animal":"callipepla_californica","part":"berries","seasons":["summer","fall"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.75,"radius_ratio":0.035,"taper":0.7,"flare":1.6,"bole_ratio":0.1,"base_size":0.2,"curve_deg":20,"curve_var_deg":18,"segments":4,"lean_deg":0,"stems":[4,7],"stem_spread_deg":45,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[128,58,50],"bark_pattern":"smooth","twig_rgb":[132,66,54],"sinuous_deg":16,"bark":{"tile_m":[0.2,0.4],"contrast":1.0,"relief":0.6}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.54],[0.15,0.744],[0.35,0.84],[0.55,0.792],[0.75,0.624],[0.9,0.384],[1.0,0.12]],"lobes":3,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.6,"edge":1.06}},"levels":[{"count":4,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.75,"length_var":0.25,"curve_deg":30,"curve_var_deg":14,"tropism":0.08,"taper":0.9,"radius_ratio":0.6,"segments":2,"sinuous_deg":18},{"count":4,"start":0.3,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.25,"curve_deg":20,"curve_var_deg":20,"tropism":0.08,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.035,"leaf_shape":"round_vertical","cluster_m":0.5,"density":24,"start":0.25,"orientation":"vertical","colors":{"winter":[131,139,118],"spring":[160,149,134],"summer":[144,149,126],"fall":[136,142,121]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.4,"cards_per_clump":6,"shell":0.5,"flatten":0.8,"tip_bias":1.3},"ao_min":0.8,"color_var":[0.07,0.03]},"deadwood":{"fraction":0.15,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[140,136,128]},"twigs":{"count":[1,2],"length":0.8,"down_deg":40,"down_var_deg":20,"zigzag_deg":25,"curve_var_deg":35,"segments":2,"radius_m":0.012,"taper":0.5,"fan_deg":60,"jitter":0.25},"lod":{"near_tris_budget":1100,"near_sides":[4,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.15,"porosity":0.1,"foliage_rg":0.95,"foliage_bg":0.68,"from":"reference photographs, docs/tree-likeness-review.md: 01, 02 habit (crown r/g 0.91-0.96, b/g 0.59-0.74), 06 crown texture"},"license":"CC BY-SA 4.0"},
  "adenostoma_fasciculatum": {"id":"adenostoma_fasciculatum","aliases":["chamise"],"scientific":"Adenostoma fasciculatum","common":"chamise","form":"shrub","architectural_model":"Leeuwenberg (provisional)","deciduous":false,"height_m":[1.2,2.4],"variants":[{"name":"young","weight":0.25,"height_m":[0.6,1.3],"deadwood":0.08,"set":{"trunk":{"stems":[8,14]}},"note":"a few years after fire: a low, dense green clump"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"decadent","weight":0.25,"height_m":[1.5,2.6],"deadwood":0.55,"leaf_density":0.75,"set":{"trunk":{"stems":[22,34]}},"note":"decades without fire: half the stems grey and dead"}],"description":"A dense, many-stemmed shrub with tiny needle-like leaves in bundles along stiff, upright branches, and clusters of small white flowers at the tips in early summer; 1.2-2.4 m tall here. It is the most common chaparral shrub in California, forming thick stands on hot, dry slopes with thin soil, where it resprouts from a woody burl after fire and gives cover to quail, brush rabbits and wrentits.","season_notes":{"winter":"Evergreen: winter rain brings new shoots, and stands burned in recent years sprout from their burls.","spring":"Fresh green growth, then clusters of small white flowers at the branch tips (May-June).","summer":"The flowers fade to rust-brown; the resinous leaves dry out, and chamise is one of the most flammable plants in the chaparral.","fall":"Rust-brown seed heads still cap the stems while the shrubs wait out the dry season for the first rain."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.05,"oak_woodland":0.2,"chaparral":1.0,"mixed_forest":0.1,"conifer_forest":0.02,"riparian":0.0},"floor":0.3,"mid":1.0,"steep":1.4,"north":0.5,"shade":0.05,"disturbed":0.7},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":1.0,"radius_ratio":0.012,"taper":0.9,"flare":1.5,"bole_ratio":0.05,"base_size":0.3,"curve_deg":8,"curve_var_deg":16,"segments":3,"lean_deg":0,"stems":[16,28],"stem_spread_deg":33,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[96,76,62],"bark_pattern":"shreddy","twig_rgb":[106,90,74],"bark":{"tile_m":[0.1,0.4]}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.12],[0.25,0.3],[0.5,0.47],[0.75,0.6],[0.92,0.6],[1.0,0.42]],"lobes":5,"lobe_depth":0.15,"asymmetry":0.12,"fill":0.4,"edge":1.1}},"levels":[{"count":3,"start":0.4,"down_angle_deg":22,"down_angle_var_deg":10,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.22,"length_var":0.4,"curve_deg":5,"curve_var_deg":15,"tropism":0.08,"taper":1.0,"radius_ratio":0.6,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.008,"leaf_shape":"fascicle_wand","cluster_m":0.42,"density":22,"start":0.1,"orientation":"along","colors":{"winter":[82,94,67],"spring":[150,149,125],"summer":[116,118,98],"fall":[124,102,83]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"parent_start":0.2,"twist_deg":60,"tips":{"spring":[236,232,214],"summer":[170,120,80],"fall":[150,90,60],"winter":[120,84,62]},"ao_min":0.72,"color_var":[0.1,0.06]},"deadwood":{"fraction":0.3,"levels":[0],"shorten":0.85,"rgb":[132,128,122]},"twigs":{"count":[1,2],"prob":0.6,"split":0.8,"length":0.9,"down_deg":14,"down_var_deg":6,"tropism":0.08,"segments":1,"radius_m":0.004,"taper":0.6},"lod":{"near_tris_budget":1000,"near_sides":[3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":32},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.1,"porosity":0.15,"foliage_rg":1.0,"foliage_bg":0.7,"from":"reference photographs, docs/tree-likeness-review.md: 01 El Dorado Hills, 02 Darrington Trail, 03 (porosity 0.17), 04"},"license":"CC BY-SA 4.0"},
  "salix_lasiolepis": {"id":"salix_lasiolepis","aliases":["willow","arroyo_willow"],"scientific":"Salix lasiolepis","common":"arroyo willow","form":"tree","architectural_model":"Rauh (provisional: sympodial, the shoot tip dies back each year)","deciduous":true,"height_m":[4,8],"variants":[{"name":"young","weight":0.25,"height_m":[2,4],"trunk_radius":0.7,"crown_scale":0.9,"branches":0.8,"set":{"trunk":{"stems":[3,6]}},"note":"a young clump of a few upright wands"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"old","weight":0.25,"height_m":[6,10],"trunk_radius":1.25,"crown_scale":1.1,"gnarl":1.3,"deadwood":{"fraction":0.25,"levels":[1,2],"where":"inner","rgb":[132,126,116]},"set":{"trunk":{"stems":[6,11],"stem_spread_deg":34}},"note":"a broad old clump with leaning stems and grey dead wands inside"}],"description":"A many-stemmed willow 3-10 m tall that grows as dense thickets right at the water's edge, with narrow leaves dark green above and whitish beneath. It lines the foothill creeks and seeps, holds the banks with its roots, and its catkins in late winter are the first pollen of the year for native bees.","season_notes":{"winter":"Bare grey-brown wands; in late winter the silvery catkins open before the leaves (February-March).","spring":"Leafing out yellow-green as the catkins shed their seed in cottony fluff.","summer":"Dull green thicket, grey when the wind turns the pale leaf undersides.","fall":"Leaves yellow and drop through November."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.88,"radius_ratio":0.022,"taper":0.8,"flare":1.3,"bole_ratio":0.04,"base_size":0.0,"curve_deg":10,"curve_var_deg":12,"segments":3,"lean_deg":8,"stems":[5,9],"stem_spread_deg":40,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":6,"bark_rgb":[116,108,96],"bark_pattern":"furrowed","twig_rgb":[138,112,76],"bark":{"tile_m":[0.2,0.5],"ridge_m":0.015,"block_m":0.04,"fissure":0.25,"contrast":0.6,"lichen":0.3,"relief":0.6}},"crown":{"shape":"conical","envelope":{"profile":[[0.0,0.55],[0.12,0.68],[0.28,0.78],[0.45,0.8],[0.6,0.76],[0.74,0.64],[0.86,0.46],[0.95,0.25],[1.0,0.06]],"lobes":6,"lobe_depth":0.14,"asymmetry":0.15,"fill":0.9,"edge":1.1}},"levels":[{"count":44,"down_angle_deg":72,"down_angle_tip_deg":24,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.85,"length_var":0.3,"curve_deg":8,"curve_var_deg":14,"tropism":0.05,"taper":0.9,"radius_ratio":0.5,"segments":2,"droop_deg":6},{"count":6,"start":0.2,"down_angle_deg":32,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":6,"curve_var_deg":14,"tropism":0.06,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.08,"leaf_shape":"lanceolate","cluster_m":1.15,"density":16,"leaf_fill":2.4,"start":0.1,"parent_start":0.3,"orientation":"outward","roll_deg":60,"colors":{"winter":[122,106,80],"spring":[136,150,74],"summer":[105,112,80],"fall":[170,148,106]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.7},"clumps":{"radius_m":0.6,"cards_per_clump":7,"shell":0.25,"flatten":0.85,"tip_bias":1.2},"palette":[[0.7,[1,1,1]],[0.3,[1.22,1.24,1.26]]],"winter_twigs":0.45,"ao_min":0.7,"catkins":{"rgb":[206,202,180],"len_m":0.04,"width":0.3,"hang":false,"prob":0.3},"color_var":[0.08,0.05],"leaf_on_var":0.5},"twigs":{"count":[2,3],"length":0.6,"down_deg":30,"down_var_deg":12,"curve_var_deg":15,"segments":1,"radius_m":0.006,"tropism":0.1,"fan_deg":40,"jitter":0.2},"lod":{"near_tris_budget":1800,"near_sides":[4,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[2,1],"mid_blob_scale":0.9,"close_factor":2.5},"targets":{"crown_width_ratio":1.3,"crown_base_ratio":0.05,"porosity":0.3,"foliage_rg":0.86,"foliage_bg":0.47,"fall_rg":1.34,"fall_bg":0.49,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md): elsinore single clump W/H 1.28 base 0.06 (iNaturalist 448506936, CC0); low clumps 2.1-2.2 (iNaturalist 1332351, 131520164, 170438513, CC BY); young plant 0.78 (iNaturalist 478216102, CC BY); colour mean of iNaturalist 131520164, 369138022 (CC0), 478216102; porosity is the ragged top edge only (rough); fall colour iNaturalist 170438513 (Caleb Catto, CC BY); winter catkins Wikimedia Commons File:Salix_lasiolepis_McLaughlin_Eastshore_State_Park_4.png (Awinch1001, CC0) and File:Salix_lasiolepis_1.jpg (Stan Shebs, CC BY-SA 3.0)","photos":[{"url":"https://www.inaturalist.org/photos/448506936","license":"CC0","shows":"single clump at a creek, November"},{"url":"https://www.inaturalist.org/photos/131520164","license":"CC BY 4.0","author":"Peter Brastow","shows":"dense mound, May"},{"url":"https://www.inaturalist.org/photos/369138022","license":"CC0","shows":"thicket, April"},{"url":"https://www.inaturalist.org/photos/478216102","license":"CC BY 4.0","author":"mel letterman","shows":"young plant, March"},{"url":"https://www.inaturalist.org/photos/170438513","license":"CC BY 4.0","author":"Caleb Catto","shows":"fall yellow, November"},{"url":"https://commons.wikimedia.org/wiki/File:Salix_lasiolepis_McLaughlin_Eastshore_State_Park_4.png","license":"CC0","author":"Awinch1001","shows":"bare thicket with catkins, January"}]},"license":"CC BY-SA 4.0"},
  "alnus_rhombifolia": {"id":"alnus_rhombifolia","aliases":["alder","white_alder"],"scientific":"Alnus rhombifolia","common":"white alder","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[13,22],"variants":[{"name":"young","weight":0.25,"height_m":[5,10],"trunk_radius":0.75,"crown_scale":0.95,"branches":0.8,"set":{"crown":{"envelope":{"profile":[[0.16,0.16],[0.3,0.26],[0.45,0.29],[0.6,0.27],[0.75,0.21],[0.88,0.13],[1.0,0.03]]}}},"note":"a slim, conical young tree with its leader still running to the top"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.17,"height_m":[18,25],"trunk_radius":1.25,"crown_scale":1.12,"gnarl":1.25,"deadwood":{"fraction":0.15,"levels":[1,2],"where":"lower"},"set":{"trunk":{"stems":[1,3],"lean_deg":9}},"note":"a tall old tree, sometimes two or three trunks, dead lower limbs"}],"snag":{"fraction":0.08,"from":"mature","height_m":[10,18],"limbs":0.4,"twigs":0.1,"levels":1,"broken_top":[0.6,0.9],"shorten":[0.35,0.8],"rgb":[176,172,164]},"description":"A tall, straight streambank tree 15-25 m high with a narrow, open crown, smooth pale grey bark and dark green, finely toothed oval leaves. It grows only with its roots in running water along the foothill creeks and rivers, fixes nitrogen in its roots, and shades the water cool enough for trout.","season_notes":{"winter":"Bare pale trunks along the creek, with hanging catkins opening from January and last year's small woody cones.","spring":"Catkins shed their pollen and the new leaves come out bright green.","summer":"Dark green, flat-held leaves; the shade over the water keeps the pools cool.","fall":"No real fall colour: the leaves turn dull green-brown and drop."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.92,"radius_ratio":0.022,"taper":0.85,"flare":1.25,"bole_ratio":0.25,"base_size":0.18,"curve_deg":4,"curve_var_deg":6,"segments":6,"lean_deg":5,"stems":[1,2],"stem_spread_deg":10,"split_prob":0.1,"split_count":2,"split_angle_deg":16,"split_height":0.55,"bark_rgb":[158,156,150],"bark_pattern":"smooth","twig_rgb":[118,104,96],"bark":{"tile_m":[0.3,0.6],"contrast":0.5,"lichen":0.7,"relief":0.35}},"crown":{"shape":"tapered_cylindrical","envelope":{"profile":[[0.16,0.22],[0.28,0.35],[0.44,0.42],[0.6,0.41],[0.75,0.33],[0.88,0.21],[1.0,0.05]],"lobes":5,"lobe_depth":0.16,"asymmetry":0.14,"fill":0.5,"edge":1.08}},"levels":[{"count":18,"down_angle_deg":58,"down_angle_tip_deg":34,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.36,"length_var":0.3,"curve_deg":-6,"curve_var_deg":12,"tropism":0.02,"taper":0.9,"radius_ratio":0.4,"segments":2,"droop_deg":10,"upturn_deg":0},{"count":11,"start":0.1,"down_angle_deg":48,"down_angle_var_deg":14,"rotation_deg":-70,"rotation_var_deg":20,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":14,"tropism":-0.02,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.07,"leaf_shape":"oval","cluster_m":1.25,"density":14,"leaf_fill":3.0,"start":0.05,"parent_start":0.3,"orientation":"outward","roll_deg":30,"colors":{"winter":[118,104,96],"spring":[118,140,74],"summer":[93,100,76],"fall":[116,110,74]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.8},"clumps":{"radius_m":0.9,"cards_per_clump":7,"shell":0.15,"flatten":0.65,"tip_bias":1.3},"palette":[[0.85,[1,1,1]],[0.15,[0.82,0.88,0.85]]],"winter_twigs":0.5,"ao_min":0.68,"catkins":{"rgb":[150,118,84],"len_m":0.07,"width":0.16,"hang":true,"prob":0.3},"color_var":[0.06,0.03],"leaf_on_var":0.4},"deadwood":{"fraction":0.05,"where":"lower","levels":[1],"shorten":0.55,"rgb":[150,146,140]},"twigs":{"count":[1,2],"length":0.6,"down_deg":50,"down_var_deg":15,"curve_var_deg":18,"segments":1,"radius_m":0.007,"droop_deg":8,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":2000,"near_sides":[6,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,1],"mid_blob_scale":0.85,"close_factor":2.5},"targets":{"crown_width_ratio":0.7,"crown_base_ratio":0.25,"porosity":0.12,"foliage_rg":0.84,"foliage_bg":0.53,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md): forest-grown streambank trees W/H 0.59 (Wikimedia Commons File:East-Fort-San-Gabriel-River.jpg, Eeekster, CC BY 3.0) and 0.68 (iNaturalist 149760420, Ed Alverson, CC BY); open-grown young tree 0.95, base 0.19 (iNaturalist 26574532, Millie Basden, CC BY); colour and porosity mean of those and iNaturalist 203870250 (Michael Warner, CC BY). W/H is rough (+-0.15): no clean sky silhouette of a mature streambank alder was found","photos":[{"url":"https://commons.wikimedia.org/wiki/File:East-Fort-San-Gabriel-River.jpg","license":"CC BY 3.0","author":"Eeekster","shows":"forest-grown streambank tree, pale trunk"},{"url":"https://www.inaturalist.org/photos/149760420","license":"CC BY 4.0","author":"Ed Alverson","shows":"tall tree at a forest edge, August"},{"url":"https://www.inaturalist.org/photos/26574532","license":"CC BY 4.0","author":"Millie Basden","shows":"young open-grown tree, October"},{"url":"https://www.inaturalist.org/photos/203870250","license":"CC BY 4.0","author":"Michael Warner","shows":"upper crown, June"},{"url":"https://www.inaturalist.org/photos/344584219","license":"CC0","shows":"grove of white trunks, January"}]},"license":"CC BY-SA 4.0"},
  "populus_fremontii": {"id":"populus_fremontii","aliases":["cottonwood","fremont_cottonwood"],"scientific":"Populus fremontii","common":"Fremont cottonwood","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[15,24],"variants":[{"name":"young","weight":0.25,"height_m":[6,12],"trunk_radius":0.65,"crown_scale":0.8,"branches":0.8,"set":{"trunk":{"length_ratio":0.55,"split_prob":0.3},"foliage":{"clumps":{"radius_m":0.8}}},"note":"a fast-growing young tree, taller than wide, still with a leader"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.17,"height_m":[22,30],"trunk_radius":1.3,"crown_scale":1.15,"gnarl":1.3,"deadwood":{"fraction":0.22,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.8,"split_count":3,"lean_deg":14}},"note":"the floodplain giant: a massive leaning trunk forking into three, dead limbs standing out of the crown"}],"snag":{"fraction":0.08,"from":"veteran","height_m":[14,24],"limbs":0.5,"twigs":0.2,"levels":1,"shorten":[0.4,0.9],"rgb":[172,166,156]},"description":"The big tree of the floodplain: 15-30 m tall with a stout, deeply furrowed grey trunk, a few heavy spreading limbs and a broad crown of glossy triangular leaves that flutter in the slightest wind. It grows on sandbars and banks where the water table is shallow, often leaning out over the channel, turns bright yellow in fall, and its cavities and dead limbs house woodpeckers, owls and wood ducks.","season_notes":{"winter":"Bare: a pale grey crown of heavy limbs and stout twigs over the creek.","spring":"Red catkins in February-March, then fresh yellow-green leaves; in May the seeds drift down as cotton.","summer":"Glossy green crown that shimmers as the flat-stalked leaves flutter.","fall":"Bright yellow in November, the brightest colour on the creek, then bare."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.36,"radius_ratio":0.05,"taper":0.6,"flare":1.4,"bole_ratio":0.5,"base_size":0.38,"curve_deg":10,"curve_var_deg":14,"segments":5,"lean_deg":12,"stems":[1,2],"stem_spread_deg":18,"split_prob":0.6,"split_count":2,"split_angle_deg":30,"bark_rgb":[126,120,110],"bark_pattern":"furrowed","twig_rgb":[150,142,120],"bark":{"tile_m":[0.4,0.8],"ridge_m":0.05,"block_m":0.14,"fissure":0.55,"contrast":1.1,"lichen":0.2,"relief":1.4}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.15,0.26],[0.26,0.42],[0.38,0.5],[0.52,0.53],[0.66,0.5],[0.78,0.42],[0.9,0.28],[1.0,0.08]],"lobes":5,"lobe_depth":0.16,"asymmetry":0.2,"fill":0.55,"edge":1.07}},"levels":[{"count":9,"down_angle_deg":58,"down_angle_tip_deg":32,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.2,"length_var":0.25,"curve_deg":8,"curve_var_deg":20,"zigzag_deg":6,"tropism":0.03,"droop_deg":12,"taper":0.9,"radius_ratio":0.6,"segments":3,"sinuous_deg":5},{"count":11,"start":0.1,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":20,"zigzag_deg":8,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.07,"leaf_shape":"deltoid","cluster_m":1.9,"density":14,"leaf_fill":3.6,"start":0.05,"parent_start":0.35,"orientation":"outward","roll_deg":70,"colors":{"winter":[150,142,120],"spring":[130,150,76],"summer":[108,118,87],"fall":[184,160,110]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.8},"clumps":{"radius_m":1.5,"cards_per_clump":10,"shell":0.1,"flatten":0.7,"tip_bias":1.4},"palette":[[0.7,[1,1,1]],[0.2,[1.18,1.2,1.08]],[0.1,[0.8,0.84,0.8]]],"winter_twigs":0.45,"ao_min":0.66,"color_var":[0.07,0.05],"leaf_on_var":0.5},"deadwood":{"fraction":0.08,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[160,154,144]},"twigs":{"count":[1,2],"length":0.6,"down_deg":45,"down_var_deg":18,"curve_var_deg":22,"segments":2,"radius_m":0.011,"taper":0.6,"zigzag_deg":14,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":2200,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.9,"close_factor":2},"targets":{"crown_width_ratio":1.05,"crown_base_ratio":0.2,"porosity":0.15,"foliage_rg":0.83,"foliage_bg":0.51,"fall_rg":1.41,"fall_bg":0.43,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md): lone mature trees W/H 1.03 base 0.20 porosity 0.17 (iNaturalist 22980292, CK2AZ, CC BY), 1.54 (iNaturalist 7309844, CK2AZ, CC BY), 1.01 (iNaturalist 190127566, Jim Gale, CC BY); younger California trees 0.79-0.90 (iNaturalist 207856195, 120383640, 382841314, CC BY); base median of seven trees, porosity median of six, colour mean of iNaturalist 22980292, 7309844, 190127566, 26825865; fall colour iNaturalist 103048102 (Patrick Cox, CC BY)","photos":[{"url":"https://www.inaturalist.org/photos/22980292","license":"CC BY 4.0","author":"CK2AZ","shows":"lone mature tree forking low into massive limbs, August"},{"url":"https://www.inaturalist.org/photos/7309844","license":"CC BY 4.0","author":"CK2AZ","shows":"huge broad dome, April"},{"url":"https://www.inaturalist.org/photos/190127566","license":"CC BY 4.0","author":"Jim Gale","shows":"mature dome, April"},{"url":"https://www.inaturalist.org/photos/120383640","license":"CC BY 4.0","author":"dmoders","shows":"younger California tree, April"},{"url":"https://www.inaturalist.org/photos/103048102","license":"CC BY 4.0","author":"Patrick Cox","shows":"gold grove, November"},{"url":"https://commons.wikimedia.org/wiki/File:J20180125-0050%E2%80%94Populus_fremontii_ssp_fremonti%E2%80%94RPBGi%E2%80%94DxO_(39978794511).jpg","license":"CC BY 2.0","author":"John Rusk","shows":"bare tree, January"}]},"license":"CC BY-SA 4.0"},
  "quercus_lobata": {"id":"quercus_lobata","aliases":["valley_oak"],"scientific":"Quercus lobata","common":"valley oak","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[15,25],"variants":[{"name":"sapling","weight":0.08,"height_m":[3,6],"trunk_radius":0.45,"branches":0.6,"leaf_density":0.85,"set":{"trunk":{"length_ratio":0.6,"split_prob":0.1,"lean_deg":4},"crown":{"envelope":{"profile":[[0.15,0.2],[0.35,0.3],[0.55,0.33],[0.75,0.28],[0.9,0.18],[1.0,0.05]]}},"levels":[{"down_angle_deg":50,"down_angle_tip_deg":30,"droop_deg":4}],"foliage":{"clumps":{"radius_m":0.8}},"epiphytes":{"mistletoe":{"prob":0}}},"note":"a slender stem that still keeps its leader, narrow upright crown"},{"name":"young","weight":0.22,"height_m":[8,15],"trunk_radius":0.65,"crown_scale":0.8,"branches":0.85,"set":{"trunk":{"length_ratio":0.45,"split_prob":0.3},"levels":[{"droop_deg":16}],"foliage":{"clumps":{"radius_m":1.1}},"epiphytes":{"mistletoe":{"prob":0.15}}},"note":"an upright oval crown, taller than wide, limbs not yet drooping"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[22,30],"trunk_radius":1.35,"crown_scale":1.3,"gnarl":1.3,"deadwood":{"fraction":0.18,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.7,"lean_deg":8},"levels":[{"droop_deg":40}],"epiphytes":{"mistletoe":{"prob":0.8,"count":[3,7]}}},"note":"the giant of the valley floor: a massive trunk, a broad dome of long limbs that sweep down toward the grass, dead limbs, many mistletoe balls"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[14,24],"limbs":0.6,"twigs":0.25,"levels":1,"shorten":[0.45,0.95],"rgb":[160,156,148]},"description":"The biggest oak in California: 15-30 m tall, with a massive grey trunk, a broad dome of long limbs whose outer branches droop toward the ground, and deeply lobed leaves with rounded lobes. It grows on deep soils of the valley floors and lower slopes, where its roots reach the water table, and its long acorns feed deer, squirrels, jays, woodpeckers and wild turkeys.","season_notes":{"winter":"Bare: the great grey limbs and the hanging tips of the outer branches show, with green balls of mistletoe high in the crown.","spring":"Leaves come out pale green in March with hanging catkins; this year's acorns start on the new shoots.","summer":"In full dark green leaf, the deepest shade in the valley; the long acorns grow through the summer.","fall":"The long acorns ripen and drop (September-November) and the leaves turn yellow-brown before falling."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.32,"radius_ratio":0.06,"taper":0.6,"flare":1.4,"bole_ratio":0.45,"base_size":0.3,"curve_deg":10,"curve_var_deg":16,"segments":5,"lean_deg":6,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.5,"split_count":2,"split_angle_deg":30,"bark_rgb":[128,124,118],"bark_pattern":"platy","twig_rgb":[128,120,110],"bark":{"tile_m":[0.5,1.0],"plate_m":[0.08,0.14],"fissure":0.75,"contrast":1.1,"lichen":0.5,"relief":1.5}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.06,0.48],[0.15,0.6],[0.3,0.67],[0.45,0.68],[0.6,0.63],[0.75,0.51],[0.88,0.33],[1.0,0.1]],"lobes":5,"lobe_depth":0.14,"asymmetry":0.12,"fill":0.6,"edge":1.08}},"levels":[{"count":8,"down_angle_deg":64,"down_angle_tip_deg":34,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.7,"length_var":0.25,"curve_deg":4,"curve_var_deg":22,"zigzag_deg":10,"tropism":0.0,"droop_deg":28,"upturn_deg":0,"taper":0.9,"radius_ratio":0.6,"segments":5},{"count":7,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":0,"curve_var_deg":24,"zigzag_deg":14,"tropism":-0.06,"droop_deg":16,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.08,"leaf_shape":"lobed_large","lobe_depth":0.55,"cluster_m":2.15,"density":12,"leaf_fill":5.0,"roll_deg":80,"start":0.25,"parent_start":0.55,"orientation":"outward","colors":{"winter":[128,120,110],"spring":[134,148,96],"summer":[114,116,95],"fall":[164,138,92]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.75},"clumps":{"radius_m":1.5,"cards_per_clump":10,"shell":0.15,"flatten":0.7,"tip_bias":1.5},"palette":[[0.75,[1,1,1]],[0.25,[1.08,1.1,1.06]]],"winter_twigs":0.5,"ao_min":0.68,"color_var":[0.08,0.05],"leaf_on_var":0.5,"lobes":9,"lobe_tip":"round","lobe_style":"pinnate"},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[154,150,142]},"epiphytes":{"mistletoe":{"prob":0.5,"count":[1,4],"radius_m":0.45}},"twigs":{"count":[1,2],"length":0.7,"down_deg":45,"down_var_deg":18,"curve_var_deg":22,"droop_deg":20,"segments":2,"radius_m":0.012,"taper":0.55,"fan_deg":50,"jitter":0.2,"zigzag_deg":24,"tris":1100},"lod":{"near_tris_budget":2200,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":1.35,"crown_base_ratio":0.1,"porosity":0.23,"foliage_rg":1.0,"foliage_bg":0.64,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md, colour from the eroded crown mask): open-grown trees on Mount Diablo W/H 1.40, 1.30, 1.40, base 0.10, 0.07, 0.12, porosity 0.24, 0.27, 0.19, r/g 1.07, 0.95, 0.98, b/g 0.62, 0.79, 0.41 (Commons, Awinch1001, CC BY 4.0); a lone summer tree W/H 1.84 base 0.06 porosity 0.23 r/g 1.04 b/g 0.66 (Commons, WeirdNAnnoyed, CC BY-SA 4.0); an old tree in Mariposa W/H 1.44 base 0.12 porosity 0.18 (Commons, Hasmodius, CC BY-SA 4.0; colour left out, late-season yellow). W/H 1.35 sits below the open-grown median (1.40) because trees on the lower slopes here stand closer; base and porosity are medians; colour is the median of the four summer trees (dry-season leaves read olive, r/g about 1)","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Quercus_lobata_Mount_Diablo_near_North_Gate_Road_1.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"broad open-grown dome on a grassy slope, summer"},{"url":"https://commons.wikimedia.org/wiki/File:Quercus_lobata_Mount_Diablo_near_North_Gate_Road_2.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"dome with limbs sweeping down to the grass"},{"url":"https://commons.wikimedia.org/wiki/File:Quercus_lobata_Mount_Diablo_near_North_Gate_Road_4.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"lone tree against the sky, low crown base"},{"url":"https://commons.wikimedia.org/wiki/File:Valley_oak_August_2020.jpg","license":"CC BY-SA 4.0","author":"WeirdNAnnoyed","shows":"very wide lone tree in August"},{"url":"https://commons.wikimedia.org/wiki/File:Old_Valley_Oak_in_Mariposa,_Calfironia.jpg","license":"CC BY-SA 4.0","author":"Hasmodius","shows":"old tree in the Sierra foothills, Mariposa"}]},"license":"CC BY-SA 4.0"},
  "quercus_chrysolepis": {"id":"quercus_chrysolepis","aliases":["canyon_live_oak","canyon_oak","goldcup_oak"],"scientific":"Quercus chrysolepis","common":"canyon live oak","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[8,18],"variants":[{"name":"young","weight":0.25,"height_m":[3,8],"trunk_radius":0.7,"crown_scale":0.9,"branches":0.85,"set":{"trunk":{"stems":[1,3],"stem_spread_deg":28},"crown":{"envelope":{"profile":[[0.03,0.45],[0.15,0.58],[0.35,0.62],[0.55,0.58],[0.72,0.48],[0.86,0.32],[1.0,0.08]]}}},"note":"a dense, rounded shrub-like tree from one to three stems, leafy to the ground"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[15,22],"trunk_radius":1.3,"crown_scale":1.1,"gnarl":1.25,"deadwood":{"fraction":0.14,"levels":[1,2],"where":"inner","rgb":[132,126,118]},"set":{"trunk":{"stems":[1,3],"lean_deg":18}},"note":"a huge, leaning canyon tree with a thick short trunk or two or three heavy stems, limbs reaching out over the slope, some dead limbs"}],"snag":{"fraction":0.04,"from":"veteran","height_m":[10,18],"limbs":0.5,"twigs":0.2,"levels":1,"shorten":[0.4,0.9],"rgb":[156,150,140]},"description":"An evergreen oak 8-20 m tall with a wide, dense crown, often several trunks, and thick, leathery leaves that are spiny like holly on young shoots and smooth on old ones, dark green on top with a golden fuzz underneath. It grows on steep canyon walls and rocky north-facing slopes, often leaning out over the canyon, and its big acorns sit in thick cups covered in golden hairs, which gives it the name goldcup oak.","season_notes":{"winter":"Evergreen: still in full leaf, the dark crowns marking the shady canyon walls among the bare black and blue oaks.","spring":"New leaves come out pale and golden-woolly underneath with hanging catkins (April-June).","summer":"A dense dark crown; last year's flowers have become green acorns in their golden cups.","fall":"Acorns that began last year ripen and drop (September-November); old leaves turn yellow and fall a few at a time."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.4,"radius_ratio":0.055,"taper":0.6,"flare":1.35,"bole_ratio":0.25,"base_size":0.1,"curve_deg":16,"curve_var_deg":18,"segments":5,"lean_deg":12,"stems":[1,3],"stem_spread_deg":24,"split_prob":0.5,"split_count":2,"split_angle_deg":30,"bark_rgb":[138,132,124],"bark_pattern":"checkered","twig_rgb":[112,104,94],"bark":{"tile_m":[0.3,0.6],"plate_m":[0.03,0.05],"fissure":0.3,"contrast":0.6,"lichen":0.6,"relief":0.8}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.02,0.58],[0.15,0.74],[0.32,0.8],[0.5,0.77],[0.68,0.66],[0.84,0.46],[0.94,0.25],[1.0,0.08]],"lobes":5,"lobe_depth":0.12,"asymmetry":0.22,"fill":0.6,"edge":1.06}},"levels":[{"count":11,"down_angle_deg":66,"down_angle_tip_deg":36,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.3,"length_var":0.22,"curve_deg":12,"curve_var_deg":18,"tropism":0.02,"taper":0.9,"radius_ratio":0.45,"segments":4,"droop_deg":14,"zigzag_deg":8,"sinuous_deg":4},{"count":7,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":18,"curve_var_deg":16,"tropism":0.02,"taper":1.0,"radius_ratio":0.45,"segments":2,"zigzag_deg":10}],"foliage":{"type":"broadleaf","leaf_size_m":0.05,"leaf_shape":"elliptic_glossy","cluster_m":1.9,"density":21,"leaf_fill":2.5,"start":0.0,"parent_start":0.4,"orientation":"outward","roll_deg":60,"colors":{"winter":[90,95,67],"spring":[124,128,82],"summer":[94,98,71],"fall":[96,98,68]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":1.0,"cards_per_clump":11,"shell":0.2,"flatten":0.78,"tip_bias":1.3},"palette":[[0.72,[1,1,1]],[0.16,[1.35,1.18,0.7]],[0.07,[1.18,1.18,1.08]],[0.05,[1.3,1.05,0.6]]],"ao_min":0.72,"color_var":[0.08,0.04]},"deadwood":{"fraction":0.05,"where":"inner","levels":[2],"shorten":0.6,"rgb":[132,126,118]},"twigs":{"count":[3,4],"length":0.5,"down_deg":55,"down_var_deg":20,"curve_var_deg":20,"segments":1,"radius_m":0.006,"fan_deg":60,"jitter":0.26},"lod":{"near_tris_budget":2000,"near_sides":[6,4,0],"mid_blobs":5,"mid_branches":2,"mid_sides":[3,3],"mid_segments":[2,1],"mid_blob_scale":0.95,"close_factor":2},"targets":{"crown_width_ratio":1.35,"crown_base_ratio":0.12,"porosity":0.12,"foliage_rg":0.94,"foliage_bg":0.45,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md, colour from the eroded crown mask): open-grown trees W/H 1.51, 1.05, 1.54, 1.41, base 0.27, 0.19, 0.03, 0.06, porosity 0.14, 0.10, 0.20, 0.04, r/g 0.91, 0.98, 1.16, 0.82, b/g 0.58, 0.34, 0.53, 0.20 (iNaturalist 350884919 Joshua Zupan CC0; iNaturalist 149921771 and 286777636 Garth Harwood CC BY; Commons Quercus_chrysolepis_1.jpg Stan Shebs CC BY-SA 3.0). W/H 1.35 is set below the open-grown median (1.46) because canyon-wall trees, the usual form here, are crowded and narrower (FEIS: in closed stands the crown sits in the top half of the tree); no clean silhouette of a canyon-wall tree was found. Base, porosity and colour are medians","photos":[{"url":"https://www.inaturalist.org/photos/350884919","license":"CC0","author":"Joshua Zupan","shows":"broad dome against the sky, Sugarloaf Ridge, January"},{"url":"https://www.inaturalist.org/photos/149921771","license":"CC BY 4.0","author":"Garth Harwood","shows":"rounded tree on a slope, Glenn County, July"},{"url":"https://www.inaturalist.org/photos/286777636","license":"CC BY 4.0","author":"Garth Harwood","shows":"dense open-grown dome to the ground, San Mateo County, June"},{"url":"https://commons.wikimedia.org/wiki/File:Quercus_chrysolepis_1.jpg","license":"CC BY-SA 3.0","author":"Stan Shebs","shows":"wide low dome skirted to the ground"}]},"license":"CC BY-SA 4.0"},
  "quercus_kelloggii": {"id":"quercus_kelloggii","aliases":["black_oak","california_black_oak"],"scientific":"Quercus kelloggii","common":"California black oak","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[10,22],"variants":[{"name":"sprout clump","weight":0.12,"height_m":[2.5,6],"trunk_radius":0.5,"crown_scale":0.9,"branches":0.6,"leaf_density":0.9,"set":{"trunk":{"stems":[2,4],"stem_spread_deg":18,"split_prob":0.1,"length_ratio":0.6},"epiphytes":{"mistletoe":{"prob":0}}},"note":"a clump of slim stems sprouting from the root crown of a tree killed by fire, as black oak does"},{"name":"young","weight":0.25,"height_m":[6,12],"trunk_radius":0.7,"crown_scale":0.8,"branches":0.85,"set":{"trunk":{"length_ratio":0.6,"split_prob":0.25},"crown":{"envelope":{"profile":[[0.25,0.18],[0.4,0.28],[0.55,0.32],[0.7,0.3],[0.84,0.22],[1.0,0.06]]}},"epiphytes":{"mistletoe":{"prob":0.1}}},"note":"a narrow, upright crown on a straight stem, as young trees grow among the pines"},{"name":"mature","weight":0.48,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[18,26],"trunk_radius":1.3,"crown_scale":1.15,"gnarl":1.3,"deadwood":{"fraction":0.2,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.8,"split_angle_deg":34,"lean_deg":12},"epiphytes":{"mistletoe":{"prob":0.5,"count":[2,5]}}},"note":"an old forked tree, a broad irregular crown of heavy crooked limbs, dead limbs and a hollow trunk"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[12,22],"limbs":0.55,"twigs":0.25,"levels":1,"shorten":[0.4,0.9],"rgb":[150,144,136]},"description":"A deciduous oak 10-25 m tall with dark, almost black, deeply cracked bark and big leaves, 10-20 cm long, cut into deep lobes that end in sharp bristles. It grows in the upper foothills from about 500 m up, among ponderosa pines and incense cedars; its new leaves come out pink in spring, it turns yellow and orange in fall, and its acorns were the favourite food of the Miwok, Maidu and Washoe people.","season_notes":{"winter":"Bare: dark trunks and crooked grey limbs among the evergreen pines and cedars.","spring":"The new leaves unfold soft, velvety and pink to red (April-May), with hanging yellow catkins, then turn bright green.","summer":"Glossy yellow-green leaves; acorns from last year's flowers swell in their deep scaly cups.","fall":"Acorns drop (September-November) and the leaves turn yellow, gold and orange-brown before falling."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.48,"radius_ratio":0.042,"taper":0.65,"flare":1.3,"bole_ratio":0.28,"base_size":0.17,"curve_deg":12,"curve_var_deg":16,"segments":5,"lean_deg":10,"stems":[1,2],"stem_spread_deg":14,"split_prob":0.45,"split_count":2,"split_angle_deg":28,"bark_rgb":[78,74,70],"bark_pattern":"platy","twig_rgb":[108,100,92],"bark":{"tile_m":[0.4,0.8],"plate_m":[0.06,0.12],"fissure":0.7,"contrast":1.0,"lichen":0.4,"relief":1.3}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.1,0.22],[0.26,0.38],[0.45,0.46],[0.6,0.48],[0.74,0.42],[0.87,0.3],[1.0,0.08]],"lobes":5,"lobe_depth":0.15,"asymmetry":0.18,"fill":0.55,"edge":1.08}},"levels":[{"count":9,"down_angle_deg":56,"down_angle_tip_deg":30,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":1.9,"length_var":0.25,"curve_deg":6,"curve_var_deg":22,"zigzag_deg":9,"tropism":0.03,"droop_deg":6,"taper":0.9,"radius_ratio":0.55,"segments":4},{"count":7,"start":0.15,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":22,"zigzag_deg":14,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.15,"leaf_shape":"lobed_large","lobes":7,"cluster_m":1.5,"density":10,"cards_per_m2":0.55,"leaf_fill":2.2,"roll_deg":60,"start":0.25,"parent_start":0.5,"orientation":"outward","colors":{"winter":[108,100,92],"spring":[136,126,106],"summer":[113,120,99],"fall":[174,140,93]},"leaf_on":{"winter":0.0,"spring":0.85,"summer":1.0,"fall":0.75},"clumps":{"radius_m":1.1,"cards_per_clump":7,"shell":0.3,"flatten":0.7,"tip_bias":1.4},"palette":[[0.75,[1,1,1]],[0.15,[1.12,1.15,0.9]],[0.1,[0.86,0.9,0.86]]],"winter_twigs":0.45,"ao_min":0.68,"color_var":[0.1,0.06],"leaf_on_var":0.6},"deadwood":{"fraction":0.08,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[140,134,126]},"epiphytes":{"mistletoe":{"prob":0.25,"count":[1,3],"radius_m":0.4}},"twigs":{"count":[1,2],"length":0.6,"down_deg":48,"down_var_deg":18,"curve_var_deg":22,"segments":2,"radius_m":0.011,"taper":0.55,"fan_deg":50,"jitter":0.2,"zigzag_deg":18},"lod":{"near_tris_budget":2000,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":0.92,"crown_base_ratio":0.21,"porosity":0.3,"foliage_rg":0.87,"foliage_bg":0.62,"fall_rg":1.5,"fall_bg":0.42,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md, colour from the eroded crown mask): open-grown summer tree W/H 1.19 base 0.11 porosity 0.31 r/g 0.78 b/g 0.76 (Commons Quercus_kelloggi.jpg, US Bureau of Reclamation, public domain; an old film scan with a blue cast); fall tree W/H 0.91 base 0.21 porosity 0.25, fall r/g 1.20 b/g 0.40 (Commons Quercus_kelloggii_2.jpg, Patrick Cox, CC BY 4.0); tall forest-edge tree at Mt Shasta in June W/H 0.63 base 0.25 porosity 0.47 r/g 0.96 b/g 0.63 (iNaturalist 205306487, Dominic Gentilcore, CC BY); W/H, base and porosity are medians; summer colour the mean of the two summer trees with b/g lowered from 0.70 to 0.62 for the scan's cast; fall colour the mean of the Patrick Cox tree and an orange November crown at Phantom Spires (r/g 1.93, b/g 0.45; iNaturalist 199013, Justin, CC BY); spring leaf-out r/g 1.55 b/g 0.99 (pink; iNaturalist 489024729, Alison K, CC0)","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Quercus_kelloggi.jpg","license":"Public domain","author":"US Bureau of Reclamation","shows":"broad open-grown tree in summer leaf"},{"url":"https://commons.wikimedia.org/wiki/File:Quercus_kelloggii_2.jpg","license":"CC BY 4.0","author":"Patrick Cox","shows":"forked tree in yellow fall colour against the sky"},{"url":"https://www.inaturalist.org/photos/205306487","license":"CC BY 4.0","author":"Dominic Gentilcore","shows":"tall narrow tree at a conifer edge, June"},{"url":"https://www.inaturalist.org/photos/199013","license":"CC BY 4.0","author":"Justin (iNaturalist justin2)","shows":"orange crown in November, Phantom Spires"},{"url":"https://www.inaturalist.org/photos/489024729","license":"CC0","author":"Alison K","shows":"pink new leaves, April"},{"url":"https://commons.wikimedia.org/wiki/File:Quercus_kelloggii_Las_Trampas.jpg","license":"CC BY 2.0","author":"Miguel Vieira","shows":"big open-grown tree turning in early November, dark trunk"}]},"license":"CC BY-SA 4.0"},
  "aesculus_californica": {"id":"aesculus_californica","aliases":["buckeye","california_buckeye"],"scientific":"Aesculus californica","common":"California buckeye","form":"tree","architectural_model":"Scarrone (provisional: each shoot ends in a flower candle, so the branches fork sympodially below it)","deciduous":true,"height_m":[4,9],"variants":[{"name":"young","weight":0.25,"height_m":[2,4],"trunk_radius":0.6,"crown_scale":0.9,"branches":0.75,"set":{"trunk":{"stems":[2,5],"stem_spread_deg":34},"foliage":{"clumps":{"radius_m":0.6}}},"note":"a shrubby clump of several pale stems, leafy to the ground"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[8,12],"trunk_radius":1.35,"crown_scale":1.12,"gnarl":1.3,"deadwood":{"fraction":0.15,"levels":[1,2],"where":"inner"},"set":{"trunk":{"stems":[1,3],"lean_deg":12}},"note":"a short, massive, silvery trunk and a wide dome whose lowest limbs sweep down to the grass, some dead wood inside"}],"description":"A low, wide tree 4-12 m tall, often with several smooth, pale silver-grey trunks, big hand-shaped leaves of five to seven leaflets and, in May, upright white flower spikes like candles all over the crown. It grows on dry slopes and canyon sides all through the foothills, and it is the first tree to go bare in summer, saving water by dropping its leaves in July while the oaks stay green.","season_notes":{"winter":"Bare silver-grey branches with a few big brown nuts still hanging; the first new leaves unfold in February.","spring":"Fresh bright green leaves, then white flower candles in May that hum with bees (the nectar is poisonous to honey bees, not to native bees).","summer":"Leaves turn brown and fall in July, so by August the tree is bare on the golden hills.","fall":"Pear-shaped husks split to show shiny brown nuts as big as a small egg, which drop and sprout in the first rains."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.3,"radius_ratio":0.065,"taper":0.6,"flare":1.35,"bole_ratio":0.3,"base_size":0.03,"curve_deg":10,"curve_var_deg":18,"segments":5,"lean_deg":9,"stems":[1,4],"stem_spread_deg":29,"split_prob":0.55,"split_count":2,"split_angle_deg":32,"sinuous_deg":4,"bark_rgb":[168,166,160],"bark_pattern":"smooth_grey","twig_rgb":[156,146,130],"bark":{"tile_m":[0.3,0.6],"plate_m":[0.04,0.06],"fissure":0.08,"contrast":0.5,"lichen":0.55,"relief":0.35}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.02,0.44],[0.12,0.6],[0.28,0.69],[0.45,0.69],[0.62,0.61],[0.77,0.47],[0.9,0.29],[1.0,0.08]],"lobes":5,"lobe_depth":0.12,"asymmetry":0.15,"fill":0.6,"edge":1.08}},"levels":[{"count":12,"down_angle_deg":70,"down_angle_tip_deg":40,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.4,"length_var":0.25,"curve_deg":6,"curve_var_deg":20,"zigzag_deg":8,"tropism":0.02,"droop_deg":15,"taper":0.9,"radius_ratio":0.6,"segments":4,"sinuous_deg":4},{"count":7,"start":0.12,"down_angle_deg":45,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":0,"curve_var_deg":20,"zigzag_deg":14,"tropism":0.05,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.18,"leaf_shape":"palmate_compound","leaflets":[5,7],"cluster_m":1.1,"density":9,"cards_per_m2":1.15,"leaf_fill":2.8,"roll_deg":60,"start":0.0,"parent_start":0.25,"orientation":"outward","colors":{"winter":[156,146,130],"spring":[104,119,62],"summer":[99,110,71],"fall":[142,116,95]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":0.6,"fall":0.0},"leaf_on_by_month":[0.0,0.05,0.7,1.0,1.0,1.0,0.55,0.1,0.03,0.0,0.0,0.0],"clumps":{"radius_m":0.66,"cards_per_clump":7,"shell":0.2,"flatten":0.75,"tip_bias":0.89},"palette":[[0.8,[1,1,1]],[0.2,[1.1,1.1,0.9]]],"winter_twigs":0.45,"ao_min":0.7,"color_var":[0.08,0.05],"leaf_on_var":0.7,"flowers":{"season":"spring","form":"candle","rgb":[238,232,214],"size_m":0.17,"before_leaves":false,"per_card":8,"width":0.17},"berries":{"season":"fall","rgb":[140,116,82],"size_m":0.06,"density":0.3}},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[172,168,160]},"twigs":{"count":[1,2],"length":0.6,"down_deg":45,"down_var_deg":18,"curve_var_deg":20,"segments":2,"radius_m":0.014,"taper":0.55,"zigzag_deg":20,"fan_deg":55,"jitter":0.2},"lod":{"near_tris_budget":1900,"near_sides":[5,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.9,"close_factor":2},"targets":{"crown_width_ratio":1.45,"crown_base_ratio":0.05,"porosity":0.18,"foliage_rg":0.8,"foliage_bg":0.36,"fall_rg":1.54,"fall_bg":0.65,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md): lone flowering tree W/H 1.41 base 0.15 porosity 0.26 (Commons, USFS Region 5, public domain; an oak behind it fills part of the crown, so porosity is rough); flowering mound W/H 1.27 base 0.02 porosity 0.16 (Commons, Consultaplantas, CC BY-SA 4.0); upper crown in flower porosity 0.17 (iNaturalist 389683682, CC0); summer-bare trees on Mount Diablo in August W/H 1.67 and 2.50 on a steep slope, foliage to the ground (Commons, Awinch1001, CC BY 4.0); colour mean of the three leafy trees (r/g 0.95, 0.81, 0.64; b/g 0.63, 0.20, 0.26: fresh yellow-green); fall_rg/fall_bg are the brown August crown, not autumn colour","photos":[{"url":"https://commons.wikimedia.org/wiki/File:California_Buckeye_(3659531817).jpg","license":"Public domain","author":"Pacific Southwest Region 5 (USFS)","shows":"lone tree in flower in an oak savanna"},{"url":"https://commons.wikimedia.org/wiki/File:Aesculus_californica_1w.jpg","license":"CC BY-SA 4.0","author":"Consultaplantas","shows":"broad leafy mound in flower, May"},{"url":"https://www.inaturalist.org/photos/389683682","license":"CC0","shows":"crown top with flower candles against the sky, May"},{"url":"https://commons.wikimedia.org/wiki/File:Aesculus_californica_drought_deciduous_Mount_Diablo_10.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"wide low tree with brown leaves in August (summer-deciduous)"},{"url":"https://commons.wikimedia.org/wiki/File:Aesculus_californica_drought_deciduous_Mount_Diablo_6.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"sprawling tree on a grassy slope, August"}]},"license":"CC BY-SA 4.0"},
  "arbutus_menziesii": {"id":"arbutus_menziesii","aliases":["madrone","pacific_madrone"],"scientific":"Arbutus menziesii","common":"Pacific madrone","form":"tree","architectural_model":"Scarrone (provisional: shoots end in flower panicles and fork sympodially below them)","deciduous":false,"height_m":[10,22],"variants":[{"name":"young","weight":0.25,"height_m":[4,9],"trunk_radius":0.7,"crown_scale":0.85,"branches":0.8,"set":{"trunk":{"stems":[1,3],"lean_deg":10}},"note":"slender leaning stems, a sprout clump after fire or a single sapling reaching for light"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[18,28],"trunk_radius":1.3,"crown_scale":1.12,"gnarl":1.25,"deadwood":{"fraction":0.2,"levels":[1,2],"where":"inner"},"set":{"trunk":{"stems":[1,3],"lean_deg":20}},"note":"a thick, twisting red trunk leaning out over the slope, dead limbs where cankers have killed them"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[12,22],"limbs":0.5,"twigs":0.15,"levels":1,"shorten":[0.45,0.9],"rgb":[146,120,104]},"description":"An evergreen tree 10-25 m tall with smooth, red-orange bark that peels in thin curls each summer to show fresh green-cream bark beneath, and thick, shiny, dark green leaves. It grows on north slopes and in canyons with the oaks and pines, often leaning far out toward the light, and its clusters of white bell flowers in spring and red-orange berries in fall feed bees, robins, thrushes and band-tailed pigeons.","season_notes":{"winter":"Evergreen: glossy dark leaves, and the clusters of red berries that birds have not yet eaten.","spring":"Hanging clusters of small white urn-shaped flowers (March-May), busy with bees.","summer":"The bark peels in papery red curls, showing smooth green-cream bark that slowly turns red; some old leaves turn red and drop.","fall":"Berries ripen orange to red (October-December) and bring flocks of robins and varied thrushes."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.55,"radius_ratio":0.035,"taper":0.6,"flare":1.25,"bole_ratio":0.3,"base_size":0.3,"curve_deg":18,"curve_var_deg":20,"segments":6,"lean_deg":16,"stems":[1,3],"stem_spread_deg":18,"split_prob":0.55,"split_count":2,"split_angle_deg":26,"sinuous_deg":8,"bark_rgb":[166,90,56],"bark_pattern":"peeling_red","twig_rgb":[172,98,62],"bark":{"tile_m":[0.3,0.6],"plate_m":[0.1,0.2],"fissure":0.05,"contrast":1.1,"lichen":0.05,"relief":0.4}},"crown":{"shape":"spherical","envelope":{"profile":[[0.3,0.22],[0.4,0.37],[0.52,0.45],[0.65,0.45],[0.78,0.38],[0.9,0.25],[1.0,0.07]],"lobes":4,"lobe_depth":0.18,"asymmetry":0.3,"fill":0.5,"edge":1.08}},"levels":[{"count":10,"down_angle_deg":60,"down_angle_tip_deg":35,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":35,"length_ratio":1.6,"length_var":0.3,"curve_deg":10,"curve_var_deg":26,"sinuous_deg":8,"tropism":0.04,"droop_deg":6,"taper":0.9,"radius_ratio":0.55,"segments":4},{"count":7,"start":0.2,"down_angle_deg":45,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":10,"curve_var_deg":22,"sinuous_deg":6,"tropism":0.05,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.11,"leaf_shape":"elliptic_glossy","cluster_m":1.2,"density":16,"leaf_fill":2.8,"roll_deg":60,"start":0.25,"parent_start":0.5,"orientation":"outward","colors":{"winter":[86,92,77],"spring":[94,103,73],"summer":[86,95,84],"fall":[90,95,78]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"leaf_on_by_month":[1,1,1,1,1,1,1,1,1,1,1,1],"clumps":{"radius_m":0.9,"cards_per_clump":9,"shell":0.25,"flatten":0.7,"tip_bias":1.6},"palette":[[0.8,[1,1,1]],[0.12,[1.22,1.2,0.9]],[0.08,[1.6,0.9,0.55]]],"ao_min":0.68,"color_var":[0.07,0.04],"flowers":{"season":"spring","form":"cluster","rgb":[236,230,212],"size_m":0.12,"density":0.4,"before_leaves":false},"berries":{"season":"fall","rgb":[204,70,42],"size_m":0.1,"density":0.45}},"deadwood":{"fraction":0.08,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[146,120,104]},"twigs":{"count":[2,3],"length":0.5,"down_deg":40,"down_var_deg":16,"curve_var_deg":25,"segments":1,"radius_m":0.008,"fan_deg":50,"jitter":0.2,"rgb":[172,98,62]},"lod":{"near_tris_budget":2000,"near_sides":[7,4,0],"mid_blobs":5,"mid_branches":3,"mid_segments":[3,2],"mid_blob_scale":0.9,"close_factor":2},"targets":{"crown_width_ratio":0.9,"crown_base_ratio":0.3,"porosity":0.28,"foliage_rg":0.88,"foliage_bg":0.69,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md; colour from crown pixels with the red bark masked out): open-grown multi-stemmed tree on Mount Tamalpais W/H 1.49 base 0.28 porosity 0.27 r/g 0.93 b/g 0.64 (Commons, Awinch1001, CC BY 4.0); tall leaning tree hemmed in by conifers W/H 0.46 base 0.41 porosity 0.35 (Commons, brewbooks, CC BY-SA 2.0); Big Sur pair, top 60% of the crown, W/H 0.62 porosity 0.29 (Commons, josh jackson, CC BY 2.0); crown against the sky, porosity 0.14 r/g 0.85 b/g 0.73 (iNaturalist 661183715, Skyler K, CC BY). W/H target 0.9 sits between the open-grown and the hemmed-in forms, which is how madrones in the foothill oak-pine woodland grow; base and porosity are medians","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Arbutus_menziesii_Mount_Tam_Blithedale_Ridge_Road_6.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"open-grown tree with several red stems at the edge of grassland"},{"url":"https://commons.wikimedia.org/wiki/File:A_healthy_Pacific_madrone_-_Flickr_-_brewbooks.jpg","license":"CC BY-SA 2.0","author":"brewbooks","shows":"tall tree leaning out from among conifers, crown high on sinuous red limbs"},{"url":"https://commons.wikimedia.org/wiki/File:Arbutus_menziesii_Big_Sur.jpg","license":"CC BY 2.0","author":"josh jackson","shows":"two tall trees against a clear sky"},{"url":"https://www.inaturalist.org/photos/661183715","license":"CC BY 4.0","author":"Skyler K","shows":"round crown of glossy leaves against the sky, May"},{"url":"https://www.inaturalist.org/photos/251783792","license":"CC0","shows":"big spreading tree at Hidden Falls Regional Park, Placer County (local; not measured: trees behind it)"}]},"license":"CC BY-SA 4.0"},
  "umbellularia_californica": {"id":"umbellularia_californica","aliases":["bay","california_bay","bay_laurel"],"scientific":"Umbellularia californica","common":"California bay laurel","form":"tree","architectural_model":"Rauh (provisional)","deciduous":false,"height_m":[10,20],"variants":[{"name":"young","weight":0.25,"height_m":[3,8],"trunk_radius":0.65,"crown_scale":0.9,"branches":0.8,"set":{"trunk":{"stems":[2,6],"stem_spread_deg":26}},"note":"a dense shrubby clump of upright stems, leafy to the ground"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[18,25],"trunk_radius":1.25,"crown_scale":1.1,"gnarl":1.2,"deadwood":{"fraction":0.12,"levels":[1,2],"where":"inner"},"set":{"trunk":{"stems":[3,7],"stem_spread_deg":30}},"note":"a ring of heavy, leaning, mossy stems from one old base, a dark dense dome over them"}],"description":"An evergreen tree 10-25 m tall, often with many trunks growing from one base, with a dense, dark, rounded crown of narrow, leathery leaves that smell sharp and spicy when you crush them. It grows in shady canyons, on north slopes and along creeks, where its deep shade keeps the ground cool, and its olive-like nuts are eaten by squirrels and were roasted as food by Native Californians.","season_notes":{"winter":"Evergreen, and in flower: small clusters of pale yellow flowers open from December to March.","spring":"New light green leaves at the branch tips; the flowers finish.","summer":"A dense dark crown with the deepest shade in the canyon.","fall":"Round green fruits like small olives ripen purple-brown and drop (October-November); squirrels and jays carry the nuts away."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.55,"radius_ratio":0.03,"taper":0.7,"flare":1.4,"bole_ratio":0.2,"base_size":0.04,"curve_deg":12,"curve_var_deg":16,"segments":5,"lean_deg":10,"stems":[2,5],"stem_spread_deg":20,"split_prob":0.35,"split_count":2,"split_angle_deg":22,"bark_rgb":[118,112,98],"bark_pattern":"smooth_grey","twig_rgb":[112,120,80],"bark":{"tile_m":[0.3,0.6],"plate_m":[0.04,0.06],"fissure":0.15,"contrast":0.6,"lichen":0.45,"relief":0.5}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.02,0.4],[0.15,0.48],[0.35,0.51],[0.5,0.5],[0.65,0.45],[0.8,0.35],[0.92,0.2],[1.0,0.06]],"lobes":5,"lobe_depth":0.1,"asymmetry":0.15,"fill":0.5,"edge":1.06}},"levels":[{"count":12,"down_angle_deg":65,"down_angle_tip_deg":30,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":1.3,"length_var":0.25,"curve_deg":10,"curve_var_deg":15,"tropism":0.06,"taper":0.9,"radius_ratio":0.5,"segments":3,"droop_deg":14},{"count":8,"start":0.15,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":10,"curve_var_deg":15,"tropism":0.05,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.08,"leaf_shape":"elliptic_glossy","cluster_m":1.4,"density":30,"cards_per_m2":1.5,"leaf_fill":3.0,"roll_deg":50,"start":0.0,"parent_start":0.35,"orientation":"outward","colors":{"winter":[82,86,61],"spring":[90,95,57],"summer":[85,88,67],"fall":[86,88,62]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"leaf_on_by_month":[1,1,1,1,1,1,1,1,1,1,1,1],"clumps":{"radius_m":1.0,"cards_per_clump":14,"shell":0.12,"flatten":0.8,"tip_bias":1.2},"palette":[[0.85,[1,1,1]],[0.1,[1.3,1.25,0.7]],[0.05,[0.82,0.86,0.82]]],"ao_min":0.66,"color_var":[0.08,0.04],"flowers":{"season":"winter","form":"cluster","rgb":[222,214,140],"size_m":0.03,"density":0.3,"before_leaves":false},"berries":{"season":"fall","rgb":[96,104,60],"size_m":0.025,"density":0.12}},"deadwood":{"fraction":0.05,"where":"inner","levels":[2],"shorten":0.6,"rgb":[120,114,104]},"twigs":{"count":[3,4],"length":0.5,"down_deg":50,"down_var_deg":20,"curve_var_deg":20,"segments":1,"radius_m":0.005,"fan_deg":55,"jitter":0.25,"rgb":[112,120,80]},"lod":{"near_tris_budget":2300,"near_sides":[5,3,0],"mid_blobs":5,"mid_branches":3,"mid_sides":[4,3],"mid_segments":[2,1],"mid_blob_scale":0.95,"close_factor":2},"targets":{"crown_width_ratio":1.0,"crown_base_ratio":0.1,"porosity":0.25,"foliage_rg":0.94,"foliage_bg":0.5,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md; bark masked out of the colour): wind-shaped dome on a ridge at Las Trampas W/H 1.34 base 0.11 porosity 0.05 (Commons, Dcrjsr, CC BY 4.0); dense multi-stemmed tree in Wildcat Canyon W/H 1.04 base 0.10 porosity 0.37 (sparse dead top) (Commons, Awinch1001, CC BY 4.0); open form at Grizzly Peak W/H 1.63 base 0.16 porosity 0.28; upright form W/H 0.64 base 0.08 porosity 0.28; upright multi-stemmed W/H 0.84 base 0.32 porosity 0.33 (all Commons, Awinch1001, CC BY 4.0); crown against the sky in Ventura County porosity 0.25 (iNaturalist 270372457, Adam J. Searcy, CC BY); W/H and base medians; porosity 0.25 is the median 0.28 nudged toward the dense canyon trees of which no clean silhouette was found; colour mean of six (r/g 0.86-1.05, b/g 0.36-0.69)","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Calif_bay_vw_up_W_ridge_Las_Trampas.jpg","license":"CC BY 4.0","author":"Dcrjsr","shows":"lone wind-shaped dome on a grassy ridge"},{"url":"https://commons.wikimedia.org/wiki/File:Umbellularia_californica_whole_tree_Wildcat_Canyon_preserve_1.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"dense dark multi-stemmed tree"},{"url":"https://commons.wikimedia.org/wiki/File:Umbellularia_californica_Grizzly_peak_open_form_6.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"open spreading form with many stems"},{"url":"https://commons.wikimedia.org/wiki/File:Umbellularia_californica_Grizzly_peak_upright_habit_9.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"upright young tree"},{"url":"https://commons.wikimedia.org/wiki/File:Umbellularia_californica_Grizzly_peak_upright_habit_10.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"upright multi-stemmed tree"},{"url":"https://www.inaturalist.org/photos/270372457","license":"CC BY 4.0","author":"Adam J. Searcy","shows":"dense crown against the sky, Ventura County, July"},{"url":"https://commons.wikimedia.org/wiki/File:Umbellularia_californica_Grizzly_peak_multi-trunked_habit_1.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"many leaning trunks from one base (not measured)"}]},"license":"CC BY-SA 4.0"},
  "juglans_hindsii": {"id":"juglans_hindsii","aliases":["walnut","black_walnut","california_black_walnut","northern_california_black_walnut"],"scientific":"Juglans hindsii","common":"northern California black walnut","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[12,18],"variants":[{"name":"young","weight":0.25,"height_m":[5,10],"trunk_radius":0.65,"crown_scale":0.8,"branches":0.8,"set":{"trunk":{"length_ratio":0.55,"split_prob":0.2},"foliage":{"clumps":{"radius_m":0.8}}},"note":"a straight young tree with a leader, crown taller than wide"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[16,22],"trunk_radius":1.3,"crown_scale":1.12,"gnarl":1.2,"deadwood":{"fraction":0.18,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.7,"lean_deg":10}},"note":"a massive dark trunk forking into heavy limbs, a broad open dome with some dead branches"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[12,20],"limbs":0.55,"twigs":0.2,"levels":1,"shorten":[0.45,0.9],"rgb":[128,122,114]},"description":"A tall walnut tree 10-20 m high with a stout, dark, deeply furrowed trunk and long feathery leaves made of many narrow leaflets that turn yellow in fall. It grows along creeks, rivers and valley edges below the foothills and up the canyons, and its round green nuts, hard as stone inside, are cracked open by squirrels and woodpeckers.","season_notes":{"winter":"Bare: a dark trunk and a few thick, stiff branches with stout grey twigs.","spring":"Leaves come out late (April) with long green catkins hanging from the twigs.","summer":"A light, feathery crown; round green nuts the size of a golf ball hang among the leaves.","fall":"Leaves turn yellow and drop early (October); the nuts fall, and their husks blacken on the ground."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.4,"radius_ratio":0.048,"taper":0.6,"flare":1.35,"bole_ratio":0.4,"base_size":0.12,"curve_deg":8,"curve_var_deg":12,"segments":5,"lean_deg":8,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.45,"split_count":2,"split_angle_deg":28,"bark_rgb":[80,74,68],"bark_pattern":"furrowed","twig_rgb":[122,114,100],"bark":{"tile_m":[0.4,0.8],"ridge_m":0.04,"block_m":0.12,"fissure":0.6,"contrast":1.2,"lichen":0.15,"relief":1.4}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.05,0.26],[0.18,0.47],[0.35,0.57],[0.5,0.58],[0.65,0.52],[0.8,0.4],[0.92,0.24],[1.0,0.07]],"lobes":5,"lobe_depth":0.14,"asymmetry":0.15,"fill":0.55,"edge":1.08}},"levels":[{"count":9,"down_angle_deg":62,"down_angle_tip_deg":35,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.2,"length_var":0.25,"curve_deg":6,"curve_var_deg":18,"zigzag_deg":4,"tropism":0.03,"droop_deg":10,"taper":0.9,"radius_ratio":0.6,"segments":4},{"count":7,"start":0.15,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":18,"zigzag_deg":6,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.3,"leaf_shape":"pinnate_compound","leaflets":[15,19],"cluster_m":1.4,"density":8,"cards_per_m2":0.35,"leaf_fill":2.0,"roll_deg":60,"start":0.15,"parent_start":0.45,"orientation":"outward","colors":{"winter":[122,114,100],"spring":[97,112,68],"summer":[92,104,77],"fall":[135,120,62]},"leaf_on":{"winter":0.0,"spring":0.85,"summer":1.0,"fall":0.6},"leaf_on_by_month":[0.0,0.0,0.1,0.7,1.0,1.0,1.0,1.0,0.95,0.6,0.15,0.0],"clumps":{"radius_m":1.0,"cards_per_clump":7,"shell":0.3,"flatten":0.75,"tip_bias":1.4},"palette":[[0.8,[1,1,1]],[0.2,[1.12,1.12,0.95]]],"winter_twigs":0.4,"ao_min":0.7,"color_var":[0.08,0.05],"leaf_on_var":0.5,"berries":{"season":"fall","rgb":[150,166,92],"size_m":0.045,"density":0.3}},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[124,118,110]},"twigs":{"count":[1,2],"length":0.6,"down_deg":45,"down_var_deg":18,"curve_var_deg":20,"segments":2,"radius_m":0.012,"taper":0.6,"zigzag_deg":10,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":2000,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":1.15,"crown_base_ratio":0.13,"porosity":0.34,"foliage_rg":0.78,"foliage_bg":0.49,"fall_rg":1.3,"fall_bg":0.26,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md; bark masked out of the colour): lone tree in Yolo County W/H 1.32 base 0.11 porosity 0.36 (iNaturalist 66771086, Tim Messick, CC BY); lone tree at Petaluma W/H 1.04 base 0.09 porosity 0.34 (iNaturalist 9187468, Sam Kieschnick, CC BY); younger tree at San Jose W/H 0.57 base 0.20 porosity 0.46 (iNaturalist 289147494, Nicholas Wei, CC BY-SA); big tree on the American River Parkway W/H 1.47 base 0.14 porosity 0.26 (iNaturalist 224682899, Matt Lavin, CC BY); W/H and base medians, porosity median of five (with iNaturalist 206961349, 0.22); summer colour mean of the June-August trees (r/g 0.76, 0.89, 0.68; b/g 0.39, 0.58, 0.51); fall colour iNaturalist 457238999 (CC0, Arden-Arcade, November)","photos":[{"url":"https://www.inaturalist.org/photos/66771086","license":"CC BY 4.0","author":"Tim Messick","shows":"lone broad tree in fresh leaf, Yolo County, April"},{"url":"https://www.inaturalist.org/photos/9187468","license":"CC BY 4.0","author":"Sam Kieschnick","shows":"lone tree by a slough, Petaluma, April"},{"url":"https://www.inaturalist.org/photos/289147494","license":"CC BY-SA 4.0","author":"Nicholas Wei","shows":"younger tree in a grassland, San Jose, June"},{"url":"https://www.inaturalist.org/photos/224682899","license":"CC BY 4.0","author":"Matt Lavin","shows":"big spreading tree on the American River Parkway, August"},{"url":"https://www.inaturalist.org/photos/206961349","license":"CC BY 4.0","author":"Alan Rockefeller","shows":"crown of feathery leaves against the sky, Wildcat Canyon, June"},{"url":"https://www.inaturalist.org/photos/457238999","license":"CC0","shows":"yellow fall leaves, Arden-Arcade, November"}]},"license":"CC BY-SA 4.0"},
  "acer_macrophyllum": {"id":"acer_macrophyllum","aliases":["maple","bigleaf_maple","big_leaf_maple"],"scientific":"Acer macrophyllum","common":"big-leaf maple","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[15,24],"variants":[{"name":"young","weight":0.25,"height_m":[6,12],"trunk_radius":0.65,"crown_scale":0.8,"branches":0.8,"set":{"trunk":{"length_ratio":0.55,"split_prob":0.25},"foliage":{"clumps":{"radius_m":0.9}}},"note":"a slender young tree or a clump of sprouts from a cut stump, crown narrow and upright"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[22,30],"trunk_radius":1.3,"crown_scale":1.12,"gnarl":1.25,"deadwood":{"fraction":0.2,"levels":[1,2],"where":"inner"},"set":{"trunk":{"stems":[2,4],"stem_spread_deg":20,"lean_deg":12}},"note":"several massive mossy stems from one base, heavy limbs, some dead"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[14,24],"limbs":0.5,"twigs":0.2,"levels":1,"shorten":[0.4,0.9],"rgb":[140,134,124]},"description":"A big streamside maple 15-25 m tall with the largest leaves of any maple, often 30 cm across with five deep lobes, and a trunk often furred with moss and ferns. It shades the creeks and canyon bottoms of the foothills, turns yellow and gold in fall, and spins its paired winged seeds down to the water.","season_notes":{"winter":"Bare grey limbs, green with moss after the rains, above the creek.","spring":"Long hanging clusters of yellow-green flowers open as the leaves unfold (March-April); bees and hummingbirds visit them.","summer":"Huge leaves make a deep, cool shade; pairs of hairy winged seeds hang in bunches.","fall":"Yellow to gold in October and November; the big leaves pile up along the creek."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.45,"radius_ratio":0.04,"taper":0.65,"flare":1.35,"bole_ratio":0.35,"base_size":0.15,"curve_deg":10,"curve_var_deg":14,"segments":5,"lean_deg":10,"stems":[1,3],"stem_spread_deg":16,"split_prob":0.5,"split_count":2,"split_angle_deg":26,"bark_rgb":[116,112,100],"bark_pattern":"furrowed","twig_rgb":[120,116,92],"bark":{"tile_m":[0.35,0.7],"ridge_m":0.03,"block_m":0.08,"fissure":0.45,"contrast":0.9,"lichen":0.7,"relief":1.0}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.1,0.24],[0.24,0.36],[0.42,0.42],[0.56,0.42],[0.7,0.37],[0.83,0.28],[0.93,0.17],[1.0,0.05]],"lobes":5,"lobe_depth":0.16,"asymmetry":0.2,"fill":0.55,"edge":1.08}},"levels":[{"count":10,"down_angle_deg":55,"down_angle_tip_deg":30,"down_angle_var_deg":14,"rotation_deg":90,"rotation_var_deg":25,"length_ratio":1.8,"length_var":0.25,"curve_deg":8,"curve_var_deg":18,"tropism":0.04,"taper":0.9,"radius_ratio":0.55,"segments":4,"droop_deg":8},{"count":8,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":90,"rotation_var_deg":20,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":18,"zigzag_deg":6,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.25,"leaf_shape":"lobed_large","lobes":5,"lobe_depth":0.6,"lobe_style":"palmate","cluster_m":1.6,"density":8,"cards_per_m2":0.55,"leaf_fill":1.8,"roll_deg":50,"start":0.1,"parent_start":0.4,"orientation":"outward","colors":{"winter":[120,116,92],"spring":[99,108,65],"summer":[94,100,76],"fall":[150,118,55]},"leaf_on":{"winter":0.0,"spring":0.95,"summer":1.0,"fall":0.6},"leaf_on_by_month":[0.0,0.0,0.3,0.9,1.0,1.0,1.0,1.0,0.95,0.75,0.3,0.02],"clumps":{"radius_m":1.2,"cards_per_clump":9,"shell":0.2,"flatten":0.65,"tip_bias":1.4},"palette":[[0.8,[1,1,1]],[0.2,[1.15,1.18,1.0]]],"winter_twigs":0.4,"ao_min":0.68,"color_var":[0.08,0.05],"leaf_on_var":0.5,"flowers":{"season":"spring","form":"cluster","rgb":[206,210,118],"size_m":0.12,"density":0.5,"before_leaves":true}},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[140,134,124]},"twigs":{"count":[1,2],"length":0.6,"down_deg":50,"down_var_deg":18,"curve_var_deg":18,"segments":2,"radius_m":0.01,"taper":0.6,"zigzag_deg":8,"fan_deg":55,"jitter":0.2},"lod":{"near_tris_budget":2200,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.9,"close_factor":2},"targets":{"crown_width_ratio":0.9,"crown_base_ratio":0.15,"porosity":0.25,"foliage_rg":0.88,"foliage_bg":0.5,"fall_rg":1.7,"fall_bg":0.22,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md; bark masked out of the colour): roadside tree near Boulder Creek W/H 0.60 base 0.19 porosity 0.22 r/g 0.92 b/g 0.58 (Commons, Famartin, CC BY-SA 4.0); broad dome near Boulder Creek W/H 0.98 base 0.05 porosity 0.28 r/g 0.98 b/g 0.57 (Commons, Famartin, CC BY-SA 4.0); fall tree in Santa Clara County W/H 1.05 base 0.19 porosity 0.27 (iNaturalist 337012549, Garth Harwood, CC BY); tall forest tree in Oregon, porosity 0.23 r/g 0.74 b/g 0.34 (Commons, Jsayre64, CC BY-SA 3.0); W/H, base and porosity medians, colour mean of the three summer trees; fall colour Mount Diablo, November (iNaturalist 107311642, Ken-ichi Ueda, CC BY): r/g 1.77 b/g 0.21, target 1.7 / 0.22","photos":[{"url":"https://commons.wikimedia.org/wiki/File:2025-08-10_11_30_05_A_Bigleaf_Maple_along_Bear_Creek_Road_on_the_outskirts_of_Boulder_Creek_in_Santa_Cruz_County,_California.jpg","license":"CC BY-SA 4.0","author":"Famartin","shows":"roadside tree in late summer, Santa Cruz County"},{"url":"https://commons.wikimedia.org/wiki/File:2025-08-11_09_25_30_Bigleaf_Maple_along_Bear_Creek_Road_on_the_outskirts_of_Boulder_Creek_in_Santa_Cruz_County,_California.jpg","license":"CC BY-SA 4.0","author":"Famartin","shows":"broad leafy dome against the sky, August"},{"url":"https://www.inaturalist.org/photos/337012549","license":"CC BY 4.0","author":"Garth Harwood","shows":"tree turning yellow beside a barn, Santa Clara County, November"},{"url":"https://www.inaturalist.org/photos/107311642","license":"CC BY 4.0","author":"Ken-ichi Ueda","shows":"gold fall crown, Mount Diablo, November"},{"url":"https://commons.wikimedia.org/wiki/File:Tall_bigleaf_maple.JPG","license":"CC BY-SA 3.0","author":"Jsayre64","shows":"tall forest-grown tree, Oregon, summer"}]},"license":"CC BY-SA 4.0"},
  "fraxinus_latifolia": {"id":"fraxinus_latifolia","aliases":["oregon_ash","ash"],"scientific":"Fraxinus latifolia","common":"Oregon ash","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[12,20],"variants":[{"name":"young","weight":0.25,"height_m":[5,10],"trunk_radius":0.65,"crown_scale":0.8,"branches":0.75,"set":{"trunk":{"length_ratio":0.75,"split_prob":0.15},"foliage":{"clumps":{"radius_m":0.7}}},"note":"a slim young tree with a straight leader and a few stiff ascending branches, see-through"},{"name":"mature","weight":0.55,"seeds":1,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[18,25],"trunk_radius":1.3,"crown_scale":1.12,"gnarl":1.2,"deadwood":{"fraction":0.18,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.65,"lean_deg":9}},"note":"a thick ridged trunk forking into two or three ascending limbs, an oval crown with some dead branches"}],"snag":{"fraction":0.05,"from":"veteran","height_m":[12,20],"limbs":0.55,"twigs":0.2,"levels":1,"shorten":[0.45,0.9],"rgb":[150,146,136]},"description":"A streamside tree 15-20 m tall with a straight grey trunk patterned in criss-crossing ridges, stout grey twigs and leaves made of five to seven broad leaflets that are fuzzy underneath. It grows where the ground stays wet, along creeks, springs and the edges of ponds, turns clear yellow early in fall, and hangs bunches of narrow winged seeds that spin down in the wind.","season_notes":{"winter":"Bare: a few thick, stiff grey branches with blunt twig tips; clusters of old seeds may still hang on.","spring":"One of the last trees to leaf out (April); small purple flowers open before the leaves.","summer":"A light, open crown of fresh green leaves with paler, fuzzy undersides.","fall":"Bright yellow in October, then bare before most of the creek's other trees."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.6,"radius_ratio":0.035,"taper":0.7,"flare":1.3,"bole_ratio":0.35,"base_size":0.1,"curve_deg":8,"curve_var_deg":10,"segments":5,"lean_deg":6,"stems":[1,2],"stem_spread_deg":12,"split_prob":0.4,"split_count":2,"split_angle_deg":20,"bark_rgb":[128,124,114],"bark_pattern":"furrowed","twig_rgb":[142,134,118],"bark":{"tile_m":[0.3,0.6],"ridge_m":0.025,"block_m":0.07,"fissure":0.5,"contrast":1.0,"lichen":0.4,"relief":1.1}},"crown":{"shape":"tapered_cylindrical","envelope":{"profile":[[0.1,0.17],[0.25,0.28],[0.45,0.35],[0.6,0.35],[0.74,0.31],[0.86,0.23],[0.95,0.13],[1.0,0.04]],"lobes":4,"lobe_depth":0.14,"asymmetry":0.12,"fill":0.5,"edge":1.08}},"levels":[{"count":12,"down_angle_deg":48,"down_angle_tip_deg":28,"down_angle_var_deg":12,"rotation_deg":90,"rotation_var_deg":25,"length_ratio":1.2,"length_var":0.25,"curve_deg":6,"curve_var_deg":14,"tropism":0.06,"taper":0.9,"radius_ratio":0.5,"segments":4},{"count":6,"start":0.2,"down_angle_deg":45,"down_angle_var_deg":14,"rotation_deg":90,"rotation_var_deg":20,"length_ratio":0.5,"length_var":0.3,"curve_deg":0,"curve_var_deg":14,"tropism":0.05,"taper":1.0,"radius_ratio":0.5,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.22,"leaf_shape":"pinnate_compound","leaflets":[5,7],"cluster_m":1.2,"density":12,"leaf_fill":2.4,"roll_deg":60,"start":0.15,"parent_start":0.5,"orientation":"outward","colors":{"winter":[142,134,118],"spring":[102,117,65],"summer":[97,108,74],"fall":[148,124,75]},"leaf_on":{"winter":0.0,"spring":0.75,"summer":1.0,"fall":0.45},"leaf_on_by_month":[0.0,0.0,0.05,0.6,1.0,1.0,1.0,1.0,0.9,0.5,0.1,0.0],"clumps":{"radius_m":0.9,"cards_per_clump":8,"shell":0.25,"flatten":0.75,"tip_bias":1.5},"palette":[[0.75,[1,1,1]],[0.25,[1.18,1.2,1.12]]],"winter_twigs":0.35,"ao_min":0.7,"color_var":[0.08,0.05],"leaf_on_var":0.5},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[150,146,136]},"twigs":{"count":[1,2],"length":0.55,"down_deg":40,"down_var_deg":15,"curve_var_deg":15,"segments":1,"radius_m":0.012,"taper":0.6,"fan_deg":45,"jitter":0.2},"lod":{"near_tris_budget":1900,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":0.7,"crown_base_ratio":0.25,"porosity":0.33,"foliage_rg":0.8,"foliage_bg":0.42,"fall_rg":1.48,"fall_bg":0.34,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md; bark masked out of the colour): fall tree W/H 0.64 (Commons Oregon_Ash,_Oregon_08, born1945, CC BY 2.0); bare tree W/H 0.76 (Oregon_Ash,_Oregon_06); summer tree W/H 0.66 porosity 0.33 r/g 0.74 b/g 0.47 (Oregon_Ash,_Oregon_13); Yolo County tree W/H 0.89 porosity 0.36 r/g 0.73 b/g 0.39 (iNaturalist 15491444, Tim Messick, CC BY); crown at Lake Natoma, Folsom, September, porosity 0.32 r/g 0.93 b/g 0.41 (iNaturalist 565201453, CC0); W/H median of four, porosity median of three (a sparse young tree measured 0.60, iNaturalist 17557238); crown base is a judgement (0.25): in every photo the lower trunk is hidden in riparian thicket; fall colour from Oregon_Ash,_Oregon_08","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Oregon_Ash,_Oregon_13.jpg","license":"CC BY 2.0","author":"born1945","shows":"oval crown in fresh leaf among riparian trees, May"},{"url":"https://commons.wikimedia.org/wiki/File:Oregon_Ash,_Oregon_08.jpg","license":"CC BY 2.0","author":"born1945","shows":"tall yellow fall crown against a blue sky, October"},{"url":"https://commons.wikimedia.org/wiki/File:Oregon_Ash,_Oregon_06.jpg","license":"CC BY 2.0","author":"born1945","shows":"bare tree with ascending limbs, November"},{"url":"https://www.inaturalist.org/photos/15491444","license":"CC BY 4.0","author":"Tim Messick","shows":"tree in a riparian thicket, Yolo County, April"},{"url":"https://www.inaturalist.org/photos/565201453","license":"CC0","shows":"crown at Lake Natoma, Folsom (near the home tiles), September"}]},"license":"CC BY-SA 4.0"},
  "calocedrus_decurrens": {"id":"calocedrus_decurrens","aliases":["incense_cedar"],"scientific":"Calocedrus decurrens","common":"incense cedar","form":"tree","architectural_model":"Rauh (provisional)","deciduous":false,"height_m":[20,36],"variants":[{"name":"young","weight":0.3,"height_m":[4,12],"trunk_radius":0.85,"branches":0.8,"set":{"trunk":{"base_size":0.04,"bole_ratio":0.04,"flare":1.25,"bark_rgb":[132,92,74]},"crown":{"envelope":{"profile":[[0.04,0.24],[0.2,0.24],[0.4,0.21],[0.6,0.16],[0.8,0.09],[1.0,0.02]],"lobe_depth":0.06,"asymmetry":0.05}},"levels":[{"droop_deg":18,"upturn_deg":30}]},"note":"a dense, neat cone of bright green sprays with branches to the ground"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written"},{"name":"old-growth","weight":0.15,"height_m":[32,45],"trunk_radius":1.4,"branches":0.75,"gnarl":1.3,"deadwood":{"fraction":0.25,"levels":[1],"where":"lower","shorten":0.5,"rgb":[128,112,100]},"set":{"trunk":{"base_size":0.36,"bole_ratio":0.34,"flare":1.7,"stubs":{"count":[8,16]}},"crown":{"envelope":{"profile":[[0.36,0.17],[0.5,0.2],[0.64,0.19],[0.78,0.15],[0.9,0.1],[1.0,0.04]],"lobes":4,"lobe_depth":0.22,"asymmetry":0.22}}},"note":"a huge swollen base, a long fluted cinnamon trunk and an open, ragged crown of big drooping limbs, often with a dead top"}],"snag":{"fraction":0.05,"from":"mature","height_m":[16,30],"limbs":0.35,"twigs":0,"levels":1,"broken_top":[0.6,0.9],"shorten":[0.3,0.8],"rgb":[150,128,112]},"description":"A tall evergreen 20-40 m high with a cinnamon-red, deeply grooved trunk whose bark peels in long soft strips, and flat, fan-shaped sprays of tiny scale leaves that smell like a pencil when crushed. It grows with ponderosa pine and black oak from the upper foothills into the mountains, comes down shady canyons into the oak woodland, and is young and cone-shaped for a century before turning ragged and open in old age.","season_notes":{"winter":"Evergreen; the branch tips turn golden with tiny pollen cones that shed yellow pollen from December to February.","spring":"New growth makes the flat sprays bright yellow-green; this year's seed cones start as small green buds.","summer":"Dense green sprays in the crown and the small cones grow to full size, about the size of a fingertip.","fall":"The small seed cones turn brown and split into three parts like a duck's open beak, dropping winged seeds (September-October)."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.035,"taper":1.0,"flare":1.5,"bole_ratio":0.08,"base_size":0.09,"curve_deg":4,"curve_var_deg":5,"segments":7,"lean_deg":3,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.06,"split_count":2,"split_angle_deg":10,"split_height":0.7,"bark_rgb":[146,98,76],"bark_pattern":"fibrous","twig_rgb":[112,84,66],"stubs":{"count":[2,6],"length_m":0.4,"radius_ratio":0.1},"bark":{"tile_m":[0.5,1.2],"ridge_m":0.07,"block_m":0.6,"fissure":0.7,"contrast":1.0,"relief":1.4}},"crown":{"shape":"conical","envelope":{"profile":[[0.13,0.2],[0.25,0.22],[0.4,0.21],[0.55,0.19],[0.7,0.15],[0.85,0.09],[1.0,0.02]],"lobes":4,"lobe_depth":0.12,"asymmetry":0.12,"fill":0.3,"edge":1.1}},"levels":[{"count":36,"whorl":0,"down_angle_deg":84,"down_angle_tip_deg":50,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":25,"length_ratio":0.27,"length_var":0.25,"curve_deg":0,"curve_var_deg":14,"tropism":0.02,"droop_deg":26,"upturn_deg":34,"taper":0.95,"radius_ratio":0.3,"segments":3},{"count":9,"start":0.2,"down_angle_deg":50,"down_angle_var_deg":14,"rotation_deg":-70,"rotation_var_deg":20,"length_ratio":0.35,"length_var":0.3,"curve_deg":6,"curve_var_deg":10,"tropism":0.05,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"scale","leaf_size_m":0.012,"leaf_shape":"needle_scale","cluster_m":1.95,"density":12,"leaf_fill":5.0,"start":0.2,"parent_start":0.45,"orientation":"along","needle_planes":1,"tuft_spread_deg":30,"tuft_up":0.25,"droop":0.2,"needle_normal":0.45,"needle_wrap":0.4,"translucency":2.0,"needle_scatter":0.12,"colors":{"winter":[106,106,70],"spring":[112,120,76],"summer":[105,110,74],"fall":[104,108,73]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":20,"clumps":{"radius_m":0.8,"cards_per_clump":4,"shell":0.1,"flatten":0.6,"tip_bias":1.4},"palette":[[0.85,[1,1,1]],[0.15,[1.15,1.12,0.8]]],"ao_min":0.7,"color_var":[0.07,0.03]},"deadwood":{"fraction":0.12,"where":"lower","levels":[1],"shorten":0.6,"rgb":[128,112,100]},"twigs":{"count":[1,2],"length":0.5,"down_deg":40,"down_var_deg":12,"tropism":0.05,"segments":1,"radius_m":0.008,"taper":0.5,"fan_deg":30,"jitter":0.08},"lod":{"near_tris_budget":2200,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":2,"mid_blob_scale":0.8,"close_factor":2,"mid_planes":1,"mid_cards":32},"targets":{"crown_width_ratio":0.42,"crown_base_ratio":0.14,"porosity":0.15,"foliage_rg":0.92,"foliage_bg":0.42,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md, colour from the eroded crown mask): Placer County tree W/H 0.69 base 0.04 porosity 0.16 (iNaturalist 590095975, Siddarth Machado, CC BY; colour left out, low golden sun); Long Barn W/H 0.44 base 0.14 porosity 0.05 r/g 0.96 b/g 0.35 (iNaturalist 614047240, Christopher Foott, CC0); Yosemite W/H 0.40 base 0.13 porosity 0.26 r/g 0.77 b/g 0.66 (Commons, Victor R. Ruiz, CC BY-SA 2.0); W/H 0.49 base 0.12 porosity 0.09 r/g 0.92 b/g 0.42 (Commons kz05, Krzysztof Ziarnek, CC BY-SA 4.0); Timbered Crater W/H 0.34 base 0.15 porosity 0.28 r/g 0.78 b/g 0.42 (Commons, JOE BLOWE, CC BY-SA 2.0); Big Bear Lake old tree W/H 0.40 base 0.36 porosity 0.14 r/g 1.08 b/g 0.53 (Commons, Ewen Roberts, CC BY 2.0). All values are medians","photos":[{"url":"https://www.inaturalist.org/photos/590095975","license":"CC BY 4.0","author":"Siddarth Machado","shows":"young-mature open tree in Placer County, October"},{"url":"https://www.inaturalist.org/photos/614047240","license":"CC0","author":"Christopher Foott","shows":"dense mature cone against the sky, Long Barn (Tuolumne County)"},{"url":"https://commons.wikimedia.org/wiki/File:Calocedrus_decurrens_Yosemite_NP.jpg","license":"CC BY-SA 2.0","author":"Victor R. Ruiz","shows":"tall mature tree in Yosemite Valley, double leader"},{"url":"https://commons.wikimedia.org/wiki/File:Calocedrus_decurrens_kz05.jpg","license":"CC BY-SA 4.0","author":"Krzysztof Ziarnek, Kenraiz","shows":"mature conical crown, drooping lower limbs"},{"url":"https://commons.wikimedia.org/wiki/File:Calocedrus_decurrens_on_Timbered_Crater_-_Flickr_-_theforestprimeval.jpg","license":"CC BY-SA 2.0","author":"JOE BLOWE (Flickr theforestprimeval)","shows":"old open tree with cinnamon trunk and ragged crown"},{"url":"https://commons.wikimedia.org/wiki/File:Calocedrus_decurrens_Big_Bear_Lake_1.jpg","license":"CC BY 2.0","author":"Ewen Roberts","shows":"old tree with a long clear trunk and irregular crown"}]},"license":"CC BY-SA 4.0"},
  "pseudotsuga_menziesii": {"id":"pseudotsuga_menziesii","aliases":["douglas_fir"],"scientific":"Pseudotsuga menziesii","common":"Douglas-fir","form":"tree","architectural_model":"Massart (provisional)","deciduous":false,"height_m":[30,48],"variants":[{"name":"young","weight":0.25,"height_m":[6,18],"trunk_radius":0.8,"branches":0.8,"leaf_density":1.3,"set":{"trunk":{"base_size":0.06,"bole_ratio":0.05,"bark_rgb":[128,120,112],"bark_pattern":"smooth","stubs":{"count":[0,2]}},"crown":{"envelope":{"profile":[[0.06,0.27],[0.25,0.26],[0.45,0.22],[0.65,0.16],[0.82,0.1],[1.0,0.02]],"lobe_depth":0.06}},"levels":[{"droop_deg":20,"upturn_deg":30}]},"note":"a dense, symmetrical spire with branches to the ground and smooth grey bark with resin blisters"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written"},{"name":"old-growth","weight":0.17,"height_m":[45,60],"trunk_radius":1.4,"branches":0.75,"gnarl":1.2,"deadwood":{"fraction":0.2,"levels":[1],"where":"lower","shorten":0.5,"rgb":[130,120,108]},"set":{"trunk":{"base_size":0.55,"bole_ratio":0.5,"length_ratio":0.95,"bark_rgb":[116,96,80],"stubs":{"count":[12,24]}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.52,0.16],[0.64,0.2],[0.76,0.2],[0.88,0.16],[0.96,0.1],[1.0,0.05]],"lobes":4,"lobe_depth":0.18,"asymmetry":0.16}},"levels":[{"droop_deg":40,"upturn_deg":20}]},"note":"a giant with a long clear trunk of thick, deeply furrowed bark and a narrow, ragged, flat-topped crown of heavy drooping limbs"}],"snag":{"fraction":0.06,"from":"mature","height_m":[22,40],"limbs":0.25,"twigs":0,"levels":1,"broken_top":[0.5,0.85],"shorten":[0.3,0.8],"rgb":[146,134,120]},"description":"A very tall, straight conifer, 30-60 m high, with soft flat needles all round the twigs, branches that droop and then lift at the tips, and thick, deeply furrowed red-brown bark on old trees. Here it grows above about 600 m on cool north slopes and in canyons with ponderosa pine and incense cedar, and its hanging cones have three-pointed bracts sticking out between the scales, like the back legs and tail of a mouse hiding inside.","season_notes":{"winter":"Evergreen: the needles stay on for five to eight years, and last year's cones hang empty in the upper crown.","spring":"Bright yellow-green new shoots burst from papery bud scales at every branch tip (April-June), and small red seed cones and yellow pollen cones appear.","summer":"The new shoots darken to the old needles' colour while the hanging cones swell, green at first, then brown.","fall":"Ripe cones open and drop winged seeds (September-October); chickarees and chipmunks cut and store the cones."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.022,"taper":1.0,"flare":1.3,"bole_ratio":0.28,"base_size":0.3,"curve_deg":3,"curve_var_deg":4,"segments":8,"lean_deg":3,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.03,"split_count":2,"split_angle_deg":10,"split_height":0.75,"bark_rgb":[104,86,72],"bark_pattern":"furrowed","twig_rgb":[96,82,70],"stubs":{"count":[6,14],"length_m":0.6,"radius_ratio":0.1},"bark":{"tile_m":[0.7,1.4],"ridge_m":0.1,"block_m":0.3,"fissure":0.85,"contrast":1.25,"lichen":0.15,"relief":1.7}},"crown":{"shape":"conical","envelope":{"profile":[[0.3,0.2],[0.42,0.25],[0.55,0.25],[0.68,0.22],[0.8,0.16],[0.9,0.1],[1.0,0.02]],"lobes":4,"lobe_depth":0.12,"asymmetry":0.1,"fill":0.25,"edge":1.1}},"levels":[{"count":30,"whorl":4,"down_angle_deg":94,"down_angle_tip_deg":55,"down_angle_var_deg":12,"rotation_deg":37,"rotation_var_deg":25,"length_ratio":0.32,"length_var":0.25,"curve_deg":0,"curve_var_deg":14,"tropism":0.0,"droop_deg":30,"upturn_deg":25,"taper":0.95,"radius_ratio":0.3,"segments":3},{"count":10,"start":0.2,"down_angle_deg":60,"down_angle_var_deg":15,"rotation_deg":-80,"rotation_var_deg":20,"length_ratio":0.4,"length_var":0.3,"curve_deg":0,"curve_var_deg":12,"tropism":-0.1,"droop_deg":15,"taper":1.0,"radius_ratio":0.5,"segments":2}],"foliage":{"type":"needle","leaf_size_m":0.025,"leaf_shape":"needle_flat","cluster_m":2.6,"density":18,"leaf_fill":5.0,"start":0.15,"parent_start":0.35,"orientation":"along","needle_planes":1,"tuft_spread_deg":25,"tuft_up":0.0,"droop":0.4,"needle_normal":0.5,"needle_wrap":0.4,"translucency":2.2,"needle_scatter":0.15,"colors":{"winter":[86,90,73],"spring":[104,114,76],"summer":[90,94,78],"fall":[88,92,73]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":40,"clumps":{"radius_m":1.2,"cards_per_clump":4,"shell":0,"flatten":0.7,"tip_bias":1.5},"palette":[[0.88,[1,1,1]],[0.12,[1.18,1.24,0.88]]],"ao_min":0.68,"color_var":[0.07,0.03]},"deadwood":{"fraction":0.18,"where":"lower","levels":[1],"shorten":0.6,"rgb":[128,118,106]},"twigs":{"count":[1,2],"length":0.6,"down_deg":50,"down_var_deg":12,"tropism":-0.2,"segments":1,"radius_m":0.008,"taper":0.5,"fan_deg":30,"jitter":0.08},"lod":{"near_tris_budget":3000,"near_sides":[6,3,0],"mid_blobs":12,"mid_branches":2,"mid_blob_scale":0.55,"close_factor":2,"mid_planes":1,"mid_cards":48,"mid_canopy":"blobs"},"targets":{"crown_width_ratio":0.5,"crown_base_ratio":0.3,"porosity":0.3,"foliage_rg":0.91,"foliage_bg":0.61,"from":"reference photographs (2026-10-25, measured as in docs/tree-likeness-review.md, colour from the eroded crown mask), all open-grown: lakeside tree W/H 0.58 base 0.09 porosity 0.32 r/g 0.86 b/g 0.82 (Commons Clark_Lake_Park_in_Kent,_Washington_-_29.jpg, Roc0ast3r, CC0); young open tree W/H 0.77 base 0.03 porosity 0.31 r/g 0.96 b/g 0.34 (Commons Pseudotsuga_menziesii_28021.JPG, Walter Siegmund, CC BY 2.5); Mill Valley W/H 0.66 base 0.10 porosity 0.28 r/g 0.74 b/g 0.78 (iNaturalist 286768055, Christine Rudman, CC0); Windy Hill W/H at least 0.76 (cropped) base 0.04 porosity 0.17 r/g 0.96 b/g 0.44 (iNaturalist 169946616, er-birds, CC BY). Porosity and colour are medians. W/H 0.5 and crown base 0.3 are NOT the photo medians (0.66 and 0.07): the trees here stand in mixed conifer stands on north slopes, where the crown is narrower and the lower limbs die (FEIS: old trees in stands carry a narrow crown above a long clear bole); no clean sky silhouette of a stand-grown Sierra tree was found. Form reference, not measured (hazy cliff background): Yosemite Valley, iNaturalist 436296605, Siddarth Machado, CC BY","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Clark_Lake_Park_in_Kent,_Washington_-_29.jpg","license":"CC0","author":"Roc0ast3r","shows":"tall open tree with drooping limbs, lakeside"},{"url":"https://commons.wikimedia.org/wiki/File:Pseudotsuga_menziesii_28021.JPG","license":"CC BY 2.5","author":"Walter Siegmund","shows":"young open-grown tree, broad cone to the ground"},{"url":"https://www.inaturalist.org/photos/286768055","license":"CC0","author":"Christine Rudman","shows":"dense tree over a fire road, Mill Valley, June"},{"url":"https://www.inaturalist.org/photos/169946616","license":"CC BY 4.0","author":"er-birds","shows":"broad open-grown tree, Windy Hill, November"},{"url":"https://www.inaturalist.org/photos/436296605","license":"CC BY 4.0","author":"Siddarth Machado","shows":"Sierra tree in Yosemite Valley, open crown with drooping limbs"}]},"license":"CC BY-SA 4.0"},
  "heteromeles_arbutifolia": {"id":"heteromeles_arbutifolia","aliases":["toyon","christmas_berry"],"scientific":"Heteromeles arbutifolia","common":"toyon","form":"multi_stem_shrub_tree","architectural_model":"Leeuwenberg (provisional: sympodial, each shoot ends in a flower cluster)","deciduous":false,"height_m":[2.5,5],"variants":[{"name":"young","weight":0.25,"height_m":[1,2.5],"trunk_radius":0.7,"crown_scale":0.92,"branches":0.8,"set":{"trunk":{"stems":[2,4]}},"note":"a dense, rounded young shrub, leafy to the ground"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a big rounded shrub of three to six grey stems"},{"name":"old","weight":0.25,"height_m":[4,6],"trunk_radius":1.25,"crown_scale":1.06,"gnarl":1.15,"deadwood":{"fraction":0.15,"levels":[1,2],"where":"inner","rgb":[138,134,126]},"set":{"trunk":{"stems":[3,5],"stem_spread_deg":18}},"note":"a small tree of a few leaning grey trunks at an oak woodland edge, some dead limbs inside"}],"description":"A big evergreen shrub or small tree with stiff, shiny dark green leaves that have saw-toothed edges, and bunches of bright red berries in winter; 2-6 m tall here. It grows on chaparral slopes and along the edges of the oak woodland, and its berries feed robins, cedar waxwings, mockingbirds and bluebirds through the coldest months, which is why it is also called Christmas berry.","season_notes":{"winter":"Covered in bright red berries (November to January), the 'Christmas berry'; flocks of robins and cedar waxwings come to eat them.","spring":"New shoots come in pale and reddish; the old leaves stay on, so it is green all year.","summer":"Flat bunches of small white flowers open in June, buzzing with bees; then green berries start to swell.","fall":"The berries turn from green to orange to red as the first rains come."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.05,"oak_woodland":1.0,"chaparral":0.9,"mixed_forest":0.5,"conifer_forest":0.1,"riparian":0.3},"floor":0.8,"mid":1.0,"steep":1.2,"north":1.1,"shade":0.4,"disturbed":0.7},"relations":{"eaten_by":[{"animal":"aphelocoma_californica","part":"berries","seasons":["fall","winter"]},{"animal":"callipepla_californica","part":"berries","seasons":["fall","winter"]},{"animal":"ursus_americanus","part":"berries","seasons":["fall","winter"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["fall","winter"]},{"animal":"canis_latrans","part":"berries","seasons":["fall","winter"]},{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring","summer","fall"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.72,"radius_ratio":0.024,"taper":0.75,"flare":1.35,"bole_ratio":0.06,"base_size":0.02,"curve_deg":14,"curve_var_deg":14,"segments":3,"lean_deg":8,"stems":[3,6],"stem_spread_deg":22,"split_prob":0.15,"split_count":2,"split_angle_deg":22,"sinuous_deg":6,"bark_rgb":[122,116,108],"bark_pattern":"smooth_grey","twig_rgb":[124,92,78],"bark":{"tile_m":[0.2,0.4],"contrast":0.5,"lichen":0.35,"relief":0.4}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.42],[0.1,0.56],[0.3,0.64],[0.5,0.67],[0.68,0.6],[0.84,0.44],[0.95,0.24],[1.0,0.07]],"lobes":5,"lobe_depth":0.12,"asymmetry":0.15,"fill":0.6,"edge":1.07}},"levels":[{"count":6,"down_angle_deg":68,"down_angle_tip_deg":28,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.75,"length_var":0.3,"curve_deg":14,"curve_var_deg":16,"tropism":0.06,"taper":0.9,"radius_ratio":0.5,"segments":2,"zigzag_deg":6},{"count":5,"start":0.25,"down_angle_deg":40,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":12,"curve_var_deg":16,"tropism":0.06,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.08,"leaf_shape":"elliptic_glossy","cluster_m":0.75,"density":18,"cards_per_m2":3.0,"start":0.05,"parent_start":0.25,"orientation":"outward","roll_deg":50,"colors":{"winter":[94,104,80],"spring":[112,120,86],"summer":[100,108,83],"fall":[98,105,80]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.45,"cards_per_clump":7,"shell":0.3,"flatten":0.8,"tip_bias":1.3},"palette":[[0.86,[1,1,1]],[0.09,[1.3,1.2,0.72]],[0.05,[1.4,0.92,0.7]]],"ao_min":0.76,"color_var":[0.07,0.03],"flowers":{"season":"summer","months":[6,7],"form":"cluster","rgb":[232,228,206],"size_m":0.12,"density":0.35,"before_leaves":false},"berries":{"season":["fall","winter"],"months":[11,1],"form":"cluster","rgb":[214,40,32],"size_m":0.1,"density":0.45}},"twigs":{"count":[2,3],"length":0.6,"down_deg":45,"down_var_deg":15,"curve_var_deg":20,"zigzag_deg":12,"segments":1,"radius_m":0.006,"fan_deg":55,"jitter":0.22},"lod":{"near_tris_budget":1200,"near_sides":[3,3,0],"mid_blobs":4,"mid_branches":2,"mid_sides":[3,3],"mid_segments":[2,1],"mid_cards":40},"targets":{"crown_width_ratio":1.1,"crown_base_ratio":0.1,"porosity":0.15,"foliage_rg":0.86,"foliage_bg":0.58,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H 1.1 (Foresthill shrub, iNaturalist 668181503), 0.88 (shrub-tree, Hidden Falls, 249604228), 1.5 (rounded shrub with berries, Auburn SRA, 203053), 0.9 (dense shrub, 428160041, cropped at the sides); crown base 0.05-0.2; colour r/g 0.83 / 0.72 / 1.03, b/g 0.59 / 0.66 / 0.54 (668181503, 428160041, 249604228); berries mean sRGB (162, 80, 59) on 243990667, blended with leaves (the berries are brighter scarlet); flowers (212, 212, 180) on 675618534","photos":[{"url":"https://www.inaturalist.org/photos/249604228","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"shrub-tree form in a clearing, Hidden Falls Regional Park, Placer County, December"},{"url":"https://www.inaturalist.org/photos/203053","license":"CC BY","author":"Justin (justin2)","shows":"rounded shrub with ripe berries, Auburn State Recreation Area, November"},{"url":"https://www.inaturalist.org/photos/668181503","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"shrub on a river bench, Tahoe National Forest near Foresthill, May"},{"url":"https://www.inaturalist.org/photos/428160041","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"dense shrub, Hidden Falls Regional Park, September"},{"url":"https://www.inaturalist.org/photos/243990667","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"shrub heavy with red berries, Hidden Falls Regional Park, November"},{"url":"https://www.inaturalist.org/photos/675618534","license":"CC0","author":"Steve Woodward (cnpsstevew)","shows":"flowering crowns against the sky, Mosquito Ridge Road, June"}]},"license":"CC BY-SA 4.0"},
  "cercis_occidentalis": {"id":"cercis_occidentalis","aliases":["redbud","western_redbud"],"scientific":"Cercis occidentalis","common":"western redbud","form":"shrub","architectural_model":"Troll (provisional: plagiotropic shoots that turn up at their base; redbud flowers on old wood)","deciduous":true,"height_m":[2.5,5],"variants":[{"name":"young","weight":0.25,"height_m":[1.2,2.5],"crown_scale":0.85,"branches":0.8,"set":{"trunk":{"stems":[3,6],"stem_spread_deg":22}},"note":"a narrow vase of a few straight wands"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a many-stemmed vase spreading into a broad top"},{"name":"old","weight":0.25,"height_m":[4,6],"trunk_radius":1.2,"crown_scale":1.12,"gnarl":1.15,"deadwood":{"fraction":0.15,"levels":[0,1],"shorten":0.8},"set":{"trunk":{"stems":[6,11]}},"note":"a big spreading clump, a few grey dead stems among the live ones"}],"description":"A many-stemmed shrub or small tree with round, heart-shaped leaves; in March, before its leaves come out, its bare branches are covered in bright magenta-pink flowers; 2-6 m tall here. It grows on dry canyon slopes, rocky banks and road cuts in the foothills, and the flowers are an early meal for bees, while the hanging seed pods stay on the branches through the winter.","season_notes":{"winter":"Bare grey-brown branches hung with flat, brown seed pods; by late February the flower buds swell along the twigs.","spring":"In March the bare branches turn magenta with flowers, then round, heart-shaped leaves unfold, shiny and bronze-green.","summer":"Thick blue-green leaves and bunches of flat purple-red seed pods.","fall":"Leaves turn yellow, orange and red-brown and drop by December; the pods turn brown and stay."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.05,"oak_woodland":0.7,"chaparral":0.8,"mixed_forest":0.3,"conifer_forest":0.02,"riparian":0.4},"floor":0.6,"mid":1.0,"steep":1.6,"north":0.9,"shade":0.2,"disturbed":0.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["fall","winter"]}],"cover_for":[]},"trunk":{"length_ratio":0.88,"radius_ratio":0.018,"taper":0.8,"flare":1.35,"bole_ratio":0.08,"base_size":0.15,"curve_deg":8,"curve_var_deg":10,"segments":3,"lean_deg":0,"stems":[5,9],"stem_spread_deg":34,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":4,"bark_rgb":[126,112,104],"bark_pattern":"smooth","twig_rgb":[122,82,70],"bark":{"tile_m":[0.15,0.4],"contrast":0.55,"lichen":0.2,"relief":0.4}},"crown":{"shape":"inverse_conical","envelope":{"profile":[[0.0,0.15],[0.2,0.33],[0.4,0.51],[0.6,0.64],[0.78,0.68],[0.9,0.57],[1.0,0.3]],"lobes":5,"lobe_depth":0.14,"asymmetry":0.15,"fill":0.45,"edge":1.08}},"levels":[{"count":4,"start":0.12,"down_angle_deg":38,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.3,"curve_deg":10,"curve_var_deg":14,"tropism":0.04,"taper":0.9,"radius_ratio":0.55,"segments":2,"zigzag_deg":8},{"count":4,"start":0.3,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":-70,"rotation_var_deg":25,"length_ratio":0.45,"length_var":0.25,"curve_deg":8,"curve_var_deg":16,"tropism":0.0,"taper":1.0,"radius_ratio":0.5,"segments":1,"zigzag_deg":12}],"foliage":{"type":"broadleaf","leaf_size_m":0.075,"leaf_shape":"cordate","cluster_m":0.55,"density":18,"cards_per_m2":3.2,"start":0.15,"parent_start":0.35,"orientation":"outward","roll_deg":60,"colors":{"winter":[120,98,90],"spring":[124,140,84],"summer":[107,118,93],"fall":[156,116,80]},"leaf_on":{"winter":0.0,"spring":0.3,"summer":1.0,"fall":0.7},"leaf_on_by_month":[0.0,0.0,0.0,0.3,0.9,1.0,1.0,1.0,0.95,0.8,0.4,0.05],"clumps":{"radius_m":0.4,"cards_per_clump":6,"shell":0.35,"flatten":0.75,"tip_bias":1.2},"palette":[[0.85,[1,1,1]],[0.15,[1.08,1.05,1.12]]],"winter_twigs":0.4,"ao_min":0.72,"color_var":[0.08,0.04],"leaf_on_var":0.4,"flowers":{"season":"spring","months":[2,4],"form":"cluster","rgb":[212,96,176],"size_m":0.03,"density":0.85,"before_leaves":true},"catkins":{"rgb":[128,92,72],"len_m":0.07,"width":0.35,"hang":true,"prob":0.3}},"deadwood":{"fraction":0.08,"levels":[0],"shorten":0.8,"rgb":[136,130,122]},"twigs":{"count":[1,2],"length":0.7,"down_deg":40,"down_var_deg":15,"zigzag_deg":22,"curve_var_deg":20,"segments":2,"radius_m":0.006,"taper":0.6,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":1100,"near_sides":[4,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[3,0],"mid_cards":36},"targets":{"crown_width_ratio":1.0,"crown_base_ratio":0.2,"porosity":0.25,"foliage_rg":0.83,"foliage_bg":0.61,"fall_rg":1.5,"fall_bg":0.56,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H 0.8 (bare vase, Shingle Springs, iNaturalist 248660991), 1.1 (flowering, Hidden Falls, 268275595), 1.1 (flowering small tree, Salmon Falls Road, El Dorado Hills, 477127567); crown base 0.2-0.25; summer colour r/g 0.83, b/g 0.61 (233824613, one photo: rough); fall r/g 1.30 and 1.75, b/g 0.50 and 0.62 (731687737, 321263517); flower pixels mean sRGB (169, 119, 153) and (155, 113, 137) (621650374, 268275595), blended with twigs: the flowers themselves are a deeper magenta","photos":[{"url":"https://www.inaturalist.org/photos/248660991","license":"CC BY","author":"Alexander Wentworth (alex_wentworth)","shows":"bare many-stemmed vase, Shingle Springs, December"},{"url":"https://www.inaturalist.org/photos/477127567","license":"CC0","author":"Kristy Moon (kristy218)","shows":"flowering small tree on bare wood, Salmon Falls Road, El Dorado Hills, March"},{"url":"https://www.inaturalist.org/photos/268275595","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"flowering clump under oaks, Hidden Falls Regional Park, April"},{"url":"https://www.inaturalist.org/photos/621650374","license":"CC BY","author":"Adam J. Searcy (serpophaga)","shows":"flowering among chaparral, Cameron Park, March"},{"url":"https://www.inaturalist.org/photos/233824613","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"blue-green summer leaves, Hidden Falls Regional Park, September"},{"url":"https://www.inaturalist.org/photos/731687737","license":"CC0","author":"Leah Gardner (grnleaf)","shows":"fall leaves and pods, Marshall Gold Discovery State Historic Park, Coloma, September"},{"url":"https://www.inaturalist.org/photos/321263517","license":"CC0","author":"Juli Ann Lingenberg (radagast_97)","shows":"red-brown fall leaves, Pilot Hill, September"}]},"license":"CC BY-SA 4.0"},
  "toxicodendron_diversilobum": {"id":"toxicodendron_diversilobum","aliases":["poison_oak","pacific_poison_oak"],"scientific":"Toxicodendron diversilobum","common":"Pacific poison oak","form":"shrub","architectural_model":"Rauh (provisional: a shrub of upright shoots; it is also a climbing vine on tree trunks, which the generator does not draw)","deciduous":true,"height_m":[1,2.5],"variants":[{"name":"low","weight":0.3,"height_m":[0.3,0.9],"branches":0.7,"set":{"trunk":{"stems":[1,3],"stem_spread_deg":30}},"note":"a low patch of a few leafy shoots in the grass or leaf litter"},{"name":"mature","weight":0.45,"seeds":1,"note":"the file as written: an open shrub of upright, leaning stems"},{"name":"thicket","weight":0.25,"height_m":[1.8,3],"crown_scale":1.2,"gnarl":1.2,"deadwood":{"fraction":0.2,"levels":[0,1],"shorten":0.7},"set":{"trunk":{"stems":[6,11],"stem_spread_deg":34}},"note":"an old colony of many leaning stems, a few dead ones grey inside"}],"description":"A shrub of thin, upright stems, or a vine that climbs high up oak trunks, with leaves in threes that are shiny green in spring and turn bright red in fall; 1-3 m tall as a shrub here. It grows everywhere under and around the oaks, and every child in the foothills learns the rhyme 'leaves of three, let it be': its oil gives people an itchy rash, so it is not to be touched, even when the branches are bare, though deer browse it and birds eat its white berries.","season_notes":{"winter":"Bare grey stems with no leaves, and it can still give you a rash, so do not touch any bare stems you are not sure about.","spring":"New leaves in threes come out shiny and red-tinged in March, then turn bright green; small greenish-white flowers hang in April. Leaves of three, let it be!","summer":"Glossy green leaves of three; in dry spots some leaves already turn red and drop early. Tiny white berries ripen in hanging bunches.","fall":"The brightest red in the woodland: whole patches turn scarlet, orange and yellow before the leaves drop in November."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.15,"oak_woodland":1.0,"chaparral":0.5,"mixed_forest":0.7,"conifer_forest":0.3,"riparian":0.8},"floor":1.4,"mid":1.0,"steep":0.9,"north":1.2,"shade":0.6,"disturbed":1.0},"relations":{"eaten_by":[{"animal":"callipepla_californica","part":"berries","seasons":["fall","winter"]},{"animal":"meleagris_gallopavo","part":"berries","seasons":["fall","winter"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["fall","winter"]},{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer","fall"]},{"animal":"sylvilagus_bachmani","part":"browse","seasons":["spring","summer"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.9,"radius_ratio":0.012,"taper":0.85,"flare":1.2,"bole_ratio":0.08,"base_size":0.15,"curve_deg":10,"curve_var_deg":16,"segments":3,"lean_deg":10,"stems":[3,7],"stem_spread_deg":28,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":6,"bark_rgb":[118,106,94],"bark_pattern":"smooth","twig_rgb":[130,100,82],"bark":{"tile_m":[0.1,0.3],"contrast":0.45,"lichen":0.15,"relief":0.3}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.14],[0.2,0.28],[0.45,0.42],[0.65,0.5],[0.82,0.48],[0.94,0.34],[1.0,0.12]],"lobes":4,"lobe_depth":0.18,"asymmetry":0.2,"fill":0.4,"edge":1.12}},"levels":[{"count":7,"start":0.12,"down_angle_deg":40,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":35,"length_ratio":0.32,"length_var":0.35,"curve_deg":10,"curve_var_deg":18,"tropism":0.05,"taper":0.95,"radius_ratio":0.55,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.1,"leaf_shape":"trifoliate","cluster_m":0.45,"density":16,"cards_per_m2":3,"start":0.0,"parent_start":0.2,"orientation":"outward","roll_deg":50,"colors":{"winter":[122,110,98],"spring":[138,122,84],"summer":[112,128,90],"fall":[168,84,60]},"leaf_on":{"winter":0.0,"spring":0.9,"summer":1.0,"fall":0.7},"leaf_on_by_month":[0.0,0.05,0.4,0.9,1.0,1.0,1.0,0.95,0.9,0.75,0.25,0.0],"clumps":{"radius_m":0.3,"cards_per_clump":5,"shell":0.4,"flatten":0.8,"tip_bias":1.3},"palette":[[0.85,[1,1,1]],[0.15,[1.12,1.1,0.88]]],"winter_twigs":0.4,"ao_min":0.72,"color_var":[0.1,0.06],"leaf_on_var":0.6,"flowers":{"season":"spring","months":[4,5],"form":"cluster","rgb":[214,212,172],"size_m":0.06,"density":0.1,"before_leaves":false},"berries":{"season":"fall","months":[8,11],"form":"cluster","rgb":[214,202,164],"size_m":0.06,"density":0.15}},"deadwood":{"fraction":0.06,"levels":[0],"shorten":0.75,"rgb":[138,130,120]},"twigs":{"count":[1,2],"length":0.7,"down_deg":38,"down_var_deg":14,"curve_var_deg":20,"segments":1,"radius_m":0.005,"taper":0.6,"fan_deg":50,"jitter":0.22},"lod":{"near_tris_budget":1000,"near_sides":[3,3],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":20},"targets":{"crown_width_ratio":0.8,"crown_base_ratio":0.15,"porosity":0.35,"foliage_rg":0.75,"foliage_bg":0.47,"fall_rg":1.6,"fall_bg":0.55,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H 0.55 (open upright shrub in grass, Hidden Falls, iNaturalist 367433680), 0.85 (leafy clump, Granite Bay, 273430080), about 1.0 (low clump, Lake Clementine, 490694901), about 0.6 (tall open shrub, Wikimedia Commons 'Another tall poison oak'); thickets merge (Commons, Wildcat Canyon 5 and 6); porosity rough (open, sky and grass through the stems); summer colour r/g 0.74 / 0.72 / 0.77, b/g 0.45 / 0.47 / 0.77 (273430080, 367433680, Wildcat Canyon 6 in shade); fall is rough: no clean full-shrub fall photograph was measured, the red-leaf pixels of Wildcat Canyon 5 are sRGB (205, 110, 133) and the whole patch with its green leaves r/g 1.08","photos":[{"url":"https://www.inaturalist.org/photos/367433680","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"upright open shrub in grassland, Hidden Falls Regional Park, April"},{"url":"https://www.inaturalist.org/photos/273430080","license":"CC BY","author":"Ian (chaparral_pal)","shows":"leafy clump with red-tinged new shoots, Granite Bay, April"},{"url":"https://www.inaturalist.org/photos/490694901","license":"CC BY","author":"Katy Swiere (katyswiere)","shows":"low glossy clump, Lake Clementine Trail, Auburn, April"},{"url":"https://www.inaturalist.org/photos/367436699","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"vine form climbing an oak trunk, Hidden Falls Regional Park, April"},{"url":"https://www.inaturalist.org/photos/36306731","license":"CC0","author":"Sarah Angulo (sarahangulo)","shows":"vine on a trunk, Cold Springs Road, Placerville, April"},{"url":"https://commons.wikimedia.org/wiki/File:Another_tall_poison_oak.JPG","license":"CC BY-SA 3.0","author":"Jcomeau ictx","shows":"tall open shrub of upright stems"},{"url":"https://commons.wikimedia.org/wiki/File:Toxicodendron_diversilobum_Wildcat_Canyon_preserve_5.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"shrub thicket turning red in fall"},{"url":"https://commons.wikimedia.org/wiki/File:Toxicodendron_diversilobum_Wildcat_Canyon_preserve_6.jpg","license":"CC BY 4.0","author":"Awinch1001","shows":"green thicket under oaks"}]},"license":"CC BY-SA 4.0"},
  "baccharis_pilularis": {"id":"baccharis_pilularis","aliases":["coyote_brush","coyote_bush"],"scientific":"Baccharis pilularis","common":"coyote brush","form":"shrub","architectural_model":"Leeuwenberg (provisional: much-branched, flowers at the shoot ends)","deciduous":false,"height_m":[1,2.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.5,1.2],"deadwood":0.03,"set":{"trunk":{"stems":[5,9]}},"note":"a low, bright green mound on a road edge or in grassland"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a dense, rounded, many-stemmed mound"},{"name":"decadent","weight":0.25,"height_m":[1.8,3],"crown_scale":1.1,"gnarl":1.15,"leaf_density":0.8,"deadwood":{"fraction":0.35,"levels":[0,1],"shorten":0.8},"set":{"trunk":{"stems":[10,18]}},"note":"an old, sprawling shrub with a grey, dead middle"}],"description":"A rounded, bushy evergreen shrub covered in small, bright green, slightly sticky leaves with a few teeth; 1-3 m tall here. It is one of the first shrubs to move into grassland, old fields, road edges and burned ground, giving shelter to quail and rabbits, and in fall it is busy with butterflies and bees when little else is in flower.","season_notes":{"winter":"Female plants are white and fluffy with seeds that blow away on the wind; after the rains the leaves are dark and shiny.","spring":"Fresh, bright green new shoots; one of the greenest shrubs on the hills.","summer":"Still green through the dry season, a little dusty, while the grass around it turns gold.","fall":"Covered in tiny cream flowers (August to December), full of bees, flies and butterflies."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.8,"oak_woodland":0.6,"chaparral":0.4,"mixed_forest":0.1,"conifer_forest":0.0,"riparian":0.3},"floor":1.3,"mid":1.0,"steep":0.7,"north":1.0,"shade":0.1,"disturbed":1.8},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.9,"radius_ratio":0.015,"taper":0.85,"flare":1.4,"bole_ratio":0.05,"base_size":0.04,"curve_deg":10,"curve_var_deg":16,"segments":3,"lean_deg":0,"stems":[8,14],"stem_spread_deg":54,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":8,"bark_rgb":[112,100,86],"bark_pattern":"shreddy","twig_rgb":[116,114,84],"bark":{"tile_m":[0.1,0.35]}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.42],[0.15,0.6],[0.35,0.73],[0.55,0.74],[0.75,0.62],[0.9,0.42],[1.0,0.16]],"lobes":6,"lobe_depth":0.12,"asymmetry":0.12,"fill":0.6,"edge":1.08}},"levels":[{"count":4,"start":0.05,"down_angle_deg":51,"down_angle_var_deg":8,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":14,"curve_var_deg":16,"tropism":0.05,"taper":0.9,"radius_ratio":0.6,"segments":1,"droop_deg":3},{"count":5,"start":0.25,"down_angle_deg":32,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.4,"length_var":0.3,"curve_deg":10,"curve_var_deg":18,"tropism":0.1,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.022,"leaf_shape":"oval","cluster_m":0.34,"density":24,"cards_per_m2":13.5,"start":0.01,"parent_start":0.01,"orientation":"outward","colors":{"winter":[106,118,80],"spring":[118,140,80],"summer":[120,124,88],"fall":[120,122,90]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.25,"cards_per_clump":6,"shell":0.02,"flatten":0.85,"tip_bias":0.7},"ao_min":0.74,"color_var":[0.08,0.05],"flowers":{"season":"fall","months":[9,12],"form":"cluster","rgb":[236,232,212],"size_m":0.04,"density":0.5,"before_leaves":false}},"deadwood":{"fraction":0.12,"levels":[0,1],"shorten":0.75,"rgb":[138,132,124]},"twigs":{"count":[2,3],"length":0.7,"down_deg":30,"down_var_deg":14,"curve_var_deg":22,"segments":1,"radius_m":0.004,"tropism":0.1,"taper":0.6,"fan_deg":50,"jitter":0.25},"lod":{"near_tris_budget":1000,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.05,"porosity":0.2,"foliage_rg":0.95,"foliage_bg":0.48,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H at least 1.2 (mound on a road cut, Hidden Falls, iNaturalist 251772470, cropped at the right), about 1.2 (sprawling shrub, 432534918); foliage nearly to the ground (crown base 0.05); colour r/g 1.01 / 0.98 / 1.17, b/g 0.48 / 0.55 / 0.44 in January and September (251772470, 432534918, 429231064; the last includes dry grass) and 0.70 / 0.33 for fresh April growth (486802583); fluffy female seed heads sRGB (222, 217, 171) in December (603728962)","photos":[{"url":"https://www.inaturalist.org/photos/251772470","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"rounded mound on a road cut below a grassy slope, Hidden Falls Regional Park, January"},{"url":"https://www.inaturalist.org/photos/432534918","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"sprawling shrub with dead lower stems, Hidden Falls Regional Park, September"},{"url":"https://www.inaturalist.org/photos/429231064","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"shrubs in an oak woodland opening, Hidden Falls Regional Park, September"},{"url":"https://www.inaturalist.org/photos/486802583","license":"CC BY","author":"Amelia Tauber (antrozousamelia)","shows":"bright green spring growth on a river bank, Foresthill, April"},{"url":"https://www.inaturalist.org/photos/603728962","license":"CC BY","author":"Nathan Odgers (crellow)","shows":"female shrub white with seed fluff, Auburn, December"}]},"license":"CC BY-SA 4.0"},
  "sambucus_nigra_caerulea": {"id":"sambucus_nigra_caerulea","aliases":["elderberry","blue_elderberry","sambucus_mexicana","sambucus_cerulea"],"scientific":"Sambucus nigra ssp. caerulea","common":"blue elderberry","form":"multi_stem_shrub_tree","architectural_model":"Champagnat (provisional: erect shoots that arch over under their own weight, new erect shoots from the arch and the base)","deciduous":true,"height_m":[3,6],"variants":[{"name":"young","weight":0.25,"height_m":[1.5,3],"trunk_radius":0.7,"crown_scale":0.75,"branches":0.75,"set":{"trunk":{"stems":[3,5],"stem_spread_deg":16}},"note":"a few fast, upright green stems"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a broad clump of arching stems"},{"name":"old","weight":0.25,"height_m":[5,7],"trunk_radius":1.3,"crown_scale":1.1,"gnarl":1.2,"deadwood":{"fraction":0.25,"levels":[1,2],"where":"inner","rgb":[140,134,124]},"set":{"trunk":{"stems":[5,9]}},"note":"a big old clump with thick corky trunks and many grey dead canes"}],"description":"A big, many-stemmed shrub or small tree with arching branches, leaves made of five to nine long, toothed leaflets, flat plates of cream flowers in late spring and heavy bunches of powder-blue berries in late summer; 3-6 m tall here. It grows along creeks, in oak woodland openings and on canyon slopes, its berries feed many birds, and in the foothills and the valley below it is the only home of the valley elderberry longhorn beetle, a threatened insect whose larvae live inside the stems.","season_notes":{"winter":"Bare, pale grey-brown stems; at low elevations a few leaves can stay on, and new shoots start in February.","spring":"Fast new growth and, from late April, flat cream flower plates as wide as a dinner plate.","summer":"Heavy bunches of small berries ripen dusty powder-blue (July to September); birds and bears eat them. In a dry summer some leaves yellow early.","fall":"Leaves turn yellow and drop; the stems that fruited may die back."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.15,"oak_woodland":0.6,"chaparral":0.15,"mixed_forest":0.5,"conifer_forest":0.3,"riparian":1.0},"floor":1.6,"mid":1.0,"steep":0.6,"north":1.3,"shade":0.35,"disturbed":1.1},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"berries","seasons":["summer","fall"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["summer","fall"]},{"animal":"canis_latrans","part":"berries","seasons":["summer","fall"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["summer","fall"]},{"animal":"meleagris_gallopavo","part":"berries","seasons":["summer","fall"]},{"animal":"callipepla_californica","part":"berries","seasons":["summer","fall"]},{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer"]}],"cover_for":["callipepla_californica"]},"trunk":{"length_ratio":0.8,"radius_ratio":0.025,"taper":0.75,"flare":1.3,"bole_ratio":0.06,"base_size":0.14,"curve_deg":16,"curve_var_deg":14,"segments":3,"lean_deg":10,"stems":[5,10],"stem_spread_deg":62,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":5,"bark_rgb":[124,114,100],"bark_pattern":"furrowed","twig_rgb":[124,124,96],"bark":{"tile_m":[0.2,0.45],"ridge_m":0.012,"block_m":0.035,"fissure":0.35,"contrast":0.55,"lichen":0.2,"relief":0.6}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.66],[0.12,0.74],[0.3,0.92],[0.5,0.97],[0.68,0.9],[0.84,0.67],[0.95,0.36],[1.0,0.11]],"lobes":6,"lobe_depth":0.15,"asymmetry":0.18,"fill":1.0,"edge":1.1}},"levels":[{"count":6,"down_angle_deg":55,"down_angle_tip_deg":32,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.9,"length_var":0.3,"curve_deg":10,"curve_var_deg":14,"tropism":0.02,"taper":0.9,"radius_ratio":0.5,"segments":2,"droop_deg":8},{"count":5,"start":0.22,"down_angle_deg":45,"down_angle_var_deg":12,"rotation_deg":-90,"rotation_var_deg":20,"length_ratio":0.45,"length_var":0.3,"curve_deg":8,"curve_var_deg":14,"tropism":0.0,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.22,"leaflet_m":0.09,"leaf_shape":"pinnate_compound","cluster_m":0.95,"density":14,"cards_per_m2":1.2,"start":0.02,"parent_start":0.18,"orientation":"outward","roll_deg":60,"colors":{"winter":[126,114,100],"spring":[124,145,84],"summer":[113,122,92],"fall":[150,140,90]},"leaf_on":{"winter":0.05,"spring":1.0,"summer":0.9,"fall":0.5},"leaf_on_by_month":[0.05,0.15,0.6,0.95,1.0,1.0,0.95,0.9,0.8,0.6,0.3,0.1],"clumps":{"radius_m":0.49,"cards_per_clump":7,"shell":0.25,"flatten":0.85,"tip_bias":0.6},"palette":[[0.85,[1,1,1]],[0.1,[1.08,1.06,1.14]],[0.05,[1.3,1.22,0.75]]],"winter_twigs":0.45,"ao_min":0.7,"color_var":[0.08,0.05],"leaf_on_var":0.5,"flowers":{"season":"spring","months":[4,6],"form":"cluster","rgb":[232,228,192],"size_m":0.2,"before_leaves":false,"per_card":5},"berries":{"season":"summer","months":[7,9],"form":"cluster","rgb":[142,154,178],"size_m":0.15,"density":0.4}},"twigs":{"count":[2,3],"length":0.6,"down_deg":40,"down_var_deg":14,"curve_var_deg":16,"segments":1,"radius_m":0.008,"droop_deg":8,"fan_deg":45,"jitter":0.2},"lod":{"near_tris_budget":1300,"near_sides":[4,3,0],"mid_blobs":4,"mid_branches":3,"mid_sides":[3,3],"mid_segments":[2,1],"mid_cards":48},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.08,"porosity":0.22,"foliage_rg":0.86,"foliage_bg":0.56,"fall_rg":1.15,"fall_bg":0.5,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H 1.55 (lone mature shrub, Wikimedia Commons 'Sambucus cerulea 8154'), at least 1.7 (mature shrub in bloom, Commons 'Blue Elderberry in Bloom', cropped), about 1.5 (Kings Canyon, Commons kz14), 0.75 (young upright clump in bloom, Newcastle, iNaturalist 282650159); crown base 0.05-0.1; colour r/g 0.84 / 0.89 / 0.86 / 0.79 / 0.94, b/g 0.48 / 0.81 / 0.43 / 0.60 / 0.63 (the same Commons photos and iNaturalist 282650159, 4326657); berries sRGB (153, 157, 175) on iNaturalist 226286989 (Ice House Road, El Dorado County); flowers (203, 212, 185) blended with leaves; fall colour is rough (no fall photograph measured)","photos":[{"url":"https://commons.wikimedia.org/wiki/File:Sambucus_cerulea_8154.jpg","license":"CC BY-SA 4.0","author":"Walter Siegmund","shows":"lone mature shrub in flower, clean outline"},{"url":"https://commons.wikimedia.org/wiki/File:Blue_Elderberry_in_Bloom.jpg","license":"CC0","author":"Z3lvs","shows":"broad mature shrub in bloom, Iodine Springs Reserve, Wildomar"},{"url":"https://commons.wikimedia.org/wiki/File:Sambucus_cerulea_kz14.jpg","license":"CC BY-SA 4.0","author":"Krzysztof Ziarnek, Kenraiz","shows":"big clump on a burned Sierra slope, Kings Canyon"},{"url":"https://www.inaturalist.org/photos/282650159","license":"CC BY","author":"Patrick Wagner (patrickjwagner)","shows":"young upright clump in flower, Newcastle, Placer County, May"},{"url":"https://www.inaturalist.org/photos/4326657","license":"CC0","author":"Erica Krimmel (ekrimmel)","shows":"arching shoots in flower, North Fork American River, June"},{"url":"https://www.inaturalist.org/photos/226286989","license":"CC BY","author":"Mary K. Hanson (simpylmare55)","shows":"powder-blue berries, Ice House Road, El Dorado County, August"}]},"license":"CC BY-SA 4.0"},
  "frangula_californica": {"id":"frangula_californica","aliases":["coffeeberry","california_coffeeberry","rhamnus_californica"],"scientific":"Frangula californica","common":"California coffeeberry","form":"shrub","architectural_model":"Rauh (provisional)","deciduous":false,"height_m":[1.5,3.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.7,1.5],"deadwood":0.03,"set":{"trunk":{"stems":[3,6]}},"note":"a small, rounded young shrub"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a dense rounded shrub, wider than tall"},{"name":"old","weight":0.25,"height_m":[2.5,4],"crown_scale":1.08,"gnarl":1.15,"deadwood":{"fraction":0.18,"levels":[0,1],"shorten":0.8},"set":{"trunk":{"stems":[6,11]}},"note":"a big old shrub, open underneath, a few grey dead stems"}],"description":"A rounded evergreen shrub with smooth grey stems and narrow oval leaves, in the foothills often dusty grey-green with fuzzy undersides; its round berries turn from green to red to shiny black in late summer and fall; 1.5-4 m tall here. It grows on rocky slopes, in chaparral and under open oaks and pines, and its berries, each with two seeds that look like coffee beans, feed band-tailed pigeons, thrushes, jays, foxes and bears.","season_notes":{"winter":"Evergreen and quiet; the leaves look greyest in the low winter light.","spring":"Fresh, paler new leaves, and tiny greenish flowers hidden among them (April to June) that bees visit.","summer":"Green berries begin to turn red, then black, from August.","fall":"Red and shiny black berries hang together on the branches, a fall feast for birds and bears."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.03,"oak_woodland":1.0,"chaparral":0.9,"mixed_forest":0.6,"conifer_forest":0.3,"riparian":0.3},"floor":0.6,"mid":1.0,"steep":1.4,"north":1.1,"shade":0.45,"disturbed":0.6},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"berries","seasons":["fall"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["fall"]},{"animal":"canis_latrans","part":"berries","seasons":["fall"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["fall"]},{"animal":"callipepla_californica","part":"berries","seasons":["fall"]},{"animal":"meleagris_gallopavo","part":"berries","seasons":["fall"]},{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring","summer","fall"]}],"cover_for":[]},"trunk":{"length_ratio":0.8,"radius_ratio":0.022,"taper":0.8,"flare":1.4,"bole_ratio":0.08,"base_size":0.02,"curve_deg":12,"curve_var_deg":14,"segments":3,"lean_deg":0,"stems":[5,9],"stem_spread_deg":58,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":8,"bark_rgb":[118,112,104],"bark_pattern":"smooth_grey","twig_rgb":[130,86,72],"bark":{"tile_m":[0.15,0.35],"contrast":0.5,"lichen":0.3,"relief":0.35}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.56],[0.15,0.8],[0.35,0.97],[0.55,0.98],[0.75,0.82],[0.9,0.54],[1.0,0.17]],"lobes":5,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.6,"edge":1.07}},"levels":[{"count":4,"start":0.05,"down_angle_deg":39,"down_angle_var_deg":8,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.65,"length_var":0.25,"curve_deg":20,"curve_var_deg":14,"tropism":0.08,"taper":0.9,"radius_ratio":0.6,"segments":2,"droop_deg":3},{"count":4,"start":0.3,"down_angle_deg":40,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.25,"curve_deg":15,"curve_var_deg":18,"tropism":0.05,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.06,"leaf_shape":"elliptic_glossy","cluster_m":0.47,"density":22,"cards_per_m2":6.2,"start":0.0,"parent_start":0.03,"orientation":"outward","roll_deg":50,"colors":{"winter":[114,118,102],"spring":[124,132,98],"summer":[120,122,102],"fall":[120,121,101]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.32,"cards_per_clump":6,"shell":0.02,"flatten":0.74,"tip_bias":0.6},"palette":[[0.7,[1,1,1]],[0.25,[1.18,1.18,1.24]],[0.05,[1.35,1.2,0.7]]],"ao_min":0.76,"color_var":[0.08,0.05],"berries":{"season":"fall","months":[8,11],"form":"cluster","rgb":[116,34,32],"size_m":0.05,"density":0.45}},"deadwood":{"fraction":0.08,"where":"inner","levels":[0,1],"shorten":0.7,"rgb":[140,136,128]},"twigs":{"count":[1,2],"length":0.75,"down_deg":40,"down_var_deg":18,"curve_var_deg":25,"segments":1,"radius_m":0.006,"taper":0.6,"fan_deg":55,"jitter":0.22},"lod":{"near_tris_budget":1200,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":32},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.08,"porosity":0.18,"foliage_rg":0.98,"foliage_bg":0.7,"from":"reference photographs (2026-10-25), measured by eye on a 10% grid and colour as linear means of foliage pixels, as in docs/tree-likeness-review.md: W/H 1.67 (rounded shrub, Foresthill, iNaturalist 668177142), at least 1.5 (low grey shrub, Cameron Park, 248658488, cropped); crown base 0.05-0.1; colour r/g 0.94 / 0.97 / 1.03 / 1.07, b/g 0.56 / 0.59 / 0.96 / 0.90 (668177142 and 273552335 in sun; 248658488 and 249275399 in December light, which reads bluer); berries red sRGB (157, 66, 56) and black (47, 34, 15) on 546339235 (Pilot Hill, August)","photos":[{"url":"https://www.inaturalist.org/photos/668177142","license":"CC0","author":"Joshua Zupan (jzupan)","shows":"rounded grey-green shrub on a slope, Tahoe National Forest near Foresthill, May"},{"url":"https://www.inaturalist.org/photos/248658488","license":"CC BY","author":"Alexander Wentworth (alex_wentworth)","shows":"low hoary grey shrub on rocky ground, Cameron Park, December"},{"url":"https://www.inaturalist.org/photos/249275399","license":"CC0","author":"Leah Gardner (grnleaf)","shows":"pale grey felted leaves and grey stems, Pilot Hill, December"},{"url":"https://www.inaturalist.org/photos/546339235","license":"CC BY","author":"Martin Mortensen (mamortensen)","shows":"red and black berries together, Pilot Hill, August"},{"url":"https://www.inaturalist.org/photos/273552335","license":"CC BY","author":"Ian (chaparral_pal)","shows":"greener-leaved shrub against the sky, Folsom Lake, El Dorado Hills, April"}]},"license":"CC BY-SA 4.0"},
  "arctostaphylos_manzanita": {"id":"arctostaphylos_manzanita","aliases":["common_manzanita","big_manzanita"],"scientific":"Arctostaphylos manzanita","common":"common manzanita","form":"shrub","architectural_model":"Leeuwenberg (provisional)","deciduous":false,"height_m":[2,5],"variants":[{"name":"young","weight":0.25,"height_m":[0.8,2],"deadwood":0.04,"set":{"trunk":{"stems":[2,4]}},"note":"a rounded young shrub, red stems hidden in green"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written: a tall, open-based shrub of crooked red stems under a loose green dome"},{"name":"old","weight":0.25,"height_m":[4,6.5],"trunk_radius":1.3,"crown_scale":1.1,"gnarl":1.2,"leaf_density":0.85,"deadwood":{"fraction":0.3,"levels":[0,1,2],"shorten":0.75},"set":{"trunk":{"stems":[3,5],"base_size":0.25}},"note":"a small tree: a few thick, twisting red trunks, bare below, grey dead limbs in the crown"}],"description":"The largest manzanita of the foothills, a crooked shrub or small tree 2-6 m tall with smooth, polished red-brown bark and bright green oval leaves; white to pink urn-shaped flowers hang in clusters from late winter. It grows in chaparral and open oak woodland on the lower slopes, and its mealy red-brown berries feed bears, foxes, coyotes, jays and quail through the summer.","season_notes":{"winter":"Flowering from February: drooping clusters of small white to pink urns, the first nectar of the year for hummingbirds and bees.","spring":"The last flowers fall in April and green berries swell; new leaves are a fresh, slightly bronzed green.","summer":"Berries ripen red-brown, and the thin outer bark peels in curls from the red trunks.","fall":"Evergreen through the dry season; next winter's flower buds already hang at the branch tips."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.05,"oak_woodland":0.6,"chaparral":1.0,"mixed_forest":0.35,"conifer_forest":0.15,"riparian":0.0},"floor":0.6,"mid":1.0,"steep":1.2,"north":0.9,"shade":0.25,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"berries","seasons":["summer","fall"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["summer","fall"]},{"animal":"canis_latrans","part":"berries","seasons":["summer","fall"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["summer","fall"]},{"animal":"callipepla_californica","part":"berries","seasons":["summer","fall"]},{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.8,"radius_ratio":0.04,"taper":0.7,"flare":1.6,"bole_ratio":0.12,"base_size":0.15,"curve_deg":22,"curve_var_deg":18,"segments":4,"lean_deg":4,"stems":[3,6],"stem_spread_deg":40,"split_prob":0.2,"split_count":2,"split_angle_deg":25,"sinuous_deg":16,"bark_rgb":[124,54,44],"bark_pattern":"smooth","twig_rgb":[130,64,52],"bark":{"tile_m":[0.2,0.45],"contrast":1.0,"relief":0.6}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.4],[0.15,0.62],[0.35,0.78],[0.55,0.8],[0.75,0.68],[0.9,0.44],[1.0,0.14]],"lobes":4,"lobe_depth":0.14,"asymmetry":0.15,"fill":0.6,"edge":1.07}},"levels":[{"count":5,"start":0.08,"down_angle_deg":38,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.7,"length_var":0.25,"curve_deg":28,"curve_var_deg":16,"tropism":0.08,"taper":0.9,"radius_ratio":0.6,"segments":2,"sinuous_deg":18},{"count":4,"start":0.25,"down_angle_deg":38,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.25,"curve_deg":20,"curve_var_deg":20,"tropism":0.06,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.04,"leaf_shape":"oval","cluster_m":0.5,"density":22,"start":0.1,"parent_start":0.1,"orientation":"outward","roll_deg":55,"colors":{"winter":[104,122,82],"spring":[118,134,88],"summer":[110,126,84],"fall":[106,122,82]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.4,"cards_per_clump":6,"shell":0.15,"flatten":0.8,"tip_bias":0.9},"palette":[[0.85,[1,1,1]],[0.15,[1.12,1.1,1.02]]],"ao_min":0.76,"color_var":[0.08,0.04],"flowers":{"season":["winter","spring"],"months":[2,4],"form":"cluster","rgb":[240,222,220],"size_m":0.04,"density":0.5,"before_leaves":false},"berries":{"season":"summer","months":[6,9],"form":"cluster","rgb":[140,72,50],"size_m":0.035,"density":0.4}},"deadwood":{"fraction":0.12,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[140,136,128]},"twigs":{"count":[1,2],"length":0.8,"down_deg":40,"down_var_deg":20,"zigzag_deg":25,"curve_var_deg":35,"segments":2,"radius_m":0.012,"taper":0.5,"fan_deg":60,"jitter":0.25},"lod":{"near_tris_budget":1200,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":28},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.12,"porosity":0.15,"foliage_rg":0.87,"foliage_bg":0.66,"from":"judgement values from the drafter's knowledge of the species (2026-10-29), no photographs measured: taller and a little narrower for its height than whiteleaf manzanita, a loose green dome over an open base; colour a bright, slightly yellow green (r/g about 0.87, b/g about 0.66), clearly greener and less blue-white than A. viscida (0.95, 0.68). To be replaced by photo measurements"},"license":"CC BY-SA 4.0"},
  "ceanothus_cuneatus": {"id":"ceanothus_cuneatus","aliases":["buckbrush","buck_brush","wedgeleaf_ceanothus"],"scientific":"Ceanothus cuneatus","common":"buckbrush","form":"shrub","architectural_model":"Rauh (provisional)","deciduous":false,"height_m":[1,3],"variants":[{"name":"young","weight":0.25,"height_m":[0.5,1.2],"deadwood":0.03,"set":{"trunk":{"stems":[2,5]}},"note":"a small, dense, rounded young shrub, a few years after fire"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written: a stiff, intricately branched shrub with a dense rounded to flat top"},{"name":"decadent","weight":0.25,"height_m":[1.8,3],"crown_scale":1.05,"gnarl":1.2,"leaf_density":0.75,"deadwood":{"fraction":0.4,"levels":[0,1,2],"shorten":0.75},"set":{"trunk":{"stems":[4,9]}},"note":"an old stand: grey, twiggy, many dead branches inside a thinning crown"}],"description":"A rigid, densely branched evergreen shrub 1-3 m tall with stiff grey stems set at right angles and tiny, wedge-shaped, dull green leaves in opposite pairs; in March and April it is covered in small white flower clusters whose honey scent drifts across the hillside. It grows on dry chaparral slopes and in the openings of blue oak and foothill pine woodland, where it is one of the foothills' most important deer browse plants and cover for quail and rabbits.","season_notes":{"winter":"Evergreen and grey-green; deer browse the twig tips through the winter.","spring":"Covered in small white (now and then pale blue) flower clusters in March and April, sweet-scented and full of bees.","summer":"Small horned seed capsules ripen and burst with a snap, throwing their seeds out into the brush.","fall":"Dull green and dusty before the rains; quail work the ground beneath for fallen seed."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.1,"oak_woodland":0.6,"chaparral":1.0,"mixed_forest":0.3,"conifer_forest":0.05,"riparian":0.0},"floor":0.6,"mid":1.0,"steep":1.2,"north":0.8,"shade":0.2,"disturbed":1.0},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring","summer","fall"]},{"animal":"odocoileus_hemionus","part":"flowers","seasons":["spring"]},{"animal":"sylvilagus_bachmani","part":"browse","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"browse","seasons":["winter","spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]},{"animal":"oreortyx_pictus","part":"seeds","seasons":["summer","fall"]}],"cover_for":["callipepla_californica","oreortyx_pictus","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.85,"radius_ratio":0.025,"taper":0.85,"flare":1.4,"bole_ratio":0.06,"base_size":0.05,"curve_deg":6,"curve_var_deg":10,"segments":3,"lean_deg":0,"stems":[3,7],"stem_spread_deg":45,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":4,"bark_rgb":[112,108,102],"bark_pattern":"smooth_grey","twig_rgb":[120,112,100],"bark":{"tile_m":[0.1,0.3],"contrast":0.5,"lichen":0.25,"relief":0.3}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.42],[0.15,0.62],[0.35,0.74],[0.55,0.76],[0.75,0.72],[0.9,0.6],[1.0,0.3]],"lobes":5,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.5,"edge":1.06}},"levels":[{"count":5,"start":0.05,"down_angle_deg":55,"down_angle_var_deg":10,"rotation_deg":90,"rotation_var_deg":15,"length_ratio":0.5,"length_var":0.25,"curve_deg":6,"curve_var_deg":8,"tropism":0.06,"taper":0.9,"radius_ratio":0.6,"segments":2,"zigzag_deg":12},{"count":6,"start":0.15,"down_angle_deg":80,"down_angle_var_deg":10,"rotation_deg":90,"rotation_var_deg":15,"length_ratio":0.35,"length_var":0.3,"curve_deg":4,"curve_var_deg":8,"tropism":0.04,"taper":1.0,"radius_ratio":0.5,"segments":1,"zigzag_deg":10}],"foliage":{"type":"broadleaf","leaf_size_m":0.012,"leaf_shape":"oval","cluster_m":0.3,"density":26,"start":0.02,"parent_start":0.05,"orientation":"outward","roll_deg":50,"colors":{"winter":[96,108,80],"spring":[108,116,86],"summer":[100,110,82],"fall":[100,108,82]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.2,"cards_per_clump":6,"shell":0.05,"flatten":0.8,"tip_bias":0.7},"ao_min":0.72,"color_var":[0.08,0.04],"flowers":{"season":"spring","months":[3,4],"form":"cluster","rgb":[238,236,228],"size_m":0.03,"density":0.7,"before_leaves":false},"cards_per_m2":14},"deadwood":{"fraction":0.12,"where":"inner","levels":[1,2],"shorten":0.7,"rgb":[138,134,128]},"twigs":{"count":[2,3],"length":0.6,"down_deg":70,"down_var_deg":12,"zigzag_deg":15,"curve_var_deg":12,"segments":1,"radius_m":0.004,"taper":0.6,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":1300,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":28},"targets":{"crown_width_ratio":1.3,"crown_base_ratio":0.08,"porosity":0.15,"foliage_rg":0.9,"foliage_bg":0.73,"from":"judgement values from the drafter's knowledge of the species (2026-10-29), no photographs measured: a dense, rounded to flat-topped shrub somewhat wider than tall, leafy nearly to the ground; dull olive to grey-green foliage, a little greyer than coyote brush. To be replaced by photo measurements"},"license":"CC BY-SA 4.0"},
  "ceanothus_integerrimus": {"id":"ceanothus_integerrimus","aliases":["deerbrush","deer_brush"],"scientific":"Ceanothus integerrimus","common":"deerbrush","form":"shrub","architectural_model":"Rauh (provisional)","deciduous":true,"height_m":[1.5,4],"variants":[{"name":"young","weight":0.25,"height_m":[0.6,1.5],"leaf_density":1.1,"deadwood":0.02,"set":{"trunk":{"stems":[4,8]}},"note":"dense young growth on a burn or a cut-over slope"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written: an open vase of slender, arching green stems"},{"name":"old","weight":0.25,"height_m":[3,4.5],"crown_scale":1.1,"gnarl":1.15,"leaf_density":0.85,"deadwood":{"fraction":0.3,"levels":[0,1],"shorten":0.8},"set":{"trunk":{"stems":[3,6],"bark_rgb":[116,108,96]}},"note":"an old shrub under closing pines: taller, sparser, with grey dead stems"}],"description":"An open, loosely branched shrub 1-4 m tall with slender, arching green stems and thin, bright green oval leaves, covered in May and June with big fluffy plumes of white to pale blue flowers. It grows in the ponderosa pine and black oak belt above about 500 m, thickest on burned and logged slopes and along roads, and it is the browse plant deer are named for here, as well as cover for quail.","season_notes":{"winter":"Mostly bare: green stems with a few leaves left, browsed by deer at their tips.","spring":"Bright new leaves in April, then from May big fluffy plumes of white or pale blue flowers that scent the pine woods.","summer":"Seed capsules ripen and pop in July; in a dry year leaves begin to yellow and drop.","fall":"Leaves thin and yellow; deer keep browsing the green twigs."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.02,"oak_woodland":0.25,"chaparral":0.5,"mixed_forest":1.0,"conifer_forest":1.0,"riparian":0.1},"floor":0.8,"mid":1.0,"steep":1.0,"north":1.1,"shade":0.35,"disturbed":1.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer","fall"]},{"animal":"odocoileus_hemionus","part":"flowers","seasons":["spring","summer"]},{"animal":"sylvilagus_bachmani","part":"browse","seasons":["spring","summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]},{"animal":"oreortyx_pictus","part":"seeds","seasons":["summer","fall"]}],"cover_for":["callipepla_californica","oreortyx_pictus","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.95,"radius_ratio":0.014,"taper":0.85,"flare":1.3,"bole_ratio":0.08,"base_size":0.12,"curve_deg":14,"curve_var_deg":14,"segments":3,"lean_deg":3,"stems":[3,6],"stem_spread_deg":30,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":6,"bark_rgb":[104,112,84],"bark_pattern":"smooth","twig_rgb":[104,122,82],"bark":{"tile_m":[0.1,0.3],"contrast":0.4,"relief":0.25}},"crown":{"shape":"inverse_conical","envelope":{"profile":[[0.0,0.18],[0.15,0.32],[0.35,0.5],[0.55,0.62],[0.75,0.66],[0.9,0.56],[1.0,0.3]],"lobes":4,"lobe_depth":0.18,"asymmetry":0.18,"fill":0.4,"edge":1.12}},"levels":[{"count":4,"start":0.15,"down_angle_deg":40,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.6,"length_var":0.3,"curve_deg":22,"curve_var_deg":14,"tropism":0.02,"taper":0.9,"radius_ratio":0.55,"segments":2,"droop_deg":10},{"count":4,"start":0.3,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.4,"length_var":0.3,"curve_deg":18,"curve_var_deg":18,"tropism":-0.02,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.04,"leaf_shape":"oval","cluster_m":0.4,"density":18,"start":0.1,"parent_start":0.2,"orientation":"outward","roll_deg":50,"colors":{"winter":[104,120,80],"spring":[118,146,82],"summer":[108,132,78],"fall":[128,128,80]},"leaf_on":{"winter":0.3,"spring":0.85,"summer":0.9,"fall":0.6},"leaf_on_by_month":[0.3,0.3,0.5,0.85,1.0,1.0,0.95,0.8,0.7,0.6,0.45,0.35],"winter_twigs":0.4,"clumps":{"radius_m":0.3,"cards_per_clump":5,"shell":0.15,"flatten":0.8,"tip_bias":0.9},"ao_min":0.74,"color_var":[0.08,0.05],"flowers":{"season":["spring","summer"],"months":[5,6],"form":"candle","width":0.3,"rgb":[232,236,244],"size_m":0.12,"per_card":6,"before_leaves":false}},"deadwood":{"fraction":0.08,"where":"inner","levels":[1,2],"shorten":0.7,"rgb":[140,136,128]},"twigs":{"count":[1,2],"length":0.8,"down_deg":40,"down_var_deg":18,"curve_var_deg":25,"segments":1,"radius_m":0.004,"tropism":-0.02,"taper":0.6,"fan_deg":55,"jitter":0.25},"lod":{"near_tris_budget":1100,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":1.0,"crown_base_ratio":0.15,"porosity":0.35,"foliage_rg":0.83,"foliage_bg":0.59,"from":"judgement values from the drafter's knowledge of the species (2026-10-29), no photographs measured: an open vase about as wide as tall, sky through it (porosity 0.35), bright clear green (r/g about 0.83, b/g about 0.59). To be replaced by photo measurements"},"license":"CC BY-SA 4.0"},
  "cercocarpus_betuloides": {"id":"cercocarpus_betuloides","aliases":["mountain_mahogany","mountain-mahogany","birchleaf_mountain_mahogany"],"scientific":"Cercocarpus betuloides","common":"birch-leaf mountain mahogany","form":"shrub","architectural_model":"Rauh (provisional)","deciduous":false,"height_m":[2,5],"variants":[{"name":"young","weight":0.25,"height_m":[1,2],"trunk_radius":0.8,"deadwood":0.03,"set":{"trunk":{"stems":[2,4]}},"note":"a narrow, upright young shrub"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written: an erect, open shrub of grey stems with dark leaves on short spurs"},{"name":"old","weight":0.25,"height_m":[4,6.5],"trunk_radius":1.25,"crown_scale":1.1,"gnarl":1.2,"deadwood":{"fraction":0.2,"levels":[0,1],"shorten":0.8},"set":{"trunk":{"stems":[2,4],"base_size":0.25}},"note":"a small tree: two to four grey trunks, an open, irregular crown, a few dead limbs"}],"description":"An erect, open, grey-barked shrub or small tree 2-6 m tall whose small, dark green, wedge-shaped leaves are toothed at the tip and crowded on short spur shoots; in summer it is hung with long, twisted, silver-plumed seed tails that catch the light. It grows on rocky chaparral slopes, canyon walls and in foothill pine woodland, and it is a favourite deer browse, most of all in winter when its leaves stay on.","season_notes":{"winter":"Most leaves stay on through a foothill winter, and deer come to browse them.","spring":"Fresh leaves on the spurs and tiny, inconspicuous yellowish flowers in March and April.","summer":"Silvery feathered tails 5-10 cm long grow from the seeds and shine against the dark leaves when the sun is behind them.","fall":"The plumes twist and drift off on the wind, drilling their seeds into the soil."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.02,"oak_woodland":0.4,"chaparral":1.0,"mixed_forest":0.35,"conifer_forest":0.1,"riparian":0.05},"floor":0.3,"mid":1.0,"steep":1.8,"north":1.0,"shade":0.2,"disturbed":0.5},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring","summer","fall"]},{"animal":"sylvilagus_bachmani","part":"browse","seasons":["winter","spring"]}],"cover_for":["callipepla_californica","oreortyx_pictus","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.9,"radius_ratio":0.022,"taper":0.85,"flare":1.4,"bole_ratio":0.1,"base_size":0.15,"curve_deg":10,"curve_var_deg":12,"segments":3,"lean_deg":4,"stems":[2,5],"stem_spread_deg":22,"split_prob":0.15,"split_count":2,"split_angle_deg":20,"sinuous_deg":6,"bark_rgb":[120,116,110],"bark_pattern":"smooth_grey","twig_rgb":[112,96,84],"bark":{"tile_m":[0.15,0.35],"contrast":0.5,"lichen":0.35,"relief":0.3}},"crown":{"shape":"inverse_conical","envelope":{"profile":[[0.0,0.25],[0.15,0.38],[0.35,0.52],[0.55,0.6],[0.75,0.58],[0.9,0.45],[1.0,0.2]],"lobes":4,"lobe_depth":0.18,"asymmetry":0.15,"fill":0.5,"edge":1.1}},"levels":[{"count":4,"start":0.12,"down_angle_deg":32,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":14,"curve_var_deg":14,"tropism":0.08,"taper":0.9,"radius_ratio":0.55,"segments":2},{"count":5,"start":0.2,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.3,"length_var":0.3,"curve_deg":8,"curve_var_deg":12,"tropism":0.06,"taper":1.0,"radius_ratio":0.45,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.025,"leaf_shape":"oval","cluster_m":0.32,"density":18,"start":0.05,"parent_start":0.15,"orientation":"outward","roll_deg":50,"colors":{"winter":[84,98,72],"spring":[98,112,76],"summer":[86,102,72],"fall":[88,100,72]},"leaf_on":{"winter":0.6,"spring":1.0,"summer":1.0,"fall":0.9},"winter_twigs":0.3,"clumps":{"radius_m":0.22,"cards_per_clump":5,"shell":0.1,"flatten":0.75,"tip_bias":0.8},"palette":[[0.8,[1,1,1]],[0.2,[1.15,1.15,1.12]]],"ao_min":0.72,"color_var":[0.08,0.04],"berries":{"season":["summer","fall"],"months":[7,10],"form":"cluster","rgb":[206,206,200],"size_m":0.07,"density":0.5},"cards_per_m2":9},"deadwood":{"fraction":0.1,"where":"inner","levels":[1,2],"shorten":0.7,"rgb":[140,136,130]},"twigs":{"count":[1,2],"length":0.5,"down_deg":50,"down_var_deg":15,"curve_var_deg":20,"segments":1,"radius_m":0.004,"taper":0.6,"fan_deg":50,"jitter":0.2},"lod":{"near_tris_budget":1300,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":0.9,"crown_base_ratio":0.15,"porosity":0.3,"foliage_rg":0.84,"foliage_bg":0.7,"from":"judgement values from the drafter's knowledge of the species (2026-10-29), no photographs measured: an erect, open shrub a little taller than wide, gappy (porosity 0.3), dark green leaves with paler undersides (r/g about 0.84, b/g about 0.7). To be replaced by photo measurements"},"license":"CC BY-SA 4.0"},
  "diplacus_aurantiacus": {"id":"diplacus_aurantiacus","aliases":["sticky_monkeyflower","bush_monkeyflower","mimulus_aurantiacus","monkeyflower"],"scientific":"Diplacus aurantiacus","common":"sticky monkeyflower","form":"shrub","architectural_model":"Champagnat (provisional)","deciduous":false,"height_m":[0.5,1.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.3,0.6],"deadwood":0.02,"set":{"trunk":{"stems":[4,8]}},"note":"a small leafy clump on a road cut"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written: a soft, many-stemmed subshrub, orange with flowers in spring"},{"name":"old","weight":0.25,"height_m":[1,1.6],"crown_scale":1.05,"gnarl":1.15,"leaf_density":0.85,"deadwood":{"fraction":0.3,"levels":[0,1],"shorten":0.75},"set":{"trunk":{"stems":[8,14]}},"note":"an older, leggier plant with woody, peeling lower stems and some dead ones"}],"description":"A small, soft-wooded shrub 0.5-1.5 m tall with many slender stems, narrow dark green leaves sticky to the touch, and orange, trumpet-shaped two-lipped flowers 3-5 cm long all over it from April into July. It grows on rocky slopes, road cuts, canyon walls and chaparral edges and under open oaks, where hummingbirds work its flowers and deer nibble it now and then.","season_notes":{"winter":"Green again after the rains, leaves flat and glossy on the slender stems.","spring":"Covered in orange flowers from April, each with a two-lipped mouth that closes when a bee or hummingbird touches it.","summer":"Still flowering into July, then the leaves curl and darken in the heat and some drop.","fall":"Half-leafless, the curled leaves dull and dusty, waiting for rain."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"grassland":0.15,"oak_woodland":0.6,"chaparral":0.9,"mixed_forest":0.3,"conifer_forest":0.05,"riparian":0.05},"floor":0.4,"mid":1.0,"steep":1.6,"north":0.9,"shade":0.25,"disturbed":1.5},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer"]}],"cover_for":["sceloporus_occidentalis"]},"trunk":{"length_ratio":0.95,"radius_ratio":0.012,"taper":0.9,"flare":1.2,"bole_ratio":0.05,"base_size":0.08,"curve_deg":12,"curve_var_deg":16,"segments":3,"lean_deg":0,"stems":[6,12],"stem_spread_deg":35,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":8,"bark_rgb":[118,98,80],"bark_pattern":"shreddy","twig_rgb":[96,104,72],"bark":{"tile_m":[0.08,0.3]}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.3],[0.15,0.46],[0.35,0.58],[0.55,0.6],[0.75,0.54],[0.9,0.38],[1.0,0.14]],"lobes":5,"lobe_depth":0.14,"asymmetry":0.15,"fill":0.5,"edge":1.1}},"levels":[{"count":3,"start":0.1,"down_angle_deg":30,"down_angle_var_deg":12,"rotation_deg":90,"rotation_var_deg":20,"length_ratio":0.45,"length_var":0.3,"curve_deg":12,"curve_var_deg":16,"tropism":0.1,"taper":0.9,"radius_ratio":0.55,"segments":1},{"count":3,"start":0.3,"down_angle_deg":35,"down_angle_var_deg":12,"rotation_deg":90,"rotation_var_deg":20,"length_ratio":0.35,"length_var":0.3,"curve_deg":10,"curve_var_deg":14,"tropism":0.1,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.05,"leaf_shape":"lanceolate","cluster_m":0.28,"density":22,"start":0.05,"parent_start":0.15,"orientation":"outward","roll_deg":50,"colors":{"winter":[80,98,58],"spring":[84,104,58],"summer":[92,100,62],"fall":[96,98,64]},"leaf_on":{"winter":0.85,"spring":1.0,"summer":0.8,"fall":0.65},"leaf_on_by_month":[0.85,0.9,1.0,1.0,1.0,0.95,0.8,0.65,0.6,0.65,0.75,0.8],"clumps":{"radius_m":0.15,"cards_per_clump":5,"shell":0.05,"flatten":0.85,"tip_bias":0.8},"ao_min":0.72,"color_var":[0.08,0.05],"flowers":{"season":["spring","summer"],"months":[4,7],"form":"cluster","rgb":[232,140,48],"size_m":0.04,"density":0.6,"before_leaves":false}},"deadwood":{"fraction":0.15,"levels":[0,1],"shorten":0.7,"rgb":[136,128,118]},"twigs":{"count":[1,2],"length":0.5,"down_deg":30,"down_var_deg":12,"curve_var_deg":20,"segments":1,"radius_m":0.003,"tropism":0.1,"taper":0.6,"fan_deg":45,"jitter":0.2},"lod":{"near_tris_budget":1000,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":20},"targets":{"crown_width_ratio":1.1,"crown_base_ratio":0.1,"porosity":0.25,"foliage_rg":0.88,"foliage_bg":0.58,"from":"judgement values from the drafter's knowledge of the species (2026-10-29), no photographs measured: a rounded clump a little wider than tall, some gaps between the slender stems, dark, slightly yellow-green leaves (r/g about 0.88, b/g about 0.58) in leaf; in flower the orange dominates. To be replaced by photo measurements"},"license":"CC BY-SA 4.0"},
  "rosa_californica": {"id":"rosa_californica","aliases":["wild_rose","rose","california_wild_rose"],"scientific":"Rosa californica","common":"California wild rose","form":"shrub","architectural_model":"Champagnat (provisional: erect canes from the base that arch over under their own weight and branch from the arch)","deciduous":true,"height_m":[1,2.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.4,1],"crown_scale":0.85,"branches":0.7,"set":{"trunk":{"stems":[3,6],"stem_spread_deg":36}},"note":"a few young canes, upright and little branched"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a rounded tangle of arching prickly canes, wider than tall"},{"name":"old","weight":0.25,"height_m":[1.8,3],"crown_scale":1.15,"gnarl":1.2,"deadwood":{"fraction":0.22,"levels":[0,1],"shorten":0.7},"set":{"trunk":{"stems":[10,16],"stem_spread_deg":60}},"note":"an old thicket of many canes, grey dead ones inside among the living red-brown"}],"description":"A thicket of arching, prickly red-brown canes 1-2.5 m tall with leaves of five to seven toothed leaflets, clear pink five-petalled flowers in late spring and early summer, and round red hips that stay on the bare canes into winter. It grows where the ground stays damp, along creeks, swales, seeps and the shady edges of oak woodland, and its tangles shelter quail and rabbits while its hips feed birds, foxes, coyotes and bears.","season_notes":{"winter":"Bare red-brown canes, prickly, still hung with shiny red hips that birds and foxes pick through the winter.","spring":"New leaves in March, fresh and bright green; the first pink flowers open in May.","summer":"Pink roses 3-5 cm across, a few at a time, into July, busy with bees; green hips swell behind them.","fall":"Hips turn red-orange; the leaves go yellow and dull red and drop by late November."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"riparian":1.0,"oak_woodland":0.5,"mixed_forest":0.3,"grassland":0.15,"chaparral":0.05},"floor":1.6,"mid":0.8,"steep":0.5,"north":1.3,"shade":0.4,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer"]},{"animal":"sylvilagus_bachmani","part":"browse","seasons":["winter"]},{"animal":"ursus_americanus","part":"berries","seasons":["fall","winter"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["fall","winter"]},{"animal":"canis_latrans","part":"berries","seasons":["fall","winter"]},{"animal":"callipepla_californica","part":"berries","seasons":["fall","winter"]},{"animal":"meleagris_gallopavo","part":"berries","seasons":["fall","winter"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["fall","winter"]},{"animal":"cyanocitta_stelleri","part":"berries","seasons":["fall","winter"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.85,"radius_ratio":0.009,"taper":0.8,"flare":1.15,"bole_ratio":0.06,"base_size":0.04,"curve_deg":24,"curve_var_deg":16,"segments":3,"lean_deg":8,"stems":[6,10],"stem_spread_deg":56,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":5,"bark_rgb":[122,86,72],"bark_pattern":"smooth","twig_rgb":[140,78,64],"bark":{"tile_m":[0.08,0.25],"contrast":0.4,"lichen":0.05,"relief":0.3}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.46],[0.15,0.6],[0.35,0.67],[0.55,0.66],[0.75,0.56],[0.9,0.36],[1.0,0.12]],"lobes":5,"lobe_depth":0.16,"asymmetry":0.18,"fill":0.6,"edge":1.1}},"levels":[{"count":5,"start":0.05,"down_angle_deg":50,"down_angle_tip_deg":38,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.6,"length_var":0.3,"curve_deg":12,"curve_var_deg":16,"tropism":0.0,"taper":0.9,"radius_ratio":0.6,"segments":2,"droop_deg":10},{"count":4,"start":0.25,"down_angle_deg":45,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.4,"length_var":0.3,"curve_deg":8,"curve_var_deg":16,"tropism":0.03,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.09,"leaf_shape":"pinnate_compound","leaflets":[5,7],"leaflet_ratio":0.3,"cluster_m":0.42,"density":18,"cards_per_m2":4.5,"leaf_fill":1.6,"start":0.02,"parent_start":0.1,"orientation":"outward","roll_deg":55,"colors":{"winter":[128,84,70],"spring":[116,140,82],"summer":[104,122,80],"fall":[152,118,70]},"leaf_on":{"winter":0.0,"spring":0.85,"summer":1.0,"fall":0.6},"leaf_on_by_month":[0.0,0.05,0.45,0.9,1.0,1.0,1.0,0.95,0.85,0.65,0.3,0.0],"clumps":{"radius_m":0.28,"cards_per_clump":6,"shell":0.05,"flatten":0.8,"tip_bias":0.7},"palette":[[0.85,[1,1,1]],[0.15,[1.12,1.08,0.86]]],"winter_twigs":0.55,"ao_min":0.7,"color_var":[0.08,0.05],"leaf_on_var":0.5,"flowers":{"season":"spring","months":[5,7],"form":"cluster","rgb":[232,140,172],"size_m":0.05,"density":0.3,"before_leaves":false},"berries":{"season":["fall","winter"],"months":[8,2],"form":"cluster","rgb":[196,62,38],"size_m":0.04,"density":0.4}},"deadwood":{"fraction":0.08,"where":"inner","levels":[0,1],"shorten":0.75,"rgb":[140,128,118]},"twigs":{"count":[1,2],"length":0.7,"down_deg":42,"down_var_deg":16,"curve_var_deg":22,"segments":1,"radius_m":0.004,"taper":0.6,"droop_deg":6,"fan_deg":50,"jitter":0.22},"lod":{"near_tris_budget":1300,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":1.3,"crown_base_ratio":0.06,"porosity":0.25,"foliage_rg":0.71,"foliage_bg":0.41,"from":"judgement values (2026-10-29) from knowledge of the species, not measured: no photographs were fetched for this draft. A mature clump is a rounded tangle somewhat wider than tall (W/H 1.2-1.5), leafy to the ground, moderately dense; colour is the linear r/g and b/g of the file's summer leaf colour (sRGB 104, 122, 80). A reviewer should replace these with values measured from local photographs"},"license":"CC BY-SA 4.0"},
  "symphoricarpos_albus": {"id":"symphoricarpos_albus","aliases":["snowberry","common_snowberry","creeping_snowberry","symphoricarpos_mollis"],"scientific":"Symphoricarpos albus","common":"common snowberry","form":"shrub","architectural_model":"Champagnat (provisional: thin erect shoots from the base and from runners that arch over and branch along the arch)","deciduous":true,"height_m":[0.5,1.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.25,0.6],"crown_scale":0.9,"branches":0.7,"set":{"trunk":{"stems":[4,8],"stem_spread_deg":40}},"note":"a low patch of a few thin shoots, the creeping snowberry's habit under the oaks"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a soft, see-through clump of many thin arching stems"},{"name":"old","weight":0.25,"height_m":[1.2,2],"crown_scale":1.12,"gnarl":1.15,"deadwood":{"fraction":0.2,"levels":[0,1],"shorten":0.75},"set":{"trunk":{"stems":[14,22]}},"note":"a dense old colony of many stems, some dead and grey"}],"description":"A low, airy shrub 0.5-1.5 m tall of many thin arching stems with small, soft, blue-green oval leaves in pairs, tiny pink bell flowers in early summer and clusters of round, waxy, snow-white berries that hang on the bare twigs into winter. It carpets the shady ground under oaks and on north slopes and along creek edges; deer browse it, and quail and thrushes eat the bitter berries late in the season when other food runs short.","season_notes":{"winter":"Bare thin grey-brown twigs, still hung with clusters of white berries well into January.","spring":"One of the first shrubs to leaf out, in February and March: soft blue-green leaves in pairs along thin stems.","summer":"Tiny pink bell flowers, May to July, half-hidden in the leaf pairs at the twig ends; bees and hummingbirds visit.","fall":"White berries the size of a pea ripen from September in clusters at the tips; the leaves yellow and fall in October and November."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"oak_woodland":1.0,"mixed_forest":0.8,"riparian":0.7,"conifer_forest":0.3,"chaparral":0.1},"floor":1.1,"mid":1.0,"steep":0.9,"north":1.5,"shade":0.7,"disturbed":0.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["spring","summer","fall"]},{"animal":"callipepla_californica","part":"berries","seasons":["fall","winter"]},{"animal":"oreortyx_pictus","part":"berries","seasons":["fall","winter"]},{"animal":"meleagris_gallopavo","part":"berries","seasons":["winter"]}],"cover_for":["callipepla_californica","sylvilagus_bachmani","microtus_californicus"]},"trunk":{"length_ratio":0.85,"radius_ratio":0.008,"taper":0.8,"flare":1.1,"bole_ratio":0.05,"base_size":0.05,"curve_deg":20,"curve_var_deg":16,"segments":2,"lean_deg":6,"stems":[6,10],"stem_spread_deg":52,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":4,"bark_rgb":[126,112,98],"bark_pattern":"shreddy","twig_rgb":[142,120,102],"bark":{"tile_m":[0.06,0.2],"contrast":0.4,"lichen":0.05,"relief":0.25}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.32],[0.18,0.48],[0.4,0.56],[0.62,0.55],[0.8,0.45],[0.93,0.27],[1.0,0.08]],"lobes":5,"lobe_depth":0.16,"asymmetry":0.15,"fill":0.5,"edge":1.12}},"levels":[{"count":3,"start":0.1,"down_angle_deg":48,"down_angle_var_deg":12,"rotation_deg":-80,"rotation_var_deg":20,"length_ratio":0.5,"length_var":0.3,"curve_deg":10,"curve_var_deg":16,"tropism":0.0,"taper":0.9,"radius_ratio":0.6,"segments":2,"droop_deg":10},{"count":4,"start":0.25,"down_angle_deg":45,"down_angle_var_deg":12,"rotation_deg":-90,"rotation_var_deg":20,"length_ratio":0.4,"length_var":0.3,"curve_deg":6,"curve_var_deg":14,"tropism":0.0,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.025,"leaf_shape":"oval","cluster_m":0.26,"density":16,"cards_per_m2":5.5,"start":0.05,"parent_start":0.2,"orientation":"outward","roll_deg":50,"colors":{"winter":[140,122,106],"spring":[114,136,104],"summer":[104,120,108],"fall":[150,136,86]},"leaf_on":{"winter":0.0,"spring":0.85,"summer":0.95,"fall":0.5},"leaf_on_by_month":[0.0,0.15,0.6,0.95,1.0,1.0,0.95,0.85,0.7,0.45,0.15,0.0],"clumps":{"radius_m":0.18,"cards_per_clump":4,"shell":0.1,"flatten":0.85,"tip_bias":0.9},"palette":[[0.8,[1,1,1]],[0.2,[1.1,1.1,1.14]]],"winter_twigs":0.55,"ao_min":0.76,"color_var":[0.08,0.05],"leaf_on_var":0.5,"flowers":{"season":["spring","summer"],"months":[5,7],"form":"bud","rgb":[232,178,186],"size_m":0.012,"density":0.3,"before_leaves":false},"berries":{"season":["fall","winter"],"months":[9,1],"form":"cluster","rgb":[238,236,230],"size_m":0.03,"density":0.5}},"deadwood":{"fraction":0.06,"where":"inner","levels":[0,1],"shorten":0.75,"rgb":[146,138,128]},"twigs":{"count":[1,2],"length":0.7,"down_deg":42,"down_var_deg":16,"curve_var_deg":20,"segments":1,"radius_m":0.003,"taper":0.6,"droop_deg":6,"fan_deg":50,"jitter":0.22},"lod":{"near_tris_budget":1300,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":20},"targets":{"crown_width_ratio":1.1,"crown_base_ratio":0.1,"porosity":0.4,"foliage_rg":0.74,"foliage_bg":0.8,"from":"judgement values (2026-10-29) from knowledge of the species, not measured: no photographs were fetched for this draft. A clump of thin stems about as wide as tall (W/H 1.0-1.2), soft and see-through with ground and sky between the stems (porosity 0.4); colour is the linear r/g and b/g of the file's summer leaf colour (sRGB 104, 120, 108), a blue-green. A reviewer should replace these with values measured from local photographs"},"license":"CC BY-SA 4.0"},
  "ribes_roezlii": {"id":"ribes_roezlii","aliases":["gooseberry","sierra_gooseberry"],"scientific":"Ribes roezlii","common":"Sierra gooseberry","form":"shrub","architectural_model":"Rauh (provisional: a few stiff stems from the base with spreading, rhythmically branched side shoots)","deciduous":true,"height_m":[0.5,1.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.3,0.6],"crown_scale":0.9,"branches":0.7,"set":{"trunk":{"stems":[2,4]}},"note":"a small plant of two to four stiff stems"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: a low, stiff, spreading shrub, open between its spiny stems"},{"name":"old","weight":0.25,"height_m":[1.1,1.8],"crown_scale":1.1,"gnarl":1.25,"deadwood":{"fraction":0.2,"levels":[0,1],"shorten":0.7},"set":{"trunk":{"stems":[6,10]}},"note":"an old, broader shrub with grey dead stems among the living"}],"description":"A low, stiff, spiny shrub 0.5-1.5 m tall whose stems carry three sharp spines at every node, with small round lobed leaves, hanging dark red and white flowers like little fuchsias in spring, and round red berries covered in prickles in summer. It grows on dry, rocky slopes in chaparral, foothill pine and oak woodland and up into the pine belt, where bears, foxes, coyotes, jays and quail eat its berries and quail and rabbits shelter under its spines.","season_notes":{"winter":"Bare, stiff grey-brown stems bristling with spines in threes.","spring":"Small lobed leaves unfold in March, and dark red flowers with white tips hang under the stems like tiny fuchsias, March to May; hummingbirds and bees visit.","summer":"Round spiny berries ripen from green to red and purple-red, June to August; in the dry heat the leaves begin to yellow and fall.","fall":"Mostly bare already, a few leaves left, red to orange."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"mixed_forest":0.9,"chaparral":0.8,"conifer_forest":0.7,"oak_woodland":0.6,"grassland":0.05},"floor":0.6,"mid":1.0,"steep":1.5,"north":1.0,"shade":0.4,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"berries","seasons":["summer"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["summer"]},{"animal":"canis_latrans","part":"berries","seasons":["summer"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["summer"]},{"animal":"cyanocitta_stelleri","part":"berries","seasons":["summer"]},{"animal":"callipepla_californica","part":"berries","seasons":["summer"]},{"animal":"oreortyx_pictus","part":"berries","seasons":["summer"]}],"cover_for":["callipepla_californica","oreortyx_pictus","sylvilagus_bachmani"]},"trunk":{"length_ratio":0.8,"radius_ratio":0.012,"taper":0.8,"flare":1.15,"bole_ratio":0.06,"base_size":0.05,"curve_deg":10,"curve_var_deg":14,"segments":3,"lean_deg":6,"stems":[4,7],"stem_spread_deg":54,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":4,"bark_rgb":[118,104,92],"bark_pattern":"shreddy","twig_rgb":[150,130,108],"bark":{"tile_m":[0.06,0.2],"contrast":0.45,"lichen":0.1,"relief":0.3}},"crown":{"shape":"hemispherical","envelope":{"profile":[[0.0,0.38],[0.18,0.54],[0.4,0.62],[0.6,0.6],[0.78,0.5],[0.92,0.3],[1.0,0.1]],"lobes":5,"lobe_depth":0.18,"asymmetry":0.2,"fill":0.5,"edge":1.1}},"levels":[{"count":5,"start":0.08,"down_angle_deg":58,"down_angle_tip_deg":45,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":4,"curve_var_deg":10,"zigzag_deg":10,"tropism":0.02,"taper":0.9,"radius_ratio":0.6,"segments":2,"droop_deg":4},{"count":4,"start":0.2,"down_angle_deg":55,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.4,"length_var":0.3,"curve_deg":0,"curve_var_deg":10,"zigzag_deg":14,"tropism":0.0,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.02,"leaf_shape":"lobed","cluster_m":0.26,"density":16,"cards_per_m2":5,"start":0.05,"parent_start":0.15,"orientation":"outward","roll_deg":50,"colors":{"winter":[130,112,96],"spring":[112,138,80],"summer":[98,118,78],"fall":[154,108,70]},"leaf_on":{"winter":0.0,"spring":0.85,"summer":0.8,"fall":0.3},"leaf_on_by_month":[0.0,0.05,0.5,0.95,1.0,1.0,0.9,0.6,0.45,0.35,0.15,0.0],"clumps":{"radius_m":0.18,"cards_per_clump":4,"shell":0.1,"flatten":0.8,"tip_bias":0.8},"palette":[[0.85,[1,1,1]],[0.15,[1.15,1.08,0.85]]],"winter_twigs":0.5,"ao_min":0.72,"color_var":[0.1,0.06],"leaf_on_var":0.6,"flowers":{"season":"spring","months":[3,5],"form":"bud","rgb":[146,38,66],"size_m":0.02,"density":0.4,"before_leaves":false},"berries":{"season":"summer","months":[6,8],"form":"bud","rgb":[176,42,44],"size_m":0.02,"density":0.3}},"deadwood":{"fraction":0.08,"where":"inner","levels":[0,1],"shorten":0.7,"rgb":[142,134,124]},"twigs":{"count":[1,2],"length":0.6,"down_deg":50,"down_var_deg":16,"curve_var_deg":14,"segments":1,"radius_m":0.004,"taper":0.6,"zigzag_deg":18,"fan_deg":55,"jitter":0.2},"lod":{"near_tris_budget":950,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":20},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.08,"porosity":0.35,"foliage_rg":0.67,"foliage_bg":0.42,"from":"judgement values (2026-10-29) from knowledge of the species, not measured: no photographs were fetched for this draft. A low, stiff shrub somewhat wider than tall (W/H 1.1-1.4), open between its spreading stems (porosity 0.35); colour is the linear r/g and b/g of the file's summer leaf colour (sRGB 98, 118, 78). A reviewer should replace these with values measured from local photographs"},"license":"CC BY-SA 4.0"},
  "ribes_malvaceum": {"id":"ribes_malvaceum","aliases":["currant","chaparral_currant","pink_flowering_currant"],"scientific":"Ribes malvaceum","common":"chaparral currant","form":"shrub","architectural_model":"Rauh (provisional: several erect stems from the base, branching rhythmically, renewed by new shoots from the base)","deciduous":true,"height_m":[1,2.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.5,1.1],"crown_scale":0.9,"branches":0.7,"set":{"trunk":{"stems":[2,4],"stem_spread_deg":18}},"note":"a few upright young stems"},{"name":"mature","weight":0.5,"seeds":1,"note":"the file as written: an upright shrub of several erect stems, taller than wide"},{"name":"old","weight":0.25,"height_m":[2,3],"crown_scale":1.1,"gnarl":1.2,"deadwood":{"fraction":0.22,"levels":[0,1],"shorten":0.7},"set":{"trunk":{"stems":[6,10]}},"note":"an old, broader shrub with grey dead stems inside"}],"description":"An upright shrub 1-2.5 m tall of several erect stems with rough, grey-green, sweet-and-sharp smelling lobed leaves, and hanging clusters of pink flowers that open in the middle of winter, from November to March, when little else is in bloom. It grows on dry chaparral slopes and the sunny edges of oak woodland, feeds the first hummingbirds of the year, and its dusky purple berries in late spring are eaten by jays, quail, foxes, coyotes and bears.","season_notes":{"winter":"Fresh grey-green leaves came back with the rains, and drooping clusters of pink flowers hang along the stems from November to March, the hummingbirds' winter food.","spring":"Full leaf; the last flowers fade in March and berries ripen dusky purple with a pale bloom in April to June.","summer":"Leaves dry, yellow and drop in the summer drought; by July the shrub is mostly bare grey-brown stems.","fall":"Bare stems until the first rains, then new leaves and the first pink buds in November."},"status":"agent draft, needs local sign-off","habitat":{"classes":{"chaparral":1.0,"oak_woodland":0.6,"mixed_forest":0.15,"grassland":0.1},"floor":0.6,"mid":1.1,"steep":1.2,"north":0.8,"shade":0.2,"disturbed":0.7},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"browse","seasons":["winter","spring"]},{"animal":"aphelocoma_californica","part":"berries","seasons":["spring","summer"]},{"animal":"callipepla_californica","part":"berries","seasons":["spring","summer"]},{"animal":"urocyon_cinereoargenteus","part":"berries","seasons":["spring","summer"]},{"animal":"canis_latrans","part":"berries","seasons":["spring","summer"]},{"animal":"ursus_americanus","part":"berries","seasons":["spring","summer"]}],"cover_for":["callipepla_californica"]},"trunk":{"length_ratio":0.9,"radius_ratio":0.012,"taper":0.8,"flare":1.15,"bole_ratio":0.06,"base_size":0.08,"curve_deg":6,"curve_var_deg":10,"segments":3,"lean_deg":5,"stems":[4,7],"stem_spread_deg":26,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"sinuous_deg":4,"bark_rgb":[128,102,88],"bark_pattern":"shreddy","twig_rgb":[140,114,94],"bark":{"tile_m":[0.08,0.25],"contrast":0.45,"lichen":0.1,"relief":0.3}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.24],[0.2,0.37],[0.45,0.46],[0.65,0.46],[0.82,0.38],[0.94,0.22],[1.0,0.07]],"lobes":4,"lobe_depth":0.16,"asymmetry":0.18,"fill":0.5,"edge":1.1}},"levels":[{"count":5,"start":0.1,"down_angle_deg":36,"down_angle_var_deg":12,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.3,"curve_deg":8,"curve_var_deg":12,"zigzag_deg":6,"tropism":0.06,"taper":0.9,"radius_ratio":0.6,"segments":2},{"count":4,"start":0.25,"down_angle_deg":40,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.4,"length_var":0.3,"curve_deg":4,"curve_var_deg":12,"zigzag_deg":8,"tropism":0.04,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.045,"leaf_shape":"lobed","cluster_m":0.36,"density":16,"cards_per_m2":5,"start":0.05,"parent_start":0.2,"orientation":"outward","roll_deg":50,"colors":{"winter":[112,128,94],"spring":[118,130,100],"summer":[142,132,100],"fall":[124,130,96]},"leaf_on":{"winter":0.9,"spring":0.95,"summer":0.2,"fall":0.25},"leaf_on_by_month":[0.9,1.0,1.0,1.0,0.9,0.55,0.2,0.02,0.02,0.15,0.5,0.8],"clumps":{"radius_m":0.24,"cards_per_clump":5,"shell":0.1,"flatten":0.8,"tip_bias":0.8},"palette":[[0.75,[1,1,1]],[0.2,[1.12,1.12,1.1]],[0.05,[1.3,1.15,0.75]]],"winter_twigs":0.4,"ao_min":0.76,"color_var":[0.08,0.05],"leaf_on_var":0.6,"flowers":{"season":["fall","winter"],"months":[11,3],"form":"cluster","rgb":[226,138,168],"size_m":0.06,"density":0.45,"before_leaves":true},"berries":{"season":["spring","summer"],"months":[4,6],"form":"cluster","rgb":[92,66,92],"size_m":0.04,"density":0.3}},"deadwood":{"fraction":0.08,"where":"inner","levels":[0,1],"shorten":0.7,"rgb":[142,134,124]},"twigs":{"count":[1,2],"length":0.65,"down_deg":40,"down_var_deg":14,"curve_var_deg":16,"segments":1,"radius_m":0.005,"taper":0.6,"zigzag_deg":10,"fan_deg":45,"jitter":0.2},"lod":{"near_tris_budget":1000,"near_sides":[3,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":20},"targets":{"crown_width_ratio":0.9,"crown_base_ratio":0.12,"porosity":0.3,"foliage_rg":0.81,"foliage_bg":0.57,"from":"judgement values (2026-10-29) from knowledge of the species, not measured: no photographs were fetched for this draft. An upright shrub a little taller than wide (W/H 0.8-1.0), moderately open; colour is the linear r/g and b/g of the file's spring leaf colour (sRGB 118, 130, 100), the in-leaf season of this summer-deciduous shrub; in July and August the lineup will see a mostly bare shrub. A reviewer should replace these with values measured from local photographs"},"license":"CC BY-SA 4.0"},
  "stipa_pulchra": {"id":"stipa_pulchra","aliases":["purple_needlegrass","needlegrass","nassella_pulchra"],"scientific":"Stipa pulchra","common":"purple needlegrass","form":"grass","lifespan":"perennial","native":true,"height_m":[0.4,1.0],"description":"California's state grass: a dense, fine-leaved bunchgrass whose flowering stems rise in April and May, each seed tipped with a long, twice-bent awn that shines purple in the low sun. It holds the ground between the annual grasses on the drier slopes and under the blue oaks, stays grey-green at the base all summer while the annuals cure gold, and its deep roots live for decades.","season_notes":{"winter":"Green again from the first rains; last year's grey leaves stand in the middle of each tussock.","spring":"Flowering stems rise in April; by May the seed heads nod, their long awns tinted purple.","summer":"The seeds have twisted themselves into the ground by June; the leaves cure to a grey straw with green at the base.","fall":"Grey-green tussocks in the gold of the annuals, waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"type":"bunch","height":1.0,"width":1.0,"palette":{"winter":{"root":[74,84,61],"tip":[110,145,82],"head":[128,133,102],"awn":[140,133,115]},"spring":{"root":[69,89,54],"tip":[115,156,71],"head":[133,112,112],"awn":[140,107,128]},"summer":{"root":[94,105,82],"tip":[186,168,120],"head":[204,191,158],"awn":[214,201,168]},"fall":{"root":[89,99,79],"tip":[171,158,120],"head":[189,181,158],"awn":[194,186,163]}},"heads":{"shape":"raceme","months":[4,6]},"cure":0.5},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.9,"chaparral":0.25,"mixed_forest":0.2,"conifer_forest":0.05,"riparian":0.2},"floor":0.8,"mid":1.0,"steep":1.1,"north":0.9,"shade":0.3,"disturbed":0.5},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring","fall"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall","winter"]},{"animal":"meleagris_gallopavo","part":"seeds","seasons":["summer","fall","winter"]}],"cover_for":["microtus_californicus","callipepla_californica"]},"license":"CC BY-SA 4.0"},
  "elymus_glaucus": {"id":"elymus_glaucus","aliases":["blue_wildrye","wildrye","blue_wild_rye"],"scientific":"Elymus glaucus","common":"blue wildrye","form":"grass","lifespan":"perennial","native":true,"height_m":[0.6,1.5],"description":"A tall, loose bunchgrass with flat, blue-green leaves and slender stems that lift a narrow, erect spike of short-awned seeds above the clump from May into July. It grows in the half shade at the edges of the oak woodland, on the moist north slopes and along the creeks, where it stays green weeks longer than the annuals and gives deer an early bite and voles and quail a tall place to hide.","season_notes":{"winter":"New blue-green leaves from the base of the clump after the rains, among last year's pale stems.","spring":"Leafy clumps knee-high by April; the flowering stems rise in May with a stiff, upright spike.","summer":"The spikes ripen and shatter in July; the leaves cure to straw but the base stays grey-green in the shade.","fall":"Pale standing stems over a grey-green clump, waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"type":"bunch","height":1.5,"width":1.1,"palette":{"winter":{"root":[70,88,74],"tip":[102,140,120],"head":[122,134,112],"awn":[134,138,118]},"spring":{"root":[66,92,74],"tip":[106,150,126],"head":[128,150,116],"awn":[140,152,122]},"summer":{"root":[96,106,88],"tip":[182,170,130],"head":[196,184,142],"awn":[204,192,152]},"fall":{"root":[90,100,84],"tip":[166,158,126],"head":[184,176,144],"awn":[190,182,152]}},"heads":{"shape":"spike","months":[5,7]},"cure":0.7},"habitat":{"classes":{"grassland":0.4,"oak_woodland":1.0,"chaparral":0.2,"mixed_forest":0.6,"conifer_forest":0.3,"riparian":0.9},"floor":1.2,"mid":1.0,"steep":0.9,"north":1.5,"shade":0.6,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring","fall"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring","fall"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]},{"animal":"oreortyx_pictus","part":"seeds","seasons":["summer","fall"]},{"animal":"meleagris_gallopavo","part":"seeds","seasons":["summer","fall"]}],"cover_for":["microtus_californicus","callipepla_californica","oreortyx_pictus","sylvilagus_bachmani"]},"license":"CC BY-SA 4.0"},
  "danthonia_californica": {"id":"danthonia_californica","aliases":["california_oatgrass","oatgrass"],"scientific":"Danthonia californica","common":"California oatgrass","form":"grass","lifespan":"perennial","native":true,"height_m":[0.2,0.6],"description":"A low perennial grass of short, tufted leaves with a few large, shining spikelets held on thin stems in April and May, each like a small oat with a bent awn. It grows in the moist meadows, swales and open oak savanna, often in the wetter ground where the soil stays damp into spring, and it hides a second set of seeds in its leaf sheaths that never open, a reserve for a bad year.","season_notes":{"winter":"Low green tufts from the first rains, short leaves close to the ground.","spring":"Thin stems in April with three to six big, pale spikelets each; flowering through May.","summer":"The tufts cure to a tawny straw but keep green at the base in the swales.","fall":"Low tawny tufts with a little green at the heart, among the gold of the annuals."},"status":"agent draft, needs local sign-off","ground":{"type":"bunch","height":0.6,"width":0.9,"palette":{"winter":{"root":[72,88,60],"tip":[112,148,86],"head":[132,138,106],"awn":[140,138,114]},"spring":{"root":[68,94,56],"tip":[118,160,78],"head":[158,156,118],"awn":[166,156,124]},"summer":{"root":[98,104,78],"tip":[190,172,124],"head":[208,196,154],"awn":[212,200,162]},"fall":{"root":[92,98,76],"tip":[174,160,122],"head":[192,182,150],"awn":[198,188,156]}},"heads":{"shape":"panicle","months":[4,6]},"cure":0.6},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.7,"chaparral":0.05,"mixed_forest":0.1,"conifer_forest":0.05,"riparian":0.4},"floor":1.5,"mid":0.9,"steep":0.6,"north":1.2,"shade":0.2,"disturbed":0.4},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring","summer","fall"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]}],"cover_for":["microtus_californicus"]},"license":"CC BY-SA 4.0"},
  "avena_fatua": {"id":"avena_fatua","aliases":["wild_oat","wild_oats","avena_barbata","slender_wild_oat"],"scientific":"Avena fatua","common":"wild oat","form":"grass","lifespan":"annual","native":false,"height_m":[0.6,1.3],"description":"A tall annual oat from the Mediterranean with broad, flat leaves and a wide, nodding panicle of big, drooping spikelets, each seed with a long, bent and twisted awn; waist-high by May and gold by June. With slender wild oat it is the grass that turns the foothills from green to gold, on every open slope, under the oaks and along the roads, and its heavy seeds feed ground squirrels, quail and turkeys through the dry months.","season_notes":{"winter":"Broad, bright green leaves from the first rains, the sward's early grazing.","spring":"Tall stems in April with open, nodding panicles of dangling spikelets; flowering into May.","summer":"Cured to gold by June; the seeds drop and the awns twist them into the cracks of the soil.","fall":"Standing pale straw, bleached and broken, until the rains bring the new green underneath."},"status":"agent draft, needs local sign-off","ground":{"type":"annual","height":1.25,"width":1.0,"palette":{"winter":{"root":[56,74,38],"tip":[120,168,77],"head":[158,168,92],"awn":[158,168,102]},"spring":{"root":[54,79,31],"tip":[128,179,66],"head":[189,196,97],"awn":[179,189,102]},"summer":{"root":[117,102,69],"tip":[219,191,122],"head":[237,219,163],"awn":[224,204,153]},"fall":{"root":[105,94,71],"tip":[199,176,128],"head":[212,199,161],"awn":[201,191,161]}},"heads":{"shape":"panicle","months":[4,6]},"cure":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.8,"chaparral":0.15,"mixed_forest":0.1,"conifer_forest":0.0,"riparian":0.2},"floor":1.1,"mid":1.0,"steep":0.8,"north":0.9,"shade":0.2,"disturbed":1.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["spring","summer","fall"]},{"animal":"microtus_californicus","part":"seeds","seasons":["summer","fall"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall","winter"]},{"animal":"meleagris_gallopavo","part":"seeds","seasons":["summer","fall","winter"]}],"cover_for":["microtus_californicus","callipepla_californica"]},"license":"CC BY-SA 4.0"},
  "bromus_hordeaceus": {"id":"bromus_hordeaceus","aliases":["soft_chess","soft_brome","bromus_mollis"],"scientific":"Bromus hordeaceus","common":"soft chess","form":"grass","lifespan":"annual","native":false,"height_m":[0.2,0.6],"description":"A short annual brome with soft, downy leaves and a compact, upright panicle of plump, hairy spikelets with short awns, flowering in April and drying to a pale straw by the end of May, earlier than the oats. It is the commonest grass of the foothill sward, the low carpet between the taller oats on almost every open slope and under the oaks, and the one grass every grazer here eats.","season_notes":{"winter":"A low, soft, grey-green carpet from the first rains: the bulk of the winter grazing.","spring":"Short upright heads of fat, downy spikelets in April; curing pale by late May.","summer":"Pale straw by June, the low mat under the gold of the oats; the seed lies on the ground.","fall":"A flattened, bleached mat, green showing through it after the first rain."},"status":"agent draft, needs local sign-off","ground":{"type":"annual","height":0.75,"width":0.9,"palette":{"winter":{"root":[58,76,44],"tip":[120,160,88],"head":[148,158,102],"awn":[150,158,108]},"spring":{"root":[60,80,40],"tip":[134,174,84],"head":[180,182,116],"awn":[176,178,118]},"summer":{"root":[132,118,86],"tip":[228,210,154],"head":[238,228,188],"awn":[230,218,178]},"fall":{"root":[116,106,84],"tip":[206,190,150],"head":[216,208,178],"awn":[208,200,172]}},"heads":{"shape":"panicle","months":[4,5]},"cure":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.9,"chaparral":0.15,"mixed_forest":0.1,"conifer_forest":0.02,"riparian":0.2},"floor":1.1,"mid":1.0,"steep":0.9,"north":0.9,"shade":0.25,"disturbed":1.4},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["spring","summer","fall"]},{"animal":"microtus_californicus","part":"seeds","seasons":["summer","fall"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall","winter"]},{"animal":"meleagris_gallopavo","part":"seeds","seasons":["summer","fall","winter"]}],"cover_for":["microtus_californicus"]},"license":"CC BY-SA 4.0"},
  "bromus_diandrus": {"id":"bromus_diandrus","aliases":["ripgut","ripgut_brome","ripgut_grass"],"scientific":"Bromus diandrus","common":"ripgut brome","form":"grass","lifespan":"annual","native":false,"height_m":[0.4,1.0],"description":"A coarse annual brome with hairy leaves and a loose, drooping panicle of large spikelets, each seed tipped with a long, stiff awn; when they dry in June the barbed seeds catch in fur and work into the mouths, eyes and ears of animals. It crowds the bare and disturbed ground: road verges, old fields, the trampled shade under the oaks and the soil turned over by squirrels and gophers.","season_notes":{"winter":"Coarse, greyish green tufts from the first rains, thickest under the oaks.","spring":"Drooping, open heads in April with long, stiff awns; still eaten while soft and green.","summer":"Dry and sharp by June: the barbed seeds shatter and cling to fur and socks, and the grazers leave it.","fall":"Grey straw and the spent heads in the oak shade, the seed on the ground waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"type":"annual","height":1.15,"width":1.0,"palette":{"winter":{"root":[60,74,48],"tip":[114,150,86],"head":[140,148,104],"awn":[146,148,112]},"spring":{"root":[58,78,42],"tip":[120,162,78],"head":[168,166,112],"awn":[172,162,120]},"summer":{"root":[118,106,82],"tip":[204,184,136],"head":[214,200,162],"awn":[206,192,158]},"fall":{"root":[106,98,82],"tip":[184,172,138],"head":[194,186,160],"awn":[188,180,156]}},"heads":{"shape":"panicle","months":[4,6]},"cure":1.0},"habitat":{"classes":{"grassland":0.7,"oak_woodland":1.0,"chaparral":0.2,"mixed_forest":0.2,"conifer_forest":0.05,"riparian":0.3},"floor":1.1,"mid":1.0,"steep":0.8,"north":1.0,"shade":0.6,"disturbed":1.8},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer","fall"]}],"cover_for":["microtus_californicus"]},"license":"CC BY-SA 4.0"},
  "hordeum_murinum": {"id":"hordeum_murinum","aliases":["hare_barley","foxtail_barley","foxtail","wall_barley","mouse_barley"],"scientific":"Hordeum murinum","common":"hare barley","form":"grass","lifespan":"annual","native":false,"height_m":[0.2,0.5],"description":"A low annual barley with soft, bright green leaves and a dense, bristly spike of long awns that blushes reddish purple as it ripens in April and breaks apart in May into the barbed foxtails that catch in fur. It grows on bare and trampled ground: road edges, yards, the mounds and runways of ground squirrel colonies and the shade under oaks where cattle and deer rest.","season_notes":{"winter":"Bright, soft green tufts early in the rains, among the first grass to grow on bare ground.","spring":"Bristly spikes in March and April, tinged red-purple as they ripen; by May they shatter into foxtails.","summer":"Dry pale stubble and loose foxtails on the ground, clinging to every passing coat.","fall":"Bleached stubble on the bare patches, the seed in the dust."},"status":"agent draft, needs local sign-off","ground":{"type":"annual","height":0.6,"width":0.8,"palette":{"winter":{"root":[54,80,38],"tip":[124,178,76],"head":[150,170,98],"awn":[156,170,106]},"spring":{"root":[52,84,34],"tip":[134,188,72],"head":[168,148,112],"awn":[176,140,122]},"summer":{"root":[124,108,76],"tip":[222,198,136],"head":[232,214,162],"awn":[226,206,158]},"fall":{"root":[108,98,76],"tip":[198,180,138],"head":[208,196,164],"awn":[202,192,162]}},"heads":{"shape":"spike","months":[4,5]},"cure":1.0},"habitat":{"classes":{"grassland":0.7,"oak_woodland":0.8,"chaparral":0.05,"mixed_forest":0.05,"conifer_forest":0.0,"riparian":0.2},"floor":1.2,"mid":0.9,"steep":0.6,"north":0.9,"shade":0.4,"disturbed":2.0},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["spring","summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "eschscholzia_californica": {"id":"eschscholzia_californica","aliases":["california_poppy","poppy"],"scientific":"Eschscholzia californica","common":"California poppy","form":"forb","lifespan":"annual","native":true,"height_m":[0.15,0.5],"description":"The state flower: a mound of blue-green, finely cut leaves with silky orange cups, each on its own stalk, that open in the sun and close at dusk and in cloud; 15-50 cm tall. It flowers on open, sunny, well-drained ground from March into May, brightest on the south-facing grassy slopes and road banks, and a single plant may flower on into summer where the soil holds water.","season_notes":{"winter":"A small rosette of ferny grey-green leaves after the rains.","spring":"Orange cups from March, most in April; closed in the morning cold and the evening, wide open at noon.","summer":"Long thin seed pods split and fling the seeds; the plant dries to a few pale stalks.","fall":"Gone, but for seed in the ground waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"habit":"mound","leaf":{"shape":"ferny","size_m":0.06,"rgb":[112,142,118]},"flower":{"shape":"cup","rgb":[244,150,24],"size_m":0.05,"months":[3,6],"per_plant":5},"height_by_month":[0.25,0.4,0.7,1.0,1.0,0.8,0.5,0.3,0.0,0.0,0.1,0.2],"dead_rgb":[176,160,120],"density":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.45,"chaparral":0.3,"mixed_forest":0.05,"conifer_forest":0.0,"riparian":0.1},"floor":0.7,"mid":1.0,"steep":1.2,"north":0.5,"shade":0.0,"disturbed":1.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "lupinus_bicolor": {"id":"lupinus_bicolor","aliases":["miniature_lupine","lupine","annual_lupine"],"scientific":"Lupinus bicolor","common":"miniature lupine","form":"forb","lifespan":"annual","native":true,"height_m":[0.1,0.4],"description":"A small, hairy annual lupine with hand-shaped leaves of five to seven narrow leaflets and short spikes of little blue pea flowers, each with a white patch on its upper petal that turns pink-purple once the flower has been visited; 10-40 cm tall. It flowers from March into May across the open grassland, the oak savanna and the road banks, often in blue drifts with the poppies, and like all lupines it feeds the soil with the nitrogen fixed in its roots.","season_notes":{"winter":"Small rosettes of palmate leaves among the new grass after the rains.","spring":"Blue and white spikes from March, thickest in April; the white spots blush pink as the bees work them.","summer":"Hairy pods split and twist in June, flinging the seeds; the plant is gone by July.","fall":"Gone, but for seed in the ground waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"habit":"mound","leaf":{"shape":"palmate","size_m":0.04,"rgb":[98,132,92]},"flower":{"shape":"spike","rgb":[96,100,200],"size_m":0.05,"months":[3,5],"per_plant":4},"height_by_month":[0.25,0.4,0.7,1.0,0.9,0.5,0.0,0.0,0.0,0.0,0.1,0.18],"dead_rgb":[172,156,116],"density":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.5,"chaparral":0.35,"mixed_forest":0.05,"conifer_forest":0.0,"riparian":0.05},"floor":0.8,"mid":1.0,"steep":1.1,"north":0.6,"shade":0.1,"disturbed":1.5},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "lupinus_albifrons": {"id":"lupinus_albifrons","aliases":["silver_bush_lupine","bush_lupine","silver_lupine"],"scientific":"Lupinus albifrons","common":"silver bush lupine","form":"forb","lifespan":"perennial","native":true,"height_m":[0.5,1.5],"description":"A rounded, woody-based bush 0.5-1.5 m of silvery, silky-haired leaves, each spread like a hand of six to ten narrow leaflets, crowned from March into June by spikes 15-30 cm long of blue-purple pea flowers with a white or yellow spot. It grows on dry rocky slopes, road cuts, chaparral edges and in the oak savanna, evergreen all year, worked by hummingbirds and bees in spring and a shelter for quail, though its leaves and seeds are poisonous and little browsed.","season_notes":{"winter":"A silver-grey mound, the brightest leaves on the slope.","spring":"Blue-purple flower spikes from March, fullest in April and May, humming with bees.","summer":"Hairy pods split with a snap and throw the seeds; the silver leaves hold through the drought.","fall":"Evergreen and silver; the spent grey spikes still stand above the leaves."},"status":"agent draft, needs local sign-off","ground":{"habit":"mound","leaf":{"shape":"palmate","size_m":0.05,"rgb":[164,174,164]},"flower":{"shape":"spike","rgb":[112,102,192],"size_m":0.2,"months":[3,6],"per_plant":10},"height_by_month":[1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0],"dead_rgb":[140,128,104],"density":0.6},"habitat":{"classes":{"grassland":0.4,"oak_woodland":0.6,"chaparral":0.8,"mixed_forest":0.2,"conifer_forest":0.05,"riparian":0.1},"floor":0.6,"mid":1.0,"steep":1.4,"north":0.7,"shade":0.15,"disturbed":1.5},"relations":{"eaten_by":[{"animal":"callipepla_californica","part":"seeds","seasons":["summer"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]}],"cover_for":["callipepla_californica"]},"license":"CC BY-SA 4.0"},
  "claytonia_perfoliata": {"id":"claytonia_perfoliata","aliases":["miners_lettuce","miner_s_lettuce","indian_lettuce"],"scientific":"Claytonia perfoliata","common":"miner's lettuce","form":"forb","lifespan":"annual","native":true,"height_m":[0.05,0.3],"description":"A soft, succulent little annual whose upper leaves are fused right round the stem into a round green disc, with a short spray of tiny white flowers rising from its centre; long-stalked basal leaves sprawl beneath it, 5-30 cm tall. It carpets the moist, shaded ground under the oaks, along the creeks and on the north slopes from February into May, a fresh green that deer, rabbits, voles and quail all eat, and its shiny black seeds are carried off by ants.","season_notes":{"winter":"Bright green rosettes of long-stalked leaves in the shade of the oaks, thickening after each storm.","spring":"The round cup-leaves open, each with tiny white flowers at its centre, February into May.","summer":"Wilted and gone as the shade dries out in June.","fall":"Nothing above ground until the rains; the seed waits in the leaf litter."},"status":"agent draft, needs local sign-off","ground":{"habit":"sprawling","leaf":{"shape":"round","size_m":0.05,"rgb":[104,152,86]},"flower":{"shape":"tiny","rgb":[246,245,238],"size_m":0.006,"months":[2,5],"per_plant":12},"height_by_month":[0.5,0.8,1.0,1.0,0.7,0.0,0.0,0.0,0.0,0.0,0.15,0.3],"dead_rgb":[168,160,118],"density":0.8},"habitat":{"classes":{"grassland":0.15,"oak_woodland":1.0,"chaparral":0.15,"mixed_forest":0.6,"conifer_forest":0.3,"riparian":1.0},"floor":1.4,"mid":0.9,"steep":0.8,"north":1.6,"shade":0.8,"disturbed":0.7},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"leaves","seasons":["spring"]},{"animal":"callipepla_californica","part":"leaves","seasons":["winter","spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["spring"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "trifolium_willdenovii": {"id":"trifolium_willdenovii","aliases":["tomcat_clover","clover","native_clover"],"scientific":"Trifolium willdenovii","common":"tomcat clover","form":"forb","lifespan":"annual","native":true,"height_m":[0.1,0.4],"description":"A native annual clover with leaves of three long, narrow, finely toothed leaflets and round heads of purple-pink pea flowers tipped with white, each head sitting in a green, toothed collar; 10-40 cm, sprawling among the grass. It flowers in April and May in the grassland, the oak savanna and the moist open swales, where it and the other clovers are among the most heavily grazed plants in the foothills, and its roots fix nitrogen for the grasses around it.","season_notes":{"winter":"Small three-leaved seedlings low in the new grass after the rains.","spring":"Purple-pink heads with white tips in April and May, often in patches in the damper swales.","summer":"Dry brown heads hold the seed into June; the plant is gone by July.","fall":"Gone, but for seed in the ground waiting for rain."},"status":"agent draft, needs local sign-off","ground":{"habit":"sprawling","leaf":{"shape":"trifoliate","size_m":0.04,"rgb":[88,128,74]},"flower":{"shape":"ball","rgb":[190,104,168],"size_m":0.025,"months":[4,5],"per_plant":6},"height_by_month":[0.2,0.35,0.6,0.9,1.0,0.5,0.0,0.0,0.0,0.0,0.05,0.12],"dead_rgb":[166,146,112],"density":0.9},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.55,"chaparral":0.1,"mixed_forest":0.05,"conifer_forest":0.0,"riparian":0.3},"floor":1.4,"mid":1.0,"steep":0.7,"north":1.0,"shade":0.1,"disturbed":1.2},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"odocoileus_hemionus","part":"flowers","seasons":["spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"otospermophilus_beecheyi","part":"leaves","seasons":["spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "chlorogalum_pomeridianum": {"id":"chlorogalum_pomeridianum","aliases":["soap_plant","soaproot","amole","wavyleaf_soap_plant"],"scientific":"Chlorogalum pomeridianum","common":"soap plant","form":"forb","lifespan":"perennial","native":true,"height_m":[0.8,2.0],"description":"A perennial from a large bulb wrapped in coarse brown fibres: in winter and spring a sprawling rosette of long, narrow leaves with strongly wavy edges, 20-60 cm, then in early summer a bare, branched stalk 1-2 m tall whose small white star flowers open only in the late afternoon and evening. It grows scattered through the grassland, the oak woodland and the chaparral openings on dry slopes, where bears and pigs dig its bulb, and the bulb's soapy sap was used by the native peoples for washing and to stun fish.","season_notes":{"winter":"Rosettes of long, wavy-edged leaves spread over the ground among the new grass.","spring":"The rosettes at their fullest; a tall, bare stalk rises from the middle in May.","summer":"White starry flowers open in the evenings, May into July; the leaves wither as they open.","fall":"Only the dry, branched stalk stands, brown, over a bulb deep in the ground."},"status":"agent draft, needs local sign-off","ground":{"habit":"rosette","leaf":{"shape":"strap","size_m":0.4,"rgb":[100,132,92]},"flower":{"shape":"tiny","rgb":[244,242,234],"size_m":0.02,"months":[5,7],"per_plant":24},"height_by_month":[0.15,0.2,0.22,0.28,0.7,1.0,1.0,0.5,0.45,0.4,0.1,0.12],"dead_rgb":[150,128,96],"density":0.6},"habitat":{"classes":{"grassland":0.9,"oak_woodland":1.0,"chaparral":0.6,"mixed_forest":0.2,"conifer_forest":0.05,"riparian":0.05},"floor":0.7,"mid":1.0,"steep":1.1,"north":0.9,"shade":0.3,"disturbed":0.6},"relations":{"eaten_by":[{"animal":"ursus_americanus","part":"bulbs","seasons":["spring","fall"]},{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "achillea_millefolium": {"id":"achillea_millefolium","aliases":["yarrow","common_yarrow","western_yarrow"],"scientific":"Achillea millefolium","common":"yarrow","form":"forb","lifespan":"perennial","native":true,"height_m":[0.3,0.8],"description":"A perennial with soft, finely divided, feathery leaves that smell sharp and herbal when crushed, and flat-topped plates of many small white flower heads on stiff stems 30-80 cm tall. It flowers from May through August in the meadows, the grassland, the open woodland and along moist or disturbed ground from the foothills up into the high mountains, and its open plates feed a crowd of small bees, flies and beetles after most of the spring flowers are gone.","season_notes":{"winter":"Low tufts of green, feathery leaves stay through the cold.","spring":"The leafy clump fills out; flowering stems start to rise in May.","summer":"Flat white plates through June, July and August, green into the dry months where the ground holds water.","fall":"The stems dry to brown with dark seed heads; the feathery leaves stay at the base."},"status":"agent draft, needs local sign-off","ground":{"habit":"mound","leaf":{"shape":"ferny","size_m":0.08,"rgb":[102,134,94]},"flower":{"shape":"umbel","rgb":[240,238,224],"size_m":0.08,"months":[5,8],"per_plant":3},"height_by_month":[0.2,0.25,0.35,0.5,0.85,1.0,1.0,0.9,0.7,0.5,0.25,0.2],"dead_rgb":[140,118,90],"density":0.6},"habitat":{"classes":{"grassland":0.8,"oak_woodland":0.8,"chaparral":0.3,"mixed_forest":0.7,"conifer_forest":0.7,"riparian":0.6},"floor":1.3,"mid":1.0,"steep":0.8,"north":1.2,"shade":0.4,"disturbed":1.3},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["spring","summer"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["spring","summer"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "wyethia_helenioides": {"id":"wyethia_helenioides","aliases":["gray_mules_ears","mules_ears","grey_mules_ears"],"scientific":"Wyethia helenioides","common":"gray mule's ears","form":"forb","lifespan":"perennial","native":true,"height_m":[0.2,0.6],"description":"A stout perennial from a deep taproot with big, upright, oval leaves 20-40 cm long, grey and woolly when young, and a large yellow sunflower-like head 7-10 cm across on a short, leafy stem; 20-60 cm tall. It flowers from March into May in the blue oak savanna and on grassy slopes, most often on north- and east-facing ground and among rocks, where deer eat its young leaves and flowers in spring and quail and ground squirrels pick up its seed.","season_notes":{"winter":"The first woolly grey leaves push up through the grass after the rains.","spring":"Clumps of big grey ears, with one or a few large yellow heads each, March into May.","summer":"The leaves brown and wither in June; by July nothing shows above the root.","fall":"Nothing above ground; the taproot waits for the rains."},"status":"agent draft, needs local sign-off","ground":{"habit":"mound","leaf":{"shape":"ovate","size_m":0.3,"rgb":[148,160,138]},"flower":{"shape":"daisy","rgb":[242,196,40],"size_m":0.09,"months":[3,5],"per_plant":2},"height_by_month":[0.2,0.4,0.75,1.0,1.0,0.5,0.0,0.0,0.0,0.0,0.0,0.08],"dead_rgb":[150,134,108],"density":0.5},"habitat":{"classes":{"grassland":0.8,"oak_woodland":1.0,"chaparral":0.3,"mixed_forest":0.15,"conifer_forest":0.0,"riparian":0.05},"floor":0.6,"mid":1.0,"steep":1.2,"north":1.4,"shade":0.2,"disturbed":0.5},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["spring"]},{"animal":"odocoileus_hemionus","part":"flowers","seasons":["spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "dipterostemon_capitatus": {"id":"dipterostemon_capitatus","aliases":["blue_dicks","brodiaea","dichelostemma_capitatum","wild_hyacinth"],"scientific":"Dipterostemon capitatus","common":"blue dicks","form":"forb","lifespan":"perennial","native":true,"height_m":[0.2,0.6],"description":"Two or three long, grass-like leaves from a buried corm and a single bare stalk, 20-60 cm, topped by a tight head of blue-violet flowers that sways above the green grass from March into May. It grows everywhere on the open ground of the foothills, in grassland, oak savanna and chaparral openings, and its starchy corms are dug by ground squirrels, voles and bears, as they were by the people who lived here.","season_notes":{"winter":"Two or three narrow leaves from the corm after the rains, easy to miss among the grass blades.","spring":"The bare stalks rise in March and carry their blue-violet heads into May.","summer":"Leaves and stalks wither by June; the corm sleeps underground through the dry months.","fall":"Nothing above ground until the first rains wake the corm."},"status":"agent draft, needs local sign-off","ground":{"habit":"bulb","leaf":{"shape":"linear","size_m":0.3,"rgb":[96,130,82]},"flower":{"shape":"ball","rgb":[128,110,196],"size_m":0.035,"months":[3,5],"per_plant":1},"height_by_month":[0.2,0.3,0.7,1.0,1.0,0.3,0.0,0.0,0.0,0.0,0.05,0.15],"dead_rgb":[172,152,112],"density":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.8,"chaparral":0.5,"mixed_forest":0.2,"conifer_forest":0.05,"riparian":0.1},"floor":0.8,"mid":1.0,"steep":1.0,"north":0.9,"shade":0.2,"disturbed":0.8},"relations":{"eaten_by":[{"animal":"otospermophilus_beecheyi","part":"bulbs","seasons":["spring","summer"]},{"animal":"microtus_californicus","part":"bulbs","seasons":["winter","spring"]},{"animal":"ursus_americanus","part":"bulbs","seasons":["spring"]},{"animal":"odocoileus_hemionus","part":"flowers","seasons":["spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"flowers","seasons":["spring"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "amsinckia_menziesii": {"id":"amsinckia_menziesii","aliases":["fiddleneck","amsinckia_intermedia","common_fiddleneck"],"scientific":"Amsinckia menziesii","common":"common fiddleneck","form":"forb","lifespan":"annual","native":true,"height_m":[0.2,0.8],"description":"A bristly, rough-haired annual 20-80 cm tall whose small orange-yellow flowers open one after another along a spike that is coiled at the tip like the scroll of a fiddle. It comes up in masses from March to May in grassland, old fields and along the roads, and though quail, ground squirrels and voles take its nutlets, its leaves are poisonous to cattle and horses and deer leave it alone.","season_notes":{"winter":"A small rosette of narrow, bristly leaves among the new grass.","spring":"Orange-yellow flowers unroll along the coiled spikes from March; whole fields go orange in April.","summer":"The stems dry dark and prickly by June and drop their hard nutlets; gone by July.","fall":"Gone; the seed waits in the soil for the rains."},"status":"agent draft, needs local sign-off","ground":{"habit":"erect","leaf":{"shape":"linear","size_m":0.08,"rgb":[100,128,74]},"flower":{"shape":"coil","rgb":[236,158,40],"size_m":0.05,"months":[3,5],"per_plant":6},"height_by_month":[0.15,0.25,0.6,1.0,0.9,0.5,0.2,0.0,0.0,0.0,0.05,0.1],"dead_rgb":[128,108,78],"density":1.0},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.5,"chaparral":0.15,"mixed_forest":0.02,"conifer_forest":0.0,"riparian":0.1},"floor":1.2,"mid":1.0,"steep":0.7,"north":0.8,"shade":0.1,"disturbed":2.0},"relations":{"eaten_by":[{"animal":"callipepla_californica","part":"seeds","seasons":["spring","summer"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["spring","summer"]},{"animal":"microtus_californicus","part":"seeds","seasons":["spring","summer"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "erodium_cicutarium": {"id":"erodium_cicutarium","aliases":["filaree","redstem_filaree","storksbill","erodium_botrys"],"scientific":"Erodium cicutarium","common":"redstem filaree","form":"forb","lifespan":"annual","native":false,"height_m":[0.05,0.35],"description":"A flat rosette of ferny, finely cut leaves 5-20 cm across, the first green of the year after the rains, that sends out reddish sprawling stems with small pink five-petalled flowers and long, beaked fruits like a stork's bill. Brought from the Mediterranean with the first livestock, it now grows everywhere in the foothill grassland and savanna and is one of the most eaten plants of the hills: deer, rabbits, jackrabbits, ground squirrels, voles and quail feed on its leaves through winter and spring and on its seeds in summer.","season_notes":{"winter":"Flat ferny rosettes everywhere in the short grass, often tinged red by the cold; the first food of the year.","spring":"Small pink flowers from February, then the long beaked fruits; the stems sprawl outward.","summer":"The beaks split and twist, corkscrewing the seeds into the soil; the plant dries to reddish-brown stems and is gone by July.","fall":"Gone, until the first rains bring a new crop of rosettes."},"status":"agent draft, needs local sign-off","ground":{"habit":"rosette","leaf":{"shape":"ferny","size_m":0.07,"rgb":[92,128,72]},"flower":{"shape":"tiny","rgb":[206,122,176],"size_m":0.012,"months":[2,5],"per_plant":12},"height_by_month":[0.3,0.45,0.7,1.0,0.9,0.4,0.15,0.0,0.0,0.0,0.1,0.2],"dead_rgb":[150,98,72],"density":1.3},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.7,"chaparral":0.2,"mixed_forest":0.05,"conifer_forest":0.0,"riparian":0.1},"floor":1.0,"mid":1.0,"steep":0.9,"north":0.8,"shade":0.15,"disturbed":1.6},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["winter","spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"microtus_californicus","part":"seeds","seasons":["summer"]},{"animal":"otospermophilus_beecheyi","part":"leaves","seasons":["spring"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]},{"animal":"callipepla_californica","part":"leaves","seasons":["winter","spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]},{"animal":"meleagris_gallopavo","part":"leaves","seasons":["winter","spring"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "vicia_villosa": {"id":"vicia_villosa","aliases":["hairy_vetch","vetch","vicia_sativa"],"scientific":"Vicia villosa","common":"hairy vetch","form":"forb","lifespan":"annual","native":false,"height_m":[0.3,1.0],"description":"A soft-haired vine that climbs and sprawls over the grass to 30-100 cm, its pinnate leaves ending in curling tendrils, with one-sided sprays of purple pea flowers from April into June. A European forage and cover crop gone wild, it tangles the grassland, verges, old fields and oak savanna, where deer, rabbits and voles graze its leaves in spring and quail, turkeys and ground squirrels take the seeds from its pods.","season_notes":{"winter":"Low, soft green shoots among the grass after the rains.","spring":"The stems climb over the grass; purple flower sprays from April, thickest in May.","summer":"Flat pods ripen and split in June; the vines dry to a brown tangle and are gone by August.","fall":"Gone; hard seed in the soil waits for the rains."},"status":"agent draft, needs local sign-off","ground":{"habit":"climbing","leaf":{"shape":"pinnate","size_m":0.1,"rgb":[90,124,72]},"flower":{"shape":"pea","rgb":[138,82,184],"size_m":0.05,"months":[4,6],"per_plant":8},"height_by_month":[0.15,0.25,0.45,0.8,1.0,0.9,0.4,0.0,0.0,0.0,0.05,0.1],"dead_rgb":[132,112,82],"density":0.8},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.7,"chaparral":0.1,"mixed_forest":0.1,"conifer_forest":0.0,"riparian":0.3},"floor":1.3,"mid":1.0,"steep":0.7,"north":1.0,"shade":0.2,"disturbed":1.8},"relations":{"eaten_by":[{"animal":"odocoileus_hemionus","part":"leaves","seasons":["spring"]},{"animal":"sylvilagus_bachmani","part":"leaves","seasons":["winter","spring"]},{"animal":"lepus_californicus","part":"leaves","seasons":["spring"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]},{"animal":"callipepla_californica","part":"seeds","seasons":["summer"]},{"animal":"meleagris_gallopavo","part":"seeds","seasons":["summer"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "plagiobothrys_nothofulvus": {"id":"plagiobothrys_nothofulvus","aliases":["popcorn_flower","rusty_popcornflower"],"scientific":"Plagiobothrys nothofulvus","common":"rusty popcorn flower","form":"forb","lifespan":"annual","native":true,"height_m":[0.1,0.4],"description":"A slender annual 10-40 cm tall, a small rosette of narrow hairy leaves with thin stems that end in coiled sprays of tiny white five-petalled flowers with yellow eyes, like scattered popcorn. From March to May it flowers in sheets that whiten whole pastures and swales of the grassland and oak savanna, then seeds and vanishes by June, its nutlets food for quail and voles.","season_notes":{"winter":"Small rosettes of narrow, hairy leaves under the new grass.","spring":"Thin stems with tiny white flowers from March; whole pastures white in April.","summer":"The stems dry and the nutlets fall by June; gone in July.","fall":"Gone; the seed waits for the rains."},"status":"agent draft, needs local sign-off","ground":{"habit":"erect","leaf":{"shape":"linear","size_m":0.05,"rgb":[102,132,84]},"flower":{"shape":"tiny","rgb":[246,244,234],"size_m":0.008,"months":[3,5],"per_plant":20},"height_by_month":[0.15,0.25,0.6,1.0,0.8,0.3,0.0,0.0,0.0,0.0,0.05,0.1],"dead_rgb":[162,142,112],"density":1.2},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.6,"chaparral":0.1,"mixed_forest":0.02,"conifer_forest":0.0,"riparian":0.15},"floor":1.3,"mid":1.0,"steep":0.7,"north":0.9,"shade":0.1,"disturbed":1.0},"relations":{"eaten_by":[{"animal":"callipepla_californica","part":"seeds","seasons":["spring","summer"]},{"animal":"microtus_californicus","part":"seeds","seasons":["spring","summer"]},{"animal":"microtus_californicus","part":"leaves","seasons":["winter","spring"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
  "madia_elegans": {"id":"madia_elegans","aliases":["common_madia","tarweed","elegant_tarweed"],"scientific":"Madia elegans","common":"common madia","form":"forb","lifespan":"annual","native":true,"height_m":[0.3,1.2],"description":"A sticky, tar-scented annual 30-120 cm tall with narrow leaves and yellow daisy heads 2-4 cm across, often with a maroon ring at the centre, that open in the evening and the early morning and fold shut by midday. It is the one flower of the dry summer grassland, blooming from June into October on the golden slopes, oak savanna and road verges, and its oily seeds feed quail, doves, ground squirrels and voles in late summer and fall.","season_notes":{"winter":"Small rosettes of narrow, hairy leaves, hidden in the green grass.","spring":"The stems rise slowly as the grass grows tall, sticky and smelling of tar.","summer":"Yellow heads open each evening and morning above the cured grass, closed and dull in the afternoon heat.","fall":"Still flowering in September and October; the stalks stand dead and dark by November, dropping their seeds."},"status":"agent draft, needs local sign-off","ground":{"habit":"erect","leaf":{"shape":"linear","size_m":0.08,"rgb":[108,130,86]},"flower":{"shape":"daisy","rgb":[244,204,40],"size_m":0.03,"months":[6,10],"per_plant":8},"height_by_month":[0.08,0.1,0.15,0.3,0.5,0.75,0.95,1.0,1.0,0.95,0.7,0.05],"dead_rgb":[118,102,76],"density":0.9},"habitat":{"classes":{"grassland":1.0,"oak_woodland":0.6,"chaparral":0.3,"mixed_forest":0.1,"conifer_forest":0.02,"riparian":0.1},"floor":0.9,"mid":1.0,"steep":1.0,"north":0.7,"shade":0.05,"disturbed":1.4},"relations":{"eaten_by":[{"animal":"callipepla_californica","part":"seeds","seasons":["summer","fall"]},{"animal":"otospermophilus_beecheyi","part":"seeds","seasons":["summer","fall"]},{"animal":"microtus_californicus","part":"seeds","seasons":["fall"]}],"cover_for":[]},"license":"CC BY-SA 4.0"},
};
// END BUILTIN

const DEFAULTS = {
  form: 'tree', deciduous: null, height_m: [8, 12], variants: 3, aliases: [],
  trunk: { length_ratio: 0.8, radius_ratio: 0.04, taper: 0.7, flare: 1.2, bole_ratio: 0.3, base_size: 0.3,
    curve_deg: 0, curve_var_deg: 0, segments: 5, lean_deg: 0, stems: [1, 1], stem_spread_deg: 0,
    split_prob: 0, split_count: 2, split_angle_deg: 20, tropism: 0,
    bark_rgb: [100, 90, 80], bark_pattern: 'furrowed', twig_rgb: null },
  crown: { shape: 'spherical' },
  level: { count: 6, whorl: 0, start: null, down_angle_deg: 45, down_angle_tip_deg: null, down_angle_var_deg: 10,
    rotation_deg: 140, rotation_var_deg: 20, length_ratio: 0.5, length_var: 0.2, curve_deg: 0, curve_var_deg: 10,
    tropism: 0, taper: 1, radius_ratio: 0.5, segments: 2, droop_deg: 0, upturn_deg: 0 },
  foliage: { type: 'broadleaf', leaf_size_m: 0.05, leaf_shape: 'oval', cluster_m: 0.6, density: 8, start: 0.3,
    orientation: 'outward', droop: 0, crossed: false, parent_start: 0.75,
    colors: { winter: [80, 100, 60], spring: [90, 120, 60], summer: [80, 105, 60], fall: [90, 100, 60] },
    leaf_on: { winter: 1, spring: 1, summer: 1, fall: 1 } },
  lod: { near_tris_budget: 1600, near_sides: [7, 5, 3], mid_blobs: 5, mid_branches: 6, mid_sides: null,
    close_factor: null, close_scale: null },
  // Close-tier twigs (docs/species-library.md, "Twigs in the close tier"). Lengths are fractions of the
  // clump radius they serve (clumped foliage) or of the stem they fork from (unclumped: `split`).
  twigs: { count: [2, 3], prob: 1, length: 0.6, down_deg: 45, down_var_deg: 15, whorl: false, curve_deg: 0, curve_var_deg: 20,
    zigzag_deg: 0, droop_deg: 0, upturn_deg: 0, tropism: 0, segments: 1, sides: 3, radius_m: 0.008, taper: 0.6,
    fan_deg: 50, jitter: 0.15, along: 0.5, attach: 0.42, recentre: 0.5, dead: 0.5, split: 0.8, rgb: null },
};

// Dev override for comparing mid-LOD modes in place: ?mid_canopy=cards (or blobs).
const DEV_MID_CANOPY = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mid_canopy') : null;

function normalizeOne(raw) {
  const s = { ...DEFAULTS, ...raw };
  s.trunk = { ...DEFAULTS.trunk, ...raw.trunk };
  s.crown = { ...DEFAULTS.crown, ...raw.crown };
  s.levels = (raw.levels || []).map(l => ({ ...DEFAULTS.level, ...l }));
  const f = raw.foliage || {};
  s.foliage = { ...DEFAULTS.foliage, ...f, colors: { ...DEFAULTS.foliage.colors, ...f.colors }, leaf_on: { ...DEFAULTS.foliage.leaf_on, ...f.leaf_on } };
  s.lod = { ...DEFAULTS.lod, ...raw.lod };
  s.twigs = raw.twigs ? { ...DEFAULTS.twigs, ...raw.twigs } : null;
  s.shrub = s.form === 'shrub';
  // The ground layer (2026-10-29): grasses and forbs are records for grass.js, forbs.js, the field guide and the
  // animals' relations; nothing here grows them (vegetation.js, the far atlas and the lineup skip them).
  s.groundForm = s.form === 'grass' || s.form === 'forb';   // (`ground` is the record's own block: grass.js, forbs.js)
  // multi_stem_shrub_tree (toyon, elderberry): grown like a shrub (every stem spreads from the base, each
  // stem carries its own level-1 branches, stems fit the crown envelope) but drawn as a tree (tree LOD
  // defaults, near and mid caps, far impostors as trees rather than chaparral patches).
  s.multiStem = s.form === 'multi_stem_shrub_tree';
  s.shrubLike = s.shrub || s.multiStem;
  // Flowers and berries (docs/species-library.md, "Generator features for the foothill set"): drawn into
  // the card textures at the spray's twig ends in the seasons (or months) they show.
  if (f.flowers) s.foliage.flowers = { form: 'cluster', size_m: 0.1, density: 0.5, before_leaves: false, season: 'spring', ...f.flowers };
  if (f.berries) s.foliage.berries = { form: 'cluster', size_m: 0.06, density: 0.4, season: 'fall', ...f.berries };
  // Mid (180 m to 1.5 km, most of the triangles in a frame): a trunk there is 1-5 px wide and a limb
  // under a pixel, so trunks are square (4 sides) and limbs single straight 3-sided segments.
  if (!s.lod.mid_sides) s.lod.mid_sides = s.shrub ? [4, 3] : [4, 3];
  if (!s.lod.mid_segments) s.lod.mid_segments = s.shrub ? [2, 1] : [3, 1];   // [trunk, limbs] segments per stem
  if (s.lod.mid_cards == null) s.lod.mid_cards = s.shrub ? 24 : 40;         // mid cards per plant (clumps merged down to it)
  if (s.lod.close_factor == null) s.lod.close_factor = s.shrub ? 3 : 3.5;   // close-tier cards per near card
  if (s.lod.close_scale == null) s.lod.close_scale = 0.6;                  // close-tier card size / near card size
  if (s.deciduous == null) s.deciduous = (s.foliage.leaf_on.winter ?? 1) < 0.5;
  if (!s.lod.mid_canopy) s.lod.mid_canopy = 'cards';   // default: far foliage as enlarged leaf cards (continuous forest; blobs read as green balls)
  if (DEV_MID_CANOPY) s.lod.mid_canopy = DEV_MID_CANOPY;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Age classes and snags (docs/species-library.md, "Age classes and snags"). A file's `variants` may be
// a list of weighted classes instead of a count. Each class is the file plus a few overrides:
//   height_m       the class's height range (replaces the file's)
//   trunk_radius   x trunk.radius_ratio (slender saplings, thick veterans)
//   crown_scale    x the crown envelope's radii and level-1 limb length (broader veterans)
//   branches       x every level's branch count
//   gnarl          x curve variance and lean of trunk and limbs, and their zig-zag
//   leaf_density   x foliage.density
//   deadwood       a fraction (keeps the file's deadwood block, else inner limbs and twigs) or a
//                  deadwood block merged over the file's: dead limbs without leaves in a living crown
//   set            any other fields, merged over the file (levels by index), applied first
//   seeds          distinct trees grown for the class (default 1)
// The class marked `base` (else the one named mature, else the heaviest) is the file as written and keeps
// the old seeds, so its trees, the lineup's measured seeds and every metric are unchanged.
// `snag` { fraction, from, height_m, limbs, twigs, levels, broken_top, shorten, rgb, set } adds a dead
// tree grown as class `from` and then stripped: no foliage, grey wood, twigs and most limbs gone, the
// rest broken back, and for conifers the top snapped off at broken_top (fraction of the height).
// Vegetation draws a slot 0..SLOTS-1 per plant (one random number, as before) and variantSlots maps
// slots to classes in proportion to the weights, so the far impostors (which bake every slot) agree.
export const SLOTS = 12;
const CLASS_SEED = 0x10000;   // seeds at or above this carry a class: (class index + 1) * CLASS_SEED + slot seed
const clone = o => JSON.parse(JSON.stringify(o));
function applySet(r, set) {
  if (!set) return r;
  const merge = (a, b) => {
    if (b === null || typeof b !== 'object' || Array.isArray(b) || a === null || typeof a !== 'object' || Array.isArray(a)) return clone(b);
    const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = k in a ? merge(a[k], v) : clone(v); return o;
  };
  for (const [k, v] of Object.entries(set)) {
    if (k === 'levels' && Array.isArray(v)) r.levels = (r.levels || []).map((l, i) => v[i] ? { ...l, ...v[i] } : l);
    else r[k] = k in r ? merge(r[k], v) : clone(v);
  }
  return r;
}
function classRaw(raw, c) {
  const r = clone(raw); delete r.variants; delete r.snag;
  if (!c) return r;
  applySet(r, c.set);
  if (c.height_m) r.height_m = c.height_m.slice();
  const T = r.trunk = r.trunk || {}, L = r.levels = r.levels || [];
  if (c.trunk_radius) T.radius_ratio = (T.radius_ratio ?? DEFAULTS.trunk.radius_ratio) * c.trunk_radius;
  if (c.crown_scale) {
    const E = r.crown?.envelope; if (E?.profile) E.profile = E.profile.map(([h, w]) => [h, w * c.crown_scale]);
    if (L[0]) L[0].length_ratio = (L[0].length_ratio ?? DEFAULTS.level.length_ratio) * c.crown_scale;
  }
  if (c.branches) for (const l of L) l.count = Math.max(1, Math.round((l.count ?? DEFAULTS.level.count) * c.branches));
  if (c.gnarl) {
    T.curve_var_deg = (T.curve_var_deg ?? 0) * c.gnarl; T.lean_deg = (T.lean_deg ?? 0) * c.gnarl;
    for (const l of L) { l.curve_var_deg = (l.curve_var_deg ?? DEFAULTS.level.curve_var_deg) * c.gnarl; if (l.zigzag_deg) l.zigzag_deg *= c.gnarl; }
  }
  if (c.leaf_density) r.foliage = { ...r.foliage, density: (r.foliage?.density ?? DEFAULTS.foliage.density) * c.leaf_density };
  if (c.deadwood != null) r.deadwood = typeof c.deadwood === 'number'
    ? { where: 'inner', levels: [1, 2], shorten: 0.6, ...r.deadwood, fraction: c.deadwood } : { ...r.deadwood, ...c.deadwood };
  return r;
}
export function normalizeSpecies(raw) {
  const list = Array.isArray(raw.variants) ? raw.variants : null;
  if (!list || !list.length) { const s = normalizeOne(raw); s.classes = null; s.snag = null; return s; }
  let bi = list.findIndex(c => c.base);
  if (bi < 0) bi = list.findIndex(c => c.name === 'mature');
  if (bi < 0) bi = list.reduce((b, c, i) => (c.weight ?? 1) > (list[b].weight ?? 1) ? i : b, 0);
  const specs = list.map((c, i) => {
    const s = normalizeOne(classRaw(raw, i === bi && !c.set && !c.height_m ? null : c));
    s.className = c.name || `class ${i}`; s.classIndex = i; s.variants = raw.variants; return s;
  });
  const base = specs[bi];
  base.classes = list.map((c, i) => ({ name: specs[i].className, weight: c.weight ?? 1, seeds: Math.max(1, c.seeds || 1), base: i === bi, spec: specs[i], note: c.note || '' }));
  base.snag = null;
  const S = raw.snag;
  if (S && S.fraction > 0) {
    const from = list.find(c => c.name === (S.from || 'mature')) || list[bi];
    const r = classRaw(raw, from === list[bi] && !from.set && !from.height_m ? null : from);
    applySet(r, S.set); if (S.height_m) r.height_m = S.height_m.slice();
    delete r.epiphytes;   // mistletoe dies with its host
    r.deadwood = { ...(r.deadwood || {}), rgb: S.rgb || r.deadwood?.rgb || [150, 146, 136] };
    const s = normalizeOne(r);
    s.className = 'snag'; s.classIndex = list.length; s.variants = raw.variants;
    s.snagOf = { limbs: S.limbs ?? 0.6, twigs: S.twigs ?? 0, levels: S.levels ?? 1, broken_top: S.broken_top || null, shorten: S.shorten || [0.55, 1], splinter: S.splinter ?? true };
    base.snag = { name: 'snag', weight: S.fraction, seeds: 1, spec: s, from: from.name };
  }
  for (const c of base.classes) if (c.spec !== base) { c.spec.classes = base.classes; c.spec.snag = base.snag; }
  if (base.snag) { base.snag.spec.classes = base.classes; base.snag.spec.snag = base.snag; }
  return base;
}

// Largest-remainder apportionment of n slots to weights, every weight getting at least one (when n allows).
function apportion(ws, n) {
  const m = ws.length, c = new Array(m).fill(0), tot = ws.reduce((a, b) => a + b, 0) || 1;
  if (n < m) { ws.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, n).forEach(([, i]) => { c[i] = 1; }); return c; }
  const q = ws.map(w => n * w / tot);
  for (let i = 0; i < m; i++) c[i] = Math.max(1, Math.floor(q[i]));
  let left = n - c.reduce((a, b) => a + b, 0);
  while (left > 0) { let b = 0; for (let i = 1; i < m; i++) if (q[i] - c[i] > q[b] - c[b]) b = i; c[b]++; left--; }
  while (left < 0) { let b = -1; for (let i = 0; i < m; i++) if (c[i] > 1 && (b < 0 || q[i] - c[i] < q[b] - c[b])) b = i; c[b]--; left++; }
  return c;
}

// The tree in each of n slots of a species: [{ seed, cls, copy, snag }]. A file without classes gets
// the old seeds 1000 + v * 17 + id length. Within a class, slots cycle through its `seeds` trees.
const slotCache = new Map();
export function variantSlots(name, n = SLOTS) {
  const id = resolveSpecies(name), spec = LIBRARY[id], key = `${id}:${n}`;
  if (slotCache.has(key)) return slotCache.get(key);
  const legacy = j => 1000 + j * 17 + id.length;
  let out;
  if (!spec.classes) out = Array.from({ length: n }, (_, v) => ({ seed: legacy(v), cls: null, copy: v, snag: false }));
  else {
    const groups = spec.classes.map((c, i) => ({ ...c, i }));
    if (spec.snag) groups.push({ ...spec.snag, i: spec.classes.length, snag: true });
    const counts = apportion(groups.map(g => g.weight), n);
    out = [];
    groups.forEach((g, gi) => { for (let k = 0; k < counts[gi]; k++) { const j = k % g.seeds; out.push({ seed: (g.base ? 0 : (g.i + 1) * CLASS_SEED) + legacy(j), cls: g.name, copy: j, snag: !!g.snag }); } });
  }
  slotCache.set(key, out);
  return out;
}
// One tree per class (its first seed) plus the snag, for the lineup: [{ name, seed, weight, share, height_m, snag }],
// share = the fraction of plants the class gets with SLOTS slots.
export function ageClasses(name) {
  const id = resolveSpecies(name), spec = LIBRARY[id], slots = variantSlots(id, SLOTS), legacy = 1000 + id.length;
  if (!spec.classes) return [{ name: 'all', seed: legacy, weight: 1, share: 1, height_m: spec.height_m, snag: false }];
  const rows = spec.classes.map((c, i) => ({ name: c.name, seed: (c.base ? 0 : (i + 1) * CLASS_SEED) + legacy, weight: c.weight, height_m: c.spec.height_m, snag: false, note: c.note }));
  if (spec.snag) rows.push({ name: 'snag', seed: (spec.classes.length + 1) * CLASS_SEED + legacy, weight: spec.snag.weight, height_m: spec.snag.spec.height_m, snag: true, from: spec.snag.from });
  for (const r of rows) r.share = slots.filter(s => s.cls === r.name).length / slots.length;
  return rows;
}
// The parameter set a seed is grown from: the class it carries (variantSlots), else the base class.
function specForSeed(spec, seed) {
  if (!spec.classes || seed < CLASS_SEED) return spec;
  const c = Math.floor(seed / CLASS_SEED) - 1;
  if (c < spec.classes.length) return spec.classes[c].spec;
  return spec.snag ? spec.snag.spec : spec;
}

// ---------------------------------------------------------------------------------------------
// Loading: library/species/index.json lists the files. Top-level await, so importers (vegetation,
// the lineup page) see a filled LIBRARY. A slow or missing library falls back to BUILTIN.
const LIB_URL = new URL('../../library/species/', import.meta.url);

async function getJSON(url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, cache: 'no-cache' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export async function loadLibrary(base = LIB_URL, ms = 2500) {
  const species = {}, source = {}, raw = {};
  for (const [id, r] of Object.entries(BUILTIN)) { species[id] = normalizeSpecies(r); source[id] = 'built-in'; }
  try {
    const index = await getJSON(new URL('index.json', base), ms);
    const files = await Promise.all(index.species.map(id => getJSON(new URL(`${id}.json`, base), ms)
      .catch(e => { console.warn(`species ${id}: ${e.message}; using the built-in parameters`); return null; })));
    for (const r of files) if (r?.id) { species[r.id] = normalizeSpecies(r); source[r.id] = 'library'; raw[r.id] = r; }
  } catch (e) { console.warn(`species library not reachable (${e.message}); using the built-in parameter sets`); }
  return { species, source, raw };
}

const loaded = await loadLibrary();
export const LIBRARY = loaded.species;          // canonical id -> normalized parameters
export const LIBRARY_SOURCE = loaded.source;    // canonical id -> 'library' | 'built-in'
export const LIBRARY_RAW = loaded.raw;          // canonical id -> the file as fetched (lineup compares it to BUILTIN)
export const ALIASES = {};                      // old ids (blue_oak, ...) -> canonical id
for (const s of Object.values(LIBRARY)) for (const a of s.aliases || []) ALIASES[a] = s.id;
export const resolveSpecies = name => (LIBRARY[name] ? name : ALIASES[name]);

// Add (or replace) a species at run time, e.g. a file not yet listed in index.json (the lineup's ?add=
// parameter). Returns its canonical id.
export function addSpecies(raw, source = 'added') {
  const s = normalizeSpecies(raw);
  LIBRARY[raw.id] = s; LIBRARY_SOURCE[raw.id] = source; LIBRARY_RAW[raw.id] = raw;
  for (const a of s.aliases || []) ALIASES[a] = raw.id;
  for (const k of [...slotCache.keys()]) if (k.startsWith(raw.id + ':')) slotCache.delete(k);
  return raw.id;
}

// ---------------------------------------------------------------------------------------------
// Months. The client works in seasons; species that change within a season (drought-deciduous buckeye:
// full in April, dropping in July, bare by August) read a month, 1 to 12.99 (1.5 = mid-January). A
// season stands for its middle month (season.js MIDPOINT_DOY), and for today's date when it is today's
// season (the season selector's "tracks today's date").
export const SEASON_MONTH = { winter: 1.5, spring: 4.5, summer: 7.5, fall: 10.5 };
export const monthOfDate = (d = new Date()) => d.getMonth() + 1 + (d.getDate() - 0.5) / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const seasonMonth = (season, d = new Date()) => (season === seasonOfDate(d) ? monthOfDate(d) : SEASON_MONTH[season] ?? 7.5);
// Leaf-on of a species in a season (and month): foliage.leaf_on_by_month [12 values, January first, each
// the middle of its month, linear in between and round the year] when the file has it, else leaf_on[season].
export function leafOnAt(spec, season, month = null) {
  const F = spec.foliage, by = F.leaf_on_by_month;
  if (Array.isArray(by) && by.length === 12) {
    const t = (month ?? SEASON_MONTH[season] ?? 7.5) - 1.5, i = Math.floor(t), f = t - i, a = ((i % 12) + 12) % 12;
    return by[a] * (1 - f) + by[(a + 1) % 12] * f;
  }
  return F.leaf_on[season] ?? 1;
}
// Whether flowers or berries (foliage.flowers / foliage.berries) show: `months` [from, to] (1-12,
// inclusive, may wrap the year: [11, 2]) when given, else `season` (a season name or a list of them).
export function decoActive(D, season, month = null) {
  if (!D) return false;
  if (Array.isArray(D.months) && D.months.length === 2) {
    const m = Math.floor(month ?? SEASON_MONTH[season] ?? 7.5), [a, b] = D.months;
    return a <= b ? m >= a && m <= b : m >= a || m <= b;
  }
  return Array.isArray(D.season) ? D.season.includes(season) : D.season === season;
}

// ---------------------------------------------------------------------------------------------
// Skeleton

// Weber & Penn crown shapes: branch length factor from ratio = 1 at the crown base, 0 at the top.
function shapeRatio(shape, r) {
  r = Math.min(1, Math.max(0, r));
  switch (shape) {
    case 'conical': return 0.2 + 0.8 * r;
    case 'hemispherical': return 0.2 + 0.8 * Math.sin(0.5 * Math.PI * r);
    case 'cylindrical': return 1;
    case 'tapered_cylindrical': return 0.5 + 0.5 * r;
    case 'flame': return r <= 0.7 ? r / 0.7 : (1 - r) / 0.3;
    case 'inverse_conical': return 1 - 0.8 * r;
    case 'tend_flame': return r <= 0.7 ? 0.5 + 0.5 * r / 0.7 : 0.5 + 0.5 * (1 - r) / 0.3;
    default: return 0.2 + 0.8 * Math.sin(Math.PI * r);   // spherical
  }
}

class Stem {
  constructor(level, pts, rad) {
    this.level = level; this.pts = pts; this.rad = rad; this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(u) {   // point, direction and radius at fraction u of the arc length
    const s = u * this.len, P = this.pts; let i = 1;
    while (i < P.length - 1 && this.cum[i] < s) i++;
    const a = this.cum[i - 1], b = this.cum[i], t = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : 0;
    return { p: P[i - 1].clone().lerp(P[i], t), d: P[i].clone().sub(P[i - 1]).normalize(), r: this.rad[i - 1] + (this.rad[i] - this.rad[i - 1]) * t };
  }
}

function perpendicular(d, rnd) {
  const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(d);
  return v.lengthSq() < 1e-6 ? new THREE.Vector3(1, 0, 0).cross(d).normalize() : v.normalize();
}

// One stem: an optional straight first section (the bole), then `segs` segments that bend about a
// random axis by curve/segs each (plus per-segment variance), nudged toward vertical by tropism.
// droop/upturn bend about the horizontal axis instead (always down, then up): the inner half of the
// stem sags by `droop` degrees in all, the outer half turns back up by `upturn` (heavy pine limbs).
// zigzag: each segment also turns by +/- zigzag degrees, alternating sides (the growth-unit zig-zag of
// oak limbs and twigs). sinuous: a smooth S-bend of up to `sinuous` degrees per segment (manzanita).
function grow({ level, origin, dir, length, r0, taper, segs, curve = 0, curveVar = 0, tropism = 0, straight = 0, flare = 1, taperLen = length, droop = 0, upturn = 0, zigzag = 0, sinuous = 0, rnd }) {
  const d = dir.clone().normalize(), axis = perpendicular(d, rnd);
  const pts = [origin.clone()], p = origin.clone();
  if (straight > 0) {
    if (flare > 1 && straight > 0.8) pts.push(origin.clone().addScaledVector(d, Math.min(0.35, straight * 0.25)));
    p.addScaledVector(d, straight); pts.push(p.clone());
  }
  const rest = length - straight, n = rest > 1e-3 ? Math.max(1, segs) : 0, seg = rest / Math.max(1, n);
  const phase = sinuous ? rnd() * Math.PI * 2 : 0, side = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.applyAxisAngle(axis, (curve / n + (rnd() * 2 - 1) * curveVar / n) * DEG);
    if (sinuous) d.applyAxisAngle(axis, sinuous * Math.sin(phase + Math.PI * 2 * (i + 0.5) / Math.max(2, n)) * DEG);
    if (zigzag) { side.crossVectors(d, axis); if (side.lengthSq() > 1e-6) d.applyAxisAngle(side.normalize(), (i % 2 ? 1 : -1) * zigzag * (0.6 + 0.8 * rnd()) * DEG); }
    if (droop || upturn) {   // rotating d about d x UP by a positive angle tilts it up
      const h = new THREE.Vector3().crossVectors(d, UP);
      if (h.lengthSq() > 1e-4) { const inner = i < n / 2, m = Math.max(1, inner ? Math.ceil(n / 2) : n - Math.ceil(n / 2)); d.applyAxisAngle(h.normalize(), (inner ? -droop : upturn) / m * DEG); }
    }
    if (tropism) d.addScaledVector(UP, tropism).normalize();
    p.addScaledVector(d, seg); pts.push(p.clone());
  }
  if (pts.length < 2) pts.push(origin.clone().addScaledVector(d, Math.max(length, 0.01)));
  const st = new Stem(level, pts, []);
  st.rad = st.cum.map(s => Math.max(0.003, r0 * (1 - taper * Math.min(1, s / taperLen))));
  if (flare > 1) st.rad[0] = r0 * flare;
  st.boleIdx = straight > 0 ? (pts.length > 1 && flare > 1 && straight > 0.8 ? 2 : 1) : 0;   // index of the bole top
  st.r0base = r0;                                                                            // base radius without the flare
  return st;
}

function scaleStem(st, f) {   // about its base point; radii keep their taper
  const o = st.pts[0];
  for (let i = 1; i < st.pts.length; i++) st.pts[i].sub(o).multiplyScalar(f).add(o);
  st.cum = st.cum.map(v => v * f); st.len *= f;
}

// Crown envelope (crown.envelope), traced from photographs: `profile` [[h, r], ...] gives the crown
// radius r at height h, both as fractions of the tree height; nothing grows above the last h.
// `lobes` bulges (depth `lobe_depth`) and `asymmetry` (one heavier side) vary it with azimuth.
function makeEnvelope(E, H, rng) {
  if (!E || !Array.isArray(E.profile) || E.profile.length < 2) return null;
  const P = E.profile.slice().sort((a, b) => a[0] - b[0]);
  const ph = rng() * Math.PI * 2, azA = rng() * Math.PI * 2, lobes = E.lobes || 0, ld = E.lobe_depth || 0, asym = E.asymmetry || 0;
  const radial = h => {
    if (h <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) if (h <= P[i][0]) { const t = (h - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + t * (P[i][1] - P[i - 1][1]); }
    return -1;
  };
  const R = (y, az) => { const r = radial(y / H); return r < 0 ? -1 : r * H * (1 + ld * Math.cos(lobes * az + ph)) * (1 + asym * Math.cos(az - azA)); };
  const inside = (p, slack = 1) => { const r = R(p.y, Math.atan2(p.z, p.x)); return r >= 0 && Math.hypot(p.x, p.z) <= r * slack; };
  return { R, inside, fill: E.fill ?? 0.3, edge: E.edge ?? 1.08, profile: P };
}

// Surface area of an envelope (m^2): the lobed surface of revolution from the crown base to the top,
// plus the disc under the crown base (a crown is seen from below too). Sampled, not exact.
function envelopeArea(env, H, rings = 24, az = 16) {
  const P = env.profile, h0 = P[0][0] * H, h1 = P[P.length - 1][0] * H, da = Math.PI * 2 / az;
  let A = 0;
  for (let j = 0; j < az; j++) {
    const a = (j + 0.5) * da, r0 = Math.max(0, env.R(h0, a));
    A += 0.5 * r0 * r0 * da;
    for (let i = 0; i < rings; i++) {
      const ya = h0 + (h1 - h0) * i / rings, yb = h0 + (h1 - h0) * (i + 1) / rings;
      const ra = Math.max(0, env.R(ya, a)), rb = Math.max(0, env.R(Math.min(yb, h1 - 1e-6), a));
      A += 0.5 * (ra + rb) * da * Math.hypot(yb - ya, rb - ra);
    }
  }
  return A;
}

// Weber & Penn's pruning, by bisection: scale a stem about its base (shorter, or longer up to maxF)
// so every point lies inside the envelope times `slack`.
function fitStem(st, env, maxF, slack) {
  const o = st.pts[0], q = new THREE.Vector3();
  const ok = f => st.pts.every(p => env.inside(q.copy(p).sub(o).multiplyScalar(f).add(o), slack));
  let lo = 0.12, hi = maxF;
  if (ok(hi)) { scaleStem(st, hi); return; }
  if (!ok(lo)) { scaleStem(st, lo); return; }
  for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  scaleStem(st, lo);
}

// Child direction: tilt the parent direction by `down` toward the azimuth `az`, measured around the
// parent from its "up" side (world X for a vertical parent), so +/-90 degrees is sideways.
function childDir(pd, downDeg, az) {
  const ref = UP.clone().addScaledVector(pd, -pd.dot(UP));
  if (ref.lengthSq() < 0.09) ref.copy(X).addScaledVector(pd, -pd.dot(X));
  ref.normalize().applyAxisAngle(pd, az);
  return pd.clone().multiplyScalar(Math.cos(downDeg * DEG)).addScaledVector(ref, Math.sin(downDeg * DEG)).normalize();
}

// Triangles per foliage card: pine tufts are 2-3 crossed planes through the twig (foliage.needle_planes).
const cardPlanes = F => F.orientation === 'along' && F.needle_planes > 1 ? Math.round(F.needle_planes) : F.crossed ? 2 : 1;
// The base class of a species (the file as written) and the seed of its reference tree: foliage density
// per m^2 of crown envelope is measured on (or set for) this tree, and every other tree of the species
// scales from it by its own crown area.
const baseSpecOf = spec => (spec.classes && spec.classes.find(c => c.base)?.spec) || spec;
const refSeedOf = spec => 1000 + spec.id.length;

function woodTris(stems, sides) {
  let t = 0; for (const s of stems) { const k = sides[s.level] || 0; if (k > 0) t += k * 2 * (s.pts.length - 1); } return t;
}

// Cut a stem back to arc length L (keeps the radius at the cut: a broken end, not a tip).
function truncateStem(st, L) {
  if (L >= st.len - 1e-4) return;
  let i = 1; while (i < st.pts.length - 1 && st.cum[i] < L) i++;
  const a = st.cum[i - 1], b = st.cum[i], t = b > a ? Math.min(1, Math.max(0, (L - a) / (b - a))) : 0;
  const p = st.pts[i - 1].clone().lerp(st.pts[i], t), r = st.rad[i - 1] + (st.rad[i] - st.rad[i - 1]) * t;
  st.pts = st.pts.slice(0, i).concat([p]); st.rad = st.rad.slice(0, i).concat([r]);
  st.cum = st.cum.slice(0, i).concat([L]); st.kept = (st.kept ?? 1) * L / st.len; st.len = L;
}
// Snag: the grown tree, then dead (see normalizeSpecies). Own random stream; returns the new height.
// Leaves `cards` and `closeCards` holding a few zero-size markers along the upper trunk, so the canopy
// geometry is never empty: its bounds give the shadow proxy a slim spire and the impostor its cap height.
function makeSnag(S, seed, H, stems, cards, closeCards, mist, main, twigs = []) {
  const q = mulberry32(seed ^ 0x5a6b7c), [b0, b1] = S.broken_top || [1, 1], cut = H * (b0 + (b1 - b0) * q());
  const gone = new Set(), [s0, s1] = S.shorten;
  for (const s of stems) {
    s.dead = true;
    if (s.level === 0) {
      if (s.pts[0].y >= cut) { gone.add(s); continue; }
      const i = s.pts.findIndex(p => p.y > cut);
      if (i > 0) {
        const a = s.pts[i - 1], b = s.pts[i], t = (cut - a.y) / Math.max(1e-4, b.y - a.y);
        truncateStem(s, s.cum[i - 1] + t * (s.cum[i] - s.cum[i - 1]));
        if (S.splinter) {   // a splintered point on the break
          const d = s.at(1).d, r = s.rad[s.rad.length - 1], tip = s.pts[s.pts.length - 1];
          const off = new THREE.Vector3(q() - 0.5, 0, q() - 0.5).multiplyScalar(r * 0.8);
          s.pts.push(tip.clone().addScaledVector(d, r * (2 + 3 * q())).add(off)); s.rad.push(r * 0.25);
          s.cum.push(s.cum[s.cum.length - 1] + s.pts[s.pts.length - 1].distanceTo(tip)); s.len = s.cum[s.cum.length - 1];
        }
      }
      continue;
    }
    const par = s.parent;
    if (s.stub) { if (s.pts[0].y > cut) gone.add(s); continue; }
    if ((par && gone.has(par)) || s.pts[0].y > cut - 0.05 || (par && s.u != null && s.u > (par.kept ?? 1) - 0.02)) { gone.add(s); continue; }
    if (s.level > S.levels) { if (q() >= S.twigs) { gone.add(s); continue; } }
    else if (s.level === 1 && q() >= S.limbs) {   // broken off near the trunk: a short stub, or gone
      if (q() < 0.5) { gone.add(s); continue; }
      truncateStem(s, s.len * (0.06 + 0.14 * q())); s.stub = true; continue;
    }
    truncateStem(s, s.len * (s0 + (s1 - s0) * q()));
  }
  const kept = stems.filter(s => !gone.has(s)); stems.length = 0; stems.push(...kept);
  // Close-tier twigs: a `twigs` fraction survives, and only where its limb still reaches it (own stream).
  const tq = mulberry32(seed ^ 0x7719a5), kt = twigs.filter(t => !gone.has(t.parent) && t.u <= (t.parent.kept ?? 1) - 0.01 && tq() < S.twigs);
  kt.forEach(t => { t.dead = true; }); twigs.length = 0; twigs.push(...kt);
  cards.length = 0; closeCards.length = 0; mist.length = 0;
  let top = 0, lo = Infinity, reach = 0;
  for (const s of stems) for (const p of s.pts) top = Math.max(top, p.y);
  for (const s of stems) if (s.level === 1 && !s.stub) { lo = Math.min(lo, s.pts[0].y); for (const p of s.pts) reach = Math.max(reach, Math.hypot(p.x, p.z)); }
  if (!isFinite(lo)) lo = top * 0.5;
  const w = Math.max(0.3, 0.25 * reach), up = main ? main.at(1).d : UP;
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    const y = lo + (top - lo) * i / 2, m = { c: new THREE.Vector3(sx * w, y, 0), d: up, r: [0.5, 0.5, 0.5, 0.5, 0.5], zero: true };
    cards.push(m); closeCards.push(m);
  }
  return top;
}

// Close-tier twigs (spec.twigs; docs/species-library.md, "Twigs in the close tier"): one more level of
// short, low-poly stems that the close cards hang from, so a crown seen from a few metres is wood ending
// in leaves rather than leaves floating around a limb. Grown from the skeleton before the height fit,
// in their own random stream, and never part of the near or mid meshes, the near card list or the fit,
// so those tiers are unchanged.
//   Clumped foliage: each clump (foliage.clumps) gets `count` twigs forking from its bearing stem,
//   `length` x the clump radius long, `down_deg` off the stem (`whorl`: evenly round it), with the
//   level parameters curve, zigzag, droop, upturn and tropism. The fork point is moved back along the
//   stem by `recentre` x the group's mean reach (twig plus the card it carries), so the close cards,
//   which now sit on the twig tips, stay about the clump's centre: the crown gets twiggier, not bigger
//   or denser (1 recentres fully; 0.6 keeps the lineup's width, the cards' spread pulls in otherwise).
//   Unclumped foliage (chamise): `count` forks split off each bearing stem at `split` of its length;
//   the close cards beyond the split are shared between the stem and its forks.
//   Dead stems at the bearing levels get `dead` x the twigs (at least one) at their tips, grey and bare;
//   a snag keeps its `snag.twigs` fraction where the broken limb still reaches them (makeSnag).
//   Budget: `tris` (default half of lod.near_tris_budget) for the species' reference tree, scaled with the
//   tree's card count like the card cap (0.3-2.5x); over it, `prob` is lowered so fewer anchors get twigs.
function growTwigs(spec, seed, stems, bearing, centres, cardF, cardRatio = 1) {
  const TW = spec.twigs, F = spec.foliage, CL = F.clumps, DW = spec.deadwood, deepest = spec.levels.length;
  const tr = mulberry32(seed ^ 0x7e1a9b3), tsym = () => tr() * 2 - 1;
  const out = { stems: [], byClump: centres ? new Array(centres.length).fill(null) : null, byStem: new Map(), tw: TW };
  const nOf = () => TW.count[0] + Math.floor(tr() * (TW.count[1] - TW.count[0] + 1));
  const perTwig = TW.sides * 2 * Math.max(1, TW.segments), cap = (TW.tris ?? 0.5 * baseSpecOf(spec).lod.near_tris_budget) * Math.min(2.5, Math.max(0.3, cardRatio));
  const lo = centres ? deepest : Math.max(0, deepest - 1), isDeadEnd = s => s.dead && !s.stub && s.level >= lo && s.level <= deepest;
  const nDead = Math.max(1, Math.round(0.5 * (TW.count[0] + TW.count[1]) * TW.dead)), deadTris = stems.filter(isDeadEnd).length * TW.prob * nDead * perTwig;
  const planned = (centres && CL ? centres.length : bearing.length) * TW.prob * 0.5 * (TW.count[0] + TW.count[1]) * perTwig;
  const prob = TW.prob * Math.min(1, cap / Math.max(1, planned + deadTris)), probDead = prob;
  // how far past the twig tip the close card's centre sits (the card hangs from the tip by its base)
  const attachOff = F.cluster_m * cardF * spec.lod.close_scale * (cardPlanes(F) > 1 ? (F.tuft_base ?? 0.42) : TW.attach);
  const sprout = (par, uAnchor, n, len0, dead, centred) => {
    const d = par.at(Math.min(1, uAnchor)).d, a0 = tr() * Math.PI * 2, plan = [];
    for (let i = 0; i < n; i++) {
      const a = n > 1 || TW.whorl ? a0 + i * Math.PI * 2 / n + tsym() * (TW.whorl ? 0.25 : 0.6) : a0;
      plan.push({ dir: childDir(d, TW.down_deg + tsym() * TW.down_var_deg, a), L: len0 * (0.75 + 0.5 * tr()) });
    }
    let along = 0;
    if (centred) { for (const t of plan) along += t.dir.dot(d) * (t.L + (dead ? 0 : attachOff)); along *= TW.recentre / n; }
    const uB = Math.min(1, Math.max(0.02, uAnchor - along / Math.max(1e-3, par.len))), { p, r } = par.at(uB);
    return plan.map(t => {
      const st = grow({ level: deepest + 1, origin: p, dir: t.dir, length: t.L, r0: Math.min(r * 0.8, TW.radius_m * (0.8 + 0.4 * tr())), taper: TW.taper, segs: TW.segments,
        curve: TW.curve_deg, curveVar: TW.curve_var_deg, tropism: TW.tropism, droop: TW.droop_deg, upturn: TW.upturn_deg, zigzag: TW.zigzag_deg, rnd: tr });
      st.twig = true; st.parent = par; st.u = uB; st.dead = dead;
      out.stems.push(st); return st;
    });
  };
  if (centres && CL) {
    centres.forEach((q, ci) => {
      if (tr() >= prob) return;
      const R = (CL.radius_m ?? 0.8) * q.w * cardF;
      out.byClump[ci] = sprout(q.s, q.u, nOf(), R * TW.length, false, true);
    });
  } else {
    for (const [s] of bearing) {
      if (tr() >= prob || s.len * (1 - TW.split) < 0.02) continue;
      out.byStem.set(s, sprout(s, TW.split, nOf(), s.len * (1 - TW.split) * TW.length, false, false));
    }
  }
  const deadLen = (CL ? (CL.radius_m ?? 0.8) * cardF : F.cluster_m * 0.5) * TW.length * (DW?.shorten ?? 0.6);
  for (const s of stems) {
    if (!isDeadEnd(s) || tr() >= probDead) continue;
    const n = nDead;
    if (centres) sprout(s, 1, n, deadLen, true, true);
    else if (s.len * (1 - TW.split) >= 0.02) sprout(s, TW.split, n, s.len * (1 - TW.split) * TW.length * (DW?.shorten ?? 0.6), true, false);
  }
  return out;
}
// A close-tier card on a twig: clumped foliage picks its clump as before, then one of the clump's twigs,
// and hangs from it at or near its tip (the outer `along` of the twig, tip-biased; a little `jitter`,
// fanned up to `fan_deg` about the twig's direction there; cardGeometry puts the card's base on that point). Unclumped foliage: as placeCard, moved onto a fork past the split.
function placeOnTwig(rng, out, T, centres, CL, cardF, F, pickStem) {
  const rr = () => [rng(), rng(), rng(), rng(), rng()], g3 = () => (rng() + rng() + rng() - 1.5) / 1.5;
  if (centres) {
    const qi = Math.floor(rng() * centres.length), q = centres[qi], G = T.byClump[qi], R = (CL.radius_m ?? 0.8) * q.w * cardF;
    if (!G || !G.length) { out.push({ c: q.p.clone().add(new THREE.Vector3(g3(), g3() * (CL.flatten ?? 0.7), g3()).multiplyScalar(R)), d: q.d, r: rr(), k: qi }); return; }
    const t = G[Math.floor(rng() * G.length)], { p, d } = t.at(1 - T.tw.along * Math.pow(rng(), 1.5)), J = T.tw.jitter * R;
    const dir = childDir(d, T.tw.fan_deg * Math.sqrt(rng()), rng() * Math.PI * 2);
    out.push({ c: p.clone().add(new THREE.Vector3(g3(), g3(), g3()).multiplyScalar(J)), d: dir, r: rr(), k: qi, attach: true });
    return;
  }
  const along = F.orientation === 'along', [s, a, b] = pickStem(rng);
  let st = s, u = along || F.type === 'needle' ? b - (b - a) * Math.pow(rng(), 1.6) : a + (b - a) * rng();
  const forks = T.byStem.get(s), sp = T.tw.split;
  if (forks && forks.length && u > sp && rng() * (forks.length + 1) >= 1) { st = forks[Math.floor(rng() * forks.length)]; u = (u - sp) / (1 - sp); }
  const { p, d } = st.at(u);
  const j = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(F.cluster_m * cardF * (along ? 0.3 : 0.6));
  out.push({ c: p.add(j), d, r: rr() });
}

const skeletons = new Map();
function skeleton(spec, seed) {
  const key = `${spec.id}:${spec.className || ''}:${seed}`;
  if (skeletons.has(key)) return skeletons.get(key);
  const rnd = mulberry32(seed), sym = () => rnd() * 2 - 1;
  // The newer features draw from their own streams, so a file that does not use them grows exactly as before.
  const erng = mulberry32(seed ^ 0x3e7e1d), drnd = mulberry32(seed ^ 0x0dead5);
  const T = spec.trunk, L = spec.levels, F = spec.foliage, DW = spec.deadwood;
  const H = spec.height_m[0] + rnd() * (spec.height_m[1] - spec.height_m[0]);
  const lean = sym() * T.lean_deg * DEG, leanDir = rnd() * Math.PI * 2;
  const trunkLen = H * T.length_ratio, r0 = 0.5 * T.radius_ratio * H;
  const env = makeEnvelope(spec.crown.envelope, H, erng);
  // Dead stems (deadwood: { fraction, where: lower | inner | any, levels, rgb, shorten }): no foliage, grey.
  const deadP = (level, ratio) => {
    if (!DW || !DW.fraction || !(DW.levels || [1]).includes(level)) return 0;
    return Math.min(0.95, DW.fraction * (DW.where === 'lower' ? 2.2 * ratio * ratio : DW.where === 'inner' ? 2 * ratio : 1));
  };
  const stems = [], trunks = [];   // trunks: {stem, h0, h1} with h the fraction of the virtual trunk
  const nStems = T.stems[0] + Math.floor(rnd() * (T.stems[1] - T.stems[0] + 1)), az0 = rnd() * Math.PI * 2;
  let main = null;
  for (let k = 0; k < nStems; k++) {
    let dir = UP.clone(), origin = new THREE.Vector3(), len = trunkLen, rr = r0;
    // Trees keep stem 0 upright (the acorn game puts stash holes on it); shrubs spread every stem.
    if (k > 0 || (spec.shrubLike && nStems > 1)) {
      const az = az0 + (k / nStems) * Math.PI * 2 + sym() * 0.5, tilt = T.stem_spread_deg * (0.5 + 0.7 * rnd()) * DEG;
      dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
      origin.set(Math.cos(az), 0, Math.sin(az)).multiplyScalar(r0 * (spec.shrubLike ? 1.2 : 0.8));
      if (k > 0) { len *= 0.7 + 0.3 * rnd(); rr *= spec.shrubLike ? 0.8 + 0.3 * rnd() : 0.6 + 0.2 * rnd(); }
    }
    const boleLen = len * T.bole_ratio, split = rnd() < T.split_prob;
    // split_height: where the trunk forks (fraction of its length); default the bole top, as before.
    const sh = Math.max(T.bole_ratio, T.split_height ?? T.bole_ratio), high = sh > T.bole_ratio + 0.02;
    const common = { level: 0, origin, dir, r0: rr, taper: T.taper, taperLen: len, flare: k === 0 || spec.shrubLike ? T.flare : 1, rnd };
    if (split && boleLen > 0.05) {
      const low = high
        ? grow({ ...common, length: len * sh, segs: Math.max(1, Math.round(T.segments * sh)), straight: boleLen, curve: T.curve_deg * sh, curveVar: T.curve_var_deg, tropism: T.tropism })
        : grow({ ...common, length: boleLen, segs: 0, straight: boleLen });
      stems.push(low); trunks.push({ stem: low, h0: 0, h1: sh, len }); if (k === 0) main = low;
      const top = low.pts[low.pts.length - 1], rTop = low.rad[low.rad.length - 1], sa = rnd() * Math.PI * 2, ldir = high ? low.at(1).d : dir;
      for (let j = 0; j < T.split_count; j++) {
        const d = childDir(ldir, T.split_angle_deg * (0.7 + 0.6 * rnd()), sa + j * Math.PI * 2 / T.split_count + sym() * 0.4);
        const l = len * (1 - sh) * (0.8 + 0.2 * rnd());
        const st = grow({ level: 0, origin: top, dir: d, length: l, r0: rTop * 0.75, taper: T.taper, segs: Math.max(2, Math.round((T.segments - 1) * (1 - sh) / (1 - T.bole_ratio))),
          curve: T.curve_deg, curveVar: T.curve_var_deg, tropism: T.tropism, rnd });
        stems.push(st); trunks.push({ stem: st, h0: sh, h1: 1, len });
      }
    } else {
      const st = grow({ ...common, length: len, segs: T.segments, straight: boleLen, curve: T.curve_deg, curveVar: T.curve_var_deg, tropism: T.tropism, sinuous: T.sinuous_deg || 0 });
      if (spec.shrubLike && DW && (DW.levels || [1]).includes(0) && drnd() < DW.fraction) { st.dead = true; scaleStem(st, DW.shorten ?? 0.8); }   // grey dead stems inside a shrub
      if (env && spec.shrubLike) fitStem(st, env, st.dead ? 1 : 1 + env.fill, 0.85 + 0.15 * erng());   // shrub stems reach the envelope (the chamise vase)
      stems.push(st); trunks.push({ stem: st, h0: 0, h1: 1, len }); if (k === 0) main = st;
    }
  }
  // Short dead stubs on the clear bole (trunk.stubs: { count: [min, max], length_m }), ponderosa.
  if (T.stubs && main) {
    const [a, b] = T.stubs.count || [0, 0], n = a + Math.floor(drnd() * (b - a + 1)), tr0 = trunks.find(t => t.stem === main);
    for (let i = 0; i < n; i++) {
      const h = (0.12 + 0.86 * drnd()) * Math.min(T.base_size, tr0.h1), { p, d, r } = main.at(Math.min(0.98, h / tr0.h1));
      const st = grow({ level: 1, origin: p, dir: childDir(d, 75 + 30 * drnd(), drnd() * Math.PI * 2), length: (T.stubs.length_m || 0.4) * (0.4 + 0.9 * drnd()),
        r0: Math.max(0.01, r * (T.stubs.radius_ratio ?? 0.12)), taper: 0.5, segs: 1, rnd: drnd });
      st.dead = st.stub = true; stems.push(st);
    }
  }
  // Level 1 on the trunk(s): positions by virtual trunk height, length by the crown shape.
  let parents = [];
  if (L.length) {
    const P = L[0], base = T.base_size;
    let az = rnd() * Math.PI * 2;
    for (const tr of trunks) {
      const lo = Math.max(tr.h0, base), span = tr.h1 - lo; if (span <= 0) continue;
      const share = spec.shrubLike ? 1 : span / (1 - base) / Math.max(1, trunks.filter(t => t.h1 === tr.h1 && t.h0 === tr.h0).length);
      const n = Math.max(0, Math.round(P.count * share * (0.85 + 0.3 * rnd())));
      const whorl = P.whorl > 0 ? P.whorl : 1, nw = Math.ceil(n / whorl);
      for (let w = 0; w < nw; w++) {
        const h = lo + span * Math.min(0.98, (w + 0.5 + sym() * 0.3) / nw);
        if (P.whorl > 0) az += P.rotation_deg * DEG + sym() * P.rotation_var_deg * DEG;
        for (let j = 0; j < whorl && w * whorl + j < n; j++) {
          const a = P.whorl > 0 ? az + j * Math.PI * 2 / whorl + sym() * 0.35 : (az += P.rotation_deg * DEG + sym() * P.rotation_var_deg * DEG);
          const u = (h - tr.h0) / (tr.h1 - tr.h0), { p, d, r } = tr.stem.at(u);
          const ratio = (1 - h) / (1 - base);
          const down = P.down_angle_deg + (P.down_angle_tip_deg != null ? (P.down_angle_tip_deg - P.down_angle_deg) * (1 - ratio) : 0) + sym() * P.down_angle_var_deg;
          const len = tr.len * P.length_ratio * shapeRatio(spec.crown.shape, ratio) * (1 + sym() * P.length_var);
          if (len < 0.05) continue;
          const dead = !!tr.stem.dead || (DW ? drnd() < deadP(1, ratio) : false);
          const st = grow({ level: 1, origin: p, dir: childDir(d, down, a), length: dead ? len * (DW.shorten ?? 0.6) : len, r0: Math.min(r * 0.85, Math.max(0.004, r * P.radius_ratio)),
            taper: P.taper, segs: P.segments, curve: P.curve_deg, curveVar: P.curve_var_deg, tropism: P.tropism, droop: P.droop_deg, upturn: P.upturn_deg,
            zigzag: P.zigzag_deg || 0, sinuous: P.sinuous_deg || 0, rnd });
          if (env) dead ? fitStem(st, env, 1, 1) : fitStem(st, env, 1 + env.fill * (0.5 + 0.5 * erng()), 0.82 + 0.18 * erng());
          st.dead = dead; st.parent = tr.stem;
          stems.push(st); parents.push(st);
        }
      }
    }
  }
  // Deeper levels: count scaled by the parent's length, length = ratio * (parent - 0.6 * offset).
  for (let li = 1; li < L.length; li++) {
    const P = L[li], start = P.start ?? 0.15, maxLen = Math.max(...parents.map(s => s.len), 1e-3), next = [];
    for (const par of parents) {
      let n = Math.max(1, Math.round(P.count * (0.4 + 0.6 * par.len / maxLen)));
      if (par.dead) n = Math.max(1, Math.ceil(n / 2));
      let az = rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const u = Math.min(0.97, start + (1 - start) * (i + 0.5 + sym() * 0.4) / n);
        const a = P.rotation_deg < 0 ? (i % 2 ? 1 : -1) * (-P.rotation_deg + sym() * P.rotation_var_deg) * DEG : (az += (P.rotation_deg + sym() * P.rotation_var_deg) * DEG);
        const down = P.down_angle_deg + (P.down_angle_tip_deg != null ? (P.down_angle_tip_deg - P.down_angle_deg) * u : 0) + sym() * P.down_angle_var_deg;
        const len = P.length_ratio * par.len * (1 - 0.6 * u) * (1 + sym() * P.length_var);
        if (len < 0.03) continue;
        const dead = par.dead || (DW ? drnd() < deadP(li + 1, 1 - u) : false);
        const { p, d, r } = par.at(u);
        const st = grow({ level: li + 1, origin: p, dir: childDir(d, down, a), length: dead && !par.dead ? len * (DW.shorten ?? 0.6) : len, r0: Math.min(r * 0.85, Math.max(0.003, r * P.radius_ratio)),
          taper: P.taper, segs: P.segments, curve: P.curve_deg, curveVar: P.curve_var_deg, tropism: P.tropism, droop: P.droop_deg, upturn: P.upturn_deg,
          zigzag: P.zigzag_deg || 0, sinuous: P.sinuous_deg || 0, rnd });
        if (env) fitStem(st, env, 1, env.edge);
        st.dead = dead; st.parent = par; st.u = u;
        stems.push(st); next.push(st);
      }
    }
    parents = next;
  }
  // Foliage cards along the outer branches: the deepest level from `start` out, and the tips of
  // the level above. Count = density per metre of bearing stem, capped by the near triangle budget.
  const frnd = mulberry32(seed ^ 0x5bd1e995);
  const deepest = L.length;
  const bearing = [];
  for (const s of stems) {
    if (s.dead) continue;
    if (s.level === deepest) bearing.push([s, F.start, 1]);
    else if (deepest > 0 && s.level === deepest - 1) bearing.push([s, F.parent_start, 1]);
  }
  const weights = []; let acc = 0;
  for (const [s, a, b] of bearing) { acc += s.len * (b - a); weights.push(acc); }
  const sides = spec.lod.near_sides, wood = woodTris(stems, sides), perCard = 2 * cardPlanes(F);
  // Foliage per m^2 of crown (docs/species-library.md, "Foliage by crown size"). The old rule (density
  // per metre of bearing stem, capped by the near triangle budget) gave every tree of a species about
  // the same number of cards, so a big crown was sparse and a sapling dense. Now: the species' reference
  // tree (base class, first seed) sets the density, `foliage.cards_per_m2` (or, if the file does not set
  // it, the old rule's count for that tree over its crown area; either way within the near triangle
  // budget), and each tree gets it times its own
  // envelope area (times its class's density ratio), with cards up to 1.4x larger on big crowns so the
  // count does not grow as fast as the area. The card cap scales with the area too (0.15-2.5x the
  // reference tree's cards), and the mid card cap with the crown's diameter.
  const nOld = Math.max(12, Math.min(Math.round(F.density * acc), Math.floor((spec.lod.near_tris_budget - wood) / perCard)));
  let nCards = nOld, cardF = 1, crownArea = 0, cpm2 = 0, refArea = 0;
  const base = baseSpecOf(spec);
  let midCap = base.lod.mid_cards ?? spec.lod.mid_cards ?? 40, foliageInfo = null, foliageRef = null;
  if (env && acc > 0 && !spec.snagOf) {
    let topS = 0; for (const s of stems) for (const p of s.pts) topS = Math.max(topS, p.y);
    const k0 = H / Math.max(1e-3, topS);
    crownArea = envelopeArea(env, H) * k0 * k0;
    // The reference is the species' reference tree (base class, first seed: the lineup's first measured
    // tree): it keeps the card count it had (within lod.near_tris_budget), and every other tree scales
    // from its density by crown area.
    let ref;
    if (spec === base && seed === refSeedOf(base)) {
      const cpm2Base = F.cards_per_m2 ?? nOld / crownArea;
      const refCards = Math.max(12, Math.min(Math.round(cpm2Base * crownArea), Math.floor((spec.lod.near_tris_budget - wood) / perCard)));
      ref = { cpm2Base: refCards / crownArea, refArea: crownArea, refCards };
    } else ref = skeleton(base, refSeedOf(base)).foliageRef;
    const { cpm2Base, refArea, refCards } = ref;
    if (refArea > 0) {
      const ratio = crownArea / refArea;
      cardF = Math.min(1.4, Math.max(0.9, Math.pow(ratio, 0.25)));
      cpm2 = cpm2Base * F.density / Math.max(1e-6, base.foliage.density);
      // foliage cap: the reference tree's card count times the area ratio, with 1.5x headroom (0.15-2.5x)
      const cap = Math.round(refCards * Math.min(2.5, Math.max(0.15, 1.5 * ratio)));
      nCards = Math.max(12, Math.min(Math.round(cpm2 * crownArea / (cardF * cardF)), cap));
      // mid cap with the crown's diameter relative to the reference tree (which keeps lod.mid_cards)
      midCap = Math.round(midCap * Math.min(2.2, Math.max(spec.shrub ? 0.7 : 0.4, Math.sqrt(ratio))));   // small shrubs keep most of theirs
    }
    foliageRef = ref;
    foliageInfo = { cpm2Base, refArea, refCards, area: crownArea, cpm2, cardF, cards: nCards, midCap };
  }
  const along = F.orientation === 'along', CL = F.clumps;
  const pickStem = rng => { const x = rng() * acc; let k = 0; while (k < weights.length - 1 && weights[k] < x) k++; return bearing[k]; };
  // Clumped foliage (foliage.clumps: { radius_m, cards_per_clump or spacing_m, shell, flatten, tip_bias }):
  // clump centres at twig ends, dropped from the inner crown (`shell`, a fraction of the crown
  // radius), and every card placed in a clump; gaps between clumps let the sky through.
  let centres = null;
  if (CL && acc > 0) {
    const kr = mulberry32(seed ^ 0x51c3a7), nc = Math.max(4, Math.round(CL.cards_per_clump ? nCards / CL.cards_per_clump : acc / (CL.spacing_m ?? 1.5)));
    let cs = [];
    for (let i = 0; i < nc; i++) {
      const [s, a, b] = pickStem(kr), u = b - (b - a) * Math.pow(kr(), CL.tip_bias ?? 1.6), { p, d } = s.at(u);
      cs.push({ p, d, w: 0.6 + 0.8 * kr(), s, u });
    }
    if ((CL.shell || 0) > 0 && cs.length > 6) {
      const c = new THREE.Vector3(), rad = new THREE.Vector3();
      for (const q of cs) c.add(q.p); c.divideScalar(cs.length);
      for (const q of cs) rad.add(new THREE.Vector3((q.p.x - c.x) ** 2, (q.p.y - c.y) ** 2, (q.p.z - c.z) ** 2));
      rad.divideScalar(cs.length).set(Math.sqrt(rad.x), Math.sqrt(rad.y), Math.sqrt(rad.z)).multiplyScalar(2).addScalar(1e-3);
      const keep = cs.filter(q => q.p.clone().sub(c).divide(rad).length() >= CL.shell * (0.7 + 0.6 * kr()));
      if (keep.length >= 4) cs = keep;
    }
    centres = cs;
  }
  const placeCard = (rng, out) => {
    if (centres) {
      const q = centres[Math.floor(rng() * centres.length)], R = (CL.radius_m ?? 0.8) * q.w * cardF;
      const g3 = () => (rng() + rng() + rng() - 1.5) / 1.5;   // bell-shaped, about -1..1
      out.push({ c: q.p.clone().add(new THREE.Vector3(g3(), g3() * (CL.flatten ?? 0.7), g3()).multiplyScalar(R)), d: q.d, r: [rng(), rng(), rng(), rng(), rng()], k: centres.indexOf(q) });
      return;
    }
    const [s, a, b] = pickStem(rng);
    const u = along || F.type === 'needle' ? b - (b - a) * Math.pow(rng(), 1.6) : a + (b - a) * rng();
    const { p, d } = s.at(u);
    const j = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(F.cluster_m * cardF * (along ? 0.3 : 0.6));
    out.push({ c: p.add(j), d, r: [rng(), rng(), rng(), rng(), rng()] });
  };
  const cards = [];
  for (let i = 0; i < nCards && acc > 0; i++) placeCard(frnd, cards);
  // Close tier: more, smaller cards from the same distribution (own random stream, and not part of
  // the height fit below, so the near and mid trees are unchanged). Jitter stays at the near scale so
  // the crown fills the same volume and the near/close cross-fade keeps the silhouette. With spec.twigs
  // the close cards hang from the twigs instead (growTwigs, placeOnTwig): same count, same size.
  const crnd = mulberry32(seed ^ 0x2c1b3c6d), closeCards = [];
  const nClose = acc > 0 ? Math.round(cards.length * spec.lod.close_factor) : 0;
  const twigs = spec.twigs && acc > 0 ? growTwigs(spec, seed, stems, bearing, centres, cardF, foliageRef?.refCards ? cards.length / foliageRef.refCards : 1) : null;
  for (let i = 0; i < nClose; i++) twigs ? placeOnTwig(crnd, closeCards, twigs, centres, CL, cardF, F, pickStem) : placeCard(crnd, closeCards);
  // Mistletoe (epiphytes.mistletoe: { prob, count, radius_m }): evergreen balls on the outer limbs,
  // drawn with the wood so they stay in a bare winter crown.
  const MT = spec.epiphytes?.mistletoe, mist = [];
  if (MT) {
    const mr = mulberry32(seed ^ 0x6d157), hosts = stems.filter(s => !s.dead && s.level === Math.min(2, L.length));
    if (mr() < (MT.prob ?? 0.5) && hosts.length) {
      const [a, b] = MT.count || [1, 3], n = a + Math.floor(mr() * (b - a + 1));
      for (let i = 0; i < n; i++) mist.push({ c: hosts[Math.floor(mr() * hosts.length)].at(0.35 + 0.55 * mr()).p, r: (MT.radius_m ?? 0.4) * (0.6 + 0.8 * mr()) });
    }
  }
  // Fit the sampled height: scale the whole tree so its top is at H.
  let top = 0;
  for (const s of stems) for (const p of s.pts) top = Math.max(top, p.y);
  for (const c of cards) top = Math.max(top, c.c.y + F.cluster_m * cardF * 0.4);
  const k = H / top;
  for (const s of stems) { s.pts.forEach(p => p.multiplyScalar(k)); s.rad = s.rad.map(r => r * k); s.cum = s.cum.map(v => v * k); s.len *= k; }
  for (const c of cards) c.c.multiplyScalar(k);
  for (const c of closeCards) c.c.multiplyScalar(k);
  for (const m of mist) { m.c.multiplyScalar(k); m.r *= k; }
  const twigStems = twigs ? twigs.stems : [];
  for (const s of twigStems) { s.pts.forEach(p => p.multiplyScalar(k)); s.rad = s.rad.map(r => r * k); s.cum = s.cum.map(v => v * k); s.len *= k; }
  let Hs = H;
  if (spec.snagOf) Hs = makeSnag(spec.snagOf, seed, H, stems, cards, closeCards, mist, main, twigStems);
  // Crown centre and radii (for card normals, inner shading and mid-LOD blobs).
  const centre = new THREE.Vector3(), radii = new THREE.Vector3();
  for (const c of cards) centre.add(c.c);
  centre.divideScalar(Math.max(1, cards.length));
  for (const c of cards) { radii.x += (c.c.x - centre.x) ** 2; radii.y += (c.c.y - centre.y) ** 2; radii.z += (c.c.z - centre.z) ** 2; }
  radii.divideScalar(Math.max(1, cards.length)).set(Math.sqrt(radii.x), Math.sqrt(radii.y), Math.sqrt(radii.z)).multiplyScalar(2.0).addScalar(F.cluster_m * cardF * k * 0.3);
  main.r0base *= k;
  main.boleIdx = Math.min(main.boleIdx, main.pts.length - 1);
  const boleLen = main.cum[main.boleIdx];   // straight bole: the acorn game puts stash holes on it
  if (wood > spec.lod.near_tris_budget * 0.7) console.warn(`${spec.id}: wood uses ${wood} of ${spec.lod.near_tris_budget} near triangles; foliage gets ${cards.length} cards`);
  const sk = { spec, H: Hs, snag: !!spec.snagOf, lean, leanDir, stems, cards, closeCards, twigs: twigStems, mist, centre, radii, cluster: F.cluster_m * k * cardF, wood, clumpR: CL ? (CL.radius_m ?? 0.8) * k * cardF : 0,
    midCap, foliage: foliageInfo, foliageRef,
    stem: { len: boleLen, length: boleLen, r0: main.r0base, r1: main.rad[main.boleIdx], lean, leanDir } };
  skeletons.set(key, sk);
  return sk;
}

// ---------------------------------------------------------------------------------------------
// Meshing

class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.rank = []; this.idx = []; this.off = null; }
  get n() { return this.pos.length / 3; }
  v(p, nrm, c, uv = [0, 0], rank = 0) { this.pos.push(p.x, p.y, p.z); this.nor.push(nrm.x, nrm.y, nrm.z); this.col.push(c[0], c[1], c[2]); this.uv.push(uv[0], uv[1]); this.rank.push(rank); return this.n - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build(xf, { uv = false, rank = false, rankName = 'leafRank' } = {}) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(this.pos), nor = new Float32Array(this.nor);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    if (rank) g.setAttribute(rankName, new THREE.BufferAttribute(new Float32Array(this.rank), 1));
    if (this.off) g.setAttribute('cardOff', new THREE.BufferAttribute(new Float32Array(this.off), 4));
    g.setIndex(this.n < 65536 ? new THREE.BufferAttribute(new Uint16Array(this.idx), 1) : new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    if (xf) {
      g.applyMatrix4(xf);
      if (this.off) { const o = g.attributes.cardOff, v = new THREE.Vector3(); for (let i = 0; i < o.count; i++) { v.set(o.getX(i), o.getY(i), o.getZ(i)).applyMatrix4(xf); o.setXYZ(i, v.x, v.y, v.z); } }   // xf is a rotation: offsets turn with the tree
    }
    g.computeBoundingSphere();
    return g;
  }
}

function barkShade(pattern, rnd, k, ring) {
  switch (pattern) {
    case 'plates': return rnd() < 0.3 ? 0.32 : 0.95 + 0.25 * rnd();          // orange plates, black fissures
    case 'furrowed': return (k % 2 ? 0.72 : 1.05) * (0.9 + 0.2 * rnd());
    case 'checkered': return ((k + ring) % 2 ? 0.82 : 1.06) * (0.92 + 0.16 * rnd());
    case 'platy': return ((k + ring) % 2 ? 0.78 : 1.08) * (0.9 + 0.2 * rnd());       // thick plates (black oak, valley oak)
    case 'fibrous': return (k % 2 ? 0.76 : 1.06) * (0.9 + 0.2 * rnd());            // shreddy strips (incense cedar)
    case 'peeling_red': return rnd() < 0.2 ? 1.25 : 0.94 + 0.12 * rnd();          // pale patches of new bark (madrone)
    default: return 0.94 + 0.12 * rnd();                                       // smooth
  }
}

// Tube along stem points `idx`, `sides` around, frames by parallel transport. UVs for bark: u runs
// around (`uRep` texture widths per circumference; the seam column is duplicated so it wraps), v along
// the arc length in texture heights (`vScale` = 1 / tile height). `mark` fills the barkMix attribute.
function tube(G, stem, idx, sides, colorOf, rnd, uRep = 0, vScale = 1, mark = 1) {   // uRep 0: no UVs and no seam column (mid LOD)
  const P = idx.map(i => stem.pts[i]), R = idx.map(i => stem.rad[i]);
  const t = P[1].clone().sub(P[0]).normalize();
  let n = perpendicular(t, () => 0.37);
  const base = G.n, b = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Vector3(), seam = uRep > 0 ? 1 : 0, row = sides + seam;
  for (let i = 0; i < P.length; i++) {
    if (i === 0) dir.copy(t);
    else if (i === P.length - 1) dir.subVectors(P[i], P[i - 1]).normalize();
    else dir.subVectors(P[i], P[i - 1]).normalize().add(q.subVectors(P[i + 1], P[i]).normalize()).normalize();
    n.addScaledVector(dir, -n.dot(dir)).normalize(); b.crossVectors(dir, n);
    const cols = []; for (let k = 0; k < sides; k++) cols.push(colorOf(k, i));
    const v = stem.cum[idx[i]] * vScale;
    for (let k = 0; k < sides + seam; k++) {
      const a = (k / sides) * Math.PI * 2, nx = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      G.v(P[i].clone().addScaledVector(nx, R[i]), nx, cols[k % sides], [uRep * k / sides, v], mark);
    }
  }
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = base + i * row + k, bb = base + i * row + (seam ? k + 1 : (k + 1) % sides), c = a + row, d = bb + row;
    G.tri(a, bb, c); G.tri(bb, d, c);
  }
}

function evenIdx(len, segs) {
  const m = Math.min(segs, len - 1), out = [];
  for (let i = 0; i <= m; i++) out.push(Math.round(i * (len - 1) / m));
  return out;
}

// Mistletoe ball: a lumpy low-poly sphere in the wood mesh (barkMix 0: never textured as bark).
function mistletoe(G, m, detail, rnd) {
  const sph = new THREE.IcosahedronGeometry(1, detail), sp = sph.attributes.position, base = G.n;
  const col = [70, 92, 46].map(srgbToLin), ph = rnd() * 6.28, nn = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) {
    nn.set(sp.getX(i), sp.getY(i), sp.getZ(i)).normalize();
    const lump = 0.8 + 0.25 * Math.sin(nn.x * 5 + ph) * Math.sin(nn.y * 4 + 2 * ph) + 0.12 * rnd();
    p.copy(nn).multiplyScalar(m.r * lump).add(m.c);
    const sh = 0.7 + 0.3 * (nn.y * 0.5 + 0.5);
    G.v(p, nn, col.map(v => v * sh), [0, 0], 0);
  }
  for (let i = 0; i < sp.count; i += 3) G.tri(base + i, base + i + 1, base + i + 2);   // non-indexed source: one triangle per three vertices
  sph.dispose();
}

function woodGeometry(sk, lod, rnd) {
  const spec = sk.spec, T = spec.trunk, Gb = new Geo();
  const bark = T.bark_rgb.map(srgbToLin), twig = (T.twig_rgb || T.bark_rgb).map(srgbToLin), depth = Math.max(1, spec.levels.length);
  const dead = (spec.deadwood?.rgb || [150, 146, 136]).map(srgbToLin);
  const near = lod === 'near';
  const sides = near ? spec.lod.near_sides : spec.lod.mid_sides;
  const [tw, th] = T.bark?.tile_m || [0.5, 1.0];
  let stems = sk.stems;
  if (!near) {   // mid: trunks plus the longest level-1 limbs only
    const l1 = stems.filter(s => s.level === 1 && !s.stub).sort((a, b) => b.len - a.len).slice(0, spec.lod.mid_branches);
    stems = stems.filter(s => s.level === 0).concat(l1);
  }
  for (const s of stems) {
    const k = sides[s.level] || 0; if (k < 3) continue;
    const mix = s.level === 0 ? 0 : Math.min(1, 0.6 + 0.4 * (s.level - 1) / Math.max(1, depth - 1)), c0 = s.dead ? dead : bark.map((v, i) => v + (twig[i] - v) * mix);
    const idx = near ? s.pts.map((_, i) => i) : evenIdx(s.pts.length, spec.lod.mid_segments[s.level === 0 ? 0 : 1]);
    const uRep = near ? Math.max(1, Math.round(2 * Math.PI * (s.r0base ?? s.rad[0]) / tw)) : 0;
    tube(Gb, s, idx, k, (kk, ring) => { const f = s.dead ? 0.85 + 0.25 * rnd() : s.level === 0 ? barkShade(T.bark_pattern, rnd, kk, ring) : 0.9 + 0.2 * rnd(); return c0.map(v => v * f); }, rnd, uRep, 1 / th);
  }
  for (const m of sk.mist || []) mistletoe(Gb, m, near ? 1 : 0, rnd);
  return Gb;
}

// `keep` < 1 draws a subset of the cards, enlarged to keep the same leaf area (the optional mid-LOD card mode).
// `cards` and `scale` select the close tier: its own card list at a smaller size.
function cardGeometry(sk, keep = 1, cards = sk.cards, scale = 1, onQuad = null) {
  const spec = sk.spec, F = spec.foliage, G = new Geo(), C = sk.centre, Rr = sk.radii;
  const leaf = F.colors.summer.map(srgbToLin), size = scale * sk.cluster * Math.min(4, 1 / Math.sqrt(keep));   // area-preserving (unclumped mid cards)
  const out = new THREE.Vector3(), nrm = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), vn = new THREE.Vector3();
  // Mid cards (keep < 1) also carry each vertex's offset from its card's centre and the card's thinning
  // order (cardOff.xyz, .w), so the mid material can thin and enlarge them with distance (canopyMaterial).
  // The outermost THIN_OUTER of the cards are the outline and are never thinned (order 0); the rest get
  // evenly spaced orders in (0, 1] in random sequence, so the inside thins evenly.
  const corner = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [-0.5, 0.5, 0, 1], [0.5, 0.5, 1, 1]];
  const planes = keep < 1 ? Math.max(1, Math.round(spec.lod.mid_planes ?? cardPlanes(F))) : cardPlanes(F);   // lod.mid_planes: mid (whole-clump) cards
  let order = 0;
  if (keep < 1) G.off = [];
  let plane = 0;   // the quad's plane on its card (onQuad: the leaf level reads each close card's frame)
  const quad = (c, n, u, w, h, col, rank, outN) => {
    if (onQuad) onQuad(c, n, u, w, col, rank, outN, plane);
    right.crossVectors(u, n).normalize();
    const base = G.n;
    for (const [sx, sy, tu, tv] of corner) {
      const p = c.clone().addScaledVector(right, sx * w).addScaledVector(u, sy * h);
      vn.subVectors(p, C).divide(Rr).normalize().multiplyScalar(0.8).addScaledVector(outN, 0.2).normalize();   // crown-shaped normals
      G.v(p, vn, col, [tu, tv], rank);
      if (G.off) G.off.push(p.x - c.x, p.y - c.y, p.z - c.z, order);
    }
    G.tri(base, base + 1, base + 2); G.tri(base + 1, base + 3, base + 2);
  };
  // Mid cards from clumped foliage: one card per clump (the one nearest the clump's mean), sized to
  // cover the clump, so the enlarged cards do not stack on each other (overdraw) and the far crown keeps
  // its lumps and gaps. Unclumped foliage: every 1/keep-th card, enlarged, as before.
  // More clumps than lod.mid_cards: the closest pair is merged, repeatedly, into one card at the pair's
  // mean with their summed leaf area (up to the pair's extent). Distance is weighted by how far out in
  // the crown the pair sits, so inner clumps merge first and the outline keeps its lumps.
  let list = null, clumpSize = 0;
  if (keep < 1 && cards.length && cards[0].k != null && cards === sk.cards) {
    const by = new Map();
    for (const c of cards) { const e = by.get(c.k) || { n: 0, m: new THREE.Vector3(), best: null, bd: Infinity }; e.n++; e.m.add(c.c); by.set(c.k, e); }
    for (const e of by.values()) e.m.divideScalar(e.n);
    for (const c of cards) { const e = by.get(c.k), d = c.c.distanceToSquared(e.m); if (d < e.bd) { e.bd = d; e.best = c; } }
    let gs = [...by.values()].map(e => ({ n: e.n, m: e.m, r: 0, best: e.best }));
    const cap = Math.max(4, sk.midCap ?? spec.lod.mid_cards ?? 40), tmp = new THREE.Vector3();
    const outer = p => Math.min(1.5, tmp.subVectors(p, C).divide(Rr).length() * 2);   // 0 at the crown centre, ~1 at its edge
    while (gs.length > cap) {
      let bi = 0, bj = 1, bc = Infinity;
      for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
        const d = gs[i].m.distanceTo(gs[j].m) + gs[i].r + gs[j].r, cst = d * (0.35 + outer(tmp.addVectors(gs[i].m, gs[j].m).multiplyScalar(0.5)));
        if (cst < bc) { bc = cst; bi = i; bj = j; }
      }
      const a = gs[bi], b = gs[bj], n = a.n + b.n, m = a.m.clone().multiplyScalar(a.n).addScaledVector(b.m, b.n).divideScalar(n);
      const r = Math.max(a.m.distanceTo(m) + a.r, b.m.distanceTo(m) + b.r);
      gs[bi] = { n, m, r, best: { ...(a.n >= b.n ? a.best : b.best), c: m } };
      gs.splice(bj, 1);
    }
    list = gs.map(e => ({ ...e.best, mid: Math.min(Math.sqrt(e.n) * 0.85, (2.1 * sk.clumpR + 2 * e.r + 0.6 * sk.cluster) / sk.cluster) }));
    clumpSize = sk.cluster * scale;   // times each clump's own factor: the clump's leaf area, up to its extent
  }
  const step = list ? 1 : 1 / keep, src = list || cards;
  const orderOf = new Map();
  if (G.off) {
    const drawn = []; for (let ci = 0; ci < src.length; ci += step) drawn.push(src[Math.floor(ci)]);
    const depthOf = c => out.subVectors(c.c, C).divide(Rr).length() + 0.08 * c.r[2];   // a little jitter breaks ties
    const byDepth = drawn.map(c => [c, depthOf(c)]).sort((a, b) => b[1] - a[1]).map(([c]) => c), nOuter = Math.ceil(THIN_OUTER * drawn.length);
    const inner = byDepth.slice(nOuter).sort((a, b) => a.r[3] - b.r[3]);
    byDepth.slice(0, nOuter).forEach(c => orderOf.set(c, 0));
    inner.forEach((c, i) => orderOf.set(c, (i + 1) / inner.length));
  }
  for (let ci = 0; ci < src.length; ci += step) {
    const card = src[Math.floor(ci)];
    order = orderOf.get(card) ?? 0;
    const [r0, r1, r2, r3, r4] = card.r;
    out.subVectors(card.c, C).divide(Rr); const depth = out.length(); out.normalize();
    const d = card.d;
    if (F.orientation === 'along') {
      nrm.copy(out).addScaledVector(d, -out.dot(d)); if (nrm.lengthSq() < 1e-4) nrm.copy(perpendicular(d, () => r0)); nrm.normalize();
      if (F.twist_deg) nrm.applyAxisAngle(d, (r1 - 0.5) * 2 * F.twist_deg * DEG);   // needle tufts turned about the twig: volume, not a sheet
    }
    else {
      nrm.set(r0 - 0.5, r1 - 0.5, r2 - 0.5).multiplyScalar(1.8).add(out);
      if (F.orientation === 'vertical') nrm.y = 0;
      if (nrm.lengthSq() < 1e-4) nrm.set(1, 0, 0); nrm.normalize();
    }
    up.copy(d).addScaledVector(nrm, -d.dot(nrm)); if (up.lengthSq() < 1e-4) up.copy(perpendicular(nrm, () => r1)); up.normalize();
    up.applyAxisAngle(nrm, (r3 - 0.5) * (F.orientation === 'along' ? 0.5 : 2 * (F.roll_deg ?? 40) * DEG));   // foliage.roll_deg: sprays turned in their plane
    if (planes > 1) {
      // Needle tufts: the shoots of one branch end fan out (foliage.tuft_spread_deg, out of the card
      // plane; the in-plane part is above) and turn up toward the light (foliage.tuft_up, 0-1).
      const h = (r0 * 91.37 + r2 * 13.71 + r4 * 7.13) % 1;
      right.crossVectors(up, nrm).normalize();
      const tilt = (h - 0.5) * 2 * (F.tuft_spread_deg ?? 20) * DEG;
      up.applyAxisAngle(right, tilt); nrm.applyAxisAngle(right, tilt);
      if (F.tuft_up) { up.lerp(UP, F.tuft_up).normalize(); nrm.addScaledVector(up, -nrm.dot(up)).normalize(); }
    }
    const s = card.zero ? 0 : (list ? clumpSize * Math.max(1, card.mid) : size) * (0.75 + 0.5 * r2);
    const aoMin = F.ao_min ?? 0.62, ao = (aoMin + (1 - aoMin) * THREE.MathUtils.smoothstep(depth, 0.15, 1.0)) * (0.82 + 0.18 * (out.y * 0.5 + 0.5));
    const j = 0.85 + 0.3 * r1;
    const col = leaf.map((v, i) => v * j * ao * (1 + (i === 1 ? 0.06 : -0.03) * (r4 - 0.5)));
    if (planes > 1) {
      // Crossed planes through the tuft's axis, so from any side the needles read as lines radiating
      // from the shoot. Near and close cards sit with their base on the branch (the drawn twig starts
      // at the card's lower edge); mid cards (a whole clump) stay centred on it.
      const cc = list ? card.c : card.c.clone().addScaledVector(up, s * (F.tuft_base ?? 0.42));
      for (let k = 0; k < planes; k++) { plane = k; quad(cc, k ? vn.copy(nrm).applyAxisAngle(up, k * Math.PI / planes).clone() : nrm, up, s, s, col, r4, out); }
    } else {
      // close cards on twigs (card.attach) hang from the twig tip by their base, where the spray's drawn stem starts
      const cc = card.attach ? card.c.clone().addScaledVector(up, s * (spec.twigs?.attach ?? 0.42)) : card.c;
      plane = 0; quad(cc, nrm, up, s, s, col, r4, out);
      plane = 1; if (F.crossed) quad(cc, nrm.clone().cross(up).normalize(), up, s, s, col, r4, out);
    }
  }
  return G;
}

// k-means of the cards into a few ellipsoids for the mid LOD. Each blob is lumpy (a smooth noise
// on the radius) with mottled vertex colour, and sized to the cards' spread times lod.mid_blob_scale
// (below 1 for open, see-through crowns), so it reads as a clump of foliage rather than a balloon.
function blobGeometry(sk, rnd) {
  const spec = sk.spec, F = spec.foliage, G = new Geo(), cards = sk.cards, scale = spec.lod.mid_blob_scale ?? 1;
  const k = Math.max(1, Math.min(spec.lod.mid_blobs, cards.length));
  const sorted = cards.map(c => c.c).sort((a, b) => a.y - b.y);
  const cent = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / k)].clone());
  let assign = new Array(sorted.length).fill(0);
  for (let it = 0; it < 8; it++) {
    assign = sorted.map(p => { let best = 0, bd = Infinity; cent.forEach((c, i) => { const dd = c.distanceToSquared(p); if (dd < bd) { bd = dd; best = i; } }); return best; });
    const sum = cent.map(() => [new THREE.Vector3(), 0]);
    sorted.forEach((p, i) => { sum[assign[i]][0].add(p); sum[assign[i]][1]++; });
    sum.forEach(([s, n], i) => { if (n) cent[i].copy(s).divideScalar(n); });
  }
  const leaf = F.colors.summer.map(srgbToLin);
  cent.forEach((c, b) => {
    const pts = sorted.filter((_, i) => assign[i] === b); if (!pts.length) return;
    const v = new THREE.Vector3();
    for (const p of pts) v.add(new THREE.Vector3((p.x - c.x) ** 2, (p.y - c.y) ** 2, (p.z - c.z) ** 2));
    v.divideScalar(pts.length);
    const R = new THREE.Vector3(Math.sqrt(v.x), Math.sqrt(v.y), Math.sqrt(v.z)).multiplyScalar(1.5 * scale).addScalar(sk.cluster * 0.25 * scale)
      .max(new THREE.Vector3(1, 1, 1).multiplyScalar(sk.cluster * 0.4 * scale));
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28], fq = 2.2 + rnd() * 1.5;
    const lump = n => 1 + 0.16 * Math.sin(n.x * fq + ph[0]) * Math.sin(n.y * fq * 1.3 + ph[1]) + 0.1 * Math.sin(n.z * fq * 1.7 + ph[2] + n.x * 2.0);
    const sphere = new THREE.SphereGeometry(1, 6, 5), sp = sphere.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const n = new THREE.Vector3(sp.getX(i), sp.getY(i), sp.getZ(i));
      sp.setXYZ(i, ...n.clone().multiplyScalar(lump(n)).multiply(R).add(c).toArray());
    }
    sphere.computeVertexNormals();
    const sn = sphere.attributes.normal, si = sphere.index.array, rank = rnd(), base = G.n, j = 0.9 + 0.2 * rnd();
    for (let i = 0; i < sp.count; i++) {
      const p = new THREE.Vector3(sp.getX(i), sp.getY(i), sp.getZ(i)), ny = (p.y - c.y) / R.y;
      const world = new THREE.Vector3().subVectors(p, sk.centre).divide(sk.radii);
      const mottle = 0.78 + 0.34 * Math.abs(Math.sin(p.x * 3.1 + p.y * 2.3 + p.z * 4.7 + ph[3]));   // continuous across the seam
      const shade = (0.7 + 0.3 * Math.min(1, Math.max(0, ny * 0.5 + 0.5))) * (0.78 + 0.22 * Math.min(1, world.length())) * j * mottle;
      G.v(p, new THREE.Vector3(sn.getX(i), sn.getY(i), sn.getZ(i)), leaf.map(x => x * shade), [0, 0], rank);
    }
    for (let i = 0; i < si.length; i += 3) G.tri(base + si[i], base + si[i + 1], base + si[i + 2]);
    sphere.dispose();
  });
  return G;
}

const triCount = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

// Close-tier twigs: `twigs.sides`-sided tubes, plain vertex colour (twigs.rgb, else trunk.twig_rgb;
// dead ones deadwood.rgb), no bark UVs: a twig is a pixel or two wide even at a few metres.
function twigGeometry(sk, rnd) {
  const spec = sk.spec, TW = spec.twigs, G = new Geo();
  const live = (TW.rgb || spec.trunk.twig_rgb || spec.trunk.bark_rgb).map(srgbToLin), dead = (spec.deadwood?.rgb || [150, 146, 136]).map(srgbToLin);
  for (const s of sk.twigs) {
    const c0 = s.dead ? dead : live;
    const v0 = G.n, last = s.pts.length - 1;
    tube(G, s, s.pts.map((_, i) => i), TW.sides, () => { const f = 0.85 + 0.3 * rnd(); return c0.map(v => v * f); }, rnd, 0, 1, 0);
    for (let i = v0; i < G.n; i++) G.rank[i] = Math.floor((i - v0) / TW.sides) / Math.max(1, last);   // twigT: 0 at the base, 1 at the tip
  }
  return G;
}

// buildTree(speciesId, seed, lod) -> { trunk, canopy, height, stem, tris }. Old ids (blue_oak, ...)
// are accepted. Geometry is in the tree's frame: base at the origin, then rotateZ(lean), rotateY(leanDir).
// lod 'close' returns the dense canopy and the twigs (`twigs`, null without spec.twigs), trunk null:
// they are drawn with the near trunk.
export function buildTree(name, seed = 1, lod = 'near') {
  const id = resolveSpecies(name); if (!id) throw new Error(`unknown species ${name}`);
  const sk = skeleton(specForSeed(LIBRARY[id], seed), seed);
  const xf = new THREE.Matrix4().makeRotationY(sk.leanDir).multiply(new THREE.Matrix4().makeRotationZ(sk.lean));
  if (lod === 'close') {
    const canopy = cardGeometry(sk, 1, sk.closeCards, sk.spec.lod.close_scale).build(xf, { uv: true, rank: true });
    const twigs = sk.twigs.length ? twigGeometry(sk, mulberry32(seed ^ 0x51a7e)).build(xf, { rank: true, rankName: 'twigT' }) : null;
    return { trunk: null, twigs, canopy, height: sk.H, stem: { ...sk.stem }, species: id,
      tris: { trunk: 0, twigs: twigs ? triCount(twigs) : 0, twigCount: sk.twigs.length, canopy: triCount(canopy), cards: sk.closeCards.length } };
  }
  const rnd = mulberry32(seed ^ (lod === 'near' ? 0x1234567 : 0x7654321));
  const trunk = woodGeometry(sk, lod, rnd).build(xf, lod === 'near' ? { uv: true, rank: true, rankName: 'barkMix' } : {});   // bark UVs only where bark is textured
  const midCards = lod !== 'near' && sk.spec.lod.mid_canopy === 'cards';
  const canopy = (lod === 'near' ? cardGeometry(sk) : midCards ? cardGeometry(sk, Math.min(1, (sk.midCap ?? 60) / sk.cards.length)) : blobGeometry(sk, rnd))
    .build(xf, { uv: lod === 'near' || midCards, rank: true });
  return { trunk, canopy, height: sk.H, stem: { ...sk.stem }, tris: { trunk: triCount(trunk), canopy: triCount(canopy), cards: sk.cards.length }, species: id,
    crown: sk.foliage && { area_m2: sk.foliage.area, cards_per_m2: sk.foliage.cpm2, card_scale: sk.foliage.cardF, mid_cap: sk.midCap } };
}

// treeWood(speciesId, seed) -> { H, stems: [{ level, dead, pts, rad }] }: the wood the near tier tubes (every stem with
// lod.near_sides[level] >= 3) as flat arrays in buildTree's frame (base at the origin, the lean applied): pts xyz per
// point, rad per point. For contact queries (perch.js, where a bird can stand); read from the cached skeleton, so it
// grows nothing and changes nothing drawn. Cached per (species, seed).
const woodCache = new Map();
export function treeWood(name, seed = 1) {
  const id = resolveSpecies(name); if (!id) return null;
  const key = `${id}:${seed}`; let w = woodCache.get(key); if (w) return w;
  const sk = skeleton(specForSeed(LIBRARY[id], seed), seed), sides = sk.spec.lod.near_sides || [];
  const xf = new THREE.Matrix4().makeRotationY(sk.leanDir).multiply(new THREE.Matrix4().makeRotationZ(sk.lean)), v = new THREE.Vector3();
  w = { H: sk.H, stems: [] };
  for (const s of sk.stems) {
    if ((sides[s.level] || 0) < 3 || s.pts.length < 2) continue;
    const pts = new Float32Array(s.pts.length * 3);
    s.pts.forEach((p, i) => { v.copy(p).applyMatrix4(xf); pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z; });
    w.stems.push({ level: s.level, dead: !!s.dead, pts, rad: Float32Array.from(s.rad) });
  }
  woodCache.set(key, w);
  return w;
}

// ---------------------------------------------------------------------------------------------
// Materials

// Compose an onBeforeCompile patch on top of whatever the material already has (e.g. the
// atmosphere patch), and extend the program cache key so differently patched materials never share a program.
export function chainShader(material, key, fn) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = (shader, renderer) => { prev.call(material, shader, renderer); fn(shader); };
  material.customProgramCacheKey = () => `${prevKey}|${key}`;
  material.needsUpdate = true;
  return material;
}

const textures = new Map();
// Foliage texture for one species, drawn once on a canvas: leaves (or needles, or bare twigs) as RGB
// multipliers on transparent, so the vertex colour carries the species and season colour and the
// texture carries form and small colour differences (foliage.palette: [[weight, [r, g, b] tint], ...];
// foliage.tips: sRGB colour of flowers or seed heads at the wand tips per season, chamise). Mips keep
// the alpha-test coverage (Castano 2010), so crowns do not thin out with distance.
// `scale` != 1 draws the same foliage for a card that much smaller (close tier) or larger (mid cards),
// so each leaf keeps its real size. `variant`: a season (picks the tips colour) or 'twig' (the bare
// winter crown of a deciduous species: zig-zag twigs, no leaves). leafTexture(spec) is the summer leaf.
// `deco` ('', 'f', 'b' or 'fb'): flowers and/or berries (foliage.flowers, foliage.berries) drawn last, in
// their own random stream, at the spray's twig ends (on the bare-crown texture at its twig ends and
// along its twigs), tinted relative to the season's leaf colour (`variant`; the twig colour on 'twig').
// The material's gain comes from the leaves alone, so flowers show as bright as they are.
// leafTextureSteps is the same texture as a generator (slice.js: the world build steps it so the opening screen keeps
// responding; Vegetation.build warms the cache with it before canopyMaterial and applySeason ask for the texture);
// leafTexture runs it in one go. It yields only between canvases, or after a read-back has flushed one: a canvas's
// strokes are drawn and read in one task, because the browser rasterises what a task drew when the task ends, and
// strokes rasterised in other batches come out different in a few edge texels.
export function leafTexture(spec, scale = 1, variant = 'summer', deco = '', season = 'summer') { return drain(leafTextureSteps(spec, scale, variant, deco, season)); }
export function* leafTextureSteps(spec, scale = 1, variant = 'summer', deco = '', season = 'summer') {
  const F = spec.foliage;
  const kind = variant === 'twig' ? 'twig' : F.tips && F.tips[variant] ? variant : F.tips ? 'summer' : 'leaf';
  if (deco && (F.leaf_shape === 'needle_brush' || F.leaf_shape === 'needle_drooping' || F.leaf_shape === 'needle_flat')) deco = '';   // needle cards: not drawn
  const key = `${spec.id}:${scale}:${kind}${deco ? `:${deco}:${season}` : ''}`;
  if (textures.has(key)) return textures.get(key);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const seed = hashStr(spec.id) ^ (scale === 1 ? 0 : 0x9e3779b9 ^ Math.round(scale * 977)) ^ (kind === 'twig' ? 0x7a11 : 0);
  const g = c.getContext('2d'), rnd = mulberry32(seed);
  const rec = kind === 'twig' ? null : [];   // every leaf (or needle tuft, or spray) drawn, for the leaf level (leafRecords)
  g.weRec = rec;
  const px = Math.max(5, Math.min(110, F.leaf_size_m / (F.cluster_m * scale) * S * (F.type === 'needle' ? 1 : 1.3)));
  // Tints: palette entries and the tip colour relative to the season's leaf colour; greys are scaled
  // down so the largest tint still fits under 255 (the material gain divides the mean back out).
  const pal = F.palette || [[1, [1, 1, 1]]], wsum = pal.reduce((s, p) => s + p[0], 0);
  const lin = v => Math.pow(v / 255, 2.2), base = F.colors[kind] || F.colors.summer;
  const tip = F.tips && kind !== 'twig' && F.tips[kind] ? F.tips[kind].map((v, i) => Math.pow(lin(v) / Math.max(1e-4, lin(base[i])), 1 / 2.2)) : null;
  // foliage.catkins { rgb, len_m, width, hang, prob }: catkins at the twig ends of the bare-crown texture
  // (willow, alder), tinted relative to the twig colour the material applies in winter.
  const twigBase = spec.trunk.twig_rgb || spec.trunk.bark_rgb, CK = kind === 'twig' ? F.catkins : null;
  const cat = CK ? { ...CK, px: (CK.len_m || 0.05) / (F.cluster_m * scale) * S, tint: CK.rgb.map((v, i) => Math.pow(lin(v) / Math.max(1e-4, lin(twigBase[i])), 1 / 2.2)) } : null;
  // flowers / berries: their colour relative to what the material multiplies the card by this season
  const decoBase = kind === 'twig' ? twigBase : F.colors[season] || F.colors.summer;
  const decoTint = D => D.rgb.map((v, i) => lin(v) / Math.max(1e-4, lin(decoBase[i])));   // linear: the texture multiplies linear colour
  const decos = [];
  if (deco.includes('f') && F.flowers?.rgb) decos.push({ ...F.flowers, tint: decoTint(F.flowers), berry: false });
  if (deco.includes('b') && F.berries?.rgb) decos.push({ ...F.berries, tint: decoTint(F.berries), berry: true });
  const head0 = Math.min(3, Math.max(1, ...pal.flatMap(p => p[1]), ...(tip || [1]), ...(cat ? cat.tint : [1])));
  const head = decos.length ? Math.min(8, Math.max(head0, ...decos.flatMap(d => d.tint))) : head0;
  g.weGlint = Math.round(255 * head0 / head);   // the leaves' glossy glint keeps its brightness relative to the leaf
  const rgb = (v, t = [1, 1, 1]) => `rgb(${t.map(k => Math.round(Math.min(255, v * k / head))).join(',')})`;
  const tintOf = () => { let x = rnd() * wsum; for (const p of pal) { if ((x -= p[0]) <= 0) return p[1]; } return pal[0][1]; };
  const grey = (lo = 170) => rgb(lo + (255 - lo) * rnd(), tintOf());
  // The spray: a few overlapping sub-clumps rather than one clean ellipse, so card edges read as foliage.
  const subs = Array.from({ length: 5 }, () => { const a = rnd() * Math.PI * 2, r = 0.22 * rnd(); return [S / 2 + Math.cos(a) * r * S, S / 2 + Math.sin(a) * r * S * 1.05, S * (0.17 + 0.09 * rnd())]; });
  const inside = () => { for (;;) { const [cx, cy, R] = subs[Math.floor(rnd() * subs.length)], a = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd()), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const ex = (x - S / 2) / (S * 0.42), ey = (y - S / 2) / (S * 0.45); if (ex * ex + ey * ey < 1) return [x, y]; } };
  g.lineCap = 'round';
  const area = Math.PI * (S * 0.4) * (S * 0.43);
  if (kind !== 'twig' && (F.leaf_shape === 'needle_brush' || F.leaf_shape === 'needle_drooping' || F.leaf_shape === 'needle_flat')) {   // needle cards: own mips
    const t = yield* needleTexture(F, S, px, seed, rgb, pal, wsum, scale > 1.2, rec);
    t.userData.leaves = packLeaves(rec, S);
    textures.set(key, t);
    return t;
  }
  const ends = [];   // twig ends [x, y, angle] (and nodes along the bare twigs) for flowers and berries
  if (kind === 'twig') {
    drawTwigs(g, S, rnd, rgb, cat, ends);
  } else if (F.leaf_shape === 'fascicle_wand') {
    drawWands(g, S, px, rnd, grey, rgb, tip);
  } else {
    // twigs: a main stem from the card base and side twigs toward the edge of the ellipse
    const twigs = [], main = [S / 2 + (rnd() - 0.5) * 16, S - 4, S / 2 + (rnd() - 0.5) * 40, 22];
    twigs.push(main);
    for (let k = 0; k < 7; k++) {
      const t = 0.15 + 0.7 * (k + rnd() * 0.6) / 7, x = main[0] + (main[2] - main[0]) * t, y = main[1] + (main[3] - main[1]) * t;
      const side = k % 2 ? 1 : -1, a = side * (0.6 + 0.7 * rnd()), l = S * (0.28 + 0.14 * rnd());
      twigs.push([x, y, Math.max(10, Math.min(S - 10, x + Math.sin(a) * l)), Math.max(10, Math.min(S - 10, y - Math.cos(a) * l))]);
    }
    const needles = F.type === 'needle', far = scale > 1.2;   // far (mid) cards: a dense rounded clump, no twig skeleton
    if (far) twigs.length = 0;
    for (const [x0, y0, x1, y1] of twigs) ends.push([x1, y1, Math.atan2(x1 - x0, -(y1 - y0))]);
    g.strokeStyle = rgb(needles ? 105 : 135);
    for (const [x0, y0, x1, y1] of twigs) { g.lineWidth = needles ? (F.leaf_shape === 'needle_drooping' ? 1.4 : 2) : 2.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    if (needles && F.leaf_shape !== 'needle_fascicle') {
      // Tufts at the twig ends (and some along them). needle_cluster: as before. needle_drooping (gray
      // pine): fewer, thin, very long needles fanning out and hanging, so the tuft is see-through.
      // needle_brush (ponderosa): dense round brushes of stiff, upcurved needles.
      const shape = F.leaf_shape, drooping = shape === 'needle_drooping', brush = shape === 'needle_brush';
      const tufts = twigs.map(t => [t[2], t[3], Math.atan2(t[2] - t[0], -(t[3] - t[1]))]);
      if (far) { const nf = Math.round(area / (Math.PI * px * px) * (drooping ? 1.6 : 2.2)); for (let i = 0; i < nf; i++) { const [x, y] = inside(); tufts.push([x, y, (rnd() - 0.5) * 1.2]); } }
      const extra = far ? 0 : Math.max(0, Math.round(area / (Math.PI * px * px) * (drooping ? 0.9 : brush ? 1.1 : 1.4)) - tufts.length);
      for (let i = 0; i < extra; i++) { const tw = twigs[Math.floor(rnd() * twigs.length)], u = 0.45 + 0.5 * rnd(); tufts.push([tw[0] + (tw[2] - tw[0]) * u, tw[1] + (tw[3] - tw[1]) * u, Math.atan2(tw[2] - tw[0], -(tw[3] - tw[1]))]); }
      for (const [x, y, ta] of tufts) {
        const n = drooping ? 18 + Math.round(10 * rnd()) : brush ? 55 + Math.round(20 * rnd()) : 40 + Math.round(20 * rnd());
        for (let i = 0; i < n; i++) {
          const spread = drooping ? 1.35 : brush ? 0.95 : 0.4 + 1.2 * rnd();
          const a = ta + (rnd() - 0.5) * 2 * spread, len = px * (drooping ? 0.75 + 0.5 * rnd() : brush ? 0.5 + 0.45 * rnd() : 0.6 + 0.5 * rnd());
          const ex = x + Math.sin(a) * len, ey = y - Math.cos(a) * len, droop = F.droop * len * (drooping ? 1.0 : 0.7);
          g.strokeStyle = grey(drooping ? 150 : 130); g.lineWidth = drooping ? 0.8 + 0.7 * rnd() : brush ? 1.4 + 0.9 * rnd() : 1.8 + 1.6 * rnd();
          g.beginPath(); g.moveTo(x, y);
          if (brush) g.quadraticCurveTo(x + Math.sin(a) * len * 0.5, y - Math.cos(a) * len * 0.5 - len * 0.12, ex, ey - len * 0.1);
          else g.quadraticCurveTo((x + ex) / 2, (y + ey) / 2 - (drooping ? len * 0.15 : 0), ex, ey + droop);
          g.stroke();
        }
      }
    } else if (F.leaf_shape === 'needle_scale') {
      drawScaleSprays(g, S, px, rnd, grey, twigs, inside, area, F, far);
    } else if (F.leaf_shape === 'needle_fascicle') {
      // Tiny needle-like leaves in bundles, everywhere along the twigs and filling the spray.
      const n = Math.round(area / (px * px * 1.6));
      for (let i = 0; i < n; i++) {
        const [x, y] = inside();
        g.lineWidth = 1.4;
        for (let m = 0; m < 4; m++) { const a = rnd() * Math.PI * 2, l = px * (0.8 + 0.7 * rnd()); g.strokeStyle = grey(120); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); g.stroke(); }
      }
    } else {
      // Leaves alternating along the twigs (in rosettes at the tips for oaks), then scattered through the spray.
      // Compound and large leaves (a whole leaf is a big unit) sit further apart along the twigs.
      const shape = F.leaf_shape, w = leafWidth(shape), stepK = LEAF_STEP[shape] ?? 0.45;
      for (const [x0, y0, x1, y1] of twigs) {
        const L = Math.hypot(x1 - x0, y1 - y0), ta = Math.atan2(x1 - x0, -(y1 - y0)), step = px * stepK;
        for (let s = step * 0.6; s <= L; s += step) for (const side of [-1, 1]) {
          const x = x0 + (x1 - x0) * s / L, y = y0 + (y1 - y0) * s / L, a = ta + side * (0.5 + 0.5 * rnd()), l = px * (0.8 + 0.4 * rnd());
          drawLeaf(g, x + Math.sin(a) * l * 0.5, y - Math.cos(a) * l * 0.5, a, l, shape, grey(), rnd, F);
        }
        if (shape === 'oblong_wavy' || shape === 'elliptic_glossy') for (let r = 0; r < 5; r++) { const a = ta + (r - 2) * 0.55 + (rnd() - 0.5) * 0.3, l = px * (0.85 + 0.35 * rnd()); drawLeaf(g, x1 + Math.sin(a) * l * 0.45, y1 - Math.cos(a) * l * 0.45, a, l, shape, grey(), rnd); }
        else drawLeaf(g, x1, y1, ta, px, shape, grey(), rnd, F);
      }
      const n = Math.round(area * (far ? 1.1 : 0.35) * (F.leaf_fill ?? 1) / (Math.PI * px * w * px * 0.5));   // foliage.leaf_fill: denser sprays
      for (let i = 0; i < n; i++) { const [x, y] = inside(); drawLeaf(g, x, y, rnd() * Math.PI * 2, px * (0.8 + 0.4 * rnd()), shape, grey(), rnd, F); }
    }
  }
  g.weRec = null;
  let leafMean = null;
  if (decos.length) {
    leafMean = meanGrey(g.getImageData(0, 0, S, S));   // the leaves' own mean, before the flowers
    yield;   // the canvas is flushed: the flowers and berries draw (and are read back) in the next task, in one go
    drawDecos(g, S, F, scale, decos, ends, inside, rgb, mulberry32(seed ^ 0xf10e7), kind === 'twig');
  }
  const t = new THREE.Texture();
  t.mipmaps = coverageMips(c, 0.5);
  t.image = t.mipmaps[0];
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;   // multipliers on the linear vertex colour
  t.anisotropy = 4; t.needsUpdate = true;
  t.userData.mean = leafMean ?? meanGrey(t.mipmaps[0]);   // the material divides by this so cards match the baked colour
  t.userData.leaves = packLeaves(rec, S);
  textures.set(key, t);
  return t;
}

// Bare winter crown: a few stems from the card base splitting into zig-zag twigs (blue oak in winter).
function drawTwigs(g, S, rnd, rgb, cat = null, ends = null) {
  const catkin = (x, y, a) => {   // hanging (alder) or held along the twig (willow)
    const l = cat.px * (0.7 + 0.6 * rnd()), d = cat.hang ? Math.PI + (rnd() - 0.5) * 0.7 : a + (rnd() - 0.5) * 0.5;
    g.save(); g.translate(x + Math.sin(d) * l * 0.5, y - Math.cos(d) * l * 0.5); g.rotate(d); g.fillStyle = rgb(195 + 50 * rnd(), cat.tint);
    g.beginPath(); g.ellipse(0, 0, Math.max(1, l * (cat.width ?? 0.2)), l * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const branch = (x, y, a, len, w, depth) => {
    for (let k = 0; k < 3; k++) {
      a += (k % 2 ? 1 : -1) * (0.12 + 0.22 * rnd());
      const x2 = x + Math.sin(a) * len / 3, y2 = y - Math.cos(a) * len / 3;
      g.strokeStyle = rgb(170 + 70 * rnd()); g.lineWidth = Math.max(0.7, w); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      x = x2; y = y2;
      if (ends && depth <= 1) ends.push([x, y, a, 1]);   // a node along an outer twig (redbud flowers on bare wood)
      if (depth > 0 && k < 2 && rnd() < 0.55) branch(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.45 + 0.4 * rnd()), len * (0.5 + 0.15 * rnd()), w * 0.7, depth - 1);
    }
    if (depth > 0) { const n = 2 + (rnd() < 0.4 ? 1 : 0); for (let i = 0; i < n; i++) branch(x, y, a + (i - (n - 1) / 2) * (0.5 + 0.3 * rnd()), len * (0.6 + 0.15 * rnd()), w * 0.7, depth - 1); }
    else { if (ends) ends.push([x, y, a]); if (cat && rnd() < (cat.prob ?? 0.5)) catkin(x, y, a); }
  };
  for (let i = 0; i < 3; i++) branch(S / 2 + (rnd() - 0.5) * 50, S - 4, (i - 1) * 0.45 + (rnd() - 0.5) * 0.3, S * (0.36 + 0.08 * rnd()), 2.2, 4);
}

// Needle textures keep their needles as lines at every distance. Box-filtered mips (coverageMips) turn a
// one-texel needle into a few scattered dots by the third level, so a minified tuft becomes a solid
// lobe with a ragged edge: the pine crowns read as leaves from 20 m. Here each level down to 16x16 is
// drawn again from the same needles (same random stream), with needles at least one texel wide, and a
// fixed random subset of the needles left out (`keep`, its own stream) so that the level's alpha-test
// coverage matches level 0: fewer, relatively thicker lines, the same cover, so a far crown neither
// washes out nor fills in. The smallest levels (8x8 and below) are box-filtered as before.
// Each level is drawn twice with the same strokes: the colour texture and an aux texture
// (texture.userData.aux) holding each needle's shading normal in the card's frame (rgb) and the
// foliage's thinness around it (alpha), with its own mips from the same draws, for canopyMaterial.
const NEEDLE_BEND = 0.6;   // needle normal: outward from the shoot plus this much of the needle's own direction
function* needleTexture(F, S, px, seed, rgb, pal, wsum, far, rec = null) {
  function* drawLevel(size, keep, minW) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ca = document.createElement('canvas'); ca.width = ca.height = size;
    const g = c.getContext('2d'), ga = ca.getContext('2d'), r = mulberry32(seed);
    g.lineCap = 'round'; ga.lineCap = 'round';
    if (size === S) g.weRec = rec;   // the leaf level's tufts and sprays, from the full-size level only
    const subs = Array.from({ length: 5 }, () => { const a = r() * Math.PI * 2, rr = 0.22 * r(); return [size / 2 + Math.cos(a) * rr * size, size / 2 + Math.sin(a) * rr * size * 1.05, size * (0.17 + 0.09 * r())]; });
    const inside = () => { for (;;) { const [cx, cy, R] = subs[Math.floor(r() * subs.length)], a = r() * Math.PI * 2, rr = R * Math.sqrt(r()), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const ex = (x - size / 2) / (size * 0.42), ey = (y - size / 2) / (size * 0.45); if (ex * ex + ey * ey < 1) return [x, y]; } };
    const tintOf = () => { let x = r() * wsum; for (const q of pal) { if ((x -= q[0]) <= 0) return q[1]; } return pal[0][1]; };
    drawNeedleCard(g, size, F, px * size / S, r, rgb, tintOf, far, inside, keep, mulberry32(seed ^ 0x5eed1e), minW, ga);
    const img = [g.getImageData(0, 0, size, size), ga.getImageData(0, 0, size, size)];
    yield;   // after the read-back: the next level is a new canvas
    return img;
  }
  const cover = img => { const d = img.data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n / (d.length / 4); };
  const [img0, aux0] = yield* drawLevel(S, 1, 0);
  const levels = [img0], auxes = [aux0], c0 = cover(img0), m0 = meanGrey(img0), keeps = [1];
  for (let size = S >> 1; size >= 16; size >>= 1) {
    let keep = 1, [img, aux] = yield* drawLevel(size, keep, 1), c = cover(img);
    for (let it = 0; it < 4 && c0 > 0 && Math.abs(c - c0) > 0.06 * c0; it++) {
      keep = Math.min(1, keep * Math.pow(c0 / Math.max(1e-4, c), 1.6));   // coverage falls slower than keep (overlap): overshoot
      [img, aux] = yield* drawLevel(size, keep, 1); c = cover(img);
    }
    // the same mean brightness as level 0 (twigs, held at a texel wide, take a larger share of a small level)
    const m = meanGrey(img), k = m > 0 ? m0 / m : 1, d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
    levels.push(img); auxes.push(aux); keeps.push(+keep.toFixed(3));
  }
  // Aux alpha: how thin the foliage is around each texel (1 - its local cover, over about 2 cm of a
  // near card at every level), the weight of light passing through (canopyMaterial). Then colour and
  // normal are bled into the empty texels, so filtering at a needle's edge does not pull in black
  // (a one-texel needle on a small level is mostly edge: unbled, it rendered at about 0.6 of its colour).
  for (let i = 0; i < levels.length; i++) { yield; const img = levels[i]; thinness(img, auxes[i], Math.max(1, Math.round(img.width / 48))); bleed(auxes[i], img); bleed(img); }
  yield;
  const rest = coverageMips(levels[levels.length - 1], 0.5, c0);
  const t = new THREE.Texture();
  t.mipmaps = levels.concat(rest.slice(1));
  t.image = t.mipmaps[0];
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  t.userData.mean = meanGrey(levels[0]);
  const a = new THREE.Texture();
  a.mipmaps = auxes.concat(boxMips(auxes[auxes.length - 1], levels[levels.length - 1]).slice(1));
  a.image = a.mipmaps[0];
  a.generateMipmaps = false; a.minFilter = THREE.LinearMipmapLinearFilter; a.magFilter = THREE.LinearFilter;
  a.colorSpace = THREE.NoColorSpace; a.anisotropy = 4; a.needsUpdate = true;
  t.userData.aux = a; t.userData.keep = keeps;   // the fraction of needles drawn on each level (inspection)
  return t;
}

// Aux alpha from the colour level's coverage: 1 where a needle stands alone, 0 inside a dense tuft.
function thinness(img, aux, r) {
  const w = img.width, h = img.height, d = img.data, o = aux.data, sat = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += d[(y * w + x) * 4 + 3] / 255; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const cov = (sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    o[(y * w + x) * 4 + 3] = Math.round(255 * (1 - cov));
  }
}

// Colour of the empty texels (alpha 0) from their covered neighbours, a few rings deep, the rest the
// mean colour: canvas leaves them black, which bilinear filtering pulls into every needle edge.
// `cover` (optional): the image whose alpha says which texels are empty (the aux texture's own alpha
// is thinness, not cover).
function bleed(img, cover = img, rings = 3) {
  const w = img.width, h = img.height, d = img.data, cv = cover.data;
  const filled = new Uint8Array(w * h); let mr = 0, mg = 0, mb = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (cv[i * 4 + 3] > 0) { filled[i] = 1; mr += d[i * 4]; mg += d[i * 4 + 1]; mb += d[i * 4 + 2]; n++; }
  if (!n) return;
  const add = [];
  for (let it = 0; it < rings; it++) {
    add.length = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (filled[i]) continue;
      let r = 0, g = 0, b = 0, k = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && filled[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; k++; }
      if (k) add.push(i, r / k, g / k, b / k);
    }
    for (let k = 0; k < add.length; k += 4) { const i = add[k]; d[i * 4] = add[k + 1]; d[i * 4 + 1] = add[k + 2]; d[i * 4 + 2] = add[k + 3]; filled[i] = 1; }
  }
  for (let i = 0; i < w * h; i++) if (!filled[i]) { d[i * 4] = mr / n; d[i * 4 + 1] = mg / n; d[i * 4 + 2] = mb / n; }
}

// Plain mips for the aux texture's smallest levels, weighted by the colour level's coverage.
function boxMips(aux, col) {
  const out = [aux]; let a = aux, c = col;
  while (a.width > 1) {
    const w = a.width >> 1, h = a.height >> 1, na = new ImageData(w, h), nc = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let s = [0, 0, 0, 0], cw = 0, ca = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((2 * y + dy) * a.width + 2 * x + dx) * 4, wt = c.data[i + 3] + 1;
        for (let k = 0; k < 4; k++) s[k] += a.data[i + k] * wt;
        cw += wt; ca += c.data[i + 3];
      }
      for (let k = 0; k < 4; k++) na.data[o + k] = s[k] / cw;
      nc.data[o + 3] = ca / 4;
    }
    out.push(na); a = na; c = nc;
  }
  return out;
}

// Pine needle cards (leaf_shape needle_brush: ponderosa; needle_drooping: gray pine). Each card is a
// branch end seen side-on: a twig from the card base (the card's base sits on the branch, cardGeometry)
// forking into a few shoots, each ending in a tuft of needle bundles (fascicles of three). A needle is a
// thin curved stroke shaded from a darker base to a lighter tip (foliage.needle_tip: tip tint). Needles
// are projected from 3D: each leaves the shoot at an angle theta from its axis and an azimuth phi around
// it, so needles pointing at or away from the viewer are short, and a tuft reads the same from any side.
//   needle_brush: a dense brush on the last ~1.4 needle lengths of each of 4-5 widely forked shoots,
//     needles stiff, curving forward (up the shoot) and spreading out behind the apex: separate round
//     starbursts, so the crown edge is a fringe of lines and a card is not one palmate lobe.
//   needle_drooping: sparse tufts only at the shoot tips, very long thin needles fanning out and arcing
//     down (foliage.droop), so the tuft is see-through and hangs below the shoot.
// `far` (the mid tier's merged clump cards): no twigs; a few large bursts of thick needles whose outer
// ones point out of the clump, so a distant crown keeps a spiky outline rather than a blob.
function drawNeedleCard(g, S, F, px, rnd, rgb, tintOf, far, inside, keep = 1, skip = null, minW = 0, ga = null) {
  const brush = F.leaf_shape === 'needle_brush', lw = S / 256;
  const tipT = F.needle_tip || (brush ? [1.08, 1.05, 0.9] : [1.03, 1.05, 1.1]);
  const droop = F.droop ?? (brush ? 0 : 0.8);
  // A needle: an arc of five straight pieces whose turn grows toward the tip (stiff at the base, the
  // tip bending most), so a hanging needle arches over rather than kinking. a: angle from canvas up
  // (the shoot tip), clockwise; bend: total turn in radians.
  // `nrm` (aux texture, needleTexture): the needle's shading normal in the card's frame (x right, y up
  // the card, z out of its front face), drawn with the same stroke into `ga`.
  const needle = (x, y, a, L, bend, w, tint, nrm) => {
    const pts = [[x, y]]; let px0 = x, py0 = y;
    for (let i = 1; i <= 5; i++) { const ai = a + bend * Math.pow((i - 0.5) / 5, 1.6); px0 += Math.sin(ai) * L / 5; py0 -= Math.cos(ai) * L / 5; pts.push([px0, py0]); }
    const c0 = rgb(120 + 30 * rnd(), tint), c1 = rgb(185 + 30 * rnd(), tint), c2 = rgb(225 + 30 * rnd(), tint.map((v, i) => v * tipT[i]));
    if (skip && skip() > keep) return;   // left out at this mip level (same draws either way)
    let st = c1;
    // shaded needles on the full-size level only (the mips are too small to show it, and it is slow)
    if (!minW) { st = g.createLinearGradient(x, y, px0, py0); st.addColorStop(0, c0); st.addColorStop(0.55, c1); st.addColorStop(1, c2); }
    g.strokeStyle = st; g.lineWidth = Math.max(minW, w); g.beginPath(); g.moveTo(x, y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    if (ga) { ga.strokeStyle = encN(nrm); ga.lineWidth = g.lineWidth; ga.beginPath(); ga.moveTo(x, y); for (let i = 1; i < pts.length; i++) ga.lineTo(pts[i][0], pts[i][1]); ga.stroke(); }
  };
  const encN = n => `rgb(${n.map(v => Math.round(127.5 + 127.5 * v)).join(',')})`;
  if (F.leaf_shape === 'needle_flat') {
    // Douglas-fir (needle_flat): flat, soft needles (foliage.leaf_size_m long) in two ranks along flat,
    // pinnately branched shoots: a comb either side of every shoot, leaning forward, a few twisted toward
    // or away from the viewer (shorter in projection). Their shading normal is mostly the spray's face
    // (flat needles held in its plane), tilted out to their side. The far card: short combs radiating
    // from the clump.
    const comb = (x0, y0, a, L, w, nw) => {
      const x1 = x0 + Math.sin(a) * L, y1 = y0 - Math.cos(a) * L, Ax = Math.sin(a), Ay = Math.cos(a), Px = Math.cos(a), Py = -Math.sin(a);
      if (g.weRec) recSpray(g.weRec, x0, y0, a, L, px * 0.95, px * 2.5);
      g.strokeStyle = rgb(100 + 20 * rnd()); g.lineWidth = Math.max(minW, w); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (ga) { ga.strokeStyle = encN([0, 0.6, 0.8]); ga.lineWidth = g.lineWidth; ga.beginPath(); ga.moveTo(x0, y0); ga.lineTo(x1, y1); ga.stroke(); }
      const step = Math.max(0.8, px * 0.12);
      for (let s = step * 0.5; s < L; s += step * (0.8 + 0.4 * rnd())) {
        const t = s / L, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (const sd of [-1, 1]) {
          const tint = tintOf(), th = 1.0 + 0.4 * (rnd() - 0.5), ph = (sd > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.0;
          const rx = Math.sin(th) * Math.cos(ph), uy = Math.cos(th), proj = Math.hypot(rx, uy);
          const na = a + Math.atan2(rx, uy), len = px * (0.85 + 0.3 * rnd()) * (0.35 + 0.65 * proj) * (t > 0.85 ? 0.7 : 1);
          let nrm = null;
          if (ga) { const c = Math.cos(ph), v = [0.45 * c * Px + 0.15 * Ax, 0.45 * c * Py + 0.15 * Ay, 0.85 + 0.2 * Math.sin(ph)], l = Math.hypot(...v) || 1; nrm = v.map(q => q / l); }
          needle(x, y, na, len, -Math.sign(rx) * 0.15, nw * (0.85 + 0.3 * rnd()), tint, nrm);
        }
      }
      return [x1, y1];
    };
    const nw = Math.max(lw * 1.1, px * 0.09);
    if (far) {
      for (let b = 0; b < 14; b++) { const [x, y] = inside(), out = Math.atan2(x - S / 2, -(y - S / 2)); comb(x, y, out + (rnd() - 0.5) * 1.4, px * (2.2 + 1.2 * rnd()), lw * 2, nw * 1.8); }
      return;
    }
    const m = px * 1.05, x0 = S / 2 + (rnd() - 0.5) * S * 0.08, a0 = (rnd() - 0.5) * 0.3;
    const Lm = Math.max(px, Math.min(S - 2 - m, S * 0.86));
    comb(x0, S - 2, a0, Lm, lw * 2.2, nw);
    const nSide = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < nSide; k++) {
      const t = 0.14 + 0.72 * (k + rnd() * 0.6) / nSide, x = x0 + Math.sin(a0) * Lm * t, y = S - 2 - Math.cos(a0) * Lm * t, side = k % 2 ? 1 : -1;
      const a = a0 + side * (0.8 + 0.3 * rnd());
      let L = (1 - t) * S * 0.55 + px;
      const dx = Math.sin(a), dy = -Math.cos(a);   // keep the comb a needle length inside the card
      for (const [v, lo, hi] of [[dx, x, 0], [dy, y, 1]]) if (Math.abs(v) > 1e-3) L = Math.min(L, ((v > 0 ? S - m : m) - lo) / v);
      if (L < px) continue;
      const [xe, ye] = comb(x, y, a, L, lw * 1.5, nw);
      if (rnd() < 0.6) { const u = 0.35 + 0.3 * rnd(), q = a - side * (0.7 + 0.3 * rnd()), xs = x + (xe - x) * u, ys = y + (ye - y) * u;
        let L2 = L * (0.35 + 0.2 * rnd()); for (const [v, lo] of [[Math.sin(q), xs], [-Math.cos(q), ys]]) if (Math.abs(v) > 1e-3) L2 = Math.min(L2, ((v > 0 ? S - m : m) - lo) / v);
        if (L2 > px * 0.6) comb(xs, ys, q, L2, lw * 1.1, nw); }
    }
    return;
  }
  // One fascicle (three needles from one point) leaving a shoot of 2D angle ta at polar angle th and
  // azimuth ph (3D), length L; `curl` bends it toward the shoot (brush) and `fall` toward canvas down.
  // Its shading normal: the needle's outward direction from the shoot axis (R, by azimuth p) bent toward
  // the needle's own direction (D), so the needles on the sunward side of a tuft catch the light and
  // the ones behind and under it do not, and the tip of a brush faces out along the shoot.
  const fascicle = (x, y, ta, th, ph, L, w, curl, fall) => {
    const tint = tintOf(), Ax = Math.sin(ta), Ay = Math.cos(ta), Px = Math.cos(ta), Py = -Math.sin(ta);
    for (let k = 0; k < 3; k++) {
      const t = th + (k - 1) * 0.05 + (rnd() - 0.5) * 0.06, p = ph + (rnd() - 0.5) * 0.5;
      const rx = Math.sin(t) * Math.cos(p), uy = Math.cos(t), proj = Math.hypot(rx, uy);
      const a = ta + Math.atan2(rx, uy), len = L * (0.85 + 0.3 * rnd()) * (0.35 + 0.65 * proj);
      let bend = -Math.sign(rx) * curl * Math.sin(t);
      // hanging: turn toward canvas down by a fraction `fall` (0-0.9) of the angle still to go
      if (fall) { const an = Math.atan2(Math.sin(a), Math.cos(a)); bend += Math.sign(an || (rnd() - 0.5)) * (Math.PI - Math.abs(an)) * Math.min(0.9, fall); }
      let nrm = null;
      if (ga) {
        const cp = Math.cos(p), sp = Math.sin(p), st = Math.sin(t), ct = Math.cos(t);
        const nx = cp * (1 + NEEDLE_BEND * st), na = NEEDLE_BEND * ct, nz = sp * (1 + NEEDLE_BEND * st);   // R + bend * D, in (perpendicular, along, out)
        let v = [nx * Px + na * Ax, nx * Py + na * Ay, nz];
        if (fall) v[1] -= fall * 0.6;   // hanging needles face more down
        const l = Math.hypot(...v) || 1; nrm = v.map(c => c / l);
      }
      needle(x, y, a, len, bend, w * (0.85 + 0.3 * rnd()), tint, nrm);
    }
  };
  if (far) {
    const nb = brush ? 9 : 11, L = S * (brush ? 0.19 : 0.22);
    for (let b = 0; b < nb; b++) {
      const [x, y] = inside(), out = Math.atan2(x - S / 2, -(y - S / 2)), ta = out + (rnd() - 0.5) * 1.2;
      const nf = brush ? 30 : 20;
      for (let i = 0; i < nf; i++) {
        const th = brush ? 0.2 + 2.3 * Math.pow(rnd(), 1.3) : 0.2 + 1.4 * rnd();   // brush: round pom-poms, needles all round
        fascicle(x, y, ta, th, rnd() * Math.PI * 2, L * (0.7 + 0.5 * rnd()), lw * (brush ? 2.4 : 1.8), brush ? 0.3 : 0, brush ? 0 : droop * 0.7);
      }
    }
    return;
  }
  // Twigs: a main shoot from the card base and side shoots forking off it and fanning out over the upper
  // two thirds of the card. Shoot tips stay a needle length inside the card so tufts are not clipped.
  const m = px * (brush ? 0.95 : 1.0), shoots = [];
  const x0 = S / 2 + (rnd() - 0.5) * S * 0.08, a0 = (rnd() - 0.5) * 0.3;
  const clampTip = (x, y) => [Math.max(m, Math.min(S - m, x)), Math.max(m, Math.min(S - m, y))];
  const [mx1, my1] = clampTip(x0 + Math.sin(a0) * S, S - 2 - Math.cos(a0) * S);
  shoots.push([x0, S - 2, mx1, my1]);
  // ponderosa: 3-4 side shoots forking at a wide angle and turning up beside the main one, each ending in
  // its own round tuft, so the card is a few separate starbursts (a fan of overlapping brushes read as a
  // palmate leaf from 20 m); gray pine: wider, shorter side shoots
  const nSide = brush ? 3 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < nSide; k++) {
    const t = (brush ? 0.25 : 0.2) + (brush ? 0.45 : 0.6) * (k + rnd()) / nSide, [sx, sy, ex, ey] = shoots[0];
    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t, side = k % 2 ? 1 : -1;
    const a = a0 + side * (brush ? 0.55 + 0.35 * rnd() : 0.45 + 0.6 * rnd()), l = brush ? (1 - t) * S * (0.7 + 0.25 * rnd()) : S * (0.22 + 0.25 * rnd());
    const [tx, ty] = clampTip(x + Math.sin(a) * l, y - Math.cos(a) * l);
    shoots.push([x, y, tx, ty]);
  }
  for (const [i, [xa, ya, xb, yb]] of shoots.entries()) {
    g.strokeStyle = rgb(95 + 20 * rnd()); g.lineWidth = Math.max(minW, lw * (i ? 1.6 : 2.4));
    g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
    if (ga) { ga.strokeStyle = encN([0, 0.6, 0.8]); ga.lineWidth = g.lineWidth; ga.beginPath(); ga.moveTo(xa, ya); ga.lineTo(xb, yb); ga.stroke(); }
  }
  for (const [xa, ya, xb, yb] of shoots) {
    const len = Math.hypot(xb - xa, yb - ya), ta = Math.atan2(xb - xa, -(yb - ya));
    if (brush) {
      // bottle-brush: fascicles all round the last ~1.4 needle lengths of the shoot, forward-pointing at
      // the apex and spreading to square with the shoot (and a little back) within a needle length of
      // it, so the tuft is a round starburst; needles stiff, curving up the shoot
      const span = Math.min(len * 0.85, px * 1.4), nf = Math.round(12 + 40 * span / px);
      if (g.weRec) g.weRec.push({ t: 1, x: xb - Math.sin(ta) * span, y: yb + Math.cos(ta) * span, a: ta, f: span + px * 1.15, b: px * 0.35, w: px * 1.15 });
      for (let i = 0; i < nf; i++) {
        const u = Math.pow(rnd(), 0.9), d = span * (1 - u), x = xb - Math.sin(ta) * d, y = yb + Math.cos(ta) * d;
        const th = 0.15 + 1.2 * Math.min(1, d / (px * 0.9)) + 0.3 * rnd();
        fascicle(x, y, ta, th, rnd() * Math.PI * 2, px * (0.7 + 0.5 * rnd()), lw * 1.4, 0.35, 0);
      }
    } else {
      // gray pine: a loose tuft at the very tip, needles fanning wide and arcing down
      const nf = 16 + Math.floor(rnd() * 7);
      if (g.weRec) g.weRec.push({ t: 1, x: xb, y: yb, a: ta, f: px * 1.1, b: px * 0.9, w: px * 1.2 });
      for (let i = 0; i < nf; i++) {
        const d = px * 0.2 * rnd(), x = xb - Math.sin(ta) * d, y = yb + Math.cos(ta) * d;
        fascicle(x, y, ta, 0.15 + 1.3 * rnd(), rnd() * Math.PI * 2, px * (0.75 + 0.4 * rnd()), lw * 1.2, 0, droop * (0.6 + 0.5 * rnd()));
      }
    }
  }
}

// Chamise: wiry wands rising through the card, set with tiny leaf bundles, flower or seed heads at the tips.
function drawWands(g, S, px, rnd, grey, rgb, tip) {
  const n = 7 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const x0 = S / 2 + (rnd() - 0.5) * S * 0.5, y0 = S - 4, a = (x0 - S / 2) / S * 1.2 + (rnd() - 0.5) * 0.35, L = S * (0.55 + 0.4 * rnd());
    const x1 = x0 + Math.sin(a) * L, y1 = Math.max(6, y0 - Math.cos(a) * L), cx = (x0 + x1) / 2 + (rnd() - 0.5) * 20, cy = (y0 + y1) / 2;
    g.strokeStyle = rgb(115 + 40 * rnd()); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
    const at = t => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1];
    const steps = Math.round(L / (px * 0.7));
    for (let s = 1; s < steps; s++) {
      const t = 0.12 + 0.88 * s / steps, [x, y] = at(t);
      if (tip && t > 0.8) { for (let m = 0; m < 3; m++) { g.fillStyle = rgb(200 + 55 * rnd(), tip); g.beginPath(); g.arc(x + (rnd() - 0.5) * px, y + (rnd() - 0.5) * px, px * (0.25 + 0.2 * rnd()), 0, Math.PI * 2); g.fill(); } continue; }
      g.lineWidth = 1.2;
      for (let m = 0; m < 4; m++) { const b = a + (m % 2 ? 1 : -1) * (0.35 + 0.7 * rnd()), l = px * (0.6 + 0.6 * rnd()); g.strokeStyle = grey(110); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(b) * l, y - Math.cos(b) * l); g.stroke(); }
    }
  }
}

// Mip chain whose alpha-tested coverage matches level 0: each level is a 2x box-filtered copy of
// the one above, with alpha scaled so the same fraction of texels passes `ref`.
// `src` is a canvas or an ImageData; `target` (optional) is the coverage to keep (default: src's own).
function coverageMips(src, ref, target = null) {
  const out = [];
  let img = src instanceof ImageData ? src : src.getContext('2d').getImageData(0, 0, src.width, src.height);
  const cover = d => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= ref * 255) n++; return n / (d.length / 4); };
  if (target == null) target = cover(img.data);
  out.push(img);
  while (img.width > 1) {
    const w = Math.max(1, img.width >> 1), h = Math.max(1, img.height >> 1), next = new ImageData(w, h), s = img.data, d = next.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = (Math.min(img.height - 1, 2 * y + dy) * img.width + Math.min(img.width - 1, 2 * x + dx)) * 4, al = s[i + 3];
        r += s[i] * al; gg += s[i + 1] * al; b += s[i + 2] * al; a += al;
      }
      const o = (y * w + x) * 4;
      if (a > 0) { d[o] = r / a; d[o + 1] = gg / a; d[o + 2] = b / a; } else { d[o] = d[o + 1] = d[o + 2] = 200; }
      d[o + 3] = a / 4;
    }
    // binary search an alpha scale so coverage matches level 0
    let lo = 0.5, hi = 8;
    for (let it = 0; it < 12; it++) {
      const m = (lo + hi) / 2; let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] * m >= ref * 255) n++;
      if (n / (d.length / 4) < target) lo = m; else hi = m;
    }
    for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * hi);
    out.push(next); img = next;
  }
  return out;
}

function meanGrey(img) {   // mean luminance of the opaque texels
  let s = 0, n = 0; const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) { s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
  return n ? s / n : 1;
}

// Flat sprays of scale leaves (leaf_shape needle_scale: incense cedar). Each twig of the card is the
// rachis of a frond branched twice in its plane, alternate branchlets leaning forward and shortening
// toward the tip, every ultimate shoot a flat green ribbon (scale leaves pressed to it). A shoot is
// about px long (foliage.leaf_size_m: one branchlet). More small fronds fill the spray; the far card
// (mid tier) is fronds only.
function drawScaleSprays(g, S, px, rnd, grey, twigs, inside, area, F, far) {
  const w0 = Math.max(1.4, px * 0.085);
  const frond = (x0, y0, a, L, w) => {
    const x1 = x0 + Math.sin(a) * L, y1 = y0 - Math.cos(a) * L;
    if (g.weRec) recSpray(g.weRec, x0, y0, a, L, px * 0.9, px * 2.5);
    g.strokeStyle = grey(140); g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const step = px * 0.32;
    let side = rnd() < 0.5 ? 1 : -1;
    for (let s = step * 0.7; s < L; s += step * (0.85 + 0.3 * rnd())) {
      const t = s / L, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, b = a + side * (0.8 + 0.25 * rnd()), l = px * (0.55 + 0.4 * rnd()) * (1 - 0.55 * t);
      const bx = x + Math.sin(b) * l, by = y - Math.cos(b) * l;
      g.strokeStyle = grey(150); g.lineWidth = w * 0.85; g.beginPath(); g.moveTo(x, y); g.lineTo(bx, by); g.stroke();
      let s2 = rnd() < 0.5 ? 1 : -1;
      for (let q = l * 0.3; q < l; q += px * 0.17) {
        const u = q / l, cx = x + (bx - x) * u, cy = y + (by - y) * u, c = b + s2 * (0.75 + 0.3 * rnd()), cl = px * 0.26 * (1 - 0.5 * u) * (0.8 + 0.4 * rnd());
        g.strokeStyle = grey(160); g.lineWidth = w * 0.7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(c) * cl, cy - Math.cos(c) * cl); g.stroke();
        s2 = -s2;
      }
      side = -side;
    }
  };
  for (const [x0, y0, x1, y1] of twigs) frond(x0, y0, Math.atan2(x1 - x0, -(y1 - y0)), Math.hypot(x1 - x0, y1 - y0), w0 * 1.15);
  const n = Math.round(area * (far ? 1.2 : 0.7) * (F.leaf_fill ?? 1) / (px * px * 2.2));
  for (let i = 0; i < n; i++) { const [x, y] = inside(); frond(x, y, (rnd() - 0.5) * 2.2, px * (1.1 + 0.8 * rnd()), w0 * (far ? 1.6 : 1)); }
}

// Flowers and berries (foliage.flowers, foliage.berries) on a card texture, after everything else, in their
// own random stream: at the twig ends `ends` [x, y, angle(, node)] (a bare-crown texture also offers
// nodes along its outer twigs to flowers, so redbud's clusters crowd the bare wood), and at random points of the
// spray for the far (mid) cards, which have no twigs. `density` (0-1) is the fraction of ends that carry
// one; `size_m` the size of one inflorescence (or berry cluster). Forms: candle (an upright panicle,
// buckeye; `width` its half-width over its length, default 0.2), cluster (a round head of florets or berries,
// toyon, elderberry, redbud) and bud (a single small round bud or berry).
// `per_card` (opt-in, buckeye and elderberry flowers): a set number of heads on a near card instead of
// `density`, times the card's area relative to the near card (a close card at lod.close_scale 0.6 gets 0.36 of
// them, a mid card at scale 2 four times as many), at the twig ends first and then at points of the spray, each
// head whole on the card and clear of the others. With `density` a close card, whose few twig ends sit at its
// edge, could show one clipped candle or none, so the shrub read as not in flower from 7 to 40 m.
function drawDecos(g, S, F, scale, decos, ends, inside, rgb, rnd, bare) {
  const far = scale > 1.2;
  for (const D of decos) {
    const px = Math.max(2.5, Math.min(S * 0.4, D.size_m / (F.cluster_m * scale) * S));
    const form = D.berry ? (D.form === 'bud' ? 'bud' : 'cluster') : D.form;
    if (D.per_card != null) { drawCounted(g, S, D, form, px, scale, far, ends, inside, rgb, rnd, bare); continue; }
    let spots = ends.filter(e => !e[3] || (bare && !D.berry));   // nodes along bare twigs: flowers only
    if (far || !spots.length) {
      const area = Math.PI * (S * 0.4) * (S * 0.43), n = Math.round(area / (px * px * 6));
      spots = Array.from({ length: n }, () => [...inside(), (rnd() - 0.5) * 1.2]);
    }
    // berries on a bare crown hang from the shoots, not from every twiglet: about as many as on a leafy spray
    // and flowers on the many twiglets of a bare crown cover at most 0.6 x density of the spray
    const thin = bare && D.berry ? Math.min(1, 12 / Math.max(1, spots.length)) : 1;
    const one = D.form === 'candle' && !D.berry ? px * px * 0.3 : Math.PI * px * px * 0.25, sprayArea = Math.PI * (S * 0.4) * (S * 0.43);
    const cap = Math.min(1, (D.density ?? 0.5) * 0.6 * sprayArea / one / Math.max(1, spots.length));
    for (const [x, y, a, node] of spots) {
      if (rnd() >= Math.min((D.density ?? 0.5) * (node ? 0.6 : 1) * thin, cap)) continue;
      drawHead(g, D, form, x, y, a, px, rgb, rnd);
    }
  }
}
// per_card: n heads (n = per_card x scale^2, the fraction by chance), at shuffled twig ends, then points of the spray.
function drawCounted(g, S, D, form, px, scale, far, ends, inside, rgb, rnd, bare) {
  const want = D.per_card * scale * scale, n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
  if (!n) return;
  const tips = far ? [] : ends.filter(e => !e[3] || (bare && !D.berry)).slice();
  for (let i = tips.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [tips[i], tips[j]] = [tips[j], tips[i]]; }
  const cand = tips.concat(Array.from({ length: n * 8 }, () => [...inside(), (rnd() - 0.5) * 1.2]));
  // the head's reach from its base point: a candle rises up to 1.2 px and leans; a cluster is a disc of half px
  const [left, up, down] = form === 'candle' ? [0.75 * px, 1.25 * px, 2] : form === 'bud' ? [0.3 * px, 0.3 * px, 0.3 * px] : [0.55 * px, 0.65 * px, 0.4 * px];
  const gap = 0.75 * px, placed = [];
  for (const [x, y, a] of cand) {
    if (placed.length >= n) break;
    if (x - left < 0 || x + left > S || y - up < 0 || y + down > S) continue;
    if (placed.some(([u, v]) => (u - x) ** 2 + (v - y) ** 2 < gap * gap)) continue;
    placed.push([x, y]);
    drawHead(g, D, form, x, y, a, px, rgb, rnd);
  }
}
function drawHead(g, D, form, x, y, a, px, rgb, rnd) {
  const fill = () => rgb(205 + 50 * rnd(), D.tint);
  if (form === 'candle') {   // upright spike of florets, leaning a little with the twig: full most of its length, tapering to the tip
    const L = px * (0.8 + 0.4 * rnd()), lean = Math.max(-0.5, Math.min(0.5, a * 0.3)), W = L * (D.width ?? 0.2), nf = Math.max(10, Math.round(D.width ? L * 9 * D.width : L * 1.8));   // florets with the candle's area
    for (let k = 0; k < nf; k++) {
      const t = Math.pow(rnd(), 0.8), r = W * (1 - t * t) * Math.sqrt(rnd()) * (rnd() < 0.5 ? -1 : 1);
      const cx = x + Math.sin(lean) * L * t + Math.cos(lean) * r, cy = y - Math.cos(lean) * L * t + Math.sin(lean) * r;
      g.fillStyle = fill(); g.beginPath(); g.arc(cx, cy, Math.max(0.9, W * 0.45 * (1 - 0.45 * t)), 0, Math.PI * 2); g.fill();
    }
  } else if (form === 'bud') {
    g.fillStyle = fill(); g.beginPath(); g.arc(x, y, Math.max(1, px * 0.25), 0, Math.PI * 2); g.fill();
  } else {   // cluster: a rounded, slightly flat-topped head of florets or berries
    const R = px * 0.5, nf = D.berry ? Math.max(4, Math.round(R * 0.9)) : Math.max(6, Math.round(R * 1.6)), r0 = Math.max(0.8, R * (D.berry ? 0.2 : 0.16));
    for (let k = 0; k < nf; k++) {
      const ang = rnd() * Math.PI * 2, rr = R * Math.sqrt(rnd());
      g.fillStyle = fill(); g.beginPath(); g.arc(x + Math.cos(ang) * rr, y - R * 0.3 + Math.sin(ang) * rr * 0.6, r0 * (0.8 + 0.4 * rnd()), 0, Math.PI * 2); g.fill();
    }
  }
}

// Half-width / length of a leaf outline (compound leaves: of the whole leaf's footprint).
function leafWidth(shape) {
  return { lanceolate: 0.15, lobed: 0.26, oblong_wavy: 0.2, elliptic_glossy: 0.22, round_vertical: 0.34, deltoid: 0.42,
    palmate_compound: 0.5, pinnate_compound: 0.3, trifoliate: 0.42, cordate: 0.46, lobed_large: 0.38 }[shape] ?? 0.32;
}
// Spacing of the leaves along a spray's twigs, in leaf lengths (default 0.45): a compound or large leaf
// is one big unit, so they sit further apart.
const LEAF_STEP = { palmate_compound: 0.8, pinnate_compound: 0.7, trifoliate: 0.65, lobed_large: 0.62, cordate: 0.55 };
const COMPOUND = { palmate_compound: [5, 7], pinnate_compound: [5, 9], trifoliate: [3, 3] };
const countOf = (v, def, rnd) => { const [a, b] = Array.isArray(v) ? v : v != null ? [v, v] : def; return Math.round(a + rnd() * (b - a)); };

// One leaflet (or a simple leaf) in the current frame: base at (0, 0), tip at (0, -L) (canvas up), half-
// width W at its widest (60% of the way up); `wavy` a shallow wavy or lobed margin (poison oak), and the
// half-leaf shading the simple leaves have.
function leaflet(g, x, y, a, L, W, fill, wavy = 0, ph = 0) {
  g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = fill;
  const half = s => { const out = []; for (let k = 0; k <= 18; k++) { const t = k / 18, w = W * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85) * (1 + wavy * Math.sin(t * Math.PI * 5 + ph + (s > 0 ? 0 : 1.3))); out.push([s * w, -L * t]); } return out; };
  const R = half(1), Lf = half(-1);
  g.beginPath(); g.moveTo(0, 0); for (const [X, Y] of R) g.lineTo(X, Y); for (let k = Lf.length - 1; k >= 0; k--) g.lineTo(Lf[k][0], Lf[k][1]); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.moveTo(0, 0); for (const [X, Y] of Lf) g.lineTo(X, Y); g.fill();
  g.restore();
}
// A leaf stalk (petiole or rachis) from (x0, y0) to (x1, y1).
function stalk(g, x0, y0, x1, y1, w, fill) { g.strokeStyle = fill; g.lineWidth = Math.max(0.8, w); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }

// The leaf shapes added for the foothill set (2026-10-25), in the leaf's frame (base at +len/2, tip toward
// -len/2, as the simple shapes): compound leaves and large lobed and heart-shaped leaves.
//   palmate_compound (buckeye): a long petiole and foliage.leaflets (5-7) leaflets radiating from its tip,
//     the middle one longest (foliage.leaflet_ratio of the leaf, default 0.58).
//   pinnate_compound (walnut, ash, elderberry): a rachis the leaf's length with opposite leaflets and a
//     terminal one, foliage.leaflets in all (5-9; odd), each foliage.leaflet_ratio (0.28) of the leaf.
//   trifoliate (poison oak): three leaflets, the terminal one on a short stalk, lobed-wavy margins, glossy.
//   lobed_large (black oak, big-leaf maple): foliage.lobes (7) lobes cut foliage.lobe_depth (0.55) of the
//     way in; foliage.lobe_style 'pinnate' (lobes along the midrib, oaks) or 'palmate' (from the petiole, maple);
//     foliage.lobe_tip 'pointed' (default: black oak's bristle-tipped lobes, maple) or 'round'.
//   cordate (redbud): broad heart shape, notched base, short point.
function drawShapedLeaf(g, len, shape, fill, rnd, F) {
  const lw = Math.max(0.8, len * 0.022);
  if (shape === 'palmate_compound' || shape === 'pinnate_compound' || shape === 'trifoliate') {
    const n = Math.max(1, countOf(F?.leaflets, COMPOUND[shape], rnd)), ph = rnd() * 6.28;
    if (shape === 'palmate_compound') {
      const hub = 0.12 * len, Lm = len * (F?.leaflet_ratio ?? 0.62), spread = n > 1 ? Math.min(1.45, 0.3 * (n - 1)) : 0;
      stalk(g, 0, len * 0.5, 0, hub, lw, fill);
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) * 2 - 1 : 0, a = t * spread + (rnd() - 0.5) * 0.12, L = Lm * (1 - 0.38 * Math.abs(t)) * (0.92 + 0.16 * rnd());
        leaflet(g, 0, hub, a, L, L * 0.17, fill);
      }
    } else if (shape === 'pinnate_compound') {
      const P = Math.floor((n - 1) / 2), Ll = len * (F?.leaflet_ratio ?? 0.28), top = -len * 0.5 + Ll * 0.85;
      stalk(g, 0, len * 0.5, 0, top, lw, fill);
      for (let k = 0; k < P; k++) {
        const u = 0.22 + 0.74 * (k + 0.5) / P, y = len * 0.5 + (top - len * 0.5) * u, L = Ll * (0.8 + 0.25 * u) * (0.9 + 0.2 * rnd());
        for (const sd of [-1, 1]) leaflet(g, 0, y, sd * (1.05 + 0.25 * rnd()), L, L * 0.24, fill);
      }
      if (n % 2 || !P) leaflet(g, 0, top, (rnd() - 0.5) * 0.15, Ll * 0.95, Ll * 0.24, fill);
    } else {   // trifoliate
      const node = len * 0.06;
      stalk(g, 0, len * 0.5, 0, node, lw, fill);
      stalk(g, 0, node, 0, node - len * 0.06, lw, fill);
      leaflet(g, 0, node - len * 0.06, (rnd() - 0.5) * 0.2, len * 0.5, len * 0.17, fill, 0.1, ph);
      for (const sd of [-1, 1]) leaflet(g, 0, node, sd * (1.15 + 0.2 * rnd()), len * 0.4, len * 0.15, fill, 0.1, ph + sd);
      if (rnd() < 0.5) { g.fillStyle = glintOf(g, 0.35); g.beginPath(); g.ellipse(len * 0.04, -len * 0.25, len * 0.05, len * 0.1, 0, 0, Math.PI * 2); g.fill(); }   // glossy glint
    }
    return;
  }
  g.fillStyle = fill; g.beginPath();
  if (shape === 'cordate') {
    const W = len * 0.46;
    g.moveTo(0, len * 0.34);
    g.bezierCurveTo(W * 0.45, len * 0.56, W * 1.08, len * 0.42, W, len * 0.1);
    g.bezierCurveTo(W * 0.92, -len * 0.2, W * 0.42, -len * 0.4, 0, -len * 0.5);
    g.bezierCurveTo(-W * 0.42, -len * 0.4, -W * 0.92, -len * 0.2, -W, len * 0.1);
    g.bezierCurveTo(-W * 1.08, len * 0.42, -W * 0.45, len * 0.56, 0, len * 0.34);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.moveTo(0, len * 0.34); g.bezierCurveTo(-W * 0.45, len * 0.56, -W * 1.08, len * 0.42, -W, len * 0.1);
    g.bezierCurveTo(-W * 0.92, -len * 0.2, -W * 0.42, -len * 0.4, 0, -len * 0.5); g.fill();
    return;
  }
  // lobed_large
  const lobes = Math.max(3, Math.round(F?.lobes ?? 7)), d = Math.min(0.9, Math.max(0, F?.lobe_depth ?? 0.55)), pts = [];
  const pointed = (F?.lobe_tip ?? 'pointed') !== 'round';
  const lobeOf = ph => { const f = ph - Math.floor(ph); return pointed ? Math.pow(1 - 2 * Math.abs(f - 0.5), 0.75) : Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * ph), 0.7); };
  if ((F?.lobe_style ?? 'pinnate') === 'palmate') {
    const hub = len * 0.18, R = len * 0.62;
    for (let k = 0; k <= 96; k++) {
      const th = (-150 + 300 * k / 96) * DEG, phase = (th / DEG + 150) / (300 / lobes), sv = lobeOf(phase);
      const r = R * (0.5 + 0.5 * Math.cos(th * 0.7)) * ((1 - d) + d * sv) + len * 0.02;
      pts.push([Math.sin(th) * r, hub - Math.cos(th) * r]);
    }
    stalk(g, 0, len * 0.5, 0, hub, Math.max(0.8, len * 0.02), fill);
    g.fillStyle = fill; g.beginPath(); g.moveTo(0, hub); for (const [X, Y] of pts) g.lineTo(X, Y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.moveTo(0, hub); for (const [X, Y] of pts.slice(0, 49)) g.lineTo(X, Y); g.closePath(); g.fill();
    return;
  }
  const m = Math.max(1, (lobes - 1) / 2), W = len * 0.36, right = [];
  for (let k = 0; k <= 120; k++) {
    const t = k / 120, env = W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.6);
    const u = Math.max(0, t - 0.08) / 0.92 * (m + 0.5), sv = pointed ? lobeOf(u) : Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * u), 0.55);
    right.push([env * ((1 - d) + d * sv), len * 0.5 - len * t]);
  }
  g.moveTo(0, len * 0.5); for (const [X, Y] of right) g.lineTo(X, Y); for (let k = right.length - 1; k >= 0; k--) g.lineTo(-right[k][0], right[k][1]); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.moveTo(0, len * 0.5); for (const [X, Y] of right) g.lineTo(-X, Y); g.closePath(); g.fill();
}

// One leaf of a shape on its own canvas (size px, grey on transparent), for checking a leaf_shape
// (the lineup's leaf specimens); F: the foliage block with leaflets, lobes, lobe_depth, lobe_style.
export function leafSpecimen(shape, F = {}, px = 200, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'); g.lineCap = 'round';
  drawLeaf(g, px / 2, px / 2, 0, px * 0.9, shape, 'rgb(205,214,190)', mulberry32(seed), F);
  return c;
}

const glintOf = (g, a = 0.45) => { const v = g.weGlint ?? 255; return v >= 255 ? `rgba(255,255,255,${a})` : `rgba(${v},${v},${v},${a})`; };
function drawLeaf(g, x, y, a, len, shape, fill, rnd, F = null) {
  if (g.weRec) { const [hw, hh] = leafBox(shape, F); g.weRec.push({ t: 0, x, y, a, f: len * hh, b: len * hh, w: len * hw, fill }); }
  if (shape in LEAF_STEP) { g.save(); g.translate(x, y); g.rotate(a); drawShapedLeaf(g, len, shape, fill, rnd, F); g.restore(); return; }
  g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = fill; g.beginPath();
  let w = leafWidth(shape);
  if (shape === 'round_vertical' && rnd() < 0.4) w = 0.07;   // held edge-on: a sliver
  if (shape === 'oblong_wavy') {   // oblong with a few shallow waves along the margin (blue oak)
    const ph = rnd() * 6.28;
    for (let k = 0; k <= 28; k++) { const t = k / 28 * Math.PI * 2, m = 1 + 0.09 * Math.sin(t * 6 + ph); const X = Math.cos(t) * len * w * m, Y = Math.sin(t) * len * 0.5; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.fill();
  } else if (shape === 'deltoid') {   // triangular: pointed tip, broad flat base on a long stalk (cottonwood)
    const W = len * w;
    g.moveTo(0, -len * 0.5); g.quadraticCurveTo(W * 0.35, -len * 0.05, W, len * 0.3); g.quadraticCurveTo(W * 0.5, len * 0.46, 0, len * 0.38);
    g.quadraticCurveTo(-W * 0.5, len * 0.46, -W, len * 0.3); g.quadraticCurveTo(-W * 0.35, -len * 0.05, 0, -len * 0.5); g.fill();
  } else g.ellipse(0, 0, len * w, len * 0.5, 0, 0, Math.PI * 2), g.fill();
  if (shape === 'lobed') for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    g.beginPath(); g.arc(s * len * 0.22, -len * 0.28 + i * len * 0.24, len * (0.12 + 0.03 * rnd()), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.ellipse(-len * w * 0.4, 0, len * w * 0.55, len * 0.45, 0, 0, Math.PI * 2); g.fill();   // half-leaf shading
  if ((shape === 'elliptic_glossy' || shape === 'deltoid') && rnd() < 0.5) { g.fillStyle = glintOf(g); g.beginPath(); g.ellipse(len * w * 0.25, -len * 0.12, len * w * 0.3, len * 0.16, 0, 0, Math.PI * 2); g.fill(); }   // glossy glint
  g.restore();
}

export const THIN_NEAR = 300, THIN_MIN = 0.25, THIN_OUTER = 0.2, THIN_GROW = 0.6;
// The mid material's distance thinning applied on the CPU to a copy of a mid canopy (lineup metrics):
// `d` is the camera distance in metres.
export function thinMidCanopy(geometry, d) {
  const g = geometry.clone(), pos = g.attributes.position, off = g.attributes.cardOff;
  if (!off) return g;
  const f = Math.min(1, Math.max(THIN_MIN, Math.pow(THIN_NEAR / d, 1.5)));
  for (let i = 0; i < pos.count; i++) {
    const r = off.getW(i), t = Math.min(1, Math.max(0, (r - f) / 0.08)), k = r <= 0 ? 0 : (1 - t * t * (3 - 2 * t)) * Math.pow(f, -THIN_GROW) - 1;   // GLSL 1 - smoothstep(f, f + 0.08, r)
    pos.setXYZ(i, pos.getX(i) + off.getX(i) * k, pos.getY(i) + off.getY(i) * k, pos.getZ(i) + off.getZ(i) * k);
  }
  pos.needsUpdate = true; g.computeBoundingSphere();
  return g;
}

// Canopy material for a species and LOD. `patch` (optional) runs first, e.g. atmosphere.patchLambert.
// Leaf-on below 1 discards the cards (or blobs) whose rank is above it, so a deciduous crown thins
// rather than fading; the near cards keep their crown-shaped normals on both faces.
// Mid cards are drawn with a texture made for their enlarged size (lod.mid_tex_scale, default 2), so a
// far crown keeps leaf-sized grain instead of a few giant sprays.
export function canopyMaterial(spec, lod = 'near', patch = null) {
  const close = lod === 'close';
  const near = close || lod === 'near' || spec.lod.mid_canopy === 'cards';   // card materials (alpha-tested texture)
  const texScale = close ? spec.lod.close_scale : lod === 'mid' ? spec.lod.mid_tex_scale ?? 2 : 1;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff,
    ...(near ? { map: leafTexture(spec, texScale), alphaTest: 0.5, side: THREE.DoubleSide } : {}) });
  // No alpha-to-coverage at near and mid: it turns small, distant cards into partial coverage that
  // washes the crown out against the ground; plain alpha test on coverage-preserving mips keeps it as
  // dense as the mid blobs. The close tier (under about 110 m, cards large on screen) does use it:
  // with MSAA it smooths the leaf edges that alias under plain alpha test up close.
  if (close) m.alphaToCoverage = true;
  m.userData.leafOn = { value: 1 };
  m.userData.leafVar = { value: spec.foliage.leaf_on_var || 0 };   // per-plant leaf-out timing; off for winter twigs
  m.userData.texScale = near ? texScale : null;     // applySeason swaps season and winter-twig textures at this scale
  m.userData.gain = near ? 1 / m.map.userData.mean : 1;   // the texture's mean, so cards match the baked colour
  if (patch) patch(m);
  // Per-plant variation without instance buffers: a hash of the plant's world position (its instance
  // origin) gives each plant its own brightness and yellow-blue shift (foliage.color_var: [value, hue])
  // and its own leaf-out timing (foliage.leaf_on_var: 0..1, how much the plant's hash replaces the
  // card's rank, so whole trees green up or drop leaves early or late, not random cards).
  const cv = spec.foliage.color_var || [0, 0], lv = spec.foliage.leaf_on_var || 0, vary = !!(cv[0] || cv[1] || lv);
  // Mid cards thin out with distance: every card up to THIN_NEAR m from the camera, then the outline
  // cards (THIN_OUTER of them) and a falling fraction f = (THIN_NEAR / d)^1.5 (not below THIN_MIN) of
  // the inner ones, each inner card enlarged by f^-THIN_GROW about its own centre so the inside of the
  // crown keeps its cover (a little over the leaf area: fewer, larger cards overlap less). Past ~400 m
  // a crown is under 15 px and its cards under 2 px, and each card still costs at least a 2x2 block of
  // fragment shading whatever its size (measured: the far cards' cost does not fall with resolution);
  // this keeps the cards near a constant size on screen. Inner cards leave in an even random sequence
  // (cardOff.w, cardGeometry) and shrink to nothing as f falls 0.08 below their order, so none pops.
  const thin = lod === 'mid' && near;
  // Pine needle cards (needleTexture: an aux texture of per-needle normals and thinness) are lit as
  // needles rather than as a leaf. (1) Each needle's normal (in the card's frame, which the fragment
  // shader takes from the screen-space derivatives of position and uv: no extra attributes) is mixed
  // into the crown normal by foliage.needle_normal, for the sun and the sky light, so the needles on
  // the sunward side of a tuft catch the light and those under and behind it fall into shade. (2) Wrap
  // lighting (foliage.needle_wrap) for the sun: needles are scattered, so a tuft facing away from the
  // sun is not black. (3) Light through the needles (foliage.translucency): with the sun behind the
  // tuft, a forward-scattering lobe tinted yellow-green (foliage.translucency_rgb), weighted by the aux texture's thinness, so
  // single needles at a tuft's edge glow and a dense core does not. It is shadowed like the sun term.
  // (4) A weak glow of the whole backlit crown (foliage.needle_scatter: light scattered on through the
  // foliage, so not shadowed by the crown itself; cloud shadow still applies), also more at thin edges.
  // All of it fades out from 900 to 1500 m, where the impostors (lit by the crown normal alone) take
  // over. The parameters are uniforms (userData.needleLight: normal, wrap, translucency, thinness ramp;
  // userData.needleScatterK), so they can be tuned live.
  const aux = near && m.map.userData.aux, F0 = spec.foliage;
  const NL = aux ? [F0.needle_normal ?? 0.55, F0.needle_wrap ?? 0.35, F0.translucency ?? 2.5, 0.6] : null;
  if (aux) m.userData.needleAux = { get value() { return (m.map && m.map.userData.aux) || aux; } };
  if (aux) { m.userData.needleLight = { value: new THREE.Vector4(...NL) }; m.userData.needleScatterK = { value: F0.needle_scatter ?? 0.15 }; m.userData.needleTint = { value: new THREE.Vector3(...(F0.translucency_rgb || [1, 1.12, 0.55])) }; }
  chainShader(m, (close ? 'leaf-close' : lod === 'mid' ? 'leaf-mid' : 'leaf-near') + `-v${cv[0]}-${cv[1]}-${lv}${thin ? '-thin' : ''}${aux ? '-needle' : ''}`, shader => {
    shader.uniforms.leafOn = m.userData.leafOn; shader.uniforms.leafVar = m.userData.leafVar;
    shader.uniforms.time = windUniforms.time; shader.uniforms.windDir = windUniforms.windDir; shader.uniforms.windStrength = windUniforms.windStrength;
    shader.uniforms.crownSway = CROWN_SWAY; shader.uniforms.crownFlex = CROWN_FLEX;
    if (aux) { shader.uniforms.needleAux = m.userData.needleAux; shader.uniforms.needleLight = m.userData.needleLight; shader.uniforms.needleScatterK = m.userData.needleScatterK; shader.uniforms.needleTint = m.userData.needleTint; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float leafRank;\nvarying float vLeafRank;\nvarying float vShim;\n' + WIND_GLSL + LEAF_WAVE_GLSL + (vary ? '\nvarying vec3 vPlantTint;\nuniform float leafVar;' : ''))
      .replace('#include <common>', '#include <common>\n' + (thin ? 'attribute vec4 cardOff;' : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${thin ? `#ifdef USE_INSTANCING
        { float thinD = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
          float thinF = clamp(pow(${THIN_NEAR.toFixed(1)} / thinD, 1.5), ${THIN_MIN.toFixed(2)}, 1.0);
          float thinK = cardOff.w <= 0.0 ? 1.0 : pow(thinF, -${THIN_GROW.toFixed(2)}) * (1.0 - smoothstep(thinF, thinF + 0.08, cardOff.w));
          transformed += cardOff.xyz * (thinK - 1.0); }
        #endif` : ''}
        ${vary ? `#ifdef USE_INSTANCING
          vec3 plantH = fract(instanceMatrix[3].xzx * vec3(0.1031, 0.1030, 0.0973));   // hash of the plant's position (Hoskins hash33, no trig)
        #else
          vec3 plantH = fract(modelMatrix[3].xzx * vec3(0.1031, 0.1030, 0.0973));
        #endif
        plantH += dot(plantH, plantH.yxz + 33.33); plantH = fract((plantH.xxy + plantH.yxx) * plantH.zyx);
        float plantV = 1.0 + ${(2 * cv[0]).toFixed(4)} * (plantH.x - 0.5), plantS = ${(2 * cv[1]).toFixed(4)} * (plantH.y - 0.5);
        vPlantTint = plantV * vec3(1.0 + plantS, 1.0, 1.0 - plantS);
        vLeafRank = mix(leafRank, plantH.z, leafVar);` : 'vLeafRank = leafRank;'}
        ${shimmerVertex(near ? 1 : 0.5, lod !== 'mid')}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float leafOn;\nvarying float vLeafRank;\nvarying float vShim;' + (vary ? '\nvarying vec3 vPlantTint;' : ''))
      .replace('#include <alphatest_fragment>', SHIMMER_ALPHA)
      .replace('#include <clipping_planes_fragment>', 'if (vLeafRank >= leafOn) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <color_fragment>', vary ? '#include <color_fragment>\ndiffuseColor.rgb *= vPlantTint;' : '#include <color_fragment>');
    if (near) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    if (aux) shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D needleAux;\nuniform vec4 needleLight;\nuniform float needleScatterK;\nuniform vec3 needleTint;\nfloat needleThin = 0.0, needleFade = 0.0;\nvec3 needleScatter = vec3( 0.0 );')
      .replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>
        void RE_Direct_Needle( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
          float w = needleLight.y * needleFade;
          float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + w ) / ( 1.0 + w ) );
          float back = saturate( -dot( geometryViewDir, directLight.direction ) ), b2 = back * back;
          float tr = needleLight.z * needleFade * needleThin * ( 0.25 * back + 0.75 * b2 * b2 );
          reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( dotNL + tr * needleTint );
          needleScatter += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( needleScatterK * needleFade * b2 * ( 0.35 + 0.65 * needleThin ) ) * mix( vec3( 1.0 ), needleTint, 0.6 );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Needle`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_INSTANCING
          needleFade = 1.0 - smoothstep( 900.0, 1500.0, length( vViewPosition ) );
        #else
          needleFade = 1.0;
        #endif
        if ( needleFade > 0.0 ) {
          vec4 nAux = texture2D( needleAux, vMapUv );
          // the card's frame from the derivatives of view position and uv (u: card right, v: card up)
          vec3 q0 = dFdx( -vViewPosition ), q1 = dFdy( -vViewPosition );
          vec2 s0 = dFdx( vMapUv ), s1 = dFdy( vMapUv );
          float det = s0.x * s1.y - s1.x * s0.y, sg = det < 0.0 ? -1.0 : 1.0;
          vec3 cT = ( q0 * s1.y - q1 * s0.y ) * sg, cB = ( q1 * s0.x - q0 * s1.x ) * sg;
          vec3 cN = cross( cT, cB );
          vec3 nN = nAux.xyz * 2.0 - 1.0;
          nN = nN.x * normalize( cT + 1e-9 ) + nN.y * normalize( cB + 1e-9 ) + nN.z * normalize( cN + 1e-9 );
          normal = normalize( mix( normal, nN, needleLight.x * needleFade ) );
          needleThin = smoothstep( 0.1, 0.1 + needleLight.w, nAux.a );
        }`)
      .replace('vec3 outgoingLight = reflectedLight.directDiffuse', `reflectedLight.indirectDiffuse += needleScatter${shader.fragmentShader.includes('cloudOnly(vAtmoPos)') ? ' * cloudOnly( vAtmoPos )' : ''};
        vec3 outgoingLight = reflectedLight.directDiffuse`);
    shader.fragmentShader = shader.fragmentShader.replace(/vec3 outgoingLight = [^;]*;/, x => x + SHIMMER_FRAG);   // last: after the needle light's own line
  });
  return m;
}

// ---------------------------------------------------------------------------------------------
// Shimmer: wind in the leaves, read from a distance (2026-10-28). Each card (each leaf inside the leaf level)
// brightens toward a pale sheen, as the sun catches turning leaves, and the flicker runs across the crowns in the wind's
// direction as waves: a sine of the distance downwind (wind.js windDir, 9 m wavelength) less the wind's speed times
// time (2 + 9 x windStrength m/s, so the waves run faster in a stronger wind), with a small offset from the card's
// own hash so neighbouring cards do not flash in lock-step. It is gated by the slow term of the shared gust field
// (wind.js gust: the same ~20 m cells advected downwind), so the shimmer comes in gusts and dies in a lull, and is off
// below windStrength 0.03. Only the cards whose hash says they face the sun (half of them) shimmer, by up to 25% of
// the way to the sheen in a full gust, and only by the sunlit share of their light (a shaded card stays shaded); their alpha
// dips by half that, so the crown's edge breathes. The hash is of the plant's world position and the card's rank (one
// value per card, the same for every viewer), never an instance id. Per vertex: one sine and the gust noise, passed
// on as one varying (vShim). Instanced crowns only (the lineup's single trees stay still); it fades out from 900 to
// 1300 m, before the impostors, which do not shimmer. Mid blobs (not cards) shimmer at half strength. The leaf level
// takes its flutter from the same wave (leafWave), so the rhythm carries through the handover. Measured on the home
// tile (M-series, the GPU shared with other pages, so roughly): the vegetation pass at the opening view 9.1 ms without
// it, 9.75 ms with it; as a deer at 8 am with windStrength 0.3, 10% of the vegetation's pixels brighten by over 3% and
// 2.6% by over 25% (flutter included), 15% and 5% at 0.8; at windStrength 0.02 the frame is identical to a calm one.
//
// The crown's own wave (2026-10-29, Aaron: "there should be a micro-sine-wave in each tree. Right now all the branches of
// a tree move in unison. The wind intensity should ripple across them in a transition from the direction of the wind to
// its destination."). Inside each crown the gust's intensity rides a short travelling sine (crownMicro): a sine of the
// point's distance along the wind from the plant's origin over CROWN_SWAY.y m (3.5) less CROWN_SWAY.z m/s (4: the
// speed wind.js gust advects its cells, so the micro wave runs with the gust it sits in) times time, plus a per-card
// phase from the card's rank (CROWN_SWAY.w: +-0.35 rad), so the windward side of a crown leads the leeward by about a
// second across a 4 m crown and neighbouring sprays are not in lock-step. It (1) moves the branches: each card's
// vertices (and the close tier's twigs, by their place along the twig: twigT, so a twig's base stays on its limb) are
// pushed downwind and a little down by up to CROWN_SWAY.x m per unit windStrength (0.35), times the micro wave, times
// the slow gust term (30% in a lull, all of it in a gust), times the reach (the point's distance from the plant's
// origin over 8 m, at most 1: the trunk and inner crown hold, the outer crown moves); (2) modulates the shimmer and the
// leaf flutter's gust gate by 0.7 to 1.3. The leaf level computes the same displacement from the same field (the
// leaf's point, the card's rank: lA.w), so a crown does not change its motion at the leaf radius. The near and close
// card tiers and the close twigs sway; the mid cards (beyond 180 m, where 10 cm is under a pixel) take only the
// shimmer modulation, the impostors nothing. All of it is multiplied by smoothstep(0.03, 0.2, windStrength): a calm
// frame is unchanged. The displacement is found in world axes and taken into the instance's frame by crownLocal
// (M^-1 d = (M^T d) / column lengths squared, exact for a rotation with per-axis scale, which the plant matrices are).
// CROWN_SWAY is a uniform, so it can be tuned live: (await import('/client/src/treegen.js')).CROWN_SWAY.value.
//
// The second pass (2026-10-29, Aaron: "the sine waves are a little too tight sometimes when the wind is very intense,
// it just makes the tree look like its vibrating rather than the leaves being individually disrupted because the cards
// are all moving as one. If it's possible to have the limbs flex in the direction of the wind I think that would add
// to the effect"): (1) the micro wave's wavelength grows with the wind, crownSway.y x (1 + 1.5 x windStrength up to
// 1), so a strong wind's wave is long and slow (6 m and 0.65 Hz at 0.5, 8.75 m and 0.45 Hz at 1) instead of a 1.1 Hz
// shiver of the whole crown; (2) the per-card phase is wider (crownSway.w 1.6: +-0.8 rad) and each card has a jitter
// of its own (crownFlex.w of the sway's amplitude, 0.3, at its own 1.6-3 Hz from its rank, downwind and half as much
// across), so neighbouring sprays are disrupted one by one; the twigs take no jitter (a card jitters about its twig
// tip). (3) The limbs flex downwind (crownFlexW): every point of the tree, the trunk mesh and the twigs' bases as
// well as the cards and the single leaves, is moved downwind by a lean of crownFlex.x rad per unit windStrength
// (0.035) times the gust (0.4 in a lull, all of it in a gust) times a slow rock of the whole crown at crownFlex.y Hz
// (0.4, the limbs' own swing, a phase per plant from its position) by +-crownFlex.z (0.4), times the height above
// the plant's origin (quadratic over the first 6 m, linear above: the lower trunk holds, the top moves most) and a
// little more at the outer limbs; and a little down, so a limb bends rather than tilts. A 12 m tree in a 0.5 wind
// leans about 0.3 m at the top in a gust and 5 cm in a lull. The trunk's near tier flexes with it (trunkFlex), so the
// crown stays on its limbs; the mid trunks beyond are still, like the mid cards. CROWN_FLEX is a uniform too.
export const CROWN_SWAY = { value: new THREE.Vector4(0.2, 3.5, 4.0, 1.6) };   // 0.35 until Aaron's "the swaying is too intense" (2026-10-29)
export const CROWN_FLEX = { value: new THREE.Vector4(0.02, 0.4, 0.3, 0.2) };   // (0.035, 0.4, 0.4, 0.3) the same
export const LEAF_WAVE_GLSL = `
  uniform vec4 crownSway; uniform vec4 crownFlex;
  float leafWave(vec3 wp, float h, out float gate, out float slow) {
    slow = smoothstep(0.15, 0.75, wNoise((wp.xz - windDir * time * 4.0) * 0.045));
    gate = smoothstep(0.03, 0.2, windStrength) * slow;
    return sin((dot(wp.xz, windDir) - (2.0 + 9.0 * min(windStrength, 0.6)) * time) * 0.7 + h * 1.6);   // the flutter wave's speed stops growing at 0.6 (0.8 Hz): a strong wind is heavy, not twitchy
  }
  float crownMicro(vec3 rel, float rank) {
    float lam = crownSway.y * (1.0 + 1.5 * min(windStrength, 1.0));   // a longer, slower wave in a stronger wind
    return 0.5 + 0.5 * sin((dot(rel.xz, windDir) - crownSway.z * time) * (6.2831853 / lam) + (rank - 0.5) * crownSway.w);
  }
  // the crown's wave at a point, and the card's own jitter (jit: 1 for a card or a leaf, 0 for a twig)
  vec3 crownSwayW(vec3 rel, float micro, float slow, float rank, float jit) {
    float a0 = crownSway.x * smoothstep(0.03, 0.2, windStrength) * min(windStrength, 1.5) * (0.3 + 0.7 * slow) * min(1.0, length(rel) * 0.125);
    float a = a0 * micro;
    float h = fract(rank * 37.7 + 0.13), aj = a0 * min(windStrength, 0.5) / max(min(windStrength, 1.5), 1e-3);   // the jitter's amplitude stops growing at 0.5
    float j = jit * crownFlex.w * aj * sin(time * (5.0 + 5.0 * h) + h * 50.0);   // 0.8-1.6 Hz
    return vec3(windDir.x * (a + j) - windDir.y * 0.5 * j, -0.25 * a, windDir.y * (a + j) + windDir.x * 0.5 * j);
  }
  // the limbs' flex: the point's displacement downwind by the lean, the gust and the crown's slow rock (plantH: 0..1)
  vec3 crownFlexW(vec3 rel, float slow, float plantH) {
    float rock = sin(time * 6.2831853 * crownFlex.y + plantH * 6.2831853);
    float lean = crownFlex.x * smoothstep(0.03, 0.2, windStrength) * min(windStrength, 1.5) * (0.4 + 0.6 * slow) * (1.0 + crownFlex.z * rock);
    float y = max(rel.y, 0.0), d = lean * y * min(y, 6.0) / 6.0 * (0.7 + 0.3 * min(1.0, length(rel.xz) * 0.25));
    return vec3(windDir.x * d, -0.5 * lean * d, windDir.y * d);
  }
  vec3 crownLocal(mat4 M, vec3 d) {
    return (transpose(mat3(M)) * d) / vec3(dot(M[0].xyz, M[0].xyz), dot(M[1].xyz, M[1].xyz), dot(M[2].xyz, M[2].xyz));
  }
  float leafShimmer(float wave, float gate, float h) {
    float s = max(wave, 0.0); s *= s;
    return step(0.5, fract(h * 7.13)) * gate * (0.08 + 0.17 * gate) * s;
  }
`;
const shimmerVertex = (k, sway) => `
        #ifdef USE_INSTANCING
        { mat4 shimM = modelMatrix * instanceMatrix;
          vec3 shimP = (shimM * vec4(transformed, 1.0)).xyz, shimR = shimP - shimM[3].xyz;
          float shimH = fract(leafRank * 173.37 + dot(shimM[3].xz, vec2(0.1031, 0.1173))), shimG, shimS;
          float shimW = leafWave(shimP, shimH, shimG, shimS), shimC = crownMicro(shimR, leafRank);
          shimG *= 0.7 + 0.6 * shimC;${sway ? `
          transformed += crownLocal(shimM, crownSwayW(shimR, shimC, shimS, leafRank, 1.0) + crownFlexW(shimR, shimS, fract(dot(shimM[3].xz, vec2(0.1031, 0.1173)))));` : ''}
          vShim = ${k.toFixed(2)} * (1.0 - smoothstep(900.0, 1300.0, distance(shimP, cameraPosition))) * leafShimmer(shimW, shimG, shimH); }
        #else
          vShim = 0.0;
        #endif`;
const SHIMMER_FRAG = `
      { float shL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)), shD = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722));
        float shK = vShim * clamp(shD / max(shL, 1e-4), 0.0, 1.0);
        outgoingLight = mix(outgoingLight, vec3(1.0, 1.02, 0.94) * max(shL * 1.8, max(outgoingLight.r, outgoingLight.g)), shK); }`;
const SHIMMER_ALPHA = 'diffuseColor.a *= 1.0 - 0.5 * vShim;\n#include <alphatest_fragment>';
// The close tier's twigs sway with the crown's own wave (CROWN_SWAY above) by their place along the twig (the twigT
// attribute, 0 at the base on its limb, 1 at the tip where the close card hangs), so the cards keep their twigs, and
// flex whole with the limbs (crownFlexW, as the trunk mesh does: trunkFlex). Instanced twigs only, rank 0.5 and no
// jitter (a twig tip is off its card by at most a sixth of the sway; the card jitters about it).
export function twigSway(material) {
  return chainShader(material, 'twig-sway', shader => {
    Object.assign(shader.uniforms, { time: windUniforms.time, windDir: windUniforms.windDir, windStrength: windUniforms.windStrength, crownSway: CROWN_SWAY, crownFlex: CROWN_FLEX });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float twigT;\n' + WIND_GLSL + LEAF_WAVE_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        { mat4 swM = modelMatrix * instanceMatrix;
          vec3 swP = (swM * vec4(transformed, 1.0)).xyz, swR = swP - swM[3].xyz;
          float swS = smoothstep(0.15, 0.75, wNoise((swP.xz - windDir * time * 4.0) * 0.045));
          transformed += crownLocal(swM, twigT * crownSwayW(swR, crownMicro(swR, 0.5), swS, 0.5, 0.0) + crownFlexW(swR, swS, fract(dot(swM[3].xz, vec2(0.1031, 0.1173))))); }
        #endif`);
  });
}
// The trunk's near tier flexes with the limbs (crownFlexW: the base on the ground holds, the top moves most), so the
// swaying crown stays on its limbs. Instanced trunks only; the mid trunks beyond are still, like the mid cards.
export function trunkFlex(material) {
  return chainShader(material, 'trunk-flex', shader => {
    Object.assign(shader.uniforms, { time: windUniforms.time, windDir: windUniforms.windDir, windStrength: windUniforms.windStrength, crownSway: CROWN_SWAY, crownFlex: CROWN_FLEX });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_GLSL + LEAF_WAVE_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        { mat4 flM = modelMatrix * instanceMatrix;
          vec3 flP = (flM * vec4(transformed, 1.0)).xyz, flR = flP - flM[3].xyz;
          float flS = smoothstep(0.15, 0.75, wNoise((flP.xz - windDir * time * 4.0) * 0.045));
          transformed += crownLocal(flM, crownFlexW(flR, flS, fract(dot(flM[3].xz, vec2(0.1031, 0.1173))))); }
        #endif`);
  });
}

// ---------------------------------------------------------------------------------------------
// Leaf level (2026-10-28): single leaves inside a few metres of the camera (vegetation.js picks the radius, by body
// size, and the trees). When a card texture is drawn (leafTextureSteps), every leaf it draws is recorded in card
// space: drawLeaf its centre, axis angle, length and the box its shape fills, and its palette tint; a pine's tuft
// (drawNeedleCard: the brush round a ponderosa shoot's end, the loose hanging tuft at a gray pine's) its base, axis
// and size; a Douglas-fir comb and an incense cedar frond (recSpray) as segments about 2.5 needle lengths long. Every
// close card of a species shows the same texture, so one list per species serves all its cards (leafRecords). The
// leaf geometry (leafGeometrySteps) walks the close cards of one (species, seed) exactly as cardGeometry places
// them (it hands each card's frame to a callback) and puts each recorded leaf through the card's frame: the leaf
// keeps its place in the card's plane, so it sits where the card drew it and the dithered handover does not move
// the foliage, and then gets its own depth (a third of the card's size either side of the plane: a spray has
// thickness and parallax) and its own orientation (rolled up to 65 degrees about its axis and pitched up to 35,
// then turned toward the sky, as leaves are; a fir or cedar spray stays flatter, 25 and 12). A tuft is three quads
// crossed through the shoot's axis, tilted out of the card's plane, not single needles. Chamise (fascicle_wand) and
// twig textures record nothing: those species keep their close cards.
// Quads are 4 vertices each, drawn from leafAtlas (the species' leaf, or tuft, or spray, drawn four ways into a
// 256 px atlas, leaves with their veins) with a back-light tint, two-sided, alpha-tested with alpha to coverage.
// Lighting (leafMaterial): the crown-shaped normal of the close cards mixed with the leaf's own face (LEAF_NORMAL_K),
// so a leaf turned to the sun is brighter than its neighbour but the crown keeps its shading; light through the
// leaf (foliage.leaf_translucency, foliage.translucency_rgb, default yellow-green) when the sun is behind it, most
// when the camera looks toward the sun. Each leaf flutters about its base from leafWave (the same travelling wave
// and gust gate as the shimmer) plus a small fast tremble of its own, and shimmers as the cards do.
// Caps: a tree's leaves are capped at LEAF_CAP (100 k); beyond it a fixed fraction keep of them is kept (by hash) and
// each kept leaf grows enough to keep its card's cover (leafCover: the card's effective cover over the leaves' summed
// area, times LEAF_TILT_COVER for leaves seen at a slant; at most the area-preserving 1 / sqrt(keep)). The cap was
// 40 k in the plan; at 40 k a mature blue oak (about 440 k recorded leaves) kept 9% and its leaves came out three
// times their size, a canyon live oak's (1.7 M) five times, so it was raised once the format got small: one quad
// instanced per leaf, 32 bytes a leaf (leafGeometrySteps), so a 100 k leaf tree is 3.2 MB. Measured (home tile):
// blue oak keep 0.14-0.35 and leaves 1.3-1.5x, interior live oak 0.18-0.24 and 1.6-2.2x, valley oak 0.14 and 1.8x;
// gray and ponderosa pine (a few tufts a card), manzanita and the small trees keep every leaf at its own size.
export const LEAF_CAP = 100000, LEAF_Q = 512, LEAF_NORMAL_K = 0.45, LEAF_TILT_COVER = 1.5;
const LEAF_BOX = { lanceolate: [0.18, 0.53], lobed: [0.4, 0.55], oblong_wavy: [0.25, 0.53], elliptic_glossy: [0.25, 0.53], round_vertical: [0.36, 0.53],
  deltoid: [0.45, 0.53], palmate_compound: [0.47, 0.55], pinnate_compound: [0.37, 0.56], trifoliate: [0.44, 0.54], cordate: [0.5, 0.54] };
// [half-width, half-length] of the box a leaf of this shape fills, in leaf lengths, centred on the leaf's centre
function leafBox(shape, F) {
  if (shape === 'lobed_large') return (F?.lobe_style ?? 'pinnate') === 'palmate' ? [0.55, 0.55] : [0.4, 0.55];
  return LEAF_BOX[shape] || [leafWidth(shape) * 1.1, 0.53];
}
// A comb or frond of length L from (x0, y0) along a, recorded as segments about `seg` long (canvas px).
function recSpray(rec, x0, y0, a, L, w, seg) {
  const n = Math.max(1, Math.round(L / seg)), sl = L / n;
  for (let k = 0; k < n; k++) rec.push({ t: 2, x: x0 + Math.sin(a) * sl * k, y: y0 - Math.cos(a) * sl * k, a, f: sl * 1.06, b: sl * 0.04, w });
}
// Records to a Float32Array, stride LEAF_STRIDE: type (0 leaf, 1 tuft, 2 spray), base x, y in the card's frame (card
// size 1, centre 0, y up the card), axis angle (0 up the card, clockwise), forward and back extent along the axis,
// half-width, tint rgb (the fill over the mean fill, 1 for needles).
const LEAF_STRIDE = 10;
function packLeaves(rec, S) {
  if (!rec || !rec.length) return null;
  let lum = 0, nl = 0;
  for (const r of rec) if (r.fill) { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(r.fill); if (!m) continue; r.c = [+m[1], +m[2], +m[3]]; lum += 0.2126 * r.c[0] + 0.7152 * r.c[1] + 0.0722 * r.c[2]; nl++; }
  const mean = nl ? lum / nl : 1, out = new Float32Array(rec.length * LEAF_STRIDE);
  rec.forEach((r, i) => out.set([r.t, r.x / S - 0.5, 0.5 - r.y / S, r.a, r.f / S, r.b / S, r.w / S, ...(r.c ? r.c.map(v => v / mean) : [1, 1, 1])], i * LEAF_STRIDE));
  return out;
}
// The recorded leaves of a species' close card (null: no leaf level for it).
export function leafRecords(name) {
  const id = resolveSpecies(name); if (!id || typeof document === 'undefined') return null;
  const spec = LIBRARY[id]; return leafTexture(spec, spec.lod.close_scale).userData.leaves || null;
}

// The atlas: 2 x 2 tiles of LEAF_TILE px, each a variant of the species' leaf (type 0, the box of leafBox, tip up),
// tuft (1) or spray segment (2, base at the bottom); content inset LEAF_PAD px so the mips do not bleed. RGB are
// multipliers (the material divides by the mean), alpha the shape, with coverage-keeping mips as the cards'.
const LEAF_TILE = 128, LEAF_PAD = 4, atlases = new Map();
export function leafAtlas(spec) {
  if (atlases.has(spec.id)) return atlases.get(spec.id);
  const recs = leafRecords(spec.id); if (!recs) { atlases.set(spec.id, null); return null; }
  const type = recs[0], F = spec.foliage, T = LEAF_TILE, I = T - 2 * LEAF_PAD;
  const c = document.createElement('canvas'); c.width = c.height = 2 * T;
  const g = c.getContext('2d'); g.lineCap = 'round';
  // the canonical record each tile is drawn for: f, b, w in needle lengths (types 1, 2)
  const pine = F.leaf_shape === 'needle_brush' ? [2.55, 0.35, 1.15] : [1.1, 0.9, 1.2], spray = [2.65, 0.1, F.leaf_shape === 'needle_scale' ? 0.9 : 0.95];
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * T + LEAF_PAD, oy = (t >> 1) * T + LEAF_PAD, rnd = mulberry32(hashStr(spec.id) ^ (0x1eaf00 + t));
    g.save(); g.beginPath(); g.rect(ox, oy, I, I); g.clip();
    if (type === 0) paintLeafTile(g, ox, oy, I, F, rnd);
    else {
      const [f, b, w] = type === 1 ? pine : spray, P = (x, y) => [ox + I / 2 + x / w * I / 2, oy + I * f / (f + b) - y / (f + b) * I];   // needle lengths to px, y up the axis
      if (type === 1) paintTuftTile(g, P, F, rnd, I / (f + b)); else paintSprayTile(g, P, F, rnd, I / (f + b));
    }
    g.restore();
  }
  const t = new THREE.Texture();
  t.mipmaps = coverageMips(c, 0.5);
  t.image = t.mipmaps[0];
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  t.userData.mean = meanGrey(t.mipmaps[0]); t.userData.type = type;
  atlases.set(spec.id, t);
  return t;
}
// One leaf filling the tile (its leafBox), tip up, with a pale midrib and secondary veins on the blade.
function paintLeafTile(g, ox, oy, I, F, rnd) {
  const shape = F.leaf_shape, [hw, hh] = leafBox(shape, F), len = I / (2 * hh);
  g.translate(ox + I / 2, oy + I / 2); g.scale(hh / hw, 1);
  drawLeaf(g, 0, 0, 0, len, shape === 'round_vertical' ? 'oval' : shape, 'rgb(212,220,200)', rnd, F);
  if (shape in COMPOUND) return;   // leaflets: the drawn stalks are the veins
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = 'rgba(246,252,222,0.6)'; g.lineWidth = Math.max(1, len * 0.022);
  g.beginPath(); g.moveTo(0, len * 0.5); g.lineTo(0, -len * 0.47); g.stroke();
  g.lineWidth = Math.max(0.7, len * 0.009); g.strokeStyle = 'rgba(240,248,215,0.4)';
  for (let k = 1; k <= 6; k++) {
    const y = len * (0.36 - k * 0.12);
    for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(sd * len * hw * 0.45, y - len * 0.06, sd * len * hw * (0.85 + 0.1 * rnd()), y - len * 0.15); g.stroke(); }
  }
  g.globalCompositeOperation = 'source-over';
}
// A pine tuft seen from the side, P(x, y) in needle lengths (base at 0, the shoot up y), u px per needle length.
function paintTuftTile(g, P, F, rnd, u) {
  const brush = F.leaf_shape === 'needle_brush', droop = F.droop ?? (brush ? 0 : 0.8), shade = v => `rgb(${v},${Math.min(255, v + 8)},${Math.max(0, v - 12)})`;
  const needle = (x, y, a, L, bend) => {
    const pts = [P(x, y)]; let px0 = x, py0 = y;
    for (let i = 1; i <= 5; i++) { const ai = a + bend * Math.pow((i - 0.5) / 5, 1.6); px0 += Math.sin(ai) * L / 5; py0 += Math.cos(ai) * L / 5; pts.push(P(px0, py0)); }
    const gr = g.createLinearGradient(...pts[0], ...pts[5]); gr.addColorStop(0, shade(120 + 30 * rnd() | 0)); gr.addColorStop(0.6, shade(185 + 30 * rnd() | 0)); gr.addColorStop(1, shade(225 + 30 * rnd() | 0));
    g.strokeStyle = gr; g.lineWidth = Math.max(1, u * (brush ? 0.03 : 0.022));
    g.beginPath(); g.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) g.lineTo(...pts[i]); g.stroke();
  };
  g.strokeStyle = 'rgb(105,100,90)'; g.lineWidth = Math.max(1.5, u * 0.05);
  if (brush) {
    const [x0, y0] = P(0, 0), [x1, y1] = P(0, 1.4); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    for (let i = 0; i < 70; i++) {
      const d = 1.4 * Math.pow(rnd(), 0.9), th = (0.15 + 1.2 * Math.min(1, d / 0.9) + 0.3 * rnd()) * (rnd() < 0.5 ? -1 : 1), proj = 0.4 + 0.6 * rnd();
      needle(0, 1.4 - d, th * proj, (0.7 + 0.45 * rnd()) * (0.4 + 0.6 * proj), -Math.sign(th) * 0.3);
    }
  } else {
    for (let i = 0; i < 26; i++) {
      const th = (0.15 + 1.3 * rnd()) * (rnd() < 0.5 ? -1 : 1), a = th, L = 0.75 + 0.35 * rnd();
      needle(0, 0, a, L, Math.sign(a) * (Math.PI - Math.abs(a)) * Math.min(0.9, droop * (0.6 + 0.5 * rnd())) * 0.6);
    }
  }
}
// A spray segment: a Douglas-fir shoot with its comb of flat needles either side, or an incense cedar frond's rachis
// with alternate branchlets of scale leaves, base at 0 and running up y.
function paintSprayTile(g, P, F, rnd, u) {
  const line = (a, b, w, v) => { g.strokeStyle = `rgb(${v | 0},${Math.min(255, v + 6) | 0},${Math.max(0, v - 10) | 0})`; g.lineWidth = Math.max(1, w); g.beginPath(); g.moveTo(...P(...a)); g.lineTo(...P(...b)); g.stroke(); };
  line([0, -0.1], [0, 2.65], u * 0.05, 110);
  if (F.leaf_shape === 'needle_scale') {
    let side = rnd() < 0.5 ? 1 : -1;
    for (let s = 0.15; s < 2.6; s += 0.32 * (0.85 + 0.3 * rnd())) {
      const b = side * (0.8 + 0.25 * rnd()), l = 0.55 + 0.35 * rnd(), e = [Math.sin(b) * l, s + Math.cos(b) * l];
      line([0, s], e, u * 0.085, 150 + 40 * rnd());
      let s2 = rnd() < 0.5 ? 1 : -1;
      for (let q = l * 0.3; q < l; q += 0.17) { const t = q / l, cx = e[0] * t, cy = s + (e[1] - s) * t, c = b + s2 * (0.75 + 0.3 * rnd()), cl = 0.26 * (1 - 0.5 * t); line([cx, cy], [cx + Math.sin(c) * cl, cy + Math.cos(c) * cl], u * 0.065, 165 + 40 * rnd()); s2 = -s2; }
      side = -side;
    }
    return;
  }
  for (let s = 0.06; s < 2.62; s += 0.12 * (0.8 + 0.4 * rnd())) for (const sd of [-1, 1]) {
    const a = sd * (0.95 + 0.4 * (rnd() - 0.5)), L = 0.85 + 0.25 * rnd();
    const gr = g.createLinearGradient(...P(0, s), ...P(Math.sin(a) * L, s + Math.cos(a) * L)); gr.addColorStop(0, 'rgb(150,156,140)'); gr.addColorStop(1, `rgb(${215 + 30 * rnd() | 0},225,205)`);
    g.strokeStyle = gr; g.lineWidth = Math.max(1, u * 0.07); g.beginPath(); g.moveTo(...P(0, s)); g.quadraticCurveTo(...P(Math.sin(a) * L * 0.5, s + Math.cos(a) * L * 0.55), ...P(Math.sin(a) * L, s + Math.cos(a) * L * 0.9)); g.stroke();
  }
}

// leafGeometrySteps(speciesId, seed): the leaf level of one tree, in buildTree's frame (lean applied), as a generator
// that yields every 150 cards (vegetation.js steps it within a time budget, so walking into a new tree does not
// hitch). An InstancedBufferGeometry: one quad (four corners, `position` x -1 | 1 across, y 0 at the leaf's base and
// 1 at its tip) drawn once per leaf, the leaves as instance attributes, 32 bytes a leaf: lC (Int16: the leaf's axis
// point at 1/LEAF_Q m, w its hash), lA and lN (Int8: its axis and face, w the card's rank), lS (Uint16 over LEAF_SIZE_M:
// forward and back extent and half-width, w the atlas tile), lK (Uint8: colour over the summer colour) and lM (Int8: the
// crown-shaped normal of the close card there). Returns { geometry, leaves, total, keep, grow, bytes } or null.
export const LEAF_SIZE_M = 2;
export function* leafGeometrySteps(name, seed = 1) {
  const id = resolveSpecies(name), recs = id ? leafRecords(id) : null; if (!recs) return null;
  const sk = skeleton(specForSeed(LIBRARY[id], seed), seed), spec = sk.spec, F = spec.foliage, C = sk.centre, Rr = sk.radii;
  const cover = leafCover(LIBRARY[id]);
  const frames = [];
  cardGeometry(sk, 1, sk.closeCards, spec.lod.close_scale, (c, n, u, s, col, rank, out, k) => { if (k === 0 && s > 0) frames.push([c.clone(), n.clone(), u.clone(), s, col.slice(), rank, out.clone()]); });
  yield;
  const nr = recs.length / LEAF_STRIDE;
  let per = 0; for (let j = 0; j < nr; j++) per += recs[j * LEAF_STRIDE] === 1 ? 3 : 1;
  const total = frames.length * per, keep = Math.min(1, LEAF_CAP / Math.max(1, total));
  // fewer leaves, each larger, to keep the card's cover (1 - exp(-area)): the leaves of a card overlap, so the area to
  // keep is the card's effective cover, not the drawn leaves' sum, times LEAF_TILT_COVER for the leaves turned out of
  // the card's plane (seen at a slant); never more than the area-preserving 1 / sqrt(keep)
  const grow = keep >= 1 ? 1 : Math.min(1 / Math.sqrt(keep), Math.max(1, Math.sqrt(LEAF_TILT_COVER * cover.eff / (keep * Math.max(1e-3, cover.area)))));
  const cap = Math.ceil(total * keep * 1.06) + 64;
  const lC = new Int16Array(cap * 4), lA = new Int8Array(cap * 4), lN = new Int8Array(cap * 4), lS = new Uint16Array(cap * 4), lK = new Uint8Array(cap * 4), lM = new Int8Array(cap * 4);
  const summer = F.colors.summer.map(srgbToLin), xf = new THREE.Matrix4().makeRotationY(sk.leanDir).multiply(new THREE.Matrix4().makeRotationZ(sk.lean));
  const right = new THREE.Vector3(), B = new THREE.Vector3(), A0 = new THREE.Vector3(), S0 = new THREE.Vector3(), A = new THREE.Vector3(), N = new THREE.Vector3(), Sd = new THREE.Vector3();
  const cn = new THREE.Vector3(), q = new THREE.Vector3(), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const ROLL = 65 * DEG, PITCH = 35 * DEG, ROLL2 = 25 * DEG, PITCH2 = 12 * DEG, TILT = 25 * DEG, DEPTH = 0.33, SKY = 0.4;
  const q16 = v => Math.max(-32767, Math.min(32767, Math.round(v * LEAF_Q))), q8 = v => Math.max(-127, Math.min(127, Math.round(v * 127))), qs = v => Math.min(65535, Math.round(v / LEAF_SIZE_M * 65535));
  let n = 0, frameOut = null, frameCol = null, maxR = 0;
  // one leaf: axis point B, axis A, face N; extents f, b along A, half-width w; atlas tile t; hash h
  const leaf = (f, b, w, t, h, rgb, rank) => {
    if (n >= cap) return;
    cn.subVectors(B, C).divide(Rr).normalize().multiplyScalar(0.8).addScaledVector(frameOut, 0.2).normalize().applyMatrix4(xf);
    q.copy(B).applyMatrix4(xf); lo.min(q); hi.max(q); maxR = Math.max(maxR, f + w, b + w);
    const o = n * 4;
    lC[o] = q16(q.x); lC[o + 1] = q16(q.y); lC[o + 2] = q16(q.z); lC[o + 3] = Math.round((h * 2 - 1) * 32767);
    q.copy(A).applyMatrix4(xf); lA[o] = q8(q.x); lA[o + 1] = q8(q.y); lA[o + 2] = q8(q.z); lA[o + 3] = q8(rank * 2 - 1);
    q.copy(N).applyMatrix4(xf); lN[o] = q8(q.x); lN[o + 1] = q8(q.y); lN[o + 2] = q8(q.z);
    lM[o] = q8(cn.x); lM[o + 1] = q8(cn.y); lM[o + 2] = q8(cn.z);
    lS[o] = qs(f); lS[o + 1] = qs(b); lS[o + 2] = qs(w); lS[o + 3] = Math.round(t / 3 * 65535);
    for (let i = 0; i < 3; i++) lK[o + i] = Math.max(0, Math.min(255, Math.round(frameCol[i] / Math.max(1e-6, summer[i]) * rgb[i] * 127.5)));
    lK[o + 3] = 255;
    n++;
  };
  for (let ci = 0; ci < frames.length; ci++) {
    const [c, nn, u, s, col, rank, out] = frames[ci]; frameOut = out; frameCol = col;
    right.crossVectors(u, nn).normalize();
    const rnd = mulberry32(Math.imul(seed, 2654435761) ^ Math.imul(ci + 1, 40503) ^ 0x1eaf);
    for (let j = 0; j < nr; j++) {
      const o = j * LEAF_STRIDE, type = recs[o], h0 = rnd(), h1 = rnd(), h2 = rnd(), h3 = rnd(), h4 = rnd();
      if (h0 >= keep) continue;
      const a = recs[o + 3], f = recs[o + 4] * s * grow, b = recs[o + 5] * s * grow, w = recs[o + 6] * s * grow, rgb = [recs[o + 7], recs[o + 8], recs[o + 9]], tile = Math.floor(h4 * 4) & 3;
      B.copy(c).addScaledVector(right, recs[o + 1] * s).addScaledVector(u, recs[o + 2] * s).addScaledVector(nn, (h1 - 0.5) * s * DEPTH);
      A0.copy(right).multiplyScalar(Math.sin(a)).addScaledVector(u, Math.cos(a));
      S0.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(u, -Math.sin(a));
      if (type === 1) {
        // a tuft: tilted out of the card's plane, then three quads crossed through its axis
        const ph = (h2 - 0.5) * 2 * TILT;
        A.copy(A0).multiplyScalar(Math.cos(ph)).addScaledVector(nn, Math.sin(ph));
        const N0 = nn.clone().multiplyScalar(Math.cos(ph)).addScaledVector(A0, -Math.sin(ph));
        Sd.crossVectors(A, N0);
        for (let p = 0; p < 3; p++) {
          const th = h3 * Math.PI + p * Math.PI / 3;
          N.copy(N0).multiplyScalar(Math.cos(th)).addScaledVector(Sd, Math.sin(th));
          leaf(f, b, w, (tile + p) & 3, (h1 + p * 0.37) % 1, rgb, rank);
        }
        continue;
      }
      const roll = (h2 - 0.5) * 2 * (type ? ROLL2 : ROLL), pitch = (h3 - 0.5) * 2 * (type ? PITCH2 : PITCH);
      N.copy(nn).multiplyScalar(Math.cos(roll)).addScaledVector(S0, Math.sin(roll));   // roll about the axis
      A.copy(A0).multiplyScalar(Math.cos(pitch)).addScaledVector(N, Math.sin(pitch));   // pitch about the side
      N.multiplyScalar(Math.cos(pitch)).addScaledVector(A0, -Math.sin(pitch));
      if (!type) {   // leaves turn their face to the sky
        if (N.y < 0) N.negate();
        N.y += SKY; N.normalize();
        A.addScaledVector(N, -A.dot(N)).normalize();
      }
      leaf(f, b, w, tile, h4 * 4 % 1, rgb, rank);
    }
    if (ci % 150 === 149) yield;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const ia = (arr, norm) => new THREE.InstancedBufferAttribute(arr.slice(0, n * 4), 4, norm);
  g.setAttribute('lC', ia(lC, false)); g.setAttribute('lA', ia(lA, true)); g.setAttribute('lN', ia(lN, true));
  g.setAttribute('lS', ia(lS, true)); g.setAttribute('lK', ia(lK, true)); g.setAttribute('lM', ia(lM, true));
  g.instanceCount = n;
  if (!n) lo.set(0, 0, 0), hi.set(0, 0, 0);
  g.boundingBox = new THREE.Box3(lo, hi).expandByScalar(maxR);
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return { geometry: g, leaves: n, total, keep, grow, bytes: n * 32 };
}
export function buildLeaves(name, seed = 1) { return drain(leafGeometrySteps(name, seed)); }
// A species' close card: the leaves' summed area (in card areas, the leafBox ellipse for a leaf, the box for the rest)
// and its effective cover, -ln(1 - the texture's alpha-tested cover) (leafGeometrySteps' size compensation).
function leafCover(spec) {
  const t = leafTexture(spec, spec.lod.close_scale), ud = t.userData;
  if (ud.leafCover) return ud.leafCover;
  const r = ud.leaves; let area = 0;
  for (let o = 0; o < r.length; o += LEAF_STRIDE) area += (r[o + 4] + r[o + 5]) * 2 * r[o + 6] * (r[o] ? 0.5 : Math.PI / 4) * (r[o] === 1 ? 3 : 1);
  const d = t.mipmaps[0].data; let c = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) c++;
  ud.leafCover = { area, eff: -Math.log(Math.max(1e-3, 1 - c / (d.length / 4))) };
  return ud.leafCover;
}

// The leaf level's material (see above): the atlas, the shimmer and flutter (leafWave), the card's rank against
// leafOn (the same cards leaf out and drop as the close tier's), the plant's tint (foliage.color_var). Drawn per tree
// (a Mesh whose matrix is the close instance's, on leafGeometrySteps' instanced quads), so no instance matrix and no
// drape: the leaf level is within 18 m of the camera, inside the fine ground square, where the drape is nil.
// applySeason sets its colour (the season's over summer's) and userData.off when the close cards show what the
// leaves cannot (a bare crown's twigs, flowers, berries): vegetation.js then keeps those crowns on their close cards.
export function leafMaterial(spec, patch = null) {
  const F = spec.foliage, atlas = typeof document !== 'undefined' ? leafAtlas(spec) : null; if (!atlas) return null;
  const m = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  m.alphaToCoverage = true;
  const ud = m.userData;
  ud.leafLevel = true; ud.texScale = null; ud.gain = 1 / atlas.userData.mean; ud.off = false;
  ud.leafOn = { value: 1 }; ud.leafVar = { value: F.leaf_on_var || 0 };
  ud.leafBase = { value: new THREE.Vector3(...F.colors.summer.map(srgbToLin)) };
  // (face weight, translucency, wrap, needle): leaves light by their face and pass light through it when the sun is
  // behind; tufts and sprays (no face to speak of) as the needle cards do: wrapped, and light through them by how far
  // the camera looks toward the sun (canopyMaterial's needle light: foliage.translucency, foliage.needle_wrap)
  const ndl = F.type !== 'broadleaf';
  ud.leafLight = { value: new THREE.Vector4(ndl ? 0.2 : LEAF_NORMAL_K, ndl ? (F.translucency ?? 2.5) * 0.6 : F.leaf_translucency ?? 0.5, ndl ? F.needle_wrap ?? 0.35 : 0, ndl ? 1 : 0) };
  ud.leafTint = { value: new THREE.Vector3(...(F.translucency_rgb || [1, 1.12, 0.55])) };
  m.color.setScalar(ud.gain);
  if (patch) patch(m);
  const cv = F.color_var || [0, 0], lv = F.leaf_on_var || 0, T = LEAF_TILE, W = 2 * T, PD = LEAF_PAD;
  chainShader(m, `leaf-level-v${cv[0]}-${cv[1]}-${lv}`, shader => {
    Object.assign(shader.uniforms, { leafOn: ud.leafOn, leafVar: ud.leafVar, leafBase: ud.leafBase, leafLight: ud.leafLight, leafTint: ud.leafTint,
      time: windUniforms.time, windDir: windUniforms.windDir, windStrength: windUniforms.windStrength, crownSway: CROWN_SWAY, crownFlex: CROWN_FLEX });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 lC; attribute vec4 lA; attribute vec4 lN; attribute vec4 lS; attribute vec4 lK; attribute vec4 lM;
        uniform vec3 leafBase; uniform float leafVar;
        varying vec3 vLeafCol; varying vec3 vLeafNv; varying float vLeafRank; varying float vShim;
        ${WIND_GLSL}
        ${LEAF_WAVE_GLSL}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
        { float t = floor(lS.w * 3.0 + 0.5), tx = mod(t, 2.0), ty = floor(t * 0.5);
          vMapUv = vec2((tx * ${T}.0 + ${PD}.0 + (position.x * 0.5 + 0.5) * ${T - 2 * PD}.0) / ${W}.0, 1.0 - (ty * ${T}.0 + ${PD}.0 + (1.0 - position.y) * ${T - 2 * PD}.0) / ${W}.0); }
        #endif`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(lM.xyz);')
      .replace('#include <begin_vertex>', `
        vec3 leafAx = normalize(lA.xyz), leafNo = normalize(lN.xyz), leafSd = cross(leafAx, leafNo);
        float leafF = lS.x * ${LEAF_SIZE_M.toFixed(1)}, leafB = lS.y * ${LEAF_SIZE_M.toFixed(1)}, leafHW = lS.z * ${LEAF_SIZE_M.toFixed(1)};
        vec3 transformed = lC.xyz * ${(1 / LEAF_Q).toFixed(8)} + leafSd * (position.x * leafHW) + leafAx * (position.y > 0.5 ? leafF : -leafB);
        {
          vec3 plantH = fract(modelMatrix[3].xzx * vec3(0.1031, 0.1030, 0.0973));
          float leafH = lC.w / 65534.0 + 0.5, leafG, leafS;
          vec3 leafP = (modelMatrix * vec4(transformed, 1.0)).xyz, leafR = leafP - modelMatrix[3].xyz;
          float leafWv = leafWave(leafP, leafH, leafG, leafS), leafC = crownMicro(leafR, lA.w * 0.5 + 0.5);
          leafG *= 0.7 + 0.6 * leafC;
          // the leaf turns about its base: with the travelling wave (more in a gust) and a small tremble of its own
          float leafA = (0.06 + 0.4 * leafG) * min(windStrength, 0.8) * leafWv + 0.05 * min(windStrength, 0.6) * sin(time * (5.0 + 4.0 * leafH) + leafH * 40.0);   // capped: a strong wind does not thrash the leaves faster
          transformed += leafNo * (position.y * (leafF + leafB) * leafA);
          // and moves with its branch: the crown's own wave and the limbs' flex, as the card it replaces
          transformed += crownLocal(modelMatrix, crownSwayW(leafR, leafC, leafS, lA.w * 0.5 + 0.5, 1.0) + crownFlexW(leafR, leafS, fract(dot(modelMatrix[3].xz, vec2(0.1031, 0.1173)))));
          vShim = leafShimmer(leafWv, leafG, leafH);
          plantH += dot(plantH, plantH.yxz + 33.33); plantH = fract((plantH.xxy + plantH.yxx) * plantH.zyx);
          float plantV = 1.0 + ${(2 * cv[0]).toFixed(4)} * (plantH.x - 0.5), plantS = ${(2 * cv[1]).toFixed(4)} * (plantH.y - 0.5);
          vLeafCol = lK.rgb * 2.0 * leafBase * plantV * vec3(1.0 + plantS, 1.0, 1.0 - plantS);
          vLeafRank = mix(lA.w * 0.5 + 0.5, plantH.z, leafVar);
          vLeafNv = normalMatrix * leafNo;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float leafOn; uniform vec4 leafLight; uniform vec3 leafTint;
        varying vec3 vLeafCol; varying vec3 vLeafNv; varying float vLeafRank; varying float vShim;
        vec3 leafFace = vec3(0.0, 0.0, 1.0);`)
      .replace('#include <clipping_planes_fragment>', 'if (vLeafRank >= leafOn) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vLeafCol;')
      .replace('#include <alphatest_fragment>', SHIMMER_ALPHA)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '') + `
        leafFace = normalize(vLeafNv) * faceDirection;
        normal = normalize(mix(normal, leafFace, leafLight.x));`)
      .replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>
        void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
          float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + leafLight.z ) / ( 1.0 + leafLight.z ) );
          float back = saturate( -dot( leafFace, directLight.direction ) ), fwd = saturate( -dot( geometryViewDir, directLight.direction ) ), f2 = fwd * fwd;
          vec3 tr = leafLight.y * mix( back * ( 0.35 + 0.65 * f2 ), 0.25 * fwd + 0.75 * f2 * f2, leafLight.w ) * leafTint;
          reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( dotNL + tr );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Leaf`);
    shader.fragmentShader = shader.fragmentShader.replace(/vec3 outgoingLight = [^;]*;/, x => x + SHIMMER_FRAG);
  });
  return m;
}

// Wood material. Without a species it is the plain vertex-colour material every species can share
// (as before). With one, it carries that species' bark texture and normal map (barkTexture), applied
// where the wood geometry's barkMix attribute is 1 (not on mistletoe). In the world (instanced) only
// within BARK_FAR m of the camera: beyond it a plate or furrow is under two pixels, so the texture and
// normal map fade out over BARK_FADE m and are then skipped (the texture is a multiplier around 1, so
// the mean colour is unchanged).
export const BARK_FAR = 120, BARK_FADE = 20;
export function trunkMaterial(patch = null, spec = null) {
  const bark = spec && typeof document !== 'undefined' ? barkTexture(spec) : null;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...(bark ? { map: bark.map, normalMap: bark.normal, normalScale: new THREE.Vector2(1, 1).multiplyScalar(spec.trunk.bark?.relief ?? 1) } : {}) });
  if (bark) m.userData.gain = 1 / bark.map.userData.mean;
  if (bark) m.color.setScalar(m.userData.gain);
  if (patch) patch(m);
  if (bark) chainShader(m, 'bark', shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float barkMix;\nvarying float vBarkMix;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkMix = barkMix;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec2 barkS = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));   // the bark tiles in metres: an instance scaled up (old growth from height, girth and height apart) keeps its plate size
        #ifdef USE_MAP
          vMapUv *= barkS;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv *= barkS;
        #endif
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBarkMix;')
      .replace('#include <map_fragment>', `#ifdef USE_INSTANCING
        float barkNear = clamp((${(BARK_FAR + BARK_FADE / 2).toFixed(1)} - length(vViewPosition)) / ${BARK_FADE.toFixed(1)}, 0.0, 1.0);
      #else
        float barkNear = 1.0;   // single meshes (the lineup) keep their bark at any distance
      #endif
      float barkW = vBarkMix * barkNear;
      #ifdef USE_MAP
        vec3 sampledBark = barkW > 0.0 ? texture2D( map, vMapUv ).rgb : vec3( 1.0 );
        diffuseColor.rgb *= mix( vec3( 1.0 / max( 0.05, diffuse.r ) ), sampledBark, barkW );
      #endif`)
      .replace('#include <normal_fragment_maps>', `if (barkW > 0.0) { vec3 geoNormal = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(geoNormal, normal, barkW)); }`);
  });
  return m;
}

// Season look for a species' canopy material: tint = season colour / baked summer colour (linear),
// leaf-on from the file. Card materials also switch texture: the season's (foliage.tips) and, when a
// deciduous crown is bare, the winter twig texture on the same cards (foliage.winter_twigs: the
// fraction of cards that show twigs; twig colour from trunk.twig_rgb). Returns the fraction of cards
// drawn, so callers can hide a crown that draws nothing.
// `month` (1-12.99, default the season's middle month): foliage.leaf_on_by_month and the months of
// flowers and berries (leafOnAt, decoActive). Flowers marked before_leaves show on the bare-crown texture
// while the crown is under half leafed (redbud in March), on max(winter_twigs, 0.5) of the cards.
// applySeasonSteps: the same, as a generator that yields while it draws a season texture it has not drawn before
// (slice.js); applySeason runs it in one go.
export function applySeason(material, spec, season, month = null) { return drain(applySeasonSteps(material, spec, season, month)); }
export function* applySeasonSteps(material, spec, season, month = null) {
  const F = spec.foliage, c = F.colors, ud = material.userData;
  let col = c[season] || c.summer, on = leafOnAt(spec, season, month);
  if (ud.leafLevel) {   // leafMaterial: off while the close cards show bare twigs, flowers or berries
    const fl = decoActive(F.flowers, season, month), be = decoActive(F.berries, season, month);
    ud.off = (on <= 0.02 && !!F.winter_twigs) || !!fl || !!be || on <= 0;
    material.color.setRGB(...col.map((v, i) => ud.gain * srgbToLin(v) / Math.max(1e-4, srgbToLin(c.summer[i]))));
    ud.leafOn.value = on;
    return on;
  }
  if (ud.texScale != null) {
    const fl = decoActive(F.flowers, season, month), be = decoActive(F.berries, season, month);
    const bareFlowers = fl && F.flowers.before_leaves && on < 0.5;
    const deco = (fl && (!F.flowers.before_leaves || bareFlowers || on >= 0.5) ? 'f' : '') + (be ? 'b' : '');
    let tex = yield* leafTextureSteps(spec, ud.texScale, season, deco, season);
    const twigs = (on <= 0.02 && !!F.winter_twigs) || bareFlowers;
    if (twigs) { tex = yield* leafTextureSteps(spec, ud.texScale, 'twig', deco, season); on = bareFlowers ? Math.max(F.winter_twigs || 0, 0.5) : F.winter_twigs; col = spec.trunk.twig_rgb || spec.trunk.bark_rgb; }
    if (ud.leafVar) ud.leafVar.value = twigs ? 0 : F.leaf_on_var || 0;
    if (material.map !== tex) material.map = tex;
    ud.gain = 1 / tex.userData.mean;
  }
  const gain = ud.gain ?? 1;
  material.color.setRGB(...col.map((v, i) => gain * srgbToLin(v) / Math.max(1e-4, srgbToLin(c.summer[i]))));
  ud.leafOn.value = on;
  return on;
}

// ---------------------------------------------------------------------------------------------
// Bark: a tileable canvas texture per species (colour multipliers around 1, so trunk.bark_rgb keeps
// the mean) and a normal map from the same height field. trunk.bark: { tile_m: [width, height] of
// one tile in metres, plate_m: [w, h] of a plate or check, fissure (0..1 width), contrast, lichen,
// relief (normal strength) }; the pattern is trunk.bark_pattern.
const barkCache = new Map();
function tileNoise(seed) {   // value noise on an integer lattice that wraps with periods (px, py)
  const h = (x, y) => { let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  return (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (a, p) => ((a % p) + p) % p, x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
    return (h(x0, y0) * (1 - sx) + h(x1, y0) * sx) * (1 - sy) + (h(x0, y1) * (1 - sx) + h(x1, y1) * sx) * sy;
  };
}
// barkTextureSteps: the same texture as a generator yielding every 16 rows (slice.js; Vegetation.build warms the cache
// with it before trunkMaterial asks); barkTexture runs it in one go.
export function barkTexture(spec) { return drain(barkTextureSteps(spec)); }
export function* barkTextureSteps(spec) {
  if (barkCache.has(spec.id)) return barkCache.get(spec.id);
  const T = spec.trunk, B = T.bark || {}, pattern = T.bark_pattern || 'furrowed', W = 256, Hh = 512;
  const [tw, th] = B.tile_m || [0.5, 1.0], seed = hashStr(spec.id + ':bark'), rnd = mulberry32(seed), noise = tileNoise(seed);
  const fbm = (u, v, fu, fv, oct = 4) => { let s = 0, a = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += a * noise(u * fu, v * fv, fu, fv); n += a; a *= 0.5; fu *= 2; fv *= 2; } return s / n; };
  const height = new Float32Array(W * Hh), col = new Float32Array(W * Hh * 3);
  // Voronoi cells on a jittered grid that wraps: plates (ponderosa) and checks (blue oak).
  const [pw, ph] = B.plate_m || ({ plates: [0.22, 0.45], platy: [0.1, 0.2], peeling_red: [0.1, 0.18] }[pattern] || [0.05, 0.08]);
  const gx = Math.max(2, Math.round(tw / pw)), gy = Math.max(2, Math.round(th / ph));
  const pts = []; for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) pts.push([(i + 0.15 + 0.7 * rnd()) / gx, (j + 0.15 + 0.7 * rnd()) / gy, rnd()]);
  const vor = (u, v) => {   // [F1, F2, id] in metres
    const ci = Math.floor(u * gx), cj = Math.floor(v * gy); let f1 = 1e9, f2 = 1e9, id = 0, id2 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ((ci + di) % gx + gx) % gx, jj = ((cj + dj) % gy + gy) % gy, p = pts[jj * gx + ii];
      const px = p[0] + (ci + di - ii) / gx, py = p[1] + (cj + dj - jj) / gy;
      const d = Math.hypot((u - px) * tw, (v - py) * th);
      if (d < f1) { f2 = f1; f1 = d; id2 = id; id = jj * gx + ii; } else if (d < f2) { f2 = d; id2 = jj * gx + ii; }
    }
    return [f1, f2, id, id2];
  };
  const fiss = B.fissure ?? 0.5, con = B.contrast ?? 1, lich = B.lichen ?? 0;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (x === 0 && (y & 15) === 0) yield;
    const u = x / W, v = y / Hh, i = y * W + x;
    let h = 0.5, r = 1, g = 1, b = 1;
    const fine = fbm(u, v, 16, 32, 3), warp = fbm(u, v, 4, 6, 3);
    if (pattern === 'plates' || pattern === 'checkered') {
      const [f1, f2, id] = vor(u + (warp - 0.5) * 0.08, v + (fbm(v, u, 6, 4, 2) - 0.5) * 0.06);
      const edge = (f2 - f1) / Math.min(pw, ph);                       // 0 on a cell border
      const crack = Math.min(1, edge / (0.06 + 0.14 * fiss));           // 0 in the fissure, 1 on the plate
      const cr = pts[id][2];
      if (pattern === 'plates') {
        const flakes = Math.abs(Math.sin((fine * 7 + cr * 3) * Math.PI));   // scalloped jigsaw flakes on the plates
        h = crack * (0.65 + 0.25 * flakes + 0.1 * cr);
        const plate = 0.85 + 0.35 * cr + 0.12 * (flakes - 0.5);
        r = plate * 1.04; g = plate * 0.97; b = plate * 0.92;
        const dk = 0.16; r = dk + (r - dk) * crack ** 0.7; g = dk * 0.8 + (g - dk * 0.8) * crack ** 0.7; b = dk * 0.7 + (b - dk * 0.7) * crack ** 0.7;
      } else {
        h = crack * (0.7 + 0.3 * fine);
        const plate = 0.9 + 0.25 * cr + 0.2 * (fine - 0.5);
        r = g = b = 0.35 + (plate - 0.35) * crack ** 0.8;
      }
    } else if (pattern === 'furrowed') {
      const nR = Math.max(3, Math.round(tw / (B.ridge_m ?? 0.05)));   // ridges across one tile
      const xx = u * nR + (warp - 0.5) * 2.2 + (fbm(u, v, 3, 8, 2) - 0.5) * 1.2;
      const ridge = Math.abs(Math.sin(xx * Math.PI)), breaks = fbm(u, v, nR, Math.max(2, Math.round(th / (B.block_m ?? 0.15))), 2);
      const top = Math.pow(ridge, 0.5) * (breaks > 0.62 - 0.15 * fiss ? 0.55 : 1);
      h = top * (0.8 + 0.2 * fine);
      r = g = b = 0.42 + 0.75 * top * (0.85 + 0.3 * fine);
    } else if (pattern === 'platy') {
      // Thick, blocky plates (black oak, valley oak): elongated cells split by deep dark fissures, the plate
      // faces rough and cut by a few cross-checks, plates of slightly different tone.
      const [f1, f2, id] = vor(u + (warp - 0.5) * 0.06, v + (fbm(v, u, 6, 4, 2) - 0.5) * 0.08);
      const edge = (f2 - f1) / Math.min(pw, ph), crack = Math.min(1, edge / (0.08 + 0.2 * fiss)), cr = pts[id][2];
      const ny = Math.max(2, Math.round(th / ph * 1.5)), hv = v * ny + (fbm(u, v, 4, 2, 2) - 0.5) * 0.9, hx = Math.abs(hv - Math.floor(hv) - 0.5);
      const xc = hx < 0.035 && fbm(u, v, 8, ny, 2) > 0.45 ? 0.55 : 1;   // a few horizontal cross-checks on the plates
      h = crack * xc * (0.65 + 0.35 * fine);
      const plate = (0.88 + 0.28 * cr + 0.3 * (fine - 0.5)) * (0.85 + 0.15 * xc);
      r = g = b = 0.28 + (plate - 0.28) * Math.pow(crack * xc, 0.9);
    } else if (pattern === 'fibrous') {
      // Incense cedar: long, interlacing fibrous ridges of shreddy red-brown bark, dark furrows between,
      // fine lengthwise fibres, some strips standing pale where they peel.
      const nR = Math.max(3, Math.round(tw / (B.ridge_m ?? 0.04)));
      const xx = u * nR + (warp - 0.5) * 1.6 + (fbm(u, v, 3, 5, 2) - 0.5) * 2.4;
      const ridge = Math.pow(Math.abs(Math.sin(xx * Math.PI)), 0.45), fib = fbm(u, v, 96, 6, 2), strip = fbm(u, v * 0.3, 18, 3, 2);
      h = ridge * (0.75 + 0.25 * fib);
      const pale = strip > 0.68 ? Math.min(1, (strip - 0.68) / 0.08) : 0;
      r = g = b = 0.42 + 0.7 * ridge * (0.8 + 0.4 * fib);
      r += 0.25 * pale; g += 0.2 * pale; b += 0.15 * pale;
    } else if (pattern === 'peeling_red') {
      // Madrone: smooth, polished red-orange bark peeling in thin sheets; the freshly bared patches are
      // pale olive-cream, the old sheets curl at their edges (a bright lip over a dark shadow).
      // Cells are sheets: a third are freshly bared (pale), the rest old bark in two tones. Only a border
      // between bared and old bark shows, as the old sheet's curled lip; sheets of one kind merge smoothly.
      const [f1, f2, id, id2] = vor(u + (warp - 0.5) * 0.16, v + (fbm(v, u, 5, 3, 2) - 0.5) * 0.14);
      const edge = (f2 - f1) / Math.min(pw, ph), cr = pts[id][2], bared = cr < 0.32, other = pts[id2][2] < 0.32, streak = fbm(u, v, 24, 3, 3);
      h = 0.5 + 0.06 * streak; r = (cr > 0.66 ? 1.0 : 0.88) + 0.12 * streak; g = r; b = r;
      if (bared) { const k = Math.min(1, edge / 0.25); r = r * (1 - k) + 1.25 * k; g = g * (1 - k) + 2.3 * k; b = b * (1 - k) + 1.8 * k; h -= 0.08 * k; }
      if (bared !== other && edge < 0.12) {   // the curled lip of the old sheet, its shadow on the bared side
        const k = 1 - edge / 0.12;
        if (bared) { r *= 1 - 0.4 * k; g *= 1 - 0.45 * k; b *= 1 - 0.45 * k; } else { r += 0.3 * k; g += 0.22 * k; b += 0.18 * k; h += 0.35 * k; }
      }
    } else if (pattern === 'smooth_grey') {
      // Smooth grey bark (buckeye, California bay): faint mottling, short horizontal lenticels, no plates.
      const streak = fbm(u, v, 18, 3, 3), patch = fbm(u, v, 4, 5, 3), len = fbm(u, v, 10, 90, 2);
      h = 0.5 + 0.06 * streak; r = g = b = 0.93 + 0.1 * streak + 0.14 * (patch - 0.5);
      if (len > 0.72) { const k = Math.min(1, (len - 0.72) / 0.06); r *= 1 - 0.18 * k; g *= 1 - 0.18 * k; b *= 1 - 0.16 * k; h -= 0.05 * k; }
    } else if (pattern === 'shreddy') {
      const strip = fbm(u, v * 0.15, 24, 4, 3);
      h = strip; r = g = b = 0.6 + 0.6 * strip;
    } else {   // smooth: polished, faint lengthwise streaks; pale peeling curls and grey patches (manzanita)
      const streak = fbm(u, v, 24, 3, 3), curl = fbm(u, v, 20, 40, 2), patch = fbm(u, v, 3, 4, 3);
      h = 0.5 + 0.1 * streak; r = g = b = 0.92 + 0.16 * streak;
      if (curl > 0.72) { const k = Math.min(1, (curl - 0.72) / 0.08); h += 0.35 * k; r = r * (1 - k) + 1.7 * k; g = g * (1 - k) + 1.9 * k; b = b * (1 - k) + 1.8 * k; }
      if (patch > 0.68) { const k = Math.min(1, (patch - 0.68) / 0.06) * 0.8; r = r * (1 - k) + 1.2 * k; g = g * (1 - k) + 2.0 * k; b = b * (1 - k) + 2.0 * k; }
    }
    if (lich > 0) {   // lichen: pale grey-white and a few yellow-green spots on the high bark
      const l1 = fbm(u, v, 12, 24, 3), l2 = fbm(v, u, 9, 18, 2);
      if (l1 > 1 - 0.35 * lich && h > 0.4) { const k = Math.min(1, (l1 - (1 - 0.35 * lich)) / 0.06); r = r * (1 - k) + 1.55 * k; g = g * (1 - k) + 1.55 * k; b = b * (1 - k) + 1.5 * k; }
      if (l2 > 1 - 0.12 * lich && h > 0.4) { r = 1.25; g = 1.35; b = 0.7; }
    }
    height[i] = h;
    col[3 * i] = 1 + (r - 1) * con; col[3 * i + 1] = 1 + (g - 1) * con; col[3 * i + 2] = 1 + (b - 1) * con;
  }
  let mx = 0, mean = 0;
  for (let i = 0; i < W * Hh; i++) { mx = Math.max(mx, col[3 * i], col[3 * i + 1], col[3 * i + 2]); mean += 0.2126 * col[3 * i] + 0.7152 * col[3 * i + 1] + 0.0722 * col[3 * i + 2]; }
  mean /= W * Hh;
  const cImg = new ImageData(W, Hh), nImg = new ImageData(W, Hh), k = 6 * (B.relief ?? 1);
  yield;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (x === 0 && (y & 127) === 0) yield;
    const i = y * W + x, o = 4 * i;
    for (let c = 0; c < 3; c++) cImg.data[o + c] = Math.round(255 * Math.max(0, col[3 * i + c]) / mx);
    cImg.data[o + 3] = 255;
    const hx = height[y * W + (x + 1) % W] - height[y * W + (x + W - 1) % W], hy = height[((y + 1) % Hh) * W + x] - height[((y + Hh - 1) % Hh) * W + x];
    const nx = -hx * k, ny = hy * k, nl = Math.hypot(nx, ny, 1);
    nImg.data[o] = Math.round(127.5 + 127.5 * nx / nl); nImg.data[o + 1] = Math.round(127.5 + 127.5 * ny / nl); nImg.data[o + 2] = Math.round(127.5 + 127.5 / nl); nImg.data[o + 3] = 255;
  }
  const mk = img => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; return t; };
  const out = { map: mk(cImg), normal: mk(nImg) };
  out.map.userData.mean = mean / mx;
  barkCache.set(spec.id, out);
  return out;
}
