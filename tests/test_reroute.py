"""The reroute step's conditioning and snapping (pipeline/reroute.py) on small synthetic DEMs.

    arch -arm64 .venv/bin/python -m unittest tests.test_reroute

A 1 m valley 300 m long, falling 3% to the south, with a V cross-section and a thalweg that meanders 12 m either side of
the middle; a 'mapped' line runs straight down the middle (as a 5 m routing or an NHD line would, metres off the real
channel). Checked: the priority-flood breaches a 4 m embankment across the valley instead of filling a lake behind it,
every cell drains to one no higher, and accumulation peaks at the outlet; the flood keeps to the territories' adjacency;
the trace from the head reaches the outlet down the thalweg, and the shaped line sits within 5 cm of each
cross-section's lowest ground; a road strip burnt along the mapped line takes the trace across a fill; the isotonic
long profile does not hang on a pit as a running minimum does.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import reroute as R  # noqa: E402

N = 300          # cells (1 m)
SLOPE = 0.03     # down to the south (north decreasing)
SIDE = 0.4       # the valley's side slope


def thalweg_x(north):
    return 150 + 12 * np.sin(north / 25.0)


def valley(fill=None):
    """z[row, col] on an N x N 1 m grid, row 0 north; north = N - (row + 0.5)."""
    rows, cols = np.mgrid[0:N, 0:N]
    north = N - (rows + 0.5)
    x = cols + 0.5
    z = 100 + SLOPE * north + SIDE * np.abs(x - thalweg_x(north))
    z += 0.01 * np.sin(x * 1.3) * np.cos(north * 0.7)   # a little roughness
    if fill is not None:   # an embankment across the valley at north = fill, 6 m thick, 4 m over the thalweg
        band = np.abs(north - fill) < 3
        z[band] = np.maximum(z[band], 100 + SLOPE * fill + 4.0)
    return z.astype("float32")


def fine(z):
    d = R.FineDEM.__new__(R.FineDEM)
    d.z = z.copy()
    d.n = z.shape[0]
    d.res = 1.0
    d.nodata_cells = 0
    return d


def outlet_cells(z):
    """The bottom row (south border) of the valley floor, as the network's outlet."""
    r = N - 1
    c = int(round(thalweg_x(0.5) - 0.5))
    return np.array([r * N + q for q in range(c - 3, c + 4)], np.int64)


class TestConditioning(unittest.TestCase):
    def test_breach_not_fill(self):
        z = valley(fill=150)
        mask = np.ones_like(z, bool)
        zc, parent, acc, st = R.condition(z, mask, outlet_cells(z))
        self.assertTrue((parent >= -1).all(), "every cell reached")
        # nothing raised, and the embankment breached: the thalweg just upstream keeps its height (no lake)
        self.assertTrue((zc <= z + 1e-6).all())
        up = int(N - 160)                                     # row at north ~ 160, above the fill
        c = int(round(thalweg_x(160) - 0.5))
        self.assertAlmostEqual(float(zc[up, c]), float(z[up, c]), delta=0.05)
        self.assertGreater(st["breach_max_m"], 3.0)
        # every cell drains to one no higher
        zf = zc.ravel()
        has = parent >= 0
        self.assertTrue((zf[parent[has]] <= zf[has] + 1e-6).all())
        # the most accumulated cell is an outlet
        self.assertIn(int(np.argmax(acc)), set(outlet_cells(z).tolist()))

    def test_territories_keep_the_flood(self):
        z = valley()
        mask = np.ones_like(z, bool)
        lab = np.ones(z.shape, np.int32)
        lab[:, N // 2:] = 2
        adj = np.zeros((3, 3), np.bool_)
        adj[1, 1] = adj[2, 2] = True
        seeds = np.array([(N - 1) * N + 10], np.int64)        # an outlet in territory 1 only
        _, parent, _, st = R.condition(z, mask, seeds, lab, adj)
        # territory 2 is flooded from its own lowest cell, never across the boundary
        self.assertEqual(st["unreached_parts"], 1)
        p = parent.reshape(N, N)
        left = p[:, :N // 2].ravel()
        self.assertTrue(((left[left >= 0] % N) < N // 2).all())


class TestSnapping(unittest.TestCase):
    def _trace(self, z):
        mask = np.ones_like(z, bool)
        zc, parent, acc, _ = R.condition(z, mask, outlet_cells(z))
        dem = fine(z)
        head = R._snap_node(150.0, N - 2.0, R.HEAD_R_M + 10, acc.ravel(), zc.ravel(), parent >= -1, 1.0, N)
        goal = R._snap_node(thalweg_x(0.5), 0.5, R.NODE_R_M, acc.ravel(), zc.ravel(), parent >= -1, 1.0, N)
        path, ok = R._trace(head, goal, parent, N, 4 * N, R.HIT_M, frozenset(), R.OUTLET_R_M)
        return dem, path, ok

    def test_line_on_the_lowest_ground(self):
        z = valley()
        dem, path, ok = self._trace(z)
        self.assertTrue(ok)
        p = R.shape_line(R._cells_xy(path, N, 1.0), dem, width=2.0)
        # the mapped line down the middle is metres off; the shaped line follows the thalweg
        inner = (p[:, 1] > 10) & (p[:, 1] < N - 10)
        off = np.abs(p[inner, 0] - thalweg_x(p[inner, 1]))
        self.assertLess(float(np.median(off)), 0.5)
        mid_off = np.abs(150 - thalweg_x(p[inner, 1]))
        self.assertGreater(float(np.median(mid_off)), 5.0)
        # each vertex within 5 cm of its cross-section's lowest ground (+-4 m across the flow)
        nrm = R._normals(p)
        offs = np.linspace(-4, 4, 33)
        g0 = dem.at(p[inner, 0], p[inner, 1])
        X = p[inner, 0:1] + nrm[inner, 0:1] * offs
        Y = p[inner, 1:2] + nrm[inner, 1:2] * offs
        gmin = dem.at(X.ravel(), Y.ravel()).reshape(X.shape).min(axis=1)
        self.assertGreater(float(((g0 - gmin) <= 0.05).mean()), 0.95)

    def test_road_burn_crosses_the_fill(self):
        # an embankment wider than the valley floor with a lower notch 20 m to the side: without the burn the
        # breach (and the trace) goes through the notch; burnt along the mapped line, straight across
        z = valley(fill=150)
        rows, cols = np.mgrid[0:N, 0:N]
        north = N - (rows + 0.5)
        notch = (np.abs(north - 150) < 3) & (np.abs(cols + 0.5 - (thalweg_x(150) + 20)) < 2)
        z[notch] -= 2.0
        from shapely.geometry import LineString
        mapped = LineString([(thalweg_x(n), n) for n in np.linspace(N - 1, 1, 120)])
        zone5 = np.zeros((N // 5, N // 5), bool)
        zone5[(N - 156) // 5:(N - 144) // 5 + 1, :] = True
        dem = fine(z)
        st = R.burn_roads([{"line": mapped}], dem, zone5)
        self.assertEqual(st["crossings"], 1)
        zc, parent, acc, _ = R.condition(dem.z, np.ones_like(z, bool), outlet_cells(z))
        head = R._snap_node(thalweg_x(N - 2), N - 2.0, R.HEAD_R_M, acc.ravel(), zc.ravel(), parent >= -1, 1.0, N)
        goal = R._snap_node(thalweg_x(0.5), 0.5, R.NODE_R_M, acc.ravel(), zc.ravel(), parent >= -1, 1.0, N)
        path, ok = R._trace(head, goal, parent, N, 4 * N, R.HIT_M, frozenset(), R.OUTLET_R_M)
        self.assertTrue(ok)
        xy = R._cells_xy(path, N, 1.0)
        at_fill = np.abs(xy[:, 1] - 150) < 3
        self.assertLess(float(np.abs(xy[at_fill, 0] - thalweg_x(xy[at_fill, 1])).max()), 3.0)


class TestLongProfile(unittest.TestCase):
    def test_isotonic_does_not_hang_on_a_pit(self):
        g = np.linspace(10, 7, 61)
        g[10] -= 2.0                                   # a 1 m pit near the top
        run_min = np.minimum.accumulate(g)
        iso = R.isotonic_down(g)
        self.assertTrue((np.diff(iso) <= 1e-12).all())
        # a running minimum holds the level 2 m under the ground for 20 samples below the pit; the trend does not
        self.assertGreater(float((g[11:31] - run_min[11:31]).mean()), 1.0)
        self.assertLess(float(np.abs(g[15:] - iso[15:]).max()), 0.2)


if __name__ == "__main__":
    unittest.main()
