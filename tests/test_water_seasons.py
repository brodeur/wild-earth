"""Mapped water against the imagery (pipeline/water_seasons.py), on a synthetic tile.

    arch -arm64 .venv/bin/python -m unittest tests.test_water_seasons

Checked: a lake open in every month is permanent; a marsh green in every month is dry with a meadow bed; a pond open
in spring and green after is seasonal; a lake under bright ice in spring stays permanent (ice months leave the count);
a refused month is not read; a polygon too small for 20 m pixels keeps its tags (NHD intermittent: seasonal; OSM
natural=water: permanent); OSM ids are unique per ring.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import water_seasons as WSN  # noqa: E402

X0, Y0, N, RES = 557000.0, 4964000.0, 500, 20.0
CRS = "EPSG:32612"


class FakeTile:
    def __init__(self, d: Path):
        self.dir = d
        self.crs = CRS
        self.bounds = (X0, Y0, X0 + N * RES, Y0 + N * RES)
        self.tile_id = "utm12n_557_4964"

    def path(self, rel):
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


# boxes in tile-local metres: (x0, y0, x1, y1)
LAKE = (1000, 1000, 1400, 1400)
MARSH = (2000, 1000, 2400, 1400)
POND = (3000, 1000, 3200, 1200)
ICY = (4000, 1000, 4400, 1400)
TINY = (5000, 1000, 5030, 1030)
TINY_OSM = (6000, 1000, 6030, 1030)
SPRING = (4, 5, 6)


def _write(tile: FakeTile, refused=(1, 2, 12)):
    import rasterio
    from pyproj import Transformer
    from rasterio.transform import from_origin
    to_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform

    def ring(b):
        x0, y0, x1, y1 = b
        return [list(to_wgs(X0 + x, Y0 + y)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0))]

    feats = [
        {"properties": {"permanent_identifier": "lake", "fcode": 39004, "ftype": 390}, "b": LAKE},
        {"properties": {"permanent_identifier": "marsh", "fcode": 46600, "ftype": 466}, "b": MARSH},
        {"properties": {"permanent_identifier": "pond", "fcode": 39004, "ftype": 390}, "b": POND},
        {"properties": {"permanent_identifier": "icy", "fcode": 39004, "ftype": 390}, "b": ICY},
        {"properties": {"permanent_identifier": "tiny", "fcode": 39001, "ftype": 390}, "b": TINY},
        {"properties": {"osm_id": "way/1", "fcode": None, "ftype": None, "source": "osm"}, "b": TINY_OSM},
    ]
    tile.path("hydro/waterbodies.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": f["properties"], "geometry": {"type": "Polygon", "coordinates": [ring(f["b"])]}}
        for f in feats]}))

    def cells(b):
        x0, y0, x1, y1 = b
        return slice(int((N * RES - y1) / RES), int((N * RES - y0) / RES)), slice(int(x0 / RES), int(x1 / RES))

    months = []
    for mo in range(1, 13):
        # grassland everywhere: red 0.08, green 0.09, blue 0.05, NDVI 0.5
        R = np.full((N, N), 0.08, "float32"); G = np.full((N, N), 0.09, "float32")
        B = np.full((N, N), 0.05, "float32"); V = np.full((N, N), 0.5, "float32")

        def water(b):
            s = cells(b)
            R[s], G[s], B[s], V[s] = 0.02, 0.04, 0.03, -0.3

        water(LAKE)
        if mo in SPRING:
            water(POND)
            s = cells(ICY)
            R[s], G[s], B[s], V[s] = 0.5, 0.55, 0.6, 0.02     # snow-covered ice
        else:
            water(ICY)
        tr = from_origin(X0, Y0 + N * RES, RES, RES)
        with rasterio.open(tile.path(f"seasons/s2_{mo:02d}.tif"), "w", driver="GTiff", width=N, height=N, count=4,
                           dtype="float32", crs=CRS, transform=tr) as dst:
            dst.write(np.stack([R, G, B, V]))
        months.append({"month": mo, "refused": mo in refused, "filled_fraction": 1.0 if mo in refused else 0.0})
    tile.path("seasons/months.json").write_text(json.dumps({"months": months}))


class WaterSeasonsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.tile = FakeTile(Path(cls.tmp.name))
        _write(cls.tile)
        cls.layer = WSN.classify(cls.tile)["hydro.waterbody_seasons"]
        cls.by = WSN.load_classes(cls.tile)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_lake_permanent(self):
        b = self.by["lake"]
        self.assertEqual((b["class"], b["basis"]), ("permanent", "imagery"))
        self.assertEqual(b["water_fraction"][0], None)          # January refused: not read
        self.assertEqual(b["water_fraction"][6], 1.0)

    def test_marsh_dry_meadow(self):
        b = self.by["marsh"]
        self.assertEqual((b["class"], b["bed"]), ("dry", "meadow"))
        self.assertTrue(all(f in (None, 0.0) for f in b["water_fraction"]))

    def test_pond_seasonal(self):
        b = self.by["pond"]
        self.assertEqual(b["class"], "seasonal")
        self.assertEqual(b["wet_months"], list(SPRING))

    def test_ice_is_not_dry(self):
        b = self.by["icy"]
        self.assertEqual(b["class"], "permanent")
        self.assertEqual([b["water_fraction"][m - 1] for m in SPRING], [None, None, None])

    def test_unresolved_keep_tags(self):
        self.assertEqual((self.by["tiny"]["class"], self.by["tiny"]["basis"]), ("seasonal", "tags"))
        self.assertEqual((self.by["way/1#5"]["class"], self.by["way/1#5"]["basis"]), ("permanent", "tags"))

    def test_layer_evidence(self):
        self.assertEqual(self.layer["counts"], {"permanent": 3, "seasonal": 2, "dry": 1})
        self.assertEqual(len(self.layer["evidence"]), 6)
        self.assertEqual(self.layer["months_used"], list(range(3, 12)))

    def test_tag_class(self):
        self.assertEqual(WSN.tag_class({"fcode": 46600})[0], "seasonal")
        self.assertEqual(WSN.tag_class({"fcode": 39004})[0], "permanent")
        self.assertEqual(WSN.tag_class({"osm_id": "way/2"}, {"natural": "water", "intermittent": "yes"})[0], "seasonal")
        self.assertEqual(WSN.tag_class({"osm_id": "way/2"}, {"natural": "water", "seasonal": "no"})[0], "permanent")


if __name__ == "__main__":
    unittest.main()
