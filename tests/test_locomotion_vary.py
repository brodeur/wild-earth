"""The variation block (library/animals/locomotion.json `vary`; docs/movement.md "Strides that vary"): the client's
default (client/src/gait.js VARY) is the tree's Mammalia block, and a row carries only what its taxon says differently."""
import json
import re
import unittest
from pathlib import Path

from pipeline import locomotion

ROOT = Path(__file__).resolve().parent.parent


def client_vary() -> dict:
    src = (ROOT / "client" / "src" / "gait.js").read_text()
    body = src[src.index("export const VARY = {") + len("export const VARY = "):]
    body = body[:body.index("};") + 1]
    return json.loads(re.sub(r",\s*}", "}", re.sub(r"(\w+):", r'"\1":', body)))


class VaryTest(unittest.TestCase):
    def test_client_default_is_the_tree(self):
        tree = locomotion.load_tree()
        self.assertEqual(client_vary(), locomotion._no_notes(tree["taxa"]["Mammalia"]["vary"]))

    def test_rows_carry_only_differences(self):
        elk, coyote, raven = (locomotion.resolve(c) for c in ("cervus_canadensis", "canis_latrans", "corvus_corax"))
        self.assertEqual(elk["vary"], {"soft": {"nod": 0.07}})   # the hoofed walkers' nod (Artiodactyla)
        self.assertNotIn("vary", coyote)
        self.assertNotIn("vary", raven)

    def test_every_number_has_a_note(self):
        tree = locomotion.load_tree()
        v = tree["taxa"]["Mammalia"]["vary"]
        for k in v:
            if k != "note":
                self.assertIn(k.split("_")[0], v["note"], k)


if __name__ == "__main__":
    unittest.main()
