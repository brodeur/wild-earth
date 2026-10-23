"""Export a tile for Unreal Engine 5 Landscape import.

Writes under <tile>/unreal/:
  heightmap.png          16-bit grayscale, Landscape-valid size (default 2017 px)
  weights/<layer>.png    8-bit weight-blended layer masks from the rewilded habitat
  canopy_tree.png etc.   8-bit cover percentages for PCG density
  unreal.json            every number the import dialog and the Landscape actor need

Height encoding follows Unreal's convention: 0..65535 maps to -256..+256 m at
Z scale 100, so the Z scale is chosen to fit the tile's relief and the actor's Z
location carries the mid elevation.
"""
from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject

from .config import Tile, write_json
from .habitat import CLASSES

# Landscape sizes that import cleanly with 63x63-quad sections, 1 section per component.
VALID_SIZES = {127: 2, 253: 4, 505: 8, 1009: 16, 2017: 32, 4033: 64, 8129: 128}
LAYER_CLASSES = {code: name for code, name in CLASSES.items() if name != "human"}


def _resample(tile: Tile, arr: np.ndarray, src_transform, size: int, resampling, dtype="float32") -> np.ndarray:
    x0, y0, x1, y1 = tile.bounds
    out = np.zeros((size, size), dtype)
    reproject(arr.astype(dtype), out, src_transform=src_transform, src_crs=tile.crs,
              dst_transform=from_bounds(x0, y0, x1, y1, size, size), dst_crs=tile.crs, resampling=resampling)
    return out


def export_unreal(tile: Tile, size: int = 2017) -> dict:
    if size not in VALID_SIZES:
        raise ValueError(f"size must be one of {sorted(VALID_SIZES)}")
    x0, y0, x1, y1 = tile.bounds
    quads = size - 1
    scale_xy_cm = (x1 - x0) / quads * 100.0

    # --- heightmap ---------------------------------------------------------------
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        dem = src.read(1).astype("float32")
        tr = src.transform
        nodata = src.nodata
    dem[dem == nodata] = np.nan
    dem = np.where(np.isnan(dem), np.nanmean(dem), dem)
    h = _resample(tile, dem, tr, size, Resampling.bilinear)
    lo, hi = float(h.min()), float(h.max())
    mid = (lo + hi) / 2
    half = max((hi - lo) / 2 * 1.05, 1.0)              # 5 % headroom
    scale_z = half * 100.0 / 256.0                       # so +/-256 m of encoded height spans +/-half
    v = np.clip(np.round(32768 + (h - mid) / half * 32767), 0, 65535).astype("uint16")
    Image.fromarray(v, mode="I;16").save(tile.path("unreal/heightmap.png"))

    # --- weightmaps from the rewilded habitat ------------------------------------
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        hab = src.read(1)
        htr = src.transform
    weights = {}
    for code, name in LAYER_CLASSES.items():
        mask = (hab == code).astype("float32")
        if not mask.any():
            continue
        weights[name] = _resample(tile, mask, htr, size, Resampling.bilinear)   # soft edges across cells
    total = np.sum(list(weights.values()), axis=0)
    total[total == 0] = 1
    layer_files = {}
    for name, w in weights.items():
        img = np.clip(np.round(w / total * 255), 0, 255).astype("uint8")
        Image.fromarray(img, mode="L").save(tile.path(f"unreal/weights/{name}.png"))
        layer_files[name] = {"path": f"unreal/weights/{name}.png", "coverage": round(float((w / total).mean()), 4)}

    # --- canopy density for PCG ----------------------------------------------------
    with rasterio.open(tile.path("vegetation/evc.tif")) as src:
        evc = src.read(1)
    canopy_files = {}
    for name, lo_c, hi_c in (("tree", 101, 199), ("shrub", 201, 299), ("herb", 301, 399)):
        pct = np.where((evc >= lo_c) & (evc <= hi_c), evc - (lo_c - 1), 0).astype("float32")
        img = np.clip(np.round(_resample(tile, pct, htr, size, Resampling.bilinear) * 2.55), 0, 255).astype("uint8")
        Image.fromarray(img, mode="L").save(tile.path(f"unreal/canopy_{name}.png"))
        canopy_files[name] = f"unreal/canopy_{name}.png"

    settings = {
        "tile_id": tile.tile_id, "crs": tile.crs, "bounds": list(tile.bounds),
        "heightmap": {"path": "unreal/heightmap.png", "format": "16-bit PNG", "size_px": size},
        "landscape": {
            "overall_resolution": f"{size} x {size}", "section_size_quads": 63, "sections_per_component": 1,
            "components": f"{VALID_SIZES[size]} x {VALID_SIZES[size]}",
            "scale_cm": {"x": round(scale_xy_cm, 4), "y": round(scale_xy_cm, 4), "z": round(scale_z, 4)},
            "actor_location_cm": {"x": 0, "y": 0, "z": round(mid * 100.0, 1)},
            "note": "Place the actor so its centre is the tile centre; Unreal's Y points south, which matches "
                    "image row order (row 0 = north edge), so no flip is needed.",
        },
        "elevation_m": {"min": round(lo, 2), "max": round(hi, 2), "mid": round(mid, 2),
                        "encoded_span": round(half * 2, 2), "vertical_step_m": round(half * 2 / 65535, 4)},
        "layers": layer_files, "canopy": canopy_files,
        "pcg_hint": "Sample canopy_tree.png for tree density and the weight layers for species mix; "
                    "seed points by (tile_id, cell) so placement matches the web client.",
    }
    write_json(tile.path("unreal/unreal.json"), settings)
    return {"path": "unreal/unreal.json", "kind": "table", "derived_from": ["terrain.dem", "vegetation.habitat", "vegetation.evc"],
            "size_px": size, "scale_cm": settings["landscape"]["scale_cm"], "layers": sorted(layer_files)}
