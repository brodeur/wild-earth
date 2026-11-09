"""Static files are an allow-list (server.py static_allowed; docs/architecture-review-2026-11-03.md, section 0):
the hub's data, the played game worlds, dotfiles and the code are never served.

    .venv/bin/python -m unittest tests.test_static
"""
from __future__ import annotations

import http.client
import sys
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server  # noqa: E402

TILE = "utm10n_680_4280"


class StaticAllowList(unittest.TestCase):
    def test_rule(self):
        ok = server.static_allowed
        for p in ("/client/", "/client/index.html", "/client/src/main.js", "/viewer/index.html",
                  "/library/species/blue_oak.json", "/tiles/index.json", f"/tiles/{TILE}/manifest.json",
                  f"/tiles/{TILE}/client/imagery.png", f"/tiles/{TILE}/species/species.json"):
            self.assertTrue(ok(p), p)
        for p in ("/", "/data/", "/data/hub.sqlite", "/.env", "/server.py", "/hub.py", "/Dockerfile",
                  "/pipeline/config.py", "/tiles/", f"/tiles/{TILE}", f"/tiles/{TILE}/game/autumn.json",
                  f"/tiles/{TILE}/_cache/x", "/tiles/../data/hub.sqlite", "/client/../data/hub.sqlite",
                  "/client/%2e%2e/data/hub.sqlite", "/client/.git/config", "/.git/HEAD", "/scratch/x.html",
                  f"/tiles/{TILE}/unreal/x", "/tiles/nope/manifest.json", "/client\\..\\data\\hub.sqlite"):
            self.assertFalse(ok(p), p)
        self.assertTrue(ok("/scratch/x.html", dev=True))
        self.assertFalse(ok("/.env", dev=True))
        self.assertFalse(ok("/data/hub.sqlite", dev=True))


class StaticOverHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(server.Handler, directory=str(ROOT)))
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def status(self, method, path):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path)
        r = c.getresponse()
        r.read()
        c.close()
        return r.status, r.getheader("Location")

    def test_served(self):
        for m in ("GET", "HEAD"):
            self.assertEqual(self.status(m, "/client/index.html")[0], 200)
            self.assertEqual(self.status(m, "/client/")[0], 200)

    def test_refused(self):
        for m in ("GET", "HEAD"):
            for p in ("/data/", "/data/hub.sqlite", "/.env", "/server.py", "/tests/", "/client/src/",
                      "/client/%2e%2e/server.py", "/scratch/"):
                self.assertEqual(self.status(m, p)[0], 404, f"{m} {p}")

    def test_revalidated(self):
        # the page, its modules and its stylesheets are revalidated on every load: a stylesheet cached by the browser's
        # heuristic paired an old title.css with a new title.js after a deploy (2026-11-08)
        for p in ("/client/", "/client/index.html", "/client/src/title.js", "/client/title.css?v=x", "/client/social.css"):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("GET", p)
            r = c.getresponse()
            r.read()
            c.close()
            self.assertEqual(r.status, 200, p)
            self.assertEqual(r.getheader("Cache-Control"), "no-cache", p)

    def test_root_redirects(self):
        self.assertEqual(self.status("GET", "/"), (302, "/client/"))


if __name__ == "__main__":
    unittest.main()
