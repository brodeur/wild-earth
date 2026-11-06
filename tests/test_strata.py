"""The stratigraphic column (pipeline/strata.py) and the rock classes it leans on (pipeline/fetch_geology.py)."""
import unittest

import numpy as np

from pipeline.fetch_geology import rock_class
from pipeline.strata import column_from, rock_colour

RES = 5.0


def _valley(n=400, dip_n=0.005):
    """A V valley 2 km across (38.7 degree walls), the ground 1000-1800 m; strata dipping dip_n m/m to the south."""
    x = (np.arange(n) + 0.5) * RES
    north = (n - (np.arange(n) + 0.5)) * RES
    X, N = np.meshgrid(x, north)
    z = 1000.0 + 0.8 * np.abs(X - n * RES / 2)
    return X, N, z, z - dip_n * (N - n * RES / 2)


UNITS = {
    "1": {"name": "Rim Limestone", "rock_class": "limestone_marble", "lithology": "",
          "description": "Light-gray, cliff-forming, cherty limestone. Contains red chert nodules."},
    "2": {"name": "Canyon Sandstone", "rock_class": "sandstone_conglomerate", "lithology": "",
          "description": "Red and dark-red, cliff-forming, cross-bedded sandstone."},
    "3": {"name": "Lower Shale", "rock_class": "sandstone_conglomerate", "lithology": "",
          "description": "Green, slope-forming siltstone and shale."},
    "4": {"name": "Old Schist", "rock_class": "schist", "lithology": "", "description": "Quartz-mica schist."},
}


class TestColumn(unittest.TestCase):
    def test_flat_strata_make_a_column(self):
        X, N, z, zp = _valley()
        u = np.select([zp >= 1500, zp >= 1300, zp >= 1100], [1, 2, 3], 4).astype(np.uint16)
        rec, out = column_from(UNITS, u, z, RES)
        self.assertTrue(rec["column"], rec.get("reason"))
        self.assertEqual([b["name"] for b in out["bands"]], ["Rim Limestone", "Canyon Sandstone", "Lower Shale"])
        for b, want in zip(out["bands"], (1500, 1300, 1100)):   # bases at the centre, within a cell's relief
            self.assertAlmostEqual(b["base_m"], want, delta=6)
            self.assertAlmostEqual(b["slope_n"], 0.005, delta=0.002)
        self.assertGreater(rec["quality"]["overall_fit_steep"], 0.95)
        red = out["bands"][1]["colour"]
        self.assertGreater(red[0] - red[1], 0.15)   # the sandstone red, the limestone grey
        grey = out["bands"][0]["colour"]
        self.assertLess(abs(grey[0] - grey[2]), 0.08)

    def test_mixed_units_make_none(self):
        X, N, z, _ = _valley()
        u = (((X // 200).astype(int) + (N // 200).astype(int)) % 2 + 1).astype(np.uint16)   # a checkerboard: no superposition
        u[(X // 200).astype(int) % 3 == 0] = 4
        rec, out = column_from(UNITS, u, z, RES)
        self.assertFalse(rec["column"])
        self.assertIsNone(out)

    def test_one_unit_makes_none(self):
        _, _, z, _ = _valley()
        rec, out = column_from(UNITS, np.full(z.shape, 4, np.uint16), z, RES)
        self.assertIsNone(out)


class TestRockColour(unittest.TestCase):
    def test_words_first(self):
        c = rock_colour({"name": "Coconino Sandstone", "description": "Tan to white, cliff-forming, cross-bedded quartz sandstone."})
        self.assertTrue(c["from"].startswith("colour words"))
        self.assertGreater(min(c["colour"]), 0.45)                    # pale
        self.assertGreater(c["colour"][0], c["colour"][2] + 0.1)      # buff, not grey

    def test_minor_component_ignored(self):
        c = rock_colour({"name": "X", "description": "Gray limestone with red chert nodules and black chert lenses."})
        self.assertLess(abs(c["colour"][0] - c["colour"][1]), 0.05)

    def test_lithology_fallback(self):
        c = rock_colour({"name": "Basalt flows", "description": ""})
        self.assertLess(max(c["colour"]), 0.3)
        self.assertEqual(c["from"], "name: basalt")


class TestRockClass(unittest.TestCase):
    def test_description_by_its_main_lithology(self):
        # one 'sand' among the siltstone and sandstone made the Hermit Formation alluvium (first rule to match)
        d = ("Red, slope-forming, fine-grained, thin-bedded siltstone and sandstone. Sandstone beds thicken and thin "
             "laterally either as channel fill or low sand dune accumulations.")
        self.assertEqual(rock_class([], "Hermit Formation", d, 298.9, 272.95), "sandstone_conglomerate")


if __name__ == "__main__":
    unittest.main()
