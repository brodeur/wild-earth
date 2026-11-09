"""Join as the friend is (client/src/joinSpawn.js; docs/multiplayer.md "Join as the friend is"): where a joiner comes in
from the friend's relayed state: 5 body lengths behind on their trail, their heading and speed, carried on to now, sliding
off a spot that cannot hold the body. Runs joinSpawn.js under node with stub species tables and a stub spot test; skipped
without node."""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOIN = ROOT / "client" / "src" / "joinSpawn.js"
NET = ROOT / "client" / "src" / "animalNet.js"

SCRIPT = """
import { planJoin, bodyLength, pushTrail, BEHIND_LENGTHS } from %(join)s;
import { F, NF, FL_AIR } from %(net)s;
const tables = { ground: { odocoileus_hemionus: { half: 0.6, wade: 0.7 }, lontra_canadensis: { half: 0.3, wade: 3 } },
  fliers: { buteo_jamaicensis: { span: 1.25, flight: { soar: { v: 9, r: 45 } } } } };
const kind = c => tables.ground[c] ? 'ground' : tables.fliers[c] ? 'flier' : null;
const b = (spd, air, amp = 0) => { const a = new Array(NF).fill(0); a[F.spd] = spd; a[F.fl] = air ? FL_AIR : 0; a[F.amp] = amp; return a; };
const open = () => (where, x, y, z) => ({ y: where === 'air' ? y : 0, wet: false });
const now = 100000, out = {};
const hawk = { x: 0, y: 100, z: 0, yaw: 0, form: 'buteo_jamaicensis', b: b(11, true), c: [1], at: now };
out.len = { hawk: bodyLength('buteo_jamaicensis', 1, tables), deer: bodyLength('odocoileus_hemionus', 1.2, tables), spirit: bodyLength('spirit') };
out.straight = planJoin({ lead: hawk, now, kind, test: open(), tables });
out.ahead = planJoin({ lead: { ...hawk, at: now - 1000 }, now, kind, test: open(), tables });
// a trail coming from the east (x falling to 0) then heading north: behind is along the trail, to the east
const trail = []; for (let i = 0; i <= 20; i++) pushTrail(trail, { x: 20 - i, y: 100, z: 0, yaw: Math.PI / 2 }, now - 2000 + i * 100);
out.trail = planJoin({ lead: { ...hawk, yaw: 0 }, trail, now, kind, test: open(), tables });
// a trunk across the line behind (z between 2 and 3.5 m): slides along it
const trunk = () => (where, x, y, z) => (z > 2 && z < 3.5 ? null : { y, wet: false });
out.slid = planJoin({ lead: hawk, now, kind, test: trunk(), tables });
// the whole line behind blocked (|x| < 0.5): the nearest good spot round the 5-length point
out.ring = planJoin({ lead: hawk, now, kind, test: (w, x, y, z) => (Math.abs(x) < 0.5 ? null : { y, wet: false }), tables });
out.none = planJoin({ lead: hawk, now, kind, test: () => null, tables });
// the spirit: its own speed (v), ten metres behind
out.spirit = planJoin({ lead: { x: 0, y: 50, z: 0, yaw: Math.PI / 2, form: 'spirit', v: 12, at: now }, now, kind, test: open(), tables });
// a walker on the ground at 3 m/s; a swimmer in the water needs water behind it
out.deer = planJoin({ lead: { x: 0, y: 5, z: 0, yaw: 0, form: 'odocoileus_hemionus', b: b(3, false), c: [1], at: now }, now, kind, test: open(), tables });
const seen = [];
out.otter = planJoin({ lead: { x: 0, y: 0, z: 0, yaw: 0, form: 'lontra_canadensis', b: b(1, false), c: [1], at: now }, now, kind,
  test: (w, x, y, z, o) => { seen.push({ swimmer: o.swimmer, water: o.water, probe: !!o.probe }); return o.probe ? { y: 0, wet: true } : (z < 2.5 ? { y: -1, wet: true } : null); }, tables });
out.otterSeen = seen.slice(0, 2);
// a hawk circling (its yaw turning 0.2 rad/s): soars on round the same way
const circ = []; for (let i = 0; i <= 10; i++) pushTrail(circ, { x: Math.sin(i * 0.02) * 45, y: 100, z: -Math.cos(i * 0.02) * 45, yaw: i * 0.02 }, now - 1000 + i * 100);
out.soar = planJoin({ lead: { ...hawk, yaw: 0.2, b: b(9, true, 0.1) }, trail: circ, now, kind, test: open(), tables });
out.flap = planJoin({ lead: { ...hawk, b: b(11, true, 0.8) }, now, kind, test: open(), tables });
out.behind = BEHIND_LENGTHS;
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class JoinSpawnTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = SCRIPT % {"join": json.dumps(JOIN.as_uri()), "net": json.dumps(NET.as_uri())}
        r = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, cwd=ROOT, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.o = json.loads(r.stdout)

    def test_body_lengths(self):
        L = self.o["len"]
        self.assertAlmostEqual(L["hawk"], 0.5625)          # 0.45 of a 1.25 m span
        self.assertAlmostEqual(L["deer"], 1.44)            # twice its half length, at size 1.2
        self.assertEqual(L["spirit"], 2)

    def test_straight_behind_at_their_speed_and_heading(self):
        p, L = self.o["straight"], self.o["len"]["hawk"]
        self.assertEqual((p["code"], p["where"], p["speed"], p["yaw"], p["slid"]), ("buteo_jamaicensis", "air", 11, 0, False))
        self.assertAlmostEqual(p["x"], 0)
        self.assertAlmostEqual(p["z"], 5 * L)              # heading 0 is forward -z: behind is +z
        self.assertAlmostEqual(p["y"], 100)

    def test_state_carried_on_to_now(self):
        p, L = self.o["ahead"], self.o["len"]["hawk"]
        self.assertAlmostEqual(p["head"]["z"], -11)        # a second old at 11 m/s
        self.assertAlmostEqual(p["z"], -11 + 5 * L)

    def test_behind_along_the_trail(self):
        p, L = self.o["trail"], self.o["len"]["hawk"]
        self.assertAlmostEqual(p["x"], 5 * L, places=3)    # back along the way they came, east, not straight south
        self.assertAlmostEqual(p["z"], 0, places=3)

    def test_slides_off_a_trunk(self):
        p, L = self.o["slid"], self.o["len"]["hawk"]
        self.assertTrue(p["slid"])
        self.assertAlmostEqual(p["d"], 3.5 * L)            # 5, 4.5, 5.5, 4 and 6 lengths are in it; 3.5 is clear
        self.assertFalse(2 < p["z"] < 3.5)

    def test_nearest_good_spot_round_it(self):
        p = self.o["ring"]
        self.assertGreaterEqual(abs(p["x"]), 0.5)
        self.assertLess(abs(p["x"]), 1.01)                 # the first ring (1 m)

    def test_no_spot_is_null(self):
        self.assertIsNone(self.o["none"])

    def test_spirit_ten_metres_behind_at_its_speed(self):
        p = self.o["spirit"]
        self.assertEqual((p["code"], p["where"], p["speed"]), ("spirit", "air", 12))
        self.assertAlmostEqual(p["x"], 10, places=6)       # heading +pi/2 is forward -x: behind is +x
        self.assertAlmostEqual(p["y"], 50)

    def test_walker_on_the_ground(self):
        p = self.o["deer"]
        self.assertEqual((p["code"], p["where"], p["speed"]), ("odocoileus_hemionus", "ground", 3))
        self.assertAlmostEqual(p["z"], 5 * 1.2)

    def test_swimmer_wants_water(self):
        p = self.o["otter"]
        self.assertEqual(self.o["otterSeen"][0], {"swimmer": True, "probe": True})   # the probe at them: are they in water?
        self.assertEqual(self.o["otterSeen"][1], {"swimmer": True, "water": True, "probe": False})
        self.assertEqual(p["y"], -1)                       # on the bed of the water behind it
        self.assertAlmostEqual(p["d"], 4 * 0.6)            # the water ends 2.5 m back: 4 lengths, not 5

    def test_soar_and_flap(self):
        self.assertTrue(self.o["soar"]["soaring"])
        self.assertEqual(self.o["soar"]["soarDir"], 1)
        self.assertFalse(self.o["straight"]["soaring"])
        self.assertTrue(self.o["flap"]["flapping"])


if __name__ == "__main__":
    unittest.main()
