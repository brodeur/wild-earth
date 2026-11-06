"""The reverse test of mapped water and the large rivers moved onto the imagery (pipeline/water_imagery.py).

    arch -arm64 .venv/bin/python -m unittest tests.test_water_imagery

Checked on synthetic grids: a river one 20 m pixel wide, whose NDWI never passes 0, is water by its unmixed fraction
(and a meadow beside it is not); a line on the water is `on water`, one 40 m beside it `off water`, one 300 m away `no
water seen`; the trace moves an off-water line onto the water and keeps its fixed ends; a stem walks down its biggest
large reach and up its biggest inflow; a bend moves the end and leaves the far end in place.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import water_imagery as WI  # noqa: E402

N5 = 2000          # the 5 m grid of a 10 km tile


def fake_map(river_x: float, half_w: float = 15.0) -> WI.WaterMap:
    """A WaterMap with a straight north-south river centred on x = river_x."""
    wm = WI.WaterMap.__new__(WI.WaterMap)
    wm.ok, wm.n, wm.months = True, N5, [6, 7, 8]
    xs = (np.arange(N5) + 0.5) * WI.RES
    col = np.abs(xs - river_x) <= half_w
    wm.w5 = np.repeat(col[None, :], N5, axis=0)
    wm.f5 = wm.w5.astype("float32")
    wm.sea5 = np.zeros((N5, N5), bool)
    from scipy import ndimage
    wm.d_in = ndimage.distance_transform_edt(wm.w5) * WI.RES
    return wm


class TestUnmixing(unittest.TestCase):
    def test_narrow_river_is_water_by_fraction(self):
        # NDWI: meadow -0.45, the river's pixel -0.05 (a 20 m pixel half water), open water 0.3
        nd = np.full((50, 50), -0.45, "float32")
        nd[:, 25] = -0.05
        freq = np.zeros_like(nd)
        dry = freq == 0
        dry[:, 25] = True      # never wet by the per-month rule either
        import scipy.ndimage as ndi
        box = int(WI.BG_BOX_M / 20)
        bg = ndi.uniform_filter(np.where(dry, nd, 0.0), box) / ndi.uniform_filter(dry.astype("float32"), box)
        frac = np.clip((nd - bg) / np.maximum(WI.WATER_EM_DEFAULT - bg, 0.1), 0, 1)
        self.assertGreater(frac[25, 25], WI.WATER_FREQ)
        self.assertLess(frac[25, 10], 0.1)


class TestReachTest(unittest.TestCase):
    def setUp(self):
        self.wm = fake_map(5000.0)

    def line(self, x):
        return LineString([(x, 9000.0), (x, 1000.0)])

    def test_verdicts(self):
        self.assertEqual(WI.verdict(WI.reach_test(self.line(5000.0), 30.0, self.wm)), "on water")
        self.assertEqual(WI.verdict(WI.reach_test(self.line(5040.0), 30.0, self.wm)), "off water")
        self.assertEqual(WI.verdict(WI.reach_test(self.line(5300.0), 30.0, self.wm)), "no water seen")

    def test_width(self):
        self.assertAlmostEqual(WI.water_width(self.line(5000.0), self.wm), 30.0, delta=5.0)


class TestTrace(unittest.TestCase):
    def test_trace_moves_onto_water_and_keeps_fixed_ends(self):
        wm = fake_map(5000.0)
        old = LineString([(5060.0, 9990.0), (5060.0, 2000.0)])
        res = WI.trace_stem(old, (5060.0, 9995.0), (5060.0, 2000.0), True, False, wm)
        self.assertIsNotNone(res)
        xy, start, end = res
        self.assertEqual(tuple(xy[0]), (5060.0, 9995.0))          # the edge end stays
        self.assertLess(abs(end[0] - 5000.0), 20.0)                 # the interior end snapped onto the water
        new = LineString(xy)
        t = WI.reach_test(new, 30.0, wm)
        self.assertGreater(t["on"], 0.9)


class TestStemsAndBend(unittest.TestCase):
    def test_stems(self):
        from pipeline.reroute import _nodes
        lines = [LineString([(0, 0), (0, 100)]), LineString([(0, 100), (0, 200)]), LineString([(50, 50), (0, 100)])]
        edges = [{"large": True, "area": 100.0}, {"large": True, "area": 150.0}, {"large": True, "area": 40.0}]
        s, e, _ = _nodes(lines, tol=1.0)
        stems = WI._stems(edges, s, e)
        self.assertEqual(stems[0], [0, 1])     # down the biggest, up its biggest inflow
        self.assertEqual(stems[1], [2])

    def test_bend(self):
        ln = WI._densify(LineString([(0, 0), (0, 200)]))
        b = WI.bend(ln, None, np.array([10.0, 0.0]))
        self.assertEqual(tuple(b.coords[0]), (0.0, 0.0))
        self.assertAlmostEqual(b.coords[-1][0], 10.0)


if __name__ == "__main__":
    unittest.main()
