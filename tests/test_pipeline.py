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

    def test_a_shrub_on_a_tree_template_shares_the_trees_branches(self):
        # 2026-11-06: a shrub card grown from a tree template keeps the template's level-1 count as the whole plant's
        # (treegen shares it among the stems) and takes no standing dead tree; a shrub on a shrub template is unchanged
        from pipeline.plantgen import build, cards, load_card, template_record
        for sid in cards():
            c = load_card(sid)
            if c.get("form") not in ("shrub", "multi_stem_shrub_tree") or not c.get("template"):
                continue
            rec, tree = build(c), template_record(c["template"]).get("form", "tree") == "tree"
            if rec.get("levels"):
                self.assertEqual(rec["levels"][0].get("count_of") == "plant", tree, sid)
            if tree:
                self.assertNotIn("snag", rec, sid)

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

    def kin(self, sci, order, family, kg, role=("herbivore",), diet=None):
        from pipeline.fauna_slots import bird_life, kin_for
        a = {"scientific": sci, "kind": "bird", "mass_kg": kg, "role": list(role),
             "taxonomy": {"class": "Aves", "order": order, "family": family, "genus": sci.split()[0]}}
        t = {"diet": {"diet_tenths": diet}} if diet else {}
        k, arch, _ = kin_for(a, t)
        return k, arch, bird_life(a, t)["flightless"]

    def test_ground_and_flightless(self):
        self.assertEqual(self.kin("Struthio camelus", "Struthioniformes", "Struthionidae", 111),
                         ("meleagris_gallopavo", "ground bird", True))
        # a lapwing of open short grass stays a ground bird; one of the wetland edge is a shorebird (2026-11-07)
        self.assertEqual(self.kin("Vanellus coronatus", "Charadriiformes", "Charadriidae", 0.17, ("insectivore",)),
                         ("callipepla_californica", "ground bird", False))
        self.assertEqual(self.kin("Vanellus armatus", "Charadriiformes", "Charadriidae", 0.156, ("insectivore",)),
                         ("ardea_herodias", "shorebird", False))

    def test_shorebirds(self):
        # the spotted sandpiper was a seed-scratching ground bird: AVONET Terrestrial, Wetland
        self.assertEqual(self.kin("Actitis macularius", "Charadriiformes", "Scolopacidae", 0.04, ("insectivore",))[:2],
                         ("ardea_herodias", "shorebird"))
        self.assertEqual(self.kin("Haematopus ostralegus", "Charadriiformes", "Haematopodidae", 0.5, ("insectivore",))[:2],
                         ("ardea_herodias", "shorebird"))
        # a woodcock of the forest floor is no shorebird
        self.assertEqual(self.kin("Scolopax minor", "Charadriiformes", "Scolopacidae", 0.2, ("insectivore",))[1], "ground bird")

    def test_raptors_and_scavengers(self):
        # the golden eagle kills nine tenths of what it eats: a raptor, whatever its scavenger role (2026-11-07)
        self.assertEqual(self.kin("Aquila chrysaetos", "Accipitriformes", "Accipitridae", 4.2, ("predator", "scavenger"),
                                  {"vend": 8, "vect": 1, "scav": 1})[:2], ("buteo_jamaicensis", "soaring raptor"))
        self.assertEqual(self.kin("Haliaeetus albicilla", "Accipitriformes", "Accipitridae", 4.7, ("predator", "scavenger"),
                                  {"vend": 3, "vfish": 4, "scav": 3})[:2], ("buteo_jamaicensis", "soaring raptor"))
        # the vultures by taxon (Cathartidae; Aegypiinae and Gypaetinae by genus), with or without diet data
        self.assertEqual(self.kin("Gyps africanus", "Accipitriformes", "Accipitridae", 5.4, ("omnivore", "scavenger"),
                                  {"scav": 10})[:2], ("cathartes_aura", "soaring scavenger"))
        self.assertEqual(self.kin("Neophron percnopterus", "Accipitriformes", "Accipitridae", 2.1)[:2], ("cathartes_aura", "soaring scavenger"))
        self.assertEqual(self.kin("Coragyps atratus", "Cathartiformes", "Cathartidae", 1.9)[:2], ("cathartes_aura", "soaring scavenger"))
        # by diet: a (hypothetical: none in EltonTraits) eagle-sized corvid that lives mainly on carrion
        self.assertEqual(self.kin("Corvus fictus", "Passeriformes", "Corvidae", 1.3, ("omnivore", "scavenger"),
                                  {"scav": 6, "vend": 1, "inv": 3})[:2], ("cathartes_aura", "soaring scavenger"))

    def test_corvids(self):
        # the raven's aerial play for the ravens; crows and magpies walk; the jays and nutcrackers perch (2026-11-07)
        self.assertEqual(self.kin("Corvus corax", "Passeriformes", "Corvidae", 1.2, ("omnivore", "scavenger"))[:2], ("corvus_corax", "corvid"))
        self.assertEqual(self.kin("Corvus brachyrhynchos", "Passeriformes", "Corvidae", 0.45, ("omnivore", "scavenger"))[:2],
                         ("corvus_corax", "walking corvid"))
        self.assertEqual(self.kin("Pica hudsonia", "Passeriformes", "Corvidae", 0.177, ("omnivore", "scavenger"))[:2],
                         ("corvus_corax", "walking corvid"))
        self.assertEqual(self.kin("Nucifraga columbiana", "Passeriformes", "Corvidae", 0.13, ("omnivore", "scavenger"))[:2],
                         ("cyanocitta_stelleri", "perching bird"))
        self.assertEqual(self.kin("Garrulus glandarius", "Passeriformes", "Corvidae", 0.16, ("omnivore",))[:2],
                         ("cyanocitta_stelleri", "perching bird"))

    def test_perching_aquatic_and_guilds_kept(self):
        self.assertEqual(self.kin("Cyanocitta stelleri", "Passeriformes", "Corvidae", 0.12, ("omnivore",))[0], "cyanocitta_stelleri")
        self.assertEqual(self.kin("Parus major", "Passeriformes", "Paridae", 0.018, ("insectivore",))[0], "cyanocitta_stelleri")
        self.assertEqual(self.kin("Fratercula arctica", "Charadriiformes", "Alcidae", 0.4, ("predator",))[0], "mergus_merganser")
        self.assertEqual(self.kin("Sagittarius serpentarius", "Accipitriformes", "Sagittariidae", 4, ("predator",))[0], "buteo_jamaicensis")


class TestSquirrels(unittest.TestCase):
    """A squirrel's kin by its genus (pipeline/fauna_slots.py GROUND_SQUIRREL_GENERA, CHIPMUNK_GENERA): the Uinta ground
    squirrel ran the tree squirrel's machine while the rule read a substring of the code (2026-11-07)."""

    def kin(self, sci, kg=0.6):
        from pipeline.fauna_slots import kin_for
        a = {"id": sci.lower().replace(" ", "_"), "scientific": sci, "kind": "mammal", "mass_kg": kg, "role": ["herbivore"],
             "taxonomy": {"class": "Mammalia", "order": "Rodentia", "family": "Sciuridae", "genus": sci.split()[0]}}
        return kin_for(a, {})[:2]

    def test_ground_colonies(self):
        for sci in ("Urocitellus armatus", "Spermophilus citellus", "Ictidomys tridecemlineatus", "Callospermophilus lateralis",
                    "Otospermophilus variegatus", "Xerospermophilus tereticaudus", "Cynomys ludovicianus", "Marmota flaviventris",
                    "Xerus inauris"):
            self.assertEqual(self.kin(sci), ("otospermophilus_beecheyi", "ground colony"), sci)

    def test_trees_and_chipmunks(self):
        self.assertEqual(self.kin("Sciurus aberti"), ("sciurus_griseus", "tree squirrel"))
        self.assertEqual(self.kin("Tamiasciurus hudsonicus", 0.2), ("sciurus_griseus", "tree squirrel"))
        self.assertEqual(self.kin("Tamias minimus", 0.05), ("microtus_californicus", "small rodent"))

    def test_genus_from_the_name(self):   # a record without a genus: the binomial's first word
        from pipeline.fauna_slots import kin_for
        a = {"id": "urocitellus_armatus", "scientific": "Urocitellus armatus", "kind": "mammal", "mass_kg": 0.6,
             "taxonomy": {"class": "Mammalia", "order": "Rodentia", "family": "Sciuridae"}}
        self.assertEqual(kin_for(a, {})[1], "ground colony")


class TestMarineMammals(unittest.TestCase):
    """The seals, sea lions, sea otter and whales take no land slot (pipeline/fauna_slots.py MARINE_*, 2026-11-07): they
    stay in fauna.json's skipped list, named, with the reason "no stand-in: marine"."""

    def kin(self, sci, order, family):
        from pipeline.fauna_slots import kin_for
        a = {"id": sci.lower().replace(" ", "_"), "scientific": sci, "kind": "mammal", "mass_kg": 100, "role": ["predator"],
             "taxonomy": {"class": "Mammalia", "order": order, "family": family, "genus": sci.split()[0]}}
        return kin_for(a, {})[:2]

    def test_no_stand_in(self):
        for sci, order, fam in (("Zalophus californianus", "Carnivora", "Otariidae"), ("Phoca vitulina", "Carnivora", "Phocidae"),
                                ("Odobenus rosmarus", "Carnivora", "Odobenidae"), ("Enhydra lutris", "Carnivora", "Mustelidae"),
                                ("Orcinus orca", "Cetacea", "Delphinidae"), ("Megaptera novaeangliae", "Artiodactyla", "Balaenopteridae")):
            self.assertEqual(self.kin(sci, order, fam), (None, "no stand-in: marine"), sci)
        # the river otter keeps its slot
        self.assertEqual(self.kin("Lontra canadensis", "Carnivora", "Mustelidae")[0], "lontra_canadensis")


class TestPresenceBuffer(unittest.TestCase):
    """The presence search widens with the home range (pipeline/fetch_species.py home_range_buffer_m, 2026-11-07)."""

    def test_scales_with_home_range(self):
        from pipeline import fetch_species as F
        from pipeline.config import Tile
        t = Tile.from_id("utm10n_429_5293")
        orig = __import__("pipeline.pantheria", fromlist=["lookup"]).lookup
        import pipeline.pantheria as P
        try:
            P.lookup = lambda s: {"home_range_km2": {"Puma concolor": 129.89, "Ursus americanus": 31.25, "Ursus arctos": 2000}.get(s)}
            self.assertEqual(F.home_range_buffer_m(t, "Puma concolor"), 23_000)     # 25 home ranges: some 57 km square
            self.assertEqual(F.home_range_buffer_m(t, "Ursus americanus"), F.PRESENCE_BUFFER_M)
            self.assertEqual(F.home_range_buffer_m(t, "Ursus arctos"), F.PRESENCE_BUFFER_MAX_M)
            self.assertEqual(F.home_range_buffer_m(t, "Corvus corax"), F.PRESENCE_BUFFER_M)   # no home range: the cell scale
        finally:
            P.lookup = orig

    def test_california_bands_only(self):
        # the range test is California's: the Olympic bands kept out of it (the banana slug was put on the foothills)
        from pipeline.species_data import RANGE, RANGE_OLYMPIC
        self.assertNotIn("ariolimax_columbianus", RANGE)
        self.assertNotIn("plethodon_vehiculum", RANGE)
        self.assertIn("sylvilagus_bachmani", RANGE)
        self.assertFalse(set(RANGE) & set(RANGE_OLYMPIC))


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
        # a snake (2026-11-06): the snake template, its own way on the lizard's cells
        self.assertEqual(self.slot("Squamata", "Viperidae", 2.4), ("sceloporus_occidentalis", "snake", "snake"))
        self.assertEqual(self.slot("Squamata", "Colubridae", 0.4), ("sceloporus_occidentalis", "snake", "snake"))

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

    def test_snakes_choose_and_prompt(self):
        from pipeline import fauna_models as F
        fauna = {"slots": [
            {"code": "a_croc", "archetype": "crocodilian", "reptile": "water", "mass_kg": 94, "records": 151},
            {"code": "a_garter", "archetype": "snake", "reptile": "snake", "mass_kg": 0.4, "records": 28},
            {"code": "a_python", "archetype": "snake", "reptile": "snake", "mass_kg": 73, "records": 3}]}
        pick, rest = F.choose(fauna, 120, kind="snakes")
        self.assertEqual([s["code"] for s in pick], ["a_python", "a_garter"])   # records x sqrt(mass)
        self.assertEqual({s["code"] for s in rest}, {"a_croc"})
        pick, _ = F.choose(fauna, 120, kind="reptiles")
        self.assertEqual([s["code"] for s in pick], ["a_croc"])   # a snake is not a reptile build's
        self.assertIsNone(F.reptile_build(fauna["slots"][1]))
        mesh, _ = F._prompts(fauna["slots"][1], "Yellowstone")
        self.assertIn("open S-curve", mesh); self.assertIn("fifteen times as long as it is thick", mesh)
        self.assertIn("no coils", mesh)


if __name__ == "__main__":
    unittest.main()


class TestDesirability(unittest.TestCase):
    """pipeline/games.py desirability: each eater's preference for its foods, 0..1, per season (2026-11-06)."""
    def test_plants_by_part_energy_and_season(self):
        from pipeline.games import desirability
        forage = [["deer", "oak", "acorns", "acorn_mast", ["fall", "winter"]], ["deer", "grass", "leaves", "grass_forbs", []],
                  ["deer", "shrub", "browse", "browse", []], ["deer", "shrub", "berries", "browse", ["summer"]]]
        d = desirability([], forage, {}, {})["deer"]
        self.assertEqual(d["oak"], [1.0, None, None, 1.0])            # acorns: the richest part, only in fall and winter (winter, spring, summer, fall)
        self.assertEqual(d["shrub"][1], 0.0)                            # woody browse the least in spring (leaves beat it)
        self.assertEqual(max(r[1] for r in d.values() if r[1] is not None), 1.0)   # each season has its best food at 1
        self.assertGreater(d["shrub"][2], d["shrub"][1])                # the shrub's berries in summer beat its browse in spring
        self.assertGreater(d["grass"][1], d["shrub"][1])                # leaves over browse
        for row in d.values():
            self.assertTrue(all(v is None or 0 <= v <= 1 for v in row))

    def test_prey_by_size_and_diet_order(self):
        from pipeline.games import desirability
        diet = {"lion": {"prey": ["deer", "hare", "rabbit"]}}
        d = desirability([["lion", "deer"], ["lion", "hare"], ["lion", "rabbit"]], [], {"lion": 55, "deer": 60, "hare": 2.5, "rabbit": 0.7}, diet)["lion"]
        self.assertEqual(d["deer"], [1.0] * 4)                          # near the large carnivore's optimal size, and first in its diet
        self.assertEqual(d["rabbit"], [0.0] * 4)                        # far too small, and last
        self.assertTrue(0 < d["hare"][0] < 1)

    def test_omnivore_scaled_per_class_and_written_by_the_step(self):
        from pipeline.games import desirability
        from pipeline import steps
        d = desirability([["fox", "vole"], ["fox", "quail"]], [["fox", "berry", "berries", "browse", []], ["fox", "grass", "leaves", "grass_forbs", []]],
                         {"fox": 4, "vole": 0.05, "quail": 0.2}, {"fox": {"prey": ["vole", "quail"]}})["fox"]
        self.assertEqual(max(d["vole"][0], d["quail"][0]), 1.0)          # the best prey is 1 ...
        self.assertEqual(d["berry"][0], 1.0)                            # ... and so is the best plant
        self.assertEqual(steps.STEPS["games"].version, "2")             # the games step's version bumped with it


class TestSnakePrey(unittest.TestCase):
    """pipeline/games.py snake_predation: a tile's own snake takes what it can swallow (2026-11-06)."""
    def test_gape_and_kinds(self):
        from pipeline.games import snake_predation
        slots = [{"code": "thamnophis_elegans", "reptile": "snake", "mass_kg": 0.4},
                 {"code": "microtus_montanus", "mass_kg": 0.0363}, {"code": "rana_luteiventris", "mass_kg": 0.02},
                 {"code": "tamias_minimus", "mass_kg": 0.1353},                  # a rodent over a colubrid's gape (0.25 of 0.4 kg)
                 {"code": "pica_hudsonia", "mass_kg": 0.177, "bird": True},     # a bird: never
                 {"code": "bison_bison", "mass_kg": 579}]
        pairs = snake_predation(slots, [], {})
        self.assertIn(["thamnophis_elegans", "microtus_montanus"], pairs)
        self.assertIn(["thamnophis_elegans", "rana_luteiventris"], pairs)
        prey = {q for _, q in pairs}
        self.assertNotIn("tamias_minimus", prey)
        self.assertNotIn("pica_hudsonia", prey)
        self.assertNotIn("bison_bison", prey)

    def test_no_snake_no_pairs(self):
        from pipeline.games import snake_predation
        self.assertEqual(snake_predation([{"code": "microtus_montanus", "mass_kg": 0.0363}], [], {}), [])


class TestFaunaReserve(unittest.TestCase):
    """pipeline/fauna_slots.py RESERVE_MAX: a class of body with a template the caps left out keeps one slot (2026-11-06)."""
    def test_the_only_snake_behind_six_lizards_and_frogs(self):
        import tempfile
        from pipeline import fauna_slots as fs

        class FakeTile:
            def __init__(self, d): self.d = pathlib.Path(d)
            def path(self, rel): return self.d / rel

        lizard = {"class": "Squamata", "order": None, "family": "Phrynosomatidae"}
        frog = {"class": "Amphibia", "order": "Anura", "family": "Ranidae"}
        animals = [{"id": f"test_lizard_{i}", "scientific": f"Test lizard {i}", "common": f"lizard {i}", "kind": "reptile",
                    "records": 200 - i, "mass_kg": 0.02, "taxonomy": lizard} for i in range(4)]
        animals += [{"id": f"test_frog_{i}", "scientific": f"Test frog {i}", "common": f"frog {i}", "kind": "amphibian",
                     "records": 150 - i, "mass_kg": 0.02, "taxonomy": frog} for i in range(3)]
        animals += [{"id": "test_viper", "scientific": "Test viper", "common": "viper", "kind": "reptile", "records": 20,
                     "mass_kg": 0.5, "taxonomy": {"class": "Squamata", "order": None, "family": "Viperidae"}},
                    {"id": "test_gecko", "scientific": "Test gecko", "common": "gecko", "kind": "reptile", "records": 10,
                     "mass_kg": 0.01, "taxonomy": {"class": "Squamata", "order": None, "family": "Gekkonidae"}}]
        with tempfile.TemporaryDirectory() as d:
            (pathlib.Path(d) / "species").mkdir(); (pathlib.Path(d) / "client").mkdir()
            (pathlib.Path(d) / "species" / "animals.json").write_text(json.dumps({"animals": animals}))
            fs.fauna_slots(FakeTile(d))
            out = json.loads((pathlib.Path(d) / "client" / "fauna.json").read_text())
        codes = [s["code"] for s in out["slots"]]
        self.assertEqual(len([c for c in codes if not c.startswith("test_viper")]), fs.MAX_OTHER)   # the cap as before
        viper = next(s for s in out["slots"] if s["code"] == "test_viper")
        self.assertEqual(viper["reptile"], "snake")
        self.assertIn("snake", viper["reserved"])
        # a second lizard (a class already in a slot) stays over the cap
        self.assertNotIn("test_gecko", codes)
        self.assertIn({"id": "test_gecko", "why": f"over the {fs.MAX_OTHER}-slot cap"}, out["skipped"])


class TestSnakePhotoUse(unittest.TestCase):
    """pipeline/reference_photos.py usable_for: a snake photo for image-to-3D must hold the whole body (2026-11-06)."""
    def test_whole_body_for_image(self):
        from pipeline.reference_photos import usable_for
        s = {"whole": 0.72, "size": 1.0, "side": 1.0, "clear": 1.0}
        self.assertEqual(usable_for(s, "snake", "texture"), [])        # a texture reference may lose its tail to the frame
        self.assertEqual(usable_for(s, "snake", "image"), ["whole"])   # image-to-3D copies the pose: the whole body
        self.assertEqual(usable_for({**s, "whole": 0.95}, "snake", "image"), [])


class TestProceduralSnake(unittest.TestCase):
    """tools/build_snake_proc.py: a snake built from its traits and a photo, in build_snake.py's GLB form (2026-11-07)."""
    def _tool(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build_snake_proc", pathlib.Path(__file__).resolve().parent.parent / "tools" / "build_snake_proc.py")
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        return m

    def test_shapes_by_family(self):
        import numpy as np
        T = self._tool()
        V, C = T.FAMILY["viper"], T.FAMILY["colubrid"]
        for F in (V, C):
            w = lambda u: float(T.width_profile(np.array([u]), F)[0])
            self.assertGreater(w(F["head"] * F["apex"]), w(F["head"]))   # the head wider than the neck
            self.assertLess(w(0.995), 0.15)                               # the tail tapers to a tip
            self.assertAlmostEqual(max(float(x) for x in T.width_profile(np.linspace(0, 1, 501), F)), max(1.0, F["head_w"]), places=1)
        self.assertLess(V["slender"], C["slender"])                       # a viper is stouter
        # a viper's head stands out from its neck more than a colubrid's
        self.assertGreater(V["head_w"] / V["neck"], C["head_w"] / C["neck"])

    def test_build_from_a_striped_photo(self):
        import tempfile
        import numpy as np
        from PIL import Image, ImageDraw
        from pipeline import reference_photos as rp
        from pipeline.appearance import read_glb
        if not rp.segmenters_ready():
            self.skipTest("the segmenters are not in pipeline/_cache/segmentation")
        T = self._tool()
        with tempfile.TemporaryDirectory() as d:
            im = Image.new("RGB", (900, 400), (205, 196, 170)); dr = ImageDraw.Draw(im)
            pts = [(80 + 7 * i, 200 + 70 * np.sin(i / 18)) for i in range(110)]
            for k, (w, col) in enumerate([(26, (60, 64, 48)), (6, (225, 210, 120))]):   # a dark body with a pale mid-back stripe
                dr.line(pts, fill=col, width=w, joint="curve")
            photo = pathlib.Path(d) / "photo.png"; im.save(photo)
            out = pathlib.Path(d) / "s.glb"
            x = T.build("thamnophis_elegans", out, photo=photo)
            raw = out.read_bytes(); n = int.from_bytes(raw[12:16], "little"); g = json.loads(raw[20:20 + n])
            self.assertEqual([m["name"] for m in g["meshes"]], ["lod0", "lod1", "lod2"])
            self.assertEqual(set(g["meshes"][0]["primitives"][0]["attributes"]), {"POSITION", "COLOR_0", "_PART", "_PARTW", "_PIVOT"})
            rig = g["extras"]["rig"]
            self.assertEqual(rig["kind"], "snake"); self.assertGreater(rig["snout_z"], rig["neck_z"]); self.assertLess(rig["tail_end_z"], 0)
            P, C, R, I = read_glb(out)
            t = P[I]; nrm = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]); c = t.mean(1)
            axis = np.stack([np.zeros(len(c)), np.full(len(c), np.median(P[:, 1])), c[:, 2]], 1)
            self.assertGreater(float(((nrm * (c - axis)).sum(1) > 0).mean()), 0.9)   # the faces look outward (three.js culls the back)
            vol = abs(float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum()) / 6)
            self.assertAlmostEqual(vol * 1000 / x["mass_kg"], 1.0, delta=0.2)          # sized by its mass at 1,000 kg/m3
