"""pipeline/reference_photos.py: the rule's scores on drawn photos (offline), and the Commons licence filter."""
import unittest

import numpy as np

from pipeline import reference_photos as rp


def photo(w=480, h=320, body=(240, 150, 140, 45), legs=True, lift=False, bg=(120, 160, 90), noise=0):
    """A drawn 'animal': a brown ellipse body with four legs on a plain (or noisy) background."""
    import cv2
    img = np.full((h, w, 3), bg, np.uint8)
    if noise:
        img = np.clip(img.astype(int) + np.random.default_rng(1).integers(-noise, noise, img.shape), 0, 255).astype(np.uint8)
    cx, cy, ax, ay = body
    cv2.ellipse(img, (cx, cy), (ax, ay), 0, 0, 360, (110, 74, 50), -1)
    if legs:
        for k, x in enumerate((cx - ax + 25, cx - ax + 45, cx + ax - 45, cx + ax - 25)):
            bottom = cy + ay + 60 - (25 if lift and k == 0 else 0)
            cv2.rectangle(img, (x - 6, cy + ay - 10), (x + 6, bottom), (100, 68, 46), -1)
    return img


class Score(unittest.TestCase):
    def test_side_on_whole_animal_scores(self):
        s = rp.score(photo())
        self.assertGreater(s["whole"], 0.9)
        self.assertGreater(s["side"], 0.9)
        self.assertGreater(s["total"], 0.3)

    def test_cut_by_the_frame_scores_low(self):
        self.assertLess(rp.score(photo(body=(40, 150, 140, 45)))["total"], 0.5 * rp.score(photo())["total"])

    def test_a_busy_background_scores_less_than_a_plain_one(self):
        self.assertGreater(rp.score(photo())["plain"], rp.score(photo(noise=90))["plain"])


class Licences(unittest.TestCase):
    def test_commons_licences(self):
        for ok in ("CC0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 2.5 es", "CC BY 2.0"):
            self.assertTrue(rp.COMMONS_OK.match(ok), ok)
        for no in ("CC BY-NC 4.0", "CC BY-ND 2.0", "GFDL", "Public domain", "CC BY-NC-SA 3.0"):
            self.assertFalse(rp.COMMONS_OK.match(no), no)


if __name__ == "__main__":
    unittest.main()
