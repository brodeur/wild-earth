"""The tile pipeline's graph, regions and generators, offline (docs/pipeline.md).

    arch -arm64 .venv/bin/python -m unittest tests.test_pipeline
"""
import csv
import io
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestStages(unittest.TestCase):
    def test_stages_in_order_and_never_read_later(self):
        from pipeline import steps
        order = [steps.STAGES.index(steps.STEPS[n].stage) for n in steps.ORDER]
        self.assertEqual(order, sorted(order))
        for n in steps.ORDER:
            for d in steps.STEPS[n].after:
                self.assertLessEqual(steps.STAGES.index(steps.STEPS[d].stage), steps.STAGES.index(steps.STEPS[n].stage), (n, d))

    def test_old_names(self):
        from pipeline import steps
        self.assertEqual(steps.resolve_names(["veg", "derive"]), ["landcover", "terrain"])


class TestRegions(unittest.TestCase):
    PNW = ["pacific_northwest"]

    def test_no_california_rule_outside_california(self):
        from pipeline.species_mix import match
        r = match("North Pacific Lowland Riparian Forest", self.PNW)
        self.assertEqual(r["id"], "pnw_lowland_riparian")
        self.assertIsNone(match("California Lower Montane Blue Oak-Foothill Pine Woodland and Savanna", self.PNW))
        self.assertEqual(match("California Lower Montane Blue Oak-Foothill Pine Woodland and Savanna")["id"], "blue_oak_foothill_pine")

    def test_fallback_is_never_the_foothills_outside_california(self):
        from pipeline.species_mix import _fallback
        for code in range(1, 9):
            f = _fallback(code, self.PNW)
            self.assertTrue(f.get("pool"), f)
            self.assertFalse(f["trees"] or f["shrubs"])
            self.assertTrue(_fallback(code, []).get("pool"))

    def test_a_phrase_read_by_region(self):
        from pipeline.communities import named_species
        sierra = [s for s, _ in named_species("Sierra Nevada Alpine Dwarf-Shrubland", ["california"])]
        olympic = [s for s, _ in named_species("North Pacific Dry and Mesic Alpine Dwarf-Shrubland", self.PNW)]
        self.assertIn("phyllodoce_breweri", sierra)
        self.assertIn("phyllodoce_empetriformis", olympic)
        self.assertNotIn("phyllodoce_breweri", olympic)

    def test_every_north_pacific_community_is_read(self):
        p = ROOT / "pipeline" / "_cache" / "evt.csv"
        if not p.exists():
            self.skipTest("no LANDFIRE EVT table in pipeline/_cache (a tile build fetches it)")
        from pipeline.communities import named_species
        from pipeline.species_mix import match
        rows = list(csv.DictReader(io.StringIO(p.read_text(encoding="utf-8-sig"))))
        missed = [r["EVT_NAME"] for r in rows if r["EVT_NAME"].startswith("North Pacific")
                  and not match(r["EVT_NAME"], self.PNW) and not named_species(r["EVT_NAME"], self.PNW)]
        self.assertEqual(missed, [])

    def test_snow_and_ice_bare_anywhere(self):
        from pipeline.species_mix import match
        for regions in (self.PNW, ["california"], []):
            r = match("North American Glacier and Ice Field", regions)
            self.assertEqual(r["id"], "snow_ice")
            self.assertEqual(r["tree_density"], 0.0)


class TestGenerators(unittest.TestCase):
    def test_every_card_builds(self):
        from pipeline.plantgen import build, cards, load_card
        for sid in cards():
            rec = build(load_card(sid))
            self.assertEqual(rec["id"], sid)
            if load_card(sid).get("deciduous") is False and "leaf_on_by_month" in (rec.get("foliage") or {}):
                self.assertEqual(min(rec["foliage"]["leaf_on_by_month"]), 1.0, sid)

    def test_the_olympic_species_have_cards(self):
        from pipeline.plantgen import card_path
        for sid in ("picea_sitchensis", "tsuga_heterophylla", "thuja_plicata", "acer_circinatum", "polystichum_munitum",
                    "abies_amabilis", "abies_lasiocarpa", "phyllodoce_empetriformis"):
            self.assertTrue(card_path(sid).exists(), sid)

    def test_animal_traits_from_the_taxon_alone(self):
        from pipeline import fauna
        fauna.trophic = lambda sci, family=None: None   # offline: no EltonTraits
        for sci, tax, plan in (
                ("Cervus canadensis", {"kingdom": "Animalia", "phylum": "Chordata", "class": "Mammalia", "order": "Artiodactyla",
                                       "family": "Cervidae", "genus": "Cervus"}, "quadruped"),
                ("Ariolimax columbianus", {"kingdom": "Animalia", "phylum": "Mollusca", "class": "Gastropoda",
                                           "order": "Stylommatophora", "family": "Ariolimacidae", "genus": "Ariolimax"}, "gastropod"),
                ("Tamiasciurus douglasii", {"kingdom": "Animalia", "phylum": "Chordata", "class": "Mammalia", "order": "Rodentia",
                                            "family": "Sciuridae", "genus": "Tamiasciurus"}, "rodent")):
            t = fauna.make_traits({"scientific": sci, "common": None, "kind": "mammal", "taxonomy": tax})
            self.assertEqual(t["body_plan"], plan)
            self.assertTrue(t["locomotion"])
            self.assertGreater(t["mass_kg"], 0)
        slug = fauna.make_traits({"scientific": "Ariolimax columbianus", "common": None, "kind": "invertebrate",
                                  "taxonomy": {"class": "Gastropoda", "family": "Ariolimacidae", "genus": "Ariolimax"}})
        self.assertLess(slug["locomotion"]["top_mps"], 0.01)


if __name__ == "__main__":
    unittest.main()
