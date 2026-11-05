"""The species a vegetation community's name names, and the stand-in drawn for one the library does not have.

LANDFIRE names its communities by their dominant species ("Mediterranean California Red Fir Forest", "Sierra Nevada
Subalpine Lodgepole Pine Forest and Woodland", "California Coastal Redwood Forest", "Inter-Mountain Basins Curl-leaf
Mountain Mahogany Woodland"). LEXICON reads those names: a phrase -> the species it means (library ids: the scientific
name, lower case, underscores). A tile's needs (pipeline/needs.py) are the species its communities' names and its
species-mix rules name, and its GBIF plant records; the registry (pipeline/registry.py) looks each one up.

STAND_IN gives, for a species the library has no record of yet, the record drawn in its place (the same genus where
there is one, else the same family and leaf type), so a rule may name the species the community really holds before
its record exists: species_mix.resolve() swaps in the stand-in, and the tile's registry report says so.

The lexicon is the extension point for a new region: a tile whose communities name species not listed here has those
communities `unmatched` in species_mix.json and their names listed in the needs file as `unread`, which is the cue to
add their phrases here and their trait cards to library/plant_cards/.
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

# For a species without a record: what is drawn instead (the same genus, else the same family and leaf type).
# Every id here also has a trait card in library/plant_cards/ (or should get one); the card's own stand_in wins.
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
}


def named_species(name: str) -> list[tuple[str, str]]:
    """The species a community name names, longest phrase first; a phrase inside a matched one is not matched again."""
    n = (name or "").lower()
    out, used = [], []
    for phrase in sorted(LEXICON, key=len, reverse=True):
        hit = next((mt.start() for mt in re.finditer(r"\b" + re.escape(phrase) + r"\b", n)
                    if not any(a <= mt.start() < b for a, b in used)), None)   # whole words: "subalpine" is not "alpine"
        if hit is None:
            continue
        i = hit
        used.append((i, i + len(phrase)))
        for sid, kind in LEXICON[phrase]:
            if sid not in [s for s, _ in out]:
                out.append((sid, kind))
    return out


def has_record(sid: str) -> bool:
    return (LIBRARY / f"{sid}.json").exists()


def stand_in(sid: str) -> str | None:
    """The record drawn for `sid`: itself when the library has it, else its card's stand_in, else STAND_IN, followed
    until a record exists (None if the chain ends without one)."""
    seen = set()
    cur = sid
    while cur and cur not in seen:
        if has_record(cur):
            return cur
        seen.add(cur)
        card = LIBRARY.parent / "plant_cards" / f"{cur}.json"
        nxt = None
        if card.exists():
            try:
                nxt = json.loads(card.read_text()).get("stand_in")
            except Exception:  # noqa: BLE001
                nxt = None
        cur = nxt or STAND_IN.get(cur)
    return None
