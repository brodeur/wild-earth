"""Games always on: the acorn game's round is the season (server.py season_label, GameWorld.season_round).

    .venv/bin/python -m unittest tests.test_season_round

The server runs in a thread with a temporary tiles folder holding only the home tile's manifest. The label follows the
meteorological calendar (the south six months on); the first join begins the season's round, with no length, and the
player's id is derived for it; the tick never ends it; the same season a year on ends it (with its winner) and begins
the next, so every player's id rotates per season.
"""
from __future__ import annotations

import calendar
import contextlib
import io
import shutil
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402
from tests.wsclient import WsClient  # noqa: E402

T1 = "utm10n_680_4280"


def at(y: int, m: int, d: int = 15) -> float:
    return float(calendar.timegm((y, m, d, 12, 0, 0)))


class SeasonRoundTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="seasontest-"))
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

    def test_label(self):
        L = server.season_label
        self.assertEqual(L(T1, "fall", at(2026, 11)), "2026-fall")
        self.assertEqual(L(T1, "fall", at(2026, 8)), "2025-fall")          # before September: last year's fall
        self.assertEqual(L(T1, "winter", at(2027, 1)), "2026-winter")      # December to February: the December's year
        self.assertEqual(L(T1, "winter", at(2026, 12)), "2026-winter")
        self.assertEqual(L(T1, "spring", at(2026, 11)), "2026-spring")
        self.assertEqual(L("utm56s_300_6250", "fall", at(2026, 4)), "2026-fall")    # the south: fall from March
        self.assertEqual(L("utm56s_300_6250", "fall", at(2026, 2)), "2025-fall")
        self.assertEqual(L("utm56s_300_6250", "winter", at(2026, 7)), "2026-winter")

    def test_the_round_is_the_season(self):
        c = WsClient(self.port, "/api/game/ws")
        self.socks.append(c)
        c.send({"t": "hello", "v": 1, "tile": T1, "season": "spring", "species": "corvus_corax"})
        r = c.wait("epoch")["r"]
        self.assertEqual(r, 1)                                              # the first join began the season's round
        c.send({"t": "hello", "v": 1, "tile": T1, "season": "spring", "species": "corvus_corax", "r": r, "sid": "ab" * 16})
        wl = c.wait("welcome")
        rd = wl["world"]["round"]
        self.assertEqual((rd["id"], rd["length"], rd["over"], rd["cal"]), (1, 0, False, server.season_label(T1, "spring")))
        w = server.GAME_WORLDS[(T1, "spring")]
        w.tick(10_000.0)                                                    # a long while: no length, no end
        self.assertFalse(w.s["round"]["over"])
        c.none("round", wait=0.3)
        # the same season a year on: the round ends and the next begins, so the player is asked for a new id
        w.season_round(now=at(int(rd["cal"][:4]) + 1, 4))
        ended = c.wait("round", where=lambda m: m["round"]["id"] == 1)
        self.assertTrue(ended["round"]["over"])
        nxt = c.wait("round", where=lambda m: m["round"]["id"] == 2)
        self.assertEqual(nxt["round"]["length"], 0)
        self.assertNotEqual(nxt["round"]["cal"], rd["cal"])
        c.send({"t": "id", "r": 2, "sid": "cd" * 16})
        you = c.wait("you")
        self.assertNotEqual(you["you"], wl["you"])                          # the id rotated with the season
        # an old client's Start is ignored while the season's round runs
        c.send({"t": "start", "length": 60})
        c.none("round", wait=0.4)
        c.close()


if __name__ == "__main__":
    unittest.main()
