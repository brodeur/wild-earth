"""The tile scorecard (pipeline/scorecard.py): shares per layer on small fixture documents."""
import json
import tempfile
import unittest
from pathlib import Path

from pipeline import scorecard as sc


def _sum(sh):
    return round(sum(sh[k] for k in sc.SHARES), 4)


class Shares(unittest.TestCase):
    def test_sum_to_one(self):
        sh = sc.shares(1, 1, 1, 0)
        self.assertEqual(_sum(sh), 1.0)
        self.assertEqual(set(sh), set(sc.SHARES))

    def test_all_zero_is_none(self):
        self.assertIsNone(sc.shares(0, 0, 0, 0))

    def test_negative_ignored(self):
        self.assertEqual(sc.shares(1, -1, 0, 0)["measured"], 1.0)


class RuleKind(unittest.TestCase):
    def test_kinds(self):
        rk = sc.rule_kind
        self.assertEqual(rk("blue_oak_foothill_pine", "evt", True), "hand")
        self.assertEqual(rk("named_from_pinus_ponderosa", "evt", True), "named")
        self.assertEqual(rk("tile_pool_chaparral", "evt", True), "pool")
        self.assertEqual(rk("tile_pool_grassland", "evt", False, True), "ground_only")
        self.assertEqual(rk("tile_pool_barren", "evt", False, False), "bare")
        self.assertEqual(rk("research_M1", "evt", True), "research")
        self.assertEqual(rk("habitat_default_grassland", "evt", True), "class_default")
        self.assertEqual(rk("open_water", "evt", False), "water_ice")
        self.assertEqual(rk("snow_ice", "ice", False), "water_ice")
        # a back-filled class is guessed whatever rule drew it; a bare pool stays blank
        self.assertEqual(rk("blue_oak_foothill_pine", "bps", True), "backfill")
        self.assertEqual(rk("rewilded_meadow", "rewild", True), "backfill")
        self.assertEqual(rk("tile_pool_barren", "bps", False), "bare")


def mix_doc(**extra):
    doc = {
        "natural_regions": ["great_basin"],
        "communities": [
            {"community": 1, "source": "evt", "name": "Pinyon-Juniper", "rule": "named_from_juniperus_pinus_monophylla",
             "trees": {"juniperus_grandis": 1.0, "pinus_monophylla": 1.0}, "shrubs": {}, "ground": {},
             "tree_density": 1.0, "shrub_density": 0.0, "cells": 30},
            {"community": 2, "source": "evt", "name": "Desert scrub", "rule": "tile_pool_chaparral",
             "trees": {}, "shrubs": {"adenostoma_fasciculatum": 1.0, "fallugia_paradoxa": 1.0}, "ground": {},
             "tree_density": 0.0, "shrub_density": 1.0, "cells": 20},
            {"community": 3, "source": "evt", "name": "Bedrock canyon", "rule": "tile_pool_barren",
             "trees": {}, "shrubs": {}, "ground": {}, "tree_density": 0.0, "shrub_density": 0.0, "cells": 40},
            {"community": 4, "source": "evt", "name": "Open Water", "rule": "open_water",
             "trees": {}, "shrubs": {}, "ground": {}, "tree_density": 0.0, "shrub_density": 0.0, "cells": 5},
            {"community": 5, "source": "bps", "name": "Ponderosa (under farmland)", "rule": "named_from_pinus_ponderosa",
             "trees": {"pinus_ponderosa": 1.0}, "shrubs": {}, "ground": {}, "tree_density": 1.0, "shrub_density": 0.0,
             "cells": 5},
        ],
        "mixes": [
            {"community": 1, "cells": 30, "rule": "named_from_juniperus_pinus_monophylla",
             "tree_bytes": [["juniperus_grandis", 128], ["pinus_sabiniana", 127]], "shrub_bytes": [], "ground_bytes": []},
            {"community": 2, "cells": 20, "rule": "tile_pool_chaparral", "tree_bytes": [],
             "shrub_bytes": [["adenostoma_fasciculatum", 255]], "ground_bytes": []},
            {"community": 3, "cells": 40, "rule": "tile_pool_barren"},
            {"community": 4, "cells": 5, "rule": "open_water"},
            {"community": 5, "cells": 5, "rule": "named_from_pinus_ponderosa", "tree_bytes": [["pinus_ponderosa", 255]]},
        ],
        "fractions": {"from_bps_backfill": 0.05},
        "unmatched": [{"drawn": "bare (nothing known)"}, {"drawn": "its named species"}],
        "substitutions": {"pinus_monophylla": "pinus_sabiniana", "fallugia_paradoxa": None},
    }
    doc.update(extra)
    return doc


class Communities(unittest.TestCase):
    def test_shares(self):
        r = sc.score_communities(mix_doc())
        self.assertTrue(r["scored"])
        sh = r["shares"]
        self.assertEqual(sh["measured"], 0.0)
        self.assertAlmostEqual(sh["ruled"], 0.35)      # named 30 + open water 5
        self.assertAlmostEqual(sh["guessed"], 0.25)    # pool 20 + back-filled 5
        self.assertAlmostEqual(sh["blank"], 0.40)      # bare pool 40
        self.assertEqual(_sum(sh), 1.0)
        d = r["detail"]
        self.assertAlmostEqual(d["by_kind"]["backfill"], 0.05)
        self.assertAlmostEqual(d["by_rule_ignoring_source"]["named"], 0.35)   # the review's columns ignore the source
        self.assertEqual(d["pre_settlement_share"], 0.05)   # the bps community only
        self.assertEqual(d["unmatched"], 2)
        self.assertTrue(any("40% of cells have no community" in f["text"] for f in r["findings"]))

    def test_pre_settlement_excludes_ice(self):
        doc = mix_doc()
        doc["communities"].append({"community": 6, "source": "ice", "rule": "snow_ice", "trees": {}, "shrubs": {},
                                   "cells": 100})
        d = sc.score_communities(doc)["detail"]
        self.assertAlmostEqual(d["pre_settlement_share"], 0.025)

    def test_ground_only_pool_is_ruled(self):
        doc = mix_doc()
        doc["communities"][2]["ground"] = {"carex_geyeri": 1.0}
        r = sc.score_communities(doc)
        self.assertAlmostEqual(r["shares"]["blank"], 0.0)
        self.assertAlmostEqual(r["shares"]["ruled"], 0.75)

    def test_no_document(self):
        self.assertFalse(sc.score_communities(None)["scored"])


class PlantSpecies(unittest.TestCase):
    def test_substitutions_when_stand_ins_absent(self):
        r = sc.score_plant_species(mix_doc(), None)
        sh = r["shares"]
        # trees: 30 cells x 1.0 split juniper 15 (ruled) / pinyon 15 (stand-in); ponderosa 5 (ruled): 35
        # shrubs: 20 cells x 1.0 split chamise 10 (ruled) / apache plume 10 (null substitution: blank): 55 in all
        self.assertAlmostEqual(sh["guessed"], round(15 / 55, 4))
        self.assertAlmostEqual(sh["blank"], round(10 / 55, 4))
        self.assertAlmostEqual(sh["ruled"], round(30 / 55, 4), places=3)
        self.assertEqual(sh["measured"], 0.0)
        d = r["detail"]
        self.assertFalse(d["stand_ins"]["recorded"])
        self.assertIn("not recorded by this build", d["stand_ins"]["note"])
        self.assertFalse(d["missing"]["recorded"])
        self.assertEqual(d["counts"], {"canopy": 3, "shrub": 1, "ground": 0})
        texts = [f["text"] for f in r["findings"]]
        self.assertIn("no ground species at all", texts)
        self.assertTrue(any("one shrub species only" in t for t in texts))
        self.assertTrue(any("canopy weight is drawn as a stand-in" in t for t in texts))

    def test_status(self):
        d = sc.score_plant_species(mix_doc(), None)["detail"]["status"]
        self.assertFalse(d["status_field"])
        self.assertEqual(d["note"], "no status field in this build")
        self.assertEqual(d["status_unknown"], 4)   # the drawn species: juniper, gray pine, ponderosa, chamise
        needs = {"needs": [{"id": "juniperus_grandis", "status": "native"}]}
        r = sc.score_plant_species(mix_doc(species_status={"pinus_sabiniana": "introduced"}), needs)
        st = r["detail"]["status"]
        self.assertTrue(st["status_field"])
        self.assertEqual((st["introduced"], st["native"], st["status_unknown"]), (1, 1, 2))
        self.assertTrue(any("drawn plant species are introduced" in f["text"] for f in r["findings"]))

    def test_recorded_stand_ins_and_missing(self):
        doc = mix_doc(substitutions={},
                      stand_ins=[{"species": "juniperus_grandis", "drawn": "juniperus_osteosperma", "reason": "genus", "cells": 30}],
                      missing=[{"species": "pinus_monophylla", "reason": "no record in region", "cells": 30}])
        r = sc.score_plant_species(doc, None)
        sh = r["shares"]
        self.assertAlmostEqual(sh["guessed"], round(15 / 55, 4))   # juniper drawn as Utah juniper
        self.assertAlmostEqual(sh["blank"], round(15 / 55, 4))     # pinyon missing
        self.assertAlmostEqual(sh["ruled"], round(25 / 55, 4), places=3)   # ponderosa 5, both shrubs 20
        d = r["detail"]
        self.assertTrue(d["stand_ins"]["recorded"])
        self.assertEqual(d["stand_ins"]["entries"][0]["cells"], 30)   # the lane's entries verbatim
        self.assertTrue(d["missing"]["recorded"])

    def test_functional_stand_ins_from_note(self):
        doc = {"communities": [{"community": 1, "source": "evt", "rule": "research_M1", "cells": 10,
                                "trees": {"betula_pubescens": 1.0, "pinus_sylvestris": 1.0}, "shrubs": {},
                                "tree_density": 1.0, "shrub_density": 0.0,
                                "note": "no regional rule: ...; no tree of its own on record: functional stand-ins of its "
                                        "climate group (pinus_sylvestris)"}],
               "mixes": [{"community": 1, "cells": 10, "tree_bytes": [["betula_pubescens", 128], ["pinus_sylvestris", 127]]}]}
        r = sc.score_plant_species(doc, None)
        self.assertAlmostEqual(r["shares"]["guessed"], 0.5)
        self.assertAlmostEqual(r["shares"]["ruled"], 0.5)

    def test_riparian_rows_count_as_drawn(self):
        doc = mix_doc(riparian={"rows": {"bank|small": {"trees": [["salix_exigua", 255]], "shrubs": [], "ground": [["carex_nebrascensis", 255]]}}})
        d = sc.score_plant_species(doc, None)["detail"]
        self.assertIn("salix_exigua", d["drawn"]["trees"])
        self.assertEqual(d["counts"]["ground"], 1)


def manifest_doc(**status):
    return {
        "generated_at": "2026-11-09T00:00:00Z",
        "status": {"lidar": "partial", "lidar_coverage": {"dem_1m": 0.0, "point_cloud": 0.6}, **status},
        "layers": {
            "terrain.dem": {"source": "usgs_3dep", "source_resolution_m": 1.0, "resolution_m": 5.0,
                            "stats": {"valid_fraction": 1.0}},
            "terrain.dem_1m": {"source": "usgs_3dep", "coverage": {"share_1m": 0.0, "share_5m_fill": 1.0},
                               "unroad": {"corridor_share": 0.01}},
            "vegetation.evc": {"source": "landfire"},
            "client.texture_ground": {"source": "pc_naip", "resolution_m": 2.5, "filled_fraction": 0.4},
            "client.texture_imagery": {"source": "pc_naip", "resolution_m": 2.5, "mask_fraction": 0.02},
            "hydro.channels": {"params": {"width": "1.6*A^0.45 clamp 1-30"},
                               "stats": {"nhd_length_km": 10.0, "nhd_covered_length_km": 7.0, "nhd_kept_length_km": 1.0}},
        },
    }


class Terrain(unittest.TestCase):
    def test_point_cloud_ground_and_corridor(self):
        r = sc.score_terrain(manifest_doc(), {"ground_from_points": {"share": 0.55}}, None)
        sh = r["shares"]
        self.assertAlmostEqual(sh["measured"], 0.54)   # 0 product + 0.55 ground returns - 0.01 corridors
        self.assertAlmostEqual(sh["ruled"], 0.46)
        self.assertEqual(r["detail"]["lidar"], "point cloud on 60% of the tile")
        # the seamless service's constant 1.0 m is called out, not trusted
        self.assertTrue(any("source_resolution_m 1.0" in x for x in r["not_scored"]))
        self.assertTrue(any("resolution not recorded" in f["text"] for f in r["findings"]))

    def test_global_surface_model(self):
        m = {"status": {}, "layers": {"terrain.dem": {"source": "copernicus_dem_glo30", "source_resolution_m": 30.0,
                                                      "surface_model": True, "stats": {"valid_fraction": 0.98}}}}
        r = sc.score_terrain(m, None, None)
        self.assertEqual(r["shares"]["measured"], 0.0)
        self.assertAlmostEqual(r["shares"]["blank"], 0.02)
        self.assertEqual(r["detail"]["lidar"], "none")
        self.assertTrue(any("surface model" in f["text"] for f in r["findings"]))
        self.assertEqual(len(r["findings"]), 1)   # one finding, not two for the same ground

    def test_ruled_ranks_half(self):
        layers = {"terrain": {"findings": [sc._finding("terrain", "coarse", 1.0, "tile area", "ruled")]},
                  "plant_communities": {"findings": [sc._finding("plant_communities", "pool", 0.6, "cells", "guessed")]},
                  "animals": {"findings": [sc._finding("animals", "no fish species listed", None, "the fish kind")]}}
        self.assertEqual([f["text"] for f in sc.rank_findings(layers)], ["pool", "coarse", "no fish species listed"])

    def test_1m_dem_only(self):
        m = {"status": {"lidar": "dem_only", "lidar_coverage": {"dem_1m": 1.0, "point_cloud": 0.0}},
             "layers": {"terrain.dem": {"source": "usgs_3dep_1m", "source_resolution_m": 1.0, "stats": {"valid_fraction": 1}},
                        "terrain.dem_1m": {"source": "usgs_3dep_1m", "coverage": {"share_1m": 1.0}}}}
        r = sc.score_terrain(m, None, {"dem_only": True})
        self.assertEqual(r["shares"]["measured"], 1.0)
        self.assertEqual(r["detail"]["lidar"], "1 m DEM only")


class Canopy(unittest.TestCase):
    def test_split(self):
        r = sc.score_canopy(manifest_doc())
        self.assertAlmostEqual(r["shares"]["measured"], 0.6)
        self.assertAlmostEqual(r["shares"]["ruled"], 0.4)
        self.assertIn("LANDFIRE", r["detail"]["elsewhere"])


class GroundTexture(unittest.TestCase):
    def test_naip_and_fill(self):
        r = sc.score_ground_texture(manifest_doc())
        self.assertAlmostEqual(r["shares"]["measured"], 0.6)
        self.assertAlmostEqual(r["shares"]["guessed"], 0.4)

    def test_sentinel_is_ruled_and_no_inpaint_falls_back(self):
        m = {"layers": {"client.texture_imagery": {"source": "sentinel2_l2a", "resolution_m": 2.5, "mask_fraction": 0.05}}}
        r = sc.score_ground_texture(m)
        self.assertAlmostEqual(r["shares"]["ruled"], 0.95)
        self.assertAlmostEqual(r["shares"]["guessed"], 0.05)
        self.assertEqual(r["detail"]["filled_from"], "client.texture_imagery mask")

    def test_unknown_source_not_scored(self):
        m = {"layers": {"client.texture_imagery": {"source": "something_new", "resolution_m": 2.5}}}
        self.assertFalse(sc.score_ground_texture(m)["scored"])


class Water(unittest.TestCase):
    def test_lengths(self):
        ch = {"features": [
            {"properties": {"source": "dem", "nhd_matched": True, "length_m": 6000}},
            {"properties": {"source": "nhd", "nhd_matched": True, "length_m": 1000}},
            {"properties": {"source": "dem", "nhd_matched": False, "length_m": 3000}},
        ]}
        r = sc.score_water(ch, manifest_doc())
        sh = r["shares"]   # confirmed 7 km, DEM only 3 km, mapped and undrawn 10 - 7 - 1 = 2 km
        self.assertAlmostEqual(sh["measured"], round(7 / 12, 4))
        self.assertAlmostEqual(sh["ruled"], 0.25)
        self.assertAlmostEqual(sh["blank"], round(2 / 12, 4))
        self.assertEqual(r["detail"]["width_rule"], "1.6*A^0.45 clamp 1-30")

    def test_no_mapped_length(self):
        ch = {"features": [{"properties": {"source": "dem", "length_m": 1000}}]}
        r = sc.score_water(ch, {"layers": {"hydro.channels": {"stats": {}}}})
        self.assertEqual(r["shares"]["ruled"], 1.0)
        self.assertTrue(r["not_scored"])


def animals_doc():
    return {"at": "2026-11-09T00:00:00Z",
            "classes": {"bird": 150, "mammal": 80, "reptile": 30, "amphibian": 30, "fish": 30, "invertebrate": 20},
            "generated_traits": ["uta_stansburiana"],
            "animals": [
                {"id": "corvus_corax", "kind": "bird", "records": 1000, "listed": True},
                {"id": "odocoileus_hemionus", "kind": "mammal", "records": 50, "listed": True},
                {"id": "uta_stansburiana", "kind": "reptile", "records": 4},
                {"id": "lynx_rufus", "kind": "mammal", "records": 0, "listed": True},
                {"id": "not_listed", "kind": "bird", "records": 9, "listed": False},
            ],
            "all_records": [{"id": "corvus_corax", "kind": "bird"}, {"id": "x", "kind": "invertebrate"}]}


class Animals(unittest.TestCase):
    def test_shares_and_kinds(self):
        reg = {"species": {"Corvus corax": {"id": "corvus_corax", "fidelity": 4},
                           "Odocoileus hemionus": {"id": "odocoileus_hemionus", "fidelity": 0}}}
        tile_reg = {"animals": [{"id": "uta_stansburiana", "fidelity": 3, "present": "records"}]}
        r = sc.score_animals(animals_doc(), reg, tile_reg)
        sh = r["shares"]
        self.assertAlmostEqual(sh["measured"], 0.5)   # raven, deer
        self.assertAlmostEqual(sh["ruled"], 0.25)     # bobcat: no records on the tile
        self.assertAlmostEqual(sh["guessed"], 0.25)   # generated traits
        d = r["detail"]
        self.assertEqual(d["listed"], 4)
        self.assertIn("fish", d["kinds_with_none"])
        self.assertIn("invertebrate", d["kinds_with_none"])
        self.assertEqual(d["registry_levels"], {"0": 1, "3": 1, "4": 1, "not known": 1})
        self.assertEqual(d["registry_level_not_known"], ["lynx_rufus"])
        self.assertFalse(d["status"]["status_field"])
        self.assertEqual(d["status"]["note"], "no status field in this build")
        self.assertEqual((d["status"]["introduced"], d["status"]["restored"], d["status"]["status_unknown"]), (0, 0, 4))
        texts = [f["text"] for f in r["findings"]]
        self.assertIn("no fish species listed (none in the tile's GBIF records)", texts)
        self.assertIn("no invertebrate species listed (1 in the records, none listed)", texts)

    def test_status_field_when_present(self):
        doc = animals_doc()
        doc["animals"][0]["status"] = "native"
        doc["animals"][1]["status"] = "introduced"
        doc["animals"][3]["status"] = "restored"
        d = sc.score_animals(doc, None, None)
        st = d["detail"]["status"]
        self.assertTrue(st["status_field"])
        self.assertNotIn("note", st)
        self.assertEqual((st["introduced"], st["restored"], st["status_unknown"], st["native"]), (1, 1, 1, 1))
        self.assertEqual(st["introduced_ids"], ["odocoileus_hemionus"])
        self.assertEqual(st["restored_ids"], ["lynx_rufus"])
        texts = [f["text"] for f in d["findings"]]
        self.assertTrue(any("are introduced" in t for t in texts))
        self.assertTrue(any("have no native status" in t for t in texts))

    def test_bodies(self):
        fauna = {"allow": ["corvus_corax"],
                 "slots": [{"code": "odocoileus_hemionus", "model": {"path": "fauna/odocoileus_hemionus.glb"}, "kin": "x"},
                           {"code": "uta_stansburiana", "model": None, "kin": "sceloporus_occidentalis"}],
                 "skipped": [{"id": "lynx_rufus", "why": "over the 40-slot cap"}]}
        r = sc.score_animal_bodies(animals_doc(), fauna)
        self.assertEqual(r["shares"], {"measured": 0.5, "ruled": 0.0, "guessed": 0.25, "blank": 0.25})
        self.assertEqual(r["detail"]["not_drawn_why"], {"over the 40-slot cap": 1})

    def test_no_fauna(self):
        self.assertFalse(sc.score_animal_bodies(animals_doc(), None)["scored"])


class Card(unittest.TestCase):
    def _tile(self, root: Path, judge=None) -> Path:
        t = root / "utm12n_396_3988"
        (t / "client").mkdir(parents=True)
        (t / "species").mkdir()
        (t / "hydro").mkdir()
        (t / "manifest.json").write_text(json.dumps(manifest_doc()))
        (t / "client" / "species_mix.json").write_text(json.dumps(mix_doc()))
        (t / "species" / "animals.json").write_text(json.dumps(animals_doc()))
        (t / "client" / "fauna.json").write_text(json.dumps({"allow": ["corvus_corax"], "slots": [], "skipped": []}))
        (t / "hydro" / "channels.geojson").write_text(json.dumps(
            {"features": [{"properties": {"source": "dem", "nhd_matched": True, "length_m": 8000}}]}))
        if judge is not None:
            (t / "judge").mkdir()
            (t / "judge" / "held_out.json").write_text(json.dumps(judge))
        return t

    def test_card_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            t = self._tile(Path(d), judge={"composition": {"precision": 0.4}})
            card = sc.write(t, library_registry={"species": {}})
            on_disk = json.loads((t / "scorecard.json").read_text())
            self.assertEqual(on_disk, json.loads(json.dumps(card)))
            self.assertEqual(card["name"], "Grand Canyon")
            for name in sc.LAYERS:
                layer = card["layers"][name]
                self.assertIn("definition", layer)
                for k in sc.SHARES:
                    self.assertIn(k, layer["definition"])
                if layer.get("scored") and layer.get("shares"):
                    self.assertEqual(_sum(layer["shares"]), 1.0, name)
            self.assertEqual(card["judge"]["held_out"], {"composition": {"precision": 0.4}})
            self.assertNotIn("lidar_stats", card["built_from"])
            # ranked by share, ruled shares at half weight
            fs = card["findings"]
            scores = [sc.rank_score(f) for f in fs]
            self.assertEqual(scores, sorted(scores, reverse=True))
            self.assertEqual(fs[0]["text"], "no ground species at all")
            md = sc.summary_markdown([card])
            self.assertIn("| Grand Canyon (`utm12n_396_3988`) |", md)
            self.assertIn("measured / ruled / guessed / blank", md)
            self.assertIn("| Grand Canyon | 5% | no status field in this build (4 unknown) |", md)
            # deterministic: the same documents give the same card
            self.assertEqual(sc.scorecard(t, library_registry={"species": {}}), card)

    def test_no_judge(self):
        with tempfile.TemporaryDirectory() as d:
            card = sc.scorecard(self._tile(Path(d)), library_registry={"species": {}})
            self.assertIsNone(card["judge"]["held_out"])

    def test_manifest_in_memory_wins(self):
        with tempfile.TemporaryDirectory() as d:
            t = self._tile(Path(d))
            m = manifest_doc()
            m["layers"]["terrain.dem"]["stats"]["valid_fraction"] = 0.5
            card = sc.scorecard(t, library_registry={"species": {}}, manifest=m)
            self.assertAlmostEqual(card["layers"]["terrain"]["shares"]["blank"], 0.5)


class Step(unittest.TestCase):
    def test_in_graph(self):
        from pipeline import steps
        s = steps.STEPS["scorecard"]
        self.assertEqual(s.stage, "games")
        for d in ("species_mix", "animals", "channels", "lidar", "registry", "inpaint"):
            self.assertIn(d, s.after)
        self.assertNotIn("audit", s.after)
        self.assertIn("scorecard", steps.STEPS["audit"].after)
        self.assertEqual(steps.ORDER[-2:], ["scorecard", "audit"])


if __name__ == "__main__":
    unittest.main()
