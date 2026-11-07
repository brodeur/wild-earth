"""pipeline/fauna_models.py: model acceptance as a rule (iteration 10). The override stage's order, model_for serving by
the rule unless a recorded verdict overrides it, the next job the rule would pay for, the photo rule's use test, and the
rule on the library's own models and recorded verdicts (skipped where the git-ignored builds or GLBs are missing)."""
import json
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from pipeline import fauna_models as fm
from pipeline import reference_photos as rp

ROOT = Path(__file__).resolve().parent.parent
JOB = ROOT / "library" / "animals" / "jobs" / "x_y" / "01aa-model"
OTHER = "library/animals/jobs/x_y/01bb-other"


def stages(model=True, gate=True, check=True, geometry=(), fails=()):
    return {"model": {"ok": model}, "gate": {"ok": gate, **({} if gate else {"why": "found 3 leg columns"})},
            "check": {"ok": check, "fails": list(fails), "geometry": list(geometry)}, "provenance": {}}


class Override(unittest.TestCase):
    def test_none_recorded(self):
        self.assertIsNone(fm.override_of({}, JOB))

    def test_judge_on_this_model(self):
        o = fm.override_of({"judge": {"verdict": "rejected", "model": str(JOB.relative_to(ROOT)), "why": "ibex horns"}}, JOB)
        self.assertEqual((o["source"], o["verdict"], o["serve"]), ("judge", "rejected", False))

    def test_a_stale_judge_or_one_on_another_model_does_not_apply(self):
        self.assertIsNone(fm.override_of({"judge": {"verdict": "accepted", "model": str(JOB.relative_to(ROOT)), "stale": "rebuilt"}}, JOB))
        self.assertIsNone(fm.override_of({"judge": {"verdict": "rejected", "model": OTHER}}, JOB))

    def test_an_explicit_override_comes_first(self):
        e = {"override": {"verdict": "rejected", "serve": True, "model": str(JOB.relative_to(ROOT)), "why": "no better came"},
             "judge": {"verdict": "rejected"}, "verdicts": [{"model": "current", "verdict": "rejected"}]}
        o = fm.override_of(e, JOB)
        self.assertEqual((o["source"], o["verdict"], o["serve"]), ("override", "rejected", True))

    def test_an_override_on_another_model_falls_through_to_the_verdicts(self):
        e = {"override": {"verdict": "accepted", "serve": True, "model": OTHER},
             "verdicts": [{"model": OTHER, "verdict": "accepted"}, {"model": "current", "verdict": "rejected", "why": "w"}]}
        o = fm.override_of(e, JOB)
        self.assertEqual((o["source"], o["serve"]), ("verdicts", False))


class Serving(unittest.TestCase):
    def setUp(self):
        self.glb = ROOT / "client" / "assets" / "fauna" / "bison_bison.glb"
        if not self.glb.exists():
            self.skipTest("no library GLB")

    def test_an_override_decides_before_the_rule(self):
        with mock.patch.object(fm, "acceptance", side_effect=AssertionError("the rule is not run")):
            self.assertFalse(fm.served_by_rule("bison_bison", {"glb": "client/assets/fauna/bison_bison.glb",
                                                               "judge": {"verdict": "rejected"}}))

    def test_the_recorded_rule_on_this_glb_is_used(self):
        rec = {"format": fm.ACCEPT_FORMAT, "glb_sha1": fm._sha1(self.glb), "rule": {"decision": "rejected"}}
        with mock.patch.object(fm, "acceptance", side_effect=AssertionError("the rule is not run")):
            self.assertFalse(fm.served_by_rule("bison_bison", {"glb": "client/assets/fauna/bison_bison.glb", "acceptance": rec}))

    def test_a_record_on_another_glb_is_run_again(self):
        rec = {"format": fm.ACCEPT_FORMAT, "glb_sha1": "0" * 40, "rule": {"decision": "rejected"}}
        with mock.patch.object(fm, "acceptance", return_value={"rule": {"decision": "accepted"}}) as run:
            self.assertTrue(fm.served_by_rule("bison_bison", {"glb": "client/assets/fauna/bison_bison.glb", "acceptance": rec}))
            run.assert_called_once()


class Due(unittest.TestCase):
    """A species with no reference photos (no store): the text rungs."""

    def test_an_accepted_text_model_is_due_nothing(self):
        self.assertIsNone(fm.due("x_y", {}, {"decision": "accepted", "stages": stages()}, {"rung": "text"}))

    def test_a_geometry_failure_needs_a_new_mesh(self):
        d = fm.due("x_y", {}, {"decision": "rejected", "stages": stages(check=False, geometry=["horns too long"], fails=["horns too long"])}, {})
        self.assertEqual((d["job"], d["credits"]), ("text preview + refine", fm.COST["preview"] + fm.COST["refine"]))
        d = fm.due("x_y", {}, {"decision": "rejected", "stages": stages(gate=False)}, {})
        self.assertEqual(d["credits"], 30)

    def test_a_texture_failure_needs_a_refine(self):
        d = fm.due("x_y", {}, {"decision": "rejected", "stages": stages(check=False, fails=["no white stripes"])}, {})
        self.assertEqual(d["credits"], fm.COST["refine"])
        self.assertIn("texture", d["why"])

    def test_no_model_is_due_nothing_here(self):
        self.assertIsNone(fm.due("x_y", {}, {"decision": "rejected", "stages": stages(model=False)}, {}))


class PhotoUse(unittest.TestCase):
    def test_a_stride_serves_a_texture_but_not_image_to_3d(self):
        from tests.test_reference_photos import silhouette
        s = rp.pose(silhouette(legs="stride"))
        self.assertIn("stance", rp.usable_for(s, "quadruped", "image"))
        self.assertEqual(rp.usable_for(s, "quadruped", "texture"), [])

    def test_a_frame_cut_animal_serves_neither(self):
        from tests.test_reference_photos import silhouette
        s = rp.pose(silhouette(body=(60, 150, 140, 45)))
        self.assertIn("whole", rp.usable_for(s, "quadruped", "texture"))


def _library():
    try:
        return json.loads(fm.REGISTRY.read_text())["species"]
    except (OSError, ValueError, KeyError):
        return {}


class Library(unittest.TestCase):
    """The rule on the library's models as recorded in models.json (no credits, no Blender)."""

    def setUp(self):
        self.reg = _library()
        need = ["antilocapra_americana", "stigmochelys_pardalis", "taxidea_taxus"]
        if not all(c in self.reg and (ROOT / self.reg[c]["glb"]).exists() for c in need):
            self.skipTest("library GLBs not present")

    def test_the_pronghorn_passes_and_a_mesh_from_the_rules_photo_is_due(self):
        a = fm.acceptance("antilocapra_americana", self.reg["antilocapra_americana"])
        self.assertEqual(a["rule"]["decision"], "accepted")
        self.assertTrue(a["served"])
        self.assertEqual(a["override"]["source"], "judge")
        self.assertTrue(a["agrees"])
        pv = a["rule"]["stages"]["provenance"]
        self.assertEqual((pv["use"], pv["photo_usable"]), ("image", False))
        self.assertEqual((a["due"]["job"], a["due"]["credits"]), ("image-to-3D", 30))

    def test_the_tortoise_is_rejected_by_the_rule_and_drawn_by_its_recorded_override(self):
        a = fm.acceptance("stigmochelys_pardalis", self.reg["stigmochelys_pardalis"])
        self.assertEqual(a["rule"]["decision"], "rejected")
        self.assertEqual((a["override"]["source"], a["override"]["serve"], a["served"]), ("override", True, True))
        self.assertEqual(a["due"]["credits"], 10)

    def test_the_badger_text_model_is_rejected_by_the_rule(self):
        a = fm.acceptance("taxidea_taxus", self.reg["taxidea_taxus"])
        self.assertEqual(a["rule"]["decision"], "rejected")
        self.assertFalse(a["served"])
        self.assertIsNone(fm.model_for("taxidea_taxus"))

    def test_no_model_drawn_before_the_rule_is_dropped(self):
        # what model_for served before iteration 10 (drawn unless the judge rejected it) is still served: the rule
        # removes nothing from a tile; the two Serengeti reptiles it rejects stay by their recorded override
        for code, e in self.reg.items():
            glb = ROOT / e["glb"]
            clips = ROOT / "client" / "assets" / "fauna" / f"{code}_clips.json"
            had = glb.exists() and (e.get("kind", "quadruped") != "quadruped" or clips.exists()) and (e.get("judge") or {}).get("verdict") != "rejected"
            if had:
                self.assertIsNotNone(fm.model_for(code), code)

    def test_lamar_models_are_served(self):
        try:
            slots = json.loads((ROOT / "tiles" / "utm12n_557_4964" / "client" / "fauna.json").read_text())["slots"]
        except (OSError, ValueError, KeyError):
            self.skipTest("no Lamar tile")
        for s in slots:
            if s.get("model") and s["code"] in self.reg:
                self.assertIsNotNone(fm.model_for(s["code"]), s["code"])


class Fit(unittest.TestCase):
    """The rule against the recorded verdicts (39 at iteration 8; the models rebuilt into the git-ignored cache)."""

    def test_confusion_on_the_recorded_verdicts(self):
        from pipeline import appearance as ap
        known = ap.known_verdicts()
        if not all(k["glb"].exists() for k in known):
            self.skipTest("the judged jobs are not built (pipeline/_cache/verdict_builds)")
        r = fm.fit_acceptance(log=lambda *_: None)
        # every verdict the rule is fitted on is a person's (a judge's, a recorded one, or a drawn model no one rejected),
        # never the rule's own decision on a model it served (a procedural snake: appearance.rule_served)
        reg = json.loads((Path(__file__).resolve().parent.parent / "library" / "animals" / "models.json").read_text())["species"]
        rule_made = {c for c, e in reg.items() if ap.rule_served(e) and not e.get("judge") and not any(v.get("model") == "current" for v in e.get("verdicts") or [])}
        self.assertFalse({k["code"] for k in known if k["model"] == "current"} & rule_made)
        human = sum(1 for c, e in reg.items() if e.get("glb") and c not in rule_made) + sum(1 for e in reg.values() for v in e.get("verdicts") or [] if v.get("model") != "current")
        self.assertEqual(r["models"], human)
        self.assertGreaterEqual(r["models"], 39)                    # iteration 8's 39 at least
        self.assertEqual(r["rule"]["accepted_flagged"], 0)          # no accepted model refused by the rule
        self.assertGreaterEqual(r["rule"]["rejected_flagged"], 8)   # every rejected model but the two grizzly refines
        self.assertLessEqual(r["loo"]["accepted_flagged"], 1)
        self.assertTrue(all(d["code"] == "ursus_arctos" for d in r["disagreements"]))
        y = np.array([p["verdict"] == "rejected" for p in r["per_model"]])
        self.assertEqual(int(y.sum()), r["rejected"])


if __name__ == "__main__":
    unittest.main()
