"""The idle block (library/animals/locomotion.json `idle`; client/src/idle.js): the client's default (idle.js IDLE) is
the tree's Mammalia block, and a row carries only what its taxon says differently."""
import json
import re
import unittest
from pathlib import Path

from pipeline import locomotion

ROOT = Path(__file__).resolve().parent.parent


def client_idle() -> dict:
    src = (ROOT / "client" / "src" / "idle.js").read_text()
    body = src[src.index("export const IDLE = {") + len("export const IDLE = "):]
    body = body[:body.index("};") + 1]
    return json.loads(re.sub(r",\s*}", "}", re.sub(r"(\w+):", r'"\1":', body)))


class IdleTest(unittest.TestCase):
    def test_client_default_is_the_tree(self):
        tree = locomotion.load_tree()
        self.assertEqual(client_idle(), locomotion._no_notes(tree["taxa"]["Mammalia"]["idle"]))

    def test_rows_carry_only_differences(self):
        elk, coyote, lion, bear, hare, raven = (locomotion.resolve(c) for c in (
            "cervus_canadensis", "canis_latrans", "puma_concolor", "ursus_americanus", "lepus_americanus", "corvus_corax"))
        self.assertEqual(elk["idle"]["tail"]["style"], "switch")
        self.assertEqual(elk["idle"]["ruminate"]["chew_hz"], 1.0)
        self.assertIn("groom", elk["idle"]["acts"])
        self.assertNotIn("breath", elk["idle"])          # the class's breath is the default
        self.assertEqual(coyote["idle"]["tail"], {"style": "low", "droop": 0.35})
        self.assertEqual(coyote["idle"]["acts"]["sniff"], {"up": 0.35})   # only the share up differs
        self.assertTrue(lion["idle"]["acts"]["groom"]["sit"])
        self.assertNotIn("tail", bear["idle"])           # a bear's tail is the class's: still
        self.assertIn("sit", bear["idle"]["acts"])       # Carnivora's sit
        self.assertEqual(hare["idle"]["acts"]["sniff"], {"per_h": 0})
        self.assertNotIn("idle", raven)                  # a bird has no Mammalia block

    def test_every_number_has_a_note(self):
        tree = locomotion.load_tree()
        v = tree["taxa"]["Mammalia"]["idle"]
        for k in v:
            if k != "note":
                self.assertIn(k, v["note"], k)
        for name in v["acts"]:
            self.assertIn(name, v["note"], name)
        for tax, b in tree["taxa"].items():
            if "idle" in b and tax != "Mammalia":
                self.assertTrue(b["idle"].get("note") or b.get("note"), tax)

    def test_gate_and_ears(self):
        elk, coyote, lion, bear = (locomotion.resolve(c) for c in ("cervus_canadensis", "canis_latrans", "puma_concolor", "ursus_americanus"))
        self.assertEqual(lion["idle"]["acts"]["groom"]["needs"], {"neck_joints": 2})   # the owl's head turn is gated off
        self.assertEqual(elk["idle"]["acts"]["groom"]["needs"], {"neck_joints": 2})
        self.assertEqual(coyote["idle"]["acts"]["scratch"]["needs"], {"reach_neck": 0.12})
        self.assertEqual(coyote["idle"]["ears"], {"swivel": 0.85, "hold_s": [1.8, 0.6]})
        self.assertEqual(elk["idle"]["ears"]["flick"], {"per_min": 6})               # the hoofed flick more (Artiodactyla)
        self.assertEqual(bear["idle"]["ears"]["swivel"], 0.15)

    def test_shake_exponent_is_dickerson(self):
        self.assertEqual(locomotion.load_tree()["taxa"]["Mammalia"]["idle"]["acts"]["shake"]["hz_exp"], -0.22)


if __name__ == "__main__":
    unittest.main()
