"""The ground texture's factor to surface reflectance (pipeline/ground_albedo.py), on a synthetic tile.

    arch -arm64 .venv/bin/python -m unittest tests.test_ground_albedo

Checked: a texture that is the reflectance times known per-channel factors (in linear light) is fitted back to their
inverse; forest, water and clipped pixels stay out of the fit; the reference month is the NAIP flight month; a tile
with too little open ground reports so.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import ground_albedo as GA  # noqa: E402


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


class FakeTile:
    def __init__(self, d: Path):
        self.dir = d
        self.tile_id = "utm10n_680_4280"

    def path(self, rel):
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


def build(d: Path, month: int, display: np.ndarray, open_frac: float = 1.0):
    t = FakeTile(d)
    rng = np.random.default_rng(1)
    n, k = 500, 8
    refl = rng.uniform(0.03, 0.2, (n, n, 3))
    sheet = np.zeros((1500, 2000, 3), "uint8")
    r, c = divmod(month - 1, 4)
    sheet[r * n:(r + 1) * n, c * n:(c + 1) * n] = np.round(255 * srgb(refl / 0.35))
    Image.fromarray(sheet).save(t.path("client/season_rgb.png"))
    tex = np.repeat(np.repeat(np.round(255 * srgb(refl * display)), k, 0), k, 1).astype("uint8")
    Image.fromarray(tex).save(t.path("client/texture_imagery.jpg"), quality=97)
    cov = np.zeros((333, 333, 3), "uint8")
    cov[:, int(333 * open_frac):, 0] = 80       # forest beyond open_frac of the width
    cov[:40, :40, 0] = 0
    hab = np.full((333, 333, 3), 5, "uint8")
    hab[:40, :40] = 7                            # water, not open ground
    Image.fromarray(cov).save(t.path("client/canopy.png"))
    Image.fromarray(hab).save(t.path("client/habitat.png"))
    m = {"layers": {"client.season_rgb": {"path": "client/season_rgb.png", "layout": {"frame_pixels": n, "columns": 4}},
                    "seasons.s2_monthly": {"naip_reference": {"month": month}},
                    "imagery.naip": {"source": "pc_naip", "naip_year": 2022}}}
    return t, m


class GroundAlbedoFit(unittest.TestCase):
    def test_fits_the_inverse_of_the_display_factor(self):
        with tempfile.TemporaryDirectory() as d:
            t, m = build(Path(d), 7, np.array([1.6, 2.0, 2.4]))
            f = GA.fit(t, m)
            self.assertEqual(f["basis"], "fit")
            self.assertEqual(f["reference_month"], 7)
            for g, want in zip(f["gain"], [1 / 1.6, 1 / 2.0, 1 / 2.4]):
                self.assertAlmostEqual(g, want, delta=0.02 * want)
            self.assertLess(f["open_pixels"], 500 * 500 - 3000)   # the water corner is out

    def test_reference_month_and_forest_excluded(self):
        with tempfile.TemporaryDirectory() as d:
            t, m = build(Path(d), 5, np.array([2.5, 2.5, 2.5]), open_frac=0.5)
            f = GA.fit(t, m)
            self.assertIn("month 5", f["reference"])
            self.assertAlmostEqual(f["gain_luminance"], 0.4, delta=0.01)
            self.assertLess(f["open_share"], 0.55)

    def test_too_little_open_ground(self):
        with tempfile.TemporaryDirectory() as d:
            t, m = build(Path(d), 7, np.array([2.0, 2.0, 2.0]), open_frac=0.0)
            f = GA.fit(t, m)
            self.assertEqual(f["basis"], "too_little_open")


if __name__ == "__main__":
    unittest.main()
