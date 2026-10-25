"""Vegetation: LANDFIRE existing vegetation (type, cover, height) and Biophysical
Settings, from the LANDFIRE ArcGIS image services, plus a habitat classification with
human pixels backfilled from BpS (the first real 'erase and backfill').
"""
from __future__ import annotations

import csv
import io

import numpy as np
import rasterio
from rasterio.transform import from_bounds

from .config import REPO_ROOT, SOURCES, Tile, write_json
from .habitat import CLASSES, COLORS, apply_rewilded_beds, classify_bps, classify_evt
from .http import download, get

LF = "https://lfps.usgs.gov/arcgis/rest/services"
PRODUCTS = {
    "evt": (f"{LF}/Landfire_LF2025/LF2025_EVT_CONUS/ImageServer", "https://landfire.gov/sites/default/files/CSV/LF2025/LF2025_EVT.csv"),
    "evc": (f"{LF}/Landfire_LF2025/LF2025_EVC_CONUS/ImageServer", "https://landfire.gov/sites/default/files/CSV/LF2025/LF2025_EVC.csv"),
    "evh": (f"{LF}/Landfire_LF2025/LF2025_EVH_CONUS/ImageServer", "https://landfire.gov/sites/default/files/CSV/LF2025/LF2025_EVH.csv"),
    "bps": (f"{LF}/Landfire_LF2016/LF2016_BPS_CONUS/ImageServer", "https://landfire.gov/sites/default/files/CSV/LF2016/LF16_BPS.csv"),
}
RES_M = 30.0
NODATA = -9999

SOURCES["landfire"] = {"name": "LANDFIRE LF 2025 (EVT, EVC, EVH) and LF 2016 Biophysical Settings",
                       "url": "https://landfire.gov", "license": "public domain"}


def _table(name: str) -> dict[int, dict]:
    cache = REPO_ROOT / "pipeline" / "_cache" / f"{name}.csv"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(get(PRODUCTS[name][1]).content)
    rows = csv.DictReader(io.StringIO(cache.read_text(encoding="utf-8-sig")))
    return {int(r["VALUE"]): r for r in rows}


def _export(tile: Tile, name: str, n: int, force=False) -> np.ndarray:
    x0, y0, x1, y1 = tile.bounds
    raw = tile.path(f"_cache/landfire_{name}.tif")
    download(PRODUCTS[name][0] + "/exportImage", {
        "bbox": f"{x0},{y0},{x1},{y1}", "bboxSR": tile.epsg, "imageSR": tile.epsg,
        "size": f"{n},{n}", "format": "tiff", "pixelType": "S16", "noData": NODATA,
        "interpolation": "RSP_NearestNeighbor", "f": "image"}, raw, force=force)
    with rasterio.open(raw) as src:
        return src.read(1).astype("int16")


def _write(tile: Tile, rel: str, arr: np.ndarray, n: int, dtype: str, nodata) -> None:
    x0, y0, x1, y1 = tile.bounds
    with rasterio.open(tile.path(rel), "w", driver="GTiff", dtype=dtype, count=1, width=n, height=n,
                       crs=tile.crs, transform=from_bounds(x0, y0, x1, y1, n, n), nodata=nodata,
                       compress="lzw") as dst:
        dst.write(arr.astype(dtype), 1)


def fetch_vegetation(tile: Tile, force=False) -> dict:
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / RES_M))
    rasters = {k: _export(tile, k, n, force) for k in PRODUCTS}
    tables = {k: _table(k) for k in PRODUCTS}

    # Per-code habitat class lookups, restricted to codes present in the tile.
    classes = {"habitat": {str(k): {"name": v, "color": COLORS[k]} for k, v in CLASSES.items()}}
    evt_class, bps_class = {}, {}
    for k in ("evt", "evc", "evh", "bps"):
        present = {}
        for code in np.unique(rasters[k]):
            code = int(code)
            row = tables[k].get(code)
            if row is None or code == NODATA:
                continue
            if k == "evt":
                evt_class[code] = classify_evt(row["EVT_PHYS"], row["EVT_NAME"])
                present[code] = {"name": row["EVT_NAME"], "phys": row["EVT_PHYS"], "group": row["EVT_GP_N"],
                                 "habitat": CLASSES[evt_class[code]],
                                 "color": [int(row["R"]), int(row["G"]), int(row["B"])],
                                 "pixels": int((rasters[k] == code).sum())}
            elif k == "bps":
                bps_class[code] = classify_bps(row["GROUPVEG"], row["BPS_NAME"])
                present[code] = {"name": row["BPS_NAME"], "group": row["GROUPVEG"],
                                 "habitat": CLASSES[bps_class[code]],
                                 "fire_return_interval_yr": {"replacement": row["FRI_REPLAC"], "mixed": row["FRI_MIXED"],
                                                             "surface": row["FRI_SURFAC"], "all": row["FRI_ALLFIR"]},
                                 "pixels": int((rasters[k] == code).sum())}
            else:
                present[code] = {"name": row["CLASSNAMES"], "pixels": int((rasters[k] == code).sum())}
        classes[k] = {str(c): v for c, v in present.items()}

    def remap(arr, lut):
        out = np.zeros(arr.shape, "uint8")
        for code, cls in lut.items():
            out[arr == code] = cls
        return out

    present_cls = remap(rasters["evt"], evt_class)
    bps_cls = remap(rasters["bps"], bps_class)
    human = present_cls == 9
    rewilded = present_cls.copy()
    fill = np.where((bps_cls == 0) | (bps_cls == 9), 5, bps_cls)
    rewilded[human] = fill[human]
    # LANDFIRE marks roads/buildings as developed, but water bodies stay water.
    rewilded[rasters["evt"] == NODATA] = 0
    # Former reservoir and stock-pond beds (rewild_hydro): meadow and riparian corridor, not water.
    beds = apply_rewilded_beds(tile, present_cls, rewilded)

    for k in PRODUCTS:
        _write(tile, f"vegetation/{k}.tif", rasters[k], n, "int16", NODATA)
    _write(tile, "vegetation/habitat_present.tif", present_cls, n, "uint8", 0)
    _write(tile, "vegetation/habitat.tif", rewilded, n, "uint8", 0)
    write_json(tile.path("vegetation/classes.json"), classes)

    total = (present_cls > 0).sum()
    hist = lambda a: {CLASSES[c]: round(float((a == c).sum() / total), 4) for c in CLASSES if (a == c).any()}  # noqa: E731
    out = {}
    for k in PRODUCTS:
        out[f"vegetation.{k}"] = {"path": f"vegetation/{k}.tif", "kind": "raster", "resolution_m": RES_M,
                                 "source": "landfire", "classes": len(classes[k])}
    out["vegetation.habitat_present"] = {"path": "vegetation/habitat_present.tif", "kind": "raster", "resolution_m": RES_M,
                                         "derived_from": "vegetation.evt", "fractions": hist(present_cls)}
    out["vegetation.habitat"] = {"path": "vegetation/habitat.tif", "kind": "raster", "resolution_m": RES_M,
                                 "derived_from": ["vegetation.evt", "vegetation.bps"],
                                 "backfilled_fraction": round(float(human.sum() / total), 4), "fractions": hist(rewilded)}
    if beds:
        out["vegetation.habitat"]["rewilded_beds"] = beds
    out["vegetation.classes"] = {"path": "vegetation/classes.json", "kind": "table"}
    return out
