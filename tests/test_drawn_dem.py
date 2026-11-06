"""The drawn DEM from the 1 m ground, and a refused step that never reads `ok` (2026-11-06, Lamar's reroute).

    arch -arm64 .venv/bin/python -m unittest tests.test_drawn_dem

fetch_dem.draw_from_1m on synthetic grids: where every 1 m cell of a 5 m cell is the product's, the drawn cell is their
mean exactly; in the gap the fetched 5 m, shifted onto the 1 m ground at the seam and untouched beyond BLEND_M; no step
where they meet. The runner (in a subprocess with its own tiles folder): a step raising runlog.Refused is recorded
`refused` with its reason, its dependents still run, the build reports it (`_refused`, the exit code's input), --status
shows it as a problem, and the audit step fails on it; a refusal recorded the old way (status.reroute "refused: ..." with
the step `ok`) is caught too.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import fetch_dem as FD  # noqa: E402


class TestDrawnDem(unittest.TestCase):
    def test_block_mean_where_covered_and_a_blended_gap(self):
        n5, f = 200, 5
        n1 = n5 * f
        yy, xx = np.mgrid[0:n1, 0:n1].astype("float64")
        z1 = (1000 + 0.05 * xx + 3 * np.sin(yy / 37.0)).astype("float32")      # the 1 m ground
        src = np.ones((n1, n1), np.uint8)
        src[:, :300] = 0                                                       # no product west of x = 300 m
        z1[src == 0] = FD.NODATA
        y5, x5 = np.mgrid[0:n5, 0:n5].astype("float64")
        z5 = (1000 + 0.05 * (x5 * f + 2) + 4.0).astype("float64")              # the fetched DEM: 4 m high, no wiggle
        out, st = FD.draw_from_1m(z5, z1, src, 5.0)
        full = src.reshape(n5, f, n5, f).all(axis=(1, 3))
        mean1 = z1.astype("float64").reshape(n5, f, n5, f).mean(axis=(1, 3))
        np.testing.assert_allclose(out[full], mean1[full], atol=1e-3)
        # far into the gap (beyond BLEND_M of the seam): the fetched DEM untouched
        far = int(FD.BLEND_M / 5.0) + 2
        np.testing.assert_allclose(out[:, :60 - far], z5[:, :60 - far], atol=1e-3)
        # at the seam: the gap's last cell against the 1 m side's first differs by the ground's own slope (0.25 m over a
        # cell) and the smoothed wiggle, not by the fetched DEM's 4 m offset
        step = np.abs(out[:, 59] - out[:, 60]).max()
        raw = np.abs(z5[:, 59] - mean1[:, 60]).max()
        self.assertGreater(raw, 3.5)
        self.assertLess(step, 0.25 + 0.5, step)
        self.assertAlmostEqual(st["share_1m_cells"], float(full.mean()), places=3)

    def test_threshold_is_recorded(self):
        self.assertGreaterEqual(FD.DRAWN_1M_MIN_SHARE, 0.9)
        self.assertLessEqual(FD.DRAWN_1M_MIN_SHARE, 1.0)


RUNNER = r'''
import json, sys
from unittest import mock
from pipeline import steps, runlog, config
from pipeline.config import Tile
from pipeline.manifest import add_layer, load_manifest, save
tile = Tile.from_id("utm12n_557_4964")
tile.dir.mkdir(parents=True, exist_ok=True)

def a(t, m, force):
    p = t.path("a.json"); p.write_text("{}"); add_layer(m, t, "x.a", {"path": "a.json", "kind": "table"}, fetched=False)
def b(t, m, force):
    raise runlog.Refused("terrain/dem.tif is not the 1 m ground averaged (test)")
def c(t, m, force):
    p = t.path("c.json"); p.write_text("{}"); add_layer(m, t, "x.c", {"path": "c.json", "kind": "table"}, fetched=False)

S = {n: steps.Step(n, "1", [], after, fn, [f"x.{n}"], stage="base") for n, after, fn in
     (("a", [], a), ("b", ["a"], b), ("c", ["b"], c))}
out = {}
with mock.patch.object(steps, "STEPS", S), mock.patch.object(steps, "ORDER", list(S)):
    m = steps.build(tile)
    out["refused"] = m.get("_refused")
    out["failed"] = m.get("_failed")
    m = load_manifest(tile)
    out["b"] = {k: m["steps"]["b"].get(k) for k in ("status", "reason", "out_hash")}
    out["c"] = m["steps"]["c"].get("status")
    out["log_b_ok"] = [l for l in m["log"] if l["step"] == "b"][-1]["ok"]
    out["refusals"] = steps.refusals(m)
    out["current_b"] = steps.current(tile, S["b"], m, steps.Hashes(tile))[0]
    # a second build re-runs the refused step (never current) and leaves c alone (b's out_hash unchanged)
    m2 = steps.build(tile)
    out["second_refused"] = m2.get("_refused")
    out["c_ran_again"] = m2["steps"]["c"]["ran_at"] != m["steps"]["c"]["ran_at"]
# --status, on the real graph: a refused step shows as a problem; and the old record (ok, status.reroute refused)
m = load_manifest(tile)
m["steps"]["reroute"] = {"status": "refused", "reason": "test reason"}
save(tile, m)
out["status_reroute"] = {r["step"]: r["problem"] for r in steps.status(tile)}.get("reroute")
m["steps"]["reroute"] = {"status": "ok", "outputs": {}}
m["status"]["reroute"] = "refused: old style"
save(tile, m)
out["status_reroute_old"] = {r["step"]: r["problem"] for r in steps.status(tile)}.get("reroute")
out["refusals_old"] = steps.refusals(m)
# the audit step fails on a refusal
import pipeline.audit_licenses as AL
with mock.patch.object(AL, "audit_attribution", lambda m, s: ([], [])), \
     mock.patch.object(AL, "audit", lambda tid: {"records": 0, "non_commercial_fraction": 0.0}):
    try:
        steps._audit(tile, m, False)
        out["audit"] = "passed"
    except RuntimeError as e:
        out["audit"] = str(e)
print("JSON" + json.dumps(out))
'''


class TestRefusedStep(unittest.TestCase):
    def test_refused_is_recorded_reported_and_fails_the_audit(self):
        with tempfile.TemporaryDirectory() as d:
            env = {**os.environ, "WILD_EARTH_TILES": d}
            r = subprocess.run([sys.executable, "-c", RUNNER], cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=300)
            line = [l for l in r.stdout.splitlines() if l.startswith("JSON")]
            self.assertTrue(line, r.stdout[-2000:] + r.stderr[-3000:])
            out = json.loads(line[-1][4:])
        self.assertEqual(out["refused"], ["b"])
        self.assertEqual(out["failed"], [])
        self.assertEqual(out["b"]["status"], "refused")
        self.assertIn("1 m ground", out["b"]["reason"])
        self.assertTrue(out["b"]["out_hash"])
        self.assertEqual(out["c"], "ok")                 # the dependents still run
        self.assertFalse(out["log_b_ok"])
        self.assertTrue(any(x.startswith("b refused") for x in out["refusals"]), out["refusals"])
        self.assertFalse(out["current_b"])                # never current: every build tries it again
        self.assertEqual(out["second_refused"], ["b"])
        self.assertFalse(out["c_ran_again"])
        self.assertTrue(out["status_reroute"].startswith("refused"), out["status_reroute"])
        self.assertTrue(out["status_reroute_old"].startswith("refused"), out["status_reroute_old"])
        self.assertTrue(any("status.reroute" in x for x in out["refusals_old"]), out["refusals_old"])
        self.assertIn("build audit", out["audit"])


if __name__ == "__main__":
    unittest.main()
