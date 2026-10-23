"""Seasonal resource rasters: what each activity verb needs, as 0-100 scores on the
30 m habitat grid, one GeoTIFF per resource (4 bands = seasons) plus RGBA PNGs in
WGS84 for the viewer.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from .config import Tile, write_json
from .habitat import RESOURCE_BASE, RESOURCE_COLORS, RESOURCE_SEASON, SEASONS

PNG_PX = 668


def _read(tile: Tile, rel: str):
    with rasterio.open(tile.path(rel)) as src:
        return src.read(1), src.transform, src.res[0]


def _slope_deg_on_grid(tile: Tile, shape_, transform) -> np.ndarray:
    dem, tr, res = _read(tile, "terrain/dem.tif")
    dem = dem.astype("float64")
    dem[dem == -9999] = np.nan
    dy, dx = np.gradient(dem, res)
    slope = np.degrees(np.arctan(np.nan_to_num(np.hypot(dx, dy)))).astype("float32")
    out = np.zeros(shape_, "float32")
    reproject(slope, out, src_transform=tr, src_crs=tile.crs, dst_transform=transform, dst_crs=tile.crs,
              resampling=Resampling.max)
    return out


def _water_score(tile: Tile, shape_, transform, res) -> dict[str, np.ndarray]:
    """Proximity to water on the grid: 100 at the water, falling to 0 at 500 m.
    Perennial water counts all year; intermittent only in winter and spring."""
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    perennial, intermittent = [], []
    with open(tile.path("hydro/flowlines.geojson")) as f:
        for feat in json.load(f)["features"]:
            fcode = int(feat["properties"].get("fcode") or 0)
            g = shp_transform(to_tile, shape(feat["geometry"]))
            (intermittent if fcode in (46003, 46007) else perennial).append(g)
    with open(tile.path("hydro/waterbodies.geojson")) as f:
        for feat in json.load(f)["features"]:
            perennial.append(shp_transform(to_tile, shape(feat["geometry"])))

    def score(geoms):
        out = np.zeros(shape_, "float32")
        for dist, val in ((500, 20), (250, 45), (100, 75), (30, 100)):
            shapes = [(g.buffer(max(dist, res / 2)), val) for g in geoms if not g.is_empty]
            if shapes:
                layer = rasterize(shapes, out_shape=shape_, transform=transform, fill=0, dtype="uint8")
                out = np.maximum(out, layer)
        return out

    p, i = score(perennial), score(intermittent)
    return {"winter": np.maximum(p, i), "spring": np.maximum(p, i), "summer": p, "fall": p}


def derive_resources(tile: Tile) -> dict:
    habitat, transform, res = _read(tile, "vegetation/habitat.tif")
    evc, _, _ = _read(tile, "vegetation/evc.tif")
    n = habitat.shape[0]
    tree_cover = np.where((evc >= 101) & (evc <= 199), evc - 100, 0).astype("float32")
    shrub_cover = np.where((evc >= 201) & (evc <= 299), evc - 200, 0).astype("float32")
    slope = _slope_deg_on_grid(tile, habitat.shape, transform)
    water = _water_score(tile, habitat.shape, transform, res)
    w, s, e, nn = tile.bounds_wgs84
    png_transform = from_bounds(w, s, e, nn, PNG_PX, PNG_PX)

    def to_png(arr: np.ndarray) -> np.ndarray:
        out = np.zeros((PNG_PX, PNG_PX), "uint8")
        reproject(arr.astype("uint8"), out, src_transform=transform, src_crs=tile.crs,
                  dst_transform=png_transform, dst_crs="EPSG:4326", resampling=Resampling.nearest, dst_nodata=0)
        return out

    files, stats = {}, {}
    for resource, base in RESOURCE_BASE.items():
        lut = np.zeros(256, "float32")
        for cls, v in base.items():
            lut[cls] = v
        base_arr = lut[habitat]
        if resource == "cover":
            base_arr = np.maximum(base_arr, np.maximum(tree_cover * 0.9, shrub_cover * 0.8))
        if resource == "cliff_or_snag":
            base_arr = np.maximum(base_arr, np.where(slope > 35, 90, np.where(slope > 25, 60, 0)))
        if resource == "cavity":
            base_arr = np.where(tree_cover > 0, base_arr * np.clip(0.5 + tree_cover / 100, 0.5, 1.2), base_arr * 0.3)
        bands, files[resource], stats[resource] = [], {}, {}
        for si, season in enumerate(SEASONS):
            arr = base_arr * RESOURCE_SEASON[resource][season]
            if resource == "water":
                arr = water[season]
            arr = np.clip(arr, 0, 100)
            arr[habitat == 0] = 0
            bands.append(arr.astype("uint8"))
            rgba = np.zeros((PNG_PX, PNG_PX, 4), "uint8")
            rgba[..., :3] = RESOURCE_COLORS[resource]
            rgba[..., 3] = (to_png(arr).astype("float32") * 2.2).clip(0, 220).astype("uint8")
            rel = f"resources/{resource}_{season}.png"
            Image.fromarray(rgba, "RGBA").save(tile.path(rel), optimize=True)
            files[resource][season] = rel
            stats[resource][season] = round(float(arr.mean()), 1)
        x0, y0, x1, y1 = tile.bounds
        with rasterio.open(tile.path(f"resources/{resource}.tif"), "w", driver="GTiff", dtype="uint8", count=4,
                           width=n, height=n, crs=tile.crs, transform=from_bounds(x0, y0, x1, y1, n, n),
                           compress="lzw") as dst:
            dst.write(np.stack(bands))
            dst.descriptions = tuple(SEASONS)
    meta = {"grid": {"resolution_m": res, "pixels": n, "crs": tile.crs}, "seasons": SEASONS,
            "resources": list(RESOURCE_BASE), "png": files, "png_bounds": [w, s, e, nn],
            "tables": {"base": RESOURCE_BASE, "season": RESOURCE_SEASON}, "colors": RESOURCE_COLORS,
            "mean_score": stats}
    write_json(tile.path("resources/resources.json"), meta)
    return {"path": "resources/resources.json", "kind": "table", "derived_from": ["vegetation.habitat", "vegetation.evc",
                                                                                 "terrain.dem", "hydro.flowlines"],
            "resources": list(RESOURCE_BASE), "mean_score": stats}
