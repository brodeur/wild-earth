"""The 2026-11-08 rules: a common name never a Latin epithet, deep-shade ground plants by the canopy's closure
(docs/decisions.md 2026-11-08)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import fetch_species, species_mix  # noqa: E402


class CommonName(unittest.TestCase):
    def _q(self, children=(), english=()):
        def q(tile, path, params, force=False):
            if path.endswith("/children"):
                return {"results": [{"canonicalName": c} for c in children]}
            if path.endswith("/vernacularNames"):
                return {"results": [{"vernacularName": n, "language": "eng"} for n in english]}
            return {}
        return q

    def test_subspecies_epithet_refused(self):
        sp = {"key": 1, "canonicalName": "Crotalus oreganus", "vernacularName": "abyssus"}
        with mock.patch.object(fetch_species, "_q", self._q(["Crotalus oreganus abyssus", "Crotalus oreganus helleri"],
                                                           ["Northern Pacific Rattlesnake", "Western Rattlesnake"])):
            self.assertEqual(fetch_species.common_name(sp), "northern pacific rattlesnake")

    def test_real_one_word_name_kept(self):
        sp = {"key": 2, "canonicalName": "Lynx rufus", "vernacularName": "Bobcat"}
        with mock.patch.object(fetch_species, "_q", self._q(["Lynx rufus fasciatus"], ["Bobcat"])):
            self.assertEqual(fetch_species.common_name(sp), "bobcat")

    def test_two_word_name_needs_no_lookup(self):
        sp = {"key": 3, "canonicalName": "Sciurus griseus", "vernacularName": "Western Gray Squirrel"}
        with mock.patch.object(fetch_species, "_q", side_effect=AssertionError("no GBIF call")):
            self.assertEqual(fetch_species.common_name(sp), "western gray squirrel")

    def test_none_without_a_name(self):
        sp = {"key": 4, "canonicalName": "Crotalus oreganus", "vernacularName": "abyssus"}
        with mock.patch.object(fetch_species, "_q", self._q(["Crotalus oreganus abyssus"], [])):
            self.assertIsNone(fetch_species.common_name(sp))


class DeepShade(unittest.TestCase):
    def test_closure_by_name(self):
        self.assertEqual(species_mix.closure("California Lower Montane Foothill Pine Woodland and Savanna", "mixed_forest"), 0.35)
        self.assertEqual(species_mix.closure("Mediterranean California Mixed Oak Woodland", "oak_woodland"), 0.5)
        self.assertEqual(species_mix.closure("Mediterranean California Dry-Mesic Mixed Conifer Forest and Woodland", None), 0.75)
        self.assertEqual(species_mix.closure("Sierra Nevada Subalpine Forest", None), 1.0)
        self.assertEqual(species_mix.closure("Open Water", None), 0.0)

    def test_fern_weighted_by_closure(self):
        cls = next(k for k, v in species_mix.CLASSES.items() if v == "mixed_forest")
        fern = {"id": "fern", "habitat": {"classes": {"mixed_forest": 1.0}, "shade": 0.9}, "density": 1.5}
        grass = {"id": "grass", "habitat": {"classes": {"mixed_forest": 0.6}, "shade": 0.6}, "density": 1.0}
        sav = species_mix.ground_weights(cls, "x", [fern, grass], "Foothill Pine Woodland and Savanna")
        forest = species_mix.ground_weights(cls, "x", [fern, grass], "Mixed Conifer Forest")
        self.assertAlmostEqual(sav["fern"], 1.5 * 0.35 ** 2)
        self.assertAlmostEqual(forest["fern"], 1.5)
        self.assertAlmostEqual(sav["grass"], 0.6)


if __name__ == "__main__":
    unittest.main()
