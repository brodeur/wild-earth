"""pipeline/reference_photos.py: the pose filter on drawn silhouettes and the rule's scores on drawn photos (offline),
the segmenters on a drawn photo (when their weights are in the cache), and the Commons licence filter."""
import unittest

import numpy as np

from pipeline import reference_photos as rp


def silhouette(w=480, h=320, body=(240, 150, 140, 45), legs="square", lift=False, leg_len=60):
    """A drawn subject mask (uint8, 255 = animal): an ellipse body on four legs. legs: 'square' (vertical), 'stride'
    (fore and hind pairs opened into a V), 'none' (lying down)."""
    import cv2
    m = np.zeros((h, w), np.uint8)
    cx, cy, ax, ay = body
    cv2.ellipse(m, (cx, cy), (ax, ay), 0, 0, 360, 255, -1)
    if legs != "none":
        top = cy + ay // 2   # from inside the body, so every leg joins it
        for k, x in enumerate((cx - ax + 25, cx - ax + 50, cx + ax - 50, cx + ax - 25)):
            bottom = cy + ay + leg_len - (25 if lift and k == 0 else 0)
            dx = 0 if legs == "square" else (-40 if k % 2 == 0 else 40)
            cv2.line(m, (x, top), (x + dx, bottom), 255, 12)
    return m


def photo(mask, bg=(120, 160, 90), noise=0):
    """A photo of the silhouette: a brown animal on a plain (or noisy) background."""
    img = np.full(mask.shape + (3,), bg, np.uint8)
    if noise:
        img = np.clip(img.astype(int) + np.random.default_rng(1).integers(-noise, noise, img.shape), 0, 255).astype(np.uint8)
    img[mask > 0] = (110, 74, 50)
    return img


class Pose(unittest.TestCase):
    def test_standing_square_side_on_is_usable(self):
        p = rp.pose(silhouette())
        for k in ("whole", "size", "side", "legs", "stance", "clear", "solid"):
            self.assertGreater(p[k], 0.8, (k, p[k]))
        self.assertFalse(rp.usable(p, "quadruped"))

    def test_a_stride_fails_the_stance(self):   # iteration 7: a goat's stride made a mesh the leg gate refused
        p = rp.pose(silhouette(legs="stride"))
        self.assertGreater(p["spread"], rp.STRIDE_DEG + 20)
        self.assertEqual(p["stance"], 0.0)
        self.assertIn("stance", rp.usable(p, "quadruped"))

    def test_lying_down_shows_no_legs(self):    # iteration 7: a badger lying down made a legless lump
        p = rp.pose(silhouette(legs="none"))
        self.assertLess(p["legs"], 0.2)
        self.assertIn("legs", rp.usable(p, "quadruped"))

    def test_a_lifted_foot_lowers_the_stance(self):
        self.assertLess(rp.pose(silhouette(lift=True))["stance"], 0.5 * rp.pose(silhouette())["stance"])

    def test_cut_by_the_frame(self):
        p = rp.pose(silhouette(body=(60, 150, 140, 45)))
        self.assertLess(p["whole"], 0.5)
        self.assertIn("whole", rp.usable(p, "quadruped"))

    def test_a_snake_laid_out(self):
        import cv2
        m = np.zeros((320, 480), np.uint8)
        pts = np.array([(40 + 4 * t, 160 + int(50 * np.sin(t / 12))) for t in range(100)], np.int32)
        cv2.polylines(m, [pts], False, 255, 14)
        p = rp.pose(m, "snake")
        self.assertGreater(p["side"], 0.9)
        self.assertGreater(p["size"], 0.3)


class Score(unittest.TestCase):
    def test_side_on_whole_animal_scores(self):
        m = silhouette()
        s = rp.score(photo(m), prob=m)
        self.assertTrue(s["usable"], s)
        self.assertGreater(s["total"], 0.3)

    def test_a_stride_is_not_usable(self):
        m = silhouette(legs="stride")
        s = rp.score(photo(m), prob=m)
        self.assertFalse(s["usable"])
        self.assertIn("stance", s["why_not"])

    def test_a_busy_background_scores_less_than_a_plain_one(self):
        m = silhouette()
        self.assertGreater(rp.score(photo(m), prob=m)["plain"], rp.score(photo(m, noise=90), prob=m)["plain"])

    @unittest.skipUnless(rp.segmenters_ready(), "the segmenters' weights are not in the cache")
    def test_the_segmenters_find_the_animal(self):
        m = silhouette()
        prob = rp.subject_mask(photo(m))
        fg = prob >= 128
        iou = (fg & (m > 0)).sum() / max(1, (fg | (m > 0)).sum())
        self.assertGreater(iou, 0.7)


class Licences(unittest.TestCase):
    def test_commons_licences(self):
        for ok in ("CC0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 2.5 es", "CC BY 2.0"):
            self.assertTrue(rp.COMMONS_OK.match(ok), ok)
        for no in ("CC BY-NC 4.0", "CC BY-ND 2.0", "GFDL", "Public domain", "CC BY-NC-SA 3.0"):
            self.assertFalse(rp.COMMONS_OK.match(no), no)

    def test_segmenters_are_pinned_and_openly_licensed(self):
        for name, m in rp.SEGMENTERS.items():
            self.assertEqual(len(m["sha256"]), 64, name)
            self.assertTrue(m["licence"].startswith("Apache-2.0"), name)


if __name__ == "__main__":
    unittest.main()
