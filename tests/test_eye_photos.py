"""tools/probes/eye_photos.py: licence filter, heading parsing, metadata rules, selection and the wide-shot test
(offline, no network)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "probes"))
import eye_photos as ep  # noqa: E402


def cand(i, x, north, source="commons", heading=None, w=1280, h=853, **kw):
    c = {"id": f"{source}_{i}", "source": source, "x": x, "north": north, "heading": heading, "width": w, "height": h}
    c.update(kw)
    return c


def good_meta(**kw):
    c = {"source": "commons", "camera": True, "inside": True, "licence_ok": True, "mime": "image/jpeg",
         "width": 1280, "height": 853, "year": 2016, "title": "File:Lamar Valley looking east.jpg",
         "description": "", "categories": ""}
    c.update(kw)
    return c


class Licence(unittest.TestCase):
    def test_kept(self):
        self.assertTrue(ep.licence_ok("CC BY-SA 4.0", ""))
        self.assertTrue(ep.licence_ok("CC BY 2.0", None))
        self.assertTrue(ep.licence_ok("CC BY-SA 3.0 de", None))
        self.assertTrue(ep.licence_ok("CC0", None))
        self.assertTrue(ep.licence_ok("Public domain", None))
        self.assertTrue(ep.licence_ok("PD-USGov-Interior-NPS", None))
        self.assertTrue(ep.licence_ok("", "Creative Commons Attribution-Share Alike 4.0"))

    def test_rejected(self):
        self.assertFalse(ep.licence_ok("CC BY-NC 2.0", None))
        self.assertFalse(ep.licence_ok("CC BY-NC-SA 2.0", None))
        self.assertFalse(ep.licence_ok("CC BY-ND 4.0", None))
        self.assertFalse(ep.licence_ok("GFDL", None))
        self.assertFalse(ep.licence_ok("GFDL 1.2", "GNU Free Documentation License"))
        self.assertFalse(ep.licence_ok("", ""))
        self.assertFalse(ep.licence_ok(None, None))
        self.assertFalse(ep.licence_ok("Fair use", None))
        self.assertFalse(ep.licence_ok("Attribution", None))


class Heading(unittest.TestCase):
    def test_wikitext(self):
        self.assertEqual(ep.parse_heading_wikitext("{{Location|37|44|39|N|119|35|27|W|scale:15000_heading:345_region:US-CA}}"), 345.0)
        self.assertAlmostEqual(ep.parse_heading_wikitext("x {{Location dec|37.74|-119.59|heading:326.549}} y"), 326.549)
        self.assertEqual(ep.parse_heading_wikitext("{{Location|37.7|-119.5|heading:NE}}"), 45.0)
        self.assertEqual(ep.parse_heading_wikitext("{{Camera location|37.7|-119.5|heading:-90}}"), 270.0)

    def test_none(self):
        self.assertIsNone(ep.parse_heading_wikitext("{{Location dec|37.745539|-119.589657|source:Flickr}}"))
        self.assertIsNone(ep.parse_heading_wikitext("{{Object location|37.7|-119.5|heading:90}}"))
        self.assertIsNone(ep.parse_heading_wikitext(""))
        self.assertIsNone(ep.parse_heading_wikitext(None))


class Metadata(unittest.TestCase):
    def test_pass(self):
        self.assertIsNone(ep.metadata_reject_reason(good_meta()))

    def test_keywords(self):
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:Hikers on the South Kaibab Trail.jpg")), "kw_people")
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:El Tovar Hotel.jpg")), "kw_buildings")
        self.assertEqual(ep.metadata_reject_reason(good_meta(categories="Aerial photographs of the Grand Canyon")), "kw_aerial")
        self.assertEqual(ep.metadata_reject_reason(good_meta(description="Yosemite Valley in winter snow")), "kw_winter")
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:Lupine close-up.jpg")), "kw_closeup")
        # maintenance categories do not count: "Pages with maps" is not a map
        self.assertIsNone(ep.metadata_reject_reason(good_meta(categories="Pages with maps|Lamar Valley")))
        # whole words only: "Carex" is not a car, "Mantle" is not a man
        self.assertIsNone(ep.metadata_reject_reason(good_meta(title="File:Carex meadow below Mantle ridge.jpg")))

    def test_people_by_metadata(self):
        self.assertEqual(ep.metadata_reject_reason(good_meta(
            title="File:Sasha James Natalie (53004491328).jpg",
            description="Three SAR specialists configure a litter during a training exercise.")), "kw_people")
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:Sasha James Natalie (53004491328).jpg")),
                         "flickr_name_only")
        self.assertIsNone(ep.metadata_reject_reason(good_meta(title="File:Lamar Valley morning (53004491328).jpg")))

    def test_binomial_title(self):
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:Phacelia sericea.jpg")), "binomial_title")
        self.assertIsNone(ep.metadata_reject_reason(good_meta(title="File:Artemisia tridentata vaseyana - Lamar Valley.jpg")))

    def test_low_sun(self):
        self.assertEqual(ep.metadata_reject_reason(good_meta(title="File:Sunset at Hopi Point.jpg")), "kw_low_sun")
        # Grand Canyon, 3 October 2021, 18:01 by the camera clock: the sun is setting
        el = ep.low_sun_elevation(36.06, -112.1, "2021-10-03 18:01:51")
        self.assertLess(el, ep.LOW_SUN_DEG)
        self.assertEqual(ep.metadata_reject_reason(good_meta(sun_elevation=el)), "low_sun_time")
        self.assertGreater(ep.low_sun_elevation(36.06, -112.1, "2012-09-14 15:07:02"), 25)
        self.assertIsNone(ep.low_sun_elevation(36.06, -112.1, "2010-08-25"))
        self.assertLess(ep.low_sun_elevation(36.06, -112.1, "File:2016-03-20 18 12 05 View east-northeast.jpg"), ep.LOW_SUN_DEG)

    def test_shape_and_other_rules(self):
        self.assertEqual(ep.metadata_reject_reason(good_meta(width=1280, height=1600)), "aspect")
        self.assertEqual(ep.metadata_reject_reason(good_meta(width=1280, height=400)), "aspect")
        self.assertEqual(ep.metadata_reject_reason(good_meta(width=800, height=600)), "too_small")
        self.assertEqual(ep.metadata_reject_reason(good_meta(year=1972)), "before_2000")
        self.assertEqual(ep.metadata_reject_reason(good_meta(licence_ok=False)), "licence")
        self.assertEqual(ep.metadata_reject_reason(good_meta(mime="image/png")), "not_jpeg")
        self.assertEqual(ep.metadata_reject_reason(good_meta(camera=False)), "no_camera_location")
        self.assertEqual(ep.metadata_reject_reason(good_meta(inside=False)), "outside_tile")
        self.assertEqual(ep.metadata_reject_reason(good_meta(source="inaturalist", obscured=True, accuracy=5)), "obscured")
        self.assertEqual(ep.metadata_reject_reason(good_meta(source="inaturalist", obscured=False, accuracy=None)), "accuracy")


class Select(unittest.TestCase):
    def test_spread_and_separation(self):
        cs = [cand(1, 0, 0), cand(2, 100, 0), cand(3, 10000, 10000), cand(4, 5000, 5000), cand(5, 0, 10000)]
        got = [c["id"] for c in ep.select(cs, limit=10, min_sep_m=300)]
        self.assertNotIn("commons_2", got)            # 100 m from commons_1
        self.assertEqual(set(got), {"commons_1", "commons_3", "commons_4", "commons_5"})
        self.assertEqual(got[:2], ["commons_1", "commons_3"])   # first pick by size/id, then the farthest

    def test_heading_first(self):
        cs = [cand(1, 0, 0), cand(2, 5000, 5000, heading=90.0)]
        self.assertEqual(ep.select(cs, limit=1)[0]["id"], "commons_2")

    def test_inat_cap(self):
        cs = [cand(i, i * 1000, 0, source="inaturalist") for i in range(8)] + [cand(99, 0, 9000)]
        got = ep.select(cs, limit=10)
        self.assertEqual(sum(c["source"] == "inaturalist" for c in got), 3)
        self.assertEqual(len(got), 4)

    def test_accept_refusal_and_determinism(self):
        cs = [cand(i, (i * 37) % 10000, (i * 911) % 10000) for i in range(40)]
        a = [c["id"] for c in ep.select(cs, 6, accept=lambda c: c["id"] != "commons_0")]
        b = [c["id"] for c in ep.select(list(reversed(cs)), 6, accept=lambda c: c["id"] != "commons_0")]
        self.assertEqual(a, b)
        self.assertNotIn("commons_0", a)


class WideShot(unittest.TestCase):
    def test_sky_over_land_is_wide(self):
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (240, 160), (60, 140, 60))
        ImageDraw.Draw(im).rectangle([0, 0, 239, 79], fill=(110, 160, 230))
        st = ep.wide_shot_stats(im)
        self.assertGreater(st["sky_top"], 0.9)
        self.assertGreaterEqual(st["saturation"], ep.GREY_SAT)

    def test_all_green_is_not_wide(self):
        from PIL import Image
        st = ep.wide_shot_stats(Image.new("RGB", (240, 160), (60, 140, 60)))
        self.assertLess(st["sky_top"], 0.05)
        self.assertEqual(st["horizon_step"], 0.0)
        self.assertEqual(ep.image_reject_reason(st), "not_wide")

    def test_textured_land_under_sky_passes(self):
        import numpy as np
        from PIL import Image
        a = np.zeros((160, 240, 3), np.uint8)
        a[:80] = (110, 160, 230)
        a[80:] = np.random.default_rng(0).integers(30, 140, (80, 240, 3))
        st = ep.wide_shot_stats(Image.fromarray(a))
        self.assertIsNone(ep.image_reject_reason(st))

    def test_pale_textured_top_is_not_sky(self):
        """Pale rock or bleached twigs behind a close-up: bright and colourless but textured, so not a real sky."""
        import numpy as np
        from PIL import Image
        rng = np.random.default_rng(1)
        a = np.zeros((160, 240, 3), np.uint8)
        a[:80] = np.clip(200 + rng.integers(-50, 50, (80, 240, 1)), 0, 255)
        a[80:] = rng.integers(30, 140, (80, 240, 3))
        st = ep.wide_shot_stats(Image.fromarray(a))
        self.assertLess(st["sky_region_top"], ep.SKY_REGION)
        self.assertEqual(ep.image_reject_reason(st), "not_wide")

    def test_silhouette(self):
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (240, 160), (25, 20, 18))
        ImageDraw.Draw(im).rectangle([0, 0, 239, 79], fill=(200, 210, 235))
        st = ep.wide_shot_stats(im)
        self.assertEqual(ep.image_reject_reason(dict(st, detail_spread=1.0)), "silhouette")

    def test_grey_is_rejected(self):
        from PIL import Image
        st = ep.wide_shot_stats(Image.new("RGB", (240, 160), (128, 128, 128)))
        self.assertEqual(ep.image_reject_reason(st), "greyscale")


if __name__ == "__main__":
    unittest.main()
