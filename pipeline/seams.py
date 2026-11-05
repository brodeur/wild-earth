"""Seams: a tile and every built neighbour must agree along their shared edge (step `seams`, docs/pipeline.md).

Tiles sit at any whole kilometre, so a neighbour is any built tile in the same UTM zone whose square shares a stretch of
edge with this one (the two Hoh tiles, utm10n_429_5293 and utm10n_439_5293, share x = 439 km). For each shared edge:

  DEM     the last 5 m column (or row) on this side against the first on the other, 5 m apart: the step across the seam
          is compared with the steps between the columns just inside each tile. A seam is broken when its median step
          is more than SEAM_FACTOR times the inside median plus SEAM_SLACK_M (both tiles from one 3DEP mosaic agree to
          centimetres; a tile on another source, or another resolution, does not).
  streams with both tiles' hydro/edges.json (the reroute step's crossings, pipeline/water_seams.py): every crossing on
          the edge matched with the other side's (the other way round, within CROSS_TOL_M along it) must sit on the
          same point (POS_TOL_M), at the same level (LEVEL_TOL_M; the water step's), width, order and name; an
          unmatched crossing of order MIN_ORDER or more breaks the seam, smaller ones are listed. A mismatch names
          the tile that should run `--steps reroute,water` again to adopt the other's (water_seams: the first tile
          built decides). Without edges.json on both sides, the old test: every drawn line (not on the ice, not in a
          waterbody, not a zero-length stub) ending within 15 m of the edge on one side must end within CROSS_TOL_M
          of one on the other.

Each edge is recorded in the manifest's `seams`; a broken one fails the step, naming it. Without a built neighbour the
step records that there is none and passes.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio

from .config import TILES_DIR, Tile, read_json

SEAM_FACTOR, SEAM_SLACK_M = 3.0, 1.0
CROSS_TOL_M, MIN_ORDER = 60.0, 3
POS_TOL_M, LEVEL_TOL_M = 1.0, 0.10


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
    """The drawn line ends within 15 m of the edge (no edges.json): not the routed lines across glaciers, the pieces in
    waterbodies, or zero-length stubs."""
    from pyproj import Transformer
    from shapely.geometry import shape
    p = t.dir / "hydro" / "channels.geojson"
    if not p.exists():
        return []
    to_t = Transformer.from_crs("EPSG:4326", t.crs, always_xy=True)
    x0, y0, x1, y1 = t.bounds
    out = []
    for f in read_json(p)["features"]:
        pr = f["properties"]
        if pr.get("on_ice") or pr.get("in_waterbody") or f["geometry"]["type"] != "LineString":
            continue
        coords = f["geometry"]["coordinates"]
        ends = [to_t.transform(lon, lat) for lon, lat in (coords[0][:2], coords[-1][:2])]
        if np.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) < 1.0 and len(coords) <= 2:
            continue
        for x, y in ends:
            d = {"west": x - x0, "east": x1 - x, "south": y - y0, "north": y1 - y}[side]
            if d < 15:
                out.append({"along": round(y if side in ("west", "east") else x, 1), "order": pr.get("order") or 0,
                            "name": pr.get("name")})
    return out


def _edge_records(t: Tile, side: str) -> list[dict] | None:
    p = t.dir / "hydro" / "edges.json"
    if not p.exists():
        return None
    return [r for r in read_json(p).get("crossings", []) if r.get("side") == side]


def _rerun(ta: str, a: dict, tb: str, b: dict) -> str:
    """Which side re-runs reroute,water to adopt the other's crossing: the side the other raised the order over, else
    the side that has not seen the other's crossing (built before it), else this one."""
    if a.get("order_over_neighbour"):
        return tb
    if b.get("order_over_neighbour"):
        return ta
    if a.get("seen_neighbour") and not b.get("seen_neighbour"):
        return tb
    if b.get("seen_neighbour") and not a.get("seen_neighbour"):
        return ta
    return ta


def stream_seam(tile: Tile, side: str, nb: Tile) -> dict:
    """With both tiles' hydro/edges.json (pipeline/water_seams.py): every crossing matched with the other side's (the
    other way round, within CROSS_TOL_M along the edge), at the same point (POS_TOL_M), level (LEVEL_TOL_M), width,
    order and name. Without them, the line ends as before."""
    opp = {"west": "east", "east": "west", "south": "north", "north": "south"}[side]
    A, B = _edge_records(tile, side), _edge_records(nb, opp)
    if A is None or B is None:
        a, b = _crossings(tile, side), _crossings(nb, opp)
        unmatched = [c for c in a if not any(abs(c["along"] - d["along"]) <= CROSS_TOL_M for d in b)]
        unmatched += [c for c in b if not any(abs(c["along"] - d["along"]) <= CROSS_TOL_M for d in a)]
        major = [c for c in unmatched if c["order"] >= MIN_ORDER]
        return {"method": "line ends", "crossings_here": len(a), "crossings_there": len(b), "unmatched": unmatched[:30],
                "problem": (f"{len(major)} stream(s) of order >= {MIN_ORDER} cross on one side only: "
                            + ", ".join(f"{c.get('name') or 'unnamed'} (order {c['order']}) at {c['along']:.0f} m" for c in major[:5]))
                if major else None}
    pairs = sorted((abs(a["along"] - b["along"]), i, j) for i, a in enumerate(A) for j, b in enumerate(B)
                   if a["dir"] != b["dir"] and abs(a["along"] - b["along"]) <= CROSS_TOL_M)
    mi, mj, matched = set(), set(), []
    for _, i, j in pairs:
        if i in mi or j in mj:
            continue
        mi.add(i)
        mj.add(j)
        matched.append((A[i], B[j]))
    probs, rows, rerun = [], [], set()
    for a, b in matched:
        off = float(np.hypot(a["x"] - b["x"], a["y"] - b["y"]))
        dl = (a["level"] - b["level"]) if a.get("level") is not None and b.get("level") is not None else None
        dw = abs((a.get("width") or 0) - (b.get("width") or 0))
        step = (a["level_own"] - b["level_own"]) if a.get("level_own") is not None and b.get("level_own") is not None else None
        row = {"along": a["along"], "name": a.get("name"), "order": [a.get("order"), b.get("order")], "offset_m": round(off, 2),
               "level_diff_m": round(dl, 3) if dl is not None else None, "width_diff_m": round(dw, 2),
               "own_level_step_m": round(step, 2) if step is not None else None}
        rows.append(row)
        what = []
        if off > POS_TOL_M:
            what.append(f"{off:.1f} m apart")
        if dl is None:
            what.append("no level on " + ("this side" if a.get("level") is None else "the other side"))
        elif abs(dl) > LEVEL_TOL_M:
            what.append(f"levels {dl:+.2f} m apart")
        if dw > 0.1 * max(a.get("width") or 0, b.get("width") or 0) + 0.1:
            what.append(f"widths {a.get('width')} and {b.get('width')} m")
        if a.get("order") != b.get("order"):
            what.append(f"order {a.get('order')} here, {b.get('order')} there")
        if (a.get("name") or None) != (b.get("name") or None):
            what.append(f"named {a.get('name')!r} here, {b.get('name')!r} there")
        if what:
            rerun.add(_rerun(tile.tile_id, a, nb.tile_id, b))
            probs.append(f"{a.get('name') or 'unnamed'} at {a['along']:.0f} m: " + ", ".join(what))
    un_a = [{"along": a["along"], "name": a.get("name"), "order": a.get("order"), "dir": a["dir"], "side": "here"}
            for i, a in enumerate(A) if i not in mi]
    un_b = [{"along": b["along"], "name": b.get("name"), "order": b.get("order"), "dir": b["dir"], "side": "there"}
            for j, b in enumerate(B) if j not in mj]
    major = [c for c in un_a + un_b if (c["order"] or 0) >= MIN_ORDER]
    if major:
        probs.append(f"{len(major)} stream(s) of order >= {MIN_ORDER} cross on one side only: "
                     + ", ".join(f"{c.get('name') or 'unnamed'} (order {c['order']}, {c['side']}) at {c['along']:.0f} m" for c in major[:5]))
        rerun.update(nb.tile_id if c["side"] == "here" else tile.tile_id for c in major)
    return {"method": "edges.json", "crossings_here": len(A), "crossings_there": len(B), "matched": rows[:40],
            "max_offset_m": max((r["offset_m"] for r in rows), default=None),
            "max_level_diff_m": max((abs(r["level_diff_m"]) for r in rows if r["level_diff_m"] is not None), default=None),
            "max_own_level_step_m": max((abs(r["own_level_step_m"]) for r in rows if r["own_level_step_m"] is not None), default=None),
            "unmatched": (un_a + un_b)[:30],
            "rerun": sorted(rerun) or None,
            "problem": ("; ".join(probs[:6]) + (f" (re-run --steps reroute,water on {', '.join(sorted(rerun))})" if rerun else ""))
            if probs else None}


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
