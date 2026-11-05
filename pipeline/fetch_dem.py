"""Terrain: bare-earth DEM.

Preferred source is the USGS 3DEP ImageServer (1 m lidar where it exists), fetched as
chips. That service is unreliable, so the fallback is the 3DEP seamless 1/3 arc-second
(10 m) DEM served as cloud-optimized GeoTIFFs by Microsoft Planetary Computer. Outside the
US (pipeline/regions.py), or when both fail, NASADEM (1 arc-second, ~30 m, 60 N to 56 S;
NASA, no restrictions on reuse) from the same Planetary Computer stands in: the global
fallback, coarser, so the terrain detail of a tile there is the 30 m surface resampled.
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
SAS_NASADEM = "https://planetarycomputer.microsoft.com/api/sas/v1/token/nasadem"

SOURCES["nasadem"] = {
    "name": "NASADEM 1 arc-second DEM (NASA JPL, from SRTM) via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/nasadem",
    "license": "public domain (NASA; LP DAAC: no restrictions on reuse)",
    "license_url": "https://lpdaac.usgs.gov/data/data-citation-and-policies/",
    "attribution": "Elevation: NASA JPL (2020). NASADEM Merged DEM Global 1 arc second V001, NASA EOSDIS Land Processes DAAC",
    "attribution_url": "https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001",
    "attribution_required": False,
}

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


def _stac_items(collection: str, bbox, limit=50) -> list[dict]:
    last = None
    for attempt in range(3):   # the STAC search has no retry of its own in requests
        try:
            r = requests.post(STAC, json={"collections": [collection], "bbox": list(bbox), "limit": limit},
                              headers=HEADERS, timeout=120)
            r.raise_for_status()
            return r.json().get("features", [])
        except requests.RequestException as e:  # noqa: PERF203
            last = e
            import time
            time.sleep(3 * (attempt + 1))
    raise last  # type: ignore[misc]


def _from_planetary_computer(tile: Tile, collection="3dep-seamless") -> tuple[np.ndarray, int, dict]:
    w, s, e, nn = tile.bounds_wgs84
    feats = _stac_items(collection, (w, s, e, nn))
    if collection == "nasadem":
        items, asset, sas, src, res = feats, "elevation", SAS_NASADEM, "nasadem", 30.0
    else:
        items, asset, sas, src, res = [i for i in feats if i["properties"].get("gsd") == 10], "data", SAS, "pc_3dep_seamless", 10.0
    if not items:
        raise RuntimeError(f"no {collection} items for this tile")
    token = get(sas).json()["token"]
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / tile.dem_res_m))
    transform = from_bounds(x0, y0, x1, y1, n, n)
    out = np.full((n, n), NODATA, "float32")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT):
        for it in items:
            href = it["assets"][asset]["href"] + "?" + token
            with rasterio.open(href) as src, WarpedVRT(
                    src, crs=tile.crs, transform=transform, width=n, height=n,
                    resampling=Resampling.bilinear, nodata=NODATA) as vrt:
                data = vrt.read(1)
            take = (data != NODATA) & np.isfinite(data) & (out == NODATA)
            out[take] = data[take]
    if not (out != NODATA).any():
        raise RuntimeError(f"{collection} has no data over this tile")
    return out, n, {"source": src, "source_resolution_m": res}


def fetch_dem(tile: Tile, force=False) -> dict:
    x0, y0, x1, y1 = tile.bounds
    from . import regions, runlog
    if not regions.covers("usgs_3dep", tile):
        runlog.fallback(f"outside 3DEP ({', '.join(regions.region_of(tile))}): NASADEM 30 m, the global fallback", source="nasadem")
        data, n, meta = _from_planetary_computer(tile, "nasadem")
    else:
        try:
            data, n, meta = _from_usgs(tile, force)
        except Exception as e:  # noqa: BLE001
            runlog.fallback(f"USGS 3DEP ImageServer failed ({str(e)[:160]}); Planetary Computer seamless 10 m", source="pc_3dep_seamless")
            try:
                data, n, meta = _from_planetary_computer(tile)
            except Exception as e2:  # noqa: BLE001
                runlog.fallback(f"Planetary Computer 3dep-seamless failed ({str(e2)[:160]}); NASADEM 30 m", source="nasadem")
                data, n, meta = _from_planetary_computer(tile, "nasadem")
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
