"""tools/rig_quadruped.py: the leg bands on a short, decimated leg (the otter's and the bobcat's crashed with an empty band)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import rig_quadruped as R  # noqa: E402


class BandAt(unittest.TestCase):
    def test_widens_then_falls_back_to_nearest(self):
        # a leg of three rings: the foot (y 0.002), the wrist (0.03) and the elbow (0.063); nothing near 0.85 x the elbow
        ring = lambda y: [[np.cos(a) * 0.01, y, np.sin(a) * 0.01] for a in np.linspace(0, 6, 6)]
        L = np.array(ring(0.002) + ring(0.03) + ring(0.063))
        b = R.band_at(L, 0.063 * 0.85, 0.1 * 0.063)        # 0.0536 +- 0.0063: empty, so the band widens to the elbow ring
        self.assertGreaterEqual(len(b), 3)
        self.assertTrue(np.all(np.abs(b[:, 1] - 0.063) < 1e-9))
        self.assertGreater(float(np.ptp(b[:, 0])), 0)          # the ring's width, as the joint radius needs
        far = R.band_at(L, 0.5, 0.001)                      # nothing within 4x: the nearest vertices
        self.assertEqual(len(far), 3)

    def test_keeps_a_full_band(self):
        L = np.array([[0, y, 0] for y in np.linspace(0, 0.1, 41)])
        b = R.band_at(L, 0.05, 0.005)
        self.assertTrue(np.all(np.abs(b[:, 1] - 0.05) < 0.005))


if __name__ == "__main__":
    unittest.main()
