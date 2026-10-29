"""Waterways, water bodies and riparian systems, built as one system (build step `water`, after `rewild_hydro`).

Aaron (2026-10-29): "banks have a transition 'down' into the body; the bottoms of waterways should have lots of
rocks when the waterway dries; there should be a pass in the pipeline to build all the waterways / water bodies
and riparian systems; water systems are first class citizens like animals." Until now a creek was a ribbon draped
on the terrain at the ground's own height: the 5 m DEM is hydro-flattened at the water surface, so an animal met a
flat shore and the water sat on top of it. This step reads the routed channels (hydro/channels.geojson), their
depth and riffle-pool profile (client/channel_profile.png), the kept ponds (hydro/waterbodies.geojson minus
hydro/human_water.geojson's rewilded ones) and the DEM, and writes:

  terrain/dem_banked.tif    the 5 m DEM with every channel and pond basin carved to a graded cross-section (below)
  client/heights.png        rebuilt from it (derive.client_rasters's encoding), so the terrain mesh carries the banks
  client/terrain_detail.png rebuilt on a lidar tile: the 1 m ground averaged to 2 m, carved the same way, against
                            the banked 5 m heights (lidar.terrain_detail's encoding), so the fine mesh carries them
  client/water.png          RGB on the DEM grid (row 0 north), the water system for the client (and client/water_width.png,
                            8-bit grey: the channel's water half width, 0.1 m units; a fourth channel in one RGBA file came
                            back through the browser's canvas premultiplied, the zone bits garbled):
      R  zone (low 4 bits: 0 none, 1 channel bed, 2 wet margin, 3 bank, 4 terrace, 5 pond water (the basin),
         6 pond margin (shallows and drawdown mud), 7 pond shore, 8 pond terrace) | stream order << 4 (1-7; 0 for
         ponds) | 128 when the water is perennial (a perennial reach; a pond that holds water all year)
      G  bed material (low 3 bits: 0 none, 1 silt, 2 sand, 3 gravel, 4 cobble, 5 boulder) | 8 on a bar (a point bar
         on the inside of a bend, a gravel bar)
      B  water surface level: (level - heights.png's height at the cell) / 0.02 m + 128 (1..255; 0 off the water
         system), on every stream zone cell from its reach's level and on every pond cell from the pond's
      (water_width.png)  the channel's water half-width at the nearest centreline sample, 0.1 m units (0 off a channel)
  client/species_mix.json   gains `riparian`: the species mix per zone, order class and permanence (species_mix.py
                            riparian_rows, from each record's habitat.riparian block), when the file exists

The cross-section (per centreline sample, every SAMPLE_M along each reach; o = distance from the centreline):
  water level L     the DEM along the reach made non-increasing downstream and smoothed over max(7.5 m, 2.5 w)
  channel bed       o < wh: L - D (1 - (o / wh)^2), D the thalweg depth from channel_profile.png R (pools deeper,
                    riffles shallower), wh the half water width: w / 2 x (1 + 0.15 t) x a slow wander along the
                    reach (periods 41 and 17 m), t the riffle-pool index. The client draws the water at L and
                    its depthAt() uses the same parabola, so a wading animal's feet meet the carved bed.
  wet margin        wh <= o < wh + m: rises from L to L + hm (flooded in winter, mud and sedges in summer)
  bank              to wb = wh + m + b: the real ground (a zone, not carved: the lidar resolves the banks, and a
                    template bank cut them back to a gentler, wider trough on the first run), nominally L + Hb
  terrace           to wt: the floodplain, where the ground stands under L + Hb + TERRACE_RISE_M
  m, hm, b, Hb, wt grow with the stream order (BANK): an order-1 swale has a 0.85 m margin, Weber Creek (order 5) a
  1.85 m margin and a 15 m bank zone. Only the bed and the margin are carved, and cells are only ever lowered
  (min(ground, L + f(o)), at most MAX_CUT_M): a shore the DEM holds flat at the water level now drops into the bed
  from the water's edge, and an incised channel keeps its banks and gains a bed of its bed width.
A pond's basin: level from the shoreline and the interior as water.js chooses it, the bed lowered by min(Dmax,
0.08 + 0.12 d) with d the distance inside the ring (Dmax 0.6-2.4 m by area), the shallows (under 0.45 m) its
margin, a shore band SHORE_M outside the ring and a terrace to POND_TERRACE_M where the ground is low.

Bed material by sample: boulders where the local slope exceeds BOULDER_SLOPE (cascades, the falls) on orders 2+,
cobble on riffles (t > 0.3) and on any order-4+ bed, gravel on runs and the margins, sand in the pools of the bigger
creeks and silt in the small ones' pools, silt in a pond's basin and sand on its margin; a bar on the inside of a bend
(|turn| over BAR_TURN) over the margin.

Everything is derived from data already in the package; nothing is fetched. Re-run with --steps water; it reads
terrain/dem.tif (never written) so a rerun starts clean. Run after `lidar` and `rewild_hydro`; a later `lidar`
products stage rewrites terrain_detail.png without the banks (run water again); `derive` reads dem_banked.tif for
heights.png when it exists.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage
from shapely.geometry import LineString, shape

from .config import TILE_SIZE_M, Tile, sha256, write_json
from .rewild_hydro import _Ctx

SAMPLE_M = 2.5                    # centreline sample spacing
DEM_PREFERRED_M = 15.0            # an NHD-sourced stretch within this of a DEM reach is a duplicate (water.js)
MAX_CUT_M = 2.0                   # the most a cell is lowered
MIN_DEPTH_M = 0.05                # thalweg depth floor
TERRACE_RISE_M = 1.5              # the terrace: ground under L + Hb + this
POND_SHALLOW_M = 0.45             # a pond's margin: basin depth under this
POND_SLOPE = 0.12                 # basin depth per metre inside the ring
POND_SHORE_M, POND_TERRACE_M = 6.0, 25.0
POND_TERRACE_RISE_M = 2.0
POND_BIG_M2 = 10000.0             # water.js POND_BIG
POND_INTERMITTENT = {39001, 39005, 39006, 43601, 43603, 43604, 43605, 43606, 43607, 43608, 43609, 43610, 43611, 43612}
PERENNIAL_FCODES = {46006, 55800}
BOULDER_SLOPE, COBBLE_SLOPE = 0.045, 0.02
BAR_TURN = 0.12                   # radians per sample: a bend with a point bar
ZONE = {"channel": 1, "margin": 2, "bank": 3, "terrace": 4, "pond_water": 5, "pond_margin": 6, "pond_shore": 7, "pond_terrace": 8}
ZONE_NAMES = {v: k for k, v in ZONE.items()}
MATERIAL = {"none": 0, "silt": 1, "sand": 2, "gravel": 3, "cobble": 4, "boulder": 5}
BAR = 8
LEVEL_UNIT = 0.02
HALF_UNIT = 0.1


def bank_params(order: int) -> dict:
    """The cross-section's widths and heights for a stream order (metres)."""
    o = max(1, min(7, int(order)))
    return {"margin": 0.6 + 0.25 * o, "margin_rise": 0.08 + 0.04 * o, "bank": 1.0 + 0.6 * o,
            "bank_height": 0.4 + 0.35 * o, "terrace": 6.0 + 6.0 * o}


BANK = {o: bank_params(o) for o in range(1, 8)}


def _gauss(v, sigma):
    if len(v) < 3 or sigma <= 0:
        return v
    return ndimage.gaussian_filter1d(v, sigma, mode="nearest")


# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------

def _dem_index(lines: list[tuple[LineString, dict]], r: float):
    """(x, y) -> within r of a DEM-sourced reach, via shapely's STRtree."""
    from shapely.strtree import STRtree
    dem = [ln for ln, pr in lines if pr.get("source") == "dem"]
    if not dem:
        return None
    tree = STRtree(dem)
    from shapely.geometry import Point

    def near(x, y):
        p = Point(x, y)
        for i in tree.query(p.buffer(r)):
            if dem[i].distance(p) < r:
                return True
        return False
    return near


def stream_samples(ctx: _Ctx, pond_mask: np.ndarray, profile: np.ndarray | None) -> dict:
    """Every reach's centreline samples as flat arrays: x, y, s, tangent, turn, order, area, width, perennial,
    class (0 ephemeral, 1 intermittent, 2 perennial), level L, thalweg depth D, riffle index t, half water width wh,
    local slope S, reach id."""
    feats = ctx.load("hydro/channels.geojson")
    lines = []
    for f in feats:
        pr = f["properties"]
        if pr.get("fcode") == 33600:
            continue
        g = ctx.local(shape(f["geometry"]))
        for ln in (g.geoms if g.geom_type == "MultiLineString" else [g]):
            if ln.geom_type == "LineString" and ln.length >= 1:
                lines.append((ln, pr))
    near_dem = _dem_index(lines, DEM_PREFERRED_M)
    n, res = ctx.n, ctx.res
    cols = {k: [] for k in ("x", "y", "s", "tx", "ty", "turn", "order", "area", "width", "cls", "L", "D", "t", "wh", "S", "reach")}
    reaches = []
    skipped = {"in_pond": 0, "nhd_duplicate": 0}
    for rid, (line, pr) in enumerate(lines):
        if pr.get("in_waterbody"):
            m = line.interpolate(0.5, normalized=True)
            c, r = int(np.clip(m.x // res, 0, n - 1)), int(np.clip((TILE_SIZE_M - m.y) // res, 0, n - 1))
            if pond_mask[r, c]:
                skipped["in_pond"] += 1
                continue
        L = line.length
        ds = np.arange(0.0, L + 1e-6, SAMPLE_M) if L > SAMPLE_M else np.array([0.0, L])
        pts = np.array([line.interpolate(d).coords[0] for d in ds])
        if pr.get("source") == "nhd" and near_dem is not None:
            keep = np.array([not near_dem(x, y) for x, y in pts])
            if not keep.any():
                skipped["nhd_duplicate"] += 1
                continue
        else:
            keep = np.ones(len(pts), bool)
        order = int(pr.get("order") or 1)
        area = float(pr.get("area_km2") or 0.15)
        width = float(pr.get("width") or min(30.0, max(1.0, 1.6 * area ** 0.45)))
        fcode = pr.get("fcode")
        cls = 2 if fcode in PERENNIAL_FCODES else 1 if fcode in (46003, 33400) else 0
        # the level: the DEM along the line, non-increasing downstream, smoothed, non-increasing again
        z = ctx.zat(pts[:, 0], pts[:, 1])
        z = np.minimum.accumulate(z)
        z = np.minimum.accumulate(_gauss(z, max(7.5, 2.5 * width) / SAMPLE_M))
        S = np.maximum(0.0, -np.gradient(z, SAMPLE_M)) if len(z) > 1 else np.zeros(len(z))
        S = _gauss(S, max(10.0, 2 * width) / SAMPLE_M)
        # tangent and turn
        d = np.gradient(pts, axis=0) if len(pts) > 1 else np.array([[1.0, 0.0]])
        tl = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-6)
        tx, ty = d[:, 0] / tl, d[:, 1] / tl
        ang = np.unwrap(np.arctan2(ty, tx))
        turn = _gauss(np.gradient(ang) if len(ang) > 1 else np.zeros(1), 3)
        # depth and riffle index from the profile raster at the sample's cell
        c = np.clip((pts[:, 0] // res).astype(int), 0, n - 1)
        r = np.clip(((TILE_SIZE_M - pts[:, 1]) // res).astype(int), 0, n - 1)
        if profile is not None:
            R, G = profile[r, c, 0].astype("float64"), profile[r, c, 1].astype("float64")
            D = np.where(R > 0, R * 0.02, 0.10 * max(area, 0.01) ** 0.32)
            t = np.where(G > 0, G / 127.5 - 1, 0.0)
        else:
            D = np.full(len(pts), 0.10 * max(area, 0.01) ** 0.32)
            t = np.zeros(len(pts))
        D = np.maximum(D, MIN_DEPTH_M)
        ph = (rid * 0.618034) % 1.0 * 100
        wander = np.clip(1 + 0.2 * np.sin(ds / 41 + ph) + 0.1 * np.sin(ds / 17 + 2.1 * ph), 0.55, 1.4)
        wh = width / 2 * (1 + 0.15 * t) * wander
        sel = keep
        for k, v in (("x", pts[:, 0]), ("y", pts[:, 1]), ("s", ds), ("tx", tx), ("ty", ty), ("turn", turn), ("L", z), ("D", D),
                     ("t", t), ("wh", wh), ("S", S)):
            cols[k].append(np.asarray(v)[sel])
        m = int(sel.sum())
        for k, v in (("order", order), ("area", area), ("width", width), ("cls", cls), ("reach", rid)):
            cols[k].append(np.full(m, v, "float64"))
        reaches.append({"id": rid, "name": pr.get("name"), "order": order, "area_km2": area, "width": width, "cls": cls,
                        "samples": m, "length_m": round(L, 1)})
    out = {k: (np.concatenate(v) if v else np.zeros(0)) for k, v in cols.items()}
    out["reaches"] = reaches
    out["skipped"] = skipped
    return out


def nearest_sample(samples: dict, n: int, res: float):
    """Per cell of an n x n grid at `res`: the index of the nearest centreline sample (int32, -1 none within reach)
    and the distance to it (m). Samples are written to their cell, the bigger stream last (it owns a shared cell)."""
    sid = np.full((n, n), -1, "int32")
    order = np.argsort(samples["area"], kind="stable")
    c = np.clip((samples["x"][order] // res).astype(int), 0, n - 1)
    r = np.clip(((TILE_SIZE_M - samples["y"][order]) // res).astype(int), 0, n - 1)
    sid[r, c] = order.astype("int32")
    have = sid >= 0
    dist, (ir, ic) = ndimage.distance_transform_edt(~have, return_indices=True)
    near = sid[ir, ic]
    # the exact distance to the sample point, not to its cell centre
    del dist, ir, ic
    cx = ((np.arange(n) + 0.5) * res).astype("float32")[None, :]
    cy = (TILE_SIZE_M - (np.arange(n) + 0.5) * res).astype("float32")[:, None]
    d = np.hypot(cx - samples["x"][near].astype("float32"), cy - samples["y"][near].astype("float32"))
    return near, d


def carve_streams(z: np.ndarray, res: float, samples: dict, near: np.ndarray, d: np.ndarray, pond_mask: np.ndarray | None):
    """The banked DEM and, per cell, the profile offset class: (z_new, bed-or-margin-or-bank mask arrays)."""
    order = np.clip(samples["order"][near].astype(int), 1, 7)
    P = {k: np.array([BANK[o][k] for o in range(1, 8)], "float32")[order - 1] for k in ("margin", "margin_rise", "bank", "bank_height", "terrace")}
    L, D, wh = samples["L"][near].astype("float32"), samples["D"][near].astype("float32"), samples["wh"][near].astype("float32")
    o = d
    in_bed = o < wh
    in_margin = (o >= wh) & (o < wh + P["margin"])
    in_bank = (o >= wh + P["margin"]) & (o < wh + P["margin"] + P["bank"])
    f = np.full(z.shape, np.inf, "float32")
    f[in_bed] = -D[in_bed] * (1 - (o[in_bed] / np.maximum(wh[in_bed], 1e-3)) ** 2)
    u = (o - wh) / np.maximum(P["margin"], 1e-3)
    f[in_margin] = (P["margin_rise"] * u)[in_margin]
    target = L + f   # the bank beyond the margin is the ground as it is
    znew = np.minimum(z, np.maximum(target, z - MAX_CUT_M))
    if pond_mask is not None:
        znew[pond_mask] = z[pond_mask]
    return znew, in_bed, in_margin, in_bank, P


# ---------------------------------------------------------------------------
# Ponds
# ---------------------------------------------------------------------------

def kept_ponds(ctx: _Ctx) -> list[dict]:
    """The waterbodies drawn as ponds: every NHD ring not rewilded (hydro/human_water.geojson), with its level."""
    human = ctx.load("hydro/human_water.geojson")
    rewilded = []
    for f in human:
        if f["properties"].get("rewilded"):
            g = ctx.local(shape(f["geometry"]))
            rewilded.append(g.bounds)
    out = []
    for f in ctx.load("hydro/waterbodies.geojson"):
        pr = f["properties"]
        g = ctx.local(shape(f["geometry"]))
        if g.is_empty or g.area < 4:
            continue
        b = g.bounds
        if any(_iou(b, rb) > 0.6 for rb in rewilded):
            continue
        out.append({"geom": g, "fcode": pr.get("fcode"), "name": pr.get("gnis_name"), "area": float(g.area),
                    "intermittent": pr.get("fcode") in POND_INTERMITTENT, "id": pr.get("permanent_identifier")})
    return out


def _iou(a, b):
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def pond_level(ctx: _Ctx, g) -> float:
    """water.js's rule: big ponds at the shoreline's 60th percentile - 0.1; small ponds at the lowest interior cell
    plus the interior's rise to its median (at most 1.5 m) + 0.05."""
    ring = np.array(g.exterior.coords)
    seg = np.diff(ring, axis=0)
    shore = []
    for (x0, y0), (dx, dy) in zip(ring[:-1], seg):
        k = max(1, int(np.ceil(np.hypot(dx, dy) / 2.5)))
        for j in range(k):
            shore.append((x0 + dx * j / k, y0 + dy * j / k))
    shore = np.array(shore)
    zs = np.sort(ctx.zat(shore[:, 0], shore[:, 1]))
    inside = ctx.rasterize([g]).astype(bool)
    zi = ctx.z[inside]
    lo = min(zs[0], zi.min()) if zi.size else zs[0]
    if g.area > POND_BIG_M2:
        return float(max(lo + 0.05, zs[int(0.6 * (len(zs) - 1))] - 0.1))
    med = float(np.median(zi)) if zi.size else lo
    return float(lo + min(max(med - lo, 0), 1.5) + 0.05)


def carve_ponds(ctx: _Ctx, z: np.ndarray, res: float, ponds: list[dict], zone: np.ndarray, mat: np.ndarray,
                level_of: np.ndarray, flag: np.ndarray, zgrid: np.ndarray | None = None):
    """Lower each pond's basin into z (in place), mark its zones, material and level. `zgrid`: the grid z is on
    (defaults to ctx's 5 m grid); zone / mat / level_of / flag are on that grid too."""
    n = z.shape[0]
    tr = rasterio.transform.from_origin(0, TILE_SIZE_M, res, res)
    from rasterio.features import rasterize
    stats = []
    for p in ponds:
        g = p["geom"]
        lvl = p.get("level")
        if lvl is None:
            lvl = p["level"] = pond_level(ctx, g)
        inside = rasterize([(g, 1)], out_shape=(n, n), transform=tr, fill=0, dtype="uint8").astype(bool)
        if not inside.any():
            continue
        x0, y0, x1, y1 = g.bounds
        pad = POND_TERRACE_M + 2 * res
        c0, c1 = max(0, int((x0 - pad) // res)), min(n, int((x1 + pad) // res) + 1)
        r0, r1 = max(0, int((TILE_SIZE_M - y1 - pad) // res)), min(n, int((TILE_SIZE_M - y0 + pad) // res) + 1)
        win = (slice(r0, r1), slice(c0, c1))
        ins = inside[win]
        if not ins.any():
            continue
        dmax = float(min(2.4, max(0.6, 0.4 + 0.5 * np.sqrt(g.area / 1e4))))
        din = np.maximum(0, (ndimage.distance_transform_edt(ins) - 0.5) * res)      # the cell centre's distance inside, to the ring
        dout = np.maximum(0, (ndimage.distance_transform_edt(~ins) - 0.5) * res)    # ... outside
        depth = np.minimum(dmax, 0.08 + POND_SLOPE * din)
        zw = z[win]
        target = lvl - depth
        cut = np.where(ins, np.minimum(zw, np.maximum(target, zw - MAX_CUT_M)), zw)
        z[win] = cut
        zw = cut
        zn = zone[win]
        shallow = ins & (depth < POND_SHALLOW_M)
        zn[ins] = ZONE["pond_water"]
        zn[shallow] = ZONE["pond_margin"]
        shore = ~ins & (dout < POND_SHORE_M) & (zn == 0)
        terr = ~ins & (dout >= POND_SHORE_M) & (dout < POND_TERRACE_M) & (zn == 0) & (zw < lvl + POND_TERRACE_RISE_M)
        zn[shore] = ZONE["pond_shore"]
        zn[terr] = ZONE["pond_terrace"]
        mw = mat[win]
        mw[ins] = MATERIAL["silt"]
        mw[shallow] = MATERIAL["sand"]
        mw[shore & (mw == 0)] = MATERIAL["sand"]
        lv = level_of[win]
        sel = ins | shore
        lv[sel] = lvl
        fw = flag[win]
        fw[ins | shore | terr] = 0 if p["intermittent"] else 128
        stats.append({"id": p["id"], "name": p["name"], "area_m2": round(g.area, 1), "level_m": round(lvl, 2),
                      "max_depth_m": round(float(depth[ins].max()), 2), "cells": int(ins.sum()),
                      "intermittent": bool(p["intermittent"])})
    return stats


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def heights_png(tile: Tile, z: np.ndarray, res: float) -> tuple[dict, np.ndarray]:
    """client/heights.png as derive.client_rasters writes it; returns the layer and the heights as the client decodes them."""
    v = np.round((z + 10000) / 0.1).astype("int64")
    rgb = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype("uint8")
    Image.fromarray(rgb, "RGB").save(tile.path("client/heights.png"), optimize=True)
    q = -10000 + v * 0.1
    n = z.shape[0]
    return {"path": "client/heights.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds), "pixels": n,
            "resolution_m": res, "encoding": "mapbox-terrain-rgb", "elevation_range_m": [float(z.min()), float(z.max())],
            "derived_from": ["terrain.dem_banked"]}, q


def detail_png(tile: Tile, z2: np.ndarray, h5q: np.ndarray, res5: float) -> dict:
    """client/terrain_detail.png as lidar.terrain_detail writes it, from the carved 2 m ground against the carved 5 m
    heights (bilinear between their pixel centres)."""
    from scipy.ndimage import map_coordinates
    n2 = z2.shape[0]
    d2 = TILE_SIZE_M / n2
    centres = (np.arange(n2) + 0.5) * d2
    p = (centres - res5 / 2) / res5
    py, px = np.meshgrid(p, p, indexing="ij")
    base = map_coordinates(h5q, [py.ravel(), px.ravel()], order=1, mode="nearest").reshape(n2, n2)
    r = z2 - base
    r[~np.isfinite(r)] = 0
    q = np.round(r / 0.04)
    v = np.clip(q + 128, 0, 255).astype("uint8")
    Image.fromarray(v).save(tile.path("client/terrain_detail.png"), optimize=True)
    a = np.abs(r)
    return {"path": "client/terrain_detail.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds), "pixels": n2,
            "resolution_m": d2, "derived_from": ["terrain.dem_1m", "terrain.dem_banked"],
            "encoding": "8-bit grey, row 0 north: the 1 m ground averaged to 2 m and carved with the water system's banks, minus "
                        "client/heights.png bilinear between its pixel centres, residual m = (v - 128) * 0.04, clamped +-5.08 m",
            "stats": {"residual_m": {"mean": round(float(r.mean()), 3), "std": round(float(r.std()), 3),
                                     "p50_abs": round(float(np.median(a)), 3), "p99_abs": round(float(np.percentile(a, 99)), 3),
                                     "max_abs": round(float(a.max()), 2)},
                      "clipped_fraction": round(float(((q < -128) | (q > 127)).mean()), 6)}}


def build_water(tile: Tile, force: bool = False) -> dict:
    ctx = _Ctx(tile)
    n, res, z0 = ctx.n, ctx.res, ctx.z
    prof_path = tile.path("client/channel_profile.png")
    profile = np.asarray(Image.open(prof_path).convert("RGB")) if prof_path.exists() else None
    ponds = kept_ponds(ctx)
    pond_mask = ctx.rasterize([p["geom"] for p in ponds]).astype(bool) if ponds else np.zeros((n, n), bool)
    S = stream_samples(ctx, pond_mask, profile)
    if S["x"].size == 0:
        raise RuntimeError("no channels: run the channels and rewild_hydro steps first")

    # ---- the 5 m grid: carve, zones, material, level, half width
    near, d = nearest_sample(S, n, res)
    z5, in_bed, in_margin, in_bank, P = carve_streams(z0, res, S, near, d, pond_mask)
    order = np.clip(S["order"][near].astype(int), 1, 7)
    cls = S["cls"][near].astype(int)
    L, wh, t, slope, turn = S["L"][near], S["wh"][near], S["t"][near], S["S"][near], S["turn"][near]
    half = res / 2
    zone = np.zeros((n, n), "uint8")
    bed_c = d < np.maximum(wh, half)
    margin_c = ~bed_c & (d < np.maximum(wh + P["margin"], res))
    bank_c = ~bed_c & ~margin_c & (d < np.maximum(wh + P["margin"] + P["bank"], 1.5 * res))
    bank_top = L + P["bank_height"]
    terr_c = ~bed_c & ~margin_c & ~bank_c & (d < P["terrace"]) & (z0 < bank_top + TERRACE_RISE_M)
    zone[terr_c] = ZONE["terrace"]
    zone[bank_c] = ZONE["bank"]
    zone[margin_c] = ZONE["margin"]
    zone[bed_c] = ZONE["channel"]
    # ephemeral order-1 swales have no bed to speak of: their channel cells are margin (grass to the centre)
    swale = (cls == 0) & (order == 1)
    zone[bed_c & swale] = ZONE["margin"]
    stream_cells = zone > 0
    # material
    mat = np.zeros((n, n), "uint8")
    base_mat = np.full((n, n), MATERIAL["gravel"], "uint8")
    base_mat[(t < -0.3) & (order >= 3)] = MATERIAL["sand"]
    base_mat[(t < -0.3) & (order < 3)] = MATERIAL["silt"]
    base_mat[(t > 0.3) | ((slope > COBBLE_SLOPE) & (order >= 2)) | (order >= 4)] = MATERIAL["cobble"]
    base_mat[(slope > BOULDER_SLOPE) & (order >= 2)] = MATERIAL["boulder"]
    mat[bed_c] = base_mat[bed_c]
    mat[bed_c & swale] = MATERIAL["gravel"]
    margin_mat = np.where(order >= 3, MATERIAL["gravel"], MATERIAL["sand"]).astype("uint8")
    margin_mat[(slope > BOULDER_SLOPE) & (order >= 2)] = MATERIAL["cobble"]
    mat[margin_c] = margin_mat[margin_c]
    # a point bar on the inside of a bend: the margin cells on that side
    dx = (np.arange(n) + 0.5) * res - S["x"][near]
    dy = (TILE_SIZE_M - (np.arange(n)[:, None] + 0.5) * res) - S["y"][near]
    side = S["tx"][near] * dy - S["ty"][near] * dx     # + left of the flow
    bar = margin_c & (np.abs(turn) > BAR_TURN) & (np.sign(side) == np.sign(turn)) & (order >= 2) & (cls > 0)
    mat[bar] |= BAR
    mat[bar & ((mat & 7) == MATERIAL["silt"])] = MATERIAL["sand"] | BAR
    # level and half width
    level_of = np.zeros((n, n), "float64")
    level_of[stream_cells] = L[stream_cells]
    half_w = np.zeros((n, n), "float64")
    half_w[stream_cells] = wh[stream_cells]
    flag = np.zeros((n, n), "uint8")
    flag[stream_cells] = (order[stream_cells] << 4).astype("uint8") | np.where(cls[stream_cells] == 2, 128, 0).astype("uint8")

    # ---- ponds: basins into z5, zones, levels
    pond_stats = carve_ponds(ctx, z5, res, ponds, zone, mat, level_of, flag)

    # ---- write the banked DEM and the heights
    prof = dict(ctx.profile)
    prof.update(dtype="float32", count=1, compress="deflate", predictor=3)
    with rasterio.open(tile.path("terrain/dem_banked.tif"), "w", **prof) as dst:
        dst.write(z5.astype("float32"), 1)
    heights_layer, h5q = heights_png(tile, z5, res)
    cut = z0 - z5

    # ---- water.png
    B = np.zeros((n, n), "uint8")
    has_level = (zone > 0) & (level_of != 0)
    B[has_level] = np.clip(np.round((level_of[has_level] - h5q[has_level]) / LEVEL_UNIT) + 128, 1, 255).astype("uint8")
    A = np.zeros((n, n), "uint8")
    A[stream_cells] = np.clip(np.round(half_w[stream_cells] / HALF_UNIT), 1, 255).astype("uint8")
    R = (zone | flag).astype("uint8")
    Image.fromarray(np.dstack([R, mat, B]), "RGB").save(tile.path("client/water.png"), optimize=True)
    Image.fromarray(A, "L").save(tile.path("client/water_width.png"), optimize=True)

    # ---- the 2 m ground on a lidar tile
    detail_layer = None
    dem1 = tile.path("terrain/dem_1m.tif")
    if dem1.exists():
        with rasterio.open(dem1) as src:
            z1 = src.read(1).astype("float32")
            nod = src.nodata
        if nod is not None:
            z1[z1 == nod] = np.nan
        n2 = z1.shape[0] // 2
        z2 = z1.reshape(n2, 2, n2, 2).mean(axis=(1, 3)).astype("float64")
        del z1
        res2 = TILE_SIZE_M / n2
        fill = ~np.isfinite(z2)
        if fill.any():
            from scipy.ndimage import map_coordinates
            cen = (np.arange(n2) + 0.5) * res2
            p = (cen - res / 2) / res
            py, px = np.meshgrid(p, p, indexing="ij")
            z2[fill] = map_coordinates(z0, [py[fill], px[fill]], order=1, mode="nearest")
        near2, d2 = nearest_sample(S, n2, res2)
        pm2 = None
        if ponds:   # the pond mask on the 2 m grid
            from rasterio.features import rasterize
            tr2 = rasterio.transform.from_origin(0, TILE_SIZE_M, res2, res2)
            pm2 = rasterize([(p["geom"], 1) for p in ponds], out_shape=(n2, n2), transform=tr2, fill=0, dtype="uint8").astype(bool)
        z2c, *_ = carve_streams(z2, res2, S, near2, d2, pm2)
        del near2, d2
        zone2 = np.zeros((n2, n2), "uint8")
        mat2 = np.zeros((n2, n2), "uint8")
        lv2 = np.zeros((n2, n2), "float64")
        fl2 = np.zeros((n2, n2), "uint8")
        carve_ponds(ctx, z2c, res2, ponds, zone2, mat2, lv2, fl2)
        del zone2, mat2, lv2, fl2
        detail_layer = detail_png(tile, z2c, h5q, res)
        del z2c, z2

    # ---- the riparian zone mixes into species_mix.json
    from .species_mix import riparian_rows
    rows = riparian_rows()
    mix_path = tile.path("client/species_mix.json")
    mix_note = None
    if mix_path.exists():
        doc = json.loads(mix_path.read_text())
        doc["riparian"] = rows
        text = json.dumps({**doc, "mixes": "@MIXES@", "communities": "@COMMUNITIES@", "riparian": "@RIP@"}, indent=1)
        for k, rows_ in (("@MIXES@", doc["mixes"]), ("@COMMUNITIES@", doc["communities"])):
            text = text.replace(f'"{k}"', "[\n" + ",\n".join("  " + json.dumps(r, separators=(",", ":")) for r in rows_) + "\n ]")
        text = text.replace('"@RIP@"', json.dumps(rows, separators=(",", ":")))
        mix_path.write_text(text)
        mix_note = f"{len(rows['rows'])} riparian rows written into client/species_mix.json"

    # ---- stats and layers
    zc = {ZONE_NAMES[k]: int((zone == k).sum()) for k in range(1, 9)}
    mc = {name: int(((mat & 7) == k).sum()) for name, k in MATERIAL.items() if k}
    cut_cells = cut > 0.01
    stats = {
        "reaches": len(S["reaches"]), "samples": int(S["x"].size), "skipped": S["skipped"],
        "zone_cells": zc, "zone_area_ha": {k: round(v * res * res / 1e4, 2) for k, v in zc.items()},
        "material_cells": mc, "bar_cells": int((mat & BAR).sum() // BAR),
        "cut": {"cells": int(cut_cells.sum()), "mean_m": round(float(cut[cut_cells].mean()), 3) if cut_cells.any() else 0,
                "p95_m": round(float(np.percentile(cut[cut_cells], 95)), 3) if cut_cells.any() else 0,
                "max_m": round(float(cut.max()), 2)},
        "ponds": {"kept": len(ponds), "intermittent": sum(1 for p in ponds if p["intermittent"]), "basins": pond_stats},
        "bank_params": {o: BANK[o] for o in range(1, 6)},
        "by_order": {int(o): int((S["order"] == o).sum()) for o in np.unique(S["order"])},
        "species_mix": mix_note,
    }
    write_json(tile.path("hydro/water_reaches.json"), {"reaches": S["reaches"], "ponds": pond_stats})
    out = {
        "terrain.dem_banked": {
            "path": "terrain/dem_banked.tif", "kind": "raster", "units": "m", "derived_from": ["terrain.dem", "hydro.channels", "client.channel_profile", "hydro.waterbodies", "hydro.human_water"],
            "modification": ("terrain/dem.tif with every channel carved to its graded cross-section (channel bed L - D(1 - (o/wh)^2), wet "
                             "margin, bank and the pond basins; cells only lowered, at most 3 m); the client's heights come from it"),
            "cells_lowered": int(cut_cells.sum()), "max_cut_m": round(float(cut.max()), 2),
        },
        "client.heights": heights_layer,
        "client.water": {
            "path": "client/water.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds), "pixels": n, "resolution_m": res,
            "derived_from": ["hydro.channels", "client.channel_profile", "hydro.waterbodies", "hydro.human_water", "terrain.dem_banked"],
            "encoding": ("RGB, row 0 north. R: zone (low 4 bits; 1 channel bed, 2 wet margin, 3 bank, 4 terrace, 5 pond water, 6 pond margin, "
                         "7 pond shore, 8 pond terrace) | stream order << 4 | 128 perennial. G: bed material (low 3 bits: 1 silt, 2 sand, 3 gravel, "
                         "4 cobble, 5 boulder) | 8 bar. B: water level = heights.png height at the cell + (B - 128) x 0.02 m (0: none). "
                         "client/water_width.png (8-bit grey, same grid): water half width at the nearest centreline sample, 0.1 m units"),
            "files": {"client/water_width.png": {"sha256": sha256(tile.path("client/water_width.png")), "bytes": tile.path("client/water_width.png").stat().st_size}},
            "zones": ZONE, "materials": MATERIAL, "bank_params": {o: BANK[o] for o in range(1, 8)},
            "stats": stats,
        },
        "hydro.water_reaches": {"path": "hydro/water_reaches.json", "kind": "table", "derived_from": ["hydro.channels"],
                                "encoding": "per drawn reach: id, name, order, area_km2, width, class (0 ephemeral, 1 intermittent, 2 perennial), samples, length; the kept ponds' basins"},
    }
    if detail_layer:
        out["client.terrain_detail"] = detail_layer
    print("water:", json.dumps({k: v for k, v in stats.items() if k not in ("bank_params",)}, default=str)[:1500])
    return out
