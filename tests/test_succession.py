"""The weights of a community's species (pipeline/succession.py, species_mix.named_rule, 2026-11-10).

Until then every species a community's name names got the same weight, and only those species: Lamar's "Spruce-Fir
Forest" was half Engelmann spruce and half subalpine fir, where its LANDFIRE description gives lodgepole pine the upper
canopy of most of the landscape. The weights now come from the description's succession classes (the share of each
class, its species in order of dominance), the name's own species weigh by how well they are recorded near the tile,
and California's terrain table stays in California. The records are given here by communities.RECORDS and the
descriptions by succession's caches (no network)."""
import io
import json
import sys
import types
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import communities as C  # noqa: E402
from pipeline import species_mix as sm  # noqa: E402

try:
    from pipeline import succession as S
except ImportError:   # the code before 2026-11-10: the tests below then fail on what named_rule draws
    S = None

TILE = types.SimpleNamespace(tile_id="test_outside_every_table")
SPRUCE_FIR = "Rocky Mountain Subalpine Dry-Mesic Spruce-Fir Forest and Woodland"
# the description of that system for the Yellowstone map zone (LANDFIRE BpS model 10550_21_22), as succession.classes_of
# reads it: lodgepole pine leads classes A-C (88 % of the landscape), fir and spruce only the last
SPRUCE_FIR_CLASSES = [
    {"class": "A", "share": 0.07, "species": [("Vaccinium scoparium", "lower"), ("Carex geyeri", "lower"), ("Pinus contorta", "upper")]},
    {"class": "B", "share": 0.33, "species": [("Pinus contorta", "upper"), ("Vaccinium scoparium", "lower"), ("Abies lasiocarpa", "middle")]},
    {"class": "C", "share": 0.48, "species": [("Pinus contorta", "upper"), ("Abies lasiocarpa", "mid-upper"), ("Vaccinium scoparium", "lower")]},
    {"class": "D", "share": 0.12, "species": [("Abies lasiocarpa", "upper"), ("Picea engelmannii", "upper"), ("Vaccinium scoparium", "lower")]},
]
DOUGLAS_FIR_CLASSES = [{"class": k, "share": s, "species": [("Pseudotsuga menziesii", "upper"), ("Pinus contorta", "upper")]}
                       for k, s in (("A", 0.07), ("B", 0.12), ("C", 0.14), ("D", 0.47), ("E", 0.20))]
BLACKBRUSH_CLASSES = [{"class": "B", "share": 1.0, "species": [("Coleogyne ramosissima", "upper"), ("Ephedra nevadensis", "upper"),
                                                                  ("Juniperus osteosperma", "upper")]}]


def docx(paragraphs: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document><w:body>{body}</w:body></w:document>")
    return buf.getvalue()


class Place(unittest.TestCase):
    """A tile outside every regional table, with `records` as its GBIF counts and `models` as its communities' own
    descriptions: {(source, code): (classes, vegetation type)}."""
    records: dict = {}
    models: dict = {}

    def setUp(self):
        self._saved = (C.RECORDS, dict(sm.CONTEXT))
        sm.RESOLUTION.clear(); sm.SUBSTITUTIONS.clear()
        C.RECORDS = lambda tile, sid: self.records.get(sid, 0)
        sm.CONTEXT.update(regions=[], tile=TILE, coast=False)
        if S is not None:
            self._plants = S._plants
            S._plants = lambda name: None
            S._IDS.clear()
            S._DOCS[TILE.tile_id] = {key: f"model_{i}" for i, key in enumerate(self.models)}
            for i, (classes, vtype) in enumerate(self.models.values()):
                S._LAYERS[(TILE.tile_id, f"model_{i}")] = (classes, vtype)

    def tearDown(self):
        C.RECORDS, ctx = self._saved
        sm.CONTEXT.clear(); sm.CONTEXT.update(ctx)
        sm.RESOLUTION.clear(); sm.SUBSTITUTIONS.clear()
        if S is not None:
            S._plants = self._plants
            S._IDS.clear(); S._DOCS.pop(TILE.tile_id, None)
            for k in [k for k in S._LAYERS if k[0] == TILE.tile_id]:
                del S._LAYERS[k]

    def rule(self, name, key, hab=3):
        try:
            return sm.named_rule(name, hab, key)
        except TypeError:          # the code before 2026-11-10 took no community key
            return sm.named_rule(name, hab)


class TestSeralDominant(Place):
    records = {"pinus_contorta": 390, "abies_lasiocarpa": 63, "picea_engelmannii": 36, "pseudotsuga_menziesii": 79}
    models = {("evt", 7055): (SPRUCE_FIR_CLASSES, "forest and woodland"), ("evt", 7166): (DOUGLAS_FIR_CLASSES, "forest and woodland")}

    def test_a_name_that_lists_the_climax_is_led_by_the_seral_dominant(self):
        # fails on the code before 2026-11-10: {picea_engelmannii: 1.0, abies_lasiocarpa: 1.0}, no lodgepole pine
        t = self.rule(SPRUCE_FIR, ("evt", 7055))["trees"]
        self.assertIn("pinus_contorta", t)
        self.assertGreater(t["pinus_contorta"], 0.6)
        self.assertGreater(t["pinus_contorta"], t["abies_lasiocarpa"])
        self.assertGreater(t["abies_lasiocarpa"], t["picea_engelmannii"])
        self.assertAlmostEqual(sum(t.values()), 1.0, places=2)

    def test_the_weights_are_the_class_shares_by_order_and_position(self):
        t = self.rule(SPRUCE_FIR, ("evt", 7055))["trees"]
        # A 0.07 lodgepole; B 0.33: lodgepole 1, fir 0.25 / 2; C 0.48: lodgepole 1, fir 0.5 / 2; D 0.12: fir 1, spruce 1 / 2
        pine = 0.07 + 0.33 * 1 / 1.125 + 0.48 * 1 / 1.25
        fir = 0.33 * 0.125 / 1.125 + 0.48 * 0.25 / 1.25 + 0.12 * 2 / 3
        spruce = sm.MEMBER_FLOOR                      # class D alone gives it 0.12 / 3 = 0.04: the name's floor holds it
        tot = pine + fir + spruce
        self.assertAlmostEqual(t["pinus_contorta"], pine / tot, places=3)
        self.assertAlmostEqual(t["abies_lasiocarpa"], fir / tot, places=3)
        self.assertAlmostEqual(t["picea_engelmannii"], spruce / tot, places=3)

    def test_the_first_listed_species_leads_its_class(self):
        t = self.rule("Middle Rocky Mountain Montane Douglas-fir Forest and Woodland", ("evt", 7166))["trees"]
        self.assertAlmostEqual(t["pseudotsuga_menziesii"], 2 / 3, places=2)   # the records (lodgepole 390, Douglas-fir 79)
        self.assertAlmostEqual(t["pinus_contorta"], 1 / 3, places=2)          # do not turn the order round

    def test_a_community_without_a_description_of_its_own_keeps_its_name(self):
        t = self.rule(SPRUCE_FIR, ("evt", 9999))["trees"]     # a borrowed model: not in succession.own_models
        self.assertEqual(set(t), {"picea_engelmannii", "abies_lasiocarpa"})
        self.assertAlmostEqual(t["picea_engelmannii"], 0.5, places=2)   # both well recorded: equal

    def test_the_rule_says_how_it_was_weighted(self):
        r = self.rule(SPRUCE_FIR, ("evt", 7055))
        self.assertEqual(r["weights"]["trees"], "description")
        self.assertTrue(r["id"].startswith("named_from_"))    # the scorecard's and the pool's reading of the id holds


class TestLocalSpeciesOnly(Place):
    records = {"pinus_contorta": 390, "abies_lasiocarpa": 0, "picea_engelmannii": 3, "pseudotsuga_menziesii": 79}
    models = {("evt", 7055): (SPRUCE_FIR_CLASSES, "forest and woodland")}

    def test_a_listed_species_not_recorded_here_is_left_out(self):
        t = self.rule(SPRUCE_FIR, ("evt", 7055))["trees"]
        self.assertNotIn("abies_lasiocarpa", t)

    def test_a_rarity_weighs_less_but_a_named_species_keeps_the_floor(self):
        t = self.rule(SPRUCE_FIR, ("evt", 7055))["trees"]
        self.assertLess(t["picea_engelmannii"], 0.08)                      # not class D's 0.12, nor the absent fir's share
        self.assertGreaterEqual(t["picea_engelmannii"], sm.MEMBER_FLOOR * 0.9)
        self.assertGreater(t["pinus_contorta"], 0.9)


class TestLifeForm(Place):
    records = {"coleogyne_ramosissima": 35, "ephedra_viridis": 98, "juniperus_osteosperma": 419, "pinus_edulis": 748}
    models = {("evt", 7078): (BLACKBRUSH_CLASSES, "shrubland"), ("evt", 7102): (BLACKBRUSH_CLASSES, "shrubland")}

    def test_a_shrublands_description_gives_no_tree_layer(self):
        r = self.rule("Colorado Plateau Blackbrush-Mormon-tea Shrubland", ("evt", 7078), hab=4)
        self.assertEqual(r["trees"], {})
        self.assertEqual(r["tree_density"], 0.0)

    def test_unless_the_name_names_a_tree(self):
        r = self.rule("Colorado Plateau Pinyon-Juniper Shrubland", ("evt", 7102), hab=4)
        self.assertIn("juniperus_osteosperma", r["trees"])

    def test_the_names_species_takes_the_place_of_a_congener_not_recorded_here(self):
        s = self.rule("Colorado Plateau Blackbrush-Mormon-tea Shrubland", ("evt", 7078), hab=4)["shrubs"]
        self.assertNotIn("ephedra_nevadensis", s)
        self.assertAlmostEqual(s["coleogyne_ramosissima"], 2 / 3, places=2)   # first of the class, though it has fewer
        self.assertAlmostEqual(s["ephedra_viridis"], 1 / 3, places=2)         # records than the Mormon tea


class TestNamesWithoutDescription(Place):
    records = {"populus_angustifolia": 32, "populus_trichocarpa": 4, "pinus_edulis": 748, "juniperus_osteosperma": 419}

    def test_the_well_recorded_are_equal_and_a_rarity_less(self):
        w, how = sm._layer_weights(["populus_angustifolia", "populus_trichocarpa"], None, 0.0, TILE, True)
        self.assertEqual(how, "records")
        self.assertAlmostEqual(w["populus_trichocarpa"] / w["populus_angustifolia"], 4 / 30, places=2)
        w, _ = sm._layer_weights(["pinus_edulis", "juniperus_osteosperma"], None, 0.0, TILE, True)
        self.assertAlmostEqual(w["pinus_edulis"], w["juniperus_osteosperma"], places=3)   # not 748 : 419

    def test_a_description_half_found_here_leaves_half_to_the_names_species(self):
        w, how = sm._layer_weights(["pinus_edulis", "juniperus_osteosperma"], {"pinus_edulis": 0.5}, 0.5, TILE, True)
        self.assertEqual(how, "description+name")
        self.assertAlmostEqual(w["pinus_edulis"], 0.75, places=3)
        self.assertAlmostEqual(w["juniperus_osteosperma"], 0.25, places=3)

    def test_a_region_with_a_table_keeps_equal_weights(self):
        sm.CONTEXT.update(regions=["california"])
        r = self.rule("Great Basin Pinyon-Juniper Woodland", ("evt", 7019))
        self.assertTrue(r["trees"])
        self.assertEqual(set(r["trees"].values()), {1.0})


class TestTerrainTable(Place):
    T = 3 * 6 + 2   # 600-1,100 m, mid-slope, not north-facing

    def test_californias_terrain_table_stays_in_california(self):
        w = {"pseudotsuga_menziesii": 1.0}
        self.assertEqual(sm.terrain_weights(w, self.T), {"pseudotsuga_menziesii": 1.0})
        sm.CONTEXT.update(regions=["california"])
        self.assertAlmostEqual(sm.terrain_weights(w, self.T)["pseudotsuga_menziesii"], 0.12, places=3)


@unittest.skipIf(S is None, "no pipeline/succession.py")
class TestDescription(unittest.TestCase):
    def test_classes_and_type_are_read_from_the_document(self):
        d = docx(["10550", "Spruce-Fir", "Vegetation Type", "Forest and Woodland", "Succession Classes",
                  "Class A7Early Development 1 - All Structures", "Indicator Species", "Symbol", "Scientific Name", "Common Name",
                  "Canopy Position", "VASC", "Vaccinium scoparium", "Grouse whortleberry", "Lower",
                  "PICO", "Pinus contorta", "Lodgepole pine", "Upper", "Description", "Grasses and seedlings.",
                  "Class D12Late Development 2 - Closed", "Indicator Species", "Symbol", "Scientific Name", "Common Name",
                  "Canopy Position", "ABLA", "Abies lasiocarpa", "Subalpine fir", "Upper",
                  "PIEN", "Picea engelmannii", "Engelmann spruce", "Mid-Upper", "Description", "Mature spruce and fir."])
        cs = S.classes_of(d)
        self.assertEqual([(c["class"], c["share"]) for c in cs], [("A", 0.07), ("D", 0.12)])
        self.assertEqual(cs[0]["species"], [("Vaccinium scoparium", "lower"), ("Pinus contorta", "upper")])
        self.assertEqual(cs[1]["species"], [("Abies lasiocarpa", "upper"), ("Picea engelmannii", "mid-upper")])
        self.assertEqual(S.vegetation_type(d), "forest and woodland")

    def test_names(self):
        self.assertEqual(S.binomial("Pinus ponderosa var. scopulorum"), ("Pinus ponderosa", False))
        self.assertEqual(S.binomial("Artemisia tridentata ssp. vaseyana"), ("Artemisia tridentata", False))
        self.assertEqual(S.binomial("Salix"), ("Salix", True))
        self.assertEqual(S.binomial("Vaccinium spp."), ("Vaccinium", True))


class TestBuiltTiles(unittest.TestCase):
    def mix(self, tile):
        p = ROOT / "tiles" / tile / "client" / "species_mix.json"
        if not p.exists():
            self.skipTest(f"{tile} is not built here")
        return json.loads(p.read_text())

    def test_lamars_spruce_fir_is_mostly_lodgepole_pine(self):
        mix = self.mix("utm12n_557_4964")
        c = next(c for c in mix["communities"] if c["source"] == "evt" and c["name"] == SPRUCE_FIR)
        self.assertEqual(max(c["trees"], key=c["trees"].get), "pinus_contorta")
        self.assertEqual(c["weights"]["trees"], "description")

    def test_a_table_regions_tiles_keep_their_rows(self):
        for tile in ("utm11n_270_4180", "utm10n_429_5293"):   # Yosemite Valley, the Hoh
            mix = self.mix(tile)
            self.assertFalse([c["name"] for c in mix["communities"] if (c.get("weights") or {}).get("trees") not in (None, "equal")
                              or (c.get("weights") or {}).get("shrubs") not in (None, "equal")])


if __name__ == "__main__":
    unittest.main()
