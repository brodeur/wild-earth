import * as THREE from 'three';

// Parametric trees in the spirit of Weber & Penn 1995, "Creation and Rendering of Realistic Trees".
// Each species is a parameter file in library/species/<id>.json (schema: docs/species-library.md).
// An agent or a local resident writes the file from the species' morphology; every region that has
// the species gets the tree for free. Nothing here is species-specific.
//
// A tree is grown once per (species, seed) as a skeleton: trunk(s) as level 0, then branch levels
// from the file, then foliage cards placed along the outer branches. The skeleton is shared by the
// meshings so the LOD switch changes detail, not shape:
//   close: a denser canopy only (lod.close_factor times the near cards, lod.close_scale their size,
//          with a texture drawn for the smaller card so single leaves keep their real size); the
//          near trunk is drawn with it. Used within about 90 m of the camera (vegetation.js).
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
  "quercus_douglasii": {"id":"quercus_douglasii","aliases":["blue_oak"],"scientific":"Quercus douglasii","common":"blue oak","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[6,12],"variants":[{"name":"sapling","weight":0.08,"height_m":[2,4],"trunk_radius":0.4,"branches":0.6,"leaf_density":0.8,"set":{"trunk":{"length_ratio":0.6,"split_prob":0.1,"lean_deg":4},"crown":{"envelope":{"profile":[[0.15,0.2],[0.35,0.32],[0.55,0.35],[0.75,0.3],[0.9,0.2],[1.0,0.06]]}},"levels":[{"down_angle_deg":48,"down_angle_tip_deg":30,"droop_deg":0}],"foliage":{"clumps":{"radius_m":0.55}},"epiphytes":{"mistletoe":{"prob":0}}},"note":"a slender stem keeping its leader, narrow upright crown"},{"name":"young","weight":0.22,"height_m":[5,8],"trunk_radius":0.6,"crown_scale":0.85,"branches":0.85,"set":{"trunk":{"length_ratio":0.45,"split_prob":0.3},"foliage":{"clumps":{"radius_m":0.8}},"epiphytes":{"mistletoe":{"prob":0.1}}},"note":"a rounded crown still taller than wide"},{"name":"mature","weight":0.55,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.15,"height_m":[10,14],"trunk_radius":1.3,"crown_scale":1.1,"gnarl":1.35,"deadwood":{"fraction":0.2,"levels":[1,2],"where":"inner"},"set":{"trunk":{"split_prob":0.7,"lean_deg":9},"epiphytes":{"mistletoe":{"prob":0.7,"count":[2,5]}}},"note":"gnarled and broad, a few dead limbs in a thinning crown, more mistletoe"}],"snag":{"fraction":0.03,"from":"veteran","height_m":[8,13],"limbs":0.6,"twigs":0.3,"levels":1,"shorten":[0.45,0.95],"rgb":[168,164,156]},"description":"A small, round-crowned oak with blue-green, shallowly lobed leaves and pale gray bark broken into small checks, usually 6-12 m tall here. It covers the dry, rocky slopes of the foothill woodland below about 1,200 m, often as open savanna with grass between the trees, and its acorns feed deer, western gray squirrels, scrub-jays and acorn woodpeckers.","season_notes":{"winter":"Bare: blue oak drops its leaves in late fall, and the checkered gray bark and clumps of oak mistletoe show until leaf-out in March.","spring":"Leafing out in pale green with hanging catkins (March-April); this year's acorns start on the new twigs.","summer":"In full blue-gray leaf, the colour that names it; in a dry year it drops leaves early to save water.","fall":"Acorns ripen and drop (September-October), then the leaves brown and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.34,"radius_ratio":0.075,"taper":0.6,"flare":1.3,"bole_ratio":0.5,"base_size":0.42,"curve_deg":12,"curve_var_deg":18,"segments":5,"lean_deg":6,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.45,"split_count":2,"split_angle_deg":32,"bark_rgb":[152,150,146],"bark_pattern":"checkered","twig_rgb":[150,142,132],"bark":{"tile_m":[0.35,0.7],"plate_m":[0.05,0.08],"fissure":0.5,"contrast":1.0,"lichen":0.8,"relief":1.2}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.06,0.48],[0.2,0.7],[0.35,0.76],[0.5,0.74],[0.65,0.67],[0.78,0.55],[0.9,0.37],[1.0,0.12]],"lobes":4,"lobe_depth":0.12,"asymmetry":0.1,"fill":0.6,"edge":1.08}},"levels":[{"count":7,"down_angle_deg":66,"down_angle_tip_deg":38,"down_angle_var_deg":14,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":2.6,"length_var":0.25,"curve_deg":6,"curve_var_deg":24,"zigzag_deg":10,"tropism":0.02,"droop_deg":14,"taper":0.9,"radius_ratio":0.6,"segments":5},{"count":6,"start":0.15,"down_angle_deg":46,"down_angle_var_deg":16,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.3,"curve_deg":0,"curve_var_deg":26,"zigzag_deg":16,"tropism":0.05,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.06,"leaf_shape":"oblong_wavy","cluster_m":0.95,"density":9,"cards_per_m2":1.6,"leaf_fill":3.2,"roll_deg":90,"start":0.3,"orientation":"outward","colors":{"winter":[149,119,105],"spring":[144,157,100],"summer":[127,137,122],"fall":[168,135,98]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":1.0,"fall":0.85},"parent_start":0.6,"clumps":{"radius_m":0.85,"cards_per_clump":7,"shell":0.2,"flatten":0.75,"tip_bias":1.4},"palette":[[0.8,[1,1,1]],[0.2,[1.05,1.08,0.95]]],"winter_twigs":0.45,"ao_min":0.7,"color_var":[0.1,0.06],"leaf_on_var":0.6},"deadwood":{"fraction":0.06,"where":"inner","levels":[2],"shorten":0.6,"rgb":[150,146,138]},"epiphytes":{"mistletoe":{"prob":0.4,"count":[1,3],"radius_m":0.35}},"lod":{"near_tris_budget":1900,"near_sides":[7,4,3],"mid_blobs":5,"mid_branches":4,"mid_segments":[3,2],"mid_blob_scale":0.85,"close_factor":2},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.15,"porosity":0.2,"foliage_rg":0.9,"foliage_bg":0.78,"from":"reference photographs, docs/tree-likeness-review.md: 01 Mount Diablo (W/H 1.59, porosity 0.21), 02 Shingle Springs, 04 savanna; woodland trees nearer 1.0"},"license":"CC BY-SA 4.0"},
  "quercus_wislizeni": {"id":"quercus_wislizeni","aliases":["live_oak"],"scientific":"Quercus wislizeni","common":"interior live oak","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[8,15],"variants":[{"name":"young","weight":0.25,"height_m":[4,8],"trunk_radius":0.7,"crown_scale":0.9,"branches":0.85,"set":{"trunk":{"stems":[1,2]}},"note":"dense, rounded and low, from one or two stems"},{"name":"mature","weight":0.55,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[11,16],"trunk_radius":1.25,"crown_scale":1.08,"gnarl":1.15,"deadwood":{"fraction":0.12,"levels":[1,2],"where":"inner","rgb":[118,112,104]},"set":{"trunk":{"stems":[2,4]},"lod":{"near_tris_budget":2800}},"note":"several heavy stems, a few dead limbs"}],"description":"An evergreen oak with a dense, dark green, rounded crown, often several trunks, and small shiny leaves that are smooth-edged or spiny like holly; 8-15 m tall here. It grows on steeper, moister slopes and along ravines through the blue oak woodland and up into the lower conifer forest, and California scrub-jays bury its acorns, planting new oaks with the ones they never come back for.","season_notes":{"winter":"Evergreen: still in full dark leaf, the green that picks it out among the bare blue oaks.","spring":"New pale leaves and catkins (March-May); the flowers become acorns that take two years to ripen.","summer":"A dense crown casting the deepest shade in the woodland; last year's flowers are now small green acorns.","fall":"Acorns that began in the spring of last year ripen and drop (September-November)."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.42,"radius_ratio":0.05,"taper":0.6,"flare":1.35,"bole_ratio":0.3,"base_size":0.2,"curve_deg":18,"curve_var_deg":15,"segments":5,"lean_deg":8,"stems":[1,3],"stem_spread_deg":22,"split_prob":0.5,"split_count":2,"split_angle_deg":30,"bark_rgb":[100,96,88],"bark_pattern":"furrowed","twig_rgb":[85,80,72],"bark":{"tile_m":[0.3,0.6],"ridge_m":0.03,"block_m":0.06,"fissure":0.3,"contrast":0.7,"lichen":0.4,"relief":0.8}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.04,0.493],[0.15,0.638],[0.35,0.683],[0.55,0.65],[0.72,0.538],[0.86,0.358],[1.0,0.09]],"lobes":5,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.5,"edge":1.06}},"levels":[{"count":11,"down_angle_deg":64,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":1.9,"length_var":0.2,"curve_deg":15,"curve_var_deg":15,"tropism":0.04,"taper":0.9,"radius_ratio":0.45,"segments":4,"down_angle_tip_deg":36,"droop_deg":10,"zigzag_deg":6},{"count":7,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":20,"curve_var_deg":15,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2,"zigzag_deg":10}],"foliage":{"type":"broadleaf","leaf_size_m":0.04,"leaf_shape":"elliptic_glossy","cluster_m":1.4,"density":20,"start":0.0,"parent_start":0.4,"orientation":"outward","colors":{"winter":[80,88,66],"spring":[118,125,80],"summer":[86,95,69],"fall":[89,95,69]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":1.1,"cards_per_clump":12,"shell":0.2,"flatten":0.8,"tip_bias":1.3},"palette":[[0.85,[1,1,1]],[0.1,[1.35,1.25,0.7]],[0.05,[1.3,1.0,0.6]]],"ao_min":0.72,"color_var":[0.08,0.03]},"lod":{"near_tris_budget":2000,"near_sides":[6,4,0],"mid_blobs":5,"mid_branches":2,"mid_sides":[3,3],"mid_segments":[2,1],"mid_blob_scale":0.95,"close_factor":2},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.08,"porosity":0.12,"foliage_rg":0.85,"foliage_bg":0.5,"from":"reference photographs, docs/tree-likeness-review.md: 01 Pilot Hill (W/H 1.13), 02 park tree (about 1.5), 04 crown on slope"},"license":"CC BY-SA 4.0"},
  "pinus_sabiniana": {"id":"pinus_sabiniana","aliases":["gray_pine"],"scientific":"Pinus sabiniana","common":"gray pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[12,22],"variants":[{"name":"young","weight":0.3,"height_m":[6,12],"trunk_radius":0.8,"crown_scale":0.8,"branches":0.8,"deadwood":0.12,"set":{"trunk":{"split_prob":0.15,"lean_deg":8}},"note":"a single leaning leader, crown open and narrow"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"veteran","weight":0.2,"height_m":[15,24],"trunk_radius":1.25,"crown_scale":1.15,"deadwood":0.32,"set":{"trunk":{"split_prob":1.0,"split_count":3,"split_height":0.42,"split_angle_deg":24,"lean_deg":18}},"note":"forked into three leaders, many dead lower limbs"}],"snag":{"fraction":0.05,"from":"veteran","limbs":0.45,"twigs":0,"levels":1,"broken_top":[0.7,0.95],"shorten":[0.4,0.9],"rgb":[150,146,138],"height_m":[12,20]},"description":"A thin, often forked or leaning pine whose sparse gray-green needles, 20-30 cm long in bundles of three, make a crown you can see the sky through; 12-22 m tall here. It grows only in California, scattered among blue oaks on the hottest, driest foothill slopes, and its heavy cones hold large, hard-shelled seeds eaten by squirrels and jays and long gathered as food by Native Californians.","season_notes":{"winter":"Evergreen: the gray-green needles look hazy against the hills, and heavy cones from past years still hang in the crown.","spring":"Pollen cones shed yellow pollen (March-April) and new needles grow at the branch tips.","summer":"Second-year cones swell to full size; the open crown gives little shade.","fall":"Ripe cones open and drop big, hard-shelled seeds that squirrels, jays and woodpeckers gather."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.95,"radius_ratio":0.03,"taper":0.9,"flare":1.2,"bole_ratio":0.25,"base_size":0.28,"curve_deg":25,"curve_var_deg":25,"segments":6,"lean_deg":14,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.6,"split_count":2,"split_angle_deg":18,"bark_rgb":[112,104,92],"bark_pattern":"furrowed","twig_rgb":[106,100,90],"split_height":0.55,"bark":{"tile_m":[0.5,1.0],"ridge_m":0.09,"block_m":0.12,"fissure":0.7,"contrast":1.2,"relief":1.5}},"crown":{"shape":"spherical","envelope":{"profile":[[0.22,0.16],[0.38,0.29],[0.55,0.33],[0.7,0.31],[0.84,0.23],[0.94,0.13],[1.0,0.04]],"lobes":3,"lobe_depth":0.16,"asymmetry":0.15,"fill":0.35,"edge":1.1}},"levels":[{"count":30,"whorl":2,"down_angle_deg":72,"down_angle_tip_deg":40,"down_angle_var_deg":18,"rotation_deg":70,"rotation_var_deg":40,"length_ratio":0.3,"length_var":0.35,"curve_deg":10,"curve_var_deg":28,"tropism":0.05,"taper":0.95,"radius_ratio":0.4,"segments":2},{"count":4,"start":0.35,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":40,"length_ratio":0.45,"length_var":0.3,"curve_deg":15,"curve_var_deg":20,"tropism":0.03,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.27,"leaf_shape":"needle_drooping","cluster_m":1.3,"density":12,"start":0.45,"parent_start":0.55,"orientation":"along","droop":0.8,"needle_planes":2,"tuft_spread_deg":28,"cards_per_m2":0.83,"needle_normal":0.65,"needle_wrap":0.6,"translucency":3.5,"needle_scatter":0.3,"translucency_rgb":[1.0,1.06,0.95],"colors":{"winter":[116,129,116],"spring":[121,135,116],"summer":[125,133,121],"fall":[123,131,119]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":70,"clumps":{"radius_m":0.5,"cards_per_clump":2,"shell":0,"flatten":0.85,"tip_bias":2.0},"palette":[[0.9,[1,1,1]],[0.1,[1.3,1.1,0.8]]],"ao_min":0.75,"color_var":[0.08,0.03]},"deadwood":{"fraction":0.22,"where":"lower","levels":[1],"shorten":0.7,"rgb":[138,132,122]},"lod":{"near_tris_budget":1800,"near_sides":[7,3,0],"mid_blobs":5,"mid_branches":3,"mid_blob_scale":0.7,"close_factor":2,"mid_planes":1,"mid_cards":32},"targets":{"crown_width_ratio":0.65,"crown_base_ratio":0.3,"porosity":0.4,"foliage_rg":0.88,"foliage_bg":0.82,"from":"reference photographs, docs/tree-likeness-review.md: 01 with blue oaks, 02 leaning (crown porosity 0.53), 03 single (0.32), 05 Mt Diablo"},"license":"CC BY-SA 4.0"},
  "pinus_ponderosa": {"id":"pinus_ponderosa","aliases":["ponderosa"],"scientific":"Pinus ponderosa","common":"ponderosa pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[22,38],"variants":[{"name":"pole","weight":0.25,"height_m":[8,15],"trunk_radius":0.8,"branches":0.7,"set":{"trunk":{"base_size":0.22,"bole_ratio":0.15,"bark_rgb":[98,80,68],"stubs":{"count":[0,3]}},"crown":{"envelope":{"profile":[[0.18,0.2],[0.4,0.19],[0.6,0.15],[0.8,0.09],[1.0,0.02]]}},"levels":[{"droop_deg":20,"upturn_deg":30}]},"note":"blackjack: dark bark, a conical crown reaching down to a quarter of the height"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"old-growth","weight":0.2,"height_m":[30,40],"trunk_radius":1.35,"branches":0.8,"deadwood":{"fraction":0.12,"levels":[1],"where":"lower","shorten":0.5,"rgb":[130,118,104]},"set":{"trunk":{"base_size":0.62,"bole_ratio":0.6,"bark_rgb":[188,132,92],"stubs":{"count":[10,20]},"length_ratio":0.92},"crown":{"envelope":{"profile":[[0.58,0.2],[0.72,0.25],[0.86,0.26],[0.95,0.21],[1.0,0.12]]},"shape":"cylindrical"},"levels":[{"droop_deg":40,"upturn_deg":30}]},"note":"flat-topped, a long clear bole of pale yellow plates, heavy limbs"}],"snag":{"fraction":0.04,"from":"mature","limbs":0.3,"twigs":0,"levels":1,"broken_top":[0.55,0.85],"shorten":[0.3,0.8],"rgb":[140,124,108]},"description":"A tall, straight pine with a clear trunk, thick bark broken into cinnamon-orange plates between black fissures, and long needles (12-25 cm, in threes) in tufts at the branch tips; 22-38 m tall here. It grows above the oak woodland in the lower conifer forest, from about 600 m up, and its thick bark lets old trees survive the frequent low fires that once kept these forests open.","season_notes":{"winter":"Evergreen: needles stay on for about three years, so the crown is full in every season.","spring":"Pollen cones release clouds of yellow pollen (May-June) and new shoots extend at the branch tips.","summer":"Second-year seed cones grow to full size and turn from green to red-brown.","fall":"Cones open and drop winged seeds (September-October) for squirrels, chipmunks and birds; the oldest needles yellow and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.03,"taper":1.0,"flare":1.25,"bole_ratio":0.45,"base_size":0.48,"curve_deg":4,"curve_var_deg":4,"segments":7,"lean_deg":3,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.03,"split_count":2,"split_angle_deg":12,"bark_rgb":[168,116,82],"bark_pattern":"plates","twig_rgb":[92,74,60],"stubs":{"count":[6,14],"length_m":0.5,"radius_ratio":0.12},"bark":{"tile_m":[0.7,1.4],"plate_m":[0.2,0.6],"fissure":0.95,"contrast":1.15,"relief":1.4}},"crown":{"shape":"tapered_cylindrical","envelope":{"profile":[[0.4,0.2],[0.6,0.22],[0.8,0.2],[0.92,0.13],[1.0,0.04]],"lobes":3,"lobe_depth":0.1,"asymmetry":0.1,"fill":0.15,"edge":1.1}},"levels":[{"count":30,"whorl":3,"down_angle_deg":92,"down_angle_tip_deg":58,"down_angle_var_deg":10,"rotation_deg":37,"rotation_var_deg":25,"length_ratio":0.26,"length_var":0.2,"curve_deg":0,"curve_var_deg":16,"tropism":0.02,"droop_deg":34,"upturn_deg":40,"taper":0.95,"radius_ratio":0.32,"segments":3},{"count":6,"start":0.5,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":-90,"rotation_var_deg":30,"length_ratio":0.3,"length_var":0.3,"curve_deg":10,"curve_var_deg":10,"tropism":0.12,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.2,"leaf_shape":"needle_brush","cluster_m":1.8,"density":7,"start":0.4,"parent_start":0.6,"orientation":"along","needle_planes":2,"tuft_spread_deg":22,"tuft_up":0.45,"needle_normal":0.55,"needle_wrap":0.35,"translucency":2.5,"needle_scatter":0.15,"colors":{"winter":[76,77,59],"spring":[95,95,65],"summer":[82,86,62],"fall":[91,86,59]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"twist_deg":50,"clumps":{"radius_m":0.6,"cards_per_clump":2,"shell":0,"flatten":0.75,"tip_bias":1.6},"ao_min":0.7,"color_var":[0.07,0.03]},"lod":{"near_tris_budget":2200,"near_sides":[8,3,0],"mid_blobs":5,"mid_branches":2,"mid_blob_scale":0.7,"close_factor":2,"mid_planes":1,"mid_cards":28},"targets":{"crown_width_ratio":0.4,"crown_base_ratio":0.45,"porosity":0.35,"foliage_rg":0.95,"foliage_bg":0.47,"from":"reference photographs, docs/tree-likeness-review.md: 02, 03 mature (clear bole 40-60%), 04 old flat top (crown porosity 0.14); young trees are conical to the ground"},"license":"CC BY-SA 4.0"},
  "arctostaphylos_viscida": {"id":"arctostaphylos_viscida","aliases":["manzanita"],"scientific":"Arctostaphylos viscida","common":"whiteleaf manzanita","form":"shrub","architectural_model":"Leeuwenberg","deciduous":false,"height_m":[1.5,3.5],"variants":[{"name":"young","weight":0.25,"height_m":[0.7,1.5],"deadwood":0.05,"set":{"trunk":{"stems":[3,5]}},"note":"a low rounded young shrub"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"decadent","weight":0.25,"height_m":[2,3.5],"gnarl":1.15,"leaf_density":0.75,"deadwood":{"fraction":0.35,"levels":[0,1,2]},"note":"an old shrub: grey dead stems among the red"}],"description":"A crooked, many-stemmed shrub with smooth, polished red-brown bark and stiff, round, pale gray-green (almost white) leaves held edge-on to the sun; 1.5-3.5 m tall here. It grows in chaparral and in openings of the woodland and pine forest on dry, rocky ridges, and its late-winter flowers are among the first nectar of the year for hummingbirds and native bees, while its berries feed birds, foxes, coyotes and bears.","season_notes":{"winter":"Flowering in late winter (February-March): small white-to-pink urn-shaped flowers, early nectar for hummingbirds and native bees.","spring":"Flowers give way to sticky green berries.","summer":"The berries ('little apples', which is what manzanita means) ripen red-brown, and the red bark peels in thin curls.","fall":"Evergreen and dormant through the dry season; next winter's flower buds are already set at the branch tips."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.75,"radius_ratio":0.035,"taper":0.7,"flare":1.6,"bole_ratio":0.1,"base_size":0.2,"curve_deg":20,"curve_var_deg":18,"segments":4,"lean_deg":0,"stems":[4,7],"stem_spread_deg":45,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[128,58,50],"bark_pattern":"smooth","twig_rgb":[132,66,54],"sinuous_deg":16,"bark":{"tile_m":[0.2,0.4],"contrast":1.0,"relief":0.6}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.54],[0.15,0.744],[0.35,0.84],[0.55,0.792],[0.75,0.624],[0.9,0.384],[1.0,0.12]],"lobes":3,"lobe_depth":0.1,"asymmetry":0.12,"fill":0.6,"edge":1.06}},"levels":[{"count":4,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.75,"length_var":0.25,"curve_deg":30,"curve_var_deg":14,"tropism":0.08,"taper":0.9,"radius_ratio":0.6,"segments":2,"sinuous_deg":18},{"count":4,"start":0.3,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.25,"curve_deg":20,"curve_var_deg":20,"tropism":0.08,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.035,"leaf_shape":"round_vertical","cluster_m":0.5,"density":24,"start":0.25,"orientation":"vertical","colors":{"winter":[131,139,118],"spring":[160,149,134],"summer":[144,149,126],"fall":[136,142,121]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"clumps":{"radius_m":0.4,"cards_per_clump":6,"shell":0.5,"flatten":0.8,"tip_bias":1.3},"ao_min":0.8,"color_var":[0.07,0.03]},"deadwood":{"fraction":0.15,"where":"inner","levels":[1,2],"shorten":0.6,"rgb":[140,136,128]},"lod":{"near_tris_budget":1100,"near_sides":[4,3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":24},"targets":{"crown_width_ratio":1.4,"crown_base_ratio":0.15,"porosity":0.1,"foliage_rg":0.95,"foliage_bg":0.68,"from":"reference photographs, docs/tree-likeness-review.md: 01, 02 habit (crown r/g 0.91-0.96, b/g 0.59-0.74), 06 crown texture"},"license":"CC BY-SA 4.0"},
  "adenostoma_fasciculatum": {"id":"adenostoma_fasciculatum","aliases":["chamise"],"scientific":"Adenostoma fasciculatum","common":"chamise","form":"shrub","architectural_model":"Leeuwenberg (provisional)","deciduous":false,"height_m":[1.2,2.4],"variants":[{"name":"young","weight":0.25,"height_m":[0.6,1.3],"deadwood":0.08,"set":{"trunk":{"stems":[8,14]}},"note":"a few years after fire: a low, dense green clump"},{"name":"mature","weight":0.5,"seeds":2,"note":"the file as written"},{"name":"decadent","weight":0.25,"height_m":[1.5,2.6],"deadwood":0.55,"leaf_density":0.75,"set":{"trunk":{"stems":[22,34]}},"note":"decades without fire: half the stems grey and dead"}],"description":"A dense, many-stemmed shrub with tiny needle-like leaves in bundles along stiff, upright branches, and clusters of small white flowers at the tips in early summer; 1.2-2.4 m tall here. It is the most common chaparral shrub in California, forming thick stands on hot, dry slopes with thin soil, where it resprouts from a woody burl after fire and gives cover to quail, brush rabbits and wrentits.","season_notes":{"winter":"Evergreen: winter rain brings new shoots, and stands burned in recent years sprout from their burls.","spring":"Fresh green growth, then clusters of small white flowers at the branch tips (May-June).","summer":"The flowers fade to rust-brown; the resinous leaves dry out, and chamise is one of the most flammable plants in the chaparral.","fall":"Rust-brown seed heads still cap the stems while the shrubs wait out the dry season for the first rain."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.012,"taper":0.9,"flare":1.5,"bole_ratio":0.05,"base_size":0.3,"curve_deg":8,"curve_var_deg":16,"segments":3,"lean_deg":0,"stems":[16,28],"stem_spread_deg":33,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[96,76,62],"bark_pattern":"shreddy","twig_rgb":[106,90,74],"bark":{"tile_m":[0.1,0.4]}},"crown":{"shape":"cylindrical","envelope":{"profile":[[0.0,0.12],[0.25,0.3],[0.5,0.47],[0.75,0.6],[0.92,0.6],[1.0,0.42]],"lobes":5,"lobe_depth":0.15,"asymmetry":0.12,"fill":0.4,"edge":1.1}},"levels":[{"count":3,"start":0.4,"down_angle_deg":22,"down_angle_var_deg":10,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.22,"length_var":0.4,"curve_deg":5,"curve_var_deg":15,"tropism":0.08,"taper":1.0,"radius_ratio":0.6,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.008,"leaf_shape":"fascicle_wand","cluster_m":0.42,"density":22,"start":0.1,"orientation":"along","colors":{"winter":[82,94,67],"spring":[150,149,125],"summer":[116,118,98],"fall":[124,102,83]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0},"parent_start":0.2,"twist_deg":60,"tips":{"spring":[236,232,214],"summer":[170,120,80],"fall":[150,90,60],"winter":[120,84,62]},"ao_min":0.72,"color_var":[0.1,0.06]},"deadwood":{"fraction":0.3,"levels":[0],"shorten":0.85,"rgb":[132,128,122]},"lod":{"near_tris_budget":1000,"near_sides":[3,0],"mid_blobs":3,"mid_branches":0,"mid_sides":[0,0],"mid_cards":32},"targets":{"crown_width_ratio":1.2,"crown_base_ratio":0.1,"porosity":0.15,"foliage_rg":1.0,"foliage_bg":0.7,"from":"reference photographs, docs/tree-likeness-review.md: 01 El Dorado Hills, 02 Darrington Trail, 03 (porosity 0.17), 04"},"license":"CC BY-SA 4.0"},
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
  s.shrub = s.form === 'shrub';
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
function makeSnag(S, seed, H, stems, cards, closeCards, mist, main) {
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
    if (k > 0 || (spec.shrub && nStems > 1)) {
      const az = az0 + (k / nStems) * Math.PI * 2 + sym() * 0.5, tilt = T.stem_spread_deg * (0.5 + 0.7 * rnd()) * DEG;
      dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
      origin.set(Math.cos(az), 0, Math.sin(az)).multiplyScalar(r0 * (spec.shrub ? 1.2 : 0.8));
      if (k > 0) { len *= 0.7 + 0.3 * rnd(); rr *= spec.shrub ? 0.8 + 0.3 * rnd() : 0.6 + 0.2 * rnd(); }
    }
    const boleLen = len * T.bole_ratio, split = rnd() < T.split_prob;
    // split_height: where the trunk forks (fraction of its length); default the bole top, as before.
    const sh = Math.max(T.bole_ratio, T.split_height ?? T.bole_ratio), high = sh > T.bole_ratio + 0.02;
    const common = { level: 0, origin, dir, r0: rr, taper: T.taper, taperLen: len, flare: k === 0 || spec.shrub ? T.flare : 1, rnd };
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
      if (spec.shrub && DW && (DW.levels || [1]).includes(0) && drnd() < DW.fraction) { st.dead = true; scaleStem(st, DW.shorten ?? 0.8); }   // grey dead stems inside a shrub
      if (env && spec.shrub) fitStem(st, env, st.dead ? 1 : 1 + env.fill, 0.85 + 0.15 * erng());   // shrub stems reach the envelope (the chamise vase)
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
      const share = spec.shrub ? 1 : span / (1 - base) / Math.max(1, trunks.filter(t => t.h1 === tr.h1 && t.h0 === tr.h0).length);
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
      cs.push({ p, d, w: 0.6 + 0.8 * kr() });
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
  // the crown fills the same volume and the near/close cross-fade keeps the silhouette.
  const crnd = mulberry32(seed ^ 0x2c1b3c6d), closeCards = [];
  const nClose = acc > 0 ? Math.round(cards.length * spec.lod.close_factor) : 0;
  for (let i = 0; i < nClose; i++) placeCard(crnd, closeCards);
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
  let Hs = H;
  if (spec.snagOf) Hs = makeSnag(spec.snagOf, seed, H, stems, cards, closeCards, mist, main);
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
  const sk = { spec, H: Hs, snag: !!spec.snagOf, lean, leanDir, stems, cards, closeCards, mist, centre, radii, cluster: F.cluster_m * k * cardF, wood, clumpR: CL ? (CL.radius_m ?? 0.8) * k * cardF : 0,
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
function cardGeometry(sk, keep = 1, cards = sk.cards, scale = 1) {
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
  const quad = (c, n, u, w, h, col, rank, outN) => {
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
      for (let k = 0; k < planes; k++) quad(cc, k ? vn.copy(nrm).applyAxisAngle(up, k * Math.PI / planes).clone() : nrm, up, s, s, col, r4, out);
    } else {
      quad(card.c, nrm, up, s, s, col, r4, out);
      if (F.crossed) quad(card.c, nrm.clone().cross(up).normalize(), up, s, s, col, r4, out);
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

// buildTree(speciesId, seed, lod) -> { trunk, canopy, height, stem, tris }. Old ids (blue_oak, ...)
// are accepted. Geometry is in the tree's frame: base at the origin, then rotateZ(lean), rotateY(leanDir).
// lod 'close' returns the dense canopy only (trunk null): it is drawn with the near trunk.
export function buildTree(name, seed = 1, lod = 'near') {
  const id = resolveSpecies(name); if (!id) throw new Error(`unknown species ${name}`);
  const sk = skeleton(specForSeed(LIBRARY[id], seed), seed);
  const xf = new THREE.Matrix4().makeRotationY(sk.leanDir).multiply(new THREE.Matrix4().makeRotationZ(sk.lean));
  if (lod === 'close') {
    const canopy = cardGeometry(sk, 1, sk.closeCards, sk.spec.lod.close_scale).build(xf, { uv: true, rank: true });
    return { trunk: null, canopy, height: sk.H, stem: { ...sk.stem }, tris: { trunk: 0, canopy: triCount(canopy), cards: sk.closeCards.length }, species: id };
  }
  const rnd = mulberry32(seed ^ (lod === 'near' ? 0x1234567 : 0x7654321));
  const trunk = woodGeometry(sk, lod, rnd).build(xf, lod === 'near' ? { uv: true, rank: true, rankName: 'barkMix' } : {});   // bark UVs only where bark is textured
  const midCards = lod !== 'near' && sk.spec.lod.mid_canopy === 'cards';
  const canopy = (lod === 'near' ? cardGeometry(sk) : midCards ? cardGeometry(sk, Math.min(1, (sk.midCap ?? 60) / sk.cards.length)) : blobGeometry(sk, rnd))
    .build(xf, { uv: lod === 'near' || midCards, rank: true });
  return { trunk, canopy, height: sk.H, stem: { ...sk.stem }, tris: { trunk: triCount(trunk), canopy: triCount(canopy), cards: sk.cards.length }, species: id,
    crown: sk.foliage && { area_m2: sk.foliage.area, cards_per_m2: sk.foliage.cpm2, card_scale: sk.foliage.cardF, mid_cap: sk.midCap } };
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
export function leafTexture(spec, scale = 1, variant = 'summer') {
  const F = spec.foliage;
  const kind = variant === 'twig' ? 'twig' : F.tips && F.tips[variant] ? variant : F.tips ? 'summer' : 'leaf';
  const key = `${spec.id}:${scale}:${kind}`;
  if (textures.has(key)) return textures.get(key);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const seed = hashStr(spec.id) ^ (scale === 1 ? 0 : 0x9e3779b9 ^ Math.round(scale * 977)) ^ (kind === 'twig' ? 0x7a11 : 0);
  const g = c.getContext('2d'), rnd = mulberry32(seed);
  const px = Math.max(5, Math.min(110, F.leaf_size_m / (F.cluster_m * scale) * S * (F.type === 'needle' ? 1 : 1.3)));
  // Tints: palette entries and the tip colour relative to the season's leaf colour; greys are scaled
  // down so the largest tint still fits under 255 (the material gain divides the mean back out).
  const pal = F.palette || [[1, [1, 1, 1]]], wsum = pal.reduce((s, p) => s + p[0], 0);
  const lin = v => Math.pow(v / 255, 2.2), base = F.colors[kind] || F.colors.summer;
  const tip = F.tips && kind !== 'twig' && F.tips[kind] ? F.tips[kind].map((v, i) => Math.pow(lin(v) / Math.max(1e-4, lin(base[i])), 1 / 2.2)) : null;
  const head = Math.min(3, Math.max(1, ...pal.flatMap(p => p[1]), ...(tip || [1])));
  const rgb = (v, t = [1, 1, 1]) => `rgb(${t.map(k => Math.round(Math.min(255, v * k / head))).join(',')})`;
  const tintOf = () => { let x = rnd() * wsum; for (const p of pal) { if ((x -= p[0]) <= 0) return p[1]; } return pal[0][1]; };
  const grey = (lo = 170) => rgb(lo + (255 - lo) * rnd(), tintOf());
  // The spray: a few overlapping sub-clumps rather than one clean ellipse, so card edges read as foliage.
  const subs = Array.from({ length: 5 }, () => { const a = rnd() * Math.PI * 2, r = 0.22 * rnd(); return [S / 2 + Math.cos(a) * r * S, S / 2 + Math.sin(a) * r * S * 1.05, S * (0.17 + 0.09 * rnd())]; });
  const inside = () => { for (;;) { const [cx, cy, R] = subs[Math.floor(rnd() * subs.length)], a = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd()), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const ex = (x - S / 2) / (S * 0.42), ey = (y - S / 2) / (S * 0.45); if (ex * ex + ey * ey < 1) return [x, y]; } };
  g.lineCap = 'round';
  const area = Math.PI * (S * 0.4) * (S * 0.43);
  if (kind !== 'twig' && (F.leaf_shape === 'needle_brush' || F.leaf_shape === 'needle_drooping')) {   // pine needle cards: own mips
    const t = needleTexture(F, S, px, seed, rgb, pal, wsum, scale > 1.2);
    textures.set(key, t);
    return t;
  }
  if (kind === 'twig') {
    drawTwigs(g, S, rnd, rgb);
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
      const shape = F.leaf_shape, w = leafWidth(shape);
      for (const [x0, y0, x1, y1] of twigs) {
        const L = Math.hypot(x1 - x0, y1 - y0), ta = Math.atan2(x1 - x0, -(y1 - y0)), step = px * 0.45;
        for (let s = step * 0.6; s <= L; s += step) for (const side of [-1, 1]) {
          const x = x0 + (x1 - x0) * s / L, y = y0 + (y1 - y0) * s / L, a = ta + side * (0.5 + 0.5 * rnd()), l = px * (0.8 + 0.4 * rnd());
          drawLeaf(g, x + Math.sin(a) * l * 0.5, y - Math.cos(a) * l * 0.5, a, l, shape, grey(), rnd);
        }
        if (shape === 'oblong_wavy' || shape === 'elliptic_glossy') for (let r = 0; r < 5; r++) { const a = ta + (r - 2) * 0.55 + (rnd() - 0.5) * 0.3, l = px * (0.85 + 0.35 * rnd()); drawLeaf(g, x1 + Math.sin(a) * l * 0.45, y1 - Math.cos(a) * l * 0.45, a, l, shape, grey(), rnd); }
        else drawLeaf(g, x1, y1, ta, px, shape, grey(), rnd);
      }
      const n = Math.round(area * (far ? 1.1 : 0.35) * (F.leaf_fill ?? 1) / (Math.PI * px * w * px * 0.5));   // foliage.leaf_fill: denser sprays
      for (let i = 0; i < n; i++) { const [x, y] = inside(); drawLeaf(g, x, y, rnd() * Math.PI * 2, px * (0.8 + 0.4 * rnd()), shape, grey(), rnd); }
    }
  }
  const t = new THREE.Texture();
  t.mipmaps = coverageMips(c, 0.5);
  t.image = t.mipmaps[0];
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;   // multipliers on the linear vertex colour
  t.anisotropy = 4; t.needsUpdate = true;
  t.userData.mean = meanGrey(t.mipmaps[0]);   // the material divides by this so cards match the baked colour
  textures.set(key, t);
  return t;
}

// Bare winter crown: a few stems from the card base splitting into zig-zag twigs (blue oak in winter).
function drawTwigs(g, S, rnd, rgb) {
  const branch = (x, y, a, len, w, depth) => {
    for (let k = 0; k < 3; k++) {
      a += (k % 2 ? 1 : -1) * (0.12 + 0.22 * rnd());
      const x2 = x + Math.sin(a) * len / 3, y2 = y - Math.cos(a) * len / 3;
      g.strokeStyle = rgb(170 + 70 * rnd()); g.lineWidth = Math.max(0.7, w); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      x = x2; y = y2;
      if (depth > 0 && k < 2 && rnd() < 0.55) branch(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.45 + 0.4 * rnd()), len * (0.5 + 0.15 * rnd()), w * 0.7, depth - 1);
    }
    if (depth > 0) { const n = 2 + (rnd() < 0.4 ? 1 : 0); for (let i = 0; i < n; i++) branch(x, y, a + (i - (n - 1) / 2) * (0.5 + 0.3 * rnd()), len * (0.6 + 0.15 * rnd()), w * 0.7, depth - 1); }
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
function needleTexture(F, S, px, seed, rgb, pal, wsum, far) {
  const drawLevel = (size, keep, minW) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ca = document.createElement('canvas'); ca.width = ca.height = size;
    const g = c.getContext('2d'), ga = ca.getContext('2d'), r = mulberry32(seed);
    g.lineCap = 'round'; ga.lineCap = 'round';
    const subs = Array.from({ length: 5 }, () => { const a = r() * Math.PI * 2, rr = 0.22 * r(); return [size / 2 + Math.cos(a) * rr * size, size / 2 + Math.sin(a) * rr * size * 1.05, size * (0.17 + 0.09 * r())]; });
    const inside = () => { for (;;) { const [cx, cy, R] = subs[Math.floor(r() * subs.length)], a = r() * Math.PI * 2, rr = R * Math.sqrt(r()), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const ex = (x - size / 2) / (size * 0.42), ey = (y - size / 2) / (size * 0.45); if (ex * ex + ey * ey < 1) return [x, y]; } };
    const tintOf = () => { let x = r() * wsum; for (const q of pal) { if ((x -= q[0]) <= 0) return q[1]; } return pal[0][1]; };
    drawNeedleCard(g, size, F, px * size / S, r, rgb, tintOf, far, inside, keep, mulberry32(seed ^ 0x5eed1e), minW, ga);
    return [g.getImageData(0, 0, size, size), ga.getImageData(0, 0, size, size)];
  };
  const cover = img => { const d = img.data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n / (d.length / 4); };
  const [img0, aux0] = drawLevel(S, 1, 0);
  const levels = [img0], auxes = [aux0], c0 = cover(img0), m0 = meanGrey(img0), keeps = [1];
  for (let size = S >> 1; size >= 16; size >>= 1) {
    let keep = 1, [img, aux] = drawLevel(size, keep, 1), c = cover(img);
    for (let it = 0; it < 4 && c0 > 0 && Math.abs(c - c0) > 0.06 * c0; it++) {
      keep = Math.min(1, keep * Math.pow(c0 / Math.max(1e-4, c), 1.6));   // coverage falls slower than keep (overlap): overshoot
      [img, aux] = drawLevel(size, keep, 1); c = cover(img);
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
  levels.forEach((img, i) => { thinness(img, auxes[i], Math.max(1, Math.round(img.width / 48))); bleed(auxes[i], img); bleed(img); });
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
      for (let i = 0; i < nf; i++) {
        const u = Math.pow(rnd(), 0.9), d = span * (1 - u), x = xb - Math.sin(ta) * d, y = yb + Math.cos(ta) * d;
        const th = 0.15 + 1.2 * Math.min(1, d / (px * 0.9)) + 0.3 * rnd();
        fascicle(x, y, ta, th, rnd() * Math.PI * 2, px * (0.7 + 0.5 * rnd()), lw * 1.4, 0.35, 0);
      }
    } else {
      // gray pine: a loose tuft at the very tip, needles fanning wide and arcing down
      const nf = 16 + Math.floor(rnd() * 7);
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

// Half-width / length of a leaf outline.
function leafWidth(shape) {
  return { lanceolate: 0.15, lobed: 0.26, oblong_wavy: 0.2, elliptic_glossy: 0.22, round_vertical: 0.34 }[shape] ?? 0.32;
}

function drawLeaf(g, x, y, a, len, shape, fill, rnd) {
  g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = fill; g.beginPath();
  let w = leafWidth(shape);
  if (shape === 'round_vertical' && rnd() < 0.4) w = 0.07;   // held edge-on: a sliver
  if (shape === 'oblong_wavy') {   // oblong with a few shallow waves along the margin (blue oak)
    const ph = rnd() * 6.28;
    for (let k = 0; k <= 28; k++) { const t = k / 28 * Math.PI * 2, m = 1 + 0.09 * Math.sin(t * 6 + ph); const X = Math.cos(t) * len * w * m, Y = Math.sin(t) * len * 0.5; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.fill();
  } else g.ellipse(0, 0, len * w, len * 0.5, 0, 0, Math.PI * 2), g.fill();
  if (shape === 'lobed') for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    g.beginPath(); g.arc(s * len * 0.22, -len * 0.28 + i * len * 0.24, len * (0.12 + 0.03 * rnd()), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.ellipse(-len * w * 0.4, 0, len * w * 0.55, len * 0.45, 0, 0, Math.PI * 2); g.fill();   // half-leaf shading
  if (shape === 'elliptic_glossy' && rnd() < 0.5) { g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(len * w * 0.25, -len * 0.12, len * w * 0.3, len * 0.16, 0, 0, Math.PI * 2); g.fill(); }   // glossy glint
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
    if (aux) { shader.uniforms.needleAux = m.userData.needleAux; shader.uniforms.needleLight = m.userData.needleLight; shader.uniforms.needleScatterK = m.userData.needleScatterK; shader.uniforms.needleTint = m.userData.needleTint; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float leafRank;\nvarying float vLeafRank;' + (vary ? '\nvarying vec3 vPlantTint;\nuniform float leafVar;' : ''))
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
        vLeafRank = mix(leafRank, plantH.z, leafVar);` : 'vLeafRank = leafRank;'}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float leafOn;\nvarying float vLeafRank;' + (vary ? '\nvarying vec3 vPlantTint;' : ''))
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
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkMix = barkMix;');
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
export function applySeason(material, spec, season) {
  const F = spec.foliage, c = F.colors, ud = material.userData;
  let col = c[season] || c.summer, on = F.leaf_on[season] ?? 1;
  if (ud.texScale != null) {
    let tex = leafTexture(spec, ud.texScale, season);
    const twigs = on <= 0.02 && !!F.winter_twigs;
    if (twigs) { tex = leafTexture(spec, ud.texScale, 'twig'); on = F.winter_twigs; col = spec.trunk.twig_rgb || spec.trunk.bark_rgb; }
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
export function barkTexture(spec) {
  if (barkCache.has(spec.id)) return barkCache.get(spec.id);
  const T = spec.trunk, B = T.bark || {}, pattern = T.bark_pattern || 'furrowed', W = 256, Hh = 512;
  const [tw, th] = B.tile_m || [0.5, 1.0], seed = hashStr(spec.id + ':bark'), rnd = mulberry32(seed), noise = tileNoise(seed);
  const fbm = (u, v, fu, fv, oct = 4) => { let s = 0, a = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += a * noise(u * fu, v * fv, fu, fv); n += a; a *= 0.5; fu *= 2; fv *= 2; } return s / n; };
  const height = new Float32Array(W * Hh), col = new Float32Array(W * Hh * 3);
  // Voronoi cells on a jittered grid that wraps: plates (ponderosa) and checks (blue oak).
  const [pw, ph] = B.plate_m || (pattern === 'plates' ? [0.22, 0.45] : [0.05, 0.08]);
  const gx = Math.max(2, Math.round(tw / pw)), gy = Math.max(2, Math.round(th / ph));
  const pts = []; for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) pts.push([(i + 0.15 + 0.7 * rnd()) / gx, (j + 0.15 + 0.7 * rnd()) / gy, rnd()]);
  const vor = (u, v) => {   // [F1, F2, id] in metres
    const ci = Math.floor(u * gx), cj = Math.floor(v * gy); let f1 = 1e9, f2 = 1e9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ((ci + di) % gx + gx) % gx, jj = ((cj + dj) % gy + gy) % gy, p = pts[jj * gx + ii];
      const px = p[0] + (ci + di - ii) / gx, py = p[1] + (cj + dj - jj) / gy;
      const d = Math.hypot((u - px) * tw, (v - py) * th);
      if (d < f1) { f2 = f1; f1 = d; id = jj * gx + ii; } else if (d < f2) f2 = d;
    }
    return [f1, f2, id];
  };
  const fiss = B.fissure ?? 0.5, con = B.contrast ?? 1, lich = B.lichen ?? 0;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
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
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
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
