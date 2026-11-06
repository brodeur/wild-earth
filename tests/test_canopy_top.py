"""pipeline/canopy_top.py: the measured stand height per 30 m cell."""
import unittest

import numpy as np

from pipeline.canopy_maps import eth_name
from pipeline.canopy_top import LIFT_BLOCK, tall_lift, stand_top


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



class TallLiftTest(unittest.TestCase):
    """The rule (canopy_top.py): ETH lifts CHM v2's level only where v2 itself sees tall closed forest."""
    n = LIFT_BLOCK * 2

    def _lift(self, v2, eth, cnt=9):
        top = np.full((self.n, self.n), v2, "float32"); eth_top = np.full((self.n, self.n), eth, "float32")
        return tall_lift(top, np.full((self.n, self.n), cnt), eth_top)[0]

    def test_tall_closed_forest_takes_eths_level(self):
        self.assertAlmostEqual(float(self._lift(40.0, 47.0).mean()), 7.0, places=3)

    def test_short_or_logged_forest_keeps_v2(self):
        # Danum's logged forest: v2 22 m, ETH still 46 m (it does not see the logging); no lift
        self.assertEqual(float(self._lift(22.0, 46.0).max()), 0.0)

    def test_eth_lower_never_lowers(self):
        self.assertEqual(float(self._lift(40.0, 30.0).max()), 0.0)

    def test_the_gate_ramps(self):
        self.assertAlmostEqual(float(self._lift(30.0, 40.0).mean()), 5.0, places=3)   # halfway up the ramp: half of 10 m

    def test_no_closed_cells_no_lift(self):
        self.assertEqual(float(self._lift(40.0, 47.0, cnt=8).max()), 0.0)


class EthNameTest(unittest.TestCase):
    def test_south_west_corner(self):
        self.assertEqual(eth_name(-71.4, -11.9), "S12W072")   # Manu: the tile spanning -12..-9, -72..-69
        self.assertEqual(eth_name(117.8, 4.95), "N03E117")
        self.assertEqual(eth_name(13.0, 67.9), "N66E012")


if __name__ == "__main__":
    unittest.main()
