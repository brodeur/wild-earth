"""Imagery: present-day NAIP RGB orthoimagery (the 'real' layer).

Primary source is Microsoft Planetary Computer's NAIP collection (cloud-optimized
GeoTIFFs, read through overviews so only the needed resolution is pulled). The USGS
NAIP Plus ImageServer is the fallback, fetched as chips.
"""
from __future__ import annotations

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

from .arcgis import fetch_chipped
from .config import NAIP_PAGE, SOURCES, US_PUBLIC_DOMAIN, USER_AGENT, Tile
from .http import HEADERS, get, post

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"

SOURCES["pc_naip"] = {
    "name": "USDA NAIP via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/naip",
    "license": "public domain",
    "license_url": US_PUBLIC_DOMAIN,
    "attribution": "Imagery: USDA National Agriculture Imagery Program (NAIP), via Microsoft Planetary Computer",
    "attribution_url": NAIP_PAGE,
    "attribution_required": False,
}


def _from_planetary_computer(tile: Tile, n: int) -> tuple[np.ndarray, dict]:
    w, s, e, nn = tile.bounds_wgs84
    import requests
    r = requests.post(STAC, json={"collections": ["naip"], "bbox": [w, s, e, nn], "limit": 200},
                      headers=HEADERS, timeout=120)
    r.raise_for_status()
    items = r.json().get("features", [])
    if not items:
        raise RuntimeError("no NAIP items in Planetary Computer for this tile")
    year = max(i["properties"]["naip:year"] for i in items)
    items = [i for i in items if i["properties"]["naip:year"] == year]
    token = get(SAS).json()["token"]
    x0, y0, x1, y1 = tile.bounds
    transform = from_bounds(x0, y0, x1, y1, n, n)
    mosaic = np.zeros((3, n, n), "uint8")
    filled = np.zeros((n, n), bool)
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT,
                       GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES")
    with env:
        for it in items:
            href = it["assets"]["image"]["href"] + "?" + token
            # Open the overview closest to the target resolution so only that level is read.
            with rasterio.open(href) as probe:
                ovs = probe.overviews(1)
                src_res = probe.res[0]
            target_res = (x1 - x0) / n
            level = None
            for i, f in enumerate(ovs):
                if src_res * f <= target_res:
                    level = i
            kw = {"overview_level": level} if level is not None else {}
            with rasterio.open(href, **kw) as src, WarpedVRT(
                    src, crs=tile.crs, transform=transform, width=n, height=n,
                    resampling=Resampling.bilinear) as vrt:
                data = vrt.read([1, 2, 3])
            got = data.max(axis=0) > 0
            take = got & ~filled
            mosaic[:, take] = data[:, take]
            filled |= take
    meta = {"source": "pc_naip", "naip_year": int(year), "items": len(items),
            "coverage": float(filled.mean())}
    return mosaic, meta


def _from_usgs(tile: Tile) -> tuple[np.ndarray, int, dict]:
    data, n = fetch_chipped(SOURCES["usgs_naip"]["url"], tile, tile.imagery_res_m,
                            f"naip_{tile.imagery_res_m:g}m", chip_px=500, bands=3,
                            pixel_type="U8", band_ids="0,1,2", dtype="uint8")
    return data, n, {"source": "usgs_naip"}


def fetch_naip(tile: Tile, force=False) -> dict:
    x0, y0, x1, y1 = tile.bounds
    out = tile.path("imagery/naip.tif")
    n = int(round((x1 - x0) / tile.imagery_res_m))
    if out.exists() and not force:
        with rasterio.open(out) as src:
            tags = src.tags()
        return {"path": "imagery/naip.tif", "kind": "raster", "resolution_m": (x1 - x0) / src.width,
                "bands": ["red", "green", "blue"], "source": tags.get("WE_SOURCE", "pc_naip"),
                "naip_year": int(tags["WE_NAIP_YEAR"]) if tags.get("WE_NAIP_YEAR") else None,
                "cached": True}
    try:
        data, meta = _from_planetary_computer(tile, n)
    except Exception as e:  # noqa: BLE001
        print(f"planetary computer failed ({e}); falling back to USGS NAIP Plus")
        data, n, meta = _from_usgs(tile)
    profile = {
        "driver": "GTiff", "dtype": "uint8", "count": 3, "width": n, "height": n,
        "crs": tile.crs, "transform": from_bounds(x0, y0, x1, y1, n, n),
        "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate",
        "photometric": "RGB",
    }
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(data)
        dst.update_tags(WE_SOURCE=meta["source"], WE_NAIP_YEAR=meta.get("naip_year", ""))
        dst.build_overviews([2, 4, 8], rasterio.enums.Resampling.average)
    return {"path": "imagery/naip.tif", "kind": "raster", "resolution_m": (x1 - x0) / n,
            "bands": ["red", "green", "blue"], **meta}
