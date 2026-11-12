"""The locomotion tree's dive (pipeline/locomotion.py dive_of; docs/movement.md "The dive")."""
import json
import math
import unittest

from pipeline import locomotion


class TestDive(unittest.TestCase):
    def setUp(self):
        self.tree = locomotion.load_tree()

    def test_every_bird_has_a_dive_and_nothing_else_does(self):
        for row in locomotion.table():
            if row["class"] == "Aves":
                self.assertIn("dive", row, row["code"])
                d = row["dive"]
                self.assertGreater(d["terminal_mps"], 20, row["code"])
                self.assertLessEqual(d["top_mps"], d["terminal_mps"], row["code"])
                self.assertTrue(0 < d["angle_deg"] <= 90, row["code"])
            else:
                self.assertNotIn("dive", row, row["code"])

    def test_the_fall_is_the_physics_the_tree_states(self):
        d = locomotion.resolve("buteo_jamaicensis", self.tree)["dive"]
        sb = 0.00813 * 1.1 ** 0.666
        vt = math.sqrt(2 * 1.1 * 9.81 / (1.23 * 0.37 * sb))
        self.assertAlmostEqual(d["terminal_mps"], vt, delta=0.1)
        self.assertAlmostEqual(d["top_mps"], vt * math.sqrt(math.sin(math.radians(64))), delta=0.1)

    def test_set_at_the_class_and_overridden_only_at_the_falcons(self):
        own = [t for t, node in self.tree["taxa"].items() if "dive" in node]
        self.assertEqual(sorted(own), ["Aves", "Falconidae"])
        self.assertNotIn("dive", json.dumps(self.tree["species"]))   # no per-species dive numbers
        merlin = locomotion.resolve("falco_columbarius", self.tree)["dive"]
        jay = locomotion.resolve("aphelocoma_californica", self.tree)["dive"]
        self.assertEqual((merlin["cd"], merlin["angle_deg"]), (0.18, 87.0))
        self.assertEqual((jay["cd"], jay["angle_deg"]), (0.37, 64.0))
        self.assertEqual(merlin["pull_g_at_half_top"], 1.5)   # the class's, merged under the family's block

    def test_terminal_speed_rises_with_mass(self):
        t = lambda code: locomotion.resolve(code, self.tree)["dive"]["terminal_mps"]
        self.assertLess(t("regulus_satrapa"), t("aphelocoma_californica"))
        self.assertLess(t("aphelocoma_californica"), t("corvus_corax"))
        self.assertLess(t("corvus_corax"), t("haliaeetus_leucocephalus"))


if __name__ == "__main__":
    unittest.main()
