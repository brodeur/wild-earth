"""The Dig game's shared tunnels (digworld.py, server.py GameWorld's dig channel) and the tree holes' clocks.

    .venv/bin/python -m unittest tests.test_dig

The server runs in a thread with a temporary tiles folder holding only the home tile's manifest, so the game's world
files land there. Two clients join one world's dig channel and see one tunnel; the AI's events come only from the
host; a system no animal enters for a week decays (the clock moved by hand); the world survives a reload from its
snapshot and from its log alone; a stash hole untouched for 30 days takes no deposit.
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

import digworld  # noqa: E402
import server  # noqa: E402
from tests.wsclient import WsClient  # noqa: E402

T1 = "utm10n_680_4280"


class DigTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="digtest-"))
        tiles = cls.tmp / "tiles"
        (tiles / T1).mkdir(parents=True)
        shutil.copy(ROOT / "tiles" / T1 / "manifest.json", tiles / T1 / "manifest.json")
        cls.saved = server.TILES_DIR
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
        cls.redirect.__exit__(None, None, None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def dig(self, season: str) -> WsClient:
        w = WsClient(self.port, "/api/game/ws")
        self.socks.append(w)
        w.send({"t": "dig", "tile": T1, "season": season})
        w.welcome = w.wait("dwelcome")
        return w

    def world(self, season: str) -> server.GameWorld:
        return server.game_world(T1, season)

    def test_two_clients_one_tunnel(self):
        a, b = self.dig("spring"), self.dig("spring")
        self.assertTrue(a.welcome["host"])
        self.assertFalse(b.welcome["host"])
        self.assertEqual(a.wait("dhost")["n"], 2)                # the first is told of the second
        x, y, z = 6960.0, 280.0, -7032.0
        a.send({"t": "dev", "c": 1, "e": {"type": "hole", "id": "a.1", "x": x, "y": y, "z": z, "r": 0.03, "by": "p:secret"}})
        mine = a.wait("dev", where=lambda m: m.get("c") == 1)
        seen = b.wait("dev")
        self.assertEqual(seen["e"], mine["e"])
        self.assertNotIn("by", seen["e"])                       # anonymous: no id travels or is kept
        self.assertNotIn("c", seen)
        a.send({"t": "dev", "c": 2, "e": {"type": "dig", "from": "a.1", "id": "a.2", "seg": "a.3", "x": x, "y": y - 0.02, "z": z - 0.01}})
        b.wait("dev", where=lambda m: m["e"]["type"] == "dig")
        b.send({"t": "dev", "c": 7, "e": {"type": "grow", "id": "a.2", "x": x, "y": y - 0.05, "z": z - 0.03}})   # either player digs on
        a.wait("dev", where=lambda m: m["e"]["type"] == "grow")
        # the same id twice: the second is refused
        b.send({"t": "dev", "c": 8, "e": {"type": "hole", "id": "a.1", "x": x, "y": y, "z": z}})
        self.assertEqual(b.wait("drej")["why"], "taken")
        # the AI's digging only from the host
        b.send({"t": "dev", "c": 9, "e": {"type": "hole", "id": "b.1", "x": x + 3, "y": y, "z": z, "ai": True}})
        self.assertEqual(b.wait("drej")["why"], "not the AI host")
        a.send({"t": "dev", "c": 3, "e": {"type": "hole", "id": "h.1", "x": x + 3, "y": y, "z": z, "ai": True}})
        b.wait("dev", where=lambda m: m["e"].get("id") == "h.1")
        # a late joiner gets the whole system in its welcome
        c = self.dig("spring")
        d = c.welcome["dig"]
        self.assertEqual(sorted(d["nodes"]), ["a.1", "a.2", "h.1"])
        self.assertEqual(d["segs"], {"a.3": ["a.1", "a.2"]})
        self.assertAlmostEqual(d["nodes"]["a.2"]["y"], y - 0.05)
        self.assertEqual(c.welcome["idle"], 7 * 86400)
        # the host leaves: the next oldest is told
        a.close()
        self.assertTrue(b.wait("dhost", where=lambda m: m["host"])["host"])   # (it heard of the third joining first)

    def test_pit_opens_and_decays(self):
        a = self.dig("summer")
        x, y, z = 5000.0, 300.0, -5000.0
        evs = [{"type": "hole", "id": "s.1", "x": x, "y": y - 0.03, "z": z},
               {"type": "dig", "from": "s.1", "id": "s.2", "seg": "s.3", "x": x + 0.3, "y": y - 0.2, "z": z},
               {"type": "dig", "from": "s.2", "id": "s.4", "seg": "s.5", "x": x + 0.6, "y": y - 0.2, "z": z},
               {"type": "pit", "id": "s.6", "x": x + 0.45, "z": z, "y0": y, "r": 0.3, "depth": 0.2, "hx": x + 1, "hz": z},
               {"type": "open", "pit": "s.6", "segs": ["s.5"]}]
        for i, e in enumerate(evs):
            a.send({"t": "dev", "c": i + 1, "e": e})
            a.wait("dev", where=lambda m, i=i: m.get("c") == i + 1)
        w = self.world("summer")
        self.assertEqual(w.s["dig"]["pits"]["s.6"]["o"], ["s.5"])
        self.assertEqual(w.s["dig"]["nodes"]["s.4"]["o"], 1)
        # a step longer than a dig can make is refused
        a.send({"t": "dev", "c": 9, "e": {"type": "dig", "from": "s.4", "id": "s.7", "seg": "s.8", "x": x + 3, "y": y, "z": z}})
        self.assertEqual(a.wait("drej")["why"], "too far")
        # eight days on with no visit: the system and the pit go, and everyone is told
        with w.lock:
            w.prune(time.time() + 8 * 86400)
        m = a.wait("dev", where=lambda m: m["e"]["type"] == "decay")
        self.assertEqual(sorted(m["e"]["nodes"]), ["s.1", "s.2", "s.4"])
        self.assertEqual(m["e"]["pits"], ["s.6"])
        self.assertEqual(w.s["dig"]["nodes"], {})
        # a visit keeps a system: dug now, visited, then six days later it is still there
        a.send({"t": "dev", "c": 20, "e": {"type": "hole", "id": "v.1", "x": x, "y": y, "z": z}})
        a.wait("dev", where=lambda m: m.get("c") == 20)
        a.send({"t": "dev", "c": 21, "e": {"type": "visit", "sys": "v.1"}})
        a.wait("dev", where=lambda m: m.get("c") == 21)
        with w.lock:
            w.prune(time.time() + 6 * 86400)
        self.assertIn("v.1", w.s["dig"]["nodes"])

    def test_survives_a_reload(self):
        a = self.dig("winter")
        x, y, z = 4000.0, 310.0, -4000.0
        evs = [{"type": "hole", "id": "w.1", "x": x, "y": y, "z": z},
               {"type": "dig", "from": "w.1", "id": "w.2", "seg": "w.3", "x": x + 0.1, "y": y - 0.1, "z": z},
               {"type": "widen", "ids": ["w.2"], "r": 0.08}]
        for i, e in enumerate(evs):
            a.send({"t": "dev", "c": i + 1, "e": e})
            a.wait("dev", where=lambda m, i=i: m.get("c") == i + 1)
        a.close()
        w = self.world("winter")
        for _ in range(30):
            if not w.dconns:
                break
            time.sleep(0.1)
        with w.lock:
            w.save()
            want = digworld.persisted(w.s["dig"])
        snap = json.loads(w.snap_path.read_text())
        self.assertEqual(snap["v"], 4)
        self.assertEqual(snap["dig"], want)
        # from the snapshot
        again = server.GameWorld(T1, "winter")
        self.assertEqual(digworld.persisted(again.s["dig"]), want)
        # from the log alone
        w.snap_path.unlink()
        alone = server.GameWorld(T1, "winter")
        got = digworld.persisted(alone.s["dig"])
        self.assertEqual((got["nodes"], got["segs"], got["seq"]), (want["nodes"], want["segs"], want["seq"]))
        self.assertAlmostEqual(got["nodes"]["w.2"]["r"], 0.08)
        server.GAME_WORLDS[(T1, "winter")] = alone

    def test_v3_snapshot_loads(self):
        d = server.TILES_DIR / T1 / "game"
        d.mkdir(parents=True, exist_ok=True)
        (d / "fall.json").write_text(json.dumps({"v": 3, "tile": T1, "season": "fall", "seq": 5, "clock": 12.0, "picked": {"o:1": 3},
                                                 "stashes": {"1,2,3": 2}, "granaries": {}, "caches": [], "board": {}, "collectors": {},
                                                 "round": None, "rounds": 0}))
        w = server.GameWorld(T1, "fall")
        self.assertEqual((w.s["v"], w.s["seq"], w.s["stashes"]), (4, 5, {"1,2,3": 2}))
        self.assertEqual(w.s["dig"]["nodes"], {})
        (d / "fall.json").unlink()

    def test_tree_holes_clock(self):
        w = self.world("spring")
        now = time.time()
        with w.lock:
            w.s["granaries"]["9,9,1"] = 0
            w.s["held"]["9,9,1"] = round(now - 31 * 86400)       # emptied by a raid a month and a day ago
            w.s["stashes"]["9,9,2"] = 4                           # a stash with acorns in it stays
            w.s["held"]["9,9,2"] = round(now - 400 * 86400)
            w.prune(now)
            self.assertIn("9,9,1", w.s["gone"])
            self.assertNotIn("9,9,1", w.s["granaries"])
            self.assertEqual(w.s["stashes"]["9,9,2"], 4)
            self.assertTrue(w.hole_gone("9,9,1", now))
            self.assertFalse(w.hole_gone("9,9,7", now))          # untouched, but the rule is new: from `since`
            self.assertTrue(w.hole_gone("9,9,7", now + 31 * 86400))
            self.assertFalse(w.hole_gone("9,9,2", now + 31 * 86400))


if __name__ == "__main__":
    unittest.main()
