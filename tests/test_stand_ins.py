"""Stand-ins and community names by place (pipeline/communities.py, pipeline/species_mix.py, 2026-11-10).

A species without a library record is drawn by a stand-in only where the stand-in belongs to the tile (recorded near
it) and is its relative (the same genus, else the same family and growth form); otherwise it is missing, never
replaced by another region's species. A tile in no table's region reads its community names by its own records. The
records are given here by communities.RECORDS (no network)."""
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import communities as C  # noqa: E402
from pipeline import species_mix as sm  # noqa: E402

TILE = types.SimpleNamespace(tile_id="test_outside_every_table")


class Place(unittest.TestCase):
    """A tile outside every regional table, with `records` as its GBIF counts (a species not listed: 0)."""
    records: dict = {}

    def setUp(self):
        self._saved = (getattr(C, "RECORDS", None), dict(sm.CONTEXT), getattr(C, "family_of", None))   # (getattr: the first test
        # below runs against the code before 2026-11-10 too, and fails there on what it drew: gray pine)
        if hasattr(sm, "RESOLUTION"):
            sm.RESOLUTION.clear()
        sm.SUBSTITUTIONS.clear()
        C.RECORDS = lambda tile, sid: self.records.get(sid, 0)
        sm.CONTEXT.update(regions=[], tile=TILE, coast=False)

    def tearDown(self):
        C.RECORDS, ctx, C.family_of = self._saved
        sm.CONTEXT.clear(); sm.CONTEXT.update(ctx)
        if hasattr(sm, "RESOLUTION"):
            sm.RESOLUTION.clear()
        sm.SUBSTITUTIONS.clear()


class TestMissingNotBorrowed(Place):
    # the Grand Canyon before 2026-11-10: singleleaf pinyon (no record) was drawn as gray pine, a California tree with
    # no record within 25 km, on 16 % of the canopy
    records = {"pinus_sabiniana": 0, "pinus_ponderosa": 0}

    def test_a_species_without_a_record_is_missing_not_a_california_species(self):
        if C.has_record("pinus_monophylla"):
            self.skipTest("singleleaf pinyon has a record now: the case needs another species without one")
        drawn = sm.resolve({"pinus_monophylla": 1.0, "pinus_ponderosa": 0.5})
        self.assertNotIn("pinus_sabiniana", drawn)          # the old rule's stand-in (communities.STAND_IN), wherever the tile
        self.assertEqual(drawn, {"pinus_ponderosa": 0.5})   # left out: the community's other species take its share

    def test_it_is_reported_with_its_reason(self):
        if C.has_record("pinus_monophylla"):
            self.skipTest("singleleaf pinyon has a record now")
        events = []
        sm.resolve({"pinus_monophylla": 1.0}, "tree", events)
        self.assertEqual([(k, r) for k, r, _ in events], [("pinus_monophylla", None)])
        self.assertIn("no library record", events[0][2])

    def test_a_species_with_a_record_is_itself(self):
        self.assertEqual(sm.resolve({"pinus_ponderosa": 1.0}), {"pinus_ponderosa": 1.0})


class TestLocalRelative(Place):
    records = {"pinus_ponderosa": 40, "pinus_contorta": 500, "pinus_sabiniana": 0, "pseudotsuga_menziesii": 90,
               "artemisia_tridentata": 60, "quercus_douglasii": 0}

    def test_the_same_genus_recorded_here(self):
        if C.has_record("pinus_monophylla"):
            self.skipTest("singleleaf pinyon has a record now")
        r, why = C.local_stand_in("pinus_monophylla", TILE, [], "tree")
        self.assertEqual(r, "pinus_contorta")               # the best recorded pine here, not STAND_IN's gray pine (0 records)
        self.assertIn("the same genus", why)

    def test_the_same_family_and_growth_form_when_no_congener_is_here(self):
        C.family_of = lambda sid: {"larix_imaginaria": "Pinaceae", "pinus_ponderosa": "Pinaceae", "pinus_contorta": "Pinaceae",
                                   "pseudotsuga_menziesii": "Pinaceae", "artemisia_tridentata": "Asteraceae"}.get(sid)
        r, why = C.local_stand_in("larix_imaginaria", TILE, [], "tree")
        self.assertEqual(r, "pinus_contorta")
        self.assertIn("the same family", why)
        self.assertIsNone(C.local_stand_in("larix_imaginaria", TILE, [], "shrub")[0])   # no Pinaceae shrub: missing

    def test_a_relative_not_recorded_here_is_no_stand_in(self):
        C.family_of = lambda sid: None
        self.assertIsNone(C.local_stand_in("quercus_imaginaria", TILE, [], "tree")[0])   # blue oak: a relative, 0 records

    def test_without_records_the_regions_tag_decides(self):
        C.RECORDS = lambda tile, sid: None                   # the records cannot say (offline, or too few around)
        C.family_of = lambda sid: None
        self.assertEqual(C.local_stand_in("quercus_imaginaria", TILE, ["california"], "tree")[0][:8], "quercus_")
        self.assertIsNone(C.local_stand_in("quercus_imaginaria", TILE, [], "tree")[0])
        self.assertIsNone(C.local_stand_in("quercus_imaginaria", TILE, ["scandinavia"], "tree")[0])


class TestNamesByPlace(Place):
    records = {"pinus_edulis": 748, "pinus_monophylla": 6, "juniperus_osteosperma": 419, "juniperus_scopulorum": 30,
               "pinus_albicaulis": 34, "pinus_contorta": 390, "abies_lasiocarpa": 63, "tsuga_mertensiana": 0,
               "picea_engelmannii": 36, "pinus_ponderosa": 200, "artemisia_tridentata": 2}

    def test_a_word_is_the_best_recorded_species_it_can_mean(self):
        named = dict(C.named_species("Colorado Plateau Pinyon-Juniper Woodland", [], TILE))
        self.assertEqual(named, {"pinus_edulis": "tree", "juniperus_osteosperma": "tree"})   # not singleleaf pinyon, not Sierra juniper

    def test_a_region_with_a_table_reads_it_as_written(self):
        named = [s for s, _ in C.named_species("Great Basin Pinyon-Juniper Woodland", ["california"], TILE)]
        self.assertEqual(sorted(named), ["juniperus_grandis", "pinus_monophylla"])

    def test_a_community_phrase_keeps_every_member_recorded_here(self):
        named = [s for s, _ in C.named_species("Northern Rocky Mountain Subalpine Woodland and Parkland", [], TILE)]
        self.assertEqual(sorted(named), ["abies_lasiocarpa", "picea_engelmannii", "pinus_albicaulis", "pinus_contorta"])

    def test_spruce_fir_is_read(self):
        named = [s for s, _ in C.named_species("Rocky Mountain Subalpine Dry-Mesic Spruce-Fir Forest and Woodland", [], TILE)]
        self.assertEqual(sorted(named), ["abies_lasiocarpa", "picea_engelmannii"])

    def test_a_name_whose_species_are_not_recorded_names_nothing(self):
        self.assertEqual(C.named_species("Inter-Mountain Basins Big Sagebrush Shrubland", [], TILE), [])      # 2 records: under the minimum
        self.assertEqual(C.named_species("Mediterranean California Red Fir Forest", [], TILE), [])

    def test_no_records_to_ask_names_nothing(self):
        C.RECORDS = lambda tile, sid: None
        self.assertEqual(C.named_species("Colorado Plateau Pinyon-Juniper Woodland", [], TILE), [])

    def test_a_ground_plants_record_is_not_grown_as_a_shrub(self):
        self.assertTrue(C.fits_layer("no_such_species", "shrub"))
        self.assertTrue(C.fits_layer("artemisia_tridentata", "shrub"))
        self.assertFalse(C.fits_layer("achillea_millefolium", "shrub"))


class TestColumns(Place):
    def test_californias_lists_are_californias(self):
        rows = [{"pinus_ponderosa": 1.0, "pinus_contorta": 1.0}]
        trees, shrubs = sm.columns([], rows, [{}])
        self.assertEqual(trees, ["pinus_ponderosa", "pinus_contorta"])     # ponderosa keeps TREES' place, the rest follow
        self.assertEqual(shrubs, [])
        sm.CONTEXT["regions"] = ["california"]
        trees, shrubs = sm.columns([], rows, [{}])
        self.assertEqual(trees[:len(sm.TREES)], sm.TREES)
        self.assertEqual(shrubs, sm.SHRUBS)


class TestRegions(unittest.TestCase):
    def test_a_box_without_tables_is_no_region(self):
        from pipeline.config import Tile
        from pipeline.regions import NATURAL, natural_regions
        self.assertNotIn("great_basin", NATURAL)
        self.assertEqual(natural_regions(Tile.from_id("utm12n_396_3988")), [])        # the Grand Canyon
        self.assertEqual(natural_regions(Tile.from_id("utm11n_270_4180")), ["california"])   # Yosemite


class TestBuiltTiles(unittest.TestCase):
    """The mix documents as built (tiles/*/client/species_mix.json)."""

    def docs(self):
        return {p.parts[-3]: json.loads(p.read_text()) for p in sorted((ROOT / "tiles").glob("*/client/species_mix.json"))}

    def test_every_mix_says_its_stand_ins_and_missing_species(self):
        for tile, d in self.docs().items():
            for e in d["stand_ins"]:
                self.assertEqual(sorted(e), ["cells", "drawn", "reason", "species"], tile)
                self.assertTrue((ROOT / "library" / "species" / f"{e['drawn']}.json").exists(), (tile, e))
            for e in d["missing"]:
                self.assertEqual(sorted(e), ["cells", "reason", "species"], tile)

    def test_no_california_tree_or_shrub_at_the_grand_canyon(self):
        d = self.docs().get("utm12n_396_3988")
        if d is None:
            self.skipTest("the Grand Canyon tile is not built here")
        drawn = {k for layer in ("tree_share", "shrub_share") for k, v in d["fractions"][layer].items() if v > 0}
        for gone in ("gray_pine", "juniperus_grandis", "manzanita", "chamise", "buckbrush"):
            self.assertNotIn(gone, drawn)
        self.assertIn("pinus_edulis", drawn)
        self.assertIn("juniperus_osteosperma", drawn)
        self.assertEqual(d["natural_regions"], [])
        self.assertEqual(d["species"]["trees"], [k for k in d["species"]["trees"] if k in {s for m in d["mixes"] for s, _ in m.get("tree_bytes", [])}])


if __name__ == "__main__":
    unittest.main()
