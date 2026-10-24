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
//   mid:  trunk and the main limbs as tubes, foliage as a few ellipsoid blobs fitted to the cards

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
  "quercus_douglasii": {"id":"quercus_douglasii","aliases":["blue_oak"],"scientific":"Quercus douglasii","common":"blue oak","form":"tree","architectural_model":"Rauh","deciduous":true,"height_m":[6,12],"variants":3,"description":"A small, round-crowned oak with blue-green, shallowly lobed leaves and pale gray bark broken into small checks, usually 6-12 m tall here. It covers the dry, rocky slopes of the foothill woodland below about 1,200 m, often as open savanna with grass between the trees, and its acorns feed deer, western gray squirrels, scrub-jays and acorn woodpeckers.","season_notes":{"winter":"Bare: blue oak drops its leaves in late fall, and the checkered gray bark and clumps of oak mistletoe show until leaf-out in March.","spring":"Leafing out in pale green with hanging catkins (March-April); this year's acorns start on the new twigs.","summer":"In full blue-gray leaf, the colour that names it; in a dry year it drops leaves early to save water.","fall":"Acorns ripen and drop (September-October), then the leaves brown and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.55,"radius_ratio":0.05,"taper":0.6,"flare":1.3,"bole_ratio":0.3,"base_size":0.3,"curve_deg":15,"curve_var_deg":14,"segments":5,"lean_deg":6,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.35,"split_count":2,"split_angle_deg":28,"bark_rgb":[140,136,126],"bark_pattern":"checkered","twig_rgb":[112,104,94]},"crown":{"shape":"hemispherical"},"levels":[{"count":8,"down_angle_deg":52,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.85,"length_var":0.2,"curve_deg":22,"curve_var_deg":18,"tropism":0.04,"taper":0.9,"radius_ratio":0.55,"segments":4},{"count":7,"start":0.2,"down_angle_deg":45,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":20,"curve_var_deg":20,"tropism":0.06,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.06,"leaf_shape":"lobed","cluster_m":1.0,"density":8,"start":0.25,"orientation":"outward","colors":{"winter":[138,122,96],"spring":[134,160,92],"summer":[118,140,112],"fall":[156,138,90]},"leaf_on":{"winter":0.0,"spring":1.0,"summer":0.95,"fall":0.6}},"lod":{"near_tris_budget":1800,"near_sides":[7,5,3],"mid_blobs":5,"mid_branches":6,"mid_blob_scale":0.85},"license":"CC BY-SA 4.0"},
  "quercus_wislizeni": {"id":"quercus_wislizeni","aliases":["live_oak"],"scientific":"Quercus wislizeni","common":"interior live oak","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[8,15],"variants":3,"description":"An evergreen oak with a dense, dark green, rounded crown, often several trunks, and small shiny leaves that are smooth-edged or spiny like holly; 8-15 m tall here. It grows on steeper, moister slopes and along ravines through the blue oak woodland and up into the lower conifer forest, and California scrub-jays bury its acorns, planting new oaks with the ones they never come back for.","season_notes":{"winter":"Evergreen: still in full dark leaf, the green that picks it out among the bare blue oaks.","spring":"New pale leaves and catkins (March-May); the flowers become acorns that take two years to ripen.","summer":"A dense crown casting the deepest shade in the woodland; last year's flowers are now small green acorns.","fall":"Acorns that began in the spring of last year ripen and drop (September-November)."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.5,"radius_ratio":0.05,"taper":0.6,"flare":1.35,"bole_ratio":0.22,"base_size":0.22,"curve_deg":18,"curve_var_deg":15,"segments":5,"lean_deg":8,"stems":[1,2],"stem_spread_deg":25,"split_prob":0.5,"split_count":2,"split_angle_deg":30,"bark_rgb":[92,88,82],"bark_pattern":"furrowed","twig_rgb":[85,80,72]},"crown":{"shape":"hemispherical"},"levels":[{"count":11,"down_angle_deg":42,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.85,"length_var":0.2,"curve_deg":15,"curve_var_deg":15,"tropism":0.04,"taper":0.9,"radius_ratio":0.45,"segments":4},{"count":9,"start":0.15,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.5,"length_var":0.25,"curve_deg":20,"curve_var_deg":15,"tropism":0.04,"taper":1.0,"radius_ratio":0.45,"segments":2}],"foliage":{"type":"broadleaf","leaf_size_m":0.04,"leaf_shape":"oval","cluster_m":1.5,"density":16,"start":0.0,"parent_start":0.4,"orientation":"outward","colors":{"winter":[56,76,48],"spring":[82,108,58],"summer":[60,82,50],"fall":[62,82,50]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0}},"lod":{"near_tris_budget":2000,"near_sides":[7,5,0],"mid_blobs":5,"mid_branches":4,"mid_blob_scale":0.95},"license":"CC BY-SA 4.0"},
  "pinus_sabiniana": {"id":"pinus_sabiniana","aliases":["gray_pine"],"scientific":"Pinus sabiniana","common":"gray pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[12,22],"variants":3,"description":"A thin, often forked or leaning pine whose sparse gray-green needles, 20-30 cm long in bundles of three, make a crown you can see the sky through; 12-22 m tall here. It grows only in California, scattered among blue oaks on the hottest, driest foothill slopes, and its heavy cones hold large, hard-shelled seeds eaten by squirrels and jays and long gathered as food by Native Californians.","season_notes":{"winter":"Evergreen: the gray-green needles look hazy against the hills, and heavy cones from past years still hang in the crown.","spring":"Pollen cones shed yellow pollen (March-April) and new needles grow at the branch tips.","summer":"Second-year cones swell to full size; the open crown gives little shade.","fall":"Ripe cones open and drop big, hard-shelled seeds that squirrels, jays and woodpeckers gather."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.95,"radius_ratio":0.03,"taper":0.9,"flare":1.2,"bole_ratio":0.25,"base_size":0.3,"curve_deg":25,"curve_var_deg":25,"segments":6,"lean_deg":14,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.55,"split_count":2,"split_angle_deg":22,"bark_rgb":[90,85,78],"bark_pattern":"furrowed","twig_rgb":[106,100,90]},"crown":{"shape":"spherical"},"levels":[{"count":18,"whorl":3,"down_angle_deg":65,"down_angle_tip_deg":45,"down_angle_var_deg":20,"rotation_deg":50,"rotation_var_deg":30,"length_ratio":0.38,"length_var":0.3,"curve_deg":25,"curve_var_deg":25,"tropism":0.06,"taper":0.95,"radius_ratio":0.4,"segments":3},{"count":4,"start":0.3,"down_angle_deg":40,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":40,"length_ratio":0.4,"length_var":0.3,"curve_deg":20,"curve_var_deg":20,"tropism":0.04,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.27,"leaf_shape":"needle_cluster","cluster_m":1.4,"density":6,"start":0.4,"parent_start":0.4,"orientation":"along","droop":0.6,"colors":{"winter":[108,122,98],"spring":[112,128,98],"summer":[116,126,102],"fall":[114,124,100]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0}},"lod":{"near_tris_budget":1400,"near_sides":[7,4,3],"mid_blobs":5,"mid_branches":6,"mid_blob_scale":0.7},"license":"CC BY-SA 4.0"},
  "pinus_ponderosa": {"id":"pinus_ponderosa","aliases":["ponderosa"],"scientific":"Pinus ponderosa","common":"ponderosa pine","form":"tree","architectural_model":"Rauh","deciduous":false,"height_m":[22,38],"variants":3,"description":"A tall, straight pine with a clear trunk, thick bark broken into cinnamon-orange plates between black fissures, and long needles (12-25 cm, in threes) in tufts at the branch tips; 22-38 m tall here. It grows above the oak woodland in the lower conifer forest, from about 600 m up, and its thick bark lets old trees survive the frequent low fires that once kept these forests open.","season_notes":{"winter":"Evergreen: needles stay on for about three years, so the crown is full in every season.","spring":"Pollen cones release clouds of yellow pollen (May-June) and new shoots extend at the branch tips.","summer":"Second-year seed cones grow to full size and turn from green to red-brown.","fall":"Cones open and drop winged seeds (September-October) for squirrels, chipmunks and birds; the oldest needles yellow and fall."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":1.0,"radius_ratio":0.03,"taper":1.0,"flare":1.25,"bole_ratio":0.45,"base_size":0.45,"curve_deg":4,"curve_var_deg":4,"segments":7,"lean_deg":3,"stems":[1,1],"stem_spread_deg":0,"split_prob":0.03,"split_count":2,"split_angle_deg":12,"bark_rgb":[176,108,66],"bark_pattern":"plates","twig_rgb":[92,74,60]},"crown":{"shape":"tapered_cylindrical"},"levels":[{"count":30,"whorl":3,"down_angle_deg":92,"down_angle_tip_deg":58,"down_angle_var_deg":10,"rotation_deg":37,"rotation_var_deg":25,"length_ratio":0.26,"length_var":0.2,"curve_deg":0,"curve_var_deg":16,"tropism":0.02,"droop_deg":34,"upturn_deg":40,"taper":0.95,"radius_ratio":0.32,"segments":4},{"count":6,"start":0.3,"down_angle_deg":50,"down_angle_var_deg":15,"rotation_deg":-90,"rotation_var_deg":30,"length_ratio":0.3,"length_var":0.3,"curve_deg":10,"curve_var_deg":10,"tropism":0.12,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.2,"leaf_shape":"needle_cluster","cluster_m":1.8,"density":6,"start":0.4,"parent_start":0.35,"orientation":"along","colors":{"winter":[48,70,44],"spring":[60,86,48],"summer":[52,78,46],"fall":[58,78,44]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0}},"lod":{"near_tris_budget":2000,"near_sides":[8,3,0],"mid_blobs":5,"mid_branches":6,"mid_blob_scale":0.7},"license":"CC BY-SA 4.0"},
  "arctostaphylos_viscida": {"id":"arctostaphylos_viscida","aliases":["manzanita"],"scientific":"Arctostaphylos viscida","common":"whiteleaf manzanita","form":"shrub","architectural_model":"Leeuwenberg","deciduous":false,"height_m":[1.5,3.5],"variants":3,"description":"A crooked, many-stemmed shrub with smooth, polished red-brown bark and stiff, round, pale gray-green (almost white) leaves held edge-on to the sun; 1.5-3.5 m tall here. It grows in chaparral and in openings of the woodland and pine forest on dry, rocky ridges, and its late-winter flowers are among the first nectar of the year for hummingbirds and native bees, while its berries feed birds, foxes, coyotes and bears.","season_notes":{"winter":"Flowering in late winter (February-March): small white-to-pink urn-shaped flowers, early nectar for hummingbirds and native bees.","spring":"Flowers give way to sticky green berries.","summer":"The berries ('little apples', which is what manzanita means) ripen red-brown, and the red bark peels in thin curls.","fall":"Evergreen and dormant through the dry season; next winter's flower buds are already set at the branch tips."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.75,"radius_ratio":0.035,"taper":0.7,"flare":1.6,"bole_ratio":0.1,"base_size":0.25,"curve_deg":35,"curve_var_deg":30,"segments":4,"lean_deg":0,"stems":[3,5],"stem_spread_deg":35,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[116,40,28],"bark_pattern":"smooth","twig_rgb":[128,52,36]},"crown":{"shape":"hemispherical"},"levels":[{"count":5,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.55,"length_var":0.25,"curve_deg":30,"curve_var_deg":25,"tropism":0.08,"taper":0.9,"radius_ratio":0.6,"segments":2},{"count":4,"start":0.3,"down_angle_deg":35,"down_angle_var_deg":15,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.45,"length_var":0.25,"curve_deg":20,"curve_var_deg":20,"tropism":0.08,"taper":1.0,"radius_ratio":0.5,"segments":1}],"foliage":{"type":"broadleaf","leaf_size_m":0.035,"leaf_shape":"oval","cluster_m":0.5,"density":18,"start":0.35,"orientation":"vertical","colors":{"winter":[100,114,94],"spring":[122,122,106],"summer":[110,122,100],"fall":[104,116,96]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0}},"lod":{"near_tris_budget":1000,"near_sides":[5,3,0],"mid_blobs":3,"mid_branches":6},"license":"CC BY-SA 4.0"},
  "adenostoma_fasciculatum": {"id":"adenostoma_fasciculatum","aliases":["chamise"],"scientific":"Adenostoma fasciculatum","common":"chamise","form":"shrub","architectural_model":"Leeuwenberg (provisional)","deciduous":false,"height_m":[1.2,2.4],"variants":3,"description":"A dense, many-stemmed shrub with tiny needle-like leaves in bundles along stiff, upright branches, and clusters of small white flowers at the tips in early summer; 1.2-2.4 m tall here. It is the most common chaparral shrub in California, forming thick stands on hot, dry slopes with thin soil, where it resprouts from a woody burl after fire and gives cover to quail, brush rabbits and wrentits.","season_notes":{"winter":"Evergreen: winter rain brings new shoots, and stands burned in recent years sprout from their burls.","spring":"Fresh green growth, then clusters of small white flowers at the branch tips (May-June).","summer":"The flowers fade to rust-brown; the resinous leaves dry out, and chamise is one of the most flammable plants in the chaparral.","fall":"Rust-brown seed heads still cap the stems while the shrubs wait out the dry season for the first rain."},"status":"agent draft, needs local sign-off","trunk":{"length_ratio":0.85,"radius_ratio":0.02,"taper":0.85,"flare":1.5,"bole_ratio":0.05,"base_size":0.3,"curve_deg":15,"curve_var_deg":20,"segments":3,"lean_deg":0,"stems":[6,10],"stem_spread_deg":22,"split_prob":0.0,"split_count":2,"split_angle_deg":20,"bark_rgb":[96,76,62],"bark_pattern":"furrowed","twig_rgb":[106,90,74]},"crown":{"shape":"hemispherical"},"levels":[{"count":4,"down_angle_deg":28,"down_angle_var_deg":10,"rotation_deg":140,"rotation_var_deg":30,"length_ratio":0.42,"length_var":0.3,"curve_deg":10,"curve_var_deg":15,"tropism":0.1,"taper":1.0,"radius_ratio":0.6,"segments":1}],"foliage":{"type":"needle","leaf_size_m":0.008,"leaf_shape":"needle_fascicle","cluster_m":0.42,"density":24,"start":0.3,"orientation":"outward","colors":{"winter":[82,96,64],"spring":[150,152,120],"summer":[116,120,94],"fall":[124,104,80]},"leaf_on":{"winter":1.0,"spring":1.0,"summer":1.0,"fall":1.0}},"lod":{"near_tris_budget":900,"near_sides":[3,3],"mid_blobs":3,"mid_branches":0,"mid_sides":[3,3]},"license":"CC BY-SA 4.0"},
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

export function normalizeSpecies(raw) {
  const s = { ...DEFAULTS, ...raw };
  s.trunk = { ...DEFAULTS.trunk, ...raw.trunk };
  s.crown = { ...DEFAULTS.crown, ...raw.crown };
  s.levels = (raw.levels || []).map(l => ({ ...DEFAULTS.level, ...l }));
  const f = raw.foliage || {};
  s.foliage = { ...DEFAULTS.foliage, ...f, colors: { ...DEFAULTS.foliage.colors, ...f.colors }, leaf_on: { ...DEFAULTS.foliage.leaf_on, ...f.leaf_on } };
  s.lod = { ...DEFAULTS.lod, ...raw.lod };
  s.shrub = s.form === 'shrub';
  if (!s.lod.mid_sides) s.lod.mid_sides = s.shrub ? [4, 3] : [6, 3];
  if (s.lod.close_factor == null) s.lod.close_factor = s.shrub ? 3 : 3.5;   // close-tier cards per near card
  if (s.lod.close_scale == null) s.lod.close_scale = 0.6;                  // close-tier card size / near card size
  if (s.deciduous == null) s.deciduous = (s.foliage.leaf_on.winter ?? 1) < 0.5;
  if (!s.lod.mid_canopy) s.lod.mid_canopy = 'cards';   // default: far foliage as enlarged leaf cards (continuous forest; blobs read as green balls)
  if (DEV_MID_CANOPY) s.lod.mid_canopy = DEV_MID_CANOPY;
  return s;
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
function grow({ level, origin, dir, length, r0, taper, segs, curve = 0, curveVar = 0, tropism = 0, straight = 0, flare = 1, taperLen = length, droop = 0, upturn = 0, rnd }) {
  const d = dir.clone().normalize(), axis = perpendicular(d, rnd);
  const pts = [origin.clone()], p = origin.clone();
  if (straight > 0) {
    if (flare > 1 && straight > 0.8) pts.push(origin.clone().addScaledVector(d, Math.min(0.35, straight * 0.25)));
    p.addScaledVector(d, straight); pts.push(p.clone());
  }
  const rest = length - straight, n = rest > 1e-3 ? Math.max(1, segs) : 0, seg = rest / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    d.applyAxisAngle(axis, (curve / n + (rnd() * 2 - 1) * curveVar / n) * DEG);
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

// Child direction: tilt the parent direction by `down` toward the azimuth `az`, measured around the
// parent from its "up" side (world X for a vertical parent), so +/-90 degrees is sideways.
function childDir(pd, downDeg, az) {
  const ref = UP.clone().addScaledVector(pd, -pd.dot(UP));
  if (ref.lengthSq() < 0.09) ref.copy(X).addScaledVector(pd, -pd.dot(X));
  ref.normalize().applyAxisAngle(pd, az);
  return pd.clone().multiplyScalar(Math.cos(downDeg * DEG)).addScaledVector(ref, Math.sin(downDeg * DEG)).normalize();
}

function woodTris(stems, sides) {
  let t = 0; for (const s of stems) { const k = sides[s.level] || 0; if (k > 0) t += k * 2 * (s.pts.length - 1); } return t;
}

const skeletons = new Map();
function skeleton(spec, seed) {
  const key = `${spec.id}:${seed}`;
  if (skeletons.has(key)) return skeletons.get(key);
  const rnd = mulberry32(seed), sym = () => rnd() * 2 - 1;
  const T = spec.trunk, L = spec.levels, F = spec.foliage;
  const H = spec.height_m[0] + rnd() * (spec.height_m[1] - spec.height_m[0]);
  const lean = sym() * T.lean_deg * DEG, leanDir = rnd() * Math.PI * 2;
  const trunkLen = H * T.length_ratio, r0 = 0.5 * T.radius_ratio * H;
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
    const common = { level: 0, origin, dir, r0: rr, taper: T.taper, taperLen: len, flare: k === 0 || spec.shrub ? T.flare : 1, rnd };
    if (split && boleLen > 0.05) {
      const bole = grow({ ...common, length: boleLen, segs: 0, straight: boleLen });
      stems.push(bole); trunks.push({ stem: bole, h0: 0, h1: T.bole_ratio, len }); if (k === 0) main = bole;
      const top = bole.pts[bole.pts.length - 1], rTop = bole.rad[bole.rad.length - 1], sa = rnd() * Math.PI * 2;
      for (let j = 0; j < T.split_count; j++) {
        const d = childDir(dir, T.split_angle_deg * (0.7 + 0.6 * rnd()), sa + j * Math.PI * 2 / T.split_count + sym() * 0.4);
        const l = (len - boleLen) * (0.8 + 0.2 * rnd());
        const st = grow({ level: 0, origin: top, dir: d, length: l, r0: rTop * 0.75, taper: T.taper, segs: Math.max(2, T.segments - 1),
          curve: T.curve_deg, curveVar: T.curve_var_deg, tropism: T.tropism, rnd });
        stems.push(st); trunks.push({ stem: st, h0: T.bole_ratio, h1: 1, len });
      }
    } else {
      const st = grow({ ...common, length: len, segs: T.segments, straight: boleLen, curve: T.curve_deg, curveVar: T.curve_var_deg, tropism: T.tropism });
      stems.push(st); trunks.push({ stem: st, h0: 0, h1: 1, len }); if (k === 0) main = st;
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
          const st = grow({ level: 1, origin: p, dir: childDir(d, down, a), length: len, r0: Math.min(r * 0.85, Math.max(0.004, r * P.radius_ratio)),
            taper: P.taper, segs: P.segments, curve: P.curve_deg, curveVar: P.curve_var_deg, tropism: P.tropism, droop: P.droop_deg, upturn: P.upturn_deg, rnd });
          stems.push(st); parents.push(st);
        }
      }
    }
  }
  // Deeper levels: count scaled by the parent's length, length = ratio * (parent - 0.6 * offset).
  for (let li = 1; li < L.length; li++) {
    const P = L[li], start = P.start ?? 0.15, maxLen = Math.max(...parents.map(s => s.len), 1e-3), next = [];
    for (const par of parents) {
      const n = Math.max(1, Math.round(P.count * (0.4 + 0.6 * par.len / maxLen)));
      let az = rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const u = Math.min(0.97, start + (1 - start) * (i + 0.5 + sym() * 0.4) / n);
        const a = P.rotation_deg < 0 ? (i % 2 ? 1 : -1) * (-P.rotation_deg + sym() * P.rotation_var_deg) * DEG : (az += (P.rotation_deg + sym() * P.rotation_var_deg) * DEG);
        const down = P.down_angle_deg + (P.down_angle_tip_deg != null ? (P.down_angle_tip_deg - P.down_angle_deg) * u : 0) + sym() * P.down_angle_var_deg;
        const len = P.length_ratio * par.len * (1 - 0.6 * u) * (1 + sym() * P.length_var);
        if (len < 0.03) continue;
        const { p, d, r } = par.at(u);
        const st = grow({ level: li + 1, origin: p, dir: childDir(d, down, a), length: len, r0: Math.min(r * 0.85, Math.max(0.003, r * P.radius_ratio)),
          taper: P.taper, segs: P.segments, curve: P.curve_deg, curveVar: P.curve_var_deg, tropism: P.tropism, droop: P.droop_deg, upturn: P.upturn_deg, rnd });
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
    if (s.level === deepest) bearing.push([s, F.start, 1]);
    else if (deepest > 0 && s.level === deepest - 1) bearing.push([s, F.parent_start, 1]);
  }
  const weights = []; let acc = 0;
  for (const [s, a, b] of bearing) { acc += s.len * (b - a); weights.push(acc); }
  const sides = spec.lod.near_sides, wood = woodTris(stems, sides), perCard = F.crossed ? 4 : 2;
  const nCards = Math.max(12, Math.min(Math.round(F.density * acc), Math.floor((spec.lod.near_tris_budget - wood) / perCard)));
  const cards = [];
  const along = F.orientation === 'along';
  for (let i = 0; i < nCards && acc > 0; i++) {
    const x = frnd() * acc; let k = 0; while (k < weights.length - 1 && weights[k] < x) k++;
    const [s, a, b] = bearing[k];
    const u = along || F.type === 'needle' ? b - (b - a) * Math.pow(frnd(), 1.6) : a + (b - a) * frnd();
    const { p, d } = s.at(u);
    const j = new THREE.Vector3(frnd() - 0.5, frnd() - 0.5, frnd() - 0.5).multiplyScalar(F.cluster_m * (along ? 0.3 : 0.6));
    cards.push({ c: p.add(j), d, r: [frnd(), frnd(), frnd(), frnd(), frnd()] });
  }
  // Close tier: more, smaller cards from the same distribution (own random stream, and not part of
  // the height fit below, so the near and mid trees are unchanged). Jitter stays at the near scale so
  // the crown fills the same volume and the near/close cross-fade keeps the silhouette.
  const crnd = mulberry32(seed ^ 0x2c1b3c6d), closeCards = [];
  const nClose = acc > 0 ? Math.round(cards.length * spec.lod.close_factor) : 0;
  for (let i = 0; i < nClose; i++) {
    const x = crnd() * acc; let k = 0; while (k < weights.length - 1 && weights[k] < x) k++;
    const [s, a, b] = bearing[k];
    const u = along || F.type === 'needle' ? b - (b - a) * Math.pow(crnd(), 1.6) : a + (b - a) * crnd();
    const { p, d } = s.at(u);
    const j = new THREE.Vector3(crnd() - 0.5, crnd() - 0.5, crnd() - 0.5).multiplyScalar(F.cluster_m * (along ? 0.3 : 0.6));
    closeCards.push({ c: p.add(j), d, r: [crnd(), crnd(), crnd(), crnd(), crnd()] });
  }
  // Fit the sampled height: scale the whole tree so its top is at H.
  let top = 0;
  for (const s of stems) for (const p of s.pts) top = Math.max(top, p.y);
  for (const c of cards) top = Math.max(top, c.c.y + F.cluster_m * 0.4);
  const k = H / top;
  for (const s of stems) { s.pts.forEach(p => p.multiplyScalar(k)); s.rad = s.rad.map(r => r * k); s.cum = s.cum.map(v => v * k); s.len *= k; }
  for (const c of cards) c.c.multiplyScalar(k);
  for (const c of closeCards) c.c.multiplyScalar(k);
  // Crown centre and radii (for card normals, inner shading and mid-LOD blobs).
  const centre = new THREE.Vector3(), radii = new THREE.Vector3();
  for (const c of cards) centre.add(c.c);
  centre.divideScalar(Math.max(1, cards.length));
  for (const c of cards) { radii.x += (c.c.x - centre.x) ** 2; radii.y += (c.c.y - centre.y) ** 2; radii.z += (c.c.z - centre.z) ** 2; }
  radii.divideScalar(Math.max(1, cards.length)).set(Math.sqrt(radii.x), Math.sqrt(radii.y), Math.sqrt(radii.z)).multiplyScalar(2.0).addScalar(F.cluster_m * k * 0.3);
  main.r0base *= k;
  const boleLen = main.cum[main.boleIdx];   // straight bole: the acorn game puts stash holes on it
  if (wood > spec.lod.near_tris_budget * 0.7) console.warn(`${spec.id}: wood uses ${wood} of ${spec.lod.near_tris_budget} near triangles; foliage gets ${cards.length} cards`);
  const sk = { spec, H, lean, leanDir, stems, cards, closeCards, centre, radii, cluster: F.cluster_m * k, wood,
    stem: { len: boleLen, length: boleLen, r0: main.r0base, r1: main.rad[main.boleIdx], lean, leanDir } };
  skeletons.set(key, sk);
  return sk;
}

// ---------------------------------------------------------------------------------------------
// Meshing

class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.rank = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(p, nrm, c, uv = [0, 0], rank = 0) { this.pos.push(p.x, p.y, p.z); this.nor.push(nrm.x, nrm.y, nrm.z); this.col.push(c[0], c[1], c[2]); this.uv.push(uv[0], uv[1]); this.rank.push(rank); return this.n - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build(xf, { uv = false, rank = false } = {}) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(this.pos), nor = new Float32Array(this.nor);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    if (rank) g.setAttribute('leafRank', new THREE.BufferAttribute(new Float32Array(this.rank), 1));
    g.setIndex(this.n < 65536 ? new THREE.BufferAttribute(new Uint16Array(this.idx), 1) : new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    if (xf) { g.applyMatrix4(xf); }
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

// Tube along stem points `idx`, `sides` around, frames by parallel transport.
function tube(G, stem, idx, sides, colorOf, rnd) {
  const P = idx.map(i => stem.pts[i]), R = idx.map(i => stem.rad[i]);
  const t = P[1].clone().sub(P[0]).normalize();
  let n = perpendicular(t, () => 0.37);
  const base = G.n, b = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    if (i === 0) dir.copy(t);
    else if (i === P.length - 1) dir.subVectors(P[i], P[i - 1]).normalize();
    else dir.subVectors(P[i], P[i - 1]).normalize().add(q.subVectors(P[i + 1], P[i]).normalize()).normalize();
    n.addScaledVector(dir, -n.dot(dir)).normalize(); b.crossVectors(dir, n);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, nx = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      G.v(P[i].clone().addScaledVector(nx, R[i]), nx, colorOf(k, i));
    }
  }
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = base + i * sides + k, bb = base + i * sides + (k + 1) % sides, c = a + sides, d = bb + sides;
    G.tri(a, bb, c); G.tri(bb, d, c);
  }
}

function evenIdx(len, segs) {
  const m = Math.min(segs, len - 1), out = [];
  for (let i = 0; i <= m; i++) out.push(Math.round(i * (len - 1) / m));
  return out;
}

function woodGeometry(sk, lod, rnd) {
  const spec = sk.spec, T = spec.trunk, Gb = new Geo();
  const bark = T.bark_rgb.map(srgbToLin), twig = (T.twig_rgb || T.bark_rgb).map(srgbToLin), depth = Math.max(1, spec.levels.length);
  const near = lod === 'near';
  const sides = near ? spec.lod.near_sides : spec.lod.mid_sides;
  let stems = sk.stems;
  if (!near) {   // mid: trunks plus the longest level-1 limbs only
    const l1 = stems.filter(s => s.level === 1).sort((a, b) => b.len - a.len).slice(0, spec.lod.mid_branches);
    stems = stems.filter(s => s.level === 0).concat(l1);
  }
  for (const s of stems) {
    const k = sides[s.level] || 0; if (k < 3) continue;
    const mix = s.level === 0 ? 0 : Math.min(1, 0.6 + 0.4 * (s.level - 1) / Math.max(1, depth - 1)), c0 = bark.map((v, i) => v + (twig[i] - v) * mix);
    const idx = near ? s.pts.map((_, i) => i) : evenIdx(s.pts.length, s.level === 0 && !spec.shrub ? 3 : 2);
    tube(Gb, s, idx, k, (kk, ring) => { const f = s.level === 0 ? barkShade(T.bark_pattern, rnd, kk, ring) : 0.9 + 0.2 * rnd(); return c0.map(v => v * f); }, rnd);
  }
  return Gb;
}

// `keep` < 1 draws a subset of the cards, enlarged to keep the same leaf area (the optional mid-LOD card mode).
// `cards` and `scale` select the close tier: its own card list at a smaller size.
function cardGeometry(sk, keep = 1, cards = sk.cards, scale = 1) {
  const spec = sk.spec, F = spec.foliage, G = new Geo(), C = sk.centre, Rr = sk.radii;
  const leaf = F.colors.summer.map(srgbToLin), size = scale * sk.cluster * Math.min(2.5, 1 / Math.sqrt(keep));
  const out = new THREE.Vector3(), nrm = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), vn = new THREE.Vector3();
  const corner = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [-0.5, 0.5, 0, 1], [0.5, 0.5, 1, 1]];
  const quad = (c, n, u, w, h, col, rank, outN) => {
    right.crossVectors(u, n).normalize();
    const base = G.n;
    for (const [sx, sy, tu, tv] of corner) {
      const p = c.clone().addScaledVector(right, sx * w).addScaledVector(u, sy * h);
      vn.subVectors(p, C).divide(Rr).normalize().multiplyScalar(0.8).addScaledVector(outN, 0.2).normalize();   // crown-shaped normals
      G.v(p, vn, col, [tu, tv], rank);
    }
    G.tri(base, base + 1, base + 2); G.tri(base + 1, base + 3, base + 2);
  };
  const step = 1 / keep;
  for (let ci = 0; ci < cards.length; ci += step) {
    const card = cards[Math.floor(ci)];
    const [r0, r1, r2, r3, r4] = card.r;
    out.subVectors(card.c, C).divide(Rr); const depth = out.length(); out.normalize();
    const d = card.d;
    if (F.orientation === 'along') { nrm.copy(out).addScaledVector(d, -out.dot(d)); if (nrm.lengthSq() < 1e-4) nrm.copy(perpendicular(d, () => r0)); nrm.normalize(); }
    else {
      nrm.set(r0 - 0.5, r1 - 0.5, r2 - 0.5).multiplyScalar(1.8).add(out);
      if (F.orientation === 'vertical') nrm.y = 0;
      if (nrm.lengthSq() < 1e-4) nrm.set(1, 0, 0); nrm.normalize();
    }
    up.copy(d).addScaledVector(nrm, -d.dot(nrm)); if (up.lengthSq() < 1e-4) up.copy(perpendicular(nrm, () => r1)); up.normalize();
    up.applyAxisAngle(nrm, (r3 - 0.5) * (F.orientation === 'along' ? 0.5 : 1.4));
    const s = size * (0.75 + 0.5 * r2);
    const ao = (0.62 + 0.38 * THREE.MathUtils.smoothstep(depth, 0.15, 1.0)) * (0.82 + 0.18 * (out.y * 0.5 + 0.5));
    const j = 0.85 + 0.3 * r1;
    const col = leaf.map((v, i) => v * j * ao * (1 + (i === 1 ? 0.06 : -0.03) * (r4 - 0.5)));
    quad(card.c, nrm, up, s, s, col, r4, out);
    if (F.crossed) quad(card.c, nrm.clone().cross(up).normalize(), up, s, s, col, r4, out);
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
  const sk = skeleton(LIBRARY[id], seed);
  const xf = new THREE.Matrix4().makeRotationY(sk.leanDir).multiply(new THREE.Matrix4().makeRotationZ(sk.lean));
  if (lod === 'close') {
    const canopy = cardGeometry(sk, 1, sk.closeCards, sk.spec.lod.close_scale).build(xf, { uv: true, rank: true });
    return { trunk: null, canopy, height: sk.H, stem: { ...sk.stem }, tris: { trunk: 0, canopy: triCount(canopy), cards: sk.closeCards.length }, species: id };
  }
  const rnd = mulberry32(seed ^ (lod === 'near' ? 0x1234567 : 0x7654321));
  const trunk = woodGeometry(sk, lod, rnd).build(xf);
  const midCards = lod !== 'near' && sk.spec.lod.mid_canopy === 'cards';
  const canopy = (lod === 'near' ? cardGeometry(sk) : midCards ? cardGeometry(sk, Math.min(1, (sk.spec.lod.mid_cards ?? 60) / sk.cards.length)) : blobGeometry(sk, rnd))
    .build(xf, { uv: lod === 'near' || midCards, rank: true });
  return { trunk, canopy, height: sk.H, stem: { ...sk.stem }, tris: { trunk: triCount(trunk), canopy: triCount(canopy), cards: sk.cards.length }, species: id };
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
// Leaf spray (or needle tufts) texture for one species, drawn once on a canvas: white-to-grey
// leaves on transparent, so the vertex colour carries the species and season colour. The spray
// fills an ellipse in the card; mips are built to keep the same alpha-test coverage (Castano 2010),
// so crowns do not thin out with distance.
// `scale` < 1 is the close tier's smaller card: the same spray drawn for a card that much smaller,
// so each leaf (or needle) keeps its real size and there are fewer, larger leaves per card.
export function leafTexture(spec, scale = 1) {
  const key = `${spec.id}:${scale}`;
  if (textures.has(key)) return textures.get(key);
  const F = spec.foliage, S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rnd = mulberry32(hashStr(spec.id) ^ (scale === 1 ? 0 : 0x9e3779b9));
  const px = Math.max(5, Math.min(110, F.leaf_size_m / (F.cluster_m * scale) * S * (F.type === 'needle' ? 1 : 1.3)));
  const grey = (lo = 170) => { const v = Math.round(lo + (255 - lo) * rnd()); return `rgb(${v},${v},${v})`; };
  const inside = () => { for (;;) { const x = rnd() * 2 - 1, y = rnd() * 2 - 1; if (x * x + y * y < 1) return [S / 2 + x * S * 0.4, S / 2 + y * S * 0.43]; } };
  g.lineCap = 'round';
  // twigs: a main stem from the card base and side twigs toward the edge of the ellipse
  const twigs = [], main = [S / 2 + (rnd() - 0.5) * 16, S - 4, S / 2 + (rnd() - 0.5) * 40, 22];
  twigs.push(main);
  for (let k = 0; k < 7; k++) {
    const t = 0.15 + 0.7 * (k + rnd() * 0.6) / 7, x = main[0] + (main[2] - main[0]) * t, y = main[1] + (main[3] - main[1]) * t;
    const side = k % 2 ? 1 : -1, a = side * (0.6 + 0.7 * rnd()), l = S * (0.28 + 0.14 * rnd());
    twigs.push([x, y, Math.max(10, Math.min(S - 10, x + Math.sin(a) * l)), Math.max(10, Math.min(S - 10, y - Math.cos(a) * l))]);
  }
  g.strokeStyle = F.type === 'needle' ? 'rgb(105,105,105)' : 'rgb(135,135,135)';
  for (const [x0, y0, x1, y1] of twigs) { g.lineWidth = F.type === 'needle' ? 2 : 2.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  const area = Math.PI * (S * 0.4) * (S * 0.43);
  if (F.leaf_shape === 'needle_cluster') {
    // Tufts at the twig ends (and a few along them): needles radiating forward, drooping if asked.
    const tufts = twigs.map(t => [t[2], t[3], Math.atan2(t[2] - t[0], -(t[3] - t[1]))]);
    const extra = Math.max(0, Math.round(area / (Math.PI * px * px) * 1.4) - tufts.length);
    for (let i = 0; i < extra; i++) { const tw = twigs[Math.floor(rnd() * twigs.length)], u = 0.45 + 0.5 * rnd(); tufts.push([tw[0] + (tw[2] - tw[0]) * u, tw[1] + (tw[3] - tw[1]) * u, Math.atan2(tw[2] - tw[0], -(tw[3] - tw[1]))]); }
    for (const [x, y, ta] of tufts) {
      const n = 40 + Math.round(20 * rnd());
      for (let i = 0; i < n; i++) {
        const a = ta + (rnd() - 0.5) * 2 * (0.4 + 1.2 * rnd()), len = px * (0.6 + 0.5 * rnd());
        const ex = x + Math.sin(a) * len, ey = y - Math.cos(a) * len, droop = F.droop * len * 0.7;
        g.strokeStyle = grey(130); g.lineWidth = 1.8 + 1.6 * rnd();
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + ex) / 2, (y + ey) / 2, ex, ey + droop); g.stroke();
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
    // Leaves alternating along the twigs, then scattered through the spray to close it up.
    for (const [x0, y0, x1, y1] of twigs) {
      const L = Math.hypot(x1 - x0, y1 - y0), ta = Math.atan2(x1 - x0, -(y1 - y0)), step = px * 0.45;
      for (let s = step * 0.6; s <= L; s += step) for (const side of [-1, 1]) {
        const x = x0 + (x1 - x0) * s / L, y = y0 + (y1 - y0) * s / L, a = ta + side * (0.5 + 0.5 * rnd()), l = px * (0.8 + 0.4 * rnd());
        drawLeaf(g, x + Math.sin(a) * l * 0.5, y - Math.cos(a) * l * 0.5, a, l, F.leaf_shape, grey(), rnd);
      }
      drawLeaf(g, x1, y1, ta, px, F.leaf_shape, grey(), rnd);
    }
    // Filler: the close tier's sprays are sparser (single leaves with gaps, so the card outline
    // dissolves up close); it gets its density from more cards instead.
    const w = F.leaf_shape === 'lanceolate' ? 0.15 : F.leaf_shape === 'lobed' ? 0.3 : 0.32;
    const n = Math.round(area * (scale < 1 ? 0.12 : 0.35) / (Math.PI * px * w * px * 0.5));
    for (let i = 0; i < n; i++) { const [x, y] = inside(); drawLeaf(g, x, y, rnd() * Math.PI * 2, px * (0.8 + 0.4 * rnd()), F.leaf_shape, grey(), rnd); }
  }
  const t = new THREE.Texture();
  t.mipmaps = coverageMips(c, 0.5);
  t.image = t.mipmaps[0];
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;   // greys are multipliers on the linear vertex colour
  t.anisotropy = 4; t.needsUpdate = true;
  t.userData.mean = meanGrey(t.mipmaps[0]);   // the material divides by this so cards match the baked colour
  textures.set(key, t);
  return t;
}

// Mip chain whose alpha-tested coverage matches level 0: each level is a 2x box-filtered copy of
// the one above, with alpha scaled so the same fraction of texels passes `ref`.
function coverageMips(canvas, ref) {
  const out = [], g0 = canvas.getContext('2d');
  let img = g0.getImageData(0, 0, canvas.width, canvas.height);
  const cover = d => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= ref * 255) n++; return n / (d.length / 4); };
  const target = cover(img.data);
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

function meanGrey(img) {
  let s = 0, n = 0; const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) { s += d[i] / 255; n++; }
  return n ? s / n : 1;
}

function drawLeaf(g, x, y, a, len, shape, fill, rnd) {
  g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = fill; g.beginPath();
  const w = shape === 'lanceolate' ? 0.15 : shape === 'lobed' ? 0.26 : 0.32;
  g.ellipse(0, 0, len * w, len * 0.5, 0, 0, Math.PI * 2); g.fill();
  if (shape === 'lobed') for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    g.beginPath(); g.arc(s * len * 0.22, -len * 0.28 + i * len * 0.24, len * (0.12 + 0.03 * rnd()), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.ellipse(-len * w * 0.4, 0, len * w * 0.55, len * 0.45, 0, 0, Math.PI * 2); g.fill();   // half-leaf shading
  g.restore();
}

// Canopy material for a species and LOD. `patch` (optional) runs first, e.g. atmosphere.patchLambert.
// Leaf-on below 1 discards the cards (or blobs) whose rank is above it, so a deciduous crown thins
// rather than fading; the near cards keep their crown-shaped normals on both faces.
export function canopyMaterial(spec, lod = 'near', patch = null) {
  const close = lod === 'close';
  const near = close || lod === 'near' || spec.lod.mid_canopy === 'cards';   // card materials (alpha-tested spray texture)
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff,
    ...(near ? { map: leafTexture(spec, close ? spec.lod.close_scale : 1), alphaTest: 0.5, side: THREE.DoubleSide } : {}) });
  // No alpha-to-coverage at near and mid: it turns small, distant cards into partial coverage that
  // washes the crown out against the ground; plain alpha test on coverage-preserving mips keeps it as
  // dense as the mid blobs. The close tier (under about 110 m, cards large on screen) does use it:
  // with MSAA it smooths the leaf edges that alias under plain alpha test up close.
  if (close) m.alphaToCoverage = true;
  m.userData.leafOn = { value: 1 };
  m.userData.gain = near ? 1 / m.map.userData.mean : 1;   // the spray's mean grey, so near cards match the baked colour
  if (patch) patch(m);
  chainShader(m, close ? 'leaf-close' : near ? 'leaf-near' : 'leaf-mid', shader => {
    shader.uniforms.leafOn = m.userData.leafOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float leafRank;\nvarying float vLeafRank;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafRank = leafRank;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float leafOn;\nvarying float vLeafRank;')
      .replace('#include <clipping_planes_fragment>', 'if (vLeafRank >= leafOn) discard;\n#include <clipping_planes_fragment>');
    if (near) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  });
  return m;
}

export function trunkMaterial(patch = null) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (patch) patch(m);
  return m;
}

// Season look for a species' canopy material: tint = season colour / baked summer colour (linear),
// leaf-on from the file. Returns the leaf-on fraction so callers can hide a bare crown outright.
export function applySeason(material, spec, season) {
  const c = spec.foliage.colors, s = c[season] || c.summer;
  const gain = material.userData.gain ?? 1;
  material.color.setRGB(...s.map((v, i) => gain * srgbToLin(v) / Math.max(1e-4, srgbToLin(c.summer[i]))));
  const on = spec.foliage.leaf_on[season] ?? 1;
  material.userData.leafOn.value = on;
  return on;
}
