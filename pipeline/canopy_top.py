"""The measured stand height per 30 m cell, for the client's tree heights (client/src/stature.js).

    client/canopy_top.png   on the habitat grid (client/habitat.png's pixels): R = the stand's top height in 0.5 m
                            steps (0: no measurement, or no trees the map can see; 255 = 127.5 m and over)

The statistic: the mean of the p95 heights of the cell's 10 m sub-cells that hold trees (tree cover >= TREED %),
where at least MIN_TREED of the nine do; a cell with none takes the mean of the measured cells within FILL cells. It
is the top of the canopy where there is canopy: the open ground between a savanna's acacias does not pull it down, a
closed forest's gaps do a little. The client draws its own trees to the same statistic (stature.js standTop: the crowns
of a cell's mix, by crown area) and scales the cell's curves so the two agree.

Which map (2026-11-06, iteration 6; docs/decisions.md). A lidar tile reads its own point cloud's CHM
(vegetation/canopy_height_10m.tif from lidar.py): airborne lidar is the measurement the maps are trained and judged on,
and it wins. A global tile has three maps of the same canopy (pipeline/canopy_maps.py):

  - Meta / WRI CHM v1 (Tolan et al. 2024; the landcover step's vegetation/canopy_height_10m.tif)
  - Meta / WRI CHM v2 (Brandt et al. 2026), the same 1 m method retrained on far more airborne lidar: on their held-out
    lidar its mean absolute error is 3.0 m against v1's 4.3, its bias 0.0 m against v1's +2.6, with "a marked
    improvement" at 30 m and over, though it "still underestimates the upper tail" (emergents, very tall forest)
  - ETH Global Canopy Height 2020 (Lang et al. 2023), 10 m from Sentinel-2, calibrated on GEDI's RH98 canopy tops: no
    crowns or gaps (it correlates with the 1 m maps at r 0.1-0.45 per 10 m cell on the probe tiles, its own standard
    deviation 7-12 m in the tropics), on the CHMv2 paper's lidar test 8.4 m mean absolute error, and in Moudry et al.
    2024's lidar comparison overestimating low canopies and underestimating tall ones

The rule: CHM v2 is the stand (its crowns, gaps and emergents; v1 where v2 has no data). Where the forest is tall and
closed, the level comes from the map that saturates least: in each LIFT_BLOCK (about 1 km) the medians of the closed
cells' tops (all nine sub-cells treed) by CHM v2 and by ETH are compared, and where ETH's is higher the difference is
added to every treed cell of the block (scaled by its treed share of nine sub-cells, interpolated between blocks), with a
weight rising from 0 where CHM v2's own block median is LIFT_FROM m to 1 at LIFT_FULL m. The gate is v2's height, not
ETH's: at Danum both Meta maps draw the same sharp edge between the tall primary forest (v2 40-45 m) and the logged forest
beside it (v2 20-28 m, v1 10-20 m) while ETH reads 43-49 m on both sides, so ETH says how tall the tall forest is, not
where it is. Below the gate v2 is unbiased (Brandt et al.) and ETH overestimates (Moudry et al.), so a logged or short
forest, a savanna, a heath keep v2 as it is. An additive lift keeps v2's own
contrasts in metres (the gap is still a gap, the emergent still stands over the canopy); it moves the level only. The
species' own sourced heights then hold where they agree with the chosen top (stature.js speciesScale).
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
LIFT_BLOCK = 33    # cells (~1 km): the window the two maps' closed-forest medians are compared over (ETH's own detail is
                   # far coarser than its 10 m pixel; a block holds about 1,000 closed cells in a closed forest)
LIFT_MIN = 100     # closed cells a block needs for a comparison; a block with fewer (open land, water) is not lifted
LIFT_FROM, LIFT_FULL = 25.0, 35.0   # CHM v2's own closed-forest median (m) where the lift starts and where it is whole:
                                    # centred on 30 m, where the Meta maps' tall-canopy bias is reported (Brandt et al.)
NODATA = -9999.0


def _blocks(a: np.ndarray, k: int, n: int) -> np.ndarray:
    a = a[:n * k, :n * k]
    if a.shape[0] < n * k:
        a = np.pad(a, ((0, n * k - a.shape[0]), (0, n * k - a.shape[1])), mode="edge")
    return a.reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)


def raw_top(p95: np.ndarray, tree: np.ndarray, n: int, value: np.ndarray | None = None):
    """(N, N) 10 m p95 heights and tree cover -> ((n, n) stand top, 0 unmeasured; (n, n) treed sub-cells per cell).
    `value`, when given, is averaged over the treed sub-cells instead of p95 (another map's heights on this map's trees)."""
    k = int(round(p95.shape[0] / n))
    P, T = _blocks(np.nan_to_num(p95, nan=0.0), k, n), _blocks(np.nan_to_num(tree, nan=0.0), k, n)
    ok = (T >= TREED) & (P > 0)
    V = P if value is None else _blocks(np.nan_to_num(value, nan=0.0), k, n)
    if value is not None:
        ok &= V > 0
    cnt = ok.sum(-1)
    top = np.where(cnt >= MIN_TREED, (V * ok).sum(-1) / np.maximum(cnt, 1), 0.0)
    return top.astype("float32"), cnt


def fill(top: np.ndarray) -> np.ndarray:
    if not FILL:
        return top
    from scipy import ndimage
    have = (top > 0).astype("float64")
    size = 2 * FILL + 1
    s_ = ndimage.uniform_filter(top.astype("float64"), size, mode="constant")
    c_ = ndimage.uniform_filter(have, size, mode="constant")
    return np.where(top > 0, top, np.where(c_ > 1e-9, s_ / np.maximum(c_, 1e-9), 0.0)).astype("float32")


def stand_top(p95: np.ndarray, tree: np.ndarray, n: int) -> np.ndarray:
    """(N, N) 10 m p95 heights and tree cover -> (n, n) stand top (m; 0 where unmeasured) on a grid of n cells."""
    return fill(raw_top(p95, tree, n)[0])


def _weight(med_v2):
    return np.clip((med_v2 - LIFT_FROM) / (LIFT_FULL - LIFT_FROM), 0.0, 1.0)


def tall_lift(top: np.ndarray, cnt: np.ndarray, eth_top: np.ndarray, k: int = 9) -> tuple[np.ndarray, dict]:
    """The lift (m) per cell from the GEDI-calibrated map where the forest is tall and closed (the module docstring)."""
    from scipy import ndimage
    n = top.shape[0]
    closed = (cnt >= k) & (top > 0) & (eth_top > 0)
    stats = {"closed_cells": int(closed.sum())}
    if closed.sum() >= LIFT_MIN:
        me, mv = float(np.median(eth_top[closed])), float(np.median(top[closed]))
        whole = float(_weight(mv) * max(0.0, me - mv))
        stats.update({"closed_median_v2_m": round(mv, 1), "closed_median_eth_m": round(me, 1)})
    else:
        whole = 0.0
    nb = int(np.ceil(n / LIFT_BLOCK))
    lift_b = np.zeros((nb, nb), "float64")
    for bi in range(nb):
        for bj in range(nb):
            sl = (slice(bi * LIFT_BLOCK, (bi + 1) * LIFT_BLOCK), slice(bj * LIFT_BLOCK, (bj + 1) * LIFT_BLOCK))
            c = closed[sl]
            if c.sum() >= LIFT_MIN:
                me, mv = np.median(eth_top[sl][c]), np.median(top[sl][c])
                lift_b[bi, bj] = _weight(mv) * max(0.0, me - mv)
    lift = ndimage.zoom(lift_b, LIFT_BLOCK, order=1, mode="nearest", grid_mode=True)[:n, :n]
    if lift.shape[0] < n:
        lift = np.pad(lift, ((0, n - lift.shape[0]), (0, n - lift.shape[1])), mode="edge")
    stats["lift_m"] = {"tile": round(whole, 1), "block_min": round(float(lift_b.min()), 1),
                       "block_max": round(float(lift_b.max()), 1)}
    return (lift * (cnt / k) * (top > 0)).astype("float32"), stats


def _read(tile: Tile, rel: str, bands=(1, 2)) -> list[np.ndarray]:
    with rasterio.open(tile.path(rel)) as s:
        out = [s.read(b).astype("float32") for b in bands]
        nd = s.nodata
    for a in out:
        a[~np.isfinite(a)] = 0
        if nd is not None:
            a[a == nd] = 0
        a[a <= NODATA + 1] = 0
    return out


def choose(tile: Tile, n: int, lidar: bool) -> tuple[np.ndarray, dict]:
    """The stand top per cell by the rule (the module docstring), and what each map said."""
    p1, t1 = _read(tile, "vegetation/canopy_height_10m.tif")
    if lidar:
        return stand_top(p1, t1, n), {"rule": "lidar CHM (the point cloud): the measurement the maps are judged on"}
    with rasterio.open(tile.path("vegetation/canopy_height_v2_10m.tif")) as s:
        v2valid = s.read(1) > NODATA + 1
    p2, t2 = _read(tile, "vegetation/canopy_height_v2_10m.tif")
    # where v2 has no data (its own mask: imagery it did not map), v1 brought to v2's level by their ratio on the
    # sub-cells both see trees in, so a hole in v2 is not a step down to v1
    both = v2valid & (t1 >= TREED) & (t2 >= TREED) & (p1 >= 4) & (p2 >= 4)
    ratio = float(np.median(p2[both] / p1[both])) if both.sum() >= 1000 else 1.0
    p = np.where(v2valid, p2, p1 * ratio)
    t = np.where(v2valid, t2, t1)
    eth, = _read(tile, "vegetation/canopy_height_eth_10m.tif", (1,))
    top, cnt = raw_top(p, t, n)
    eth_top, _ = raw_top(p, t, n, value=eth)
    lift, st = tall_lift(top, cnt, eth_top)
    out = fill(np.where(top > 0, top + lift, 0.0).astype("float32"))

    def q(a):
        a = a[a > 0]
        return [round(float(x), 1) for x in np.percentile(a, [50, 90, 95])] if a.size else None
    st.update({"rule": "CHM v2 (v1 at v2's level where v2 has no data), lifted to ETH's level where v2 sees tall closed forest",
               "v2_off_map_share": round(float(1 - v2valid.mean()), 3), "v1_to_v2_ratio": round(ratio, 3),
               "p50_p90_p95_m": {"chm_v1": q(raw_top(p1, t1, n)[0]), "chm_v2": q(top), "eth": q(eth_top),
                                 "chosen": q(np.where(top > 0, top + lift, 0.0))}})
    return out, st


def canopy_top(tile: Tile, source: str | None = None) -> dict:
    """`source`: the manifest source of vegetation.canopy_height_10m (a 3DEP point cloud's, or Meta's map)."""
    lidar = bool(source) and source.startswith("usgs_3dep")
    n = Image.open(tile.path("client/habitat.png")).size[0]
    top, st = choose(tile, n, lidar)
    r = np.clip(np.round(top / STEP_M), 0, 255).astype("uint8")
    Image.fromarray(r, "L").save(tile.path("client/canopy_top.png"), optimize=True)
    v = top[top > 0]
    derived = ["vegetation.canopy_height_10m"] + ([] if lidar else ["vegetation.canopy_height_v2_10m",
                                                                   "vegetation.canopy_height_eth_10m"])
    return {"path": "client/canopy_top.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": n, "resolution_m": tile.size_m / n if hasattr(tile, "size_m") else 10000 / n,
            "encoding": f"R = the stand's top height in {STEP_M} m steps (0 none): the mean p95 height of the cell's "
                        f"10 m sub-cells with tree cover >= {TREED:g} %, where {MIN_TREED} or more of them do; else the "
                        f"mean of the measured cells within {FILL} cells. Map by rule (pipeline/canopy_top.py)",
            "derived_from": derived, "maps": st,
            "stats": {"cells": int(v.size), "median_m": round(float(np.median(v)), 1) if v.size else None,
                      "p90_m": round(float(np.percentile(v, 90)), 1) if v.size else None}}
