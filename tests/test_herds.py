"""The herd aggregation rule (pipeline/herds.py): fewer, larger herds on the open, low, watered ground."""
import unittest

import numpy as np

from pipeline import herds


def grids(n=100, res=30.0):
    """A synthetic tile: a grassy valley floor along the middle rows, forested, steeper slopes either side."""
    yy, xx = np.mgrid[0:n, 0:n]
    valley = np.abs(yy - n / 2) < 12
    hab = np.where(valley, 5, 2).astype("int32")
    tree = np.where(valley, 0.0, 70.0)
    grass = np.zeros((n, n, 4))
    grass[...] = np.where(valley, 90.0, 10.0)[..., None]
    water = np.zeros((n, n, 4))
    water[...] = np.clip(100 - np.abs(yy - n / 2) * 6, 0, 100)[..., None]
    slope = np.clip(np.abs(yy - n / 2) - 10, 0, 40).astype("float64")
    low = np.clip(1 - np.abs(yy - n / 2) / (n / 2), 0, 1)
    h = 2000 + np.abs(yy - n / 2) * 20.0 + xx * 0.5            # an east-west valley, falling gently west
    return {"habitat": hab, "tree": tree, "grass": grass, "browse": np.zeros((n, n, 4)), "water": water,
            "slope": slope, "low": low, "h": h, "res": res, "n": n}


def plan(g, **kw):
    args = dict(tile_id="t", code="bison_bison", season="summer", density=6.0, g0=30.0, d0=0.28, mass_kg=580.0,
                client_n=30, steep=False, res=g["res"], size_m=g["n"] * g["res"])
    args.update(kw)
    return herds.plan_species(g, **args)


class TestHerdSizes(unittest.TestCase):
    def test_sum_and_order(self):
        s = herds.herd_sizes(589, 250.0, np.random.default_rng(1))
        self.assertEqual(sum(s), 589)
        self.assertEqual(s, sorted(s, reverse=True))
        self.assertLessEqual(s[0], herds.HERD_MAX)

    def test_seeded(self):
        self.assertEqual(herds.herd_sizes(300, 40, herds._rng("a", "b", "summer")),
                         herds.herd_sizes(300, 40, herds._rng("a", "b", "summer")))


class TestPlan(unittest.TestCase):
    def test_dense_grazer_gathers_on_the_valley_floor(self):
        g = grids()
        p = plan(g)
        self.assertTrue(p["emitted"])
        self.assertGreater(p["G"], 100)                       # 30 x sqrt(density on the range / 0.28)
        self.assertEqual(p["placed"], p["N"])
        n = g["n"]
        for h in p["herds"]:
            j = int((n * g["res"] - h["n"]) / g["res"])
            self.assertLess(abs(j - n / 2), 12, h)               # every herd on the grassy floor
        big = p["herds"][0]
        for h in p["herds"][1:]:                                # herds kept apart
            self.assertGreater(np.hypot(h["x"] - big["x"], h["n"] - big["n"]), big["r"] + h["r"])

    def test_sparse_or_small_groups_left_to_the_cells(self):
        g = grids()
        p = plan(g, code="odocoileus_hemionus", density=16, g0=2.25, d0=16, mass_kg=75, client_n=6)
        self.assertFalse(p["emitted"])                         # PanTHERIA group under 3: no herds
        p = plan(g, density=0.28, client_n=400)
        self.assertFalse(p["emitted"])                         # the typical herd within the client's own group

    def test_steep_species_on_the_slopes(self):
        g = grids()
        p = plan(g, code="ovis_canadensis", density=1.5, g0=22, d0=1.48, mass_kg=75, client_n=10, steep=True)
        self.assertTrue(p["emitted"])
        n = g["n"]
        for h in p["herds"]:
            j = int((n * g["res"] - h["n"]) / g["res"])
            self.assertGreater(g["slope"][j, int(h["x"] / g["res"])], 15, h)

    def test_radius_grows_with_count_and_body(self):
        self.assertGreater(herds.herd_radius_m(400, 580), herds.herd_radius_m(100, 580))
        self.assertGreater(herds.herd_radius_m(100, 580), herds.herd_radius_m(100, 75))



class TestModelTint(unittest.TestCase):
    """A recorded coat colour (library/animals/tints.json) becomes a per-channel tint over the model's own body colour."""

    def test_bison_darkened_toward_its_summer_coat(self):
        from pathlib import Path
        from pipeline.appearance import model_tint
        glb = Path(__file__).resolve().parent.parent / "client" / "assets" / "fauna" / "bison_bison.glb"
        if not glb.exists():
            self.skipTest("bison model not present")
        t = model_tint("bison_bison", glb)
        self.assertIsNotNone(t)
        self.assertTrue(all(0 < v < 1 for v in t["tint"]))        # darker in every channel
        self.assertLess(t["tint"][0], t["tint"][2])                 # the red pulled down most: reddish tan to dark brown

    def test_no_record_no_tint(self):
        from pathlib import Path
        from pipeline.appearance import model_tint
        self.assertIsNone(model_tint("no_such_animal", Path("nowhere.glb")))


class TestFlocks(unittest.TestCase):
    """The flocking birds under the same rule (pipeline/herds.py flocks; library/herds/flocks.json)."""

    def test_groups_match_genus_then_family(self):
        import json
        from pathlib import Path
        groups = json.loads((Path(herds.LIB) / "flocks.json").read_text())["groups"]
        self.assertEqual(herds.flock_group(groups, "Branta", "Anatidae")[0], "geese")
        self.assertEqual(herds.flock_group(groups, "Anas", "Anatidae")[0], "ducks")
        self.assertEqual(herds.flock_group(groups, "Fulica", "Rallidae")[0], "coots")
        self.assertEqual(herds.flock_group(groups, "Grus", "Gruidae")[0], "cranes")
        self.assertIsNone(herds.flock_group(groups, "Buteo", "Accipitridae")[0])

    def test_season_shares(self):
        winter = [100, 80, 20, 10, 5, 2, 2, 3, 5, 10, 30, 90]       # a winter visitor
        sh = herds.season_shares(winter)
        self.assertGreater(sh["winter"], 2)
        self.assertLess(sh["summer"], 0.2)
        self.assertEqual(herds.season_shares([1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]), {s: 1.0 for s in herds.SEASONS})

    def test_valley_axis_and_skein_headings(self):
        g = grids()                                             # the valley runs east-west along the middle rows
        e, n = herds.valley_axis(g)
        self.assertGreater(abs(e), 0.9)
        cfg = {"base_per_hour": 6.0, "agl_m": [180, 450], "speed_mps": [14, 18]}
        sk = herds.skein_plan((e, n), {"spring": 1.5, "fall": 0.8}, 3, [8, 60], cfg)
        import math
        north = lambda deg: math.cos(math.radians(deg))
        self.assertGreater(north(sk["spring"]["heading_deg"]), 0.3)    # north in spring, half pulled to true north
        self.assertLess(north(sk["fall"]["heading_deg"]), -0.3)        # south in fall
        self.assertGreater(sk["spring"]["per_hour"], sk["fall"]["per_hour"])
        self.assertEqual(herds.skein_plan((e, n), {}, 1, [8, 60], cfg), {})   # a sedentary bird: none

    def test_water_guild_only_on_water(self):
        g = grids()
        g["habitat"][45:47, :] = 7                               # a river along the valley
        S = herds.suitability(g, "winter", "water")
        self.assertTrue((S[45:47] > 0).all())
        self.assertEqual(float(S[:40].sum()), 0.0)
        G = herds.suitability(g, "winter", "grazer")
        self.assertEqual(float(G[45:47].sum()), 0.0)             # a grazing flock off the open water


if __name__ == "__main__":
    unittest.main()
