import unittest

import numpy as np

from pipeline.channels import EPHEMERAL, INTERMITTENT, PERENNIAL, _flow_continuity


def reach(cells, area, fcode, matched):
    return {"cells": np.asarray(cells), "area_km2": area, "fcode": fcode, "matched": matched, "name": "R" if matched else None}


class FlowContinuityTest(unittest.TestCase):
    def test_main_stem_below_a_perennial_reach_runs_all_year(self):
        # perennial (matched) -> unmatched -> unmatched, each ending on the next one's first cell
        rs = [reach([1, 2, 3], 1500, PERENNIAL, True), reach([3, 4, 5], 1510, INTERMITTENT, False),
              reach([5, 6, 7], 1520, INTERMITTENT, False)]
        self.assertEqual(_flow_continuity(rs), 2)
        self.assertEqual([r["fcode"] for r in rs], [PERENNIAL] * 3)
        self.assertEqual(rs[2]["name"], "R")
        self.assertIn("flow", rs[1]["permanence_rule"])

    def test_small_perennial_creek_does_not_make_a_big_wash_perennial(self):
        rs = [reach([1, 2, 9], 5, PERENNIAL, True), reach([8, 9], 300, INTERMITTENT, False), reach([9, 10, 11], 305, INTERMITTENT, False)]
        _flow_continuity(rs)
        self.assertEqual(rs[2]["fcode"], INTERMITTENT)

    def test_matched_reaches_keep_nhd_permanence(self):
        rs = [reach([1, 2, 3], 100, PERENNIAL, True), reach([3, 4], 101, EPHEMERAL, True)]
        self.assertEqual(_flow_continuity(rs), 0)
        self.assertEqual(rs[1]["fcode"], EPHEMERAL)


if __name__ == "__main__":
    unittest.main()
