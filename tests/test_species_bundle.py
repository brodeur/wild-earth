"""The species library in one gzipped response (server.py /api/species-library, 2026-11-06)."""
from __future__ import annotations

import contextlib
import gzip
import io
import json
import sys
import threading
import unittest
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


class SpeciesBundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(server.Handler, directory=str(server.REPO_ROOT)))
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.httpd.server_address[1]}/api/species-library"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, headers):
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                with urllib.request.urlopen(urllib.request.Request(self.url, headers=headers)) as r:
                    return r.status, dict(r.headers), r.read()
            except urllib.error.HTTPError as e:
                return e.code, dict(e.headers), b""

    def test_every_listed_species_once_gzipped(self):
        status, h, body = self.get({"Accept-Encoding": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(h.get("Content-Encoding"), "gzip")
        data = json.loads(gzip.decompress(body))
        listed = json.loads((ROOT / "library" / "species" / "index.json").read_text())["species"]
        self.assertEqual(set(data), set(listed))
        for i in listed[:5]:
            self.assertEqual(data[i], json.loads((ROOT / "library" / "species" / f"{i}.json").read_text()))

    def test_plain_and_not_modified(self):
        status, h, body = self.get({})
        self.assertEqual(status, 200)
        self.assertIsNone(h.get("Content-Encoding"))
        self.assertTrue(json.loads(body))
        status, _, _ = self.get({"If-None-Match": h["ETag"]})
        self.assertEqual(status, 304)


if __name__ == "__main__":
    unittest.main()
