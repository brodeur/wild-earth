"""The tile pipeline's graph, regions and generators, offline (docs/pipeline.md).

    arch -arm64 .venv/bin/python -m unittest tests.test_pipeline
"""
import csv
import io
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestStages(unittest.TestCase):
    def test_stages_in_order_and_never_read_later(self):
        from pipeline import steps
        order = [steps.STAGES.index(steps.STEPS[n].stage) for n in steps.ORDER]
        self.assertEqual(order, sorted(order))
        for n in steps.ORDER:
            for d in steps.STEPS[n].after:
                self.assertLessEqual(steps.STAGES.index(steps.STEPS[d].stage), steps.STAGES.index(steps.STEPS[n].stage), (n, d))

    def test_old_names(self):
        from pipeline import steps
        self.assertEqual(steps.resolve_names(["veg", "derive"]), ["landcover", "terrain"])


class TestRegions(unittest.TestCase):
    PNW = ["pacific_northwest"]

    def test_no_california_rule_outside_california(self):
        from pipeline.species_mix import match
        r = match("North Pacific Lowland Riparian Forest", self.PNW)
        self.assertEqual(r["id"], "pnw_lowland_riparian")
        self.assertIsNone(match("California Lower Montane Blue Oak-Foothill Pine Woodland and Savanna", self.PNW))
        self.assertEqual(match("California Lower Montane Blue Oak-Foothill Pine Woodland and Savanna")["id"], "blue_oak_foothill_pine")

    def test_fallback_is_never_the_foothills_outside_california(self):
        from pipeline.species_mix import _fallback
        for code in range(1, 9):
            f = _fallback(code, self.PNW)
            self.assertTrue(f.get("pool"), f)
            self.assertFalse(f["trees"] or f["shrubs"])
            self.assertTrue(_fallback(code, []).get("pool"))

    def test_a_phrase_read_by_region(self):
        from pipeline.communities import named_species
        sierra = [s for s, _ in named_species("Sierra Nevada Alpine Dwarf-Shrubland", ["california"])]
        olympic = [s for s, _ in named_species("North Pacific Dry and Mesic Alpine Dwarf-Shrubland", self.PNW)]
        self.assertIn("phyllodoce_breweri", sierra)
        self.assertIn("phyllodoce_empetriformis", olympic)
        self.assertNotIn("phyllodoce_breweri", olympic)

    def test_every_north_pacific_community_is_read(self):
        p = ROOT / "pipeline" / "_cache" / "evt.csv"
        if not p.exists():
            self.skipTest("no LANDFIRE EVT table in pipeline/_cache (a tile build fetches it)")
        from pipeline.communities import named_species
        from pipeline.species_mix import match
        rows = list(csv.DictReader(io.StringIO(p.read_text(encoding="utf-8-sig"))))
        missed = [r["EVT_NAME"] for r in rows if r["EVT_NAME"].startswith("North Pacific")
                  and not match(r["EVT_NAME"], self.PNW) and not named_species(r["EVT_NAME"], self.PNW)]
        self.assertEqual(missed, [])

    def test_snow_and_ice_bare_anywhere(self):
        from pipeline.species_mix import match
        for regions in (self.PNW, ["california"], []):
            r = match("North American Glacier and Ice Field", regions)
            self.assertEqual(r["id"], "snow_ice")
            self.assertEqual(r["tree_density"], 0.0)


class TestGenerators(unittest.TestCase):
    def test_every_card_builds(self):
        from pipeline.plantgen import build, cards, load_card
        for sid in cards():
            rec = build(load_card(sid))
            self.assertEqual(rec["id"], sid)
            if load_card(sid).get("deciduous") is False and "leaf_on_by_month" in (rec.get("foliage") or {}):
                self.assertEqual(min(rec["foliage"]["leaf_on_by_month"]), 1.0, sid)

    def test_every_tree_research_record_makes_a_card(self):
        # pipeline/tree_cards.py: a research record -> a trait card that plantgen builds; a palm is flagged, never silent
        from pipeline.plantgen import build
        from pipeline.tree_cards import RESEARCH, card
        for p in sorted(RESEARCH.glob("*.json")):
            if p.stem.startswith("_"):
                continue
            c = card(json.loads(p.read_text()))
            self.assertEqual(c["id"], p.stem)
            self.assertTrue(c["sources"], p.stem)
            rec = build(c)
            self.assertGreater(rec["height_m"][1], rec["height_m"][0], p.stem)
            if (json.loads(p.read_text()).get("habit") or "").startswith("palm"):   # Corner's model, not a stand-in
                self.assertEqual(rec["architectural_model"], "Corner", p.stem)
                self.assertEqual(rec["palm"]["leaves"], c["palm"]["leaves"], p.stem)
                self.assertFalse(rec.get("levels"), p.stem)

    def test_the_olympic_species_have_cards(self):
        from pipeline.plantgen import card_path
        for sid in ("picea_sitchensis", "tsuga_heterophylla", "thuja_plicata", "acer_circinatum", "polystichum_munitum",
                    "abies_amabilis", "abies_lasiocarpa", "phyllodoce_empetriformis"):
            self.assertTrue(card_path(sid).exists(), sid)

    def test_animal_traits_from_the_taxon_alone(self):
        from pipeline import fauna
        fauna.trophic = lambda sci, family=None: None   # offline: no EltonTraits
        for sci, tax, plan in (
                ("Cervus canadensis", {"kingdom": "Animalia", "phylum": "Chordata", "class": "Mammalia", "order": "Artiodactyla",
                                       "family": "Cervidae", "genus": "Cervus"}, "quadruped"),
                ("Ariolimax columbianus", {"kingdom": "Animalia", "phylum": "Mollusca", "class": "Gastropoda",
                                           "order": "Stylommatophora", "family": "Ariolimacidae", "genus": "Ariolimax"}, "gastropod"),
                ("Tamiasciurus douglasii", {"kingdom": "Animalia", "phylum": "Chordata", "class": "Mammalia", "order": "Rodentia",
                                            "family": "Sciuridae", "genus": "Tamiasciurus"}, "rodent")):
            t = fauna.make_traits({"scientific": sci, "common": None, "kind": "mammal", "taxonomy": tax})
            self.assertEqual(t["body_plan"], plan)
            self.assertTrue(t["locomotion"])
            self.assertGreater(t["mass_kg"], 0)
        slug = fauna.make_traits({"scientific": "Ariolimax columbianus", "common": None, "kind": "invertebrate",
                                  "taxonomy": {"class": "Gastropoda", "family": "Ariolimacidae", "genus": "Ariolimax"}})
        self.assertLess(slug["locomotion"]["top_mps"], 0.01)


class TestBirdKin(unittest.TestCase):
    """A bird's kin by its way of life (pipeline/fauna_slots.py bird_life: AVONET lifestyle and flightlessness)."""

    def setUp(self):
        from pipeline import avonet
        if not (avonet.DIR / "ELEData.zip").exists():
            self.skipTest("AVONET not downloaded (pipeline/_cache/avonet)")

    def kin(self, sci, order, family, kg, role=("herbivore",)):
        from pipeline.fauna_slots import bird_life, kin_for
        a = {"scientific": sci, "kind": "bird", "mass_kg": kg, "role": list(role),
             "taxonomy": {"class": "Aves", "order": order, "family": family}}
        k, arch, _ = kin_for(a, {})
        return k, arch, bird_life(a, {})["flightless"]

    def test_ground_and_flightless(self):
        self.assertEqual(self.kin("Struthio camelus", "Struthioniformes", "Struthionidae", 111),
                         ("meleagris_gallopavo", "ground bird", True))
        self.assertEqual(self.kin("Vanellus armatus", "Charadriiformes", "Charadriidae", 0.156, ("insectivore",)),
                         ("callipepla_californica", "ground bird", False))

    def test_perching_aquatic_and_guilds_kept(self):
        self.assertEqual(self.kin("Cyanocitta stelleri", "Passeriformes", "Corvidae", 0.12, ("omnivore",))[0], "corvus_corax")
        self.assertEqual(self.kin("Parus major", "Passeriformes", "Paridae", 0.018, ("insectivore",))[0], "cyanocitta_stelleri")
        self.assertEqual(self.kin("Fratercula arctica", "Charadriiformes", "Alcidae", 0.4, ("predator",))[0], "mergus_merganser")
        self.assertEqual(self.kin("Sagittarius serpentarius", "Accipitriformes", "Sagittariidae", 4, ("predator",))[0], "buteo_jamaicensis")


class TestReptiles(unittest.TestCase):
    """A reptile's kin, way and build (pipeline/fauna_slots.py reptile_group, pipeline/fauna_models.py REPTILE_BUILD):
    GBIF's reptile classes are Squamata, Testudines and Crocodylia, with no order."""

    def slot(self, cls, fam, kg):
        from pipeline.fauna_slots import kin_for, reptile_way
        a = {"scientific": "X y", "kind": "reptile", "mass_kg": kg, "taxonomy": {"class": cls, "order": None, "family": fam}}
        k, arch, _ = kin_for(a, {})
        return k, arch, reptile_way(arch) if k else None

    def test_groups_and_ways(self):
        self.assertEqual(self.slot("Crocodylia", "Crocodylidae", 94), ("sceloporus_occidentalis", "crocodilian", "water"))
        self.assertEqual(self.slot("Testudines", "Testudinidae", 20), ("sceloporus_occidentalis", "tortoise", "walk"))
        self.assertEqual(self.slot("Squamata", "Varanidae", 2.8), ("sceloporus_occidentalis", "monitor lizard", "bask"))
        self.assertEqual(self.slot("Squamata", "Agamidae", 0.1), ("sceloporus_occidentalis", "basking lizard", "bask"))
        k, why, _ = self.slot("Squamata", "Viperidae", 2.4)
        self.assertIsNone(k)
        self.assertIn("snake", why)

    def test_density_falls_with_mass(self):
        from pipeline.fauna_slots import density_km2
        d = [density_km2({"mass_kg": m, "taxonomy": {"class": "Squamata"}}, "sceloporus_occidentalis", "basking lizard") for m in (0.014, 0.1, 2.8)]
        self.assertTrue(d[0] > d[1] > d[2])
        self.assertLess(density_km2({"mass_kg": 94, "taxonomy": {"class": "Crocodylia"}}, "sceloporus_occidentalis", "crocodilian"), 2)

    def test_choose_and_prompts(self):
        from pipeline import fauna_models as F
        fauna = {"slots": [
            {"code": "a_croc", "archetype": "crocodilian", "reptile": "water", "mass_kg": 94, "records": 151},
            {"code": "a_agama", "archetype": "basking lizard", "reptile": "bask", "mass_kg": 0.1, "records": 63},
            {"code": "a_tort", "archetype": "tortoise", "reptile": "walk", "mass_kg": 20, "records": 14},
            {"code": "a_monitor", "archetype": "monitor lizard", "reptile": "bask", "mass_kg": 2.8, "records": 10}]}
        pick, _ = F.choose(fauna, 120, kind="reptiles")
        # the most visible (records x sqrt(mass)) first, one per build archetype (a sprawler, a tortoise) before any second
        self.assertEqual([s["code"] for s in pick], ["a_croc", "a_tort", "a_agama", "a_monitor"])
        mesh, tex = F.prompts(fauna["slots"][0], "the Serengeti")
        self.assertIn("splayed", mesh)
        mesh, tex = F.prompts(fauna["slots"][2], "the Serengeti")
        self.assertIn("under the rim", mesh)


if __name__ == "__main__":
    unittest.main()
