"""The host's animal stream stays under the server's message limit (client/src/animalNet.js MSG_MAX; ws.py WS_MAX_IN).

2026-11-08: a join's full resend (spawns, every herd row, a 4,000-cell field delta) reached 77 KB; the server closed the
host's socket, the host moved and the joiner, a fresh mirror, saw no animals. tests/animal_net_wire.mjs drives
AnimalNet.tick() against a fake socket on a heavy world and a pathological herd list.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

import ws

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which("node"), "node not installed")
class TestAnimalWire(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(ROOT / "tests" / "animal_net_wire.mjs")], capture_output=True, text=True,
                             timeout=60, check=True).stdout
        cls.r = json.loads(out.strip().splitlines()[-1])

    def test_limit_matches_the_server(self):
        self.assertEqual(self.r["limit"], ws.WS_MAX_IN)

    def test_heavy_join_under_the_limit_and_complete(self):
        h = self.r["heavy"]
        self.assertLess(h["max"], ws.WS_MAX_IN)
        self.assertEqual(h["oversize"], 0)
        self.assertEqual(h["spawned"], 1500)       # every animal told
        self.assertEqual(h["herdRows"], 60)
        self.assertEqual(h["cells"], 20000)        # the whole field backlog, over several ticks

    def test_oversized_message_split_not_dropped(self):
        m = self.r["manyHerds"]
        self.assertLess(m["max"], ws.WS_MAX_IN)
        self.assertGreater(m["split"], 0)
        self.assertEqual(m["herdRows"], 3000)
        self.assertEqual(m["spawned"], 50)


if __name__ == "__main__":
    unittest.main()
