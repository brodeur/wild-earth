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
import math
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
         "calocedrus_decurrens", "pseudotsuga_menziesii",
         # the riparian set (2026-10-29, pipeline/water.py): red willow, Pacific willow, California sycamore
         "salix_laevigata", "salix_lasiandra", "platanus_racemosa"]
SHRUBS = ["arctostaphylos_viscida", "adenostoma_fasciculatum",
          "heteromeles_arbutifolia", "cercis_occidentalis", "toxicodendron_diversilobum", "baccharis_pilularis",
          "sambucus_nigra_caerulea", "frangula_californica",
          # the understory set (2026-10-29): common manzanita, buckbrush, deerbrush, mountain mahogany, sticky
          # monkeyflower, California wild rose, snowberry, Sierra gooseberry, chaparral currant
          "arctostaphylos_manzanita", "ceanothus_cuneatus", "ceanothus_integerrimus", "cercocarpus_betuloides",
          "diplacus_aurantiacus", "rosa_californica", "symphoricarpos_albus", "ribes_roezlii", "ribes_malvaceum",
          # the riparian set (2026-10-29): sandbar willow, button willow, creek dogwood, California blackberry, wild grape, spicebush
          "salix_exigua", "cephalanthus_occidentalis", "cornus_sericea", "rubus_ursinus", "vitis_californica", "calycanthus_occidentalis"]
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
         "symphoricarpos_albus": "snowberry", "ribes_roezlii": "gooseberry", "ribes_malvaceum": "currant",
         "salix_laevigata": "red_willow", "salix_lasiandra": "pacific_willow", "platanus_racemosa": "sycamore",
         "salix_exigua": "sandbar_willow", "cephalanthus_occidentalis": "button_willow", "cornus_sericea": "creek_dogwood",
         "rubus_ursinus": "blackberry", "vitis_californica": "wild_grape", "calycanthus_occidentalis": "spicebush"}
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
RW, PW, SY = "salix_laevigata", "salix_lasiandra", "platanus_racemosa"
SW, BW, CD, BK, GR, SP = ("salix_exigua", "cephalanthus_occidentalis", "cornus_sericea", "rubus_ursinus", "vitis_californica",
                          "calycanthus_occidentalis")
CM, BB, DB, MM, MF, WR, SN, GB, CR = ("arctostaphylos_manzanita", "ceanothus_cuneatus", "ceanothus_integerrimus",
                                      "cercocarpus_betuloides", "diplacus_aurantiacus", "rosa_californica",
                                      "symphoricarpos_albus", "ribes_roezlii", "ribes_malvaceum")

# The high Sierra set (2026-11-04, the species registry; library/plant_cards/, grown by pipeline/plantgen.py)
RF, WF, LP, JP, SG = "abies_magnifica", "abies_concolor", "pinus_contorta", "pinus_jeffreyi", "pinus_lambertiana"
WB, WWP, MH, SJ, QAS = "pinus_albicaulis", "pinus_monticola", "tsuga_mertensiana", "juniperus_grandis", "populus_tremuloides"
GS, CLM = "sequoiadendron_giganteum", "cercocarpus_ledifolius"
GM, HO, MW, BC, MMI, RMH, BS = ("arctostaphylos_patula", "quercus_vacciniifolia", "ceanothus_cordulatus", "chrysolepis_sempervirens",
                                "chamaebatia_foliolosa", "phyllodoce_breweri", "artemisia_tridentata")
# The coastal set (2026-11-04)
RDW, QA, TO, MTP, MC = "sequoia_sempervirens", "quercus_agrifolia", "notholithocarpus_densiflorus", "pinus_radiata", "hesperocyparis_macrocarpa"
CS, YBL, HB, SAL, MKH = "artemisia_californica", "lupinus_arboreus", "vaccinium_ovatum", "gaultheria_shallon", "ericameria_ericoides"

CONIFER = "sugar pine and white fir in the mixed conifer from 2026-11-04 (before: pinus_ponderosa stood in for both)"
UNDERSTORY = ("the riparian understory: elderberry, poison oak, blackberry, wild grape, dogwood and spicebush (the riparian "
              "set of 2026-10-29), with a little manzanita; the zone mixes (riparian_rows) place the bank and margin species")


def _r(rid, kws, trees, shrubs, td, sd, note=None, any_of=False, fixed=(), region="california"):
    """fixed: species whose weight the terrain (TERRAIN) does not change in this rule (the community is
    named for them, so LANDFIRE has already put them there). region: the natural region the rule was written for
    (pipeline/regions.py NATURAL); a tile elsewhere never matches it (2026-11-04: every rule written before is
    California's; None for the few that hold anywhere: open water, snow and ice)."""
    return {"id": rid, "keywords": kws, "any": any_of, "trees": trees, "shrubs": shrubs,
            "tree_density": td, "shrub_density": sd, "note": note, "fixed": list(fixed), "region": region}


# The Pacific Northwest (2026-11-04, for the Olympic tiles; library/plant_cards/): ids, the stand-ins until their records
# exist being in communities.STAND_IN.
PSI, TH, TP, ABAM, ABL = "picea_sitchensis", "tsuga_heterophylla", "thuja_plicata", "abies_amabilis", "abies_lasiocarpa"
AR, PT, AC = "alnus_rubra", "populus_trichocarpa", "acer_circinatum"
RUS, VP, OH, MN, TB, PE, CAS = ("rubus_spectabilis", "vaccinium_parvifolium", "oplopanax_horridus", "mahonia_nervosa",
                                "rubus_parviflorus", "phyllodoce_empetriformis", "cassiope_mertensiana")
_PNW = "pacific_northwest"
PNW_RULES = [
    _r("pnw_sitka_spruce", ["sitka spruce"], {PSI: 0.55, "tsuga_heterophylla": 0.25, TP: 0.08, AR: 0.06, "acer_macrophyllum": 0.06},
       {RUS: 0.5, VP: 0.4, "gaultheria_shallon": 0.4, OH: 0.2, MN: 0.2, AC: 0.3}, 1.4, 0.6,
       "the temperate rain forest of the outer valleys: Sitka spruce and western hemlock, bigleaf maple in moss",
       fixed=[PSI], region=_PNW),
    _r("pnw_redcedar_hemlock", ["red-cedar"], {TP: 0.45, TH: 0.45, PSI: 0.1, ABAM: 0.05},
       {"gaultheria_shallon": 0.6, VP: 0.4, "vaccinium_ovatum": 0.3, MN: 0.2}, 1.4, 0.6, fixed=[TP], region=_PNW),
    _r("pnw_silver_fir", ["silver fir"], {ABAM: 0.5, TH: 0.35, "pseudotsuga_menziesii": 0.08, TP: 0.05},
       {VP: 0.4, MN: 0.3, OH: 0.1, AC: 0.1}, 1.3, 0.5, "Pacific silver fir and western hemlock above the valley floors",
       fixed=[ABAM], region=_PNW),
    _r("pnw_douglas_fir_hemlock", ["douglas-fir-western hemlock"], {"pseudotsuga_menziesii": 0.45, TH: 0.35, TP: 0.12,
                                                                     "acer_macrophyllum": 0.05, AR: 0.04},
       {"gaultheria_shallon": 0.5, MN: 0.5, AC: 0.4, VP: 0.3, RUS: 0.2}, 1.3, 0.6, region=_PNW),
    _r("pnw_mountain_hemlock", ["mountain hemlock"], {"tsuga_mertensiana": 0.6, ABAM: 0.2, ABL: 0.15},
       {PE: 0.3, CAS: 0.2, VP: 0.2}, 1.1, 0.4, fixed=["tsuga_mertensiana"], region=_PNW),
    _r("pnw_subalpine_parkland", ["subalpine parkland"], {ABL: 0.5, "tsuga_mertensiana": 0.4, "pinus_albicaulis": 0.05},
       {PE: 0.5, CAS: 0.4, VP: 0.1}, 0.4, 0.5, "subalpine fir and mountain hemlock in clumps among heather meadows", region=_PNW),
    _r("pnw_alpine", ["alpine dwarf-shrubland", "alpine fell-field", "alpine and subalpine dry grassland", "montane grassland"],
       {ABL: 1.0}, {PE: 0.6, CAS: 0.6}, 0.02, 0.5, "heath and fell-field above the trees", any_of=True, region=_PNW),
    _r("pnw_bedrock", ["bedrock and scree", "massive bedrock", "volcanic rock"], {ABL: 0.5, "tsuga_mertensiana": 0.5},
       {PE: 0.5, CAS: 0.5}, 0.03, 0.1, "rock and scree", any_of=True, region=_PNW),
    _r("pnw_lowland_riparian", ["lowland riparian", "hardwood-conifer swamp", "shrub swamp"],
       {AR: 0.45, PT: 0.25, "acer_macrophyllum": 0.12, PSI: 0.1, TP: 0.08},
       {RUS: 0.6, OH: 0.3, "cornus_sericea": 0.3, "salix_lasiandra": 0.2, "symphoricarpos_albus": 0.1}, 1.4, 0.6,
       "red alder and black cottonwood on the river bars", any_of=True, region=_PNW),
    _r("pnw_montane_riparian", ["north pacific montane riparian"], {AR: 0.4, TH: 0.2, PT: 0.2, ABAM: 0.1, "acer_macrophyllum": 0.1},
       {RUS: 0.5, OH: 0.4, AC: 0.3}, 1.2, 0.6, region=_PNW),
    _r("pnw_avalanche_shrub", ["avalanche chute", "montane shrubland", "broadleaf landslide"], {AR: 0.6, ABL: 0.4},
       {AC: 0.6, RUS: 0.4, VP: 0.2, TB: 0.2}, 0.15, 1.0, "vine maple, slide alder and salmonberry in the chutes", any_of=True, region=_PNW),
    _r("pnw_lowland_mixed", ["lowland mixed hardwood-conifer", "seasonal sitka"], {TH: 0.3, "pseudotsuga_menziesii": 0.3, AR: 0.2,
                                                                                  "acer_macrophyllum": 0.1, TP: 0.1},
       {"gaultheria_shallon": 0.5, RUS: 0.3, MN: 0.3, AC: 0.2}, 1.2, 0.6, any_of=True, region=_PNW),
]


# Ordered: the first rule whose keywords all appear in the lower-cased name wins
# (any_of=True: any one keyword). Specific before general. Weights are relative within a layer (they are
# normalised per cell after the terrain factors). The nine original species keep their weights from
# before the foothill set; the new species are added beside them (a minority, but for black oak in the
# black-oak communities), so the original species' shares shrink in proportion. Where a species stood
# in for one now in the library (blue oak for valley oak, live oak for black oak, live oak and ponderosa
# for canyon live oak, madrone and Douglas-fir) the stand-in gives up that share.
RULES = [
    _r("open_water", ["open water"], {}, {}, 0.0, 0.0, region=None),
    _r("snow_ice", ["glacier and ice field", "snow-ice", "ice field", "snow and ice"], {}, {}, 0.0, 0.0,
       "permanent snow and ice: bare", any_of=True, region=None),
    # --- the high Sierra (2026-11-04): the communities LANDFIRE names on the Yosemite tiles, which matched no rule and
    # fell to the habitat defaults (foothill oaks and gray pine at 2,500 m). The named species are `fixed` (LANDFIRE has
    # put them there); the others follow the elevation zones (ZONE_SUBST) and TERRAIN.
    _r("red_fir", ["red fir"], {RF: 0.75, WF: 0.1, JP: 0.06, LP: 0.08, WWP: 0.04},
       {GM: 0.5, MW: 0.4, BC: 0.3, HO: 0.15, GB: 0.1}, 1.2, 0.3, "dense red fir with white fir below and lodgepole and "
       "western white pine above; greenleaf manzanita, mountain whitethorn and bush chinquapin in the gaps", fixed=[RF]),
    _r("subalpine_lodgepole", ["lodgepole"], {LP: 0.85, RF: 0.05, WWP: 0.04, MH: 0.04, WB: 0.02},
       {GM: 0.2, RMH: 0.3, MW: 0.2, BS: 0.08}, 1.0, 0.25, "lodgepole forest round the meadows and on the granite benches", fixed=[LP]),
    _r("mesic_subalpine", ["mesic subalpine"], {MH: 0.45, WB: 0.15, LP: 0.2, WWP: 0.15, RF: 0.05},
       {RMH: 0.5, GM: 0.2, HO: 0.2}, 0.8, 0.3, "mountain hemlock on the cool, snowy north slopes, whitebark on the ridges", fixed=[MH]),
    _r("subalpine_woodland", ["subalpine woodland"], {WB: 0.4, MH: 0.2, LP: 0.25, WWP: 0.1, SJ: 0.05},
       {RMH: 0.5, GM: 0.2, HO: 0.2, BS: 0.1}, 0.6, 0.3, "open whitebark and lodgepole near treeline, krummholz above"),
    _r("subalpine_meadow", ["subalpine meadow", "subalpine-montane wet meadow"], {LP: 1.0}, {RMH: 0.3, SN: 0.1}, 0.05, 0.1,
       "a sedge and grass meadow; lodgepole only at its edges", any_of=True),
    _r("alpine_dwarf_shrub", ["alpine dwarf-shrubland"], {WB: 1.0}, {RMH: 1.0, BS: 0.1}, 0.02, 0.6,
       "red mountain heather mats among the rocks; a whitebark krummholz here and there"),
    _r("alpine", ["alpine"], {WB: 1.0}, {RMH: 1.0}, 0.02, 0.08, "bedrock, scree and dry tundra above treeline"),
    _r("aspen", ["aspen"], {QAS: 0.85, LP: 0.08, WF: 0.04, JP: 0.03}, {SN: 0.3, WR: 0.2, MW: 0.2}, 1.2, 0.4,
       "a quaking aspen clone on a moist bench or by a meadow", fixed=[QAS]),
    _r("curl_leaf_mahogany", ["curl-leaf mountain mahogany"], {CLM: 0.8, SJ: 0.2, JP: 0.1}, {BS: 0.6, GM: 0.2}, 0.5, 0.6,
       "curl-leaf mountain mahogany on dry rock with Sierra juniper", fixed=[CLM]),
    _r("jeffrey_pine", ["jeffrey pine"], {JP: 0.7, PP: 0.15, WF: 0.06, SJ: 0.05, IC: 0.04, KO: 0.04},
       {GM: 0.6, MW: 0.3, HO: 0.3, BS: 0.1, BB: 0.1}, 0.7, 0.7, "open Jeffrey pine on granite and the east side; ponderosa "
       "below about 1,800 m", fixed=[JP]),
    # --- the coast (2026-11-04): the San Francisco cells' communities, which fell to the foothill rules (gray pine 47-63 %)
    _r("redwood", ["redwood"], {RDW: 0.7, DF: 0.12, TO: 0.08, BA: 0.06, MA: 0.02, QA: 0.02, MP: 0.02, AL: 0.02},
       {HB: 0.5, SAL: 0.4, CF: 0.2, PO: 0.2, BK: 0.2, TY: 0.05}, 1.4, 0.5, "coast redwood in the fog-belt ravines with "
       "Douglas-fir, tanoak and bay; huckleberry and salal under them", fixed=[RDW]),
    _r("closed_cone", ["closed-cone"], {MTP: 0.5, MC: 0.4, QA: 0.1}, {CB: 0.5, CS: 0.2, HB: 0.3, SAL: 0.2, PO: 0.1}, 0.9, 0.6,
       "Monterey pine and Monterey cypress on the sandy headlands (planted near San Francisco; native at Ano Nuevo and Carmel)"),
    _r("coastal_dune", ["coastal dune"], {MC: 0.5, MTP: 0.5}, {MKH: 0.6, YBL: 0.6, CS: 0.3, CB: 0.3}, 0.02, 0.5,
       "the dunes: mock heather, yellow bush lupine and sagebrush; almost no trees"),
    _r("coast_live_oak", ["coast", "live oak"], {QA: 0.85, BA: 0.08, BU: 0.05, VO: 0.04, MA: 0.02},
       {TY: 0.4, PO: 0.6, CB: 0.4, CF: 0.3, HB: 0.1, EL: 0.1, SN: 0.2}, 1.0, 0.5,
       "coast live oak woodland and savanna, bay in the draws", fixed=[QA]),
    _r("coastal_scrub", ["coastal scrub"], {QA: 0.75, BA: 0.15, BU: 0.1},
       {CB: 1.0, CS: 0.6, MF: 0.5, PO: 0.4, CF: 0.25, YBL: 0.25, TY: 0.1, EL: 0.05}, 0.08, 1.0,
       "soft coastal scrub: coyote brush, California sagebrush and sticky monkeyflower; a coast live oak in a ravine"),
    _r("coastal_grassland", ["coastal grassland"], {QA: 1.0}, {CB: 0.8, YBL: 0.3, CS: 0.2}, 0.05, 0.15,
       "coastal prairie: perennial bunchgrass with a few coyote brush and lupine"),
    _r("maritime_chaparral", ["maritime chaparral"], {QA: 0.7, MTP: 0.3}, {CM: 0.5, CH: 0.4, BB: 0.3, TY: 0.2, CB: 0.2, HB: 0.1},
       0.15, 1.0, "maritime chaparral of manzanita and ceanothus on the sandstone ridges"),
    _r("wet_meadow_marsh", ["marsh", "wet meadow"], {WI: 0.8, LO: 0.2, VO: 0.1}, {MZ: 0.5, EL: 0.25, CB: 0.25},
       0.05, 0.05, "herbaceous wetland: almost no woody plants, a few willows and a valley oak at the edge", any_of=True),
    # Riparian: arroyo willow thickets at the water, white alder rooted in the bank, Fremont cottonwood on the
    # floodplain, Oregon ash, black walnut and big-leaf maple beside them; valley oak and interior live oak up
    # the banks; elderberry and poison oak in the understory.
    _r("riparian_shrubland", ["riparian", "shrubland"], {WI: 0.65, RW: 0.1, AL: 0.1, LO: 0.15, AS: 0.05},
       {MZ: 0.5, CH: 0.5, EL: 0.45, PO: 0.45, CF: 0.1, SW: 0.5, BK: 0.3, BW: 0.1}, 1.2, 0.2, "willow scrub: arroyo willow is the shrubland; " + UNDERSTORY),
    _r("montane_riparian", ["montane riparian systems"],
       {AL: 0.4, WI: 0.22, PW: 0.05, LO: 0.15, PP: 0.12, CW: 0.08, MP: 0.12, AS: 0.06, WA: 0.02, BA: 0.04, IC: 0.05, DF: 0.04},
       {MZ: 1, EL: 0.5, PO: 0.6, CD: 0.3, BK: 0.3, SP: 0.2}, 1.3, 0.3, "alder-willow streamside forest with maple, ash, bay and some conifers; " + UNDERSTORY),
    _r("riparian", ["riparian"],
       {WI: 0.32, RW: 0.08, AL: 0.22, CW: 0.1, SY: 0.05, LO: 0.15, BO: 0.03, VO: 0.12, WA: 0.06, MP: 0.05, AS: 0.07, BA: 0.03, BU: 0.02},
       {MZ: 0.3, EL: 0.5, PO: 0.7, CF: 0.1, CB: 0.1, BK: 0.5, GR: 0.3, CD: 0.2, SW: 0.2, BW: 0.1, SP: 0.1}, 1.6, 0.3, UNDERSTORY),
    _r("blue_oak_foothill_pine", ["blue oak", "foothill pine"],
       {BO: 0.65, LO: 0.1, GP: 0.25, VO: 0.07, BU: 0.04, CO: 0.02, KO: 0.01},
       {MZ: 0.5, CH: 0.5, PO: 0.3, TY: 0.12, CF: 0.1, RB: 0.05, CB: 0.08}, 1.0, 0.5),
    _r("blue_oak", ["blue oak"], {BO: 0.85, LO: 0.1, GP: 0.05, VO: 0.06, BU: 0.05, CO: 0.02},
       {MZ: 0.4, CH: 0.6, PO: 0.3, TY: 0.1, CF: 0.08, RB: 0.04, CB: 0.06}, 1.0, 0.4),
    _r("foothill_pine", ["foothill pine"], {GP: 0.6, BO: 0.25, LO: 0.15, BU: 0.04, CO: 0.03},
       {MZ: 0.4, CH: 0.6, TY: 0.12, CF: 0.1, RB: 0.06, PO: 0.15}, 0.9, 1.0),
    _r("black_oak_conifer", ["black oak", "conifer"],
       {KO: 0.45, PP: 0.4, LO: 0.12, GP: 0.02, IC: 0.12, DF: 0.08, MA: 0.04, CO: 0.03, SG: 0.05, WF: 0.04},
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
    _r("dry_mesic_mixed_conifer", ["dry-mesic mixed conifer"], {PP: 0.5, LO: 0.1, KO: 0.2, IC: 0.15, DF: 0.08, CO: 0.03, MA: 0.02,
                                                                WF: 0.1, SG: 0.12},
       {MZ: 1, TY: 0.05, PO: 0.1, CF: 0.1}, 1.0, 0.6, CONIFER),
    _r("mesic_mixed_conifer", ["mixed conifer"], {PP: 0.32, IC: 0.18, DF: 0.15, KO: 0.1, LO: 0.05, MA: 0.03, BA: 0.02,
                                                     WF: 0.25, SG: 0.15},
       {MZ: 1, PO: 0.1, CF: 0.1}, 1.2, 0.4, CONIFER),
    _r("lower_montane_conifer", ["lower montane conifer"],
       {PP: 0.58, LO: 0.1, GP: 0.1, KO: 0.14, IC: 0.08, DF: 0.05, CO: 0.03, MA: 0.02, BA: 0.02, SG: 0.06, WF: 0.04},
       {MZ: 0.85, CH: 0.15, TY: 0.08, CF: 0.1, PO: 0.12, RB: 0.03}, 1.0, 0.6, CONIFER),
    _r("montane_woodland_chaparral", ["montane woodland and chaparral"],
       {LO: 0.3, PP: 0.25, GP: 0.15, CO: 0.15, KO: 0.1},
       {MZ: 0.8, CH: 0.2, TY: 0.1, CF: 0.1, RB: 0.05, HO: 0.5, GM: 0.4, MW: 0.3, BC: 0.2}, 0.6, 1.0,
       "canyon live oak and chaparral on the canyon walls; at Yosemite's elevations huckleberry oak, greenleaf manzanita, "
       "mountain whitethorn and bush chinquapin (TERRAIN keeps them off the foothill tiles)"),
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

RULES[2:2] = PNW_RULES   # the North Pacific rules before the California ones (regions keep them apart anyway)

# The understory shrubs (2026-10-29; Aaron: "more grass and shrub and herb species, especially for terrestrial
# animals"): their weights beside the rules' own, by community. Buckbrush, common manzanita, mountain mahogany,
# monkeyflower, chaparral currant and gooseberry in the chaparral and the dry oak woodland; deerbrush in the pine
# and black oak belt (TERRAIN lifts it above ~525 m); snowberry and wild rose in the oak understory and the riparian
# strips (snowberry north, rose on the floors); mountain mahogany and monkeyflower on the rock. The existing eight
# keep their weights, so their shares shrink in proportion where these are added.
_CHAP = {BB: 0.5, CM: 0.25, MM: 0.2, MF: 0.15, CR: 0.1, GB: 0.08, DB: 0.1}
_OAK = {BB: 0.3, CM: 0.1, MM: 0.1, MF: 0.12, SN: 0.15, WR: 0.08, GB: 0.08, CR: 0.05}
_PINE = {DB: 0.5, SN: 0.2, GB: 0.15, MM: 0.08, BB: 0.1, CM: 0.1, MMI: 0.4, GM: 0.2, MW: 0.15, BC: 0.1}
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
REWILD_RIPARIAN = _r("rewilded_riparian", [], {WI: 0.4, RW: 0.06, AL: 0.25, CW: 0.12, LO: 0.18, VO: 0.06, AS: 0.05, MP: 0.03, WA: 0.02},
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
# 2026-11-04: four more bands for the mountains (lower montane 1,100-1,800 m, upper montane 1,800-2,400, subalpine
# 2,400-3,000, alpine above): a factor list of four is read with its last value repeated, so the foothill species and
# the foothill tiles (all below 1,100 m) are as before.
ELEV_BANDS = (450.0, 525.0, 600.0, 1100.0, 1800.0, 2400.0, 3000.0)
NB = len(ELEV_BANDS) + 1
NTC = NB * 6            # terrain classes; a grove cell (LOCALIZED) adds NTC
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
    # the riparian set (2026-10-29): the floors and swales, nothing on the steep ground
    RW: ([1.0, 1.0, 0.9, 0.7], [2.5, 1.0, 0.1], [1.0, 1.0]), PW: ([1.0, 1.0, 1.0, 1.0], [2.5, 1.0, 0.1], [1.0, 1.0]),
    SY: ([1.0, 0.9, 0.5, 0.2], [3.0, 1.0, 0.05], [1.0, 0.9]), SW: ([1.0, 1.0, 0.8, 0.5], [3.0, 1.0, 0.05], [1.0, 1.0]),
    BW: ([1.0, 1.0, 0.6, 0.3], [3.0, 1.0, 0.05], [1.0, 1.0]), CD: ([1.0, 1.0, 1.0, 1.0], [2.5, 1.0, 0.1], [1.0, 1.2]),
    BK: ([1.0, 1.0, 1.0, 1.0], [2.0, 1.0, 0.2], [1.0, 1.1]), GR: ([1.0, 1.0, 0.8, 0.6], [2.5, 1.0, 0.1], [1.0, 1.0]),
    SP: ([1.0, 1.0, 1.0, 0.8], [2.5, 1.0, 0.1], [0.7, 1.6]),
}
POS_NAMES = ("floor", "mid-slope", "steep")
BAND_NAMES = ("<450 m", "450-525 m", "525-600 m", "600-1100 m", "1100-1800 m", "1800-2400 m", "2400-3000 m", ">=3000 m")

# the new species' terrain (8 bands)
TERRAIN.update({
    WF: ([0, 0, 0, 0.25, 0.9, 1.0, 0.3, 0], [1.0, 1.0, 0.9], [0.8, 1.4]), SG: ([0, 0, 0.1, 0.5, 1.0, 0.7, 0.1, 0], [1.1, 1.0, 0.7], [0.9, 1.2]),
    RF: ([0, 0, 0, 0, 0.2, 1.0, 0.8, 0], [1.0, 1.0, 0.8], [0.8, 1.3]), JP: ([0, 0, 0, 0.05, 0.5, 1.0, 0.6, 0.1], [0.8, 1.0, 1.3], [1.2, 0.7]),
    LP: ([0, 0, 0, 0, 0.2, 0.8, 1.0, 0.3], [2.0, 1.0, 0.5], [1.0, 1.0]), WB: ([0, 0, 0, 0, 0, 0.1, 0.8, 1.0], [0.6, 1.0, 1.4], [1.0, 1.0]),
    MH: ([0, 0, 0, 0, 0, 0.4, 1.0, 0.5], [1.0, 1.0, 0.8], [0.6, 1.8]), WWP: ([0, 0, 0, 0, 0.2, 0.8, 1.0, 0.2], [1.0, 1.0, 1.0], [1.0, 1.0]),
    SJ: ([0, 0, 0, 0, 0.4, 1.0, 1.0, 0.2], [0.3, 1.0, 2.5], [1.2, 0.8]), QAS: ([0, 0, 0, 0.05, 0.6, 1.0, 0.8, 0], [2.0, 1.0, 0.3], [1.0, 1.1]),
    GS: ([0, 0, 0, 0.6, 1.0, 0.4, 0, 0], [1.4, 1.0, 0.6], [0.9, 1.2]), CLM: ([0, 0, 0, 0, 0.5, 1.0, 0.8, 0.1], [0.3, 1.0, 2.5], [1.2, 0.8]),
    GM: ([0, 0, 0, 0.2, 0.8, 1.0, 0.6, 0], [0.8, 1.0, 1.2], [1.1, 0.9]), HO: ([0, 0, 0, 0.2, 0.9, 1.0, 0.5, 0], [0.5, 1.0, 1.8], [1.1, 0.9]),
    MW: ([0, 0, 0, 0.1, 0.7, 1.0, 0.6, 0], [0.8, 1.0, 1.1], [1.0, 1.0]), BC: ([0, 0, 0, 0.1, 0.6, 1.0, 0.8, 0], [0.8, 1.0, 1.3], [0.8, 1.3]),
    RMH: ([0, 0, 0, 0, 0, 0.3, 1.0, 1.0], [1.2, 1.0, 0.8], [0.9, 1.2]), BS: ([0, 0, 0, 0, 0.3, 0.8, 1.0, 0.5], [1.2, 1.0, 0.7], [1.2, 0.8]),
    MMI: ([0, 0, 0.1, 0.6, 1.0, 0.3, 0, 0], [1.0, 1.0, 0.7], [1.1, 0.9]),
    QA: ([1, 1, 1, 0.6, 0.1, 0, 0, 0], [1.3, 1.0, 0.8], [0.9, 1.2]), RDW: ([1, 1, 1, 0.5, 0, 0, 0, 0], [1.6, 1.0, 0.6], [0.7, 1.6]),
    TO: ([1, 1, 1, 0.8, 0.3, 0, 0, 0], [1.1, 1.0, 0.9], [0.8, 1.4]), MTP: ([1, 1, 0.8, 0.3, 0, 0, 0, 0], [1.0, 1.0, 0.9], [1.0, 1.0]),
    MC: ([1, 0.8, 0.5, 0.1, 0, 0, 0, 0], [1.0, 1.0, 1.0], [1.1, 0.9]), CS: ([1, 1, 0.8, 0.4, 0, 0, 0, 0], [0.8, 1.0, 1.2], [1.2, 0.8]),
    YBL: ([1, 1, 0.8, 0.3, 0, 0, 0, 0], [1.1, 1.0, 0.8], [1.0, 1.0]), MKH: ([1, 0.8, 0.5, 0.2, 0, 0, 0, 0], [1.2, 1.0, 0.7], [1.0, 1.0]),
    HB: ([1, 1, 1, 0.6, 0.2, 0, 0, 0], [1.1, 1.0, 0.9], [0.8, 1.5]), SAL: ([1, 1, 1, 0.6, 0.2, 0, 0, 0], [1.1, 1.0, 0.9], [0.8, 1.5]),
})

# The Pacific Northwest's terrain (2026-11-04, the Olympic Mountains at 47-48 N: Sitka spruce and western hemlock in the
# valleys to ~600 m, Pacific silver fir 600-1,200, mountain hemlock and subalpine fir to treeline at ~1,700, heath and
# fell-field above, rock and ice): a species' factors on a tile in that region are these, else TERRAIN's.
TERRAIN_BY_REGION = {"pacific_northwest": {
    PSI: ([1, 1, 1, 0.4, 0.02, 0, 0, 0], [1.6, 1.0, 0.6], [1.0, 1.0]), TH: ([1, 1, 1, 0.9, 0.3, 0, 0, 0], [1.0, 1.0, 1.0], [0.9, 1.2]),
    TP: ([1, 1, 1, 0.6, 0.1, 0, 0, 0], [1.6, 1.0, 0.6], [0.9, 1.2]), ABAM: ([0.05, 0.1, 0.2, 1.0, 0.6, 0.05, 0, 0], [1.0, 1.0, 0.9], [0.9, 1.2]),
    "tsuga_mertensiana": ([0, 0, 0, 0.2, 1.0, 0.6, 0.1, 0], [1.0, 1.0, 0.9], [0.8, 1.3]),
    ABL: ([0, 0, 0, 0.05, 0.8, 1.0, 0.3, 0], [1.0, 1.0, 1.0], [1.0, 1.0]), "pinus_albicaulis": ([0, 0, 0, 0, 0.2, 0.8, 0.5, 0], [0.6, 1.0, 1.4], [1.2, 0.8]),
    AR: ([1, 1, 1, 0.5, 0.05, 0, 0, 0], [2.0, 1.0, 0.5], [1.0, 1.0]), PT: ([1, 1, 1, 0.5, 0.1, 0, 0, 0], [3.0, 1.0, 0.1], [1.0, 1.0]),
    "acer_macrophyllum": ([1, 1, 1, 0.5, 0.05, 0, 0, 0], [1.8, 1.0, 0.6], [1.0, 1.1]),
    "pseudotsuga_menziesii": ([1, 1, 1, 0.8, 0.3, 0, 0, 0], [1.0, 1.0, 1.1], [1.0, 1.0]),
    AC: ([1, 1, 1, 0.8, 0.4, 0.1, 0, 0], [1.2, 1.0, 1.0], [0.9, 1.2]), RUS: ([1, 1, 1, 0.8, 0.4, 0.1, 0, 0], [1.8, 1.0, 0.6], [1.0, 1.1]),
    VP: ([1, 1, 1, 0.9, 0.5, 0.1, 0, 0], [1.0, 1.0, 1.0], [0.9, 1.2]), OH: ([1, 1, 1, 0.6, 0.2, 0, 0, 0], [2.5, 1.0, 0.3], [0.8, 1.4]),
    MN: ([1, 1, 1, 0.8, 0.3, 0, 0, 0], [1.0, 1.0, 1.0], [1.0, 1.0]), "gaultheria_shallon": ([1, 1, 1, 0.7, 0.2, 0, 0, 0], [1.0, 1.0, 1.0], [1.0, 1.0]),
    TB: ([1, 1, 1, 0.8, 0.5, 0.1, 0, 0], [1.2, 1.0, 0.8], [1.0, 1.0]), PE: ([0, 0, 0, 0, 0.5, 1.0, 1.0, 0.5], [1.0, 1.0, 0.8], [1.0, 1.1]),
    CAS: ([0, 0, 0, 0, 0.4, 1.0, 1.0, 0.6], [1.0, 1.0, 0.8], [0.9, 1.3]),
}}

# Elevation zones (2026-11-04). The foothill rules hold blue oak, gray pine and chamise wherever their community's
# name lands them, and LANDFIRE names the same "Cliff and Canyon", "Montane Riparian" or "Mixed Conifer" from 300 m to
# 3,000 m. Above 1,100 m a species that does not grow there is replaced by the one that takes its place, by band
# (a replacement of {} removes it): on every rule, for every species the rule does not hold `fixed`. Values are shares
# of the replaced weight.
_SUBALP = {LP: 0.5, WB: 0.2, MH: 0.15, WWP: 0.15}
_BROAD = ("quercus_douglasii", "quercus_lobata", "aesculus_californica", "arbutus_menziesii", "umbellularia_californica",
          "juglans_hindsii", "acer_macrophyllum", "fraxinus_latifolia", "platanus_racemosa")
ZONE_SUBST = {
    4: {GP: {PP: 1.0}, BO: {KO: 1.0}, VO: {KO: 0.5}, BU: {}, LO: {CO: 0.6, LO: 0.4}, CB: {}, CH: {MZ: 0.5, CH: 0.5}, SY: {}},
    5: {PP: {JP: 0.7, PP: 0.3}, GP: {JP: 1.0}, CO: {CO: 0.5, JP: 0.25, SJ: 0.25}, KO: {WF: 0.5, JP: 0.5}, LO: {},
        IC: {IC: 0.3, WF: 0.4, RF: 0.3}, DF: {WF: 0.5, RF: 0.5}, CW: {QAS: 1.0}, AL: {QAS: 0.5}, SG: {WWP: 1.0},
        **{b: {} for b in _BROAD},
        MZ: {GM: 1.0}, CM: {GM: 1.0}, CH: {GM: 0.5, HO: 0.5}, BB: {MW: 1.0}, DB: {DB: 0.5, MW: 0.5}, TY: {BC: 1.0}, CF: {BC: 1.0},
        MM: {CLM: 1.0}, PO: {}, CB: {}, RB: {}, EL: {}, MF: {}, CR: {}, MMI: {}},
    6: {**{c: dict(_SUBALP) for c in (PP, JP, GP, IC, DF, KO, CO, WF, SG, CLM)}, RF: {RF: 0.5, LP: 0.3, WWP: 0.2},
        **{b: {} for b in _BROAD + (LO, CW, AL)},
        MZ: {GM: 0.5, RMH: 0.5}, CM: {GM: 0.5, RMH: 0.5}, GM: {GM: 0.5, RMH: 0.5}, CH: {RMH: 1.0}, BB: {MW: 0.5, RMH: 0.5},
        DB: {MW: 0.5, RMH: 0.5}, MW: {MW: 0.5, RMH: 0.5}, TY: {BC: 1.0}, CF: {BC: 1.0}, MM: {CLM: 1.0},
        **{x: {} for x in (PO, CB, RB, EL, MF, CR, MMI, SN, WR)}},
    7: {**{c: {WB: 1.0} for c in (PP, JP, GP, IC, DF, KO, CO, WF, SG, CLM, RF, LP, MH, WWP, SJ, QAS)},
        **{b: {} for b in _BROAD + (LO, CW, AL)},
        **{x: {RMH: 1.0} for x in (MZ, CM, GM, CH, BB, DB, MW, HO, BC, TY, CF, MM, GB)},
        **{x: {} for x in (PO, CB, RB, EL, MF, CR, MMI, SN, WR, BS)}},
}
# The coast (2026-11-04): a tile whose communities are coastal (COAST_WORDS in COAST_MIN of its named cells) has no blue
# oak, gray pine, interior live oak or ponderosa below 1,100 m: they become coast live oak, and Douglas-fir and tanoak.
COAST_WORDS, COAST_MIN = ("coast", "coastal", "maritime", "dune", "tidal"), 0.15
COAST_SUBST = {BO: {QA: 1.0}, GP: {QA: 1.0}, LO: {QA: 1.0}, KO: {QA: 1.0}, PP: {DF: 0.6, TO: 0.4}, IC: {DF: 1.0},
               MZ: {CM: 0.6, CB: 0.4}, CH: {CH: 0.4, CS: 0.3, CB: 0.3}}
# Species placed by where GBIF has seen them, not by their community (2026-11-04): giant sequoia grows in groves, a few
# hundred hectares each, inside the mixed conifer; LANDFIRE has no sequoia community. pipeline/needs.py writes the
# CC0 / CC BY records of these species on the tile to species/localized.json; a cell within `radius_m` of one, in one
# of `rules`, gets `weight` of it (TERRAIN still applies).
LOCALIZED = {GS: {"radius_m": 300.0, "weight": 0.6,
                  "rules": ("mesic_mixed_conifer", "dry_mesic_mixed_conifer", "lower_montane_conifer", "black_oak_conifer",
                            "habitat_default_conifer_forest", "habitat_default_mixed_forest", "montane_riparian")}}


def _pad(f: list) -> list:
    return list(f) + [f[-1]] * (NB - len(f))


def _subst(weights: dict, table: dict, fixed=()) -> dict:
    out: dict = {}
    for k, w in weights.items():
        if k in table and k not in fixed:
            for k2, share in table[k].items():
                out[k2] = out.get(k2, 0.0) + w * share
        else:
            out[k] = out.get(k, 0.0) + w
    return out


SUBSTITUTIONS: dict = {}   # species -> the record drawn for it (no record yet: communities.stand_in), this run


def resolve(weights: dict) -> dict:
    """Every species without a library record replaced by its stand-in (communities.stand_in); dropped if none."""
    from .communities import stand_in
    out: dict = {}
    for k, w in weights.items():
        r = k if (LIBRARY / f"{k}.json").exists() else stand_in(k)
        if r != k:
            SUBSTITUTIONS[k] = r
        if r and w > 0:
            out[r] = out.get(r, 0.0) + w
    return out


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
    band = np.digitize(eff, ELEV_BANDS)    # 0 .. NB-1
    pos = np.where((S < FLOOR_SLOPE) & (tpi <= FLOOR_TPI), 0, np.where(S >= STEEP_SLOPE, 2, 1))
    return (band * 6 + pos * 2 + (N >= NORTH_MIN)).astype("int64")


def terrain_label(t: int) -> str:
    g, t = divmod(t, NTC)
    return f"{BAND_NAMES[t // 6]} {POS_NAMES[(t // 2) % 3]}{' north' if t % 2 else ''}{' grove' if g else ''}"


CONTEXT: dict = {"coast": False, "regions": []}   # set per tile by species_mix()


_HAB_CACHE: dict = {}


def _record_habitat(sid: str) -> dict | None:
    if sid not in _HAB_CACHE:
        f = LIBRARY / f"{sid}.json"
        _HAB_CACHE[sid] = (json.loads(f.read_text()).get("habitat") if f.exists() else None) or None
    return _HAB_CACHE[sid]


def terrain_weights(weights: dict, t: int, fixed=(), rule: str | None = None) -> dict:
    grove, t = divmod(t, NTC)
    band, pos, nf = t // 6, (t // 2) % 3, t % 2
    w0 = dict(weights)
    if grove:
        for sid, loc in LOCALIZED.items():
            if rule in loc["rules"]:
                w0[sid] = w0.get(sid, 0.0) + loc["weight"] * max(sum(w0.values()), 1e-9)
    ca = "california" in CONTEXT.get("regions", [])
    if ca and CONTEXT.get("coast") and band <= 3:     # the coast's and the Sierra's tables are California's
        w0 = _subst(w0, COAST_SUBST, fixed)
    if ca and band in ZONE_SUBST:
        w0 = _subst(w0, ZONE_SUBST[band], fixed)
    reg = next((TERRAIN_BY_REGION[r] for r in CONTEXT.get("regions", []) if r in TERRAIN_BY_REGION), {})
    out = {}
    for k, w in w0.items():
        f = reg.get(k) or TERRAIN.get(k)
        if f is None and k not in fixed:   # no table row: the record's own niche on its card (floor / mid / steep / north)
            h = _record_habitat(k)
            if h:
                pf = (h.get("floor", 1.0), h.get("mid", 1.0), h.get("steep", 1.0))[pos]
                out[k] = w * pf * (h.get("north", 1.0) if nf else 1.0)
                continue
        out[k] = w if (f is None or k in fixed) else w * _pad(f[0])[band] * f[1][pos] * f[2][nf]
    return resolve(out)


# The ground layer (2026-10-29): the grasses and forbs (library/species records with form "grass" or "forb",
# docs/species-library.md "Grasses, herbs and shrubs of the foothill understory"). Unlike the trees and shrubs
# they are not weighted by hand per rule: each record's `habitat` block gives its weight per habitat class
# (`classes`, by class name) times its `ground.density` (forbs), and its floor / mid / steep / north factors are
# its own TERRAIN row; a rule may still add to or override them (GROUND_RULES, by rule id). The client's grass
# and forb layers draw each cell's grasses and forbs from the row's ground_bytes (the grasses' share and the
# forbs' share of it, by form). Cells without a row keep the client's own defaults.
GROUND_FORMS = ("grass", "forb")
# The dwarf shrubs (2026-11-06): a woody record with a `ground` block marked woody (pipeline/plantgen.py gives one to every
# card whose height tops out at or below plantgen.DWARF_SHRUB_MAX_M, 0.5 m: crowberry, heather, the mountain heathers)
# is a ground-layer plant, not a shrub: a heath is a carpet of them, which the shrub layer's ~11 whole shrub models per
# cell drew as bare ground. Wherever a community's shrubs name one (its rule, its name or the tile's research) it
# leaves the shrub weights for the ground weights (split_dwarf_shrubs); the row's carpet density (density_bytes[2],
# species_mix_density.png B) is the dwarfs' share of the community's shrubs, which the client's ground layer
# (client/src/forbs.js) multiplies by the cell's shrub cover (canopy.png G: landcover_global's DWARF_SHRUB cover in a
# heath or tundra) to lay the carpet; the shrub density keeps the rest of the shrubs' share (the junipers). They are not added to communities by
# habitat class as the grasses and forbs are: only where a community has them.


def is_dwarf_shrub(sid: str) -> bool:
    if sid not in _DWARF_CACHE:
        f = LIBRARY / f"{sid}.json"
        d = json.loads(f.read_text()) if f.exists() else {}
        _DWARF_CACHE[sid] = d.get("form") not in GROUND_FORMS and bool((d.get("ground") or {}).get("woody"))
    return _DWARF_CACHE[sid]


_DWARF_CACHE: dict = {}


def split_dwarf_shrubs(row: dict) -> dict:
    """Move a community row's dwarf shrubs from its shrubs to its ground layer (in place): the remaining shrubs keep
    (1 - their share) of the shrub density, the carpet density is their share of the shrub cover (none where the
    community draws no shrubs); the dwarfs' ground weights sum to the row's
    other ground weights (or 1), so each form's share stays readable in 255 bytes. Returns {dwarf id: weight}."""
    tot = sum(row["shrubs"].values())
    dwarf = {k: w for k, w in row["shrubs"].items() if w > 0 and is_dwarf_shrub(k)}
    row["carpet_density"] = 0.0
    if not dwarf or tot <= 0:
        return {}
    share = sum(dwarf.values()) / tot
    row["shrubs"] = {k: w for k, w in row["shrubs"].items() if k not in dwarf}
    row["carpet_density"] = share if row["shrub_density"] > 0 else 0.0
    row["shrub_density"] = row["shrub_density"] * (1.0 - share)
    scale = (sum(row["ground"].values()) or 1.0) / sum(dwarf.values())
    for k, w in dwarf.items():
        row["ground"][k] = w * scale
    return dwarf
GROUND_RULES = {
    "rewilded_meadow": {"danthonia_californica": 2.0, "elymus_glaucus": 1.5, "achillea_millefolium": 1.5},   # a wet meadow: the perennials
    "ruderal_forest": {"bromus_diandrus": 1.6, "hordeum_murinum": 1.6, "erodium_cicutarium": 1.4},
    "ruderal_scrub": {"bromus_diandrus": 1.6, "hordeum_murinum": 1.6, "amsinckia_menziesii": 1.5},
}


# The riparian zones (2026-10-29, pipeline/water.py; Aaron: "water systems are first class citizens like animals").
# Every record may carry habitat.riparian: { zones: { channel, margin, bank, terrace, pond_water, pond_margin, pond_shore,
# pond_terrace: weight }, orders: [min, max] (the Strahler orders it lines), permanence: perennial | intermittent | any,
# water: <text> } (docs/species-library.md). From those blocks the mix per zone is built here, like the ground layer: one
# row per zone x stream order class x permanence (the pond zones: one order class), each row the species' zone weights
# (x ground.density for the ground forms), halved where the order class only half overlaps the record's orders, and a
# tenth for a species that needs perennial water beside a seasonal reach (a few at the seeps). The client reads a cell's
# zone, order and permanence from client/water.png R and draws the zone's trees, shrubs and ground layer from the row.
RIPARIAN_ZONES = ("channel", "margin", "bank", "terrace", "pond_water", "pond_margin", "pond_shore", "pond_terrace")
RIPARIAN_ORDER_CLASSES = (("small", 1, 2), ("medium", 3, 4), ("large", 5, 9))
RIPARIAN_FORMS = {"tree": "trees", "multi_stem_shrub_tree": "trees", "shrub": "shrubs", "grass": "ground", "forb": "ground", "emergent": "ground"}   # a dwarf shrub: ground
# plant density per zone (trees, shrubs, ground), relative to the client's per-class counts: a gallery on the bank and
# terrace, willow clumps on the margin, no trees in the channel or the water
RIPARIAN_DENSITY = {"channel": (0.0, 0.0, 1.0), "margin": (0.5, 1.2, 1.2), "bank": (1.6, 1.4, 1.0), "terrace": (1.3, 1.0, 1.0),
                    "pond_water": (0.0, 0.0, 1.0), "pond_margin": (0.0, 0.2, 1.4), "pond_shore": (0.8, 1.2, 1.2), "pond_terrace": (1.0, 0.8, 1.0)}


def _in_regions(sid: str, d: dict, regions) -> bool:
    """Whether a record grows in one of the tile's regions (communities.regions_of); regions None: every record (the
    water step's call, which has no tile; species_mix and the step wrapper filter by the tile)."""
    if regions is None:
        return True
    from .communities import regions_of
    return bool(set(regions_of(sid, d)) & set(regions))


# Cards borrowed from another region, and the riparian trees and shrubs (2026-11-08): a record with its own `regions` list was written for a named region
# set (the Olympic grow's western sword fern and redwood sorrel list the Pacific Northwest and California), and a whole
# region is coarser than the plant's range: redwood sorrel is a coast-redwood plant, so it carpeted the Sierra foothills'
# oak savanna (El Dorado) and Yosemite Valley; and the zone rows put black walnut, sycamore and Fremont cottonwood (no
# record within 25 km) on Yosemite Valley's banks. Such a card, and every riparian tree and shrub, is used on a tile only where GBIF has at
# least MIN_LOCAL_RECORDS of it within LOCAL_RECORDS_BUFFER_M over the presence years (fetch_species), where the area is
# recorded well enough for an absence to mean something (LOCAL_EFFORT_MIN plant records around it); the California
# cards without a `regions` list keep the regional tables' word. Offline: kept, and said so in the mix's notes.
MIN_LOCAL_RECORDS = 3
LOCAL_RECORDS_FULL = 30   # a borrowed ground card's weight x min(1, records / this): a handful of records is a rarity there
LOCAL_RECORDS_BUFFER_M = 25_000
LOCAL_EFFORT_MIN = 5_000   # vascular plant records within the buffer before an absence means anything (the Serengeti has
# 654, Danum 762, Manu 193: there red oat grass, the Serengeti's own, showed 0; El Dorado 53,391, the Hoh 26,619)
TRACHEOPHYTA_KEY = 7707728
_EFFORT: dict = {}
LOCAL_RECORDS_SKIPPED: list = []   # this run's {id, records} left out, recorded in the mix document
LOCAL_RECORDS_SCALED: dict = {}    # this run's borrowed cards kept at less than full weight: {id: factor}


def _local_ok(tile, sid: str, d: dict, always: bool = False) -> bool:
    """always: every record, not only the borrowed ones (the riparian trees and shrubs: a zone row holds the whole
    region's, unlike a community row, which its LANDFIRE community and the band rules choose)."""
    if tile is None or not (always or d.get("regions")):
        return True
    from datetime import date
    from .fetch_species import PRESENCE_YEARS, _q, records_near
    try:
        r = _q(None, "species/match", {"name": " ".join(sid.split("_")).capitalize(), "strict": "true"})
        key = r.get("acceptedUsageKey") or r.get("usageKey")
        if not key or r.get("matchType") == "NONE":   # GBIF does not know the name as written: no evidence either way
            return True
        y1 = date.today().year
        if tile.tile_id not in _EFFORT:
            _EFFORT[tile.tile_id] = records_near(tile, TRACHEOPHYTA_KEY, (y1 - PRESENCE_YEARS, y1), buf_m=LOCAL_RECORDS_BUFFER_M)
        if _EFFORT[tile.tile_id] < LOCAL_EFFORT_MIN:   # too few plant records around for an absence to say anything
            return True
        n = records_near(tile, key, (y1 - PRESENCE_YEARS, y1), buf_m=LOCAL_RECORDS_BUFFER_M)
    except Exception:
        return True
    if n < MIN_LOCAL_RECORDS:
        if not any(x["id"] == sid for x in LOCAL_RECORDS_SKIPPED):
            LOCAL_RECORDS_SKIPPED.append({"id": sid, "records": n, "buffer_km": LOCAL_RECORDS_BUFFER_M // 1000})
        return False
    if d.get("regions") and n < LOCAL_RECORDS_FULL:
        LOCAL_RECORDS_SCALED[sid] = round(n / LOCAL_RECORDS_FULL, 3)
    return True


def riparian_species(regions=None, tile=None) -> list[dict]:
    index = json.loads((LIBRARY / "index.json").read_text())
    out = []
    for sid in index.get("species", []):
        f = LIBRARY / f"{sid}.json"
        if sid.startswith("_") or not f.exists():
            continue
        d = json.loads(f.read_text())
        if not _in_regions(sid, d, regions):
            continue
        rz = (d.get("habitat") or {}).get("riparian")
        layer = "ground" if is_dwarf_shrub(sid) else RIPARIAN_FORMS.get(d.get("form"))
        if rz and rz.get("zones") and layer and not _local_ok(tile, sid, d, always=layer in ("trees", "shrubs")):
            continue
        if not rz or not rz.get("zones") or not layer:
            continue
        out.append({"id": sid, "form": d["form"], "layer": layer, "zones": rz["zones"], "orders": rz.get("orders") or [1, 9],
                    "permanence": rz.get("permanence") or "any",
                    "density": (float((d.get("ground") or {}).get("density", 1.0)) if layer == "ground" else 1.0) * LOCAL_RECORDS_SCALED.get(sid, 1.0)})
    return out


def riparian_rows(regions=None, tile=None) -> dict:
    """{ zones, rows: { "<zone>|<order class>|<perennial|seasonal>": { trees, shrubs, ground: [[id, byte]...], density } },
    species: [ids] }; rows for the pond zones use the order class "pond". regions: only the species growing there."""
    sp = riparian_species(regions, tile)
    rows = {}
    # Rows per elevation band (2026-11-08): the zone rows hold one region's riparian species at every height, so Yosemite
    # Valley's banks at 1,200 m drew valley oak, black walnut, sycamore and Fremont cottonwood (foothill trees). With a
    # tile, each row also gets a "|<band>" copy per band the tile reaches, its trees and shrubs passed through the
    # community rows' own band rule (terrain_weights on a floor cell of that band: ZONE_SUBST and TERRAIN's band
    # factors); the client takes the band of the cell's ground (TilePackage SpeciesMix.ripRow), else the plain row.
    bands = tile_bands(tile) if tile is not None else []
    if bands and not CONTEXT.get("regions"):
        CONTEXT["regions"] = list(regions or [])
    for zone in RIPARIAN_ZONES:
        classes = RIPARIAN_ORDER_CLASSES if not zone.startswith("pond") else (("pond", 1, 9),)
        for cname, lo, hi in classes:
            for perm in ("perennial", "seasonal"):
                layers = {"trees": {}, "shrubs": {}, "ground": {}}
                for r in sp:
                    w = float(r["zones"].get(zone, 0.0))
                    if w <= 0:
                        continue
                    if cname != "pond":
                        o0, o1 = r["orders"]
                        inter = max(0, min(hi, o1) - max(lo, o0) + 1)
                        span = hi - lo + 1
                        if inter <= 0:
                            continue
                        w *= 1.0 if inter >= span else 0.5
                    if perm == "seasonal" and r["permanence"] == "perennial":
                        w *= 0.1
                    layers[r["layer"]][r["id"]] = w * r["density"]
                row = {}
                for layer, weights in layers.items():
                    ids = list(weights)
                    row[layer] = [[k, b] for k, b in zip(ids, _bytes(weights, ids)) if b]
                row["density"] = list(RIPARIAN_DENSITY[zone])
                rows[f"{zone}|{cname}|{perm}"] = row
                for b in bands:
                    rb = {"ground": row["ground"], "density": row["density"]}
                    for layer in ("trees", "shrubs"):
                        w = terrain_weights(layers[layer], b * 6) if layers[layer] else {}
                        ids = list(w)
                        rb[layer] = [[k, x] for k, x in zip(ids, _bytes(w, ids)) if x]
                    rows[f"{zone}|{cname}|{perm}|{b}"] = rb
    extra = sorted({k for r in rows.values() for L in ("trees", "shrubs") for k, _ in r.get(L, [])} - {r["id"] for r in sp})
    return {"zones": list(RIPARIAN_ZONES), "order_classes": [list(c) for c in RIPARIAN_ORDER_CLASSES], "rows": rows,
            "bands_m": list(ELEV_BANDS) if bands else None, "bands": bands,
            "species": [r["id"] for r in sp] + extra,
            "encoding": ("rows[zone|order class|permanence]: trees / shrubs / ground as [[species id, byte]] summing to 255 per layer "
                         "(absent: none), density [tree, shrub, ground] multipliers; the zone, order (small 1-2, medium 3-4, large 5+) "
                         "and permanence come from client/water.png R; pond zones use the class 'pond'; a key ending '|<band>' is "
                         "the row for ground in that elevation band (bands_m: band = how many of its heights the ground is at or above)")}


def tile_bands(tile) -> list[int]:
    """The elevation bands (ELEV_BANDS) the tile's ground reaches."""
    p = tile.path("terrain/dem.tif")
    if not p.exists():
        return []
    with rasterio.open(p) as src:
        z = src.read(1, out_shape=(200, 200)).astype("float64")
        nod = src.nodata
    z = z[np.isfinite(z) & (z != nod)] if nod is not None else z[np.isfinite(z)]
    return sorted(int(b) for b in np.unique(np.digitize(z, ELEV_BANDS))) if z.size else []


def ground_species(regions=None, tile=None) -> list[dict]:
    """The ground-layer records, in index.json order: id, form, habitat, density; regions: only those growing there."""
    index = json.loads((LIBRARY / "index.json").read_text())
    out = []
    for sid in index.get("species", []):
        f = LIBRARY / f"{sid}.json"
        if sid.startswith("_") or not f.exists():
            continue
        d = json.loads(f.read_text())
        if d.get("form") not in GROUND_FORMS or not _in_regions(sid, d, regions) or not _local_ok(tile, sid, d):
            continue
        out.append({"id": sid, "form": d["form"], "habitat": d.get("habitat") or {},
                    "density": float((d.get("ground") or {}).get("density", 1.0)) * LOCAL_RECORDS_SCALED.get(sid, 1.0)})
    return out


# Deep-shade plants and an open canopy (2026-11-08): a ground record's habitat.shade says how much shade it wants; one
# at SHADE_OBLIGATE or more (the sword fern 0.9, redwood sorrel 1.0) grows under a closed canopy, so its weight is
# scaled by the square of the community's closure: from its LANDFIRE name (a savanna is open, a woodland half open, a forest closed),
# else its habitat class. The foothill pine savanna is classed mixed_forest, and the ferns had carpeted it as if it
# were a closed forest floor.
SHADE_OBLIGATE = 0.9
CLOSURE_WORDS = (("savanna", 0.2), ("woodland", 0.5), ("forest", 1.0))   # the mean of those in the name ("Forest and
# Woodland" 0.75, "Woodland and Savanna" 0.35)
CLOSURE_CLASS = {"conifer_forest": 0.9, "mixed_forest": 0.8, "riparian": 0.8, "oak_woodland": 0.5}


def closure(name: str | None, cls: str | None) -> float:
    n = (name or "").lower()
    found = [c for word, c in CLOSURE_WORDS if word in n]
    return sum(found) / len(found) if found else CLOSURE_CLASS.get(cls, 0.0)


def ground_weights(hab_code: int, rule_id: str, species: list[dict], name: str | None = None) -> dict:
    """A community's ground weights: each species' habitat class weight x its density (a deep-shade species x the
    community's closure), plus the rule's own."""
    cls = CLASSES.get(hab_code)
    out = {}
    for sp in species:
        w = float((sp["habitat"].get("classes") or {}).get(cls, 0.0)) * sp["density"]
        if float(sp["habitat"].get("shade") or 0.0) >= SHADE_OBLIGATE:
            w *= closure(name, cls) ** 2   # falls off fast as the canopy opens: a savanna 0.12, a woodland 0.25
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


def match(name: str, regions=None) -> dict | None:
    """The first rule whose keywords the community name holds, among the rules for the tile's regions (regions None:
    California's, as before 2026-11-04)."""
    regions = ["california"] if regions is None else list(regions)
    n = (name or "").lower()
    for rule in RULES:
        if rule.get("region") is not None and rule["region"] not in regions:
            continue
        hit = any(k in n for k in rule["keywords"]) if rule["any"] else all(k in n for k in rule["keywords"])
        if hit:
            return rule
    return None


# Densities of a rule read from a community's name, by LANDFIRE life form (EVT_LF / the habitat class): (tree, shrub)
NAMED_DENSITY = {"conifer_forest": (1.2, 0.5), "mixed_forest": (1.1, 0.5), "oak_woodland": (0.9, 0.5), "riparian": (1.3, 0.6),
                 "chaparral": (0.2, 1.0), "grassland": (0.05, 0.2), "barren": (0.05, 0.1), "water": (0.0, 0.0)}


NAMED_NEAR_DEG = 0.5


def named_rule(name: str, hab_code: int) -> dict | None:
    """A rule read from the community's name (communities.named_species): its named species, equal weights, densities
    by habitat class. None when the name names no species."""
    from .communities import named_species
    named = named_species(name)
    # A tile outside every natural-region table reads community names with California's lexicon (communities.LEXICON),
    # so "alpine" named Brewer's mountain heather, a California endemic, in Yellowstone (2026-11-06). There a named
    # species is kept only where GBIF has it within NEAR_DEG of the tile (tree_cards._near): big sagebrush stays.
    if named and CONTEXT.get("regions") == [] and CONTEXT.get("tile") is not None:
        from .tree_cards import _near
        def sci(sid):
            try:
                return json.loads((LIBRARY / f"{sid}.json").read_text()).get("scientific") or sid.replace("_", " ")
            except (OSError, ValueError):
                return sid.replace("_", " ")
        named = [(sid, kind) for sid, kind in named if _near(CONTEXT["tile"], " ".join(sci(sid).split()[:2]), NAMED_NEAR_DEG) > 0]
    if not named:
        return None
    trees = {sid: 1.0 for sid, kind in named if kind == "tree"}
    shrubs = {sid: 1.0 for sid, kind in named if kind == "shrub"}
    td, sd = NAMED_DENSITY.get(CLASSES.get(hab_code), (0.8, 0.6))
    return {"id": "named_from_" + "_".join(sid for sid, _ in named[:3]), "trees": trees, "shrubs": shrubs,
            "tree_density": td if trees else 0.0, "shrub_density": sd if shrubs else 0.0,
            "note": "no rule: the species its name names (communities.LEXICON)", "fixed": [], "region": None}


# Stems to fill the cover (world pipeline phase 1, iteration 4): the client places a cell's trees by its canopy cover
# whatever their crowns, so a row of narrow crowns (Manu's stilt and stem palms, 10-24 m2) left the measured cover open.
# A row's tree density is multiplied by the library's median crown (its California trees, the scale the client's counts
# were tuned on) over the row's weighted mean crown, crown = pi (profile's widest radius x mean height)^2 from the
# records; never below 1 (big crowns already fill the cover) and at most 3.
_CROWN: dict = {}


def crown_area(sid: str) -> float | None:
    if sid not in _CROWN:
        try:
            d = json.loads((LIBRARY / f"{sid}.json").read_text())
        except (OSError, ValueError):
            _CROWN[sid] = None
            return None
        c = d.get("crown") or {}
        prof = (c.get("envelope") or c).get("profile") or []
        r = max((p[1] for p in prof if len(p) > 1), default=None)
        h = d.get("height_m") or [10, 20]
        _CROWN[sid] = math.pi * (r * sum(h) / len(h)) ** 2 if r else None
    return _CROWN[sid]


def crown_fill(trees: dict) -> float:
    if "ref" not in _CROWN:
        index = json.loads((LIBRARY / "index.json").read_text())
        areas = []
        for sid in index.get("species", []):
            f = LIBRARY / f"{sid}.json"
            if sid.startswith("_") or not f.exists():
                continue
            d = json.loads(f.read_text())
            if d.get("form") in ("tree", "multi_stem_shrub_tree") and "california" in (d.get("regions") or []):
                a = crown_area(sid)
                if a:
                    areas.append(a)
        _CROWN["ref"] = float(np.median(areas)) if areas else None
    ref = _CROWN["ref"]
    ws = {k: w for k, w in (trees or {}).items() if w > 0 and crown_area(k)}
    if not ref or not ws:
        return 1.0
    mean = sum(w * crown_area(k) for k, w in ws.items()) / sum(ws.values())
    return float(min(3.0, max(1.0, ref / mean)))


# The climate group a region's records were written for (their cards' `regions`): a functional stand-in is taken only
# from records of the tile's own climate group, never another's (world pipeline phase 1, 2026-11-06: the probes drew
# California's pines in the Amazon through the client's class fallback).
REGION_CLIMATE = {"california": "temperate", "pacific_northwest": "temperate", "great_basin": "arid",
                  "east_africa": "tropical_seasonal", "borneo": "tropical_wet", "neotropics": "tropical_wet", "scandinavia": "boreal"}


def climate_group(koppen: str | None) -> str | None:
    if not koppen:
        return None
    k = koppen[:2]
    if k in ("Af", "Am"):
        return "tropical_wet"
    if k in ("Aw", "As") or koppen.startswith("BSh") or koppen.startswith("BWh"):
        return "tropical_seasonal"
    if koppen[0] == "B":
        return "arid"
    if koppen[0] == "C":
        return "temperate"
    return "boreal"   # D, E


def _niche_weight(d: dict, hab_code: int) -> float:
    """A record's own habitat preference for a habitat class (its card's habitat.classes): 1 when it names none."""
    classes = (d.get("habitat") or {}).get("classes") or {}
    if not classes:
        return 1.0
    return float(classes.get(CLASSES.get(hab_code, ""), 0.05))


def research_rule(tile: Tile, name: str, hab_code: int) -> dict:
    """World pipeline (2026-11-05, niches 2026-11-06): a community with no LANDFIRE rule, read from the tile's own plant
    research. The trees and shrubs of species/plant_needs.json that have a library record, each weighted by its GBIF
    records on the tile (or its community cover) times its own niche for this habitat class (habitat.classes on its
    card: the riparian sausage tree off the open plains). With no tree of its own on record, a FUNCTIONAL STAND-IN: the
    library's trees of the tile's climate group (REGION_CLIMATE) that suit the class, marked so; never another climate's."""
    pn = tile.path("species/plant_needs.json")
    trees, shrubs, stand_in = {}, {}, []
    if pn.exists():
        for n in json.loads(pn.read_text()).get("needs", []):
            sid, kind = n.get("id"), n.get("kind")
            f = LIBRARY / f"{sid}.json"
            if not sid or not f.exists():
                continue
            w = (float(n.get("records") or 0) + 1000 * float(n.get("cover") or 0) or 1.0) * _niche_weight(json.loads(f.read_text()), hab_code)
            if w <= 0:
                continue
            if kind == "tree":
                trees[sid] = w
            elif kind == "shrub":
                shrubs[sid] = w
    td, sd = NAMED_DENSITY.get(CLASSES.get(hab_code), (0.8, 0.6))
    if not trees and td > 0.1:
        nj = tile.path("climate/normals.json")
        group = climate_group(json.loads(nj.read_text()).get("koppen")) if nj.exists() else None
        if group:
            for f in sorted(LIBRARY.glob("*.json")):
                if f.stem == "index":
                    continue
                d = json.loads(f.read_text())
                if d.get("form") not in ("tree", "multi_stem_shrub_tree"):
                    continue
                if not any(REGION_CLIMATE.get(r) == group for r in (d.get("regions") or [])):
                    continue
                w = _niche_weight(d, hab_code)
                if w >= 0.3:
                    trees[f.stem] = w
                    stand_in.append(f.stem)
    note = "no regional rule: the tile's researched species with a record (plant_needs), weighted by records and their niche"
    if stand_in:
        note += f"; no tree of its own on record: functional stand-ins of its climate group ({', '.join(stand_in)})"
    return {"id": "research_" + (name or "none").split(" ")[0].replace(".", "_"), "trees": trees, "shrubs": shrubs,
            "tree_density": td if trees else 0.0, "shrub_density": sd if shrubs else 0.0,
            "note": note, "fixed": [], "region": None, "stand_in": stand_in}


def _fallback(hab_code: int, regions=None) -> dict:
    """The habitat-class default: California's foothill mix, in California only. Elsewhere a placeholder the tile pool
    (species_mix) fills from the tile's own communities of the same habitat class, or leaves bare."""
    regions = ["california"] if regions is None else list(regions)
    if "california" not in regions:
        return {"id": f"tile_pool_{CLASSES.get(hab_code, 'none')}", "trees": {}, "shrubs": {}, "tree_density": 0.0,
                "shrub_density": 0.0, "note": "no rule and no species in its name: the tile's own species of this habitat class",
                "fixed": [], "pool": True}
    trees, shrubs = HABITAT_DEFAULT.get(hab_code, ({}, {}))
    d = 1.0 if hab_code in HABITAT_DEFAULT else 0.0
    return {"id": f"habitat_default_{CLASSES.get(hab_code, 'none')}", "trees": trees, "shrubs": shrubs,
            "tree_density": d, "shrub_density": d, "note": "no keyword rule matched: habitat-class default mix (California's foothills)"}


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


def columns(rules: list[dict], tree_rows=(), shrub_rows=()) -> tuple[list[str], list[str]]:
    """Tree and shrub columns: TREES / SHRUBS, then any other species the rows draw (after the zones, the coast and the
    stand-ins; in the order the rows first name them). A rule's species without a record is not a column: its stand-in
    is (resolve)."""
    trees, shrubs = list(TREES), list(SHRUBS)
    for rows_, cols in ((list(tree_rows) or [r["trees"] for r in rules], trees), (list(shrub_rows) or [r["shrubs"] for r in rules], shrubs)):
        for w in rows_:
            for k, v in w.items():
                if v > 0 and k not in cols:
                    cols.append(k)
    for sid in trees + shrubs:
        if not (LIBRARY / f"{sid}.json").exists():
            warnings.warn(f"species mix names {sid}, which has no library/species/{sid}.json; the client skips it")
    return trees, shrubs


def grove_mask(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """1 where a cell lies within its radius of a GBIF record of a LOCALIZED species (species/localized.json, written by
    pipeline/needs.py from CC0 / CC BY records only), else 0."""
    p = tile.path("species/localized.json")
    out = np.zeros(shape, "int64")
    if not p.exists():
        return out
    loc = json.loads(p.read_text())
    x0, y0, x1, y1 = tile.bounds
    res = (x1 - x0) / shape[1]
    cx = (np.arange(shape[1]) + 0.5) * res
    cy = (y1 - y0) - (np.arange(shape[0]) + 0.5) * res     # row 0 = north
    for sid, spec in LOCALIZED.items():
        pts = sorted({(float(x), float(n)) for x, n in (loc.get(sid) or {}).get("points") or []})
        # a grove, not a planted tree: a record counts with MIN_CLUSTER distinct records within CLUSTER_M (itself included);
        # Yosemite Valley's few records are planted sequoias by the old village (2026-11-04)
        pts = [(x, n) for x, n in pts if sum((x - a) ** 2 + (n - b) ** 2 <= spec.get("cluster_m", 700.0) ** 2 for a, b in pts)
               >= spec.get("min_cluster", 3)]
        r2 = spec["radius_m"] ** 2
        for x, n in pts:
            dx2 = (cx - x) ** 2
            dy2 = (cy - n) ** 2
            out |= ((dy2[:, None] + dx2[None, :]) <= r2).astype("int64")
    return out


def _is_human(e: dict) -> bool:
    return (e.get("phys") or "").startswith(HUMAN_PHYS_PREFIXES) or e.get("habitat") == "human"


# The stand's structure per row (2026-11-06, phase 1 iteration 8), for the client's shrub field and grass layer:
#   shrub_h_m   LANDFIRE EVH's shrub height (codes 201-299, 0.1 m steps: the mean height of the dominant shrubs) as the
#               median over the row's cells, where shrub-height cells are at least half of them; a tile whose EVH is
#               synthetic (pipeline/landcover_global.py: one typical value per WorldCover class) gets none
#   herb_cover  [low, high] fraction: the herbaceous cover its community's LANDFIRE BpS model description gives
#               ("Herbaceous cover is moderate to abundant, ranging from 40-85%"), on a tile with its own ground layer
#               (ground_cards); none where the description gives no range
SHRUB_H_MIN_SHARE = 0.5
HERB_COVER_RE = r"herbaceous (?:canopy |layer |plant )?cover[^.%]{0,80}?(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*%"


def herb_cover_of(text: str) -> list[float] | None:
    """[low, high] from a description's first 'herbaceous cover ... a-b %' range, or None."""
    import re
    m = re.search(HERB_COVER_RE, text or "", re.I)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    if not 0 <= lo <= hi <= 100:
        return None
    return [lo / 100, hi / 100]


def stand_structure(tile: Tile, index: np.ndarray, table: list[dict], classes: dict) -> dict:
    """Adds shrub_h_m and herb_cover to the rows of `table` (index: the cells' rows) in place; a summary."""
    synthetic = any(e.get("synthetic") for e in (classes.get("evt") or {}).values())
    n_h = n_c = 0
    if not synthetic and tile.path("vegetation/evh.tif").exists():
        with rasterio.open(tile.path("vegetation/evh.tif")) as src:
            evh = src.read(1)
        if evh.shape == index.shape:
            flat_i, flat_h = index.ravel(), evh.ravel()
            order = np.argsort(flat_i, kind="stable")
            si, sh = flat_i[order], flat_h[order]
            starts = np.searchsorted(si, [r["index"] for r in table])
            ends = np.searchsorted(si, [r["index"] for r in table], side="right")
            for r, a, b in zip(table, starts, ends):
                v = sh[a:b]
                s = v[(v >= 201) & (v <= 299)]
                if b > a and s.size >= SHRUB_H_MIN_SHARE * (b - a):
                    r["shrub_h_m"] = round(float(np.median(s - 200)) / 10, 2)
                    n_h += 1
    from . import ground_cards
    if tile.path("vegetation/bps.tif").exists() and ground_cards.applies(tile):
        models, _, _ = ground_cards.community_models(tile)
        by_key = {(c["source"], int(c["code"])): c["model"] for c in models}
        cover: dict = {}
        for r in table:
            model = by_key.get((r["source"], int(r["code"])))
            if not model:
                continue
            if model not in cover:
                doc = ground_cards.fetch_doc(model)
                cover[model] = herb_cover_of(ground_cards.parse_doc(doc)["vegetation"]) if doc else None
            if cover[model]:
                r["herb_cover"] = cover[model]
                n_c += 1
    return {"rows_with_shrub_height": n_h, "rows_with_herb_cover": n_c, "evh_synthetic": synthetic}


def patch_structure(tile: Tile) -> dict:
    """Adds the stand structure (stand_structure) to a built tile's client/species_mix.json in place, as the water step
    rewrites its riparian rows: the rows, the index and every other key are left as they are."""
    p = tile.path("client/species_mix.json")
    doc = json.loads(p.read_text())
    img = np.array(Image.open(tile.path("client/species_mix_index.png")))
    index = (img[..., 0].astype("int64") + 256 * img[..., 1].astype("int64")) if img.ndim == 3 else img.astype("int64")
    classes = json.loads(tile.path("vegetation/classes.json").read_text())
    for r in doc["mixes"]:
        r.pop("shrub_h_m", None); r.pop("herb_cover", None)
    summary = stand_structure(tile, index, doc["mixes"], classes)
    doc["encoding"]["structure"] = STRUCTURE_ENCODING
    _write_doc(p, doc)
    return summary


STRUCTURE_ENCODING = ("mixes[].shrub_h_m: LANDFIRE EVH's shrub height (m), the median over the row's cells where at least "
                      "half of them have one (absent: none, or a synthetic EVH); mixes[].herb_cover: [low, high] herbaceous "
                      "cover fraction from the community's LANDFIRE BpS model description (absent: none given)")


def _write_doc(p, doc: dict) -> None:
    # One row (and one community) per line: several hundred rows indented one value per line ran to 600 KB.
    table, communities = doc["mixes"], doc.get("communities", [])
    text = json.dumps({**doc, "mixes": "@MIXES@", "communities": "@COMMUNITIES@", "riparian": "@RIP@"}, indent=1)
    for k, rows_ in (("@MIXES@", table), ("@COMMUNITIES@", communities)):
        text = text.replace(f'"{k}"', "[\n" + ",\n".join("  " + json.dumps(r, separators=(",", ":")) for r in rows_) + "\n ]")
    text = text.replace('"@RIP@"', json.dumps(doc.get("riparian"), separators=(",", ":")))
    p.write_text(text)


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
    from .regions import natural_regions
    regions = natural_regions(tile)
    CONTEXT["regions"] = regions
    CONTEXT["tile"] = tile

    def row_for(source: str, code: int, name: str | None, hab_code: int, rule: dict | None = None) -> int:
        key = (source, code)
        if key not in rows:
            rule = rule or (match(name, regions) if name else None)
            if rule is None:
                rule = (named_rule(name, hab_code) if name else None) or _fallback(hab_code, regions)
                unmatched.append({"source": source, "code": code, "name": name, "habitat": CLASSES.get(hab_code),
                                  "drawn": "its named species" if rule["id"].startswith("named_from") else
                                           ("the tile's own species of its habitat class" if rule.get("pool") else
                                            "California's foothill default")})
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
            idx = row_for("evt", e_code, e.get("name"), h_code,
                          research_rule(tile, e.get("name"), h_code) if e.get("synthetic") else None)
        else:
            b = bps_tab.get(str(b_code))
            if b and b.get("habitat") not in (None, "human"):
                idx = row_for("bps", b_code, b.get("name"), h_code,
                              research_rule(tile, b.get("name"), h_code) if b.get("synthetic") else None)
            else:   # BpS human/unknown: grassland savanna, as habitat.py backfills
                idx = row_for("habitat", h_code, None, h_code if h_code != 9 else 5)
        index[(evt == e_code) & (bps == b_code) & (hab == h_code)] = idx

    # Former reservoir and stock-pond beds: their own rows, whatever EVT says (open water, mostly).
    with rasterio.open(tile.path("vegetation/habitat_present.tif")) as src:
        cells = rewilded_cells(tile, src.read(1))
    if cells is not None:
        for k, (sel, rule) in enumerate(zip(cells, (REWILD_MEADOW, REWILD_RIPARIAN))):
            if sel.any():
                if "california" not in regions:   # the rewilded beds' rows are foothill species: the tile pool instead
                    rule = _fallback(5 if k == 0 else 6, regions)
                index[sel] = row_for("rewild", k + 1, rule["id"].replace("_", " "), 5 if k == 0 else 6, rule)

    # Permanent ice (terrain/ice.tif, the base layer's ice step): bare, whatever the community
    ice_p = tile.path("terrain/ice.tif")
    if ice_p.exists():
        from rasterio.enums import Resampling as _R
        with rasterio.open(ice_p) as src:
            ice = src.read(1, out_shape=index.shape, resampling=_R.average) >= 0.5
        if ice.any():
            index[ice] = row_for("ice", 1, "permanent snow and ice", 8, RULES[1])

    # Terrain (TERRAIN): each community row splits by the cells' terrain classes into the rows whose
    # weights differ; cells of one community and terrain response share a row.
    base_rows = sorted(rows.values(), key=lambda r: r["index"])
    # The tile pool (outside California, 2026-11-04): a community no rule matched and whose name names no species takes
    # the species of the tile's other communities of the same habitat class, weighted by their cells; none: bare, recorded.
    cells_n = {b["index"]: int((index == b["index"]).sum()) for b in base_rows}
    for b in base_rows:
        if not b["rule"].startswith("tile_pool_"):
            continue
        pool_t, pool_s = {}, {}
        donors = [d for d in base_rows if d["habitat"] == b["habitat"] and not d["rule"].startswith(("tile_pool_", "open_water", "snow_ice"))]
        for d in donors:
            for k, w in d["trees"].items():
                pool_t[k] = pool_t.get(k, 0.0) + w * cells_n[d["index"]]
            for k, w in d["shrubs"].items():
                pool_s[k] = pool_s.get(k, 0.0) + w * cells_n[d["index"]]
        if pool_t or pool_s:
            b["trees"], b["shrubs"] = pool_t, pool_s
            nd = sum(cells_n[d["index"]] for d in donors) or 1
            b["tree_density"] = sum(d["tree_density"] * cells_n[d["index"]] for d in donors) / nd
            b["shrub_density"] = sum(d["shrub_density"] * cells_n[d["index"]] for d in donors) / nd
        else:
            from . import runlog
            runlog.fallback(f"community '{b['name'] or b['source']}' ({cells_n[b['index']]} cells): no rule, no species in its "
                            f"name, no other {CLASSES.get(b['habitat'])} community on the tile: drawn bare")
            for u in unmatched:
                if (u["source"], u["code"]) == (b["source"], b["code"]):
                    u["drawn"] = "bare (nothing known)"
    # The tile's context (2026-11-04): coastal when COAST_WORDS name COAST_MIN of its community cells (COAST_SUBST)
    cells_by = {b["index"]: int((index == b["index"]).sum()) for b in base_rows}
    tot = sum(v for b in base_rows for k, v in cells_by.items() if k == b["index"] and b["rule"] != "open_water") or 1
    coast_cells = sum(cells_by[b["index"]] for b in base_rows
                      if b["source"] != "rewild" and any(w in (b["name"] or "").lower() for w in COAST_WORDS))
    CONTEXT["coast"] = coast_cells / tot >= COAST_MIN and "california" in regions
    SUBSTITUTIONS.clear()
    LOCAL_RECORDS_SKIPPED.clear(); LOCAL_RECORDS_SCALED.clear()
    gspecies = ground_species(regions, tile)   # a tile outside every table's region: none, recorded below
    # A tile outside every table's region (2026-11-06, iteration 7): its own ground layer, each community's grasses and
    # forbs from its LANDFIRE description (pipeline/ground_cards.py, species/ground.json), weight x the record's density
    from .ground_cards import own_ground
    own = own_ground(tile) if not regions else None
    if own:
        gspecies = []
        for k in sorted({k for w in own.values() for k in w}):
            f = LIBRARY / f"{k}.json"
            if not f.exists():
                continue
            d = json.loads(f.read_text())
            gspecies.append({"id": k, "form": d.get("form"), "habitat": d.get("habitat") or {},
                             "density": float((d.get("ground") or {}).get("density", 1.0))})
        dens_of = {sp["id"]: sp["density"] for sp in gspecies}
    for b in base_rows:
        if own:
            b["ground"] = {k: w * dens_of[k] for k, w in own.get((b["source"], int(b["code"])), {}).items() if k in dens_of}
        else:
            b["ground"] = ground_weights(b["habitat"], b["rule"], gspecies, b.get("name"))
    # the dwarf shrubs of each community into its ground layer (split_dwarf_shrubs), as ground species with their own
    # terrain factors (their records' habitat block)
    dwarfs: list[str] = []
    for b in base_rows:
        for k in split_dwarf_shrubs(b):
            if k not in dwarfs:
                dwarfs.append(k)
    for k in dwarfs:
        gspecies.append({"id": k, "form": "dwarf_shrub", "habitat": _record_habitat(k) or {}, "density": 1.0})
    ground_cols = [sp["id"] for sp in gspecies]
    tcls = terrain_classes(tile, index.shape) + NTC * grove_mask(tile, index.shape)
    pair = index * (2 * NTC) + tcls
    # weights first (after the zones, the coast, the groves and the stand-ins), so the columns hold every species drawn
    weights = {}
    for code in np.unique(pair).tolist():
        b = base_rows[code // (2 * NTC) - 1] if code >= 2 * NTC else None
        if b is None:
            continue
        t = code % (2 * NTC)
        weights[code] = (b, t, terrain_weights(b["trees"], t, b["fixed"], b["rule"]), terrain_weights(b["shrubs"], t, b["fixed"], b["rule"]))
    trees_cols, shrub_cols = columns(base_rows, [w[2] for w in weights.values()], [w[3] for w in weights.values()])
    nt, ns, ng = len(trees_cols), len(shrub_cols), len(ground_cols)
    final: dict[tuple, dict] = {}
    from .regions import covers as _covers
    regional = bool(_covers("landfire", tile))   # the regional tables' densities were tuned by eye: crown_fill only elsewhere
    out_index = np.zeros(index.shape, "int64")
    for code, (b, t, tw, sw) in weights.items():
        tb = _bytes(tw, trees_cols)
        sb = _bytes(sw, shrub_cols)
        gb = _bytes(ground_terrain(b["ground"], t, gspecies), ground_cols)
        key = (b["source"], b["code"], tuple(tb), tuple(sb), tuple(gb))
        r = final.get(key)
        if r is None:
            r = final[key] = {"index": len(final) + 1, "source": b["source"], "code": b["code"], "name": b["name"],
                              "rule": b["rule"], "community": b["index"], "terrain": [], "cells": 0, "_tb": tb, "_sb": sb, "_gb": gb,
                              "tree_density": b["tree_density"] * (1.0 if regional else crown_fill(b["trees"])), "shrub_density": b["shrub_density"],
                              "carpet_density": b.get("carpet_density", 0.0)}
            if r["index"] > 65535:
                raise ValueError("more than 65535 distinct mixes; species_mix_index.png holds 16 bits")
        r["terrain"].append(terrain_label(t))
        out_index[pair == code] = r["index"]
    index = out_index
    table = sorted(final.values(), key=lambda r: r["index"])
    # Per-row bytes: tree weights over the tree columns, shrub weights over the shrub columns (each
    # summing to 255 or all zero), then the two density bytes. lut[0] (no mix) is all zero.
    lut = np.zeros((len(table) + 1, nt + ns + ng + 3), "int64")
    for r in table:
        tb, sb, gb = r.pop("_tb"), r.pop("_sb"), r.pop("_gb")
        td = min(round(r["tree_density"] * DENSITY_SCALE), 255)
        sd = min(round(r["shrub_density"] * DENSITY_SCALE), 255)
        cd = min(round(r["carpet_density"] * DENSITY_SCALE), 255)
        lut[r["index"]] = tb + sb + gb + [td, sd, cd]
        r["cells"] = int((index == r["index"]).sum())
        r["tree_bytes"] = [[k, b] for k, b in zip(trees_cols, tb) if b]
        r["shrub_bytes"] = [[k, b] for k, b in zip(shrub_cols, sb) if b]
        r["ground_bytes"] = [[k, b] for k, b in zip(ground_cols, gb) if b]
        r["density_bytes"] = [td, sd, cd] if cd else [td, sd]   # [2]: the dwarf-shrub carpet (split_dwarf_shrubs)
        del r["tree_density"], r["shrub_density"], r["carpet_density"]
    structure = stand_structure(tile, index, table, classes)
    # The communities as written (one per source and code, before the terrain factors), for people.
    communities = [{"community": b["index"], "source": b["source"], "code": b["code"], "name": b["name"], "rule": b["rule"],
                    "trees": b["trees"], "shrubs": b["shrubs"], "ground": {k: round(v, 3) for k, v in b["ground"].items()}, "tree_density": b["tree_density"],
                    "shrub_density": b["shrub_density"], **({"carpet_density": round(b["carpet_density"], 4)} if b.get("carpet_density") else {}),
                    "note": b["note"], "fixed": b["fixed"],
                    "cells": int(sum(r["cells"] for r in table if r["community"] == b["index"]))} for b in base_rows]
    px = lut[index]
    TD, SD, CD = nt + ns + ng, nt + ns + ng + 1, nt + ns + ng + 2
    for old in ("species_mix_a.png", "species_mix_b.png", "species_mix_c.png"):   # format 1 products
        if tile.path(f"client/{old}").exists():
            tile.path(f"client/{old}").unlink()
    index_bytes = 1 if len(table) <= 255 else 2
    if index_bytes == 1:
        Image.fromarray(index.astype("uint8"), "L").save(tile.path("client/species_mix_index.png"), optimize=True)
    else:
        rgb = np.stack([index & 255, index >> 8, np.zeros_like(index)], -1).astype("uint8")
        Image.fromarray(rgb, "RGB").save(tile.path("client/species_mix_index.png"), optimize=True)
    dens = np.stack([px[..., TD], px[..., SD], px[..., CD]], -1).astype("uint8")
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
    from .regions import covers as _covers
    doc = {
        "format": FORMAT,
        # outside the regional tables (LANDFIRE's reach) a cell whose row has no trees or shrubs draws none: the client's
        # own habitat-class mix is California's and must not stand in (world pipeline phase 1, 2026-11-06)
        "class_fallback": bool(_covers("landfire", tile)),
        # the natural regions whose tables the tile uses (pipeline/regions.py NATURAL); empty: none, and the client's grass
        # layer draws only the tile's own grasses (client/src/grass.js ownGround, grassSet)
        "natural_regions": list(regions),
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
                       "with client/canopy.png cover); B carpet_density, the dwarf shrubs' share of the shrub density, "
                       "laid by the ground layer as a carpet in proportion to the canopy.png shrub cover (0: none). The "
                       "same bytes as the row's density_bytes [tree, shrub(, carpet)]",
            "weights": "mixes[].tree_bytes and shrub_bytes: [[species id, byte], ...], the species with a non-zero weight "
                       "in the column order of `species`, each layer summing to 255 (absent: no trees or no shrubs). "
                       "The client draws a species by walking this list in order, so the order is part of the format",
            "ground": "mixes[].ground_bytes: [[species id, byte], ...] over species.ground (the grasses and forbs, "
                      "library records of form grass or forb, and the dwarf shrubs of the tile's communities: records "
                      "whose ground block is woody, moved from the shrubs), summing to 255; from each record's habitat block "
                      "(classes, floor / mid / steep / north) and ground.density, with GROUND_RULES per rule. The "
                      "client's grass layer draws a cell's grasses from the grasses' share of it and the forb layer "
                      "its forbs from the forbs' share",
            "terrain": "mixes[].terrain: the terrain classes (effective elevation band, floor / mid-slope / steep, north) "
                       "whose cells use the row; a community (communities[], one per source and code: its name, the "
                       "weights and densities as written, and a note) has one row per distinct terrain response "
                       "(pipeline species_mix.py TERRAIN), and mixes[].community names it. The bytes are after the "
                       "terrain factors",
            "structure": STRUCTURE_ENCODING,
        },
        "mixes": table,
        "communities": communities,
        "unmatched": unmatched,
        "fractions": fractions,
        "local_records_skipped": LOCAL_RECORDS_SKIPPED, "local_records_scaled": LOCAL_RECORDS_SCALED,   # borrowed cards without local records (_local_ok; riparian_rows below adds its own)
        "riparian": riparian_rows(regions, tile),   # the zone mixes (pipeline/water.py reads the zones; the water step rewrites this key too)
        # 2026-11-04: the species a rule names that have no record yet and the record drawn for each; the tile's context
        "substitutions": dict(sorted(SUBSTITUTIONS.items())),
        "context": {"coast": CONTEXT["coast"], "coast_share": round(coast_cells / tot, 4), "bands_m": list(ELEV_BANDS),
                    "groves": int((tcls >= NTC).sum())},
    }
    _write_doc(tile.path("client/species_mix.json"), doc)
    files = ["client/species_mix_index.png", "client/species_mix_density.png"]
    return {"path": "client/species_mix.json", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": int(index.shape[0]), "resolution_m": res, "format": FORMAT,
            "files": {f: {"sha256": sha256(tile.path(f)), "bytes": tile.path(f).stat().st_size} for f in files},
            "derived_from": ["vegetation.evt", "vegetation.bps", "vegetation.classes", "vegetation.habitat", "vegetation.evc",
                             "vegetation.evh", "terrain.dem"],
            "encoding": "format 2: species_mix_index L = row in mixes; species_mix_density RGB = tree_density, shrub_density "
                        "(byte/100); per-row weights as mixes[].tree_bytes / shrub_bytes over species.trees / species.shrubs",
            "species": {"trees": trees_cols, "shrubs": shrub_cols, "ground": ground_cols},
            "mixes": len(table), "unmatched": len(unmatched), "fractions": fractions, "structure": structure}


if __name__ == "__main__":   # python -m pipeline.species_mix --structure <tile id>: add the stand structure to a built tile
    import argparse
    ap = argparse.ArgumentParser(description="species mix helpers")
    ap.add_argument("--structure", metavar="TILE", required=True)
    a = ap.parse_args()
    print(json.dumps(patch_structure(Tile.from_id(a.structure))))
