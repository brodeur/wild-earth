"""Streams across tile seams and meltwater from the ice (pipeline/water_seams.py), on small synthetic cases.

    arch -arm64 .venv/bin/python -m unittest tests.test_water_seams

Checked: a line's end near an edge is cut back and runs straight onto the edge point (along an adopted tangent's last
LEAD_M); an own crossing takes the lowest edge ground near the carried-on line; a neighbour's crossing is adopted
(point, identity, level) and its order carried down the reaches below; two tiles built one after the other end on the
same point with the same record; the level at a crossing is moved to the edge's and stays non-increasing, the half width
eases to width / 2 at the edge; a line is split at the ice's edge (on-ice piece kept, not drawn; the piece below a
meltwater head); a valley glacier's toe starts a meltwater stream down to the river.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import water_seams as WS  # noqa: E402

S = WS.S_M


class FakeTile:
    def __init__(self, x0, y0, tid):
        self.bounds = (x0, y0, x0 + S, y0 + S)
        self.tile_id = tid


class FakeDEM:
    """A valley floor running east-west at north = y_low (lowest), rising 0.1 m per metre across."""

    def __init__(self, y_low):
        self.y_low = y_low

    def at(self, x, y):
        return 100.0 + 0.1 * np.abs(np.asarray(y, "float64") - self.y_low) + 0.001 * np.asarray(x, "float64")


def items_of(lines, props):
    return [{"line": LineString(l), "pr": dict(p), "k": k} for k, (l, p) in enumerate(zip(lines, props))]


class TestEnds(unittest.TestCase):
    def test_set_end_out_and_in(self):
        p = np.array([[S - 200.0, 500.0], [S - 50.0, 505.0], [S - 8.0, 507.0], [S - 3.0, 508.0]])
        q = WS._set_end(p, (S, 503.0), "east", at_start=False, tangent=(1.0, 0.0))
        self.assertEqual(tuple(q[-1]), (S, 503.0))
        self.assertTrue(np.allclose(q[-2], (S - WS.LEAD_M, 503.0)))
        self.assertTrue(all(WS.edge_dist(x, y, "east") >= WS.STRAIGHT_M for x, y in q[:-2]))
        # an inflow head 20 m in: extended upstream to the edge
        p = np.array([[S - 20.0, 300.0], [S - 120.0, 310.0], [S - 400.0, 300.0]])
        q = WS._set_end(p, (S, 302.0), "east", at_start=True, tangent=(-1.0, 0.0))
        self.assertEqual(tuple(q[0]), (S, 302.0))
        self.assertTrue(np.allclose(q[1], (S - WS.LEAD_M, 302.0)))
        self.assertTrue(np.allclose(q[2], p[0]))

    def test_own_point_is_the_lowest_edge_ground(self):
        a = WS._own_point(FakeDEM(512.0), "east", 505.0, 10.0)
        self.assertAlmostEqual(a, 512.0, delta=0.6)
        # beyond the search window it stays at the window's lowest end
        a = WS._own_point(FakeDEM(560.0), "east", 505.0, 4.0)
        self.assertLessEqual(a, 505.0 + WS.OWN_R_M[0] + 0.01)


class TestSeams(unittest.TestCase):
    def setUp(self):
        self._nc = WS.neighbour_crossings

    def tearDown(self):
        WS.neighbour_crossings = self._nc

    def _west_tile_items(self):
        # the river enters the west tile from the east 20 m in at north 500, flows west; a reach below it; a tributary
        river = [(S - 20.0, 500.0), (S - 400.0, 520.0), (S - 900.0, 510.0)]
        below = [(S - 900.0, 510.0), (S - 2000.0, 480.0)]
        props = [{"name": "Big River", "order": 4, "area_km2": 180.0, "width": 9.0, "bed_width": 14.5, "fcode": 46006},
                 {"name": "Big River", "order": 4, "area_km2": 182.0, "width": 9.1, "bed_width": 14.6, "fcode": 46006}]
        return items_of([river, below], props)

    def test_own_then_adopted(self):
        west, east = FakeTile(429000, 5293000, "utm10n_429_5293"), FakeTile(439000, 5293000, "utm10n_439_5293")
        # the east tile first: its river leaves through its west edge at north 503 (its own)
        WS.neighbour_crossings = lambda t: {}
        e_items = items_of([[(600.0, 520.0), (100.0, 506.0), (4.0, 503.0)]],
                           [{"name": "Big River", "order": 5, "area_km2": 180.3, "width": 9.0, "bed_width": 14.5, "fcode": 46006}])
        e_recs, st = WS.seams_pass(east, None, FakeDEM(503.0), e_items, None)
        self.assertEqual(st["own"], 1)
        r = e_recs[0]
        self.assertEqual((r["side"], r["dir"]), ("west", "out"))
        self.assertAlmostEqual(r["x"], 439000.0)
        self.assertAlmostEqual(r["y"], 5293000 + 503.0, delta=0.6)
        self.assertTrue(np.allclose(e_items[0]["line"].coords[-1], (0.0, r["y"] - 5293000)))
        r["level"], r["depth"], r["half_width"] = 101.25, 0.6, 4.5
        # the west tile adopts it: same point, its identity and level, the order carried down
        WS.neighbour_crossings = lambda t: {"east": ("utm10n_439_5293", e_recs)}
        w_items = self._west_tile_items()
        w_recs, st = WS.seams_pass(west, None, FakeDEM(510.0), w_items, None)
        self.assertEqual(st["adopted"], 1)
        w = w_recs[0]
        self.assertEqual((w["side"], w["dir"]), ("east", "in"))
        self.assertAlmostEqual(w["x"], r["x"])
        self.assertAlmostEqual(w["y"], r["y"])
        self.assertEqual(w["level_theirs"], 101.25)
        self.assertTrue(w["seen_neighbour"])
        self.assertEqual(w["order"], 5)
        self.assertTrue(np.allclose(w_items[0]["line"].coords[0], (S, r["y"] - 5293000)))
        self.assertEqual(w_items[0]["pr"]["width"], 9.0)
        self.assertEqual(w_items[1]["pr"]["order"], 5, "the order carried down the next reach")
        self.assertTrue(w["source"].startswith("neighbour"))

    def test_fresh_head_near_an_edge_is_not_a_crossing(self):
        WS.neighbour_crossings = lambda t: {}
        it = items_of([[(S - 25.0, 500.0), (S - 300.0, 520.0)]], [{"order": 1, "area_km2": 0.16, "width": 1.4}])
        recs, st = WS.seams_pass(FakeTile(0, 0, "t"), None, FakeDEM(500.0), it, None)
        self.assertEqual(recs, [])


class TestLevels(unittest.TestCase):
    def test_edge_level_pinned_and_monotone(self):
        n = 41
        s = np.arange(n) * 2.5
        S_ = {"x": S - s[::-1] * 0 - (100 - s), "y": np.full(n, 500.0), "s": s, "L": 120.0 - 0.02 * s, "D": np.full(n, 0.4),
              "wh": 4.5 * (1 + 0.2 * np.sin(s / 7)), "width": np.full(n, 9.0), "reach": np.zeros(n)}
        S_["x"] = S - 100 + s          # flowing east, the last sample on the edge
        recs = [{"side": "east", "along": 500.0, "x": S, "y": 500.0, "dir": "out", "level_theirs": 117.0, "depth_theirs": 1.0}]

        class T:
            bounds = (0, 0, S, S)

            def path(self, rel):
                class P:
                    def exists(self_):
                        return True

                    def read_text(self_):
                        import json
                        return json.dumps({"crossings": recs})
                return P()
        st = WS.edge_levels(S_, T())
        self.assertEqual(st["levels_moved"], 1)
        self.assertAlmostEqual(S_["L"][-1], 117.5, places=6)   # the mean of 118 here and 117 there
        self.assertTrue((np.diff(S_["L"]) <= 1e-9).all())
        self.assertAlmostEqual(S_["wh"][-1], 4.5, places=6)
        self.assertAlmostEqual(S_["D"][-1], 0.7, places=6)
        # far from the edge nothing moved
        self.assertAlmostEqual(S_["L"][0], 120.0, places=6)


class TestIce(unittest.TestCase):
    def test_clip_at_the_toe(self):
        ice = np.zeros((2000, 2000), bool)
        ice[:, :400] = True                      # ice west of x = 2000 m (5 m cells)
        it = items_of([[(500.0, 5000.0), (5000.0, 5000.0)]], [{"order": 2, "area_km2": 3.0, "width": 3.0, "fcode": 46003}])
        st = WS.clip_ice(it, ice, 5.0, [])
        self.assertEqual(st["lines_split_at_ice"], 1)
        on = [x for x in it if x["pr"].get("on_ice")]
        off = [x for x in it if not x["pr"].get("on_ice")]
        self.assertEqual(len(on), 1)
        self.assertEqual(len(off), 1)
        self.assertTrue(off[0]["pr"]["meltwater"])
        self.assertEqual(off[0]["pr"]["fcode"], WS.PERENNIAL)
        self.assertAlmostEqual(off[0]["line"].coords[0][0], 2000.0, delta=3.0)

    def test_meltwater_from_a_valley_glacier(self):
        # a 50 m grid (200 x 200 over the tile): a V valley falling south, a glacier over its head (north > 7000 m),
        # the river drawn from north 5000 m down; the glacier's toe should start a stream down to the river
        import rasterio
        from rasterio.features import rasterize
        n, res = 200, S / 200
        rows, cols = np.mgrid[0:n, 0:n]
        north, x = S - (rows + 0.5) * res, (cols + 0.5) * res
        z = 500 + 0.05 * north + 0.3 * np.abs(x - 5000)
        ice = (north > 7000) & (np.abs(x - 5000) < 1500)
        flow = WS.Flow5.from_array(z)

        class Ctx:
            def __init__(self):
                self.n, self.res = n, res
                self.tr = rasterio.transform.from_origin(0, S, res, res)

            def rasterize(self, geoms):
                return rasterize([(g, 1) for g in geoms], out_shape=(n, n), transform=self.tr, fill=0, dtype="uint8")

        class DEM:
            def at(self, xx, yy):
                return 500 + 0.05 * np.asarray(yy, "float64") + 0.3 * np.abs(np.asarray(xx, "float64") - 5000)
        river = items_of([[(5000.0, 5000.0), (5000.0, 10.0)]], [{"order": 3, "area_km2": 20.0, "width": 5.0, "fcode": 46003}])
        st = WS.meltwater(river, ice, [], flow, DEM(), Ctx())
        self.assertGreaterEqual(st["lines_added"], 1)
        melt = [it for it in river if it["pr"].get("rerouted") == "meltwater"]
        top = max(melt, key=lambda it: it["line"].coords[0][1])
        x0_, y0_ = top["line"].coords[0]
        self.assertAlmostEqual(y0_, 7000.0, delta=2 * res)          # from the toe
        self.assertLess(abs(x0_ - 5000.0), 2 * res)                   # on the valley's floor
        self.assertLess(river[0]["line"].distance(__import__("shapely.geometry", fromlist=["Point"]).Point(top["line"].coords[-1])), 1.0)
        self.assertEqual(river[0]["pr"]["fcode"], WS.PERENNIAL, "the river it feeds runs all year")

    def test_short_runs_absorbed(self):
        on = np.array([0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0], bool)
        c = WS._clean_runs(on, 3)
        self.assertFalse(c[2])            # a lone ice sample on rock: rock
        self.assertTrue(c[10])            # a lone rock sample in the ice: ice


if __name__ == "__main__":
    unittest.main()
