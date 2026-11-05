"""Does the water sit at the lowest ground? A per-tile check of the drawn streams against the 1 m lidar ground.

    python -m pipeline.water_check --tile utm10n_680_4280                       # the tile as it is
    python -m pipeline.water_check --tile utm10n_680_4280 --channels hydro/channels_5m.geojson --levels 5m   # before the reroute

Every drawn reach is sampled as the water step samples it (water.stream_samples: every 2.5 m, the level L, the water
half width wh), and at each sample, on the raw 1 m DEM (terrain/dem_1m.tif):

  bed_gap      the ground under the centreline minus the lowest ground across the channel (perpendicular to the flow
               over +-R, R = max(3 m, wh + the wet margin + the bank of water.bank_params)): the fraction within 5 cm
               and 15 cm, the median and p95. A line on the thalweg has a gap of 0.
  clip         the ground under the centreline minus the water level: where the level is far below the ground the line
               runs through a bank or a spur and the water step must cut a trench for it (fraction over 0.25 m, p95, max).
  above_bank   the level minus the lower of the two grounds at the outer edge of the wet margin (+-(wh + margin)): water
               standing higher than the ground beside it would spill (fraction over 0.10 m, max).
  rises        the level climbing downstream: within a reach (sample to sample, over 1 mm), and from a reach's last
               sample into the reach it flows into (the lowest level of any other reach within 6 m; over 5 cm).
  nhd_offset   the distance from each sample to the nearest NHD flowline (the mapped line), on reaches that matched one:
               median, p90, max.
  shift        with hydro/channels_5m.geojson present: the distance from each sample to the nearest 5 m routed line
               (how far the reroute moved the water): median, p90, max.

`--levels 5m` takes the level from the 5 m DEM as the water step did before the reroute; `--levels 1m` (the default on a
rerouted tile) from the 1 m ground. The report is printed and, with --out, written as JSON.
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from shapely.geometry import shape
from shapely.strtree import STRtree

from .config import Tile, TILE_SIZE_M
from .reroute import FineDEM
from .rewild_hydro import _Ctx
from .water import BANK, kept_ponds, stream_samples


def _pct(v, q):
    return round(float(np.percentile(v, q)), 3) if len(v) else None


def _nearest_dist(lines, xs, ys, cap=100.0):
    from shapely import points
    if not lines:
        return np.full(len(xs), np.nan)
    tree = STRtree(lines)
    pts = points(np.column_stack([xs, ys]))
    idx, d = tree.query_nearest(pts, max_distance=cap, return_distance=True, all_matches=False)
    out = np.full(len(xs), np.nan)
    out[idx[0]] = d
    return out


def check(tile: Tile, channels: str = "hydro/channels.geojson", levels: str | None = None, dem: FineDEM | None = None) -> dict:
    ctx = _Ctx(tile)
    dem = dem or FineDEM(tile, ctx.z)
    doc = json.load(open(tile.path(channels)))
    if levels is None:
        levels = "1m" if doc.get("rerouted") else "5m"
    ponds = kept_ponds(ctx)
    pond_mask = ctx.rasterize([p["geom"] for p in ponds]).astype(bool) if ponds else np.zeros((ctx.n, ctx.n), bool)
    S = stream_samples(ctx, pond_mask, None, zat_level=(lambda x, y: dem.at(x, y)) if levels == "1m" else None,
                       channels=channels)
    x, y, L, wh = S["x"], S["y"], S["L"], S["wh"]
    tx, ty = S["tx"], S["ty"]
    order = np.clip(S["order"].astype(int), 1, 7)
    reach = S["reach"].astype(int)
    m = np.array([BANK[o]["margin"] for o in range(1, 8)])[order - 1]
    b = np.array([BANK[o]["bank"] for o in range(1, 8)])[order - 1]
    nx, ny = -ty, tx
    g0 = dem.at(x, y)
    # the cross-section's lowest ground, in chunks
    R = np.maximum(3.0, wh + m + b)
    gap = np.empty(len(x))
    offs_unit = np.linspace(-1, 1, 41)
    for a in range(0, len(x), 20000):
        sl = slice(a, a + 20000)
        o = R[sl, None] * offs_unit[None, :]
        Z = dem.at((x[sl, None] + nx[sl, None] * o).ravel(), (y[sl, None] + ny[sl, None] * o).ravel()).reshape(o.shape)
        gap[sl] = g0[sl] - Z.min(axis=1)
    clip = g0 - L
    e = wh + m
    side = np.minimum(dem.at(x + nx * e, y + ny * e), dem.at(x - nx * e, y - ny * e))
    above = L - side
    # rises within a reach
    same = reach[1:] == reach[:-1]
    dL = L[1:] - L[:-1]
    within = dL[same]
    # rises into the receiving reach
    ends = np.flatnonzero(np.concatenate([~same, [True]]))
    from scipy.spatial import cKDTree
    kd = cKDTree(np.column_stack([x, y]))
    junction_rises = []
    for i in ends:
        nb = [j for j in kd.query_ball_point([x[i], y[i]], 6.0) if reach[j] != reach[i]]
        if nb:
            junction_rises.append(float(np.min(L[nb]) - L[i]))
    jr = np.array(junction_rises)
    # offsets from the mapped (NHD) lines on matched reaches, and from the 5 m routing
    nhd = []
    for f in ctx.load("hydro/flowlines.geojson"):
        if f.get("geometry"):
            g = ctx.local(shape(f["geometry"]))
            nhd.extend([p for p in getattr(g, "geoms", [g]) if p.length > 0])
    feats = doc["features"]
    matched_names = set()
    rid_matched = np.zeros(reach.max() + 1 if reach.size else 1, bool)
    # stream_samples numbers the drawable line parts in file order; rebuild the same list to know which matched NHD
    k = 0
    for f in feats:
        pr = f["properties"]
        if pr.get("fcode") == 33600:
            continue
        g = ctx.local(shape(f["geometry"]))
        for ln in (g.geoms if g.geom_type == "MultiLineString" else [g]):
            if ln.geom_type == "LineString" and ln.length >= 1:
                if k < rid_matched.size:
                    rid_matched[k] = bool(pr.get("nhd_matched")) and pr.get("source") == "dem"
                k += 1
    mm = rid_matched[reach]
    nd = _nearest_dist(nhd, x[mm], y[mm])
    nd = nd[np.isfinite(nd)]
    five = tile.path("hydro/channels_5m.geojson")
    shift = None
    if five.exists() and channels != "hydro/channels_5m.geojson":
        old = []
        for f in json.load(open(five))["features"]:
            g = ctx.local(shape(f["geometry"]))
            old.extend([p for p in getattr(g, "geoms", [g]) if p.length > 0])
        sd = _nearest_dist(old, x, y)
        sd = sd[np.isfinite(sd)]
        shift = {"median_m": _pct(sd, 50), "p90_m": _pct(sd, 90), "p99_m": _pct(sd, 99), "max_m": round(float(sd.max()), 1) if sd.size else None}
    rep = {
        "tile": tile.tile_id, "channels": channels, "levels": levels, "rerouted": bool(doc.get("rerouted")),
        "samples": int(len(x)), "reaches": len(S["reaches"]), "length_km": round(len(x) * 2.5 / 1000, 1),
        "bed_gap": {"within_5cm": round(float((gap <= 0.05).mean()), 3), "within_15cm": round(float((gap <= 0.15).mean()), 3),
                    "median_m": _pct(gap, 50), "p95_m": _pct(gap, 95), "max_m": round(float(gap.max()), 2)},
        "clip": {"over_25cm": round(float((clip > 0.25).mean()), 3), "over_1m": round(float((clip > 1.0).mean()), 4),
                 "p95_m": _pct(clip, 95), "max_m": round(float(clip.max()), 2)},
        "above_bank": {"over_10cm": round(float((above > 0.10).mean()), 4), "samples_over_10cm": int((above > 0.10).sum()),
                       "max_m": round(float(above.max()), 2)},
        "rises": {"within_reach": int((within > 1e-3).sum()), "within_max_m": round(float(within.max()), 3) if within.size else 0,
                  "into_receiving_reach_over_5cm": int((jr > 0.05).sum()) if jr.size else 0, "reach_ends_checked": int(jr.size),
                  "into_max_m": round(float(jr.max()), 2) if jr.size else 0},
        "nhd_offset": {"median_m": _pct(nd, 50), "p90_m": _pct(nd, 90), "max_m": round(float(nd.max()), 1) if nd.size else None},
    }
    if shift:
        rep["shift_from_5m"] = shift
    # the same away from the erased roads (reroute.road_zone): under a road fill the raw ground is the fill, not a bed
    from .reroute import road_zone
    zone5 = road_zone(tile)
    if zone5 is not None:
        n5 = zone5.shape[0]
        r5 = TILE_SIZE_M / n5
        on = zone5[np.clip(((TILE_SIZE_M - y) // r5).astype(int), 0, n5 - 1), np.clip((x // r5).astype(int), 0, n5 - 1)]
        off = ~on
        rep["off_roads"] = {"samples": int(off.sum()), "share": round(float(off.mean()), 3),
                            "bed_within_5cm": round(float((gap[off] <= 0.05).mean()), 3),
                            "bed_within_15cm": round(float((gap[off] <= 0.15).mean()), 3),
                            "clip_over_25cm": round(float((clip[off] > 0.25).mean()), 3),
                            "clip_over_1m": round(float((clip[off] > 1.0).mean()), 4),
                            "above_bank_over_10cm": round(float((above[off] > 0.10).mean()), 4)}
    # the worst places, for a look in the viewer
    worst = np.argsort(-gap)[:5]
    rep["worst_gap"] = [{"x": round(float(x[i]), 1), "north": round(float(y[i]), 1), "gap_m": round(float(gap[i]), 2),
                         "order": int(order[i])} for i in worst]
    worst = np.argsort(-clip)[:5]
    rep["worst_clip"] = [{"x": round(float(x[i]), 1), "north": round(float(y[i]), 1), "clip_m": round(float(clip[i]), 2),
                          "order": int(order[i])} for i in worst]
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser(description="water against the 1 m ground")
    ap.add_argument("--tile", required=True)
    ap.add_argument("--channels", default="hydro/channels.geojson")
    ap.add_argument("--levels", choices=["5m", "1m"])
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    rep = check(Tile.from_id(a.tile), a.channels, a.levels)
    print(json.dumps(rep, indent=1))
    if a.out:
        with open(a.out, "w") as f:
            json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
