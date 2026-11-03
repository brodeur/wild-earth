"""The shared animals' channel (server.py GameWorld.animals_*; docs/multiplayer.md "Shared animals").

    .venv/bin/python -m unittest tests.test_animals

The server runs in a thread with a temporary tiles folder holding only the home tile's manifest. Two clients join one
world's animals channel: the first is the host; its state is relayed to the other and to no one else, its events are
numbered in order, a mirror's request and position reach the host alone, the host's leaving names the next host, the
acorn game's AI host leads the animal host when the same page is on both channels (pg), and nothing of the animals
reaches the world's files or the log.
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

import server  # noqa: E402
from tests.wsclient import WsClient  # noqa: E402

T1 = "utm10n_680_4280"
ROW = [7, 4095, 4321.12, 287.5, -1234.75, 2.375, 0, 0, 1.5]   # a distinctive state row, searched for at the end


class AnimalsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="animalstest-"))
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

    def ws(self) -> WsClient:
        c = WsClient(self.port, "/api/game/ws")
        self.assertEqual(c.status, 101)
        self.socks.append(c)
        return c

    def animals(self, pg: str | None = None, season: str = "fall") -> tuple[WsClient, dict]:
        c = self.ws()
        m = {"t": "animals", "tile": T1, "season": season}
        if pg:
            m["pg"] = pg
        c.send(m)
        return c, c.wait("awelcome")

    def test_relay_events_requests_and_handover(self):
        a, wa = self.animals(season="spring")
        self.assertTrue(wa["host"])
        self.assertEqual(wa["n"], 1)
        b, wb = self.animals(season="spring")
        self.assertFalse(wb["host"])
        self.assertEqual(wb["n"], 2)
        ha = a.wait("ahost")                       # the host is told someone joined, and to send everything
        self.assertTrue(ha["host"] and ha.get("full"))
        self.assertEqual(sorted(ha["m"]), sorted([wa["you"], wb["you"]]))
        # state from the host reaches the mirror as it is, and not the host
        a.send({"t": "ast", "s": [[7, "3:12,45:0", 3, 1, 0, 0, 0, 0.5, 0.5, 0.5, -1, 0]], "u": [ROW], "d": [], "g": [], "at": 12.5})
        st = b.wait("ast")
        self.assertEqual(st["u"], [ROW])
        self.assertEqual(st["s"][0][1], "3:12,45:0")
        a.none("ast")
        # state from a mirror is dropped
        b.send({"t": "ast", "u": [[1, 1, 0]]})
        a.none("ast")
        # events from the host are numbered in order, to everyone (the host's copy echoes c)
        a.send({"t": "aev", "c": 1, "e": {"k": "kill", "n": 7, "by": "p:2"}})
        a.send({"t": "aev", "c": 2, "e": {"k": "gone", "n": 7}})
        e1, e2 = b.wait("aev"), b.wait("aev")
        self.assertEqual((e1["aseq"], e2["aseq"]), (1, 2))
        self.assertEqual(e1["e"]["k"], "kill")
        self.assertNotIn("c", e1)
        ea = a.wait("aev")
        self.assertEqual((ea["aseq"], ea["c"]), (1, 1))
        b.send({"t": "aev", "e": {"k": "kill", "n": 7}})   # not from the host: dropped
        a.none("aev", where=lambda m: m["aseq"] > 2)
        # a mirror's request and position reach the host alone, with the mirror's number
        b.send({"t": "areq", "e": {"k": "catch", "n": 7, "x": 1, "y": 2, "z": 3, "sp": "puma_concolor"}})
        rq = a.wait("areq")
        self.assertEqual((rq["from"], rq["e"]["k"]), (wb["you"], "catch"))
        b.send({"t": "apos", "x": 4320.0, "z": -1230.0, "sp": "odocoileus_hemionus"})
        ps = a.wait("apos")
        self.assertEqual((ps["from"], ps["x"], ps["z"], ps["sp"]), (wb["you"], 4320.0, -1230.0, "odocoileus_hemionus"))
        b.send({"t": "apos", "x": "far", "z": 0})          # malformed: dropped
        a.none("apos")
        # the host leaves: the other is named host, with the events' count where it stood
        a.close()
        hb = b.wait("ahost", where=lambda m: m["host"])
        self.assertEqual((hb["n"], hb["aseq"]), (1, 2))
        b.close()

    def test_acorn_host_leads_the_animal_host(self):
        # page X is on the animals channel first; page Y starts the acorn game first: Y is the AI host on both channels
        x, wx = self.animals(pg="aaaaaaaaaaaaaaaa", season="summer")
        self.assertTrue(wx["host"])
        y, wy = self.animals(pg="bbbbbbbbbbbbbbbb", season="summer")
        self.assertFalse(wy["host"])
        x.wait("ahost")
        g = self.ws()
        g.send({"t": "hello", "v": 1, "tile": T1, "season": "summer", "species": "corvus_corax", "pg": "bbbbbbbbbbbbbbbb"})
        r = g.wait("epoch")["r"]                         # (joining begins the season's round: server.py season_round)
        g.send({"t": "hello", "v": 1, "tile": T1, "season": "summer", "species": "corvus_corax", "pg": "bbbbbbbbbbbbbbbb", "r": r, "sid": "ab" * 16})
        self.assertTrue(g.wait("welcome")["host"])
        self.assertTrue(y.wait("ahost", where=lambda m: m["host"])["host"])
        self.assertFalse(x.wait("ahost", where=lambda m: not m["host"])["host"])
        # the acorn game stops on Y: the animal host is the first on the channel again
        g.close()
        self.assertTrue(x.wait("ahost", where=lambda m: m["host"])["host"])
        y.wait("ahost", where=lambda m: not m["host"])
        # the dig channel's host follows the same page
        d = self.ws()
        d.send({"t": "dig", "tile": T1, "season": "summer", "pg": "bbbbbbbbbbbbbbbb"})
        self.assertTrue(d.wait("dwelcome")["host"])      # X's page leads (first on the animals channel) but has no dig connection yet: the first on the dig channel is host
        d2 = self.ws()
        d2.send({"t": "dig", "tile": T1, "season": "summer", "pg": "aaaaaaaaaaaaaaaa"})
        self.assertTrue(d2.wait("dwelcome")["host"])
        self.assertFalse(d.wait("dhost")["host"])
        for c in (x, y, d, d2):
            c.close()

    def test_zz_nothing_written(self):
        time.sleep(0.5)
        text = self.out.getvalue()
        for needle in ("4321.12", "1234.75", "2.375", "3:12,45:0", "puma_concolor", "odocoileus"):
            self.assertNotIn(needle, text, needle)
        for p in (self.tmp / "tiles" / T1).rglob("*"):
            if p.is_file() and p.name != "manifest.json":
                body = p.read_text(errors="replace")
                for needle in ("4321.12", "1234.75", "3:12,45:0", "aseq", "ast"):
                    self.assertNotIn(needle, body, f"{needle} in {p}")


if __name__ == "__main__":
    unittest.main()
