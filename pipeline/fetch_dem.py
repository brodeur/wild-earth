"""Terrain: bare-earth DEM.

Preferred source is the USGS 3DEP ImageServer (1 m lidar where it exists), fetched as
chips. That service is unreliable, so the fallback is the 3DEP seamless 1/3 arc-second
(10 m) DEM served as cloud-optimized GeoTIFFs by Microsoft Planetary Computer.
"""
from __future__ import annotations

import numpy as np
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

from .arcgis import fetch_chipped
from .config import SOURCES, USER_AGENT, USGS_CREDITS, Tile
from .http import HEADERS, get

NODATA = -9999.0
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/3dep-seamless"

SOURCES["pc_3dep_seamless"] = {
    "name": "USGS 3DEP seamless 1/3 arc-second DEM via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/3dep-seamless",
    "license": "public domain",
    "license_url": USGS_CREDITS,
    "attribution": "Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP), via Microsoft Planetary Computer",
    "attribution_url": "https://www.usgs.gov/3d-elevation-program",
    "attribution_required": False,
}


def _from_usgs(tile: Tile, force: bool) -> tuple[np.ndarray, int, dict]:
    data, n = fetch_chipped(SOURCES["usgs_3dep"]["url"], tile, tile.dem_res_m,
                            f"3dep_{tile.dem_res_m:g}m", chip_px=500, bands=1, pixel_type="F32",
                            nodata=NODATA, dtype="float32", force=force)
    return data[0], n, {"source": "usgs_3dep", "source_resolution_m": 1.0}


def _from_planetary_computer(tile: Tile) -> tuple[np.ndarray, int, dict]:
    w, s, e, nn = tile.bounds_wgs84
    r = requests.post(STAC, json={"collections": ["3dep-seamless"], "bbox": [w, s, e, nn], "limit": 50},
                      headers=HEADERS, timeout=120)
    r.raise_for_status()
    items = [i for i in r.json().get("features", []) if i["properties"].get("gsd") == 10]
    if not items:
        raise RuntimeError("no 3dep-seamless 10 m items for this tile")
    token = get(SAS).json()["token"]
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / tile.dem_res_m))
    transform = from_bounds(x0, y0, x1, y1, n, n)
    out = np.full((n, n), NODATA, "float32")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT):
        for it in items:
            href = it["assets"]["data"]["href"] + "?" + token
            with rasterio.open(href) as src, WarpedVRT(
                    src, crs=tile.crs, transform=transform, width=n, height=n,
                    resampling=Resampling.bilinear, nodata=NODATA) as vrt:
                data = vrt.read(1)
            take = (data != NODATA) & np.isfinite(data) & (out == NODATA)
            out[take] = data[take]
    return out, n, {"source": "pc_3dep_seamless", "source_resolution_m": 10.0}


def fetch_dem(tile: Tile, force=False) -> dict:
    x0, y0, x1, y1 = tile.bounds
    try:
        data, n, meta = _from_usgs(tile, force)
    except Exception as e:  # noqa: BLE001
        print(f"USGS 3DEP ImageServer failed ({e}); falling back to Planetary Computer seamless DEM")
        data, n, meta = _from_planetary_computer(tile)
    data[~np.isfinite(data)] = NODATA
    valid = data != NODATA
    out = tile.path("terrain/dem.tif")
    profile = {
        "driver": "GTiff", "dtype": "float32", "count": 1, "width": n, "height": n,
        "crs": tile.crs, "transform": from_bounds(x0, y0, x1, y1, n, n), "nodata": NODATA,
        "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate", "predictor": 3,
    }
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data, 1)
        dst.build_overviews([2, 4, 8], Resampling.average)
    return {
        "path": "terrain/dem.tif", "kind": "raster", "resolution_m": (x1 - x0) / n, "units": "m",
        "nodata": NODATA, **meta,
        "stats": {"min": float(data[valid].min()), "max": float(data[valid].max()),
                  "valid_fraction": float(valid.mean())},
    }
