"""pipeline/appearance.py: colour facts read from description sentences, and the model colour check (offline)."""
import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from pipeline import appearance as ap
from pipeline import fauna_models as fm


def facts(text, sci="Testus testus", names=("test animal",), male=False):
    f, _ = ap.facts_from(text, sci, list(names), male)
    return {(x["region"], x["colours"][0], x["pattern"]) for x in f}


class Facts(unittest.TestCase):
    def test_markings_on_a_ground_colour(self):
        f = facts("Juveniles and young adults are attractively marked with black blotches, spots, or even dashes and "
                  "stripes on a yellow background.")
        self.assertIn(("body", "black", "blotches"), f)
        self.assertIn(("body", "yellow", None), f)

    def test_age_change_and_young_dropped(self):
        self.assertEqual(facts("In mature adults, the markings tend to fade to a nondescript brown or grey."), set())
        self.assertEqual(facts("New chicks are fawn-coloured, with dark brown spots."), set())

    def test_subject_regions_take_the_colour(self):
        f = facts("The head and limbs are uniformly colored yellow, tan, or brown.")
        self.assertIn(("head", "tan", None), f)
        self.assertIn(("legs", "brown", None), f)
        self.assertNotIn(("body", "tan", None), f)

    def test_clauses_split_their_regions(self):
        f = facts("The male's head, neck, and shoulders are bright red or violet, while the body is dark blue.", male=True)
        self.assertIn(("head", "bright red", None), f)
        self.assertIn(("body", "dark blue", None), f)
        self.assertNotIn(("head", "dark blue", None), f)

    def test_female_clause_dropped_when_the_male_is_described(self):
        f = facts("The tarsus is covered in scales: red in the male, black in the female.", male=True)
        self.assertIn(("legs", "red", None), f)
        self.assertNotIn(("legs", "black", None), f)

    def test_the_name_is_not_a_colour(self):
        f = facts("The blue wildebeest has a long, black tail.", names=("blue wildebeest",))
        self.assertEqual(f, {("tail", "black", None)})

    def test_marking_placed_by_the_nearest_body_word(self):
        f = facts("They are greyish-brown above with greenish-yellow barring on the tail.")
        self.assertIn(("upperparts", "greyish-brown", None), f)
        self.assertIn(("tail", "greenish-yellow", "bars"), f)


class Colour(unittest.TestCase):
    def test_named_colours_order(self):
        y, o, b = ap.colour_lab("yellow"), ap.colour_lab("orange"), ap.colour_lab("black")
        self.assertGreater(y[0], b[0] + 50)
        self.assertGreater(float(ap.de2000(y[None], o[None])[0, 0]), ap.MATCH_DE)
        self.assertLess(ap.colour_lab("pale yellow")[0], 100)
        self.assertGreater(ap.colour_lab("pale yellow")[0], y[0])

    def test_de2000_reference_pair(self):   # Sharma et al. 2005, pair 1: 2.0425 at kL 1
        d = ap.de2000(np.array([[50.0, 2.6772, -79.7751]]), np.array([[50.0, 0.0, -82.7485]]), kL=1.0)[0, 0]
        self.assertAlmostEqual(float(d), 2.0425, places=3)


def _glb(path, colours_by_part):
    """A tiny GLB of one triangle pair per part, each part one colour (linear), _PART per vertex."""
    P, C, R, I = [], [], [], []
    for k, (part, col) in enumerate(colours_by_part):
        o = len(P)
        P += [(k, 1, 0), (k + 1, 1, 0), (k, 1, 1), (k + 1, 1, 1)]   # a flat top: the upper side
        C += [col] * 4; R += [part] * 4; I += [(o, o + 2, o + 1), (o + 1, o + 2, o + 3)]
    arrs = [np.array(P, np.float32), np.array(C, np.float32), np.array(R, np.float32), np.ones(len(R), np.float32),
            np.array(I, np.uint16).ravel()]
    bin_, views, accs = b"", [], []
    for a, t in zip(arrs, ("VEC3", "VEC3", "SCALAR", "SCALAR", "SCALAR")):
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": a.nbytes})
        accs.append({"bufferView": len(views) - 1, "componentType": 5123 if a.dtype == np.uint16 else 5126,
                     "count": a.size // {"VEC3": 3, "SCALAR": 1}[t], "type": t})
        bin_ += a.tobytes() + b"\0" * (-a.nbytes % 4)
    j = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": len(bin_)}], "bufferViews": views, "accessors": accs,
         "meshes": [{"name": "lod0", "primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1, "_PART": 2, "_PARTW": 3}, "indices": 4}]}]}
    js = json.dumps(j).encode(); js += b" " * (-len(js) % 4)
    Path(path).write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack("<II", len(js), 0x4E4F534A)
                           + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def lin(hexs):
    return tuple(float(v) for v in ap._hex_lin(hexs))


class Check(unittest.TestCase):
    APP = {"regions": {"body": {"colours": ["yellow"], "markings": [{"pattern": "blotches", "colours": ["black"]}]},
                       "head": {"colours": ["tan"], "markings": []}}}

    def test_described_colours_pass(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.glb"
            _glb(p, [(0, lin("d8c048"))] * 9 + [(0, lin("1c1b1a")), (6, lin("c4a070"))])
            c = ap.check(p, self.APP)
            self.assertTrue(c["ok"], c)

    def test_orange_shell_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.glb"
            _glb(p, [(0, lin("b86a30"))] * 10 + [(6, lin("c4a070"))])
            c = ap.check(p, self.APP)
            self.assertFalse(c["ok"])
            self.assertTrue(any("upperparts" in f for f in c["fails"]), c["fails"])

    def test_no_description_passes(self):
        self.assertTrue(ap.check(Path("/nonexistent.glb"), {"regions": {}})["ok"])


class Prompt(unittest.TestCase):
    def test_lead_inserted_and_kept_under_800(self):
        tex = "Natural coat colours of a wild adult x (X y) as seen in z; realistic, evenly lit albedo with no baked shadows."
        lead = "Coloured as the adult is described: " + "; ".join(f"region{i} pale yellowish with dark spots" for i in range(40)) + "."
        out = fm._with_lead(tex, lead)
        self.assertLessEqual(len(out), 800)
        self.assertTrue(out.startswith("Natural coat colours of a wild adult x (X y) as seen in z. Coloured as"))
        self.assertTrue(out.endswith("Realistic, evenly lit albedo with no baked shadows."))
        self.assertEqual(fm._with_lead(tex, ""), tex)


if __name__ == "__main__":
    unittest.main()
