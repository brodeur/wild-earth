"""The shrubs a community's name and description leave out (pipeline/associates.py, species_mix.named_rule, 2026-11-10).

Until then a community drew only the species its LANDFIRE name names and its description lists: the Grand Canyon's
pinyon-juniper woodland had no shrubs, its bedrock canyon (38 % of the tile) nothing, and the prickly pear, hedgehog
cactus and yucca its vegetation plots record were in no row. The shrubs recorded on a community's own cells now join
it, ranked after the listed species and never weighing more than them; a cactus or a yucca without a growth form in
the client is reported missing, never drawn as a leafy relative. The records are given here by associates.EVIDENCE,
the USDA PLANTS profiles by associates.PROFILE and the GBIF counts by communities.RECORDS (no network)."""
import sys
import types
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import communities as C  # noqa: E402
from pipeline import scorecard  # noqa: E402
from pipeline import species_mix as sm  # noqa: E402
from pipeline import succession as S  # noqa: E402

try:
    from pipeline import associates as A
except ImportError:   # the code before this rule: the tests below then fail on what named_rule draws
    A = None

TILE = types.SimpleNamespace(tile_id="test_outside_every_table")
CANYON = "Colorado Plateau Mixed Bedrock Canyon and Tableland"
BLACKBRUSH = "Colorado Plateau Blackbrush-Mormon-tea Shrubland"
PONDEROSA = "Southern Rocky Mountain Ponderosa Pine Woodland"
GRASSLAND = "Inter-Mountain Basins Semi-Desert Grassland"
PHYS = {CANYON: "Sparsely Vegetated", BLACKBRUSH: "Shrubland", PONDEROSA: "Conifer", GRASSLAND: "Grassland", "Open Water": "Open Water"}


def profile(sci, habits, native=True, family="Rosaceae"):
    return {"ScientificName": f"<i>{sci}</i> Auth.", "GrowthHabits": habits, "Ancestors": [{"Rank": "Family", "ScientificName": family}],
            "NativeStatuses": [{"Region": "L48", "Status": "N" if native else "I"}]}


PROFILES = {
    "Purshia stansburiana": profile("Purshia stansburiana", ["Shrub", "Tree"]),            # a library shrub
    "Fallugia paradoxa": profile("Fallugia paradoxa", ["Shrub"]),
    "Chamaebatiaria millefolium": profile("Chamaebatiaria millefolium", ["Shrub"]),
    "Shepherdia rotundifolia": profile("Shepherdia rotundifolia", ["Shrub"], family="Elaeagnaceae"),
    "Opuntia polyacantha": profile("Opuntia polyacantha", ["Shrub"], family="Cactaceae"),
    "Tamarix chinensis": profile("Tamarix chinensis", ["Shrub", "Tree"], native=False, family="Tamaricaceae"),
    "Laphamia congesta": profile("Laphamia congesta", ["Subshrub"], family="Asteraceae"),
    "Eriogonum umbellatum": profile("Eriogonum umbellatum", ["Forb/herb", "Shrub", "Subshrub"], family="Polygonaceae"),
    "Phoradendron juniperinum": profile("Phoradendron juniperinum", ["Shrub", "Subshrub"], family="Viscaceae"),
    "Juniperus osteosperma": profile("Juniperus osteosperma", ["Shrub", "Tree"], family="Cupressaceae"),
    "Penstemon palmeri": profile("Penstemon palmeri", ["Forb/herb", "Subshrub"], family="Plantaginaceae"),
    "Gutierrezia sarothrae": profile("Gutierrezia sarothrae", ["Forb/herb", "Shrub", "Subshrub"], family="Asteraceae"),   # a library forb
}


def evidence(species: dict, effort: dict) -> dict:
    """{scientific: {community: records}} and {community: all plant records} as associates.join would return them."""
    return {"total": sum(effort.values()), "effort": dict(effort), "phys": PHYS,
            "species": {sci: {"family": (PROFILES.get(sci) or {}).get("Ancestors", [{}])[0].get("ScientificName"),
                              "records": sum(by.values()), "by": dict(by)} for sci, by in species.items()}}


class Place(unittest.TestCase):
    """A tile outside every regional table: `records` its GBIF counts near the tile, `species` and `effort` the open
    records on its communities, `models` its communities' own descriptions {(source, code): (classes, type)}."""
    records: dict = {}
    species: dict = {}
    effort: dict = {}
    models: dict = {}

    def setUp(self):
        self._saved = (C.RECORDS, dict(sm.CONTEXT), S._plants, dict(C._FAMILY))
        sm.RESOLUTION.clear(); sm.SUBSTITUTIONS.clear()
        C.RECORDS = lambda tile, sid: self.records.get(sid, 0)
        sm.CONTEXT.update(regions=[], tile=TILE, coast=False)
        S._plants = lambda name: None
        S._IDS.clear()
        S._DOCS[TILE.tile_id] = {key: f"model_{i}" for i, key in enumerate(self.models)}
        for i, (classes, vtype) in enumerate(self.models.values()):
            S._LAYERS[(TILE.tile_id, f"model_{i}")] = (classes, vtype)
        if A is not None:
            self._a = (A.EVIDENCE, A.PROFILE)
            A.EVIDENCE = lambda tile: evidence(self.species, self.effort)
            A.PROFILE = lambda sci: PROFILES.get(sci)
            A._SHRUB.clear()

    def tearDown(self):
        C.RECORDS, ctx, S._plants, fam = self._saved
        C._FAMILY.clear(); C._FAMILY.update(fam)
        sm.CONTEXT.clear(); sm.CONTEXT.update(ctx)
        sm.RESOLUTION.clear(); sm.SUBSTITUTIONS.clear()
        S._IDS.clear(); S._DOCS.pop(TILE.tile_id, None)
        for k in [k for k in S._LAYERS if k[0] == TILE.tile_id]:
            del S._LAYERS[k]
        if A is not None:
            A.EVIDENCE, A.PROFILE = self._a
            A._SHRUB.clear()

    def rule(self, name, key, hab=4):
        return sm.named_rule(name, hab, key)


SPREAD = {   # cliffrose on the canyon more than visits put it there; Apache plume and fernbush likewise; one of each elsewhere
    "Purshia stansburiana": {CANYON: 12, PONDEROSA: 3},
    "Fallugia paradoxa": {CANYON: 6, PONDEROSA: 2},
    "Chamaebatiaria millefolium": {CANYON: 4, PONDEROSA: 1},
}
EFFORT = {CANYON: 300, PONDEROSA: 500, BLACKBRUSH: 100, GRASSLAND: 100}


class TestACommunityThatNamesNothing(Place):
    records = {"purshia_stansburiana": 546, "fallugia_paradoxa": 300, "chamaebatiaria_millefolium": 400}
    species = SPREAD
    effort = EFFORT

    def test_the_bedrock_canyon_takes_the_shrubs_recorded_on_its_cells(self):
        # fails on the code before: named_rule returned None (no species in the name) and the canyon was drawn bare
        r = self.rule(CANYON, ("evt", 9001), hab=8)
        self.assertIsNotNone(r)
        self.assertEqual(list(r["shrubs"]), ["purshia_stansburiana", "fallugia_paradoxa", "chamaebatiaria_millefolium"])
        self.assertEqual(r["trees"], {})

    def test_the_order_is_the_records_and_the_weights_reciprocal_ranks(self):
        # well recorded on the canyon's own cells (30 or more each): the ranks alone, and the class's whole density
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {CANYON: 60}, "Fallugia paradoxa": {CANYON: 45},
                                            "Chamaebatiaria millefolium": {CANYON: 30}}, self.effort)
        r = self.rule(CANYON, ("evt", 9001), hab=8)
        s, tot = r["shrubs"], 1 + 1 / 2 + 1 / 3
        self.assertAlmostEqual(s["purshia_stansburiana"], 1 / tot, places=3)        # not 60 : 45 : 30, the counts
        self.assertAlmostEqual(s["fallugia_paradoxa"], 0.5 / tot, places=3)
        self.assertAlmostEqual(s["chamaebatiaria_millefolium"], (1 / 3) / tot, places=3)
        self.assertEqual(r["recorded_support"], 1.0)
        self.assertEqual(r["shrub_density"], sm.NAMED_DENSITY["barren"][1])

    def test_a_lone_member_on_three_records_is_a_thin_scatter(self):
        # fails on the code of 2026-11-10: the layer stood at its class's whole density (0.5 under a forest) and its
        # weight came from the records near the whole tile (546 here): Teton's spruce-fir, all thimbleberry on three
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {CANYON: 3}}, self.effort)
        r = self.rule(CANYON, ("evt", 9001), hab=2)
        self.assertEqual(r["shrubs"], {"purshia_stansburiana": 1.0})
        self.assertLess(r["shrub_density"], 0.1)
        self.assertAlmostEqual(r["shrub_density"], sm.NAMED_DENSITY["conifer_forest"][1] * 0.1)   # 3 / 30 of 0.5
        self.assertAlmostEqual(r["recorded_support"], 0.1)

    def test_the_layer_is_as_dense_as_the_records_on_its_own_cells(self):
        # 12, 6 and 4 records on the canyon: 12/30, 6/30 over 2, 4/30 over 3, whatever the records near the tile (546, 300, 400)
        r = self.rule(CANYON, ("evt", 9001), hab=8)
        a = [12 / 30, 6 / 30 / 2, 4 / 30 / 3]
        self.assertAlmostEqual(r["recorded_support"], sum(a), places=3)             # 0.54
        self.assertAlmostEqual(r["shrub_density"], sm.NAMED_DENSITY["barren"][1] * sum(a), places=4)
        self.assertAlmostEqual(r["shrubs"]["purshia_stansburiana"], a[0] / sum(a), places=3)
        self.assertAlmostEqual(r["shrubs"]["chamaebatiaria_millefolium"], a[2] / sum(a), places=3)
        self.assertEqual(sm.recorded_support([{"records": 40}, {"records": 40}]), 1.0)   # never more than the class's density

    def test_its_carpet_is_as_thin(self):
        # a dwarf shrub is the ground layer's carpet (split_dwarf_shrubs): on three records it is not a whole carpet
        saved = dict(sm._DWARF_CACHE)
        sm._DWARF_CACHE.update({"dwarfus_recordus": True, "purshia_stansburiana": False})
        try:
            row = {"shrubs": {"dwarfus_recordus": 0.75, "purshia_stansburiana": 0.25}, "shrub_density": 0.1, "ground": {},
                   "recorded_support": 0.2}
            sm.split_dwarf_shrubs(row)
            self.assertAlmostEqual(row["carpet_density"], 0.75 * 0.2)
            self.assertAlmostEqual(row["shrub_density"], 0.025)
            listed = {"shrubs": {"dwarfus_recordus": 0.75, "purshia_stansburiana": 0.25}, "shrub_density": 0.5, "ground": {}}
            sm.split_dwarf_shrubs(listed)
            self.assertAlmostEqual(listed["carpet_density"], 0.75)                  # a listed layer: as before
        finally:
            sm._DWARF_CACHE.clear(); sm._DWARF_CACHE.update(saved)

    def test_it_says_so(self):
        r = self.rule(CANYON, ("evt", 9001), hab=8)
        self.assertTrue(r["id"].startswith("recorded_"))
        self.assertEqual(r["weights"]["shrubs"], "recorded")
        self.assertEqual(r["tree_density"], 0.0)
        self.assertEqual(r["recorded"]["purshia_stansburiana"], {"records": 12, "of": 15, "affinity": 2.67})
        self.assertEqual(scorecard.KIND_SHARE[scorecard.rule_kind(r["id"], "evt", True)], "guessed")

    def test_a_grassland_and_open_water_gain_no_shrub(self):
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {GRASSLAND: 9, "Open Water": 5}}, {GRASSLAND: 100, "Open Water": 20, CANYON: 400})
        self.assertIsNone(self.rule(GRASSLAND, ("evt", 7135), hab=5))
        self.assertEqual(A.members(TILE, "Open Water"), [])

    def test_a_tile_inside_a_regional_table_is_untouched(self):
        sm.CONTEXT.update(regions=["california"])
        self.assertIsNone(self.rule(CANYON, ("evt", 9001), hab=8))

    def test_without_records_nothing_is_added(self):
        A.EVIDENCE = lambda tile: None       # offline, or a square LANDFIRE does not map
        self.assertIsNone(self.rule(CANYON, ("evt", 9001), hab=8))


class TestMembership(Place):
    records = {"purshia_stansburiana": 546}
    effort = EFFORT

    def members(self, species):
        A.EVIDENCE = lambda tile: evidence(species, self.effort)
        return [m["id"] for m in A.members(TILE, CANYON)]

    def test_three_records_on_the_community_make_a_member_two_do_not(self):
        self.assertEqual(self.members({"Purshia stansburiana": {CANYON: 3}}), ["purshia_stansburiana"])
        self.assertEqual(self.members({"Purshia stansburiana": {CANYON: 2}}), [])

    def test_a_widespread_species_is_kept_out_where_it_is_under_recorded(self):
        # 30 records on the canyon, but 170 elsewhere: 15 % of its records on a community with 30 % of all plant records
        sp = {"Purshia stansburiana": {CANYON: 30, PONDEROSA: 160, BLACKBRUSH: 10}}
        self.assertEqual(self.members(sp), [])
        A.EVIDENCE = lambda tile: evidence(sp, self.effort)
        self.assertEqual([m["id"] for m in A.members(TILE, BLACKBRUSH)], [])      # 5 % of its records on 10 % of the visits
        sp["Purshia stansburiana"][BLACKBRUSH] = 30                               # 14 % of them: its community
        self.assertEqual([m["id"] for m in A.members(TILE, BLACKBRUSH)], ["purshia_stansburiana"])

    def test_a_little_more_than_the_visits_explain_is_not_enough(self):
        # 9 of 25 records on a community with 30 % of the visits: 7.5 expected, give or take 2.3. The ratio is 1.2, the
        # excess 0.65 standard errors: chance (the snowbrush of Jackson Hole's sagebrush steppe)
        self.assertEqual(self.members({"Purshia stansburiana": {CANYON: 9, PONDEROSA: 16}}), [])
        self.assertEqual(self.members({"Purshia stansburiana": {CANYON: 12, PONDEROSA: 13}}), ["purshia_stansburiana"])   # 1.96
        self.assertAlmostEqual(A.excess(9, 25, 300, 1000), 0.65, places=2)

    def test_no_species_passes_everywhere(self):
        # however a species' records fall, what it has over and under the visits' share sums to nothing: it is under
        # somewhere, and one spread exactly as the visits are is a member nowhere
        sp = {"Purshia stansburiana": {CANYON: 40, PONDEROSA: 45, BLACKBRUSH: 10, GRASSLAND: 5}}
        ev = evidence(sp, self.effort)
        z = [A.excess(n, 100, self.effort[c], ev["total"]) for c, n in sp["Purshia stansburiana"].items()]
        self.assertTrue(min(z) < 0 < max(z))
        even = {"Purshia stansburiana": {c: n // 10 for c, n in self.effort.items()}}
        A.EVIDENCE = lambda tile: evidence(even, self.effort)
        self.assertEqual([c for c in self.effort if A.members(TILE, c)], [])

    def test_only_native_shrubs(self):
        on = lambda sci: self.members({sci: {CANYON: 9}})
        self.assertEqual(on("Tamarix chinensis"), [])          # introduced (USDA PLANTS): the rewilding baseline
        self.assertEqual(on("Laphamia congesta"), [])          # a subshrub only: the ground layer's
        self.assertEqual(on("Penstemon palmeri"), [])          # a forb PLANTS also calls a subshrub
        self.assertEqual(on("Eriogonum umbellatum"), [])       # a shrub PLANTS also calls a forb
        self.assertEqual(on("Phoradendron juniperinum"), [])   # a mistletoe
        self.assertEqual(on("Juniperus osteosperma"), [])      # the library's record is a tree
        self.assertEqual(on("Gutierrezia sarothrae"), [])      # the library's record is a forb
        self.assertEqual(on("Unknown plantus"), [])            # PLANTS does not know it: no evidence it is native
        self.assertEqual(on("Opuntia polyacantha"), ["opuntia_polyacantha"])   # asked for; whether it can be drawn is resolve's

    def test_at_most_max_associates_the_most_recorded_first(self):
        names = [f"Genus species{chr(97 + i)}" for i in range(A.MAX_ASSOCIATES + 3)]
        for i, n in enumerate(names):
            PROFILES[n] = profile(n, ["Shrub"])
        try:
            got = self.members({n: {CANYON: 20 - i} for i, n in enumerate(names)})
        finally:
            for n in names:
                del PROFILES[n]
        self.assertEqual(len(got), A.MAX_ASSOCIATES)
        self.assertEqual(got[0], "genus_speciesa")


BLACKBRUSH_CLASSES = [{"class": "B", "share": 1.0, "species": [("Coleogyne ramosissima", "upper"), ("Ephedra viridis", "upper")]}]
PONDEROSA_CLASSES = [{"class": "A", "share": 1.0, "species": [("Pinus ponderosa", "upper"), ("Quercus gambelii", "lower")]}]
MEADOW_CLASSES = [{"class": "A", "share": 1.0, "species": [("Festuca arizonica", "upper")]}]


class TestAfterTheListedSpecies(Place):
    records = {"coleogyne_ramosissima": 35, "ephedra_viridis": 98, "pinus_ponderosa": 71, "quercus_gambelii": 515,
               "purshia_stansburiana": 546, "fallugia_paradoxa": 300, "chamaebatiaria_millefolium": 400, "shepherdia_rotundifolia": 60}
    effort = EFFORT
    models = {("evt", 7078): (BLACKBRUSH_CLASSES, "shrubland"), ("evt", 7054): (PONDEROSA_CLASSES, "forest and woodland"),
              ("evt", 7135): (MEADOW_CLASSES, "herbaceous")}
    species = {"Purshia stansburiana": {BLACKBRUSH: 9, PONDEROSA: 30}, "Fallugia paradoxa": {BLACKBRUSH: 5, PONDEROSA: 24},
               "Chamaebatiaria millefolium": {PONDEROSA: 18}, "Shepherdia rotundifolia": {PONDEROSA: 12},
               "Ephedra viridis": {BLACKBRUSH: 40}}

    def test_the_listed_species_keep_their_order_and_lead(self):
        # fails on the code before: the shrubland drew blackbrush and Mormon tea alone
        r = self.rule(BLACKBRUSH, ("evt", 7078))
        s = r["shrubs"]
        self.assertEqual(set(s), {"coleogyne_ramosissima", "ephedra_viridis", "purshia_stansburiana", "fallugia_paradoxa"})
        self.assertGreater(s["coleogyne_ramosissima"], s["ephedra_viridis"])              # the description's order
        self.assertGreater(s["ephedra_viridis"], s["purshia_stansburiana"])               # a third species at most
        self.assertGreater(s["purshia_stansburiana"], s["fallugia_paradoxa"])             # by their records there
        # two listed (ranks 1 and 2, 1.5 together), then ranks 3 and 4, each as far as its records on the shrubland's
        # own cells go: 9 / 30 over 3 and 5 / 30 over 4
        a = [9 / 30 / 3, 5 / 30 / 4]
        self.assertAlmostEqual(s["purshia_stansburiana"], a[0] / (1.5 + sum(a)), places=3)
        self.assertAlmostEqual(s["fallugia_paradoxa"], a[1] / (1.5 + sum(a)), places=3)
        self.assertAlmostEqual(s["coleogyne_ramosissima"] + s["ephedra_viridis"], 1.5 / (1.5 + sum(a)), places=3)
        self.assertEqual(r["weights"]["shrubs"], "description+recorded")
        self.assertTrue(r["id"].startswith("named_from_"))
        self.assertNotIn("recorded_support", r)                                    # listed species lead: the class's density
        self.assertEqual(r["shrub_density"], sm.NAMED_DENSITY["chaparral"][1])
        self.assertEqual(set(r["recorded"]), {"purshia_stansburiana", "fallugia_paradoxa"})   # Mormon tea is listed, not added

    def test_the_associates_never_weigh_more_than_the_listed(self):
        # one shrub listed (Gambel oak) and four well recorded on the woodland's own cells (30 or more each):
        # 1/2 + 1/3 + 1/4 + 1/5 > 1, held to the oak's weight
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {PONDEROSA: 60}, "Fallugia paradoxa": {PONDEROSA: 50},
                                            "Chamaebatiaria millefolium": {PONDEROSA: 40}, "Shepherdia rotundifolia": {PONDEROSA: 30}},
                                           self.effort)
        s = self.rule(PONDEROSA, ("evt", 7054), hab=2)["shrubs"]
        self.assertAlmostEqual(s["quercus_gambelii"], 0.5, places=3)
        rest = {k: v for k, v in s.items() if k != "quercus_gambelii"}
        self.assertEqual(len(rest), 4)
        self.assertAlmostEqual(sum(rest.values()), 0.5, places=3)
        self.assertEqual(sorted(rest, key=lambda k: -rest[k]), ["purshia_stansburiana", "fallugia_paradoxa", "chamaebatiaria_millefolium",
                                                                 "shepherdia_rotundifolia"])

    def test_the_trees_are_not_touched(self):
        self.assertEqual(self.rule(PONDEROSA, ("evt", 7054), hab=2)["trees"], {"pinus_ponderosa": 1.0})

    def test_a_described_grassland_gains_no_shrub(self):
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {GRASSLAND: 9}}, self.effort) | {"phys": {**PHYS, GRASSLAND: "Shrubland"}}
        self.assertIsNone(self.rule(GRASSLAND, ("evt", 7135), hab=5))    # its description's type is herbaceous

    def test_an_associate_weighs_by_its_records_on_the_communitys_own_cells(self):
        # fails on the code of 2026-11-10: its rarity came from the records near the whole tile (546 here) and on any
        # natural cell (39), so nine records on the shrubland weighed a whole 1/3: creeping barberry was a third of
        # Teton's aspen understory on 3 of its 26 records
        s = self.rule(BLACKBRUSH, ("evt", 7078))["shrubs"]
        a = [9 / 30 / 3, 5 / 30 / 4]
        self.assertAlmostEqual(s["purshia_stansburiana"], a[0] / (1.5 + sum(a)), places=3)
        self.assertLess(s["purshia_stansburiana"], 0.07)                           # was 0.16
        self.records = {**self.records, "purshia_stansburiana": 6}                 # the records near the tile no longer count
        self.assertAlmostEqual(self.rule(BLACKBRUSH, ("evt", 7078))["shrubs"]["purshia_stansburiana"], a[0] / (1.5 + sum(a)), places=3)

    def test_a_thin_associates_share_goes_to_the_listed_species(self):
        # three records: a tenth of a third species. The listed species take the rest and the layer keeps its class's
        # density: LANDFIRE's description supports the layer, so nothing is held empty here
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {BLACKBRUSH: 3}}, self.effort)
        r = self.rule(BLACKBRUSH, ("evt", 7078))
        s = r["shrubs"]
        self.assertAlmostEqual(s["purshia_stansburiana"], (0.1 / 3) / (1.5 + 0.1 / 3), places=4)   # 0.022
        self.assertAlmostEqual(s["coleogyne_ramosissima"] + s["ephedra_viridis"], 1.5 / (1.5 + 0.1 / 3), places=4)
        self.assertAlmostEqual(sum(s.values()), 1.0, places=6)
        self.assertEqual(r["shrub_density"], sm.NAMED_DENSITY["chaparral"][1])
        self.assertNotIn("recorded_support", r)
        self.assertNotIn("held_empty", r)
        self.assertEqual(r["recorded"]["purshia_stansburiana"]["records"], 3)

    def test_a_well_recorded_associate_weighs_a_whole_rank(self):
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {BLACKBRUSH: 45}}, self.effort)
        s = self.rule(BLACKBRUSH, ("evt", 7078))["shrubs"]
        self.assertAlmostEqual(s["purshia_stansburiana"], (1 / 3) / (1.5 + 1 / 3), places=3)       # never more than its rank

    def test_a_dwarf_associates_carpet_is_its_share(self):
        # the carpet under listed species is the dwarf's share of the layer (split_dwarf_shrubs), so it thins with the
        # share and needs no factor of its own: on three records a fiftieth of the shrub cover, not a sixth
        A.EVIDENCE = lambda tile: evidence({"Purshia stansburiana": {BLACKBRUSH: 3}}, self.effort)
        r = self.rule(BLACKBRUSH, ("evt", 7078))
        saved = dict(sm._DWARF_CACHE)
        sm._DWARF_CACHE.update({k: k == "purshia_stansburiana" for k in r["shrubs"]})
        try:
            row = {"shrubs": dict(r["shrubs"]), "shrub_density": r["shrub_density"], "ground": {}}
            sm.split_dwarf_shrubs(row)
            self.assertAlmostEqual(row["carpet_density"], (0.1 / 3) / (1.5 + 0.1 / 3), places=4)
            self.assertLess(row["carpet_density"], 0.03)                           # was 0.18
            self.assertAlmostEqual(row["shrub_density"], r["shrub_density"] * 1.5 / (1.5 + 0.1 / 3), places=4)
        finally:
            sm._DWARF_CACHE.clear(); sm._DWARF_CACHE.update(saved)

    def test_it_says_so(self):
        self.assertIn("each as far as its records there go", self.rule(BLACKBRUSH, ("evt", 7078))["note"])


class TestNoGrowthForm(Place):
    records = {"fake_leafy_cactus_relative": 200, "opuntia_polyacantha": 300}

    def test_a_cactus_is_missing_not_a_leafy_relative(self):
        # fails on the code before: a record of the same family and growth form that belongs to the tile stood in
        C._FAMILY.update({"opuntia_polyacantha": "Cactaceae", "fake_leafy_cactus_relative": "Cactaceae"})
        woody = C._woody_records
        C._woody_records = lambda: {"fake_leafy_cactus_relative": "shrub"}
        try:
            drawn, why = C.local_stand_in("opuntia_polyacantha", TILE, [], "shrub")
        finally:
            C._woody_records = woody
        self.assertIsNone(drawn)
        self.assertIn("growth form", why)

    def test_a_yucca_likewise(self):
        C._FAMILY.update({"yucca_elata": "Asparagaceae"})
        drawn, why = C.local_stand_in("yucca_elata", TILE, [], "shrub")
        self.assertIsNone(drawn)
        self.assertIn("rosette", why)

    def test_its_place_is_left_empty_not_given_to_the_other_shrubs(self):
        C._FAMILY.update({"opuntia_polyacantha": "Cactaceae", "echinocereus_engelmannii": "Cactaceae", "unknown_shrubus": "Rosaceae"})
        row = {"trees": {"pinus_ponderosa": 1.0}, "shrubs": {"opuntia_polyacantha": 0.3, "purshia_stansburiana": 0.5, "echinocereus_engelmannii": 0.1,
                                                              "unknown_shrubus": 0.1}, "tree_density": 1.2, "shrub_density": 0.5}
        self.assertEqual(sm.hold_empty(row), {"shrubs": 0.4})      # the two cacti; an ordinary missing shrub gives its share away
        self.assertAlmostEqual(row["shrub_density"], 0.3)
        self.assertEqual(row["tree_density"], 1.2)
        self.assertEqual(set(row["shrubs"]), {"opuntia_polyacantha", "purshia_stansburiana", "echinocereus_engelmannii", "unknown_shrubus"})
        only = {"trees": {}, "shrubs": {"opuntia_polyacantha": 1.0}, "tree_density": 0.0, "shrub_density": 1.0}
        self.assertEqual(sm.hold_empty(only), {"shrubs": 1.0})     # a community of cacti alone: empty, not another community's shrubs
        self.assertEqual(only["shrub_density"], 0.0)


class TestJoin(unittest.TestCase):
    """associates.join: records laid on the vegetation map."""

    def setUp(self):
        from affine import Affine
        self.codes = np.full((10, 10), 1, dtype="int16")
        self.codes[:, 5:] = 2          # the east half another community
        self.codes[0, :] = 9           # a developed row along the north edge
        self.tr = Affine(30.0, 0, 0.0, 0, -30.0, 300.0)   # 30 m cells, the north-west corner at (0, 300)
        self.names = {1: "west woodland", 2: "east scrub"}
        self.xy = lambda lon, lat: (lon, lat)             # the records already in the map's coordinates

    def test_a_record_counts_for_the_community_of_its_cell(self):
        ev = A.join([["Purshia stansburiana", "Rosaceae", 45.0, 150.0, "d"], ["Purshia stansburiana", "Rosaceae", 250.0, 150.0, "d"],
                     ["Ephedra viridis", "Ephedraceae", 255.0, 100.0, "d"]], self.codes, self.tr, self.xy, self.names)
        self.assertEqual(ev["effort"], {"west woodland": 1, "east scrub": 2})
        self.assertEqual(ev["species"]["Purshia stansburiana"]["by"], {"west woodland": 1, "east scrub": 1})
        self.assertEqual(ev["total"], 3)

    def test_developed_cells_and_the_world_off_the_map_count_for_nothing(self):
        ev = A.join([["Rosa woodsii", "Rosaceae", 45.0, 290.0, "d"], ["Rosa woodsii", "Rosaceae", -40.0, 150.0, "d"]],
                    self.codes, self.tr, self.xy, self.names)
        self.assertEqual(ev["total"], 0)
        self.assertEqual(ev["skipped"]["developed or farmed"], 1)
        self.assertEqual(ev["skipped"]["off the map"], 1)

    def test_a_record_on_a_boundary_counts_for_neither_side(self):
        self.codes[4, 4] = 2           # one east-scrub cell inside the woodland: 1 of the 9 cells around it
        ev = A.join([["Rosa woodsii", "Rosaceae", 135.0, 165.0, "d"]], self.codes, self.tr, self.xy, self.names)
        self.assertEqual(ev["total"], 0)
        self.assertEqual(ev["skipped"]["mixed ground"], 1)


if __name__ == "__main__":
    unittest.main()
