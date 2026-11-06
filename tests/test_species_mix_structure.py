"""The stand's structure per species-mix row (pipeline/species_mix.py stand_structure): the herb cover a LANDFIRE BpS
description gives, and the shrub height EVH gives over a row's cells."""
import json
import pathlib
import tempfile
import unittest

import numpy as np
import rasterio
from rasterio.transform import from_origin

from pipeline import species_mix as sm


class _Tile:
    def __init__(self, root):
        self.root = pathlib.Path(root)

    def path(self, rel):
        return self.root / rel


class HerbCover(unittest.TestCase):
    def test_range(self):
        self.assertEqual(sm.herb_cover_of("Shrubs may be locally common. Herbaceous cover is moderate to abundant, ranging "
                                          "from 40-85%. Common grasses include Festuca idahoensis."), [0.4, 0.85])
        self.assertEqual(sm.herb_cover_of("Herbaceous canopy cover ranges from 20 to 60 % on most sites."), [0.2, 0.6])

    def test_none(self):
        self.assertIsNone(sm.herb_cover_of("There is a 40% herbaceous canopy cover across this class."))   # no range
        self.assertIsNone(sm.herb_cover_of("Shrub cover is 10-30%."))
        self.assertIsNone(sm.herb_cover_of(""))


class ShrubHeight(unittest.TestCase):
    def _tile(self, evh, synthetic=False):
        d = tempfile.mkdtemp()
        (pathlib.Path(d) / "vegetation").mkdir()
        with rasterio.open(pathlib.Path(d) / "vegetation/evh.tif", "w", driver="GTiff", height=evh.shape[0], width=evh.shape[1],
                           count=1, dtype="int16", transform=from_origin(0, 90, 30, 30)) as dst:
            dst.write(evh.astype("int16"), 1)
        classes = {"evt": {"1": {"name": "x", **({"synthetic": True} if synthetic else {})}}}
        return _Tile(d), classes

    def test_median_of_shrub_cells(self):
        index = np.array([[1, 1, 1], [1, 2, 2], [2, 2, 2]])
        evh = np.array([[207, 208, 209], [108, 303, 303], [303, 208, 303]])   # row 1: 3 of 4 shrub cells; row 2: 1 of 5
        tile, classes = self._tile(evh)
        table = [{"index": 1, "source": "evt", "code": 1}, {"index": 2, "source": "evt", "code": 2}]
        sm.stand_structure(tile, index, table, classes)
        self.assertAlmostEqual(table[0]["shrub_h_m"], 0.8)
        self.assertNotIn("shrub_h_m", table[1])   # under half its cells have a shrub height

    def test_synthetic_evh_ignored(self):
        index = np.ones((3, 3), "int64")
        tile, classes = self._tile(np.full((3, 3), 203), synthetic=True)
        table = [{"index": 1, "source": "evt", "code": 1}]
        sm.stand_structure(tile, index, table, classes)
        self.assertNotIn("shrub_h_m", table[0])


if __name__ == "__main__":
    unittest.main()
