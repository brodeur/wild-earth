"""The Scavenge game's shared carcasses (carrionworld.py, server.py GameWorld's `cev` messages on the dig channel).

    .venv/bin/python -m unittest tests.test_carrion

As tests/test_dig.py: the server in a thread with a temporary tiles folder. Two clients see one carcass born on the
server's clock; a feed draws its meat for both; the AI's events come only from the host; a day takes a deer and a
quarter day a vole (the sweep, the clock moved by hand); the carcass survives a reload from the snapshot and from the
log alone; the decay is the client's arithmetic (summer faster, feeding faster, an emptied store bones).
"""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import carrionworld as cw  # noqa: E402
import server  # noqa: E402
from tests.wsclient import WsClient  # noqa: E402

T1 = "utm10n_680_4280"
DEER = {"type": "carcass", "id": "3:233,97:5", "one": "deer", "sp": "odocoileus_hemionus", "x": 6957.2, "y": 281.4, "z": -7035.1,
        "yaw": 1.2, "size": 1.04, "mass": 57.2, "by": "puma_concolor"}


class CarrionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="carriontest-"))
        tiles = cls.tmp / "tiles"
        (tiles / T1).mkdir(parents=True)
        shutil.copy(ROOT / "tiles" / T1 / "manifest.json", tiles / T1 / "manifest.json")
        cls.saved = server.TILES_DIR
        server.GAME_WORLDS.clear()   # (another test class's worlds point at its own folder)
        server.TILES_DIR = tiles
        cls.out = io.StringIO()
        cls.redirect = contextlib.redirect_stdout(cls.out)
        cls.redirect.__enter__()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(server.Handler, directory=str(ROOT)))
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.socks: list = []

    @classmethod
    def tearDownClass(cls):
        for s in cls.socks:
            s.close()
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.TILES_DIR = cls.saved
        server.GAME_WORLDS.clear()   # (worlds whose files were in this class's folder)
        cls.redirect.__exit__(None, None, None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def join(self, season: str) -> WsClient:
        w = WsClient(self.port, "/api/game/ws")
        self.socks.append(w)
        w.send({"t": "dig", "tile": T1, "season": season})
        w.welcome = w.wait("dwelcome")
        return w

    def world(self, season: str) -> server.GameWorld:
        return server.game_world(T1, season)

    def test_two_clients_one_carcass(self):
        a, b = self.join("spring"), self.join("spring")
        self.assertEqual(a.welcome["carrion"]["list"], {})
        t0 = time.time()
        a.send({"t": "cev", "c": 1, "e": {**DEER, "who": "p:secret"}})
        mine = a.wait("cev", where=lambda m: m.get("c") == 1)
        seen = b.wait("cev")
        self.assertEqual(seen["e"], mine["e"])
        self.assertNotIn("who", seen["e"])                       # only the checked fields travel
        self.assertAlmostEqual(seen["at"], t0, delta=2)           # born on the server's clock
        b.send({"t": "cev", "c": 2, "e": {"type": "feed", "id": DEER["id"], "kg": 1.5, "by": "canis_latrans"}})
        a.wait("cev", where=lambda m: m["e"]["type"] == "feed")
        rec = self.world("spring").s["carrion"]["list"][DEER["id"]]
        self.assertAlmostEqual(rec["meat"], 57.2 - 1.5)
        # the same carcass twice is refused; a feed at none too
        b.send({"t": "cev", "c": 3, "e": DEER})
        self.assertEqual(b.wait("crej")["why"], "taken")
        b.send({"t": "cev", "c": 4, "e": {"type": "feed", "id": "nope", "kg": 1}})
        self.assertEqual(b.wait("crej")["why"], "no such carcass")
        # the AI's only from the host
        b.send({"t": "cev", "c": 5, "e": {**DEER, "id": "3:1,1:1", "ai": True}})
        self.assertEqual(b.wait("crej")["why"], "not the AI host")
        # a late joiner has it in its welcome, with its birth and its meat
        c = self.join("spring")
        got = c.welcome["carrion"]["list"][DEER["id"]]
        self.assertAlmostEqual(got["born"], seen["at"], delta=0.2)
        self.assertAlmostEqual(got["meat"], 57.2 - 1.5)
        self.assertEqual(got["lifeH"], 24)

    def test_a_day_takes_it(self):
        a = self.join("summer")
        vole = {**DEER, "id": "12:5,5:1", "one": "vole", "sp": "microtus_californicus", "mass": 0.05}
        for i, e in enumerate([{**DEER, "id": "3:9,9:9"}, vole]):
            a.send({"t": "cev", "c": i + 1, "e": e})
            a.wait("cev", where=lambda m, i=i: m.get("c") == i + 1)
        w = self.world("summer")
        with w.lock:
            # six summer hours: the vole (6 h, x1.45) is gone whatever the hour of the kill, the deer (at most 0.44) not; five
            # were enough only by day (a vole killed at 9 pm reaches 0.97: the night is cooler than the mean)
            w.prune(time.time() + 6 * 3600)
        m = a.wait("cev", where=lambda m: m["e"]["type"] == "gone")
        self.assertEqual(m["e"]["ids"], ["12:5,5:1"])
        self.assertIn("3:9,9:9", w.s["carrion"]["list"])
        with w.lock:
            w.prune(time.time() + 20 * 3600)                   # 20 summer hours take the deer at any hour of the kill (18 only by day)
        self.assertEqual(a.wait("cev", where=lambda m: m["e"]["type"] == "gone")["e"]["ids"], ["3:9,9:9"])

    def test_the_page_that_runs_the_animals_sends_the_ai_carcasses(self):
        # Y is first on the dig channel, X first on the animals channel; Z, in the acorn game only, leads the hosts but is
        # on neither, so each channel falls back to its first: the dig host is Y, the animals (and the AI's kills) X's
        def ws():
            w = WsClient(self.port, "/api/game/ws")
            self.socks.append(w)
            return w
        y = ws(); y.send({"t": "dig", "tile": T1, "season": "fall", "pg": "b" * 16}); self.assertTrue(y.wait("dwelcome")["host"])
        x = ws(); x.send({"t": "dig", "tile": T1, "season": "fall", "pg": "a" * 16}); x.wait("dwelcome")
        xa = ws(); xa.send({"t": "animals", "tile": T1, "season": "fall", "pg": "a" * 16}); self.assertTrue(xa.wait("awelcome")["host"])
        z = ws()
        z.send({"t": "hello", "v": 1, "tile": T1, "season": "fall", "species": "corvus_corax", "pg": "c" * 16})
        r = z.wait("epoch")["r"]
        z.send({"t": "hello", "v": 1, "tile": T1, "season": "fall", "species": "corvus_corax", "pg": "c" * 16, "r": r, "sid": "cd" * 16})
        z.wait("welcome")
        w = self.world("fall")
        with w.lock:
            self.assertEqual(w.host_of(w.dconns).pg, "b" * 16)
            self.assertEqual(w.host_of(w.aconns).pg, "a" * 16)
        kill = {**DEER, "id": "3:5,5:5", "by": "canis_latrans", "ai": True}
        y.send({"t": "cev", "c": 1, "e": kill})                 # the dig host does not run the animals: refused
        self.assertEqual(y.wait("crej")["why"], "not the AI host")
        x.send({"t": "cev", "c": 2, "e": kill})                 # the animals' page: born once
        x.wait("cev", where=lambda m: m.get("c") == 2)
        x.send({"t": "cev", "c": 3, "e": {"type": "feed", "id": "3:5,5:5", "kg": 0.25, "by": "canis_latrans", "ai": True}})
        x.wait("cev", where=lambda m: m.get("c") == 3)
        self.assertAlmostEqual(w.s["carrion"]["list"]["3:5,5:5"]["eaten"], 0.25)

    def test_decay(self):
        rec = {"born": 0.0, "mass": 50.0, "meat": 50.0, "eaten": 0.0, "lifeH": 24}
        self.assertAlmostEqual(cw.decay_of(rec, 86400, "fall"), 1.0, places=6)          # a day, whatever the hour of the kill
        self.assertAlmostEqual(cw.decay_of({**rec, "born": 5000.0}, 5000 + 86400, "spring"), 1.0, places=6)
        self.assertLess(cw.decay_of(rec, 12 * 3600, "winter"), cw.decay_of(rec, 12 * 3600, "summer"))
        fed = {**rec, "meat": 25.0, "eaten": 25.0}
        self.assertAlmostEqual(cw.decay_of(fed, 0, "fall") - cw.decay_of(rec, 0, "fall"), cw.EAT_K * 0.5)
        self.assertGreaterEqual(cw.decay_of({**rec, "meat": 0.0, "eaten": 50.0}, 60, "fall"), cw.BONES_D)

    def test_survives_a_reload(self):
        a = self.join("winter")
        a.send({"t": "cev", "c": 1, "e": {**DEER, "id": "3:7,7:7"}})
        born = a.wait("cev", where=lambda m: m.get("c") == 1)["at"]
        a.send({"t": "cev", "c": 2, "e": {"type": "feed", "id": "3:7,7:7", "kg": 4, "by": "ursus_americanus"}})
        a.wait("cev", where=lambda m: m.get("c") == 2)
        a.close()
        w = self.world("winter")
        for _ in range(30):
            if not w.dconns:
                break
            time.sleep(0.1)
        with w.lock:
            w.save()
            want = json.loads(json.dumps(w.s["carrion"]))
        snap = json.loads(w.snap_path.read_text())
        self.assertEqual(snap["carrion"], want)
        again = server.GameWorld(T1, "winter")                 # from the snapshot
        self.assertEqual(again.s["carrion"], want)
        w.snap_path.unlink()
        alone = server.GameWorld(T1, "winter")                 # from the log alone
        rec = alone.s["carrion"]["list"]["3:7,7:7"]
        self.assertAlmostEqual(rec["born"], born, delta=0.11)
        self.assertAlmostEqual(rec["meat"], DEER["mass"] - 4)
        self.assertEqual(alone.s["carrion"]["seq"], want["seq"])
        server.GAME_WORLDS[(T1, "winter")] = alone


if __name__ == "__main__":
    unittest.main()
