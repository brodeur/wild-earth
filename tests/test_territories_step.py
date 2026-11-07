"""The territories step (pipeline/fetch_territories.py, pipeline/steps.py, 2026-11-06): without a Native Land key it is
refused, not done, and the build audit and --status say so; it is its own step, with a version and the fetcher's code in
its fingerprint, and needs no other step (it reads only the tile's bounds)."""
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest import mock

from pipeline import fetch_territories, runlog, steps
from pipeline.config import Tile


class TestTerritoriesStep(unittest.TestCase):
    def test_in_the_graph(self):
        st = steps.STEPS["territories"]
        self.assertEqual(st.stage, "base")
        self.assertEqual(st.after, [])   # it reads only the tile's bounds: a tile built before the graph is not blocked
        self.assertIn("fetch_territories", st.modules)
        self.assertEqual(st.layers, ["client.territories"])
        self.assertNotIn("fetch_territories", steps.STEPS["terrain"].modules)   # one owner of the territories
        self.assertIn("territories", steps.STEPS["audit"].after)

    def test_refused_without_a_key(self):
        tile = Tile.from_id("utm10n_429_5293")
        with mock.patch.object(fetch_territories, "api_key", return_value=""):
            with self.assertRaises(runlog.Refused) as cm:
                fetch_territories.step_output(tile)
        self.assertIn("NATIVE_LAND_KEY or NATIVE_LAND_API_KEY", str(cm.exception))

    def test_a_refusal_is_a_problem_for_the_audit(self):
        m = {"steps": {"territories": {"status": "refused", "reason": fetch_territories.NO_KEY}}, "status": {}}
        probs = steps.refusals(m)
        self.assertTrue(any(p.startswith("territories refused: no Native Land key") for p in probs), probs)

    def test_the_key_is_read_but_never_printed(self):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {"NATIVE_LAND_KEY": "sekrit-test-value"}), redirect_stdout(buf):
            self.assertEqual(fetch_territories.api_key(), "sekrit-test-value")
        self.assertNotIn("sekrit", buf.getvalue())
        self.assertTrue(all(p.endswith(".env") for p in fetch_territories.env_files()))

    def test_either_key_name_the_first_first(self):
        clean = {k: v for k, v in os.environ.items() if k not in fetch_territories.KEY_NAMES}
        with mock.patch.dict(os.environ, {**clean, "NATIVE_LAND_API_KEY": "second-name"}, clear=True), \
                mock.patch.object(fetch_territories, "env_files", return_value=[]):
            self.assertEqual(fetch_territories.api_key(), "second-name")
        with mock.patch.dict(os.environ, {**clean, "NATIVE_LAND_KEY": "first", "NATIVE_LAND_API_KEY": "second"}, clear=True):
            self.assertEqual(fetch_territories.api_key(), "first")
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            env = os.path.join(d, ".env")
            with open(env, "w") as f:
                f.write("OTHER=1\nNATIVE_LAND_API_KEY='from-file'\n")
            with mock.patch.dict(os.environ, clean, clear=True), mock.patch.object(fetch_territories, "env_files", return_value=[env]):
                self.assertEqual(fetch_territories.api_key(), "from-file")


    def test_a_broken_polygon_is_left_out_and_said(self):
        import json, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            cache = Path(d) / "_cache" / "native_land.json"; cache.parent.mkdir()
            feats = [{"name": "Nisenan", "slug": "nisenan", "url": "u"},
                     {"name": "Cayuse, Umatilla and Walla Walla", "slug": "cayuse-umatilla-and-walla-walla", "url": "u"}]
            cache.write_text(json.dumps({"retrieved": "2026-11-06", "points": [{"lat": 0, "lon": 0, "features": feats}]}))
            tile = mock.Mock(bounds_wgs84=(-120.8, 38.6, -120.7, 38.7), path=lambda rel: Path(d) / rel)
            with mock.patch.object(fetch_territories, "api_key", return_value="k"):
                ts, note = fetch_territories.territories(tile)
        self.assertEqual([t["slug"] for t in ts], ["nisenan"])
        self.assertEqual([x["slug"] for x in note["excluded"]], ["cayuse-umatilla-and-walla-walla"])
        self.assertIn("polygon", note["excluded"][0]["why"])


if __name__ == "__main__":
    unittest.main()
