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
            with rasterio.open(href) as ds, WarpedVRT(   # not `src`: that names the source returned below (it was
                    ds, crs=tile.crs, transform=transform, width=n, height=n,   # the dataset in the manifest, 2026-11-05)
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
        # world pipeline (2026-11-05): Copernicus GLO-30 is global (NASADEM stops at 60 N). It is a surface model: under
        # forest it carries part of the canopy (the probes record what that does); NASADEM if it fails.
        from . import fetch_global
        try:
            runlog.fallback(f"outside 3DEP ({', '.join(regions.region_of(tile))}): Copernicus DEM GLO-30, the global "
                            "surface model (canopy not removed)", source="copernicus_dem_glo30")
            data = fetch_global.copernicus_dem(tile, tile.dem_res_m)
            n = data.shape[0]
            meta = {"source": "copernicus_dem_glo30", "source_resolution_m": 30.0, "surface_model": True}
        except Exception as e:  # noqa: BLE001
            runlog.fallback(f"Copernicus GLO-30 failed ({str(e)[:160]}); NASADEM 30 m", source="nasadem")
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


# ---------------------------------------------------------------------------------------------------------------
# The drawn DEM from the 1 m ground (2026-11-06, Lamar: "the waterways look like they are not in the right area based on
# the ground color and elevation"). The ImageServer's 5 m is itself the 3DEP best-available (1 m lidar where it exists)
# resampled, but it is flaky: when it fails the step takes the 3DEP seamless 10 m (Lamar, 267_4175), a different, older
# survey, metres off the 1 m ground (std 3.9 m on Lamar, 13.2 m on 267_4175, against 0.3-1.6 m where the ImageServer
# answered). The client draws terrain/dem.tif (via dem_rewilded, dem_banked and client/heights.png), so water put on the
# 1 m thalweg (pipeline/reroute.py) would not sit on the drawn ground, and the reroute refuses such a tile.
#
# The rule: where the 3DEP 1 m products (pipeline/lidar.build_dem_1m) cover at least DRAWN_1M_MIN_SHARE of the tile, the
# drawn DEM is the 1 m ground averaged to the drawn grid (each 5 m cell the mean of its 25 1 m cells) wherever every one
# of those cells is the product's, whichever 5 m service answered; the fetched 5 m (kept as terrain/dem_5m.tif) fills only
# the rest, shifted toward the 1 m ground near the seam (the seam's difference, smoothed, fading to 0 over BLEND_M into
# the gap), so there is no step where they meet.
# The threshold, from the tiles with 1 m products: Teton 100 %, Lamar 98.7 % (one gap, the south-west corner, 1.3 %, the
# collection's edge), the Grand Canyon 86.1 % (three gaps, a 1.1 x 8 km strip on the west side), the Hoh 0 % (its 2013
# collection publishes no 1 m DEM). At >= 95 % the gaps are a collection's ragged edge and the drawn ground is the 1 m
# ground on all but a sliver: the reroute's test (dem_5m_vs_1m_std_m <= 3 m) holds by construction. Below it the 1 m is
# one source among two over a large part of the tile, and the tile keeps the ImageServer's DEM (the Grand Canyon's
# agrees with its 1 m at 1.6 m and was rerouted).
DRAWN_1M_MIN_SHARE = 0.95
BLEND_M = 50.0          # the gap side of the 1 m / 5 m seam is shifted onto the 1 m ground over this distance
SEAM_SIGMA_M = 15.0     # the seam's difference (1 m mean - 5 m) is smoothed over this before it is spread into the gap
FETCHED = "terrain/dem_5m.tif"


def _write_dem(path, data, tile: Tile, n: int) -> None:
    x0, y0, x1, y1 = tile.bounds
    profile = {
        "driver": "GTiff", "dtype": "float32", "count": 1, "width": n, "height": n,
        "crs": tile.crs, "transform": from_bounds(x0, y0, x1, y1, n, n), "nodata": NODATA,
        "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate", "predictor": 3,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype("float32"), 1)
        dst.build_overviews([2, 4, 8], Resampling.average)


def draw_from_1m(z5: np.ndarray, z1: np.ndarray, src1: np.ndarray | None, res5: float) -> tuple[np.ndarray, dict]:
    """The drawn DEM: the 1 m ground's block mean where every 1 m cell of the 5 m cell is the 1 m product's (src1 == 1;
    all valid cells when there is no source mask), the 5 m elsewhere, shifted toward the 1 m ground near the seam."""
    from scipy import ndimage
    n5 = z5.shape[0]
    f = z1.shape[0] // n5
    ok1 = np.isfinite(z1) & (z1 != NODATA)
    if src1 is not None:
        ok1 &= src1 == 1
    full = ok1.reshape(n5, f, n5, f).all(axis=(1, 3))
    mean1 = np.where(ok1, z1, 0).astype("float64").reshape(n5, f, n5, f).mean(axis=(1, 3))
    out = np.where(full, mean1, z5).astype("float64")
    stats = {"share_1m_cells": round(float(full.mean()), 4)}
    gap = ~full & (z5 != NODATA) & np.isfinite(z5)
    if full.any() and gap.any():
        d = np.where(full, mean1 - z5, 0.0)
        s = SEAM_SIGMA_M / res5
        num, den = ndimage.gaussian_filter(d, s), ndimage.gaussian_filter(full.astype("float64"), s)
        dsm = np.where(den > 1e-6, num / np.maximum(den, 1e-6), 0.0)
        dist, (ri, ci) = ndimage.distance_transform_edt(~full, return_indices=True)
        w = np.clip(1.0 - (dist - 0.5) * res5 / BLEND_M, 0.0, 1.0)
        shift = w * dsm[ri, ci]
        out[gap] = z5[gap] + shift[gap]
        stats.update(seam_shift_m={"median_abs": round(float(np.median(np.abs(dsm[ri, ci][gap & (w > 0)]))), 2) if (gap & (w > 0)).any() else 0.0,
                                   "max_abs": round(float(np.abs(shift[gap]).max()), 2)})
    if full.any():
        k = max(1, n5 // 20)
        dd = (z5 - mean1)[k:-k, k:-k][full[k:-k, k:-k]]
        stats["fetched_minus_1m"] = {"mean_m": round(float(dd.mean()), 2), "std_m": round(float(dd.std()), 2)} if dd.size else None
    out[(z5 == NODATA) & ~full] = NODATA
    return out.astype("float32"), stats


def drawn_dem(tile: Tile, info: dict, force=False) -> dict:
    """After fetch_dem: build the 1 m mosaic (pipeline/lidar.build_dem_1m: terrain/dem_1m.tif, the lidar step reuses it)
    and, when it covers DRAWN_1M_MIN_SHARE of the tile, rewrite terrain/dem.tif from it (the fetched DEM kept as
    terrain/dem_5m.tif). Returns the terrain.dem layer (and terrain.dem_5m under "_fetched" when the rule applied)."""
    import shutil
    from . import regions, runlog
    from .config import read_json
    fetched_p = tile.path(FETCHED)
    if not regions.covers("usgs_3dep_lidar", tile) or info.get("surface_model"):
        fetched_p.unlink(missing_ok=True)
        return info
    shutil.copyfile(tile.path("terrain/dem.tif"), fetched_p)   # lidar._fill_from_5m fills the 1 m gaps from the fetched DEM
    try:
        from .lidar import build_dem_1m
        d1 = build_dem_1m(tile, force=False)
    except Exception as e:  # noqa: BLE001
        runlog.fallback(f"the 1 m DEM products could not be read ({str(e)[:160]}): the drawn DEM is the fetched {info.get('source')}",
                        source=info.get("source"))
        fetched_p.unlink(missing_ok=True)
        return {**info, "drawn": f"fetched: 1 m products unreadable ({str(e)[:120]})"}
    cov = d1.get("coverage") or {}
    share = float(cov.get("share_1m", 1.0))
    if share < DRAWN_1M_MIN_SHARE:
        fetched_p.unlink(missing_ok=True)
        return {**info, "drawn": f"fetched: the 1 m products cover {share:.1%} of the tile (< {DRAWN_1M_MIN_SHARE:.0%})",
                "share_1m": share}
    with rasterio.open(fetched_p) as src:
        z5 = src.read(1).astype("float64")
    with rasterio.open(tile.path("terrain/dem_1m.tif")) as src:
        z1 = src.read(1)
    sp = tile.path("terrain/dem_1m_source.tif")
    src1 = None
    if sp.exists():
        with rasterio.open(sp) as src:
            src1 = src.read(1)
    if z1.shape[0] % z5.shape[0]:
        fetched_p.unlink(missing_ok=True)
        return {**info, "drawn": f"fetched: the 1 m grid ({z1.shape[0]}) is not a multiple of the drawn grid ({z5.shape[0]})"}
    out, st = draw_from_1m(z5, z1, src1, info["resolution_m"])
    del z1, src1
    n = z5.shape[0]
    _write_dem(tile.path("terrain/dem.tif"), out, tile, n)
    valid = out != NODATA
    fetched_layer = {**info, "path": FETCHED,
                     "encoding": "the DEM as fetched (terrain.dem's source before the 1 m rule): fills terrain.dem where the 1 m products do not reach"}
    return {
        "path": "terrain/dem.tif", "kind": "raster", "resolution_m": info["resolution_m"], "units": "m", "nodata": NODATA,
        "source": "usgs_3dep_1m", "source_resolution_m": 1.0, "sources_used": sorted({"usgs_3dep_1m", info.get("source")} - {None}),
        "drawn": "the 1 m ground averaged (fetch_dem.DRAWN_1M_MIN_SHARE rule)", "share_1m": share,
        "fetched_source": info.get("source"), "derived_from": ["terrain.dem_5m", "terrain.dem_1m"],
        "encoding": (f"each {info['resolution_m']:g} m cell the mean of its 1 m cells (terrain/dem_1m.tif) where all are the "
                     f"1 m product's; elsewhere terrain/dem_5m.tif, shifted onto the 1 m ground within {BLEND_M:g} m of it"),
        "drawn_stats": st,
        "stats": {"min": float(out[valid].min()), "max": float(out[valid].max()), "valid_fraction": float(valid.mean())},
        "_fetched": fetched_layer,
    }
