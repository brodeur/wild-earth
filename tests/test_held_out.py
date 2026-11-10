"""The held-out judge's scoring functions on fixtures (tools/probes/held_out.py; docs/held-out-judge.md). No network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "probes"))

import checklist  # noqa: E402
import composition  # noqa: E402
import e00  # noqa: E402
import eye_level  # noqa: E402
import held_out  # noqa: E402
import judge_common as jc  # noqa: E402


def rec(i, name, occ="Present", nat="Native", ab="Common", fam="Sciuridae", syn=(), tags=None, otags=None, common=""):
    return {"Id": i, "ScientificName": name, "Occurrence": occ, "Nativeness": nat, "Abundance": ab, "Family": fam,
            "Synonyms": [{"ScientificName": s} for s in syn], "NPSTags": tags, "OccurrenceTags": otags,
            "CommonNames": common}


class Names(unittest.TestCase):
    def test_binomial(self):
        self.assertEqual(jc.binomial("Juniperus osteosperma (Torr.) Little"), "juniperus osteosperma")
        self.assertEqual(jc.binomial("Hordeum murinum ssp. glaucum"), "hordeum murinum")
        self.assertIsNone(jc.binomial("Echinocereus"))
        self.assertIsNone(jc.binomial(None))

    def test_genus_and_id(self):
        self.assertEqual(jc.genus("pinus_sabiniana"), "pinus")
        self.assertEqual(jc.genus("Abies concolor"), "abies")
        self.assertEqual(jc.id_to_name("sambucus_nigra_caerulea"), "Sambucus nigra caerulea")

    def test_epithet_stem_survives_a_gender_change(self):
        self.assertEqual(jc.epithet_stem("picoides villosus"), jc.epithet_stem("leuconotopicus villosa"))


class Checklist(unittest.TestCase):
    PARK = [
        rec(1, "Sciurus aberti", common="Abert's Squirrel"),
        rec(2, "Cervus elaphus", nat="Non-native", fam="Cervidae", syn=["Cervus canadensis"]),
        rec(3, "Ovis canadensis", ab="Uncommon", fam="Bovidae"),
        rec(4, "Ursus arctos", occ="Not In Park", fam="Ursidae", otags="Historical"),
        rec(5, "Picoides villosus", fam="Picidae"),
        rec(6, "Neotamias dorsalis", ab="Abundant", common="Cliff Chipmunk"),
        rec(7, "Aphelocoma californica", fam="Corvidae"),
        rec(8, "Lasiurus cinereus", fam="Vespertilionidae", tags="Vagrant"),
    ]

    def test_status(self):
        self.assertEqual(checklist.status(self.PARK[0]), "present_native")
        self.assertEqual(checklist.status(self.PARK[1]), "non_native")
        self.assertEqual(checklist.status(self.PARK[3]), "not_present")
        self.assertEqual(checklist.status(rec(9, "X y", occ="Present", otags="False Report")), "not_present")
        self.assertEqual(checklist.status(rec(9, "X y", nat="Unknown")), "present_unknown_origin")
        self.assertEqual(checklist.status(rec(9, "X y", occ=None)), "unreviewed")

    def test_index_takes_synonyms_and_the_best_standing(self):
        idx = checklist.index(self.PARK + [rec(10, "Sciurus aberti kaibabensis", occ="Unconfirmed")])
        self.assertEqual(idx["cervus canadensis"]["Id"], 2)
        self.assertEqual(idx["sciurus aberti"]["Id"], 1)          # the present record, not the unconfirmed subspecies

    def test_match_by_family_epithet_and_by_split(self):
        idx = checklist.index(self.PARK)
        r, how = checklist.match(["Leuconotopicus villosus"], "Picidae", idx, self.PARK)
        self.assertEqual((r["Id"], how), (5, "epithet in the same family"))
        r, how = checklist.match(["Aphelocoma woodhouseii"], "Corvidae", idx, self.PARK)
        self.assertEqual((r["Id"], how), (7, "taxonomic split or lump"))
        self.assertEqual(checklist.match(["Leuconotopicus villosus"], "Sciuridae", idx, self.PARK), (None, None))
        r, how = checklist.match(["Nomen novum"], None, idx, self.PARK, synonyms=lambda b: ["ovis canadensis"])
        self.assertEqual((r["Id"], how), (3, "GBIF synonym"))

    def test_group_scores_and_named_errors(self):
        drawn = [{"name": "Sciurus aberti", "id": "sciurus_aberti", "spawned": True},
                 {"name": "Cervus canadensis", "id": "cervus_canadensis", "spawned": True},
                 {"name": "Ursus arctos", "id": "ursus_arctos"},
                 {"name": "Sciurus griseus", "id": "sciurus_griseus"}]
        r = checklist.score_group(drawn, self.PARK)
        self.assertEqual(r["drawn"], 4)
        self.assertEqual(r["precision"], 0.25)
        self.assertEqual(r["classes"], {"present_native": 1, "present_unknown_origin": 0, "non_native": 1,
                                        "unreviewed": 0, "not_present": 1, "not_on_list": 1})
        kinds = {(e["kind"], e["species"]) for e in r["errors"]}
        self.assertIn(("non_native", "Cervus canadensis"), kinds)
        self.assertIn(("not_present", "Ursus arctos"), kinds)
        self.assertIn(("not_on_list", "Sciurus griseus"), kinds)
        self.assertTrue(next(e for e in r["errors"] if e["kind"] == "not_on_list")["genus_on_list"])
        # recall: the list's present, native, Abundant or Common species, vagrants left out: ids 1, 5, 6, 7
        self.assertEqual((r["list_common_native"], r["of_them_drawn"], r["recall"]), (4, 1, 0.25))
        absent = [e["species"] for e in r["errors"] if e["kind"] == "expected_absent"]
        self.assertEqual(absent[0], "Neotamias dorsalis")          # the abundant one first
        self.assertNotIn("Lasiurus cinereus", absent)              # a vagrant is not expected
        self.assertNotIn("Ovis canadensis", absent)                # nor an uncommon species

    def test_what_the_list_has_not_decided_is_left_out_of_precision(self):
        park = [rec(1, "Tamias minimus", occ=None, nat=None), rec(2, "Sciurus aberti"), rec(3, "Mus musculus", nat="Unknown")]
        r = checklist.score_group([{"name": "Tamias minimus"}, {"name": "Sciurus aberti"}, {"name": "Mus musculus"}], park)
        self.assertEqual((r["drawn"], r["judged"], r["precision"]), (3, 1, 1.0))
        self.assertFalse([e for e in r["errors"] if e["kind"] != "expected_absent"])

    def test_an_old_name_left_unreviewed_does_not_hide_the_current_record(self):
        park = [rec(1, "Tamias minimus", occ=None, nat=None, ab=None), rec(2, "Neotamias minimus", ab="Abundant"),
                rec(3, "Junco hyemalis oreganus", fam="Passerellidae", ab="Abundant"),
                rec(4, "Junco hyemalis", fam="Passerellidae")]
        r = checklist.score_group([{"name": "Tamias minimus", "family": "Sciuridae"},
                                   {"name": "Junco hyemalis", "family": "Passerellidae"}], park)
        self.assertEqual((r["judged"], r["precision"]), (2, 1.0))
        self.assertEqual((r["list_common_native"], r["of_them_drawn"], r["expected_absent"]), (2, 2, 0))

    def test_a_group_with_nothing_drawn_is_named(self):
        r = checklist.score_group([], [rec(1, "Gila cypha", fam="Cyprinidae", common="Humpback Chub")])
        self.assertIsNone(r["precision"])
        self.assertEqual(r["recall"], 0.0)
        self.assertEqual(r["errors"][0]["kind"], "group_absent")
        self.assertEqual(r["errors"][0]["examples"], ["Humpback Chub"])

    def test_score_plants_by_share_and_animals_together(self):
        park = {"mammal": self.PARK, "fish": [rec(20, "Gila cypha", fam="Cyprinidae")],
                "plant": [rec(30, "Pinus ponderosa", ab=None, fam="Pinaceae"),
                          rec(31, "Bromus tectorum", nat="Non-native", ab=None, fam="Poaceae")]}
        drawn = {"mammal": [{"name": "Sciurus aberti", "id": "a", "spawned": True},
                            {"name": "Sciurus griseus", "id": "b", "spawned": False}],
                 "plant": [{"name": "Pinus ponderosa", "id": "pinus_ponderosa", "layer": "canopy", "drawn_share": 0.6},
                           {"name": "Pinus sabiniana", "id": "pinus_sabiniana", "layer": "canopy", "drawn_share": 0.4},
                           {"name": "Bromus tectorum", "id": "bromus_tectorum", "layer": "ground", "drawn_share": 1.0}]}
        r = checklist.score(drawn, park)
        s = r["scores"]
        self.assertEqual(s["animal_precision"], 0.5)
        self.assertEqual(s["plant_precision"], round(1 / 3, 4))
        self.assertEqual(s["plant_precision_by_share"], {"canopy": 0.6, "ground": 0.0})
        self.assertEqual(s["groups_absent"], ["fish"])
        self.assertEqual(r["groups"]["mammal"]["spawned_precision"], 1.0)
        self.assertNotIn("recall", r["groups"]["plant"])            # no abundance on the plant list
        self.assertTrue(all("group" in e for e in r["errors"]))


class Composition(unittest.TestCase):
    MIX = {"mixes": [
        {"cells": 100, "density_bytes": [100, 50], "tree_bytes": [["pinus_sabiniana", 255]],
         "shrub_bytes": [["adenostoma_fasciculatum", 255]], "ground_bytes": []},
        {"cells": 300, "density_bytes": [100, 100], "tree_bytes": [["pinus_ponderosa", 170], ["juniperus_grandis", 85]],
         "shrub_bytes": [["artemisia_tridentata", 255]], "ground_bytes": []}]}

    def test_drawn_shares(self):
        d = composition.drawn_shares(self.MIX)
        self.assertAlmostEqual(d["canopy"]["pinus_ponderosa"], 0.5)
        self.assertAlmostEqual(d["canopy"]["pinus_sabiniana"], 0.25)
        self.assertAlmostEqual(d["shrub"]["artemisia_tridentata"], 300 / 350)
        self.assertEqual(d["ground"], {})
        self.assertAlmostEqual(sum(d["canopy"].values()), 1.0)
        self.assertAlmostEqual(composition.genus_shares(d["canopy"])["pinus"], 0.75)

    def test_bray_curtis(self):
        self.assertEqual(composition.bray_curtis({"a": 1}, {"a": 3}), 0.0)        # shares, not amounts
        self.assertEqual(composition.bray_curtis({"a": 1}, {"b": 1}), 1.0)
        self.assertEqual(composition.bray_curtis({"a": 0.5, "b": 0.5}, {"a": 1.0}), 0.5)
        self.assertEqual(composition.bray_curtis({}, {"a": 1}), 1.0)
        self.assertIsNone(composition.bray_curtis({}, {}))

    def test_score_names_foreign_missing_and_empty(self):
        d = composition.drawn_shares(self.MIX)
        ref = {"kind": "plots", "known": ["pinus", "juniperus", "coleogyne", "artemisia", "hilaria"],
               "layers": {"canopy": {"pinus": 6.0, "juniperus": 4.0}, "shrub": {"coleogyne": 8.0, "artemisia": 2.0},
                          "ground": {"hilaria": 5.0}}}
        r = composition.score(d, ref)
        self.assertEqual(r["scores"]["bray_curtis"]["canopy"], 0.15)
        self.assertEqual(r["scores"]["foreign_share"]["canopy"], 0.0)              # the genus is right, the species not
        self.assertEqual(r["scores"]["foreign_share"]["shrub"], round(50 / 350, 4))
        self.assertEqual(r["scores"]["bray_curtis"]["ground"], 1.0)
        self.assertIsNone(r["scores"]["foreign_share"]["ground"])
        kinds = {(e["kind"], e["layer"], e.get("genus")) for e in r["errors"]}
        self.assertIn(("foreign_genus", "shrub", "adenostoma"), kinds)
        self.assertIn(("missing_genus", "shrub", "coleogyne"), kinds)
        self.assertIn(("empty_layer", "ground", None), kinds)

    def test_named_dominants_score_no_foreign_share(self):
        d = composition.drawn_shares(self.MIX)
        r = composition.score(d, {"kind": "mapped_dominants", "known": [], "layers": {"canopy": {"pinus": 1.0},
                                                                                     "shrub": {"artemisia": 1.0}, "ground": {}}})
        self.assertIsNone(r["scores"]["foreign_share"]["shrub"])
        self.assertFalse([e for e in r["errors"] if e["kind"] == "foreign_genus"])
        self.assertIsNone(r["scores"]["bray_curtis"]["ground"])                    # nothing on either side: not scored

    def test_a_genus_under_two_names_is_one(self):
        r = composition.score_layer({"pseudoroegneria_spicata": 1.0}, {"agropyron": 3.0}, {"agropyron"})
        self.assertEqual(r["bray_curtis"], 0.0)
        self.assertEqual(r["foreign_share"], 0.0)

    def _tables(self):
        plots = [{"Plot_Code": f"P{i}", "Public_X": x, "Public_Y": y} for i, (x, y) in
                 enumerate([(100, 100), (200, 200), (300, 300), (1500, 500), (5000, 5000)])]
        events = [{"Plot_Event": f"P{i}_01", "Plot_Code": f"P{i}", "Observation_pt": 0, "Provisional_Community": "c"}
                  for i in range(5)]
        events[2]["Observation_pt"] = 1
        species = {"PIED": "Pinus edulis", "CORA": "Coleogyne ramosissima", "HIJA": "Pleuraphis jamesii", "U": "Unknown",
                   "YUBA": "Yucca baccata"}
        cover = [{"Plot_Event": "P0_01", "Stratum": "T2", "Spp_Code": "PIED", "Real_Cover": 20},
                 {"Plot_Event": "P0_01", "Stratum": "S2", "Spp_Code": "PIED", "Real_Cover": 5},     # saplings
                 {"Plot_Event": "P0_01", "Stratum": "S3", "Spp_Code": "CORA", "Real_Cover": 10},
                 {"Plot_Event": "P1_01", "Stratum": "S2", "Spp_Code": "CORA", "Real_Cover": 30},
                 {"Plot_Event": "P1_01", "Stratum": "H", "Spp_Code": "HIJA", "Real_Cover": 4},
                 {"Plot_Event": "P1_01", "Stratum": "H", "Spp_Code": "U", "Real_Cover": 9},
                 {"Plot_Event": "P1_01", "Stratum": "N", "Spp_Code": "HIJA", "Real_Cover": 50},     # not a judged stratum
                 {"Plot_Event": "P2_01", "Stratum": "S1", "Spp_Code": "YUBA", "Real_Cover": 40},    # observation point
                 {"Plot_Event": "P3_01", "Stratum": "S1", "Spp_Code": "YUBA", "Real_Cover": 6},     # 500 m outside
                 {"Plot_Event": "P4_01", "Stratum": "T1", "Spp_Code": "PIED", "Real_Cover": 80}]    # far away
        return plots, events, cover, species

    def test_plots_reference(self):
        plots, events, cover, species = self._tables()
        ref = composition.plots_reference(plots, events, cover, species, (0, 0, 1000, 1000), min_plots=2,
                                          presence_buffer=1000)
        self.assertEqual((ref["plots"], ref["buffer_m"]), (2, 0))
        self.assertEqual(ref["layers"]["canopy"], {"pinus": 10.0})
        self.assertEqual(ref["layers"]["shrub"], {"coleogyne": 20.0})               # pine saplings left out
        self.assertEqual(ref["tree_regeneration_cover_pct"]["shrub"], 2.5)
        self.assertEqual(ref["layers"]["ground"], {"pleuraphis": 2.0})              # 'Unknown' is no taxon
        self.assertIn("yucca", ref["known"])                                        # observation point and near plot
        self.assertNotIn("unknown", ref["known"])

    def test_plots_reference_widens_when_plots_are_few(self):
        plots, events, cover, species = self._tables()
        ref = composition.plots_reference(plots, events, cover, species, (0, 0, 1000, 1000), min_plots=3,
                                          max_buffer=3000)
        self.assertEqual((ref["plots"], ref["buffer_m"]), (3, 1000))
        self.assertEqual(ref["layers"]["shrub"]["yucca"], 2.0)

    def test_habitat_type_names(self):
        t = composition.habitat_taxa("Abies lasiocarpa/Vaccinium scoparium-V. scoparium")
        self.assertEqual(t, {"shrub": ["vaccinium"], "ground": []})
        t = composition.habitat_taxa("Artemisia tridentata/Festuca idahoensis-Geranium viscosissimum")
        self.assertEqual(t, {"shrub": ["artemisia"], "ground": ["festuca", "geranium"]})
        t = composition.habitat_taxa("Festuca idahoensis/Agropyron spicatum")
        self.assertEqual(t["ground"], ["festuca", "elymus"])                        # Pseudoroegneria, with the wheatgrasses
        self.assertEqual(composition.habitat_taxa("Willow/Sedge"), {"shrub": ["salix"], "ground": ["carex"]})
        self.assertEqual(composition.habitat_taxa("Wet forests, Talus"), {"shrub": [], "ground": []})

    def test_cover_codes_and_the_maps_reference(self):
        self.assertEqual(composition.cover_code_trees("lp2"), {"pinus": 1.0})
        self.assertEqual(composition.cover_code_trees("df/nf"), {"pseudotsuga": 0.5})
        self.assertEqual(composition.cover_code_trees("wb/sf"), {"pinus": 0.5, "picea": 0.25, "abies": 0.25})
        self.assertEqual(composition.cover_code_trees("nf"), {})
        ref = composition.maps_reference([("df", 300.0), ("nf", 600.0), ("lp0", 100.0)],
                                         [("Artemisia tridentata/Festuca idahoensis", 600.0),
                                          ("Pseudotsuga menziesii/Symphoricarpos albus", 400.0)])
        self.assertEqual(ref["kind"], "mapped_dominants")
        self.assertEqual(ref["layers"]["canopy"], {"pseudotsuga": 0.3, "pinus": 0.1})
        self.assertEqual(ref["layers"]["shrub"], {"artemisia": 0.6, "symphoricarpos": 0.4})
        self.assertEqual(ref["layers"]["ground"], {"festuca": 0.6})
        self.assertEqual(ref["forest_share_of_tile"], 0.4)


def _e00_text():
    f = lambda v: f"{v: .14E}"                                                      # noqa: E731
    sq = [(0, 0), (0, 100), (100, 100), (100, 0), (0, 0)]
    lines = ["EXP  0 TINY.E00", "ARC  3", "".join(f"{v:10d}" for v in (1, 1, 1, 1, 1, 2, 5))]
    lines += [f(x) + f(y) for x, y in sq]
    lines += ["".join(f"{v:10d}" for v in (-1, 0, 0, 0, 0, 0, 0)), "PAL  3"]
    for arcs in ([0, -1], [1]):
        lines.append(f"{len(arcs):10d}" + f(0) + f(0))
        lines.append(f(100) + f(100))
        for k in range(0, len(arcs), 2):
            lines.append("".join(f"{a:10d}{0:10d}{0:10d}" for a in arcs[k:k + 2]))
    lines += ["".join(f"{v:10d}" for v in (-1, 0, 0, 0, 0, 0, 0)), "IFO  3",
              f"{'TINY.PAT':<32}XX   3   3  22{2:10d}",
              f"{'AREA':<16}  8-1   14-1  18 5 60-1  -1  -1-1                   1-",
              f"{'TINY#':<16}  4-1   94-1   5-1 50-1  -1  -1-1                   2-",
              f"{'CATEGORY':<16} 10-1  134-1  10-1 20-1  -1  -1-1                   3-"]
    for area, k, cat in ((-10000.0, 1, ""), (10000.0, 2, "df/nf")):
        lines.append((f"{area: .17E}" + f"{k:11d}" + f"{cat:<10}").rstrip())
    return "\r\n".join(lines + ["EOI", "EOS"]) + "\r\n"


class E00(unittest.TestCase):
    def test_reads_arcs_polygons_and_the_attribute_table(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "tiny.e00"
            p.write_bytes(_e00_text().encode())
            cov = e00.read(p)
        self.assertEqual(len(cov["arcs"][1]), 5)
        self.assertEqual(len(cov["pal"]), 2)
        self.assertEqual(cov["pat"][1], {"AREA": 10000.0, "TINY#": 2, "CATEGORY": "df/nf"})
        self.assertAlmostEqual(e00.polygon(cov, 2).area, 10000.0)
        got = e00.areas_in_box(cov, (50, 50, 200, 200))
        self.assertEqual([(r["CATEGORY"], a) for r, a in got], [("df/nf", 2500.0)])
        self.assertEqual(e00.areas_in_box(cov, (500, 500, 600, 600)), [])

    def test_refuses_a_compressed_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.e00"
            p.write_text("EXP  1 X.E00\n")
            self.assertRaises(ValueError, e00.read, p)


def _scene(sky_rows, land_rgb, h=213, w=320):
    im = np.zeros((h, w, 3), dtype=np.float32)
    im[:sky_rows] = (0.55, 0.7, 0.95)
    im[sky_rows:] = land_rgb
    return im


class EyeLevel(unittest.TestCase):
    def test_sky_is_reached_from_the_top_only(self):
        im = _scene(71, (0.2, 0.45, 0.15))
        im[150:160, 100:140] = (0.6, 0.75, 0.95)                   # a pond the colour of sky, below the land
        s = eye_level.stats(im)
        self.assertEqual(s["sky"], [1.0, 0.0, 0.0])
        self.assertIsNone(s["green"][0])                           # no land in the top band
        self.assertGreater(s["green"][1], 0.9)
        self.assertEqual(len(s["skyline"]), eye_level.COLS)

    def test_the_same_picture_is_distance_zero_and_a_brown_one_is_not(self):
        green, brown = eye_level.stats(_scene(71, (0.2, 0.45, 0.15))), eye_level.stats(_scene(71, (0.5, 0.4, 0.3)))
        same = eye_level.pair_distance(green, green)
        self.assertEqual((same["distance"], same["delta_e"], same["sky_diff"]), (0.0, 0.0, 0.0))
        d = eye_level.pair_distance(green, brown)
        self.assertEqual(d["sky_diff"], 0.0)
        self.assertGreater(d["green_diff"], 0.9)
        self.assertGreater(d["delta_e"], 20)
        self.assertGreater(d["lightness_bias"], 0)                 # the render (second) is the lighter
        self.assertGreater(d["distance"], 0.4)

    def test_the_bearing_and_tilt_are_chosen_by_skyline_alone(self):
        photo = eye_level.stats(_scene(71, (0.2, 0.45, 0.15)))
        cands = {(0, 0.0): eye_level.skyline(_scene(150, (0.2, 0.45, 0.15))),  # the right colour, the wrong horizon
                 (90, 0.5): eye_level.skyline(_scene(71, (0.5, 0.4, 0.3))),    # the right horizon, the wrong colour
                 (90, 0.0): eye_level.skyline(_scene(71, (0.5, 0.4, 0.3))),    # the same, level: wins the tie
                 (45, 0.0): eye_level.skyline(_scene(71, (0.5, 0.4, 0.3)))}    # the same, a lower bearing: wins that tie
        self.assertEqual(eye_level.choose(photo, cands), (45, 0.0))
        del cands[(45, 0.0)]
        self.assertEqual(eye_level.choose(photo, cands), (90, 0.0))

    def test_the_window_of_a_tall_render(self):
        box, tilt = eye_level.window((1280, 853), 75.0, 0.0)
        self.assertEqual(tilt, 0.0)
        self.assertAlmostEqual((box[3] - box[1]) / 853, 0.5398, places=2)      # tan(22.5) / tan(37.5)
        self.assertAlmostEqual((box[2] - box[0]) / (box[3] - box[1]), 1.5, places=2)
        down, tilt_down = eye_level.window((1280, 853), 75.0, 1.0)
        self.assertEqual(down[3], 853)
        self.assertAlmostEqual(tilt_down, 19.4, places=0)
        self.assertEqual(eye_level.window((1280, 853), 75.0, -1.0)[1], -tilt_down)

    def test_unplaced_pairs_stay_out_of_the_scores(self):
        a = eye_level.aggregate([{"distance": 0.2, "placed": True}, {"distance": 0.9, "placed": False}])
        self.assertEqual((a["pairs"], a["shown_unplaced"], a["distance_mean"]), (1, 1, 0.2))

    def test_aggregate(self):
        a = eye_level.aggregate([{"distance": 0.2, "delta_e": 10.0, "green_diff": 0.1, "sky_diff": 0.0,
                                  "lightness_bias": 4.0, "heading_known": True},
                                 {"distance": 0.4, "delta_e": None, "green_diff": None, "sky_diff": 0.4,
                                  "lightness_bias": None, "heading_known": False}])
        self.assertEqual((a["pairs"], a["distance_mean"], a["delta_e_mean"], a["headings_known"]), (2, 0.3, 10.0, 1))


class HeldOut(unittest.TestCase):
    def test_summary_and_the_old_judge_labelled(self):
        res = {"checks": {
            "species_lists": {"scores": {"animal_precision": 0.9, "animal_recall_common": 0.3, "plant_precision": 0.5,
                                         "plant_precision_by_share": {"canopy": 0.6}, "groups_absent": ["fish"]},
                              "errors": [{}, {}]},
            "composition": {"scores": {"bray_curtis": {"canopy": 0.2}, "foreign_share": {"canopy": 0.0}}, "errors": [{}]},
            "eye_level": {"status": "no photos"}, "colour_from_above": {"scores": {"overlap": 0.26}}}}
        s = held_out.summary(res)
        self.assertEqual(s["animal_precision"], 0.9)
        self.assertEqual(s["composition_bray_curtis"], {"canopy": 0.2})
        self.assertEqual(s["colour_from_above_overlap"], 0.26)
        self.assertIsNone(s["eye_level_distance"])
        self.assertEqual(s["named_errors"], 3)

    def test_colour_from_above_is_not_held_out(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "satellite_stats.json"
            p.write_text(json.dumps({"gcanyon": {"overlap": 0.268, "overlap_fair": 0.26, "L_render": 53.6, "L_fair": 64.3}}))
            c = held_out.colour_check("utm12n_396_3988", str(p), None)
        self.assertFalse(c["held_out"])
        self.assertEqual(c["scores"]["overlap"], 0.26)
        self.assertEqual(held_out.colour_check("utm11n_270_4180", None, None)["status"], "not run")

    def test_structure_is_deferred_with_what_it_needs(self):
        self.assertEqual(held_out.STRUCTURE["status"], "deferred")
        self.assertTrue(any("Earthdata" in n for n in held_out.STRUCTURE["needs"]))

    def test_every_tile_in_parks_json_names_its_sources(self):
        for tile, cfg in jc.parks().items():
            if tile.startswith("_"):
                continue
            self.assertRegex(cfg["park"], r"^[A-Z]{4}$")
            if "composition" in cfg:
                self.assertIn(cfg["composition"]["kind"], ("vmi_plots", "yell_maps"))
                self.assertTrue(cfg["composition"]["licence"] and cfg["composition"]["citation"])


if __name__ == "__main__":
    unittest.main()
