"""Build step `lidar`: the 3DEP 1 m DEM and point cloud turned into fine terrain and a tree crown list.

    python -m pipeline.lidar --tile utm10n_680_4280              # everything (hours: the point cloud)
    python -m pipeline.lidar --tile utm10n_680_4280 --stage grid  # only stream the point cloud to 1 m grids
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps lidar   # same, then the manifest

Stages, each skipped when its output exists (unless --force):

  dem       terrain/dem_1m.tif: the 1 m bare-earth DEM of the newest 3DEP collection covering the
            tile (fetch_lidar.find_dem_project), cut from its 10 km product file, which is the tile's
            own UTM cell with a 6 m apron. NAD83 UTM is taken as the tile's WGS84 UTM (PROJ's NAD83 to
            WGS 84 (1) is a null shift; the realisation difference, about 1 m, is below the check's
            resolution and the point-cloud check below measures any shift). Pipeline only.
  grid      The point cloud of the matching EPT project, every octree node overlapping the tile,
            streamed chunk by chunk (decoded in memory, never written) by a process pool and reduced
            to 1 m grids on the tile: highest return (DSM), ground (class 2) sum and count, point count
            and multi-return count. Grids live in _cache/lidar_grid/ as memmaps with a list of done
            nodes, so an interrupted run resumes; they are deleted once the products are written.
  products  terrain/dsm_1m.tif (highest non-noise return, float32 m; pipeline only)
            vegetation/chm_1m.tif (canopy height model DSM - ground, uint16 cm; pipeline only)
            terrain/lidar_dtm_check.tif (10 m mean of point-cloud ground minus the 1 m DEM, float32)
            vegetation/canopy_height_10m.tif + client/canopy_height.png (10 m: p95 canopy height,
              tree cover >= 4 m, shrub cover 0.5-4 m)
            client/trees_lidar.bin (one record per crown; see TREES_FORMAT)
            client/terrain_detail.png (2 m height residual against the client's 5 m grid)
            terrain/roughness_10m.tif (std of the 1 m DEM about a quadratic per 10 m cell; ground.py)

The CHM's ground is the 1 m DEM plus the median point-cloud-ground minus DEM offset (the DEM is the
same collection's ground points, gap-free where the point cloud has none under dense canopy). The
source classifies only ground, unclassified, water, bridge and noise: houses are in the DSM. A crown
needs a multi-return share (vegetation returns several echoes per pulse, roofs one) and must not sit
on an OSM building or within BRIDGE_HALF_WIDTH of an OSM bridge (towers, cables and railings return
several echoes too). Inside the dense-urban mask (pipeline/urban.py) only crowns whose rewilded 30 m
class is a forest or woodland stay: the street trees go with the streets.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds

from .config import TILE_SIZE_M, Tile, read_json, write_json

N1 = TILE_SIZE_M                # 1 m grid: 10 000 px
NODATA = -9999.0
TREE_MIN_H = 4.0                # crown and tree-cover threshold, m
SHRUB_MIN_H = 0.5
MULTI_MIN = 0.08                # a crown's multi-return share below this is a roof or a wire
POLE_R_FRAC = 0.06              # a crown narrower than max(1 m, 0.06 h) is a tower or pole
SHRUB_TOP_H, SHRUB_PROM_M = 8.0, 2.0   # under 8 m and under 2 m above its surroundings: a tall shrub
SMOOTH_SIGMA = 1.0              # CHM smoothing for maxima, px (m)
CROWN_EDGE = 0.5                # a crown's pixels are its watershed region down to this share of its height
DETAIL_RES = 2
DETAIL_UNIT = 0.04               # m per step of client/terrain_detail.png
ROUGH_RES = 10
CELL_M = 100                    # crown index cell
# Half-widths (m) around OSM bridge ways within which no crown stands: the towers and cables sit beside
# the deck, and a suspension bridge's are 15-20 m off its centre line. Footbridges have no towers.
BRIDGE_HALF_WIDTH = {"motorway": 35.0, "trunk": 35.0, "default": 20.0, "foot": 8.0}
BRIDGE_FOOT = ("footway", "path", "cycleway", "bridleway", "steps", "pedestrian")
BRIDGE_OUTLINE_M = 10.0         # around a man_made=bridge outline
# Rewilded classes (habitat.CLASSES) whose crowns stay inside the urban mask: oak woodland, conifer and
# mixed forest, riparian.
URBAN_TREE_CLASSES = (1, 2, 3, 6)
TREES_MAGIC = b"WECR"
TREES_FORMAT = (
    "little-endian. Header 32 bytes: magic 'WECR', u16 version 1, u16 record bytes 8, u16 cells per side "
    "(100), u16 cell metres (100), u32 crown count, f32 xy unit (0.2 m), f32 height unit (0.25 m), f32 radius "
    "unit (0.1 m), u32 0. Then u32 offsets[cells*cells + 1]: the crowns of index cell (ci = floor(x / 100), "
    "cj = floor(north / 100)) are records offsets[cj*cells + ci] .. offsets[cj*cells + ci + 1], tallest first. "
    "Then 8-byte records: u16 x, u16 north (tile metres = value * 0.2 + 0.1, north from the south edge), "
    "u8 height (* 0.25 m), u8 crown radius (* 0.1 m), u8 confidence (0-255), u8 multi-return share (0-255)")


def _src_cache(tile: Tile, name: str) -> Path:
    p = tile.dir / "_cache" / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def _profile(n: int, tile: Tile, dtype="float32", nodata=NODATA, count=1, predictor=3) -> dict:
    x0, y0, x1, y1 = tile.bounds
    return {"driver": "GTiff", "dtype": dtype, "count": count, "width": n, "height": n, "crs": tile.crs,
            "transform": from_bounds(x0, y0, x1, y1, n, n), "nodata": nodata, "tiled": True,
            "blockxsize": 512, "blockysize": 512, "compress": "deflate", "predictor": predictor, "BIGTIFF": "IF_SAFER"}


def _write(path: Path, arr: np.ndarray, tile: Tile, **kw) -> None:
    arr = arr if arr.ndim == 3 else arr[None]
    prof = _profile(arr.shape[1], tile, dtype=str(arr.dtype), count=arr.shape[0], **kw)
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(arr)


def _read(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        return src.read(1)


def log(msg: str) -> None:
    print(f"[lidar {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------------------------- dem
def build_dem_1m(tile: Tile, force=False) -> dict:
    from .fetch_lidar import find_dem_project
    from .http import download
    meta = find_dem_project(tile, _src_cache(tile, "lidar_index"))
    chosen = meta["chosen"]
    out = tile.path("terrain/dem_1m.tif")
    if force or not out.exists():
        raw_dir = _src_cache(tile, "lidar_dem1m")
        raw = download(chosen["url"], None, raw_dir / Path(chosen["url"]).name, force=force)
        log(f"dem: {raw.name} {raw.stat().st_size / 1e6:.0f} MB")
        x0, y0, x1, y1 = tile.bounds
        with rasterio.open(raw) as src:
            if src.res != (1.0, 1.0):
                raise RuntimeError(f"unexpected resolution {src.res}")
            win = window_from_bounds(x0, y0, x1, y1, src.transform)
            c, r = win.col_off, win.row_off
            if abs(c - round(c)) > 1e-3 or abs(r - round(r)) > 1e-3:
                raise RuntimeError(f"1 m product not aligned to whole metres: window {win}")
            z = src.read(1, window=((round(r), round(r) + N1), (round(c), round(c) + N1))).astype("float32")
            nod = src.nodata
        bad = ~np.isfinite(z) | (z == nod) if nod is not None else ~np.isfinite(z)
        z[bad] = NODATA
        _write(out, z, tile)
        with rasterio.open(out, "r+") as dst:
            dst.build_overviews([2, 4, 8, 16], Resampling.average)
        shutil.rmtree(raw_dir)          # the raw product is the same 1 m cell plus an apron
    z = _read(out)
    v = z != NODATA
    return {"path": "terrain/dem_1m.tif", "kind": "raster", "crs": tile.crs,
            "bounds": list(tile.bounds), "pixels": N1, "resolution_m": 1.0, "units": "m (NAVD88)", "nodata": NODATA,
            "source": "usgs_3dep_1m", "project": chosen["project"],
            "collection": [chosen["collection_begin"], chosen["collection_end"]], "found_via": meta["found_via"],
            "other_collections": [c["project"] for c in meta["candidates"][1:]],
            "for_clients": False, "for_clients_note": "pipeline only; clients read client.heights (5 m) and client.terrain_detail",
            "stats": {"min": float(z[v].min()), "max": float(z[v].max()), "valid_fraction": round(float(v.mean()), 6)}}


# --------------------------------------------------------------------------------------------- grid
_W: dict = {}


def _worker_init(base: str, crs: str, bounds: tuple) -> None:
    from pyproj import Transformer
    from .fetch_lidar import _session
    _W.update(base=base, session=_session(), bounds=bounds,
              to_utm=Transformer.from_crs("EPSG:3857", crs, always_xy=True))


def _reduce(idx: np.ndarray, vals: np.ndarray | None, op):
    o = np.argsort(idx, kind="stable")
    s = idx[o]
    starts = np.flatnonzero(np.r_[True, s[1:] != s[:-1]])
    u = s[starts]
    cnt = np.diff(np.r_[starts, len(s)]).astype(np.int32)
    red = op.reduceat(vals[o], starts) if vals is not None else None
    return u, red, cnt


def _grid_node(key: str):
    from .fetch_lidar import read_node
    try:
        x, y, z, cls, rn, nr = read_node(_W["base"], key, _W["session"])
    except Exception as e:  # noqa: BLE001
        return key, None, str(e)[:200]
    if len(z) == 0:
        return key, (0, None), None
    ux, uy = _W["to_utm"].transform(x, y)
    x0, y0, x1, y1 = _W["bounds"]
    col = np.floor(ux - x0).astype(np.int64)
    row = np.floor(y1 - uy).astype(np.int64)
    ok = (col >= 0) & (col < N1) & (row >= 0) & (row < N1)
    if not ok.any():
        return key, (len(z), None), None
    idx = (row[ok] * N1 + col[ok]).astype(np.int64)
    z, cls, nr = z[ok], cls[ok], nr[ok]
    u, zmax, cnt = _reduce(idx, z, np.maximum)
    m = nr > 1
    um, _, cm = _reduce(idx[m], None, None) if m.any() else (np.empty(0, np.int64), None, np.empty(0, np.int32))
    g = cls == 2
    if g.any():
        ug, gs, gc = _reduce(idx[g], z[g].astype(np.float64), np.add)
    else:
        ug, gs, gc = np.empty(0, np.int64), np.empty(0), np.empty(0, np.int32)
    return key, (len(z), (u, zmax.astype(np.float32), cnt, um, cm, ug, gs, gc)), None


def _grids(tile: Tile, mode="r+"):
    d = _src_cache(tile, "lidar_grid")
    spec = {"dsm": "float32", "gsum": "float64", "gcnt": "uint16", "npts": "uint16", "nmulti": "uint16"}
    out = {}
    for k, dt in spec.items():
        p = d / f"{k}.dat"
        if not p.exists():
            mm = np.memmap(p, dtype=dt, mode="w+", shape=(N1 * N1,))
            mm[:] = NODATA if k == "dsm" else 0
            mm.flush()
            del mm
        out[k] = np.memmap(p, dtype=dt, mode=mode, shape=(N1 * N1,))
    return d, out


def build_grid(tile: Tile, workers: int = 10, max_depth: int | None = None, force=False) -> dict:
    from multiprocessing import get_context
    from .fetch_lidar import ept_nodes, find_ept
    dem_meta = find_dem_project(tile)
    ept = find_ept(tile, dem_meta["chosen"]["project"], _src_cache(tile, "lidar_index"))["chosen"]
    if force:
        shutil.rmtree(tile.dir / "_cache" / "lidar_grid", ignore_errors=True)
    d, g = _grids(tile)
    state_p = d / "state.json"
    state = json.loads(state_p.read_text()) if state_p.exists() and not force else {"done": [], "failed": {}, "points": 0,
                                                                                   "points_in_tile": 0, "seconds": 0.0}
    if state.get("complete") and not force:
        return state
    nodes_p = _src_cache(tile, "lidar_index") / f"nodes_{max_depth if max_depth is not None else 'all'}.json"
    if nodes_p.exists():
        nodes = json.loads(nodes_p.read_text())
    else:
        nodes = ept_nodes(tile, ept, max_depth)
        nodes_p.write_text(json.dumps(nodes))
    done = set(state["done"])
    todo = [k for k, _ in nodes if k not in done]
    total_pts = sum(n for _, n in nodes)
    log(f"grid: EPT {ept['project']}: {len(nodes)} nodes, {total_pts / 1e9:.2f} G points; {len(todo)} to do, {workers} workers")
    base = ept["url"].rsplit("/", 1)[0]
    t0, last = time.time(), time.time()
    seconds0 = state["seconds"]
    n_done_pts = sum(n for k, n in nodes if k in done)
    counts = dict(nodes)
    ctx = get_context("spawn")
    with ctx.Pool(workers, initializer=_worker_init, initargs=(base, tile.crs, tile.bounds)) as pool:
        for i, (key, res, err) in enumerate(pool.imap_unordered(_grid_node, todo, chunksize=4)):
            if err is not None:
                state["failed"][key] = err
                continue
            n, arrs = res
            state["points"] += n
            if arrs is not None:
                u, zmax, cnt, um, cm, ug, gs, gc = arrs
                dsm = g["dsm"]
                dsm[u] = np.maximum(dsm[u], zmax)
                g["npts"][u] = np.minimum(g["npts"][u].astype(np.int32) + cnt, 65535)
                if len(um):
                    g["nmulti"][um] = np.minimum(g["nmulti"][um].astype(np.int32) + cm, 65535)
                if len(ug):
                    g["gsum"][ug] += gs
                    g["gcnt"][ug] = np.minimum(g["gcnt"][ug].astype(np.int32) + gc, 65535)
                state["points_in_tile"] += int(cnt.sum())
            state["done"].append(key)
            state["failed"].pop(key, None)
            n_done_pts += counts.get(key, 0)
            if time.time() - last > 60 or i == len(todo) - 1:
                for mm in g.values():
                    mm.flush()
                state["seconds"] = seconds0 + time.time() - t0
                state_p.write_text(json.dumps(state))
                el = time.time() - t0
                rate = (n_done_pts - (total_pts - sum(counts[k] for k in todo))) / max(el, 1)
                eta = (total_pts - n_done_pts) / max(rate, 1)
                log(f"grid: {len(state['done'])}/{len(nodes)} nodes, {n_done_pts / 1e9:.2f}/{total_pts / 1e9:.2f} G pts, "
                    f"{rate / 1e6:.1f} M pts/s, eta {eta / 60:.0f} min, failed {len(state['failed'])}")
                last = time.time()
    for mm in g.values():
        mm.flush()
    state["seconds"] = seconds0 + time.time() - t0
    state["complete"] = not state["failed"]
    state["ept"] = {k: ept[k] for k in ("project", "points", "url")}
    state["nodes"] = len(nodes)
    state["max_depth"] = max_depth
    state_p.write_text(json.dumps(state))
    if state["failed"]:
        raise RuntimeError(f"{len(state['failed'])} EPT nodes failed; re-run to retry: {list(state['failed'])[:5]}")
    return state


def find_dem_project(tile: Tile) -> dict:
    from .fetch_lidar import find_dem_project as f
    return f(tile, _src_cache(tile, "lidar_index"))


# ------------------------------------------------------------------------------------------ products
def dtm_check(tile: Tile, dem: np.ndarray, g: dict) -> tuple[float, dict]:
    """Point-cloud ground (mean of class 2 per 1 m cell) against the 1 m DEM: offset, spread, shift."""
    gcnt = np.asarray(g["gcnt"]).reshape(N1, N1)
    has = gcnt > 0
    dtm = np.full((N1, N1), np.nan, np.float32)
    dtm[has] = (np.asarray(g["gsum"]).reshape(N1, N1)[has] / gcnt[has]).astype(np.float32)
    diff = dtm - dem
    diff[dem == NODATA] = np.nan
    v = np.isfinite(diff)
    dv = diff[v]
    off = float(np.median(dv))
    # horizontal shift: RMS over a central 2 km window for DEM shifts of -2..2 m
    c = slice(4000, 6000)
    best = None
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            dd = dtm[c, c] - np.roll(np.roll(dem, dy, 0), dx, 1)[c, c] - off
            rms = float(np.sqrt(np.nanmean(dd ** 2)))
            if best is None or rms < best[0]:
                best = (rms, dx, -dy)
    d10 = np.where(v, diff - off, 0).reshape(N1 // 10, 10, N1 // 10, 10).sum(axis=(1, 3))
    n10 = v.reshape(N1 // 10, 10, N1 // 10, 10).sum(axis=(1, 3))
    m10 = np.where(n10 > 0, d10 / np.maximum(n10, 1), np.nan).astype(np.float32)
    _write(tile.path("terrain/lidar_dtm_check.tif"), np.where(np.isfinite(m10), m10, NODATA).astype(np.float32), tile)
    stats = {"ground_cell_fraction": round(float(v.mean()), 4), "median_offset_m": round(off, 3),
             "mean_offset_m": round(float(dv.mean()), 3), "std_m": round(float(dv.std()), 3),
             "p05_m": round(float(np.percentile(dv, 5)), 3), "p95_m": round(float(np.percentile(dv, 95)), 3),
             "fraction_within_0.15_m": round(float((np.abs(dv - off) <= 0.15).mean()), 4),
             "fraction_beyond_0.5_m": round(float((np.abs(dv - off) > 0.5).mean()), 4),
             "best_shift_m": {"east": best[1], "north": best[2], "rms_m": round(best[0], 3)}}
    return off, stats


def canopy_10m(tile: Tile, chm: np.ndarray) -> dict:
    k = 10
    n = N1 // k
    blocks = chm.reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)
    p95 = np.percentile(blocks, 95, axis=2).astype(np.float32)
    tree = (blocks >= TREE_MIN_H).mean(axis=2).astype(np.float32) * 100
    shrub = ((blocks >= SHRUB_MIN_H) & (blocks < TREE_MIN_H)).mean(axis=2).astype(np.float32) * 100
    _write(tile.path("vegetation/canopy_height_10m.tif"), np.stack([p95, tree, shrub]), tile)
    rgb = np.stack([np.clip(np.round(p95 * 4), 0, 255), np.round(tree), np.round(shrub)], -1).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(tile.path("client/canopy_height.png"), optimize=True)
    return {"p95_mean_m": round(float(p95.mean()), 2), "tree_cover_pct": round(float(tree.mean()), 2),
            "shrub_cover_pct": round(float(shrub.mean()), 2)}


def _osm_buildings(tile: Tile) -> np.ndarray:
    """OSM building footprints rasterised on the 1 m grid (row 0 north)."""
    from pyproj import Transformer
    from rasterio.features import rasterize
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    p = tile.path("footprint/mask.geojson")
    if not p.exists():
        return np.zeros((N1, N1), bool)
    t = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    shapes = [shp_transform(t, shape(f["geometry"])) for f in read_json(p)["features"]
              if f["properties"].get("class") == "building"]
    if not shapes:
        return np.zeros((N1, N1), bool)
    x0, y0, x1, y1 = tile.bounds
    return rasterize(((s.buffer(1.0), 1) for s in shapes), out_shape=(N1, N1),
                     transform=from_bounds(x0, y0, x1, y1, N1, N1), dtype="uint8").astype(bool)


def _osm_bridges(tile: Tile) -> np.ndarray:
    """OSM bridges (bridge ways buffered by BRIDGE_HALF_WIDTH, man_made=bridge outlines by
    BRIDGE_OUTLINE_M) rasterised on the 1 m grid (row 0 north)."""
    from pyproj import Transformer
    from rasterio.features import rasterize
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    from .fetch_osm import is_bridge
    p = tile.path("footprint/mask.geojson")
    if not p.exists():
        return np.zeros((N1, N1), bool)
    t = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    shapes = []
    for f in read_json(p)["features"]:
        pr = f.get("properties") or {}
        if not is_bridge(pr):
            continue
        hw = (pr.get("highway") or "").removesuffix("_link")
        buf = (BRIDGE_OUTLINE_M if pr.get("man_made") == "bridge" else BRIDGE_HALF_WIDTH["foot"] if hw in BRIDGE_FOOT
               else BRIDGE_HALF_WIDTH.get(hw, BRIDGE_HALF_WIDTH["default"]))
        g = shp_transform(t, shape(f["geometry"]))
        if not g.is_empty:
            shapes.append((g.buffer(buf), 1))
    if not shapes:
        return np.zeros((N1, N1), bool)
    x0, y0, x1, y1 = tile.bounds
    return rasterize(shapes, out_shape=(N1, N1), transform=from_bounds(x0, y0, x1, y1, N1, N1),
                     dtype="uint8").astype(bool)


def _urban_non_forest(tile: Tile, sr: np.ndarray, sc: np.ndarray) -> np.ndarray:
    """Per seed (1 m row, column): inside the dense-urban mask, on a 30 m cell whose rewilded class
    (vegetation/habitat.tif) is not a forest or woodland."""
    from .urban import load
    p = tile.path("vegetation/habitat.tif")
    if not p.exists():
        return np.zeros(len(sr), bool)
    urban = load(tile, int(round(TILE_SIZE_M / 5.0)))
    hab = _read(p)
    inside = urban[sr * urban.shape[0] // N1, sc * urban.shape[0] // N1]
    cls = hab[sr * hab.shape[0] // N1, sc * hab.shape[0] // N1]
    return inside & ~np.isin(cls, URBAN_TREE_CLASSES)


def crowns(tile: Tile, chm: np.ndarray, multi: np.ndarray) -> dict:
    """Local maxima of the smoothed CHM with a window growing with height, crowns grown from them by
    watershed down to CROWN_EDGE of each peak; radius = sqrt(area / pi), capped by height."""
    from scipy import ndimage as ndi
    from skimage.segmentation import watershed
    t0 = time.time()
    chm_m = ndi.median_filter(chm, size=3)                   # wires and single spikes go
    chm_s = ndi.gaussian_filter(chm_m, SMOOTH_SIGMA)
    rclass = np.clip(np.round(1 + 0.1 * chm_s), 1, 5).astype(np.uint8)
    is_max = np.zeros(chm.shape, bool)
    pmin = np.zeros(chm.shape, np.float32)
    for r in range(1, 6):
        sel = rclass == r
        mf = ndi.maximum_filter(chm_s, size=2 * r + 1)
        is_max |= sel & (chm_s >= mf) & (chm_s >= TREE_MIN_H)
        del mf
        mn = ndi.minimum_filter(chm_s, size=4 * r + 3)
        pmin[sel] = mn[sel]
        del mn
    lab, n = ndi.label(is_max, structure=np.ones((3, 3)))
    del is_max
    # one seed per plateau: its first pixel
    idx = np.flatnonzero(lab)
    labs = lab.ravel()[idx]
    first = np.unique(labs, return_index=True)[1]
    seeds = idx[first]
    del lab, idx, labs
    sr, sc = np.divmod(seeds, N1)
    # height = the median-filtered CHM's max in the 3x3 around the seed
    mx3 = ndi.maximum_filter(chm_m, size=3)
    h = mx3.ravel()[seeds]
    del mx3
    log(f"crowns: {len(seeds)} maxima in {time.time() - t0:.0f}s")

    # watershed in 2000 px blocks with a 64 px halo
    B, H = 2000, 64
    area = np.zeros(len(seeds), np.int64)
    marker = np.zeros(chm.shape, np.int32)
    marker.ravel()[seeds] = np.arange(1, len(seeds) + 1, dtype=np.int32)
    for r0 in range(0, N1, B):
        for c0 in range(0, N1, B):
            ra, rb = max(r0 - H, 0), min(r0 + B + H, N1)
            ca, cb = max(c0 - H, 0), min(c0 + B + H, N1)
            s = chm_s[ra:rb, ca:cb]
            mk = marker[ra:rb, ca:cb]
            ws = watershed(-s, mk, mask=s >= SHRUB_MIN_H + 1.5)
            peak = np.zeros(len(seeds) + 1, np.float32)
            peak[1:] = h
            inside = (ws > 0) & (s >= CROWN_EDGE * peak[ws])
            core = np.zeros(ws.shape, bool)
            core[r0 - ra: r0 - ra + B, c0 - ca: c0 - ca + B] = True
            # count only pixels in the block core so halos are not counted twice
            area += np.bincount(ws[inside & core], minlength=len(seeds) + 1)[1:]
    del marker
    log(f"crowns: watershed done at {time.time() - t0:.0f}s")

    r_eq = np.sqrt(np.maximum(area, 1) / math.pi)
    r_max = np.minimum(2.0 + 0.35 * h, 15.0)
    radius = np.clip(r_eq, 0.5, r_max)
    # multi-return share in the 5x5 around the peak
    m5 = ndi.uniform_filter(multi.astype(np.float32), size=5)
    mshare = m5.ravel()[seeds]
    del m5
    prom = h - pmin.ravel()[seeds]
    # confidence: isolation (prominence over the window minimum, relative to height), a crown as wide as
    # a tree that tall usually is (radius h / 4), vegetation-like returns, and height
    c_prom = np.clip(prom / h, 0, 1)
    c_area = np.clip(r_eq / (0.25 * h), 0, 1)
    c_multi = np.clip(mshare / 0.6, 0, 1)
    c_h = np.clip((h - TREE_MIN_H) / 6.0, 0, 1)
    conf = np.clip(0.35 * c_prom + 0.25 * c_area + 0.2 * c_multi + 0.2 * c_h, 0, 1)

    bld = _osm_buildings(tile).ravel()[seeds]
    drop_roof = mshare < MULTI_MIN
    drop_pole = r_eq < np.maximum(1.0, POLE_R_FRAC * h)                    # towers, poles, wire remnants
    drop_shrub = (h < SHRUB_TOP_H) & (prom < SHRUB_PROM_M)                  # a taller shrub in a shrub canopy
    kept_before = ~bld & ~drop_roof & ~drop_pole & ~drop_shrub
    # Bridges and the urban rule last, so the counts above keep their meaning and these count only
    # what the older rules would have kept.
    drop_bridge = _osm_bridges(tile).ravel()[seeds]
    drop_urban = _urban_non_forest(tile, sr, sc)
    keep = kept_before & ~drop_bridge & ~drop_urban
    stats = {"maxima": int(len(seeds)), "dropped_on_osm_buildings": int(bld.sum()),
             "dropped_low_multi_return": int((drop_roof & ~bld).sum()),
             "dropped_pole_like": int((drop_pole & ~bld & ~drop_roof).sum()),
             "dropped_shrub_in_shrub_canopy": int((drop_shrub & ~bld & ~drop_roof & ~drop_pole).sum()),
             "dropped_on_bridges": int((drop_bridge & kept_before).sum()),
             "dropped_urban": int((drop_urban & kept_before & ~drop_bridge).sum()),
             "crowns": int(keep.sum())}
    stats["confidence_terms_median"] = {k: round(float(np.median(v[keep])), 3) for k, v in
                                        (("prominence", c_prom), ("width", c_area), ("multi_return", c_multi), ("height", c_h))}
    stats["confidence_quantiles_p10_p50_p90"] = [round(float(np.percentile(conf[keep], q)), 3) for q in (10, 50, 90)]
    x = sc[keep] + 0.5
    north = N1 - (sr[keep] + 0.5)
    h, radius, conf, mshare = h[keep], radius[keep], conf[keep], mshare[keep]
    stats.update(_write_trees(tile, x, north, h, radius, conf, mshare))
    hb = np.histogram(h, bins=[4, 6, 8, 12, 16, 20, 25, 30, 35, 40, 80])[0]
    stats["height_histogram_m"] = {f"{a}-{b}": int(c) for a, b, c in zip([4, 6, 8, 12, 16, 20, 25, 30, 35, 40], [6, 8, 12, 16, 20, 25, 30, 35, 40, 80], hb)}
    stats["height_m"] = {"median": round(float(np.median(h)), 1), "p95": round(float(np.percentile(h, 95)), 1), "max": round(float(h.max()), 1)}
    stats["radius_m"] = {"median": round(float(np.median(radius)), 2), "p95": round(float(np.percentile(radius, 95)), 2)}
    stats["confidence_median"] = round(float(np.median(conf)), 3)
    stats["seconds"] = round(time.time() - t0, 1)
    return stats


def _write_trees(tile: Tile, x, north, h, radius, conf, mshare) -> dict:
    cells = N1 // CELL_M
    ci = np.clip((x // CELL_M).astype(np.int64), 0, cells - 1)
    cj = np.clip((north // CELL_M).astype(np.int64), 0, cells - 1)
    k = cj * cells + ci
    o = np.lexsort((-h, k))
    rec = np.zeros(len(o), dtype=[("x", "<u2"), ("n", "<u2"), ("h", "u1"), ("r", "u1"), ("c", "u1"), ("m", "u1")])
    rec["x"] = np.clip(np.round((x[o] - 0.1) / 0.2), 0, 65535)
    rec["n"] = np.clip(np.round((north[o] - 0.1) / 0.2), 0, 65535)
    rec["h"] = np.clip(np.round(h[o] / 0.25), 0, 255)
    rec["r"] = np.clip(np.round(radius[o] / 0.1), 0, 255)
    rec["c"] = np.clip(np.round(conf[o] * 255), 0, 255)
    rec["m"] = np.clip(np.round(mshare[o] * 255), 0, 255)
    offsets = np.zeros(cells * cells + 1, "<u4")
    offsets[1:] = np.cumsum(np.bincount(k, minlength=cells * cells))
    head = TREES_MAGIC + struct.pack("<HHHHIfffI", 1, 8, cells, CELL_M, len(o), 0.2, 0.25, 0.1, 0)
    p = tile.path("client/trees_lidar.bin")
    with open(p, "wb") as f:
        f.write(head)
        f.write(offsets.tobytes())
        f.write(rec.tobytes())
    per = np.diff(offsets)
    return {"bytes": p.stat().st_size, "crowns_per_ha": round(len(o) / (N1 * N1 / 1e4), 1),
            "max_per_index_cell": int(per.max())}


def read_trees(path: Path) -> dict:
    """Decode client/trees_lidar.bin to arrays in tile metres (for checks and other steps)."""
    b = path.read_bytes()
    assert b[:4] == TREES_MAGIC
    ver, rb, cells, cell_m, count, xu, hu, ru, _ = struct.unpack("<HHHHIfffI", b[4:32])
    off = np.frombuffer(b, "<u4", cells * cells + 1, 32)
    rec = np.frombuffer(b, dtype=[("x", "<u2"), ("n", "<u2"), ("h", "u1"), ("r", "u1"), ("c", "u1"), ("m", "u1")],
                        count=count, offset=32 + 4 * (cells * cells + 1))
    return {"x": rec["x"] * xu + xu / 2, "north": rec["n"] * xu + xu / 2, "h": rec["h"] * hu, "r": rec["r"] * ru,
            "conf": rec["c"] / 255, "multi": rec["m"] / 255, "offsets": off, "cells": cells, "cell_m": cell_m}


def terrain_detail(tile: Tile, dem: np.ndarray) -> dict:
    """2 m residual of the 1 m DEM against the client's 5 m heights (client/heights.png as decoded,
    bilinear between its pixel centres), 8-bit grey: residual = (v - 128) * 0.04 m, clamped to +-5.08 m.
    Linear, so a GPU's bilinear filter interpolates it exactly; 4 cm steps are under the DEM's own
    accuracy (about 10 cm). A 16-bit R/G split would be exact to 1 cm but twice the size (22 MB) and
    unfilterable (the bytes cannot be interpolated apart)."""
    from scipy.ndimage import map_coordinates
    # client/heights.png exactly as the client decodes it, rebuilt from terrain/dem.tif with derive's
    # quantisation (0.1 m, nodata filled with the mean) so this step does not wait for `derive`
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        h5 = src.read(1).astype(np.float64)
        nod = src.nodata
    if nod is not None and (h5 == nod).any():
        h5[h5 == nod] = h5[h5 != nod].mean()
    h5 = -10000 + np.round((h5 + 10000) / 0.1) * 0.1
    res5 = TILE_SIZE_M / h5.shape[0]
    z = dem.astype(np.float64)
    if (z == NODATA).any():
        z[z == NODATA] = np.nan
    n2 = N1 // DETAIL_RES
    z2 = z.reshape(n2, DETAIL_RES, n2, DETAIL_RES).mean(axis=(1, 3))
    centres = (np.arange(n2) + 0.5) * DETAIL_RES               # x of column i, (10000 - north) of row j
    p = (centres - res5 / 2) / res5
    py, px = np.meshgrid(p, p, indexing="ij")
    base = map_coordinates(h5, [py.ravel(), px.ravel()], order=1, mode="nearest").reshape(n2, n2)
    r = z2 - base
    r[~np.isfinite(r)] = 0
    q = np.round(r / DETAIL_UNIT)
    v = np.clip(q + 128, 0, 255).astype(np.uint8)
    out = tile.path("client/terrain_detail.png")
    Image.fromarray(v).save(out, optimize=True)
    a = np.abs(r)
    return {"residual_m": {"mean": round(float(r.mean()), 3), "std": round(float(r.std()), 3),
                           "p50_abs": round(float(np.median(a)), 3), "p99_abs": round(float(np.percentile(a, 99)), 3),
                           "max_abs": round(float(a.max()), 2)},
            "fraction_over_0.5_m": round(float((a > 0.5).mean()), 4),
            "clipped_fraction": round(float(((q < -128) | (q > 127)).mean()), 6)}


def roughness(tile: Tile, dem: np.ndarray) -> dict:
    """Std of the 1 m DEM about a least-squares quadratic within each 10 m cell (slope and curvature
    removed, so it is relief below 10 m: boulders, outcrop steps, cut banks)."""
    k = ROUGH_RES
    u = np.arange(k) - (k - 1) / 2
    vv, uu = np.meshgrid(u, u, indexing="ij")              # v rows (south-going), u columns
    A = np.stack([np.ones(k * k), uu.ravel(), vv.ravel(), uu.ravel() ** 2, vv.ravel() ** 2, (uu * vv).ravel()], 1)
    P = A @ np.linalg.pinv(A)                                # projection onto the quadratic
    R = np.eye(k * k) - P
    n = N1 // k
    out = np.zeros((n, n), np.float32)
    for r0 in range(0, n, 50):
        strip = dem[r0 * k:(r0 + 50) * k].astype(np.float64)
        rows = strip.shape[0] // k
        b = strip.reshape(rows, k, n, k).transpose(0, 2, 1, 3).reshape(rows * n, k * k)
        res = b @ R.T
        sd = np.sqrt((res ** 2).sum(1) / (k * k - 6))
        bad = (b == NODATA).any(1)
        sd[bad] = np.nan
        out[r0:r0 + rows] = sd.reshape(rows, n)
    _write(tile.path("terrain/roughness_10m.tif"), np.where(np.isfinite(out), out, NODATA).astype(np.float32), tile)
    v = out[np.isfinite(out)]
    return {"median_m": round(float(np.median(v)), 3), "p90_m": round(float(np.percentile(v, 90)), 3),
            "p99_m": round(float(np.percentile(v, 99)), 3)}


def build_crowns(tile: Tile) -> dict:
    """Re-run crown detection alone from vegetation/chm_1m.tif and vegetation/multi_1m.tif (the multi-return share
    the products stage saves), or the kept grids (--keep-grids) on a tile from before that raster. The `crowns`
    build step runs this after osm, veg and derive, so the buildings, bridges, rewilded classes and the urban mask
    the finder drops crowns on all exist (the lidar step itself runs long before them)."""
    mp = tile.path("vegetation/multi_1m.tif")
    if mp.exists():
        multi = _read(mp).astype(np.float32) / 255
    else:
        d, g = _grids(tile, "r")
        npts = np.asarray(g["npts"]).reshape(N1, N1)
        multi = np.where(npts > 0, np.asarray(g["nmulti"]).reshape(N1, N1) / np.maximum(npts, 1), 0).astype(np.float32)
    chm = _read(tile.path("vegetation/chm_1m.tif")).astype(np.float32) / 100
    st = crowns(tile, chm, multi)
    p = tile.path("terrain/lidar_stats.json")
    stats = read_json(p)
    stats["crowns"] = st
    write_json(p, stats)
    return st


def build_products(tile: Tile, force=False, keep_grids=False) -> dict:
    t0 = time.time()
    d, g = _grids(tile, "r")
    state = json.loads((d / "state.json").read_text())
    if not state.get("complete"):
        raise RuntimeError("point cloud grid incomplete; run --stage grid")
    dem = _read(tile.path("terrain/dem_1m.tif"))
    stats = {"grid": {k: state[k] for k in ("points", "points_in_tile", "nodes", "max_depth", "ept")},
             "grid_seconds": round(state["seconds"], 1)}
    stats["grid"]["density_pts_m2"] = round(state["points_in_tile"] / (N1 * N1), 1)
    off, stats["dtm_check"] = dtm_check(tile, dem, g)
    log(f"products: dtm check {stats['dtm_check']}")
    dsm = np.asarray(g["dsm"]).reshape(N1, N1).copy()
    npts = np.asarray(g["npts"]).reshape(N1, N1)
    stats["grid"]["empty_cell_fraction"] = round(float((npts == 0).mean()), 4)
    ground = dem + np.float32(off)
    have = (dsm != NODATA) & (dem != NODATA)
    chm = np.where(have, np.maximum(dsm - ground, 0), 0).astype(np.float32)
    # a 1 m cell with no return (water, shadowed steep faces) takes the ground: no canopy
    dsm_out = np.where(dsm != NODATA, dsm, np.where(dem != NODATA, ground, NODATA)).astype(np.float32)
    _write(tile.path("terrain/dsm_1m.tif"), dsm_out, tile)
    del dsm, dsm_out, ground, have
    _write(tile.path("vegetation/chm_1m.tif"), np.clip(np.round(chm * 100), 0, 65535).astype(np.uint16), tile,
           nodata=None, predictor=2)
    log("products: dsm, chm written")
    from scipy.ndimage import median_filter
    stats["canopy_10m"] = canopy_10m(tile, median_filter(chm, size=3))   # 3x3 median: wires out
    multi = np.where(npts > 0, np.asarray(g["nmulti"]).reshape(N1, N1) / np.maximum(npts, 1), 0).astype(np.float32)
    _write(tile.path("vegetation/multi_1m.tif"), np.round(multi * 255).astype(np.uint8), tile, nodata=None, predictor=2)
    stats["crowns"] = crowns(tile, chm, multi)
    log(f"products: crowns {stats['crowns']}")
    del chm, multi
    stats["terrain_detail"] = terrain_detail(tile, dem)
    log(f"products: terrain detail {stats['terrain_detail']}")
    stats["roughness"] = roughness(tile, dem)
    log(f"products: roughness {stats['roughness']}")
    stats["products_seconds"] = round(time.time() - t0, 1)
    write_json(tile.path("terrain/lidar_stats.json"), stats)
    for mm in g.values():
        del mm
    if not keep_grids:
        shutil.rmtree(d)
    return stats


# ------------------------------------------------------------------------------------------- layers
def layers(tile: Tile, dem_info: dict, stats: dict) -> dict:
    from .fetch_lidar import dem_tile_name
    ept = stats["grid"]["ept"]
    dem_src = {"source": "usgs_3dep_1m", "project": dem_info["project"], "collection": dem_info["collection"]}
    pc_src = {"source": "usgs_3dep_lpc", "ept_project": ept["project"]}
    grid = {"crs": tile.crs, "bounds": list(tile.bounds)}
    po = {"for_clients": False, "for_clients_note": "pipeline only (1 m, hundreds of MB)"}
    L = {
        "terrain.dem_1m": dem_info,
        "terrain.dsm_1m": {"path": "terrain/dsm_1m.tif", "kind": "raster", **grid, "pixels": N1, "resolution_m": 1.0,
                           "units": "m (NAVD88)", "nodata": NODATA, **pc_src, "sources_used": ["usgs_3dep_1m"],
                           "encoding": "float32 highest non-noise return per 1 m cell (first-return surface); "
                                       "cells without a return take the ground",
                           "derived_from": ["terrain.dem_1m"], **po},
        "vegetation.chm_1m": {"path": "vegetation/chm_1m.tif", "kind": "raster", **grid, "pixels": N1, "resolution_m": 1.0,
                              "encoding": "uint16 centimetres: terrain.dsm_1m - (terrain.dem_1m + median point-cloud ground offset), >= 0",
                              **pc_src, "sources_used": ["usgs_3dep_1m"],
                              "derived_from": ["terrain.dsm_1m", "terrain.dem_1m"], **po},
        "vegetation.multi_1m": {"path": "vegetation/multi_1m.tif", "kind": "raster", **grid, "pixels": N1, "resolution_m": 1.0,
                                "encoding": "uint8: share of the cell's returns that are one of several per pulse, * 255 "
                                            "(vegetation echoes several times, roofs and water once); 0 where no return",
                                **pc_src, "derived_from": [], **po},
        "terrain.lidar_dtm_check": {"path": "terrain/lidar_dtm_check.tif", "kind": "raster", **grid, "pixels": N1 // 10,
                                    "resolution_m": 10.0, "nodata": NODATA,
                                    "encoding": "float32 m: mean over the 10 m cell of point-cloud ground (class 2) minus the 1 m DEM, "
                                                "less the median offset",
                                    **pc_src, "sources_used": ["usgs_3dep_1m"], "derived_from": ["terrain.dem_1m"],
                                    "stats": stats["dtm_check"]},
        "vegetation.canopy_height_10m": {"path": "vegetation/canopy_height_10m.tif", "kind": "raster", **grid,
                                         "pixels": N1 // 10, "resolution_m": 10.0, "nodata": NODATA,
                                         "encoding": "float32 bands: 1 p95 canopy height m, 2 tree cover % (CHM >= 4 m), "
                                                     "3 shrub cover % (0.5 m <= CHM < 4 m); of the CHM after a 3x3 median (wires removed)",
                                         **pc_src, "derived_from": ["vegetation.chm_1m"], "stats": stats["canopy_10m"]},
        "client.canopy_height": {"path": "client/canopy_height.png", "kind": "raster", **grid, "pixels": N1 // 10,
                                 "resolution_m": 10.0,
                                 "encoding": "RGB, row 0 north: R p95 canopy height in 0.25 m (0-63.75 m), G tree cover % "
                                             "(CHM >= 4 m), B shrub cover % (0.5-4 m)",
                                 **pc_src, "derived_from": ["vegetation.canopy_height_10m"]},
        "client.trees_lidar": {"path": "client/trees_lidar.bin", "kind": "binary", **grid, "encoding": TREES_FORMAT,
                               "method": (f"local maxima of the CHM (3x3 median, gaussian sigma {SMOOTH_SIGMA} m) in a square window of "
                                          f"radius round(1 + 0.1 h) m (1-5), h >= {TREE_MIN_H} m; height = the median CHM's 3x3 max; crown "
                                          f"= watershed region down to {CROWN_EDGE} of the peak, radius sqrt(area / pi) clipped to "
                                          "0.5 .. min(2 + 0.35 h, 15) m; dropped on OSM buildings and where the multi-return share "
                                          f"in the 5x5 around the peak is < {MULTI_MIN}, where the crown is narrower than max(1 m, {POLE_R_FRAC} h) "
                                          f"(towers, poles), and where h < {SHRUB_TOP_H} m with prominence < {SHRUB_PROM_M} m (a taller "
                                          "shrub in a shrub canopy); then dropped within "
                                          f"{BRIDGE_HALF_WIDTH['motorway']:g} m of an OSM motorway or trunk bridge, "
                                          f"{BRIDGE_HALF_WIDTH['default']:g} m of another road or rail bridge, "
                                          f"{BRIDGE_HALF_WIDTH['foot']:g} m of a footbridge and {BRIDGE_OUTLINE_M:g} m of a "
                                          "man_made=bridge outline (towers, cables), and inside the dense-urban mask "
                                          "(footprint.urban) where the 30 m rewilded class (vegetation.habitat) is not oak "
                                          "woodland, conifer or mixed forest or riparian (street trees). confidence = 0.35 prominence (peak minus the "
                                          "minimum in a square of half-width 2 w + 1 around it, w the maxima window radius, over h) + 0.25 "
                                          "watershed radius over h / 4 + 0.2 multi-return share over 0.6 + 0.2 height above 4 m over 6 m, "
                                          "each clipped to 0..1"),
                               **pc_src, "sources_used": ["usgs_3dep_1m", "osm", "landfire"],
                               "derived_from": ["vegetation.chm_1m", "footprint.mask", "footprint.urban", "vegetation.habitat"],
                               "stats": stats["crowns"]},
        "client.terrain_detail": {"path": "client/terrain_detail.png", "kind": "raster", **grid, "pixels": N1 // DETAIL_RES,
                                  "resolution_m": float(DETAIL_RES),
                                  "encoding": "8-bit grey, row 0 north, pixel centres at x = 2i + 1, north = 10000 - (2j + 1): "
                                              "residual m = (v - 128) * 0.04 (clamped +-5.08 m) = the 1 m DEM averaged to 2 m minus "
                                              "client.heights decoded and interpolated bilinearly between ITS pixel centres "
                                              "(x = 5i + 2.5, north = 10000 - 5j - 2.5). Linear, so texture filtering interpolates it",
                                  "source": "usgs_3dep_1m", "derived_from": ["terrain.dem_1m", "client.heights"],
                                  "stats": stats["terrain_detail"]},
        "terrain.roughness": {"path": "terrain/roughness_10m.tif", "kind": "raster", **grid, "pixels": N1 // ROUGH_RES,
                              "resolution_m": float(ROUGH_RES), "units": "m", "nodata": NODATA,
                              "encoding": "float32: std of the 1 m DEM about its least-squares quadratic within the 10 m cell",
                              "source": "usgs_3dep_1m", "derived_from": ["terrain.dem_1m"], "stats": stats["roughness"]},
    }
    L["terrain.dem_1m"]["tile_key"] = dem_tile_name(tile)
    return L


# DEM-only (2026-10-27, Yosemite: the 2019 collection's 1 m DEM is published but its point cloud is not in the public
# Entwine bucket): the products the 1 m DEM alone gives, the terrain detail and the roughness; no DSM, canopy or crowns
# (the crowns and inpaint steps skip, the vegetation uses the cell mix, the client draws the imagery). The build records
# status.lidar = "dem_only". Stats in terrain/lidar_dem_only.json; terrain/lidar_stats.json stays absent.
def build_dem_only(tile: Tile, dem_info: dict, force=False) -> dict:
    p = tile.dir / "terrain" / "lidar_dem_only.json"
    if force or not p.exists():
        t0 = time.time()
        dem = _read(tile.path("terrain/dem_1m.tif"))
        stats = {"dem_only": True, "terrain_detail": terrain_detail(tile, dem), "roughness": roughness(tile, dem)}
        log(f"dem-only products: terrain detail {stats['terrain_detail']}; roughness {stats['roughness']}")
        stats["products_seconds"] = round(time.time() - t0, 1)
        write_json(p, stats)
    stats = read_json(p)
    from .fetch_lidar import dem_tile_name
    grid = {"crs": tile.crs, "bounds": list(tile.bounds)}
    L = {
        "terrain.dem_1m": dem_info,
        "client.terrain_detail": {"path": "client/terrain_detail.png", "kind": "raster", **grid, "pixels": N1 // DETAIL_RES,
                                  "resolution_m": float(DETAIL_RES),
                                  "encoding": "8-bit grey, row 0 north, pixel centres at x = 2i + 1, north = 10000 - (2j + 1): "
                                              "residual m = (v - 128) * 0.04 (clamped +-5.08 m) = the 1 m DEM averaged to 2 m minus "
                                              "client.heights decoded and interpolated bilinearly between ITS pixel centres "
                                              "(x = 5i + 2.5, north = 10000 - 5j - 2.5). Linear, so texture filtering interpolates it",
                                  "source": "usgs_3dep_1m", "derived_from": ["terrain.dem_1m", "client.heights"],
                                  "stats": stats["terrain_detail"]},
        "terrain.roughness": {"path": "terrain/roughness_10m.tif", "kind": "raster", **grid, "pixels": N1 // ROUGH_RES,
                              "resolution_m": float(ROUGH_RES), "units": "m", "nodata": NODATA,
                              "encoding": "float32: std of the 1 m DEM about its least-squares quadratic within the 10 m cell",
                              "source": "usgs_3dep_1m", "derived_from": ["terrain.dem_1m"], "stats": stats["roughness"]},
    }
    L["terrain.dem_1m"]["tile_key"] = dem_tile_name(tile)
    L["terrain.dem_1m"]["point_cloud"] = "none in the public Entwine bucket (DEM-only products)"
    return L


def build_lidar(tile: Tile, force=False, workers=10, max_depth=None, stage="all") -> dict:
    """The build step: returns manifest layers. Stages already done are not redone (force redoes them). Without a
    point cloud for the collection (fetch_lidar.NoPointCloud) the DEM-only products (build_dem_only)."""
    from .fetch_lidar import NoPointCloud
    dem_info = build_dem_1m(tile, force)
    stats_p = tile.dir / "terrain" / "lidar_stats.json"
    if (tile.dir / "terrain" / "lidar_dem_only.json").exists() and not force and not stats_p.exists():
        return build_dem_only(tile, dem_info, force)
    if stage in ("all", "grid") and (force or not stats_p.exists()):
        try:
            build_grid(tile, workers, max_depth, force)
        except NoPointCloud as e:
            log(f"no point cloud: {e}")
            return build_dem_only(tile, dem_info, force)
    if stage == "grid":
        return {}
    if force or not stats_p.exists():
        build_products(tile, force)
    stats = read_json(stats_p)
    return layers(tile, dem_info, stats)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", required=True)
    ap.add_argument("--stage", default="all", choices=["all", "dem", "grid", "products", "crowns"])
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4)))
    ap.add_argument("--max-depth", type=int, default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--keep-grids", action="store_true")
    a = ap.parse_args(argv)
    tile = Tile.from_id(a.tile)
    t0 = time.time()
    if a.stage == "dem":
        print(json.dumps(build_dem_1m(tile, a.force), indent=1))
    elif a.stage == "crowns":
        print(json.dumps(build_crowns(tile), indent=1))
    elif a.stage == "products":
        print(json.dumps(build_products(tile, a.force, a.keep_grids), indent=1))
    else:
        out = build_lidar(tile, a.force, a.workers, a.max_depth, a.stage)
        print(json.dumps({k: v.get("stats", {}) for k, v in out.items()}, indent=1, default=str)[:4000])
    log(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
