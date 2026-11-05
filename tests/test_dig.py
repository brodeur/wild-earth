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

    def test_room(self):
        """A chamber: one node in place of a loop's nodes; their outside segments end at it, inner ones go."""
        d, now = digworld.empty(), time.time()
        x, y, z = 3000.0, 200.0, -3000.0
        ev = [{"type": "hole", "id": "r.h", "x": x, "y": y, "z": z, "r": 0.03},
              {"type": "dig", "from": "r.h", "id": "r.1", "seg": "r.s1", "x": x, "y": y - 0.2, "z": z - 0.2},
              {"type": "dig", "from": "r.1", "id": "r.2", "seg": "r.s2", "x": x + 0.07, "y": y - 0.2, "z": z - 0.27},
              {"type": "dig", "from": "r.2", "id": "r.3", "seg": "r.s3", "x": x, "y": y - 0.2, "z": z - 0.34},
              {"type": "dig", "from": "r.3", "id": "r.4", "seg": "r.s4", "x": x - 0.07, "y": y - 0.2, "z": z - 0.27},
              {"type": "join", "a": "r.4", "b": "r.1", "seg": "r.s5"},
              {"type": "dig", "from": "r.3", "id": "r.5", "seg": "r.s6", "x": x, "y": y - 0.2, "z": z - 0.6}]
        for e in ev:
            self.assertIsNone(digworld.dig_reduce(d, digworld.clean(e), now), e)
        e = digworld.clean({"type": "room", "id": "r.R", "x": x, "y": y - 0.2, "z": z - 0.27, "r": 0.1, "absorb": ["r.1", "r.2", "r.3", "r.4"]})
        self.assertIsNone(digworld.dig_reduce(d, e, now))
        self.assertEqual(sorted(d["nodes"]), ["r.5", "r.R", "r.h"])
        self.assertEqual(d["segs"], {"r.s1": ["r.R", "r.h"], "r.s6": ["r.R", "r.5"]})
        self.assertEqual(d["nodes"]["r.R"]["k"], 1)
        self.assertEqual(digworld.dig_reduce(d, digworld.clean({"type": "grow", "id": "r.R", "x": x, "y": y, "z": z}), now), "not a face")
        self.assertEqual(digworld.dig_reduce(d, digworld.clean({"type": "room", "id": "r.Q", "x": x, "y": y, "z": z, "r": 0.1, "absorb": ["r.h"]}), now), "no such node")

    def test_meet_and_big(self):
        """Two diggers' tunnels meeting (dig.js digCore 'meet'): a join between their faces makes one system, its clock
        the later of the two; and a structure past the old 1,500-node cap is taken (the carving has no per-slot buffers)."""
        d, now = digworld.empty(), time.time()
        x, y, z = 3000.0, 200.0, -3000.0
        ev = [{"type": "hole", "id": "a.h", "x": x, "y": y, "z": z, "r": 0.03},
              {"type": "dig", "from": "a.h", "id": "a.1", "seg": "a.s1", "x": x + 0.3, "y": y - 0.1, "z": z},
              {"type": "hole", "id": "b.h", "x": x + 0.9, "y": y, "z": z, "r": 0.03},
              {"type": "dig", "from": "b.h", "id": "b.1", "seg": "b.s1", "x": x + 0.42, "y": y - 0.1, "z": z}]
        for e in ev:
            self.assertIsNone(digworld.dig_reduce(d, digworld.clean(e), now), e)
        d["seen"]["b.h"] = now + 5
        self.assertIsNone(digworld.dig_reduce(d, digworld.clean({"type": "join", "a": "b.1", "b": "a.1", "seg": "b.s2"}), now))
        self.assertEqual({n["sys"] for n in d["nodes"].values()}, {"b.h"})
        self.assertEqual(d["seen"]["b.h"], round(now))   # the merged system's clock
        self.assertNotIn("a.h", d["seen"])
        # a long tunnel of 2,000 nodes in 2 cm steps
        prev = "a.1"
        for i in range(2000):
            e = {"type": "dig", "from": prev, "id": f"c.{i}", "seg": f"c.s{i}", "x": x + 0.3, "y": y - 0.1 - 0.02 * (i % 10), "z": z - 0.02 * i}
            self.assertIsNone(digworld.dig_reduce(d, digworld.clean(e), now), i)
            prev = f"c.{i}"
        self.assertGreater(len(d["nodes"]), 1500)
        self.assertEqual(digworld.N_MAX, 5000)

    def test_pull(self):
        """A plant pulled down from below (dig.js rootStep, digRoots.js): the `pull` event by the plant's deterministic id
        reaches a second player, is in a late joiner's welcome and the snapshot, only ever loses what is left of it (eaten),
        keeps no player's id, refuses a bad species id, and is the season's own (another season's world has none)."""
        a, b = self.dig("fall"), self.dig("fall")
        x, y, z = 6961.0, 280.0, -7033.0
        a.send({"t": "dev", "c": 1, "e": {"type": "pull", "id": "f:232.233.41", "x": x, "y": y, "z": z, "sp": "chlorogalum_pomeridianum", "left": 1, "by": "p:secret"}})
        mine = a.wait("dev", where=lambda m: m.get("c") == 1)
        seen = b.wait("dev", where=lambda m: m["e"]["type"] == "pull")
        self.assertEqual(seen["e"], mine["e"])
        self.assertNotIn("by", seen["e"])
        # eaten: what is left only falls
        b.send({"t": "dev", "c": 2, "e": {"type": "pull", "id": "f:232.233.41", "x": x, "y": y, "z": z, "sp": "chlorogalum_pomeridianum", "left": 0.4}})
        a.wait("dev", where=lambda m: m["e"]["type"] == "pull" and m["e"]["left"] == 0.4)
        b.send({"t": "dev", "c": 3, "e": {"type": "pull", "id": "f:232.233.41", "x": x, "y": y, "z": z, "sp": "chlorogalum_pomeridianum", "left": 0.9}})
        self.assertEqual(b.wait("drej")["why"], "no change")
        b.send({"t": "dev", "c": 4, "e": {"type": "pull", "id": "f:1.2.3", "x": x, "y": y, "z": z, "sp": "Not A Species!"}})
        self.assertEqual(b.wait("drej")["why"], "malformed event")
        # a bulb eaten out from below: pulled with nothing left
        a.send({"t": "dev", "c": 5, "e": {"type": "pull", "id": "f:232.234.7", "x": x + 0.3, "y": y, "z": z, "sp": "dipterostemon_capitatus", "left": 0}})
        b.wait("dev", where=lambda m: m["e"].get("id") == "f:232.234.7")
        c = self.dig("fall")
        self.assertEqual(c.welcome["dig"]["pulls"], {"f:232.233.41": {"x": x, "y": y, "z": z, "sp": "chlorogalum_pomeridianum", "l": 0.4},
                                                     "f:232.234.7": {"x": x + 0.3, "y": y, "z": z, "sp": "dipterostemon_capitatus", "l": 0}})
        self.assertEqual(self.dig("winter").welcome["dig"].get("pulls", {}), {})   # per season
        # the reducer on an old snapshot's dig (no pulls yet)
        d = digworld.empty(); del d["pulls"]
        self.assertIsNone(digworld.dig_reduce(d, digworld.clean({"type": "pull", "id": "f:9.9.9", "x": x, "y": y, "z": z, "sp": "stipa_pulchra"}), time.time()))
        self.assertEqual(d["pulls"]["f:9.9.9"]["l"], 1)

    def test_rabbits(self):
        """A brush rabbit's burrow (6.5 cm tubes, a nest room at its end) and a jackrabbit's form (a pit of kind 'form')
        reach a second player as they are dug and are in a late joiner's welcome; a form decays as a pit does."""
        a, b = self.dig("spring"), self.dig("spring")
        x, y, z = 6100.0, 290.0, -6100.0
        evs = [{"type": "hole", "id": "rb.1", "x": x, "y": y - 0.065, "z": z, "r": 0.065},
               {"type": "dig", "from": "rb.1", "id": "rb.2", "seg": "rb.3", "x": x, "y": y - 0.15, "z": z - 0.15, "r": 0.065},
               {"type": "dig", "from": "rb.2", "id": "rb.4", "seg": "rb.5", "x": x, "y": y - 0.25, "z": z - 0.45, "r": 0.065},
               {"type": "room", "id": "rb.6", "x": x, "y": y - 0.25, "z": z - 0.45, "r": 0.11, "absorb": ["rb.4"], "ai": True},
               {"type": "pit", "id": "jk.1", "k": "form", "x": x + 4, "z": z, "y0": y, "r": 0.08, "depth": 0.01, "hx": x + 4.4, "hz": z},
               {"type": "pit", "id": "jk.1", "k": "form", "x": x + 4, "z": z, "y0": y, "r": 0.15, "depth": 0.07, "hx": x + 4.4, "hz": z}]
        for i, e in enumerate(evs):
            a.send({"t": "dev", "c": i + 1, "e": e})
            a.wait("dev", where=lambda m, i=i: m.get("c") == i + 1)
            seen = b.wait("dev")
            self.assertEqual(seen["e"]["type"], e["type"])
        self.assertEqual(seen["e"]["k"], "form")
        c = self.dig("spring")
        d = c.welcome["dig"]
        self.assertEqual(sorted(d["nodes"]), ["rb.1", "rb.2", "rb.6"])
        self.assertAlmostEqual(d["nodes"]["rb.2"]["r"], 0.065)
        self.assertEqual((d["nodes"]["rb.6"]["k"], d["nodes"]["rb.6"]["r"]), (1, 0.11))
        self.assertEqual(d["segs"]["rb.5"], ["rb.6", "rb.2"])
        f = d["pits"]["jk.1"]
        self.assertEqual((f["k"], f["r"], f["d"]), ("form", 0.15, 0.07))
        # an unknown kind is dropped (only a form is kept)
        self.assertNotIn("k", digworld.clean({"type": "pit", "id": "p.1", "k": "lair", "x": x, "z": z, "y0": y, "r": 0.1, "depth": 0.1, "hx": x, "hz": z}))
        w = self.world("spring")
        with w.lock:
            w.prune(time.time() + 8 * 86400)
        a.wait("dev", where=lambda m: m["e"]["type"] == "decay" and "jk.1" in m["e"].get("pits", []))
        self.assertEqual((w.s["dig"]["pits"], w.s["dig"]["nodes"]), ({}, {}))
        for s in (a, b, c):   # the spring world as the other tests find it: empty, no one on its channel
            s.close()
        for _ in range(30):
            if not w.dconns:
                break
            time.sleep(0.1)

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
