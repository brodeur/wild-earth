"""Data-driven species mix per 30 m cell, from the LANDFIRE community names.

The client's first pass used one fixed species mix per habitat class. LANDFIRE EVT already
names the actual community ("California Lower Montane Blue Oak-Foothill Pine Woodland and
Savanna", "Mediterranean California Dry-Mesic Mixed Conifer Forest and Woodland", ...), so each
EVT code in the tile is mapped by keyword rules on its name to weights over the library's tree
and shrub species plus tree and shrub density multipliers. Human cells (Developed, Agricultural, Quarries)
take the rule of their Biophysical Settings name instead, so rewilded cells get the community
that would grow there.

Products (client/, on the 30 m vegetation grid, row 0 = north). Format 2 (2026-10-25): any number of
species. A cell carries only its row and its two density multipliers; the rows carry the weights.
  species_mix_index.png    L     row index into species_mix.json "mixes" (0 = none); RGB (R low byte,
                                 G high byte) if a tile ever has more than 255 rows ("cells.index_bytes": 2)
  species_mix_density.png  RGB   R tree_density, G shrub_density (multiplier = byte / 100), B 0
  species_mix.json         "format": 2, the species columns, the code -> mix table actually used (each
                           row's weights as bytes summing to 255 per layer), per-tile fractions
The weights were never varied per cell (every cell of a row had the row's bytes), so nothing is lost.
Terrain (2026-10-26): within a community a species' weight follows the ground (TERRAIN: elevation band,
valley floor or steep slope, north-facing), so a community has one row per distinct terrain response and
every row still carries plain weights; the client is unchanged.
Format 1 (four RGBA/RGB weight PNGs and mixes[].bytes with a bytes_layout) is read by the client
for tiles built before; this module no longer writes it.

Every rule is a first guess meant to be tuned in the viewer, like the habitat tables.
"""
from __future__ import annotations

import json
import pathlib
import warnings

import numpy as np
import rasterio
from PIL import Image

from .config import Tile, sha256
from .habitat import CLASSES, HUMAN_PHYS_PREFIXES, rewilded_cells

# Column order of the species (format 2: `species` in species_mix.json, and the order of each row's
# tree_bytes / shrub_bytes, which is the order the client draws species in). The first nine are the
# species of format 1 in its column order; the foothill set (2026-10-26) is appended after them. A species
# a rule names that is not listed here is appended after these, in the order the rules first name it
# (columns()). Ids are the library's canonical ids (library/species/<id>.json).
TREES = ["quercus_douglasii", "quercus_wislizeni", "pinus_sabiniana", "pinus_ponderosa",
         "salix_lasiolepis", "alnus_rhombifolia", "populus_fremontii",
         "quercus_lobata", "quercus_chrysolepis", "quercus_kelloggii", "aesculus_californica", "arbutus_menziesii",
         "umbellularia_californica", "juglans_hindsii", "acer_macrophyllum", "fraxinus_latifolia",
         "calocedrus_decurrens", "pseudotsuga_menziesii"]
SHRUBS = ["arctostaphylos_viscida", "adenostoma_fasciculatum",
          "heteromeles_arbutifolia", "cercis_occidentalis", "toxicodendron_diversilobum", "baccharis_pilularis",
          "sambucus_nigra_caerulea", "frangula_californica",
          # the understory set (2026-10-29): common manzanita, buckbrush, deerbrush, mountain mahogany, sticky
          # monkeyflower, California wild rose, snowberry, Sierra gooseberry, chaparral currant
          "arctostaphylos_manzanita", "ceanothus_cuneatus", "ceanothus_integerrimus", "cercocarpus_betuloides",
          "diplacus_aurantiacus", "rosa_californica", "symphoricarpos_albus", "ribes_roezlii", "ribes_malvaceum"]
# Short names for the per-tile fraction tables (older docs and reports use them, and the client's aliases).
SHORT = {"quercus_douglasii": "blue_oak", "quercus_wislizeni": "live_oak", "pinus_sabiniana": "gray_pine",
         "pinus_ponderosa": "ponderosa", "arctostaphylos_viscida": "manzanita", "adenostoma_fasciculatum": "chamise",
         "salix_lasiolepis": "willow", "alnus_rhombifolia": "alder", "populus_fremontii": "cottonwood",
         "quercus_lobata": "valley_oak", "quercus_chrysolepis": "canyon_live_oak", "quercus_kelloggii": "black_oak",
         "aesculus_californica": "buckeye", "arbutus_menziesii": "madrone", "umbellularia_californica": "bay",
         "juglans_hindsii": "walnut", "acer_macrophyllum": "maple", "fraxinus_latifolia": "ash",
         "calocedrus_decurrens": "incense_cedar", "pseudotsuga_menziesii": "douglas_fir",
         "heteromeles_arbutifolia": "toyon", "cercis_occidentalis": "redbud", "toxicodendron_diversilobum": "poison_oak",
         "baccharis_pilularis": "coyote_brush", "sambucus_nigra_caerulea": "elderberry", "frangula_californica": "coffeeberry",
         "arctostaphylos_manzanita": "common_manzanita", "ceanothus_cuneatus": "buckbrush", "ceanothus_integerrimus": "deerbrush",
         "cercocarpus_betuloides": "mountain_mahogany", "diplacus_aurantiacus": "monkeyflower", "rosa_californica": "wild_rose",
         "symphoricarpos_albus": "snowberry", "ribes_roezlii": "gooseberry", "ribes_malvaceum": "currant"}
FORMAT = 2
DENSITY_SCALE = 100   # density byte = round(multiplier * 100); 1.0 = the client's per-habitat-class count
LIBRARY = pathlib.Path(__file__).resolve().parent.parent / "library" / "species"

# Short ids for the rules below (canonical ids in the output).
BO, LO, GP, PP = "quercus_douglasii", "quercus_wislizeni", "pinus_sabiniana", "pinus_ponderosa"
WI, AL, CW = "salix_lasiolepis", "alnus_rhombifolia", "populus_fremontii"
VO, CO, KO, BU, MA, BA = ("quercus_lobata", "quercus_chrysolepis", "quercus_kelloggii", "aesculus_californica",
                          "arbutus_menziesii", "umbellularia_californica")
WA, MP, AS, IC, DF = ("juglans_hindsii", "acer_macrophyllum", "fraxinus_latifolia", "calocedrus_decurrens",
                      "pseudotsuga_menziesii")
MZ, CH = "arctostaphylos_viscida", "adenostoma_fasciculatum"
TY, RB, PO, CB, EL, CF = ("heteromeles_arbutifolia", "cercis_occidentalis", "toxicodendron_diversilobum",
                          "baccharis_pilularis", "sambucus_nigra_caerulea", "frangula_californica")
CM, BB, DB, MM, MF, WR, SN, GB, CR = ("arctostaphylos_manzanita", "ceanothus_cuneatus", "ceanothus_integerrimus",
                                      "cercocarpus_betuloides", "diplacus_aurantiacus", "rosa_californica",
                                      "symphoricarpos_albus", "ribes_roezlii", "ribes_malvaceum")

CONIFER = "sugar pine and white fir are not in the library: pinus_ponderosa stands in"
UNDERSTORY = ("the riparian understory (blackberry, wild rose, spicebush, California grape) is not in the library: "
              "elderberry and poison oak are the shrub layer, with a little manzanita")


def _r(rid, kws, trees, shrubs, td, sd, note=None, any_of=False, fixed=()):
    """fixed: species whose weight the terrain (TERRAIN) does not change in this rule (the community is
    named for them, so LANDFIRE has already put them there)."""
    return {"id": rid, "keywords": kws, "any": any_of, "trees": trees, "shrubs": shrubs,
            "tree_density": td, "shrub_density": sd, "note": note, "fixed": list(fixed)}


# Ordered: the first rule whose keywords all appear in the lower-cased name wins
# (any_of=True: any one keyword). Specific before general. Weights are relative within a layer (they are
# normalised per cell after the terrain factors). The nine original species keep their weights from
# before the foothill set; the new species are added beside them (a minority, but for black oak in the
# black-oak communities), so the original species' shares shrink in proportion. Where a species stood
# in for one now in the library (blue oak for valley oak, live oak for black oak, live oak and ponderosa
# for canyon live oak, madrone and Douglas-fir) the stand-in gives up that share.
RULES = [
    _r("open_water", ["open water"], {}, {}, 0.0, 0.0),
    _r("wet_meadow_marsh", ["marsh", "wet meadow"], {WI: 0.8, LO: 0.2, VO: 0.1}, {MZ: 0.5, EL: 0.25, CB: 0.25},
       0.05, 0.05, "herbaceous wetland: almost no woody plants, a few willows and a valley oak at the edge", any_of=True),
    # Riparian: arroyo willow thickets at the water, white alder rooted in the bank, Fremont cottonwood on the
    # floodplain, Oregon ash, black walnut and big-leaf maple beside them; valley oak and interior live oak up
    # the banks; elderberry and poison oak in the understory.
    _r("riparian_shrubland", ["riparian", "shrubland"], {WI: 0.75, AL: 0.1, LO: 0.15, AS: 0.05},
       {MZ: 0.5, CH: 0.5, EL: 0.45, PO: 0.45, CF: 0.1}, 1.2, 0.2, "willow scrub: arroyo willow is the shrubland; " + UNDERSTORY),
    _r("montane_riparian", ["montane riparian systems"],
       {AL: 0.4, WI: 0.25, LO: 0.15, PP: 0.12, CW: 0.08, MP: 0.12, AS: 0.06, WA: 0.02, BA: 0.04, IC: 0.05, DF: 0.04},
       {MZ: 1, EL: 0.5, PO: 0.6}, 1.3, 0.3, "alder-willow streamside forest with maple, ash, bay and some conifers; " + UNDERSTORY),
    _r("riparian", ["riparian"],
       {WI: 0.38, AL: 0.24, CW: 0.1, LO: 0.17, BO: 0.03, VO: 0.12, WA: 0.06, MP: 0.05, AS: 0.07, BA: 0.03, BU: 0.02},
       {MZ: 0.3, EL: 0.5, PO: 0.7, CF: 0.1, CB: 0.1}, 1.6, 0.3, UNDERSTORY),
    _r("blue_oak_foothill_pine", ["blue oak", "foothill pine"],
       {BO: 0.65, LO: 0.1, GP: 0.25, VO: 0.07, BU: 0.04, CO: 0.02, KO: 0.01},
       {MZ: 0.5, CH: 0.5, PO: 0.3, TY: 0.12, CF: 0.1, RB: 0.05, CB: 0.08}, 1.0, 0.5),
    _r("blue_oak", ["blue oak"], {BO: 0.85, LO: 0.1, GP: 0.05, VO: 0.06, BU: 0.05, CO: 0.02},
       {MZ: 0.4, CH: 0.6, PO: 0.3, TY: 0.1, CF: 0.08, RB: 0.04, CB: 0.06}, 1.0, 0.4),
    _r("foothill_pine", ["foothill pine"], {GP: 0.6, BO: 0.25, LO: 0.15, BU: 0.04, CO: 0.03},
       {MZ: 0.4, CH: 0.6, TY: 0.12, CF: 0.1, RB: 0.06, PO: 0.15}, 0.9, 1.0),
    _r("black_oak_conifer", ["black oak", "conifer"],
       {KO: 0.45, PP: 0.4, LO: 0.12, GP: 0.02, IC: 0.12, DF: 0.08, MA: 0.04, CO: 0.03},
       {MZ: 0.8, CH: 0.2, TY: 0.1, PO: 0.25, CF: 0.15, RB: 0.03}, 1.1, 0.6,
       "black oak with ponderosa, incense cedar and Douglas-fir (on north slopes); " + CONIFER, fixed=[KO]),
    _r("black_oak", ["black oak"], {KO: 0.6, LO: 0.15, PP: 0.15, MA: 0.04, BA: 0.02, CO: 0.03, IC: 0.03},
       {MZ: 0.9, CH: 0.1, PO: 0.3, TY: 0.1, CF: 0.15}, 1.0, 0.5, fixed=[KO]),
    _r("mixed_oak_savanna", ["mixed oak savanna"], {BO: 0.45, LO: 0.3, GP: 0.05, VO: 0.25, BU: 0.03},
       {MZ: 0.3, CH: 0.7, CB: 0.2, PO: 0.2, TY: 0.05}, 0.6, 0.3),
    _r("mixed_oak", ["mixed oak"], {BO: 0.4, LO: 0.45, GP: 0.15, VO: 0.05, CO: 0.06, BU: 0.05, KO: 0.08, MA: 0.03, BA: 0.02},
       {MZ: 0.6, CH: 0.4, TY: 0.15, PO: 0.35, CF: 0.15, RB: 0.06}, 1.0, 0.6),
    _r("mixed_evergreen", ["mixed evergreen"], {CO: 0.25, LO: 0.25, MA: 0.15, BA: 0.1, DF: 0.1, PP: 0.2, KO: 0.1, IC: 0.05},
       {MZ: 1, TY: 0.3, PO: 0.3, CF: 0.3}, 1.2, 0.5, "interior mixed evergreen forest: canyon live oak, madrone, bay and Douglas-fir"),
    _r("ponderosa_jeffrey", ["ponderosa", "jeffrey pine"], {PP: 0.9, LO: 0.1, KO: 0.1, IC: 0.06},
       {MZ: 0.9, CH: 0.1, CF: 0.05}, 0.8, 0.8, "Jeffrey pine is not in the library: pinus_ponderosa stands in", any_of=True),
    _r("dry_mesic_mixed_conifer", ["dry-mesic mixed conifer"], {PP: 0.5, LO: 0.1, KO: 0.2, IC: 0.15, DF: 0.08, CO: 0.03, MA: 0.02},
       {MZ: 1, TY: 0.05, PO: 0.1, CF: 0.1}, 1.0, 0.6, CONIFER),
    _r("mesic_mixed_conifer", ["mixed conifer"], {PP: 0.4, IC: 0.2, DF: 0.2, KO: 0.12, LO: 0.06, MA: 0.03, BA: 0.02},
       {MZ: 1, PO: 0.1, CF: 0.1}, 1.2, 0.4, CONIFER),
    _r("lower_montane_conifer", ["lower montane conifer"],
       {PP: 0.58, LO: 0.1, GP: 0.1, KO: 0.14, IC: 0.08, DF: 0.05, CO: 0.03, MA: 0.02, BA: 0.02},
       {MZ: 0.85, CH: 0.15, TY: 0.08, CF: 0.1, PO: 0.12, RB: 0.03}, 1.0, 0.6, CONIFER),
    _r("montane_woodland_chaparral", ["montane woodland and chaparral"],
       {LO: 0.3, PP: 0.25, GP: 0.15, CO: 0.15, KO: 0.1},
       {MZ: 0.8, CH: 0.2, TY: 0.1, CF: 0.1, RB: 0.05}, 0.6, 1.0),
    _r("serpentine_woodland", ["serpentine", "woodland"], {GP: 0.6, LO: 0.4, BU: 0.03},
       {MZ: 0.6, CH: 0.4, CF: 0.1, RB: 0.05, TY: 0.05}, 0.6, 1.0, "leather oak and McNab cypress are not in the library"),
    _r("xeric_chaparral", ["xeric", "chaparral"], {GP: 0.7, LO: 0.3},
       {CH: 0.8, MZ: 0.2, TY: 0.03, RB: 0.03}, 0.15, 1.0),
    _r("dry_mesic_chaparral", ["dry-mesic chaparral"], {GP: 0.6, LO: 0.4, CO: 0.05, BU: 0.03},
       {CH: 0.65, MZ: 0.35, TY: 0.1, CF: 0.08, RB: 0.05, PO: 0.04}, 0.3, 1.0),
    _r("mesic_chaparral", ["mesic", "chaparral"], {LO: 0.6, GP: 0.4, CO: 0.1, BA: 0.03, MA: 0.03},
       {MZ: 0.6, CH: 0.4, TY: 0.2, CF: 0.15, RB: 0.05, PO: 0.05}, 0.35, 1.0, "scrub oak and ceanothus are not in the library"),
    _r("chaparral", ["chaparral"], {GP: 0.6, LO: 0.4}, {CH: 0.6, MZ: 0.4, TY: 0.08, CF: 0.06, RB: 0.04}, 0.3, 1.0),
    _r("ruderal_forest", ["ruderal forest"], {LO: 0.4, BO: 0.25, GP: 0.2, PP: 0.15, VO: 0.05, KO: 0.05, BU: 0.03, WA: 0.03},
       {MZ: 0.5, CH: 0.5, CB: 0.3, PO: 0.3, TY: 0.08, EL: 0.05}, 0.8, 0.8,
       "disturbed regrowth of mixed composition: a generic foothill blend, with coyote brush and poison oak at the edges"),
    _r("ruderal_scrub", ["ruderal scrub"], {GP: 0.5, LO: 0.5}, {CH: 0.5, MZ: 0.5, CB: 0.6, PO: 0.2, TY: 0.05}, 0.2, 0.8,
       "disturbed scrub: coyote brush leads; broom and blackberry are not in the library"),
    _r("great_basin_shrub", ["greasewood", "sagebrush"], {GP: 1}, {CH: 1, CB: 0.3}, 0.0, 0.6,
       "Great Basin shrub type in the foothills (LANDFIRE edge case): chamise and coyote brush stand in", any_of=True),
    _r("grassland_savanna", ["grassland", "savanna", "prairie", "meadow"], {BO: 0.85, GP: 0.15, VO: 0.1, BU: 0.02},
       {CH: 1, CB: 0.6, PO: 0.1}, 1.0, 0.3, "sparse blue oak savanna over annual grass, valley oak in the swales", any_of=True),
    _r("sparse_rock", ["cliff", "canyon", "sparsely vegetated", "barren"], {GP: 0.5, LO: 0.5, CO: 0.4},
       {CH: 0.6, MZ: 0.4, RB: 0.2, TY: 0.1}, 0.25, 0.3, any_of=True),
]

# The understory shrubs (2026-10-29; Aaron: "more grass and shrub and herb species, especially for terrestrial
# animals"): their weights beside the rules' own, by community. Buckbrush, common manzanita, mountain mahogany,
# monkeyflower, chaparral currant and gooseberry in the chaparral and the dry oak woodland; deerbrush in the pine
# and black oak belt (TERRAIN lifts it above ~525 m); snowberry and wild rose in the oak understory and the riparian
# strips (snowberry north, rose on the floors); mountain mahogany and monkeyflower on the rock. The existing eight
# keep their weights, so their shares shrink in proportion where these are added.
_CHAP = {BB: 0.5, CM: 0.25, MM: 0.2, MF: 0.15, CR: 0.1, GB: 0.08, DB: 0.1}
_OAK = {BB: 0.3, CM: 0.1, MM: 0.1, MF: 0.12, SN: 0.15, WR: 0.08, GB: 0.08, CR: 0.05}
_PINE = {DB: 0.5, SN: 0.2, GB: 0.15, MM: 0.08, BB: 0.1, CM: 0.1}
_RIP = {WR: 0.6, SN: 0.3, GB: 0.05}
UNDERSTORY_SHRUBS = {
    "xeric_chaparral": {**_CHAP, BB: 0.6}, "dry_mesic_chaparral": _CHAP, "mesic_chaparral": {**_CHAP, DB: 0.3},
    "chaparral": _CHAP, "montane_woodland_chaparral": {**_CHAP, DB: 0.3}, "serpentine_woodland": {BB: 0.3, MM: 0.2, MF: 0.1},
    "blue_oak_foothill_pine": _OAK, "blue_oak": _OAK, "foothill_pine": {**_OAK, BB: 0.4}, "mixed_oak": _OAK,
    "mixed_oak_savanna": {**_OAK, BB: 0.2, SN: 0.08}, "mixed_evergreen": {**_PINE, SN: 0.3},
    "black_oak_conifer": _PINE, "black_oak": _PINE, "ponderosa_jeffrey": _PINE, "dry_mesic_mixed_conifer": _PINE,
    "mesic_mixed_conifer": {**_PINE, SN: 0.3}, "lower_montane_conifer": _PINE,
    "riparian": _RIP, "riparian_shrubland": _RIP, "montane_riparian": _RIP, "wet_meadow_marsh": {WR: 0.3},
    "grassland_savanna": {WR: 0.1, BB: 0.1, MF: 0.05, SN: 0.05},
    "ruderal_forest": {BB: 0.2, WR: 0.15, MF: 0.15, SN: 0.1}, "ruderal_scrub": {BB: 0.2, WR: 0.15, MF: 0.15},
    "sparse_rock": {MM: 0.5, MF: 0.3, BB: 0.2, CM: 0.1}, "great_basin_shrub": {BB: 0.3},
}
for _rule in RULES:
    for _k, _w in UNDERSTORY_SHRUBS.get(_rule["id"], {}).items():
        _rule["shrubs"].setdefault(_k, _w)

# Rewilded water beds (habitat.rewilded_cells): not LANDFIRE communities, so not matched by name.
# The corridor along the restored channel is a young riparian strip: willow dominant at the water, alder next,
# a few cottonwoods, ash, maple and walnut, live oak and valley oak where they climb the old bed's banks; no
# pine and no chaparral shrubs. The meadow keeps a few scattered oaks, valley oak among them (blue oak still
# leads, so the client's savanna rule, one oak per two treeless cells, holds).
REWILD_MEADOW = _r("rewilded_meadow", [], {BO: 0.55, VO: 0.35, LO: 0.1}, {}, 0.5, 0.0,
                   "former reservoir or stock-pond bed: wet meadow (sedge, rush, perennial grass) with scattered oaks",
                   fixed=[VO])
REWILD_RIPARIAN = _r("rewilded_riparian", [], {WI: 0.45, AL: 0.25, CW: 0.12, LO: 0.18, VO: 0.06, AS: 0.05, MP: 0.03, WA: 0.02},
                     {}, 2.0, 0.0, "riparian corridor along the restored channel through a former bed")

# Fallback when no keyword matches: the client's original fixed mix per habitat class (vegetation.js MIX).
HABITAT_DEFAULT = {
    1: ({BO: 0.55, LO: 0.25, GP: 0.2}, {MZ: 1}),
    2: ({PP: 0.7, GP: 0.12, LO: 0.18}, {MZ: 1}),
    3: ({PP: 0.3, LO: 0.3, BO: 0.2, GP: 0.2}, {MZ: 1}),
    4: ({GP: 1.0}, {CH: 0.6, MZ: 0.4}),
    5: ({BO: 0.85, GP: 0.15}, {CH: 1}),
    6: ({LO: 0.6, BO: 0.2, PP: 0.2}, {MZ: 1}),
}

# Terrain (2026-10-26). A rule's weights are the community; within it, where a species stands depends on
# the ground: each 30 m cell gets a terrain class from the DEM (terrain/dem.tif, 5 m, averaged to the cell),
# and a species' weight is multiplied by its factors for that class before the row is normalised:
#   band    effective elevation: the cell's mean elevation plus 100 m on north-facing ground and minus 50 m
#           on south-facing (cool slopes carry the vegetation of higher ground), in bands with edges
#           ELEV_BANDS: <450, 450-525, 525-600, >=600 m
#   pos     floor (mean slope under 6 degrees and the cell lower than its 330 m neighbourhood by 2 m or
#           more: valley floors, swales, benches by the creeks), steep (mean slope 16 degrees or more:
#           canyon walls and rocky slopes), else mid-slope
#   north   facing north (northness, cos(aspect) weighted by slope up to 10 degrees, 0.35 or more)
# TERRAIN[id] = (band factors x4, pos factors [floor, mid, steep], north factors [other, north]); a species
# not listed (and every species listed in a rule's `fixed`) is not changed. Cells of one source and code
# whose factors give the same bytes share a row, so a tile has a few rows per community, not one per class.
ELEV_BANDS = (450.0, 525.0, 600.0)
NORTH_LIFT, SOUTH_DROP, NORTH_MIN = 100.0, 50.0, 0.35
FLOOR_SLOPE, FLOOR_TPI, STEEP_SLOPE = 6.0, -2.0, 16.0
TERRAIN = {
    VO: ([1.0, 0.8, 0.45, 0.2], [2.5, 1.0, 0.15], [1.0, 0.8]),    # valley floors and lower slopes, below ~600 m
    CO: ([0.8, 1.0, 1.0, 1.0], [0.3, 0.8, 3.0], [0.7, 1.6]),      # canyon walls and rocky slopes, north-facing
    KO: ([0.1, 0.45, 0.85, 1.0], [0.8, 1.0, 0.8], [0.8, 1.3]),    # above ~500-600 m (lower on north slopes)
    BU: ([1.0, 1.0, 0.8, 0.5], [0.8, 1.0, 1.8], [1.0, 1.0]),      # oak woodland and canyon edges
    MA: ([0.4, 0.8, 1.0, 1.0], [0.6, 1.0, 1.3], [0.3, 2.2]),      # north slopes, canyons
    BA: ([0.8, 1.0, 1.0, 1.0], [1.5, 1.0, 1.4], [0.3, 2.2]),      # north slopes, canyon bottoms
    IC: ([0.04, 0.3, 0.75, 1.0], [1.3, 1.0, 0.8], [0.6, 1.6]),    # above ~550 m, canyons and north slopes
    DF: ([0.0, 0.15, 0.55, 1.0], [1.2, 1.0, 0.8], [0.12, 2.0]),   # north slopes above ~550 m
    TY: ([1.0, 1.0, 1.0, 1.0], [0.7, 1.0, 1.2], [1.0, 1.2]),
    RB: ([1.0, 1.0, 1.0, 1.0], [0.5, 1.0, 2.0], [1.1, 0.9]),      # rocky slopes and canyon sides
    PO: ([1.0, 1.0, 1.0, 1.0], [1.3, 1.0, 0.8], [0.9, 1.3]),
    CB: ([1.0, 1.0, 1.0, 0.8], [1.4, 1.0, 0.6], [1.0, 1.0]),      # flats and disturbed edges
    EL: ([1.0, 1.0, 1.0, 1.0], [1.5, 1.0, 0.5], [1.0, 1.0]),
    CF: ([1.0, 1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [0.9, 1.2]),
    # the understory shrubs (2026-10-29)
    CM: ([1.0, 1.0, 0.7, 0.4], [0.8, 1.0, 1.1], [1.0, 0.9]),      # the lower slopes
    BB: ([1.0, 1.0, 0.8, 0.5], [0.7, 1.0, 1.2], [1.1, 0.7]),      # dry south-facing slopes, below ~600 m
    DB: ([0.05, 0.4, 0.9, 1.0], [0.8, 1.0, 1.0], [0.8, 1.3]),     # the pine belt above ~525 m, cooler slopes
    MM: ([1.0, 1.0, 1.0, 1.0], [0.4, 1.0, 2.2], [1.0, 1.0]),      # rocky slopes and canyon walls
    MF: ([1.0, 1.0, 1.0, 0.8], [0.5, 1.0, 1.8], [1.0, 1.0]),      # rock, road cuts, canyon sides
    WR: ([1.0, 1.0, 1.0, 1.0], [2.0, 1.0, 0.3], [1.0, 1.1]),      # the floors, swales and seeps
    SN: ([1.0, 1.0, 1.0, 1.0], [1.3, 1.0, 0.8], [0.6, 1.8]),      # shade: north slopes and the floors
    GB: ([0.6, 1.0, 1.0, 1.0], [0.7, 1.0, 1.4], [1.0, 1.0]),      # rocky slopes, up through the pines
    CR: ([1.0, 1.0, 0.8, 0.6], [0.8, 1.0, 1.2], [1.0, 0.9]),
}
POS_NAMES, BAND_NAMES = ("floor", "mid-slope", "steep"), ("<450 m", "450-525 m", "525-600 m", ">=600 m")


def terrain_classes(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """Terrain class per vegetation cell: band * 6 + pos * 2 + north (0..23), see TERRAIN."""
    from scipy import ndimage
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        z = src.read(1).astype("float64")
        res = src.res[0]
    gy, gx = np.gradient(z, res)                  # gy: d/d(row), rows run south
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    north = gy / np.maximum(np.hypot(gx, gy), 1e-9) * np.minimum(1.0, slope / 10.0)   # downhill toward north: +1
    f = z.shape[0] / shape[0]
    rows_, cols_ = ((np.arange(shape[0]) + 0.5) * f).astype(int), ((np.arange(shape[1]) + 0.5) * f).astype(int)
    k = max(1, int(round(f)))
    cells = lambda a: ndimage.uniform_filter(a, k, mode="nearest")[np.ix_(rows_, cols_)]   # cell means (same bounds)
    E, S, N = cells(z), cells(slope), cells(north)
    tpi = E - ndimage.uniform_filter(E, 11, mode="nearest")
    eff = E + NORTH_LIFT * np.clip(N, 0, 1) - SOUTH_DROP * np.clip(-N, 0, 1)
    band = np.digitize(eff, ELEV_BANDS)
    pos = np.where((S < FLOOR_SLOPE) & (tpi <= FLOOR_TPI), 0, np.where(S >= STEEP_SLOPE, 2, 1))
    return (band * 6 + pos * 2 + (N >= NORTH_MIN)).astype("int64")


def terrain_label(t: int) -> str:
    return f"{BAND_NAMES[t // 6]} {POS_NAMES[(t // 2) % 3]}{' north' if t % 2 else ''}"


def terrain_weights(weights: dict, t: int, fixed=()) -> dict:
    band, pos, nf = t // 6, (t // 2) % 3, t % 2
    out = {}
    for k, w in weights.items():
        f = TERRAIN.get(k)
        out[k] = w if (f is None or k in fixed) else w * f[0][band] * f[1][pos] * f[2][nf]
    return out


# The ground layer (2026-10-29): the grasses and forbs (library/species records with form "grass" or "forb",
# docs/species-library.md "Grasses, herbs and shrubs of the foothill understory"). Unlike the trees and shrubs
# they are not weighted by hand per rule: each record's `habitat` block gives its weight per habitat class
# (`classes`, by class name) times its `ground.density` (forbs), and its floor / mid / steep / north factors are
# its own TERRAIN row; a rule may still add to or override them (GROUND_RULES, by rule id). The client's grass
# and forb layers draw each cell's grasses and forbs from the row's ground_bytes (the grasses' share and the
# forbs' share of it, by form). Cells without a row keep the client's own defaults.
GROUND_FORMS = ("grass", "forb")
GROUND_RULES = {
    "rewilded_meadow": {"danthonia_californica": 2.0, "elymus_glaucus": 1.5, "achillea_millefolium": 1.5},   # a wet meadow: the perennials
    "ruderal_forest": {"bromus_diandrus": 1.6, "hordeum_murinum": 1.6, "erodium_cicutarium": 1.4},
    "ruderal_scrub": {"bromus_diandrus": 1.6, "hordeum_murinum": 1.6, "amsinckia_menziesii": 1.5},
}


def ground_species() -> list[dict]:
    """The ground-layer records, in index.json order: id, form, habitat, density."""
    index = json.loads((LIBRARY / "index.json").read_text())
    out = []
    for sid in index.get("species", []):
        f = LIBRARY / f"{sid}.json"
        if sid.startswith("_") or not f.exists():
            continue
        d = json.loads(f.read_text())
        if d.get("form") not in GROUND_FORMS:
            continue
        out.append({"id": sid, "form": d["form"], "habitat": d.get("habitat") or {},
                    "density": float((d.get("ground") or {}).get("density", 1.0))})
    return out


def ground_weights(hab_code: int, rule_id: str, species: list[dict]) -> dict:
    """A community's ground weights: each species' habitat class weight x its density, plus the rule's own."""
    cls = CLASSES.get(hab_code)
    out = {}
    for sp in species:
        w = float((sp["habitat"].get("classes") or {}).get(cls, 0.0)) * sp["density"]
        w = GROUND_RULES.get(rule_id, {}).get(sp["id"], w)
        if w > 0:
            out[sp["id"]] = w
    return out


def ground_terrain(weights: dict, t: int, species: list[dict]) -> dict:
    """The terrain factors of the ground species (their own habitat.floor / mid / steep / north)."""
    pos, nf = (t // 2) % 3, t % 2
    by = {sp["id"]: sp["habitat"] for sp in species}
    out = {}
    for k, w in weights.items():
        h = by.get(k, {})
        f = [float(h.get("floor", 1.0)), float(h.get("mid", 1.0)), float(h.get("steep", 1.0))][pos]
        n = float(h.get("north", 1.0)) if nf else (2.0 - float(h.get("north", 1.0)) if float(h.get("north", 1.0)) < 1.0 else 1.0)
        out[k] = w * f * n
    return out


def match(name: str) -> dict | None:
    n = (name or "").lower()
    for rule in RULES:
        hit = any(k in n for k in rule["keywords"]) if rule["any"] else all(k in n for k in rule["keywords"])
        if hit:
            return rule
    return None


def _fallback(hab_code: int) -> dict:
    trees, shrubs = HABITAT_DEFAULT.get(hab_code, ({}, {}))
    d = 1.0 if hab_code in HABITAT_DEFAULT else 0.0
    return {"id": f"habitat_default_{CLASSES.get(hab_code, 'none')}", "trees": trees, "shrubs": shrubs,
            "tree_density": d, "shrub_density": d, "note": "no keyword rule matched: habitat-class default mix"}


def _bytes(weights: dict, slots: list[str]) -> list[int]:
    """Weights over slots as bytes summing to exactly 255 (largest remainder, ties to the earlier
    column), or all zero."""
    w = np.array([max(float(weights.get(s, 0)), 0.0) for s in slots])
    if w.sum() <= 0:
        return [0] * len(slots)
    x = w / w.sum() * 255
    b = np.floor(x).astype(int)
    for i in np.argsort(-(x - b), kind="stable")[: 255 - b.sum()]:
        b[i] += 1
    return [int(v) for v in b]


def columns(rules: list[dict]) -> tuple[list[str], list[str]]:
    """Tree and shrub columns: TREES / SHRUBS, then any other species the rules name, in order."""
    trees, shrubs = list(TREES), list(SHRUBS)
    for r in rules:
        for k in r["trees"]:
            if k not in trees:
                trees.append(k)
        for k in r["shrubs"]:
            if k not in shrubs:
                shrubs.append(k)
    for sid in trees + shrubs:
        if not (LIBRARY / f"{sid}.json").exists():
            warnings.warn(f"species mix names {sid}, which has no library/species/{sid}.json; the client skips it")
    return trees, shrubs


def _is_human(e: dict) -> bool:
    return (e.get("phys") or "").startswith(HUMAN_PHYS_PREFIXES) or e.get("habitat") == "human"


def species_mix(tile: Tile) -> dict:
    classes = json.loads(tile.path("vegetation/classes.json").read_text())
    evt_tab, bps_tab = classes.get("evt", {}), classes.get("bps", {})
    with rasterio.open(tile.path("vegetation/evt.tif")) as src:
        evt = src.read(1)
        res = src.res[0]
    with rasterio.open(tile.path("vegetation/bps.tif")) as src:
        bps = src.read(1)
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        hab = src.read(1)
    with rasterio.open(tile.path("vegetation/evc.tif")) as src:
        evc = src.read(1)
    tree_cover = np.where((evc >= 101) & (evc <= 199), evc - 100, 0).astype("float64")
    assert evt.shape == bps.shape == hab.shape, "vegetation rasters must share the 30 m grid"

    # Resolve each cell to a (source, code) row: EVT for natural cells, BpS for human ones,
    # habitat class when a code is missing from the tables.
    rows: dict[tuple, dict] = {}
    index = np.zeros(evt.shape, "int64")
    unmatched = []

    def row_for(source: str, code: int, name: str | None, hab_code: int, rule: dict | None = None) -> int:
        key = (source, code)
        if key not in rows:
            rule = rule or (match(name) if name else None)
            if rule is None:
                rule = _fallback(hab_code)
                unmatched.append({"source": source, "code": code, "name": name, "habitat": CLASSES.get(hab_code)})
            rows[key] = {"index": len(rows) + 1, "source": source, "code": code, "name": name, "rule": rule["id"],
                         "trees": {k: v for k, v in rule["trees"].items() if v},
                         "shrubs": {k: v for k, v in rule["shrubs"].items() if v},
                         "tree_density": rule["tree_density"], "shrub_density": rule["shrub_density"],
                         "note": rule.get("note"), "fixed": list(rule.get("fixed") or []), "cells": 0, "habitat": hab_code}
            if rows[key]["index"] > 65535:
                raise ValueError("more than 65535 distinct mixes; species_mix_index.png holds 16 bits")
        return rows[key]["index"]

    combos = np.unique(np.stack([evt.ravel(), bps.ravel(), hab.ravel()], 1), axis=0)
    for e_code, b_code, h_code in combos.tolist():
        e = evt_tab.get(str(e_code))
        if e and not _is_human(e):
            idx = row_for("evt", e_code, e.get("name"), h_code)
        else:
            b = bps_tab.get(str(b_code))
            if b and b.get("habitat") not in (None, "human"):
                idx = row_for("bps", b_code, b.get("name"), h_code)
            else:   # BpS human/unknown: grassland savanna, as habitat.py backfills
                idx = row_for("habitat", h_code, None, h_code if h_code != 9 else 5)
        index[(evt == e_code) & (bps == b_code) & (hab == h_code)] = idx

    # Former reservoir and stock-pond beds: their own rows, whatever EVT says (open water, mostly).
    with rasterio.open(tile.path("vegetation/habitat_present.tif")) as src:
        cells = rewilded_cells(tile, src.read(1))
    if cells is not None:
        for k, (sel, rule) in enumerate(zip(cells, (REWILD_MEADOW, REWILD_RIPARIAN))):
            if sel.any():
                index[sel] = row_for("rewild", k + 1, rule["id"].replace("_", " "), 5 if k == 0 else 6, rule)

    # Terrain (TERRAIN): each community row splits by the cells' terrain classes into the rows whose
    # weights differ; cells of one community and terrain response share a row.
    base_rows = sorted(rows.values(), key=lambda r: r["index"])
    trees_cols, shrub_cols = columns(base_rows)
    gspecies = ground_species()
    ground_cols = [sp["id"] for sp in gspecies]
    for b in base_rows:
        b["ground"] = ground_weights(b["habitat"], b["rule"], gspecies)
    nt, ns, ng = len(trees_cols), len(shrub_cols), len(ground_cols)
    tcls = terrain_classes(tile, index.shape)
    pair = index * 24 + tcls
    final: dict[tuple, dict] = {}
    out_index = np.zeros(index.shape, "int64")
    for code in np.unique(pair).tolist():
        b = base_rows[code // 24 - 1] if code >= 24 else None
        if b is None:
            continue
        t = code % 24
        tb = _bytes(terrain_weights(b["trees"], t, b["fixed"]), trees_cols)
        sb = _bytes(terrain_weights(b["shrubs"], t, b["fixed"]), shrub_cols)
        gb = _bytes(ground_terrain(b["ground"], t, gspecies), ground_cols)
        key = (b["source"], b["code"], tuple(tb), tuple(sb), tuple(gb))
        r = final.get(key)
        if r is None:
            r = final[key] = {"index": len(final) + 1, "source": b["source"], "code": b["code"], "name": b["name"],
                              "rule": b["rule"], "community": b["index"], "terrain": [], "cells": 0, "_tb": tb, "_sb": sb, "_gb": gb,
                              "tree_density": b["tree_density"], "shrub_density": b["shrub_density"]}
            if r["index"] > 65535:
                raise ValueError("more than 65535 distinct mixes; species_mix_index.png holds 16 bits")
        r["terrain"].append(terrain_label(t))
        out_index[pair == code] = r["index"]
    index = out_index
    table = sorted(final.values(), key=lambda r: r["index"])
    # Per-row bytes: tree weights over the tree columns, shrub weights over the shrub columns (each
    # summing to 255 or all zero), then the two density bytes. lut[0] (no mix) is all zero.
    lut = np.zeros((len(table) + 1, nt + ns + ng + 2), "int64")
    for r in table:
        tb, sb, gb = r.pop("_tb"), r.pop("_sb"), r.pop("_gb")
        td = min(round(r["tree_density"] * DENSITY_SCALE), 255)
        sd = min(round(r["shrub_density"] * DENSITY_SCALE), 255)
        lut[r["index"]] = tb + sb + gb + [td, sd]
        r["cells"] = int((index == r["index"]).sum())
        r["tree_bytes"] = [[k, b] for k, b in zip(trees_cols, tb) if b]
        r["shrub_bytes"] = [[k, b] for k, b in zip(shrub_cols, sb) if b]
        r["ground_bytes"] = [[k, b] for k, b in zip(ground_cols, gb) if b]
        r["density_bytes"] = [td, sd]
        del r["tree_density"], r["shrub_density"]
    # The communities as written (one per source and code, before the terrain factors), for people.
    communities = [{"community": b["index"], "source": b["source"], "code": b["code"], "name": b["name"], "rule": b["rule"],
                    "trees": b["trees"], "shrubs": b["shrubs"], "ground": {k: round(v, 3) for k, v in b["ground"].items()}, "tree_density": b["tree_density"],
                    "shrub_density": b["shrub_density"], "note": b["note"], "fixed": b["fixed"],
                    "cells": int(sum(r["cells"] for r in table if r["community"] == b["index"]))} for b in base_rows]
    px = lut[index]
    TD, SD = nt + ns + ng, nt + ns + ng + 1
    for old in ("species_mix_a.png", "species_mix_b.png", "species_mix_c.png"):   # format 1 products
        if tile.path(f"client/{old}").exists():
            tile.path(f"client/{old}").unlink()
    index_bytes = 1 if len(table) <= 255 else 2
    if index_bytes == 1:
        Image.fromarray(index.astype("uint8"), "L").save(tile.path("client/species_mix_index.png"), optimize=True)
    else:
        rgb = np.stack([index & 255, index >> 8, np.zeros_like(index)], -1).astype("uint8")
        Image.fromarray(rgb, "RGB").save(tile.path("client/species_mix_index.png"), optimize=True)
    dens = np.stack([px[..., TD], px[..., SD], np.zeros_like(px[..., TD])], -1).astype("uint8")
    Image.fromarray(dens, "RGB").save(tile.path("client/species_mix_density.png"), optimize=True)

    # Per-tile fractions
    n = index.size
    td = px[..., TD].astype("float64") / DENSITY_SCALE
    sd = px[..., SD].astype("float64") / DENSITY_SCALE

    def share(cols, names, weight):
        w = px[..., cols].astype("float64") / 255 * weight[..., None]
        tot = w.sum()
        return {SHORT.get(s, s): round(float(w[..., i].sum() / tot), 4) if tot else 0.0 for i, s in enumerate(names)}

    by_rule: dict[str, int] = {}
    for r in table:
        by_rule[r["rule"]] = by_rule.get(r["rule"], 0) + r["cells"]
    tcols, scols, gcols = list(range(nt)), list(range(nt, nt + ns)), list(range(nt + ns, nt + ns + ng))
    fractions = {
        "from_evt": round(sum(r["cells"] for r in table if r["source"] == "evt") / n, 4),
        "from_bps_backfill": round(sum(r["cells"] for r in table if r["source"] != "evt") / n, 4),
        "tree_share": share(tcols, trees_cols, td),
        "tree_share_by_canopy": share(tcols, trees_cols, td * tree_cover),
        "shrub_share": share(scols, shrub_cols, sd),
        "ground_share": share(gcols, ground_cols, np.ones_like(sd)),
        "mean_tree_density": round(float(td.mean()), 4),
        "mean_shrub_density": round(float(sd.mean()), 4),
        "rules": {k: round(v / n, 4) for k, v in sorted(by_rule.items(), key=lambda kv: -kv[1])},
    }
    doc = {
        "format": FORMAT,
        "grid": {"crs": tile.crs, "bounds": list(tile.bounds), "pixels": int(index.shape[0]), "resolution_m": res,
                 "origin": "row 0 = north edge, same grid as client/habitat.png"},
        "species": {"trees": trees_cols, "shrubs": shrub_cols, "ground": ground_cols},
        "cells": {
            "index": "client/species_mix_index.png", "index_bytes": index_bytes,
            "density": "client/species_mix_density.png",
        },
        "encoding": {
            "index": "species_mix_index.png: the cell's row in mixes (0 = no mix: the client's habitat-class mix). "
                     "8-bit grey; with index_bytes 2, RGB with the row = R + 256 G",
            "density": f"species_mix_density.png RGB: R tree_density, G shrub_density, multiplier = byte / {DENSITY_SCALE} "
                       "on the client's per-habitat-class plant count (1.0 = the fixed-mix count; the count still scales "
                       "with client/canopy.png cover); B unused. The same bytes as the row's density_bytes",
            "weights": "mixes[].tree_bytes and shrub_bytes: [[species id, byte], ...], the species with a non-zero weight "
                       "in the column order of `species`, each layer summing to 255 (absent: no trees or no shrubs). "
                       "The client draws a species by walking this list in order, so the order is part of the format",
            "ground": "mixes[].ground_bytes: [[species id, byte], ...] over species.ground (the grasses and forbs, "
                      "library records of form grass or forb), summing to 255; from each record's habitat block "
                      "(classes, floor / mid / steep / north) and ground.density, with GROUND_RULES per rule. The "
                      "client's grass layer draws a cell's grasses from the grasses' share of it and the forb layer "
                      "its forbs from the forbs' share",
            "terrain": "mixes[].terrain: the terrain classes (effective elevation band, floor / mid-slope / steep, north) "
                       "whose cells use the row; a community (communities[], one per source and code: its name, the "
                       "weights and densities as written, and a note) has one row per distinct terrain response "
                       "(pipeline species_mix.py TERRAIN), and mixes[].community names it. The bytes are after the "
                       "terrain factors",
        },
        "mixes": table,
        "communities": communities,
        "unmatched": unmatched,
        "fractions": fractions,
    }
    # One row (and one community) per line: several hundred rows indented one value per line ran to 600 KB.
    text = json.dumps({**doc, "mixes": "@MIXES@", "communities": "@COMMUNITIES@"}, indent=1)
    for k, rows_ in (("@MIXES@", table), ("@COMMUNITIES@", communities)):
        text = text.replace(f'"{k}"', "[\n" + ",\n".join("  " + json.dumps(r, separators=(",", ":")) for r in rows_) + "\n ]")
    tile.path("client/species_mix.json").write_text(text)
    files = ["client/species_mix_index.png", "client/species_mix_density.png"]
    return {"path": "client/species_mix.json", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": int(index.shape[0]), "resolution_m": res, "format": FORMAT,
            "files": {f: {"sha256": sha256(tile.path(f)), "bytes": tile.path(f).stat().st_size} for f in files},
            "derived_from": ["vegetation.evt", "vegetation.bps", "vegetation.classes", "vegetation.habitat", "vegetation.evc",
                             "terrain.dem"],
            "encoding": "format 2: species_mix_index L = row in mixes; species_mix_density RGB = tree_density, shrub_density "
                        "(byte/100); per-row weights as mixes[].tree_bytes / shrub_bytes over species.trees / species.shrubs",
            "species": {"trees": trees_cols, "shrubs": shrub_cols, "ground": ground_cols},
            "mixes": len(table), "unmatched": len(unmatched), "fractions": fractions}
