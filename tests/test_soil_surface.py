"""The soil surface step's rules (pipeline/soil_surface.py): Munsell to reflectance, the OSD's surface colour, the litter share."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import soil_surface as ss

OSD = """<html><body><p>TYPICAL PEDON: Example loam, grassland. (Colors are for dry soil unless otherwise noted.)</p>
<p>Oi --0 to 1 inch; undecomposed grass litter.</p>
<p>A --1 to 9 inches; grayish brown (10YR 5/2) gravelly loam, very dark grayish brown (10YR 3/2) moist; strong fine granular structure.</p>
<p>Bw --9 to 23 inches; brown (7.5YR 5/3) very gravelly loam, dark brown (7.5YR 3/3) moist.</p>
<p>TYPE LOCATION: somewhere.</p></body></html>"""

OSD_MOIST = """TYPICAL PEDON: Other loam. (Colors are for moist soil unless otherwise noted.)
A --O to 8 inches, black (10YR 2/1) loam, dark gray (10YR 4/1) dry; granular. Bw --8 to 16 inches, brown (10YR 4/3) loam.
TYPE LOCATION: there."""


class TestMunsell(unittest.TestCase):
    def test_neutral_value_5(self):
        r, g, b = ss.munsell_to_linear("N 5/")
        self.assertAlmostEqual(r, g, delta=0.005)
        self.assertAlmostEqual(g, b, delta=0.005)
        self.assertAlmostEqual(0.2126 * r + 0.7152 * g + 0.0722 * b, 0.198, delta=0.01)   # ASTM D1535: Y(5) = 19.8 %

    def test_soil_hues(self):
        r, g, b = ss.munsell_to_linear("10YR 5/2")   # grayish brown: warm, a little
        self.assertTrue(r > g > b)
        self.assertLess(r / b, 2.0)
        lo, hi = ss.munsell_to_linear("10YR 3/2"), ss.munsell_to_linear("10YR 6/3")
        self.assertLess(sum(lo), sum((r, g, b)))
        self.assertGreater(sum(hi), sum((r, g, b)))
        r5, g5, b5 = ss.munsell_to_linear("5YR 5/4")   # redder than 10YR at the same value and chroma
        r10, g10, b10 = ss.munsell_to_linear("10YR 5/4")
        self.assertGreater(r5 / g5, r10 / g10)


class TestOSD(unittest.TestCase):
    def _parse(self, text, name="EXAMPLE"):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "osd"; p.mkdir()
            (p / f"{name}.html").write_text(text)
            with mock.patch.object(ss, "CACHE", Path(d)):
                return ss.osd_surface(name)

    def test_dry_first_mineral_horizon(self):
        s = self._parse(OSD)
        self.assertEqual(s["horizon"], "A")   # the O horizon skipped
        self.assertEqual(s["dry"], "10YR 5/2")
        self.assertEqual(s["moist"], "10YR 3/2")

    def test_moist_convention_and_letter_o(self):
        s = self._parse(OSD_MOIST, "OTHER")
        self.assertEqual(s["moist"], "10YR 2/1")
        self.assertEqual(s["dry"], "10YR 4/1")

    def test_no_pedon(self):
        self.assertIsNone(self._parse("<html>No such series</html>", "NONE"))


class TestESD(unittest.TestCase):
    def _ground(self, sheet):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "esd"; p.mkdir()
            (p / "R043BY999WY.json").write_text(json.dumps({"referenceSheet": sheet}))
            with mock.patch.object(ss, "CACHE", Path(d)):
                return ss.esd_ground("R043BY999WY")

    def test_litter_cover_field(self):
        g = self._ground({"litterCover": "5-40", "narratives": {"bareGround": "Bare ground can range from 0-10%. "}})
        self.assertEqual(g["litter_cover"], [5.0, 40.0])
        self.assertEqual(g["bare_ground"], [0.0, 10.0])

    def test_litter_notes(self):
        g = self._ground({"litterCover": "", "narratives": {"bareGround": "Bare ground can range from 0-20%.",
                          "litterNotes": "Litter ranges from 5-40% of total canopy measurement with total litter 50-90%."}})
        self.assertEqual(g["litter_cover"], [5.0, 40.0])
        self.assertEqual(g["bare_ground"], [0.0, 20.0])


if __name__ == "__main__":
    unittest.main()
