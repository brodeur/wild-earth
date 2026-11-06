"""pipeline/stills.py's plan: which still each fauna slot's chip gets (no rendering here)."""
import unittest

from pipeline import stills

INDEX = {"species": {
    "sciurus_griseus": {"file": "sciurus_griseus.webp", "width": 120, "height": 80, "px_per_m": 268, "kind": "ground",
                        "foot_px": 75, "pose": "standing"},
    "panthera_leo": {"file": "panthera_leo.webp", "px_per_m": 229, "fauna": True,
                     "source": {"model": "fauna/panthera_leo.glb", "sha": "x", "v": stills.RENDER_VERSION}},
}, "stand_ins": {}}


class Plan(unittest.TestCase):
    def test_stand_in_takes_its_kins_still_at_its_scale(self):
        p = stills.plan([{"code": "alouatta_seniculus", "kin": "sciurus_griseus", "scale": 2.0, "tint": None}], INDEX)
        self.assertEqual(p["renders"], [])
        e = p["stand_ins"]["alouatta_seniculus"]
        self.assertEqual(e["file"], "sciurus_griseus.webp")
        self.assertAlmostEqual(e["px_per_m"], 134.0)
        self.assertEqual(p["chips"]["alouatta_seniculus"]["how"], "stand_in")

    def test_tinted_stand_in_is_rendered(self):
        p = stills.plan([{"code": "x_y", "kin": "sciurus_griseus", "scale": 1, "tint": [1.2, 0.8, 0.6]}], INDEX)
        self.assertEqual([it["code"] for it in p["renders"]], ["x_y"])
        self.assertEqual(p["renders"][0]["tint"], [1.2, 0.8, 0.6])

    def test_model_slot_rendered_when_its_glb_changed(self):
        slot = {"code": "panthera_leo", "kin": "puma_concolor", "model": {"path": "fauna/panthera_leo.glb", "kind": "quadruped", "skin": True}}
        p = stills.plan([slot], INDEX)
        if (stills.ASSETS / "fauna" / "panthera_leo.glb").is_file():   # the recorded sha 'x' is not the file's: render again
            self.assertEqual([it["code"] for it in p["renders"]], ["panthera_leo"])
            self.assertEqual(p["renders"][0]["model"]["path"], "fauna/panthera_leo.glb")
        else:
            self.assertEqual(p["chips"]["panthera_leo"]["how"], "missing")

    def test_static_species_and_unknown_kin(self):
        p = stills.plan([{"code": "sciurus_griseus", "kin": "sciurus_griseus"}, {"code": "a_b", "kin": "no_such"}], INDEX)
        self.assertEqual(p["chips"]["sciurus_griseus"]["how"], "static")
        self.assertEqual(p["chips"]["a_b"]["how"], "missing")
        self.assertEqual(p["renders"], [])


if __name__ == "__main__":
    unittest.main()
