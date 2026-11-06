"""pipeline/canopy_top.py: the measured stand height per 30 m cell."""
import unittest

import numpy as np

from pipeline.canopy_top import stand_top


class StandTopTest(unittest.TestCase):
    def test_closed_canopy_is_the_mean_p95(self):
        p95 = np.full((6, 6), 24.0, "float32"); p95[0, 0] = 30.0
        tree = np.full((6, 6), 90.0, "float32")
        top = stand_top(p95, tree, 2)
        self.assertAlmostEqual(float(top[0, 0]), (8 * 24 + 30) / 9, places=4)
        self.assertAlmostEqual(float(top[1, 1]), 24.0, places=4)

    def test_open_ground_does_not_pull_a_lone_tree_down(self):
        p95 = np.zeros((3, 3), "float32"); tree = np.zeros((3, 3), "float32")
        p95[1, 1], tree[1, 1] = 8.0, 40.0          # one acacia in the cell's nine sub-cells
        self.assertAlmostEqual(float(stand_top(p95, tree, 1)[0, 0]), 8.0, places=4)

    def test_treeless_cells_take_their_measured_neighbours(self):
        p95 = np.zeros((15, 15), "float32"); tree = np.zeros((15, 15), "float32")
        p95[0:3, 0:3], tree[0:3, 0:3] = 10.0, 80.0  # cell (0, 0) measured
        top = stand_top(p95, tree, 5)
        self.assertAlmostEqual(float(top[0, 0]), 10.0, places=4)
        self.assertAlmostEqual(float(top[1, 2]), 10.0, places=4)   # within two cells
        self.assertEqual(float(top[4, 4]), 0.0)                    # beyond: unmeasured


if __name__ == "__main__":
    unittest.main()
