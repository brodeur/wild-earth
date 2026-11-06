"""The measured stand height per 30 m cell, for the client's tree heights (client/src/stature.js).

    client/canopy_top.png   on the habitat grid (client/habitat.png's pixels): R = the stand's top height in 0.5 m
                            steps (0: no measurement, or no trees the map can see; 255 = 127.5 m and over)

Read from vegetation/canopy_height_10m.tif (band 1 the p95 height of each 10 m cell, band 2 its tree cover % >= 4 m),
which the world pipeline's landcover step writes from the Meta / WRI 1 m canopy height map (landcover_global.py) and
the lidar step writes from the point cloud's CHM (lidar.py). A tile with neither (LANDFIRE only: EVH is a modelled
class, not a measurement) has no layer and keeps the modelled heights.

The statistic: the mean of the p95 heights of the cell's 10 m sub-cells that hold trees (tree cover >= TREED %),
where at least MIN_TREED of the nine do; a cell with none takes the mean of the measured cells within FILL cells. It
is the top of the canopy where there is canopy: the open ground between a savanna's acacias does not pull it down, a
closed forest's gaps do a little. The client draws its own trees to the
same statistic (stature.js standTop: the crowns of a cell's mix, by crown area) and scales the cell's curves so the
two agree.
"""
from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image

from .config import Tile

TREED = 12.0       # % tree cover (>= 4 m) for a 10 m sub-cell to count as canopy: 3 of its 2 m pixels, so its p95 is a crown's
MIN_TREED = 1      # of the nine sub-cells: a savanna's lone acacia is the stand its cell has
FILL = 2           # a cell the map sees no trees in takes the mean of the measured cells within FILL cells (the trees the
                   # client still draws there, a stream's gallery under the map's resolution, stand as their neighbours)
STEP_M = 0.5       # R units


def _blocks(a: np.ndarray, k: int, n: int) -> np.ndarray:
    a = a[:n * k, :n * k]
    if a.shape[0] < n * k:
        a = np.pad(a, ((0, n * k - a.shape[0]), (0, n * k - a.shape[1])), mode="edge")
    return a.reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)


def stand_top(p95: np.ndarray, tree: np.ndarray, n: int) -> np.ndarray:
    """(N, N) 10 m p95 heights and tree cover -> (n, n) stand top (m; 0 where unmeasured) on a grid of n cells."""
    k = int(round(p95.shape[0] / n))
    P, T = _blocks(np.nan_to_num(p95, nan=0.0), k, n), _blocks(np.nan_to_num(tree, nan=0.0), k, n)
    ok = (T >= TREED) & (P > 0)
    cnt = ok.sum(-1)
    top = np.where(cnt >= MIN_TREED, (P * ok).sum(-1) / np.maximum(cnt, 1), 0.0)
    if FILL:
        from scipy import ndimage
        have = (top > 0).astype("float64")
        size = 2 * FILL + 1
        s_ = ndimage.uniform_filter(top.astype("float64"), size, mode="constant")
        c_ = ndimage.uniform_filter(have, size, mode="constant")
        top = np.where(top > 0, top, np.where(c_ > 1e-9, s_ / np.maximum(c_, 1e-9), 0.0))
    return top.astype("float32")


def canopy_top(tile: Tile) -> dict:
    src = tile.path("vegetation/canopy_height_10m.tif")
    with rasterio.open(src) as s:
        p95, tree = s.read(1).astype("float32"), s.read(2).astype("float32")
        nd = s.nodata
    if nd is not None:
        p95[p95 == nd] = 0
        tree[tree == nd] = 0
    n = Image.open(tile.path("client/habitat.png")).size[0]
    top = stand_top(p95, tree, n)
    r = np.clip(np.round(top / STEP_M), 0, 255).astype("uint8")
    Image.fromarray(r, "L").save(tile.path("client/canopy_top.png"), optimize=True)
    v = top[top > 0]
    return {"path": "client/canopy_top.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": n, "resolution_m": tile.size_m / n if hasattr(tile, "size_m") else 10000 / n,
            "encoding": f"R = the stand's top height in {STEP_M} m steps (0 none): the mean p95 height of the cell's "
                        f"10 m sub-cells with tree cover >= {TREED:g} %, where {MIN_TREED} or more of them do; else the "
                        f"mean of the measured cells within {FILL} cells",
            "derived_from": ["vegetation.canopy_height_10m"],
            "stats": {"cells": int(v.size), "median_m": round(float(np.median(v)), 1) if v.size else None,
                      "p90_m": round(float(np.percentile(v, 90)), 1) if v.size else None}}
