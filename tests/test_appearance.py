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


class SmallParts(unittest.TestCase):   # the bobcat, 2026-11-12
    def test_the_eyes_and_the_nose_are_not_the_coat(self):
        f = facts("Its eyes are yellow with black slit pupils. The nose of the test animal is pinkish-red, and it has a base "
                  "color of gray on its face, sides, and back.")
        self.assertFalse({c for _, c, _ in f} & {"yellow", "black", "pinkish-red"})
        self.assertIn(("head", "gray", None), f)

    def test_a_goldeneye_is_no_eye(self):
        f = facts("The common goldeneye has a round white patch on the face.")
        self.assertIn(("head", "white", "patches"), f)

    def test_a_sentence_going_on_about_a_colour_form_is_dropped_with_it(self):
        f = facts("A few melanistic animals have been sighted. They appear black, but may still exhibit a spot pattern. "
                  "The coat is tan.")
        self.assertEqual({c for _, c, _ in f}, {"tan"})

    def test_ear_tufts_are_tufts(self):
        f = facts("The ears are pointed, with short, black tufts.")
        self.assertEqual({(c, p) for _, c, p in f}, {("black", "tuft")})


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



class StripedSnake(unittest.TestCase):
    def test_a_dorsal_stripe_colour_is_the_stripe_not_the_back(self):
        f = facts("Most have a yellow, light orange, or white dorsal stripe, accompanied by two stripes of the same color.")
        self.assertIn(("upperparts", "yellow", "stripes"), f)
        self.assertNotIn(("body", "yellow", None), f)
        self.assertNotIn(("upperparts", "yellow", None), f)

    def test_bellies(self):
        self.assertIn(("underparts", "yellow", None), facts("They generally have grayish-green backs and yellow bellies."))

    def test_markings_cannot_be_the_whole_region(self):
        app = {"regions": {"upperparts": {"colours": ["grayish-green"], "markings": [{"pattern": "stripes", "colours": ["yellow"]}]}}}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.glb"
            _glb(p, [(0, lin("d8c048"))] * 10)   # yellow all over: the stripes' colour
            c = ap.check(p, app)
            self.assertFalse(c["ok"])
            self.assertTrue(any("ground colours" in f for f in c["fails"]), c["fails"])
            _glb(p, [(0, lin("6c7a5c"))] * 7 + [(0, lin("d8c048"))] * 3)   # greyish-green with yellow stripes
            self.assertTrue(ap.check(p, app)["ok"])


class Features(unittest.TestCase):
    def feats(self, text):
        return ap.features_from([{"sections": [("lead", text)]}], "Testus testus", ["test animal"])

    def test_horns_and_shoulder(self):
        f = self.feats("The pure black horns are about 200 to 300 mm long, rather thin. A male stands about 1 m (3.3 ft) "
                       "at the shoulder to the waist.")
        self.assertEqual(f["horns"]["length_m"], [0.2, 0.3])
        self.assertIn("black", f["horns"]["colours"][0])
        self.assertEqual(f["shoulder_m"], [1.0, 1.0])

    def test_tail_against_total(self):
        f = self.feats("Badgers measure 520 to 875 mm from head to tail, with the tail making up only 100 to 155 mm of this length.")
        self.assertEqual(f["total_m"], [0.52, 0.875])
        self.assertEqual(f["tail_m"] if "tail_m" in f else f["tail"]["length_m"], [0.1, 0.155])

    def test_a_horn_span_is_no_length_and_females_are_dropped(self):
        f = self.feats("The horn span is wide and can reach 130 cm. Female horns average about 120 mm.")
        self.assertIsNone(f["horns"]["length_m"])

    def test_conversions_in_brackets(self):
        f = self.feats("Adult males are 4.3–4.9 ft (1.3–1.5 m) long from nose to tail, stand 2.7–3.4 ft (82–104 cm) high at the shoulder.")
        self.assertAlmostEqual(f["shoulder_m"][0], 0.823, places=2)
        self.assertAlmostEqual(f["total_m"][1], 1.494, places=2)

    def test_a_tail_inside_a_longer_measure_is_not_the_subject(self):   # the bobcat, 2026-11-12
        f = self.feats("It reaches a total length, including the tail, of up to 125 cm. The adult is 47.5–125 cm (18.7–49.2 in) "
                       "long from the head to the base of its distinctive stubby tail, averaging 82.7 cm (32.6 in); the "
                       "tail is 9 to 20 cm (3.5 to 7.9 in) long.")
        self.assertEqual(f["tail"]["length_m"], [0.09, 0.2])
        self.assertEqual(f["tail"]["words"], ["short"])   # "stubby"; the "long" that closes the figure is no word for it
        self.assertEqual(f["total_m"], [1.25, 1.25])
        self.assertEqual(f["head_body_m"], [0.651, 1.0385])
        self.assertEqual(ap.feature_lead({"features": f}), "Tail short, about 15 cm.")

    def test_a_tail_a_length_includes_keeps_its_own_figure(self):
        f = self.feats("It is 1 m long, including a tail of 30 to 40 cm.")
        self.assertEqual(f["tail"]["length_m"], [0.3, 0.4])

    def test_feature_lead(self):
        app = {"features": {"horns": {"described": True, "words": ["long", "curved"], "colours": ["black"], "length_m": [0.15, 0.28]},
                            "tail": {"words": [], "length_m": [0.1, 0.2]}, "shoulder_m": [1.0, 1.0], "head_body_m": [1.2, 1.8]}}
        self.assertEqual(ap.feature_lead(app), "Horns short, curved, black, about 22 cm long. Tail short, about 15 cm.")

class Prompt(unittest.TestCase):
    def test_lead_inserted_and_kept_under_800(self):
        tex = "Natural coat colours of a wild adult x (X y) as seen in z; realistic, evenly lit albedo with no baked shadows."
        lead = "Coloured as the adult is described: " + "; ".join(f"region{i} pale yellowish with dark spots" for i in range(40)) + "."
        out = fm._with_lead(tex, lead)
        self.assertLessEqual(len(out), 800)
        self.assertTrue(out.startswith("Natural coat colours of a wild adult x (X y) as seen in z. Coloured as"))
        self.assertTrue(out.endswith("Realistic, evenly lit albedo with no baked shadows."))
        self.assertEqual(fm._with_lead(tex, ""), tex)


class Named(unittest.TestCase):   # a paid run for the species named (the home tile's bobcat, 2026-11-12)
    def test_a_tile_slot_or_a_four_legged_trait_card(self):
        said = []
        fauna = {"slots": [{"code": "sciurus_niger", "common": "Fox squirrel", "archetype": "tree squirrel"}]}
        got = fm.named_slots(fauna, ["lynx_rufus", "sciurus_niger", "no_such_animal"], log=said.append)
        self.assertEqual([s["code"] for s in got], ["lynx_rufus", "sciurus_niger"])
        self.assertEqual(got[0]["scientific"], "Lynx rufus")
        self.assertTrue(fm.quadruped(got[0], fm._traits("lynx_rufus")))
        self.assertEqual(got[1]["archetype"], "tree squirrel")   # the tile's own slot, whole
        self.assertTrue(all(s["why"] == "named" for s in got))
        self.assertIn("no_such_animal", said[0])


class ShortTailPrompt(unittest.TestCase):
    def test_a_short_tail_is_not_asked_to_hang(self):
        mesh, _ = fm.prompts(fm.named_slots({}, ["lynx_rufus"])[0], "El Dorado County, California")
        self.assertIn("Tail short, about 15 cm.", mesh)
        self.assertNotIn("hanging", mesh)
        self.assertIn("the short tail a stub", mesh)
        mesh, _ = fm.prompts(fm.named_slots({}, ["puma_concolor"])[0], "El Dorado County, California")
        self.assertIn("tail hanging free clear of the legs", mesh)


class ShapeGate(unittest.TestCase):   # the bobcat's long tail, found on the preview (2026-11-12)
    def gate(self, built, geometry):
        from unittest import mock
        from pathlib import Path
        with mock.patch.object(fm, "build", return_value=(built, "INFO legs\nno legs found")), \
                mock.patch.object(fm, "appearance", return_value={"features": {}}), \
                mock.patch.object(ap, "feature_check", return_value={"geometry": geometry, "texture": ["tail ringed"]}):
            return fm.shape_gate("lynx_rufus", Path("preview"), "utm10n_680_4280")

    def test_the_described_shape_passes_whatever_the_texture(self):
        self.assertEqual(self.gate(True, []), {"ok": True, "why": []})

    def test_a_long_tail_is_refused_before_the_refine(self):
        g = self.gate(True, ["tail too long: 0.43 of the head and body"])
        self.assertFalse(g["ok"]); self.assertIn("tail too long", g["why"][0])

    def test_a_mesh_the_build_cannot_use_is_refused(self):
        g = self.gate(False, [])
        self.assertFalse(g["ok"]); self.assertIn("no legs found", g["why"][0])


class Iteration8(unittest.TestCase):
    """The check's rules that let it agree with the judge (iteration 8)."""
    def test_grey_before_a_hue_is_a_low_chroma(self):
        g = ap.colour_lab("grayish-green")
        green = ap.colour_lab("green")
        self.assertLess(float(np.hypot(g[1], g[2])), 0.5 * float(np.hypot(green[1], green[2])))
        self.assertLess(g[1], 0)   # still a green
        self.assertGreater(float(np.hypot(*ap.colour_lab("yellowish-brown")[1:])), 20)   # a hue modifier stays a hue

    def test_a_pale_patch_in_a_described_coat_colour(self):
        cream = ap.colour_lab("cream")
        self.assertEqual(ap.described_pale(cream, {"upperparts": {"colours": ["whitish-cream"]}}, ap.MATCH_DE), "whitish-cream")
        # the pale end of a range of individuals is no pattern on one animal
        self.assertIsNone(ap.described_pale(cream, {"body": {"colours": ["dark brown", "almost white"]}}, ap.MATCH_DE))

    def test_one_marking_per_pattern_over_the_body(self):
        regs = {"body": {"colours": [], "markings": [{"pattern": "stripes", "colours": ["yellow"]}]},
                "upperparts": {"colours": ["black"], "markings": [{"pattern": "stripes", "colours": ["yellow", "white"]}]}}
        black, white = ap.colour_lab("black"), ap.colour_lab("white")
        mr = {"upperparts": (np.array([black] * 8 + [white] * 2), np.ones(10)), "flanks": (np.array([black] * 10), np.ones(10))}
        st = ap.colour_stats(mr, regs)
        self.assertEqual(list(st["body_marks"]), ["yellow/white stripes"])
        self.assertFalse(ap.colour_fails(st, ap.CHECK_PARAMS)["fails"])   # white stripes, as one source gives them

    def test_a_snakes_underside_is_not_judged(self):
        regs = {"upperparts": {"colours": ["black"], "markings": []}, "underparts": {"colours": ["yellow"], "markings": []}}
        grey = ap.colour_lab("grey")
        mr = {"upperparts": (np.array([ap.colour_lab("black")] * 10), np.ones(10)), "underparts": (np.array([grey] * 10), np.ones(10))}
        self.assertTrue(ap.colour_fails(ap.colour_stats(mr, regs), ap.CHECK_PARAMS)["fails"])
        st = ap.colour_stats(mr, regs, kind="snake")
        self.assertTrue(st["regions"]["underparts"].get("hidden"))
        self.assertFalse(ap.colour_fails(st, ap.CHECK_PARAMS)["fails"])

    def test_known_verdicts(self):
        k = ap.known_verdicts()
        self.assertTrue(any(x["verdict"] == "rejected" and x["model"] != "current" for x in k))
        self.assertTrue(all(x["verdict"] in ("accepted", "rejected") for x in k))


if __name__ == "__main__":
    unittest.main()
