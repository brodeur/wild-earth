"""A tile's own ground layer (pipeline/ground_cards.py): reading a LANDFIRE BpS description and writing a card by rule."""
import io
import unittest
import zipfile

from pipeline import ground_cards as gc


def _docx(paragraphs):
    """A minimal docx: paragraphs, a list being a table row (cells)."""
    body = []
    for p in paragraphs:
        if isinstance(p, list):
            body.append("<w:tbl><w:tr>" + "".join(f"<w:tc><w:p><w:r><w:t>{c}</w:t></w:r></w:p></w:tc>" for c in p) + "</w:tr></w:tbl>")
        else:
            body.append(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>")
    xml = '<w:document xmlns:w="w"><w:body>' + "".join(body) + "</w:body></w:document>"
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("word/document.xml", xml)
    return b.getvalue()


DOC = _docx(["11260", "Inter-Mountain Basins Montane Sagebrush Steppe", "Vegetation Description",
             "Common grasses include: Festuca idahoensis, Agropyron spicata (now Pseudoroegneria spicata), and Poa secunda. "
             "Common forbs include Balsamorhiza sagittata and Lupinus spp.",
             "BpS Dominant and Indicator Species", ["Symbol", "Scientific Name", "Common Name"],
             ["{0}ARTRV", "Artemisia tridentata ssp. vaseyana", "Mountain big sagebrush"],
             ["PSSP6", "Pseudoroegneria spicata", "Bluebunch wheatgrass"],
             "Species names are from the NRCS PLANTS database.", "Disturbance Description", "Fire."])


class TestDescription(unittest.TestCase):
    def test_table_and_vegetation(self):
        d = gc.parse_doc(DOC)
        self.assertEqual(d["table"], [("ARTRV", "Artemisia tridentata ssp. vaseyana"), ("PSSP6", "Pseudoroegneria spicata")])
        self.assertIn("Festuca idahoensis", d["vegetation"])
        self.assertNotIn("Fire", d["vegetation"])

    def test_names(self):
        names = gc.names_in(gc.parse_doc(DOC)["vegetation"])
        self.assertIn(("Festuca idahoensis", False), names)
        self.assertIn(("Agropyron spicata", False), names)
        self.assertIn(("Lupinus", True), names)
        self.assertFalse(any(n.startswith("Common") for n, _ in names))   # not a genus

    def test_system_names_match(self):
        self.assertEqual(gc._norm("Northern Rocky Mountain Lower Montane-Foothill-Valley Grassland"),
                         gc._norm("Northern Rocky Mountain Lower Montane, Foothill, and Valley Grassland"))
        self.assertEqual(gc._norm("Inter-Mountain Basins Montane Sagebrush Steppe - Mountain Big Sagebrush"),
                         gc._norm("Inter-Mountain Basins Montane Sagebrush Steppe"))


class TestSeasons(unittest.TestCase):
    def test_cool_season_grass(self):
        st = gc._season_state(gc._growth_seasons("Spring"))
        self.assertEqual(st, {"spring": "live", "summer": "curing", "fall": "cured", "winter": "weathered"})

    def test_months(self):
        self.assertEqual(gc._months("Early Summer"), [6, 6])
        self.assertEqual(gc._months("Spring"), [3, 5])
        self.assertIsNone(gc._months("Indeterminate"))

    def test_model_zones(self):
        self.assertEqual(gc._model_zones("11260_1_7_8_9_10_19"), [1, 7, 8, 9, 10, 19])
        self.assertEqual(gc._model_zones("11260_21"), [21])


if __name__ == "__main__":
    unittest.main()
