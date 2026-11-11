"""The species a vegetation community's name names, and the stand-in drawn for one the library does not have.

LANDFIRE names its communities by their dominant species ("Mediterranean California Red Fir Forest", "Sierra Nevada
Subalpine Lodgepole Pine Forest and Woodland", "California Coastal Redwood Forest", "Inter-Mountain Basins Curl-leaf
Mountain Mahogany Woodland"). LEXICON reads those names: a phrase -> the species it means (library ids: the scientific
name, lower case, underscores). A tile's needs (pipeline/needs.py) are the species its communities' names and its
species-mix rules name, and its GBIF plant records; the registry (pipeline/registry.py) looks each one up.

By place (2026-11-10). LEXICON is California's reading and LEXICON_BY_REGION the Pacific Northwest's: a tile in one of
those regions reads its names by its region's table, as written. A tile in no table's region (the Grand Canyon,
Yellowstone, the Tetons) has no reading of its own, and California's is wrong there ("pinyon" is singleleaf pinyon in
California and Colorado pinyon on the Colorado Plateau; "juniper" is Sierra juniper or Utah juniper), so there a phrase
is read by the tile's own records (named_species with a tile): every species the phrase can mean anywhere (the regional
tables' readings, WORDS and MEMBERS) is a candidate, a candidate counts where GBIF has it near the tile
(local_records), a word for one kind of plant takes its best-recorded candidate, and a community phrase keeps every
member recorded there.

Stand-ins by place (2026-11-10). A species a rule or a name gives that the library has no record of is drawn by a
stand-in only if the stand-in belongs to the tile (belongs: recorded near it, or, where the records cannot say, a
record of the tile's own region) and is its relative: the same genus, else the same family and growth form
(local_stand_in). With no such record the species is missing: species_mix leaves it out, its share goes to the
community's other species, and the mix document lists it (`missing`). STAND_IN, the table written for California, is
only a preference among the records that pass. Before, STAND_IN was followed wherever the tile was, in silence: gray
pine for singleleaf pinyon on 16 % of the Grand Canyon's canopy.

The lexicon is the extension point for a new region: a tile whose communities name species not listed here has those
communities `unmatched` in species_mix.json and their names listed in the needs file as `unread`, which is the cue to
add their phrases here (WORDS, MEMBERS) and their trait cards to library/plant_cards/.
"""
from __future__ import annotations

import json
import pathlib
import re

LIBRARY = pathlib.Path(__file__).resolve().parent.parent / "library" / "species"

# phrase (lower case) -> [(species id, kind)]; `kind` tree | shrub | ground. Longer phrases are matched first, and a
# phrase inside a matched longer one is not matched again ("coast live oak" is not also "live oak").
LEXICON: dict[str, list[tuple[str, str]]] = {
    # conifers
    "red fir": [("abies_magnifica", "tree")],
    "white fir": [("abies_concolor", "tree")],
    "grand fir": [("abies_grandis", "tree")],
    "subalpine fir": [("abies_lasiocarpa", "tree")],
    "noble fir": [("abies_procera", "tree")],
    "silver fir": [("abies_amabilis", "tree")],
    "douglas-fir": [("pseudotsuga_menziesii", "tree")],
    "western hemlock": [("tsuga_heterophylla", "tree")],
    "mountain hemlock": [("tsuga_mertensiana", "tree")],
    "lodgepole pine": [("pinus_contorta", "tree")],
    "jeffrey pine": [("pinus_jeffreyi", "tree")],
    "ponderosa pine": [("pinus_ponderosa", "tree")],
    "sugar pine": [("pinus_lambertiana", "tree")],
    "foothill pine": [("pinus_sabiniana", "tree")],
    "gray pine": [("pinus_sabiniana", "tree")],
    "limber pine": [("pinus_flexilis", "tree")],
    "whitebark pine": [("pinus_albicaulis", "tree")],
    "western white pine": [("pinus_monticola", "tree")],
    "bristlecone": [("pinus_longaeva", "tree")],
    "pinyon": [("pinus_monophylla", "tree")],
    "knobcone": [("pinus_attenuata", "tree")],
    "closed-cone conifer": [("pinus_radiata", "tree"), ("hesperocyparis_macrocarpa", "tree"), ("pinus_muricata", "tree")],
    "monterey pine": [("pinus_radiata", "tree")],
    "bishop pine": [("pinus_muricata", "tree")],
    "cypress": [("hesperocyparis_macrocarpa", "tree")],
    "redwood": [("sequoia_sempervirens", "tree")],
    "giant sequoia": [("sequoiadendron_giganteum", "tree")],
    "incense cedar": [("calocedrus_decurrens", "tree")],
    "juniper": [("juniperus_grandis", "tree")],
    "subalpine woodland": [("pinus_albicaulis", "tree"), ("tsuga_mertensiana", "tree"), ("pinus_contorta", "tree"),
                           ("pinus_monticola", "tree"), ("juniperus_grandis", "tree")],
    "mixed conifer": [("pinus_ponderosa", "tree"), ("pinus_lambertiana", "tree"), ("abies_concolor", "tree"),
                      ("calocedrus_decurrens", "tree"), ("pseudotsuga_menziesii", "tree"), ("quercus_kelloggii", "tree")],
    # broadleaf trees
    "aspen": [("populus_tremuloides", "tree")],
    "cottonwood": [("populus_fremontii", "tree")],
    "blue oak": [("quercus_douglasii", "tree")],
    "valley oak": [("quercus_lobata", "tree")],
    "black oak": [("quercus_kelloggii", "tree")],
    "coast live oak": [("quercus_agrifolia", "tree")],
    "coastal live oak": [("quercus_agrifolia", "tree")],
    "canyon live oak": [("quercus_chrysolepis", "tree")],
    "interior live oak": [("quercus_wislizeni", "tree")],
    "oregon white oak": [("quercus_garryana", "tree")],
    "tanoak": [("notholithocarpus_densiflorus", "tree")],
    "madrone": [("arbutus_menziesii", "tree")],
    "bay": [("umbellularia_californica", "tree")],
    "alder": [("alnus_rhombifolia", "tree")],
    "willow": [("salix_lasiolepis", "tree")],
    "sycamore": [("platanus_racemosa", "tree")],
    "walnut": [("juglans_hindsii", "tree")],
    "buckeye": [("aesculus_californica", "tree")],
    "curl-leaf mountain mahogany": [("cercocarpus_ledifolius", "tree")],
    "mixed evergreen": [("quercus_chrysolepis", "tree"), ("arbutus_menziesii", "tree"), ("umbellularia_californica", "tree"),
                        ("notholithocarpus_densiflorus", "tree"), ("pseudotsuga_menziesii", "tree")],
    # shrubs
    "coastal scrub": [("baccharis_pilularis", "shrub"), ("artemisia_californica", "shrub"), ("diplacus_aurantiacus", "shrub"),
                      ("lupinus_arboreus", "shrub"), ("frangula_californica", "shrub"), ("toxicodendron_diversilobum", "shrub")],
    "coastal dune": [("ericameria_ericoides", "shrub"), ("lupinus_arboreus", "shrub"), ("artemisia_californica", "shrub")],
    "maritime chaparral": [("arctostaphylos_manzanita", "shrub"), ("ceanothus_cuneatus", "shrub"), ("adenostoma_fasciculatum", "shrub")],
    "montane woodland and chaparral": [("quercus_chrysolepis", "tree"), ("quercus_vacciniifolia", "shrub"),
                                       ("arctostaphylos_patula", "shrub"), ("ceanothus_cordulatus", "shrub"),
                                       ("chrysolepis_sempervirens", "shrub")],
    "chaparral": [("adenostoma_fasciculatum", "shrub"), ("arctostaphylos_viscida", "shrub"), ("ceanothus_cuneatus", "shrub")],
    "chamise": [("adenostoma_fasciculatum", "shrub")],
    "manzanita": [("arctostaphylos_viscida", "shrub")],
    "sagebrush": [("artemisia_tridentata", "shrub")],
    "bitterbrush": [("purshia_tridentata", "shrub")],
    "greasewood": [("sarcobatus_vermiculatus", "shrub")],
    "rabbitbrush": [("ericameria_nauseosa", "shrub")],
    "scrub oak": [("quercus_berberidifolia", "shrub")],
    "alpine dwarf-shrubland": [("phyllodoce_breweri", "shrub")],
    "alpine": [("phyllodoce_breweri", "shrub")],
}

# The same phrase means other species elsewhere (2026-11-04): a region's own reading wins over LEXICON's (which was
# written for California). Keys are pipeline/regions.py NATURAL regions.
LEXICON_BY_REGION: dict[str, dict[str, list[tuple[str, str]]]] = {
    "pacific_northwest": {
        "western red-cedar": [("thuja_plicata", "tree")], "red-cedar": [("thuja_plicata", "tree")],
        "redcedar": [("thuja_plicata", "tree")], "western hemlock": [("tsuga_heterophylla", "tree")],
        "silver fir": [("abies_amabilis", "tree")], "subalpine fir": [("abies_lasiocarpa", "tree")],
        "sitka spruce": [("picea_sitchensis", "tree")], "red alder": [("alnus_rubra", "tree")],
        "alder": [("alnus_rubra", "tree")], "cottonwood": [("populus_trichocarpa", "tree")],
        "black cottonwood": [("populus_trichocarpa", "tree")], "vine maple": [("acer_circinatum", "shrub")],
        "bigleaf maple": [("acer_macrophyllum", "tree")], "maple": [("acer_macrophyllum", "tree")],
        "madrone": [("arbutus_menziesii", "tree")], "oregon white oak": [("quercus_garryana", "tree")],
        "oak": [("quercus_garryana", "tree")], "willow": [("salix_lasiandra", "tree")],
        "juniper": [("juniperus_occidentalis", "tree")],
        "mixed conifer": [("pseudotsuga_menziesii", "tree"), ("tsuga_heterophylla", "tree"), ("thuja_plicata", "tree")],
        "subalpine parkland": [("abies_lasiocarpa", "tree"), ("tsuga_mertensiana", "tree"), ("phyllodoce_empetriformis", "shrub"),
                               ("cassiope_mertensiana", "shrub")],
        "subalpine woodland": [("abies_lasiocarpa", "tree"), ("tsuga_mertensiana", "tree"), ("pinus_albicaulis", "tree")],
        "alpine dwarf-shrubland": [("phyllodoce_empetriformis", "shrub"), ("cassiope_mertensiana", "shrub")],
        "alpine": [("phyllodoce_empetriformis", "shrub"), ("cassiope_mertensiana", "shrub")],
        "avalanche chute": [("acer_circinatum", "shrub"), ("rubus_spectabilis", "shrub"), ("alnus_rubra", "tree")],
        "riparian": [("alnus_rubra", "tree"), ("populus_trichocarpa", "tree"), ("rubus_spectabilis", "shrub")],
        "manzanita": [("arctostaphylos_columbiana", "shrub")],
        "coastal sand dune": [("pinus_contorta", "tree"), ("picea_sitchensis", "tree"), ("gaultheria_shallon", "shrub")],
        "headland": [("picea_sitchensis", "tree"), ("gaultheria_shallon", "shrub"), ("rubus_spectabilis", "shrub")],
        "herbaceous bald": [("pseudotsuga_menziesii", "tree"), ("quercus_garryana", "tree")],
        "volcanic flowage": [("pseudotsuga_menziesii", "tree"), ("tsuga_heterophylla", "tree"), ("pinus_contorta", "tree")],
        "wet meadow": [("salix_lasiandra", "tree"), ("rubus_spectabilis", "shrub")],
        "emergent marsh": [("salix_lasiandra", "tree")],
    },
}

# The other species a phrase can mean outside the regional tables (2026-11-10). On a tile in no table's region a phrase
# is read by the tile's records (named_species), over these and the regional readings above. Lists, not per-tile fixes:
# the tile's records choose. WORDS: a word for one kind of plant and the species it can mean; the tile's best-recorded
# one is meant ("juniper" is one juniper). A phrase of LEXICON whose every reading is one species is a word too.
WORDS: dict[str, list[tuple[str, str]]] = {
    "pinyon": [("pinus_edulis", "tree"), ("pinus_quadrifolia", "tree"), ("pinus_cembroides", "tree")],
    "juniper": [("juniperus_osteosperma", "tree"), ("juniperus_scopulorum", "tree"), ("juniperus_monosperma", "tree"),
                ("juniperus_californica", "tree"), ("juniperus_deppeana", "tree"), ("juniperus_virginiana", "tree")],
    "spruce": [("picea_engelmannii", "tree"), ("picea_pungens", "tree"), ("picea_sitchensis", "tree"), ("picea_glauca", "tree"),
               ("picea_mariana", "tree"), ("picea_breweriana", "tree")],
    "fir": [("abies_lasiocarpa", "tree"), ("abies_concolor", "tree"), ("abies_grandis", "tree"), ("abies_magnifica", "tree"),
            ("abies_amabilis", "tree"), ("abies_procera", "tree")],
    "oak": [("quercus_gambelii", "tree"), ("quercus_garryana", "tree"), ("quercus_kelloggii", "tree"), ("quercus_chrysolepis", "tree"),
            ("quercus_douglasii", "tree"), ("quercus_agrifolia", "tree"), ("quercus_wislizeni", "tree"), ("quercus_lobata", "tree"),
            ("quercus_emoryi", "tree"), ("quercus_arizonica", "tree"), ("quercus_macrocarpa", "tree")],
    "gambel oak": [("quercus_gambelii", "tree")],
    "limber": [("pinus_flexilis", "tree")],   # "Limber-Bristlecone Pine Woodland": LEXICON's "limber pine" needs the words adjacent
    "cottonwood": [("populus_angustifolia", "tree"), ("populus_deltoides", "tree"), ("populus_balsamifera", "tree")],
    "alder": [("alnus_incana", "tree"), ("alnus_viridis", "shrub"), ("alnus_oblongifolia", "tree")],
    "willow": [("salix_exigua", "shrub"), ("salix_gooddingii", "tree"), ("salix_geyeriana", "shrub"), ("salix_boothii", "shrub"),
               ("salix_bebbiana", "shrub"), ("salix_scouleriana", "tree"), ("salix_wolfii", "shrub"), ("salix_drummondiana", "shrub")],
    "maple": [("acer_glabrum", "tree"), ("acer_grandidentatum", "tree"), ("acer_negundo", "tree")],
    "sagebrush": [("artemisia_nova", "shrub"), ("artemisia_cana", "shrub"), ("artemisia_arbuscula", "shrub"),
                  ("artemisia_tripartita", "shrub"), ("artemisia_bigelovii", "shrub"), ("artemisia_filifolia", "shrub")],
    "big sagebrush": [("artemisia_tridentata", "shrub")],
    "manzanita": [("arctostaphylos_pungens", "shrub"), ("arctostaphylos_patula", "shrub"), ("arctostaphylos_pringlei", "shrub")],
    "mountain mahogany": [("cercocarpus_ledifolius", "tree"), ("cercocarpus_montanus", "shrub"), ("cercocarpus_betuloides", "shrub"),
                          ("cercocarpus_intricatus", "shrub")],
    "rabbitbrush": [("chrysothamnus_viscidiflorus", "shrub")],
    "blackbrush": [("coleogyne_ramosissima", "shrub")],
    "mormon-tea": [("ephedra_viridis", "shrub"), ("ephedra_torreyana", "shrub"), ("ephedra_nevadensis", "shrub"), ("ephedra_trifurca", "shrub")],
    "creosotebush": [("larrea_tridentata", "shrub")],
    "white bursage": [("ambrosia_dumosa", "shrub")],
}
# MEMBERS: a community phrase and the further members it has elsewhere; every one recorded at the tile is kept.
MEMBERS: dict[str, list[tuple[str, str]]] = {
    "chaparral": [("quercus_turbinella", "shrub"), ("arctostaphylos_pungens", "shrub"), ("ceanothus_pauciflorus", "shrub"),
                  ("cercocarpus_montanus", "shrub"), ("garrya_flavescens", "shrub")],
    "mixed conifer": [("picea_pungens", "tree"), ("populus_tremuloides", "tree")],
    "subalpine woodland": [("abies_lasiocarpa", "tree"), ("picea_engelmannii", "tree"), ("pinus_flexilis", "tree")],
    "desert scrub": [("coleogyne_ramosissima", "shrub"), ("ephedra_viridis", "shrub"), ("ephedra_nevadensis", "shrub"),
                     ("larrea_tridentata", "shrub"), ("ambrosia_dumosa", "shrub"), ("encelia_farinosa", "shrub"),
                     ("atriplex_canescens", "shrub")],
    "salt desert scrub": [("atriplex_confertifolia", "shrub"), ("atriplex_canescens", "shrub"), ("krascheninnikovia_lanata", "shrub"),
                          ("sarcobatus_vermiculatus", "shrub")],
    "shrub-steppe": [("artemisia_tridentata", "shrub"), ("ericameria_nauseosa", "shrub"), ("chrysothamnus_viscidiflorus", "shrub"),
                     ("atriplex_canescens", "shrub"), ("ephedra_viridis", "shrub")],
    "montane shrubland": [("amelanchier_utahensis", "shrub"), ("amelanchier_alnifolia", "shrub"), ("cercocarpus_montanus", "shrub"),
                          ("prunus_virginiana", "shrub"), ("symphoricarpos_oreophilus", "shrub"), ("purshia_stansburiana", "shrub"),
                          ("purshia_tridentata", "shrub"), ("rosa_woodsii", "shrub"), ("ceanothus_velutinus", "shrub")],
    "foothill shrubland": [("amelanchier_utahensis", "shrub"), ("amelanchier_alnifolia", "shrub"), ("cercocarpus_montanus", "shrub"),
                           ("prunus_virginiana", "shrub"), ("symphoricarpos_oreophilus", "shrub"), ("purshia_stansburiana", "shrub"),
                           ("purshia_tridentata", "shrub"), ("rosa_woodsii", "shrub"), ("rhus_aromatica", "shrub")],
    "deciduous shrubland": [("amelanchier_alnifolia", "shrub"), ("prunus_virginiana", "shrub"), ("symphoricarpos_oreophilus", "shrub"),
                            ("symphoricarpos_albus", "shrub"), ("rosa_woodsii", "shrub"), ("acer_glabrum", "shrub"),
                            ("sorbus_scopulina", "shrub"), ("ceanothus_velutinus", "shrub")],
    "riparian": [("populus_angustifolia", "tree"), ("populus_fremontii", "tree"), ("salix_gooddingii", "tree"), ("acer_negundo", "tree"),
                 ("alnus_incana", "tree"), ("betula_occidentalis", "tree"), ("salix_exigua", "shrub"), ("salix_geyeriana", "shrub"),
                 ("salix_boothii", "shrub"), ("salix_bebbiana", "shrub"), ("cornus_sericea", "shrub"), ("rosa_woodsii", "shrub")],
}

# The regions each library record grows in (2026-11-04), for records that do not say so themselves (`regions`, written
# by plantgen from a card). Every record written before is California's; those that also grow in the Pacific
# Northwest are named here, so the riparian zone rows and the ground layer of an Olympic tile can still draw them.
ALSO_PNW = {
    "pseudotsuga_menziesii", "acer_macrophyllum", "arbutus_menziesii", "pinus_ponderosa", "pinus_contorta", "pinus_monticola",
    "pinus_albicaulis", "tsuga_mertensiana", "salix_lasiolepis", "salix_lasiandra", "salix_exigua", "cornus_sericea",
    "rubus_ursinus", "sambucus_nigra_caerulea", "symphoricarpos_albus", "toxicodendron_diversilobum", "gaultheria_shallon",
    "vaccinium_ovatum", "ceanothus_integerrimus", "rosa_californica", "achillea_millefolium", "elymus_glaucus",
    "danthonia_californica", "claytonia_perfoliata", "erythranthe_guttata", "urtica_dioica", "carex_nudata", "juncus_effusus",
    "typha_latifolia", "equisetum_hyemale", "schoenoplectus_acutus", "lemna_minor", "nasturtium_officinale",
    "artemisia_douglasiana", "trifolium_willdenovii", "plagiobothrys_nothofulvus",
}


def regions_of(sid: str, rec: dict | None = None) -> list[str]:
    """The natural regions a library record grows in: its own `regions`, else California (and the Pacific Northwest
    for ALSO_PNW)."""
    if rec is None:
        p = LIBRARY / f"{sid}.json"
        rec = json.loads(p.read_text()) if p.exists() else {}
    if rec.get("regions"):
        return list(rec["regions"])
    return ["california", "pacific_northwest"] if sid in ALSO_PNW else ["california"]


# For a species without a record: the record preferred as its stand-in, where that record passes local_stand_in's tests
# (it belongs to the tile and is the same genus, or the same family and growth form). Written for California and the
# Pacific Northwest; until 2026-11-10 it was followed on every tile, whatever the region. A card's own stand_in is
# preferred the same way.
STAND_IN = {
    "abies_magnifica": "pseudotsuga_menziesii", "abies_concolor": "pseudotsuga_menziesii", "abies_grandis": "pseudotsuga_menziesii",
    "abies_lasiocarpa": "pseudotsuga_menziesii", "abies_procera": "pseudotsuga_menziesii", "abies_amabilis": "pseudotsuga_menziesii",
    "tsuga_heterophylla": "pseudotsuga_menziesii", "tsuga_mertensiana": "pseudotsuga_menziesii",
    "pinus_contorta": "pinus_ponderosa", "pinus_jeffreyi": "pinus_ponderosa", "pinus_lambertiana": "pinus_ponderosa",
    "pinus_flexilis": "pinus_ponderosa", "pinus_albicaulis": "pinus_ponderosa", "pinus_monticola": "pinus_ponderosa",
    "pinus_longaeva": "pinus_ponderosa", "pinus_monophylla": "pinus_sabiniana", "pinus_attenuata": "pinus_sabiniana",
    "pinus_radiata": "pinus_ponderosa", "pinus_muricata": "pinus_radiata",
    "hesperocyparis_macrocarpa": "calocedrus_decurrens", "sequoia_sempervirens": "pseudotsuga_menziesii",
    "sequoiadendron_giganteum": "calocedrus_decurrens", "juniperus_grandis": "calocedrus_decurrens",
    "populus_tremuloides": "populus_fremontii", "quercus_agrifolia": "quercus_wislizeni", "quercus_garryana": "quercus_douglasii",
    "notholithocarpus_densiflorus": "quercus_chrysolepis", "cercocarpus_ledifolius": "cercocarpus_betuloides",
    "artemisia_californica": "baccharis_pilularis", "artemisia_tridentata": "baccharis_pilularis", "lupinus_arboreus": "baccharis_pilularis",
    "ericameria_ericoides": "adenostoma_fasciculatum", "ericameria_nauseosa": "baccharis_pilularis",
    "purshia_tridentata": "ceanothus_cuneatus", "sarcobatus_vermiculatus": "baccharis_pilularis",
    "quercus_berberidifolia": "ceanothus_cuneatus", "quercus_vacciniifolia": "ceanothus_cuneatus",
    "arctostaphylos_patula": "arctostaphylos_manzanita", "ceanothus_cordulatus": "ceanothus_cuneatus",
    "chrysolepis_sempervirens": "frangula_californica", "chamaebatia_foliolosa": "symphoricarpos_albus",
    "phyllodoce_breweri": "ribes_roezlii", "salix_arctica": "salix_exigua",
    "vaccinium_ovatum": "frangula_californica", "gaultheria_shallon": "frangula_californica",
    # the Pacific Northwest (2026-11-04)
    "picea_sitchensis": "pseudotsuga_menziesii", "tsuga_heterophylla": "tsuga_mertensiana", "thuja_plicata": "calocedrus_decurrens",
    "abies_amabilis": "abies_concolor", "abies_lasiocarpa": "abies_magnifica", "alnus_rubra": "alnus_rhombifolia",
    "populus_trichocarpa": "populus_fremontii", "acer_circinatum": "acer_macrophyllum", "rubus_spectabilis": "rubus_ursinus",
    "rubus_parviflorus": "rosa_californica", "vaccinium_parvifolium": "vaccinium_ovatum", "oplopanax_horridus": "sambucus_nigra_caerulea",
    "mahonia_nervosa": "toxicodendron_diversilobum", "phyllodoce_empetriformis": "phyllodoce_breweri",
    "cassiope_mertensiana": "phyllodoce_breweri", "quercus_garryana": "quercus_douglasii", "juniperus_occidentalis": "juniperus_grandis",
    "arctostaphylos_columbiana": "arctostaphylos_patula", "polystichum_munitum": "artemisia_douglasiana",
}


def _scan(name: str, lex: dict, pick) -> list[tuple[str, str]]:
    """The phrases of `lex` in a community name, longest first; a phrase inside a matched one is not matched again.
    pick(phrase) gives the species the phrase means here."""
    n = (name or "").lower()
    out, used = [], []
    for phrase in sorted(lex, key=len, reverse=True):
        hit = next((mt.start() for mt in re.finditer(r"\b" + re.escape(phrase) + r"\b", n)
                    if not any(a <= mt.start() < b for a, b in used)), None)   # whole words: "subalpine" is not "alpine"
        if hit is None:
            continue
        used.append((hit, hit + len(phrase)))
        for sid, kind in pick(phrase):
            if sid not in [s for s, _ in out]:
                out.append((sid, kind))
    return out


def _tables() -> list[dict]:
    return [LEXICON, *LEXICON_BY_REGION.values(), WORDS, MEMBERS]


def candidates(phrase: str) -> list[tuple[str, str]]:
    """Every species a phrase can mean anywhere: the regional readings, then WORDS and MEMBERS, in that order."""
    out = []
    for table in _tables():
        for sid, kind in table.get(phrase, []):
            if sid not in [s for s, _ in out]:
                out.append((sid, kind))
    return out


def is_word(phrase: str) -> bool:
    """A word for one kind of plant (one species is meant: the best recorded), not a community phrase (every member)."""
    if phrase in MEMBERS:
        return False
    return phrase in WORDS or all(len(t[phrase]) == 1 for t in (LEXICON, *LEXICON_BY_REGION.values()) if phrase in t)


def read_by_records(phrase: str, tile) -> list[tuple[str, str]]:
    """A phrase read by the tile's records: its candidates recorded near the tile (MIN_LOCAL_RECORDS or more); of a word,
    the best recorded (the earlier candidate on a tie); of a community phrase, all of them. None recorded, or the
    records cannot say (local_records None): nothing, never another region's reading."""
    from .species_mix import MIN_LOCAL_RECORDS
    local = []
    for sid, kind in candidates(phrase):
        n = local_records(tile, sid)
        if n is not None and n >= MIN_LOCAL_RECORDS:
            local.append((n, sid, kind))
    if not local:
        return []
    if is_word(phrase):
        n, sid, kind = max(local, key=lambda x: x[0])   # max keeps the first of equals
        return [(sid, kind)]
    return [(sid, kind) for _, sid, kind in local]


def has_table(regions) -> bool:
    """Whether one of the regions has a reading of its own (California's LEXICON, or a LEXICON_BY_REGION table)."""
    return any(r == "california" or r in LEXICON_BY_REGION for r in regions or [])


def named_species(name: str, regions=None, tile=None) -> list[tuple[str, str]]:
    """The species a community name names, longest phrase first; a phrase inside a matched one is not matched again.
    A tile in a region with a table reads a phrase its region's way (LEXICON_BY_REGION over LEXICON; regions None:
    California's), as written. A tile in no table's region reads it by its own records (read_by_records). With no
    tile and no table (a caller that has no place to ask about): California's reading, as before 2026-11-10."""
    from .species_mix import CONTEXT
    regions = list(regions) if regions is not None else (CONTEXT.get("regions") or ["california"])
    if has_table(regions) or (tile is None and RECORDS is None):
        lex = dict(LEXICON)
        for r in regions:
            lex.update(LEXICON_BY_REGION.get(r, {}))
        return _scan(name, lex, lambda phrase: lex[phrase])
    phrases = {ph: True for table in _tables() for ph in table}
    return _scan(name, phrases, lambda phrase: read_by_records(phrase, tile))


def has_record(sid: str) -> bool:
    return (LIBRARY / f"{sid}.json").exists()


# ----------------------------------------------------------------------------------------------- belonging to a place

RECORDS = None   # tests: a callable (tile, species id) -> count or None, asked in place of GBIF
_LOCAL: dict = {}
_FAMILY: dict = {}


def scientific_of(sid: str) -> str:
    return " ".join(sid.split("_")).capitalize()


def local_records(tile, sid: str) -> int | None:
    """GBIF records of the species within species_mix.LOCAL_RECORDS_BUFFER_M of the tile over the presence years (the
    same count as species_mix._local_ok's: fetch_species.records_near, cached per tile), or None where the records
    cannot say: no tile, a name GBIF does not know, a search that failed, or an area with fewer than LOCAL_EFFORT_MIN
    plant records around it (an absence there means nothing)."""
    if RECORDS is not None:
        return RECORDS(tile, sid)
    if tile is None:
        return None
    k = (tile.tile_id, sid)
    if k not in _LOCAL:
        from datetime import date
        from . import species_mix as sm
        from .fetch_species import PRESENCE_YEARS, _q, records_near
        n = None
        try:
            r = _q(None, "species/match", {"name": scientific_of(sid), "strict": "true"})
            key = r.get("acceptedUsageKey") or r.get("usageKey")
            if key and r.get("matchType") != "NONE":
                y1 = date.today().year
                if tile.tile_id not in sm._EFFORT:
                    sm._EFFORT[tile.tile_id] = records_near(tile, sm.TRACHEOPHYTA_KEY, (y1 - PRESENCE_YEARS, y1), buf_m=sm.LOCAL_RECORDS_BUFFER_M)
                if sm._EFFORT[tile.tile_id] >= sm.LOCAL_EFFORT_MIN:
                    n = records_near(tile, key, (y1 - PRESENCE_YEARS, y1), buf_m=sm.LOCAL_RECORDS_BUFFER_M)
        except Exception:  # noqa: BLE001 (offline: no evidence)
            n = None
        _LOCAL[k] = n
    return _LOCAL[k]


def belongs(tile, sid: str, regions) -> tuple[bool, str]:
    """Whether a library record belongs to the tile's place, and why: recorded near it (MIN_LOCAL_RECORDS or more); not,
    where the area is well recorded and it is not; where the records cannot say, whether it is a record of one of the
    tile's natural regions (regions_of)."""
    from .species_mix import LOCAL_RECORDS_BUFFER_M, MIN_LOCAL_RECORDS
    n = local_records(tile, sid)
    km = LOCAL_RECORDS_BUFFER_M // 1000
    if n is not None:
        return n >= MIN_LOCAL_RECORDS, f"{n} records within {km} km"
    ok = bool(set(regions_of(sid)) & set(regions or []))
    return ok, "a record of the tile's region (no local records to ask)" if ok else "not of the tile's region (no local records to ask)"


def genus_of(sid: str) -> str:
    return sid.split("_")[0]


def family_of(sid: str) -> str | None:
    """The species' family: its card's or record's, else GBIF's (the cached name match); None when none says."""
    if sid not in _FAMILY:
        fam = None
        for p in (LIBRARY.parent / "plant_cards" / f"{sid}.json", LIBRARY / f"{sid}.json"):
            if p.exists():
                try:
                    fam = json.loads(p.read_text()).get("family")
                except ValueError:
                    fam = None
                if fam:
                    break
        if not fam:
            try:
                from .fetch_species import _q
                fam = _q(None, "species/match", {"name": scientific_of(sid), "strict": "true"}).get("family")
            except Exception:  # noqa: BLE001
                fam = None
        _FAMILY[sid] = fam
    return _FAMILY[sid]


# Families the client has no growth form for (2026-11-10): treegen.js grows trees, shrubs, multi-stemmed shrub-trees
# and palms (leafy crowns on woody stems), and the ground layer grasses and forbs. A cactus is pads or ribbed stems and
# a yucca or an agave a rosette of sword leaves; drawn from a leafy shrub's record they would be a bush. Until a
# succulent generator exists a species of these families without a record is missing, whatever relatives the tile has.
NO_GROWTH_FORM = {"Cactaceae": "a cactus", "Asparagaceae": "a rosette succulent (a yucca, an agave, a beargrass)",
                  "Agavaceae": "a rosette succulent (a yucca, an agave)", "Nolinaceae": "a rosette succulent (a beargrass)"}


FORMS_OF_LAYER = {"tree": ("tree", "multi_stem_shrub_tree", "palm"), "shrub": ("shrub", "multi_stem_shrub_tree")}   # the
# growth forms a stand-in in a layer may have (a multi-stemmed shrub-tree, a buckeye or a redbud, stands in either)


def _woody_records() -> dict:
    """{id: form} of the library's woody records, in index.json order."""
    out = {}
    try:
        ids = json.loads((LIBRARY / "index.json").read_text()).get("species", [])
    except (OSError, ValueError):
        ids = []
    for sid in ids:
        p = LIBRARY / f"{sid}.json"
        if sid.startswith("_") or not p.exists():
            continue
        try:
            form = json.loads(p.read_text()).get("form")
        except ValueError:
            continue
        if form in FORMS_OF_LAYER["tree"] or form in FORMS_OF_LAYER["shrub"]:
            out[sid] = form
    return out


def no_growth_form(sid: str) -> str | None:
    """What a species is ("a cactus (Cactaceae)") when the client has no growth form for it and the library no record
    of it (NO_GROWTH_FORM); None for every other species."""
    if has_record(sid):
        return None
    fam = family_of(sid)
    return f"{NO_GROWTH_FORM[fam]} ({fam})" if fam in NO_GROWTH_FORM else None


def fits_layer(sid: str, layer: str) -> bool:
    """Whether a species may be grown in a layer (tree | shrub): one without a record may (its stand-in is asked for
    later); one with a record only if the record's form is a woody one of that layer (FORMS_OF_LAYER)."""
    p = LIBRARY / f"{sid}.json"
    if not p.exists():
        return True
    try:
        return json.loads(p.read_text()).get("form") in FORMS_OF_LAYER.get(layer, ())
    except ValueError:
        return False


def _hint(sid: str) -> str | None:
    card = LIBRARY.parent / "plant_cards" / f"{sid}.json"
    if card.exists():
        try:
            h = json.loads(card.read_text()).get("stand_in")
            if h:
                return h
        except ValueError:
            pass
    return STAND_IN.get(sid)


def local_stand_in(sid: str, tile, regions, form: str | None = None) -> tuple[str | None, str]:
    """(the record drawn for `sid`, why). Itself when the library has it. Else a record that belongs to the tile
    (belongs) and is of its genus, else of its family and growth form (`form`: tree | shrub, the layer the species is
    named in, FORMS_OF_LAYER; a stand-in of the same genus must fit the layer too); among several, the preferred one
    (the card's stand_in, STAND_IN) and then the best recorded. None, and the reason, when no record passes: the
    species is missing."""
    if has_record(sid):
        return sid, "its own record"
    lib = _woody_records()
    hint = _hint(sid)

    def best(ids, how):
        ok = []
        for c in ids:
            yes, why = belongs(tile, c, regions)
            if yes:
                ok.append((c != hint, -(local_records(tile, c) or 0), c, why))
        if not ok:
            return None
        _, _, c, why = min(ok, key=lambda x: (x[0], x[1]))   # min keeps the first of equals: the library's order
        return c, f"no library record: drawn as {c} ({how}; {why})"

    fits = FORMS_OF_LAYER.get(form)
    same_genus = [c for c, f in lib.items() if genus_of(c) == genus_of(sid) and (fits is None or f in fits)]
    r = best(same_genus, "the same genus")
    if r:
        return r
    fam = family_of(sid)
    if fam in NO_GROWTH_FORM:
        return None, (f"no library record, and {NO_GROWTH_FORM[fam]} ({fam}) has no growth form in the client yet (treegen.js "
                      "draws leafy crowns on woody stems): never drawn as a leafy shrub; left out, and its place left empty "
                      "(species_mix.hold_empty)")
    if fam and fits:
        r = best([c for c, f in lib.items() if f in fits and c not in same_genus and family_of(c) == fam], f"the same family, {fam}, and growth form")
        if r:
            return r
    return None, ("no library record, and no record of its genus" + (f" or of its family ({fam}) and growth form" if fam and fits else "")
                  + " belongs to this tile: left out, its share to the community's other species")
