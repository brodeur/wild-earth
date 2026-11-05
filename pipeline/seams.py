"""Seams: a tile and every built neighbour must agree along their shared edge (step `seams`, docs/pipeline.md).

Tiles sit at any whole kilometre, so a neighbour is any built tile in the same UTM zone whose square shares a stretch of
edge with this one (the two Hoh tiles, utm10n_429_5293 and utm10n_439_5293, share x = 439 km). For each shared edge:

  DEM     the last 5 m column (or row) on this side against the first on the other, 5 m apart: the step across the seam
          is compared with the steps between the columns just inside each tile. A seam is broken when its median step
          is more than SEAM_FACTOR times the inside median plus SEAM_SLACK_M (both tiles from one 3DEP mosaic agree to
          centimetres; a tile on another source, or another resolution, does not).
  streams every channel (hydro/channels.geojson) that crosses the edge on one side must cross it on the other within
          CROSS_TOL_M; an unmatched crossing of order MIN_ORDER or more breaks the seam (a creek that ends at a tile edge),
          smaller ones are listed.

Each edge is recorded in the manifest's `seams`; a broken one fails the step, naming it. Without a built neighbour the
step records that there is none and passes. The fix for a broken stream seam belongs to the routing (channels.py, the
water lane): route each tile with its neighbour's DEM as a margin, or seed the crossing from the neighbour's channel.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio

from .config import TILES_DIR, Tile, read_json

SEAM_FACTOR, SEAM_SLACK_M = 3.0, 1.0
CROSS_TOL_M, MIN_ORDER = 60.0, 3


def neighbours(tile: Tile) -> list[tuple[str, Tile]]:
    out = []
    x0, y0, x1, y1 = tile.bounds
    for p in sorted(TILES_DIR.glob(f"utm{tile.zone}{'n' if tile.north else 's'}_*/manifest.json")):
        tid = p.parent.name
        if tid == tile.tile_id:
            continue
        try:
            t = Tile.from_id(tid)
        except Exception:  # noqa: BLE001
            continue
        a0, b0, a1, b1 = t.bounds
        if a1 == x0 and min(y1, b1) > max(y0, b0):
            out.append(("west", t))
        elif a0 == x1 and min(y1, b1) > max(y0, b0):
            out.append(("east", t))
        elif b1 == y0 and min(x1, a1) > max(x0, a0):
            out.append(("south", t))
        elif b0 == y1 and min(x1, a1) > max(x0, a0):
            out.append(("north", t))
    return out


def _dem(t: Tile):
    p = t.dir / "terrain" / "dem.tif"
    with rasterio.open(p) as src:
        return src.read(1).astype("float64"), src.res[0], src.nodata


def _edge_lines(z, side):
    """(the edge line, the line just inside it), as 1-D arrays from south to north (west/east) or west to east."""
    if side == "west":
        return z[::-1, 0], z[::-1, 1]
    if side == "east":
        return z[::-1, -1], z[::-1, -2]
    if side == "south":
        return z[-1, :], z[-2, :]
    return z[0, :], z[1, :]


def dem_seam(tile: Tile, side: str, nb: Tile) -> dict:
    za, ra, na = _dem(tile)
    zb, rb, nbd = _dem(nb)
    if abs(ra - rb) > 1e-6:
        return {"problem": f"DEM resolutions differ ({ra} m against {rb} m)"}
    opp = {"west": "east", "east": "west", "south": "north", "north": "south"}[side]
    a_edge, a_in = _edge_lines(za, side)
    b_edge, b_in = _edge_lines(zb, opp)
    # the overlapping stretch, in cells along the edge
    x0, y0, x1, y1 = tile.bounds
    a0, b0, a1, b1 = nb.bounds
    if side in ("west", "east"):
        lo, hi = max(y0, b0), min(y1, b1)
        ia, ib = slice(int((lo - y0) / ra), int((hi - y0) / ra)), slice(int((lo - b0) / ra), int((hi - b0) / ra))
    else:
        lo, hi = max(x0, a0), min(x1, a1)
        ia, ib = slice(int((lo - x0) / ra), int((hi - x0) / ra)), slice(int((lo - a0) / ra), int((hi - a0) / ra))
    ae, ai, be, bi = a_edge[ia], a_in[ia], b_edge[ib], b_in[ib]
    ok = np.isfinite(ae) & np.isfinite(be) & (ae != na) & (be != nbd) & np.isfinite(ai) & np.isfinite(bi)
    if ok.sum() < 10:
        return {"problem": None, "note": "too few valid cells along the edge"}
    seam = np.abs(ae[ok] - be[ok])
    inside = np.concatenate([np.abs(ae[ok] - ai[ok]), np.abs(be[ok] - bi[ok])])
    med_s, med_i = float(np.median(seam)), float(np.median(inside))
    bad = med_s > SEAM_FACTOR * med_i + SEAM_SLACK_M
    return {"cells": int(ok.sum()), "median_step_m": round(med_s, 3), "median_inside_step_m": round(med_i, 3),
            "p95_step_m": round(float(np.percentile(seam, 95)), 3), "mean_offset_m": round(float(np.mean(ae[ok] - be[ok])), 3),
            "problem": f"DEM steps {med_s:.2f} m across the seam against {med_i:.2f} m inside" if bad else None}


def _crossings(t: Tile, side: str) -> list[dict]:
    from pyproj import Transformer
    p = t.dir / "hydro" / "channels.geojson"
    if not p.exists():
        return []
    to_t = Transformer.from_crs("EPSG:4326", t.crs, always_xy=True)
    x0, y0, x1, y1 = t.bounds
    out = []
    for f in read_json(p)["features"]:
        coords = f["geometry"]["coordinates"]
        for lon, lat in (coords[0], coords[-1]):
            x, y = to_t.transform(lon, lat)
            d = {"west": x - x0, "east": x1 - x, "south": y - y0, "north": y1 - y}[side]
            if d < 15:
                out.append({"along": round(y if side in ("west", "east") else x, 1), "order": f["properties"].get("order") or 0,
                            "name": f["properties"].get("name")})
    return out


def stream_seam(tile: Tile, side: str, nb: Tile) -> dict:
    opp = {"west": "east", "east": "west", "south": "north", "north": "south"}[side]
    a, b = _crossings(tile, side), _crossings(nb, opp)
    unmatched = [c for c in a if not any(abs(c["along"] - d["along"]) <= CROSS_TOL_M for d in b)]
    unmatched += [c for c in b if not any(abs(c["along"] - d["along"]) <= CROSS_TOL_M for d in a)]
    major = [c for c in unmatched if c["order"] >= MIN_ORDER]
    return {"crossings_here": len(a), "crossings_there": len(b), "unmatched": unmatched[:30],
            "problem": (f"{len(major)} stream(s) of order >= {MIN_ORDER} cross on one side only: "
                        + ", ".join(f"{c.get('name') or 'unnamed'} (order {c['order']}) at {c['along']:.0f} m" for c in major[:5]))
            if major else None}


def check_seams(tile: Tile) -> dict:
    edges = []
    for side, nb in neighbours(tile):
        e = {"side": side, "neighbour": nb.tile_id}
        try:
            d = dem_seam(tile, side, nb)
            s = stream_seam(tile, side, nb)
        except Exception as ex:  # noqa: BLE001
            e["problem"] = f"could not compare: {str(ex)[:160]}"
            edges.append(e)
            continue
        e["dem"], e["streams"] = d, s
        probs = [x for x in (d.get("problem"), s.get("problem")) if x]
        e["problem"] = "; ".join(probs) if probs else None
        edges.append(e)
    return {"edges": edges, "neighbours": len(edges),
            "note": "no built neighbour" if not edges else f"{sum(1 for e in edges if not e.get('problem'))} of {len(edges)} edges agree"}


def main(argv=None) -> None:
    import argparse
    ap = argparse.ArgumentParser(description="Check a tile's seams with its built neighbours.")
    ap.add_argument("tile")
    a = ap.parse_args(argv)
    print(json.dumps(check_seams(Tile.from_id(a.tile)), indent=1))


if __name__ == "__main__":
    main()
