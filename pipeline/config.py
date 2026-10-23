"""Tile configuration and shared helpers for the Wild Earth pipeline."""
from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pyproj import CRS, Transformer

SPEC_VERSION = "0.1.0"
GENERATOR = {"name": "wild-earth-pipeline", "version": "0.1.0"}
USER_AGENT = "wild-earth-pipeline/0.1 (https://github.com/aaronbrodeur/wild-earth)"
REPO_ROOT = Path(__file__).resolve().parent.parent
TILES_DIR = REPO_ROOT / "tiles"
TILE_SIZE_M = 10_000


@dataclass
class Tile:
    zone: int
    north: bool
    easting_km: int
    northing_km: int
    dem_res_m: float = 5.0
    imagery_res_m: float = 2.5

    @property
    def tile_id(self) -> str:
        hemi = "n" if self.north else "s"
        return f"utm{self.zone}{hemi}_{self.easting_km}_{self.northing_km}"

    @property
    def epsg(self) -> int:
        return (32600 if self.north else 32700) + self.zone

    @property
    def crs(self) -> str:
        return f"EPSG:{self.epsg}"

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        x0 = self.easting_km * 1000
        y0 = self.northing_km * 1000
        return (x0, y0, x0 + TILE_SIZE_M, y0 + TILE_SIZE_M)

    @property
    def bounds_wgs84(self) -> tuple[float, float, float, float]:
        inv = Transformer.from_crs(self.crs, "EPSG:4326", always_xy=True)
        x0, y0, x1, y1 = self.bounds
        xs, ys = zip(*[inv.transform(x, y) for x, y in
                       [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]])
        return (min(xs), min(ys), max(xs), max(ys))

    @property
    def bounds_3857(self) -> tuple[float, float, float, float]:
        t = Transformer.from_crs(self.crs, "EPSG:3857", always_xy=True)
        x0, y0, x1, y1 = self.bounds
        xs, ys = zip(*[t.transform(x, y) for x, y in
                       [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]])
        return (min(xs), min(ys), max(xs), max(ys))

    @property
    def dir(self) -> Path:
        return TILES_DIR / self.tile_id

    def path(self, rel: str) -> Path:
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @classmethod
    def from_anchor(cls, lon: float, lat: float, **kw) -> "Tile":
        """Snap an anchor point to its 10 km UTM cell. The anchor is not kept."""
        zone = int(math.floor((lon + 180) / 6) + 1)
        north = lat >= 0
        epsg = (32600 if north else 32700) + zone
        t = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        x, y = t.transform(lon, lat)
        return cls(zone, north,
                   int(math.floor(x / TILE_SIZE_M) * 10),
                   int(math.floor(y / TILE_SIZE_M) * 10), **kw)

    @classmethod
    def from_id(cls, tile_id: str, **kw) -> "Tile":
        head, e, n = tile_id.split("_")
        zone = int(head[3:-1])
        return cls(zone, head[-1] == "n", int(e), int(n), **kw)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)
        f.write("\n")


def read_json(path: Path):
    with open(path) as f:
        return json.load(f)


SOURCES = {
    "usgs_3dep": {"name": "USGS 3D Elevation Program (3DEP) bare-earth DEM",
                  "url": "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
                  "license": "public domain"},
    "usgs_naip": {"name": "USGS NAIP Plus orthoimagery",
                  "url": "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer",
                  "license": "public domain"},
    "osm": {"name": "OpenStreetMap via Overpass API",
            "url": "https://overpass-api.de/api/interpreter",
            "license": "ODbL 1.0"},
    "nhdplus_hr": {"name": "USGS NHDPlus High Resolution",
                   "url": "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer",
                   "license": "public domain"},
    "gbif": {"name": "GBIF occurrence API (includes iNaturalist research-grade and eBird)",
             "url": "https://api.gbif.org/v1/occurrence/search",
             "license": "per dataset (CC0 / CC BY / CC BY-NC); see occurrence properties"},
}
