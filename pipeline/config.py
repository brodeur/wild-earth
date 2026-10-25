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

SPEC_VERSION = "0.2.0"
GENERATOR = {"name": "wild-earth-pipeline", "version": "0.2.0"}
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


# Licence and credit links shared by several sources.
US_PUBLIC_DOMAIN = "https://www.usa.gov/government-copyright"
USGS_CREDITS = "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"
CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/"
NAIP_PAGE = "https://www.fpacbc.usda.gov/geo/imagery-programs/naip-imagery"

# Every source entry carries what a credits display needs (docs/tile-spec.md, Sources):
#   license, license_url               the terms the data are under
#   attribution, attribution_url       the exact credit line to show, and the link it carries
#   attribution_required               true when the licence makes showing the line a condition of use
# Sources registered in other modules (fetch_dem, fetch_naip, fetch_vegetation, fetch_geology,
# fetch_soils) carry the same fields; all_sources() returns the complete registry.
ATTRIBUTION_FIELDS = ("license", "license_url", "attribution", "attribution_url", "attribution_required")

SOURCES = {
    "usgs_3dep": {"name": "USGS 3D Elevation Program (3DEP) bare-earth DEM",
                  "url": "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
                  "license": "public domain", "license_url": USGS_CREDITS,
                  "attribution": "Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP)",
                  "attribution_url": "https://www.usgs.gov/3d-elevation-program",
                  "attribution_required": False},
    "usgs_naip": {"name": "USGS NAIP Plus orthoimagery",
                  "url": "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer",
                  "license": "public domain", "license_url": US_PUBLIC_DOMAIN,
                  "attribution": "Imagery: USDA National Agriculture Imagery Program (NAIP), via USGS The National Map",
                  "attribution_url": NAIP_PAGE,
                  "attribution_required": False},
    "osm": {"name": "OpenStreetMap via Overpass API",
            "url": "https://overpass-api.de/api/interpreter",
            "license": "ODbL 1.0", "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
            "attribution": "© OpenStreetMap contributors",
            "attribution_url": "https://www.openstreetmap.org/copyright",
            "attribution_required": True},
    "nhdplus_hr": {"name": "USGS NHDPlus High Resolution",
                   "url": "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer",
                   "license": "public domain", "license_url": USGS_CREDITS,
                   "attribution": "Hydrography: U.S. Geological Survey, NHDPlus High Resolution",
                   "attribution_url": "https://www.usgs.gov/national-hydrography/nhdplus-high-resolution",
                   "attribution_required": False},
    "gbif": {"name": "GBIF occurrence API (includes iNaturalist research-grade and eBird)",
             "url": "https://api.gbif.org/v1/occurrence/search",
             "license": "per dataset (CC0 / CC BY / CC BY-NC); see occurrence properties",
             "license_url": "https://www.gbif.org/terms",
             "attribution": "Species occurrences: GBIF.org and its contributing datasets, including iNaturalist "
                            "and eBird (CC0, CC BY 4.0 or CC BY-NC 4.0 per record)",
             "attribution_url": "https://www.gbif.org/",
             "attribution_required": True},
}


def all_sources() -> dict:
    """SOURCES with every module that registers an entry imported, so the registry is complete.
    A module whose optional dependencies are missing (requirements-ground.txt) is skipped: its
    sources cannot be in a tile built without it."""
    import importlib
    for mod in ("fetch_dem", "fetch_naip", "fetch_vegetation", "fetch_geology", "fetch_soils"):
        try:
            importlib.import_module(f".{mod}", __package__)
        except ImportError:
            pass
    return SOURCES
