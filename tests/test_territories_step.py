"""The territories step (pipeline/fetch_territories.py, pipeline/steps.py, 2026-11-06): without a Native Land key it is
refused, not done, and the build audit and --status say so; it is its own step after terrain, with a version and the
fetcher's code in its fingerprint."""
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest import mock

from pipeline import fetch_territories, runlog, steps
from pipeline.config import Tile


class TestTerritoriesStep(unittest.TestCase):
    def test_in_the_graph_after_terrain(self):
        st = steps.STEPS["territories"]
        self.assertEqual(st.stage, "base")
        self.assertIn("terrain", st.after)
        self.assertIn("fetch_territories", st.modules)
        self.assertEqual(st.layers, ["client.territories"])
        self.assertGreater(steps.ORDER.index("territories"), steps.ORDER.index("terrain"))
        self.assertNotIn("fetch_territories", steps.STEPS["terrain"].modules)   # one owner of the territories
        self.assertIn("territories", steps.STEPS["audit"].after)

    def test_refused_without_a_key(self):
        tile = Tile.from_id("utm10n_429_5293")
        with mock.patch.object(fetch_territories, "api_key", return_value=""):
            with self.assertRaises(runlog.Refused) as cm:
                fetch_territories.step_output(tile)
        self.assertIn("NATIVE_LAND_KEY", str(cm.exception))

    def test_a_refusal_is_a_problem_for_the_audit(self):
        m = {"steps": {"territories": {"status": "refused", "reason": fetch_territories.NO_KEY}}, "status": {}}
        probs = steps.refusals(m)
        self.assertTrue(any(p.startswith("territories refused: no NATIVE_LAND_KEY") for p in probs), probs)

    def test_the_key_is_read_but_never_printed(self):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {"NATIVE_LAND_KEY": "sekrit-test-value"}), redirect_stdout(buf):
            self.assertEqual(fetch_territories.api_key(), "sekrit-test-value")
        self.assertNotIn("sekrit", buf.getvalue())
        self.assertTrue(all(p.endswith(".env") for p in fetch_territories.env_files()))


if __name__ == "__main__":
    unittest.main()
