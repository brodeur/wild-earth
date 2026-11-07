"""Roads rewilded in the ground's heights (2026-11-07, Aaron: "Yes, remove road").

A road is not kept: its pavement and verge go back to the surrounding habitat in the imagery (erase_imagery), its weight
is 0 in the client (derive), and here its cut and fill go back to the ground the slope would have without it. In each
road's corridor (the OSM line buffered by its paved half-width x CORRIDOR_K plus CORRIDOR_M: the pavement, the verge and
the cut or fill slopes) the ground is compared with the harmonic surface spanned from the corridor's edges (Laplace's
equation with the edges, and every stream line through the corridor, held: a culvert's fill is spanned across from the
valley floor beside it and from the stream under it, so the valley comes back where the water already runs); where the
ground stands off that surface by more than DEV_LO (the cut or the fill), it is moved onto it, fully past DEV_HI and over
EDGE_M from the corridor's edge, so the fill meets the untouched ground without a seam. A road that follows a natural
bench is left: the corridor's edges are on the bench and so is the surface. Bridges are not corridors (the bare-earth
ground under a deck is the valley already).

The same rule runs on the 1 m ground (lidar.build_dem_1m: terrain/dem_1m.tif, which the drawn 5 m DEM is averaged from
on a lidar tile, and which the reroute and water steps read) and, on a tile without the 1 m products, on the fetched 5 m
(steps._dem), so the drawn ground and the water's ground are the same. Idempotent: the ground as fetched is kept beside
the product (`*_roaded.tif`) and the rule always runs from it; a re-fetched product is taken as the new original.

    python -m pipeline.unroad --tile utm12n_557_4964      # the 1 m ground (and the 5 m on a tile without it)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import rasterio

from .config import Tile, read_json, write_json

VERSION = "1"  # (the corridor key also holds the constants)
CORRIDOR_K = 3.0        # the corridor: the paved half-width x this (the old decayed-road verge reached 3x) ...
CORRIDOR_M = 4.0        # ... plus this much for the cut and fill slopes (m)
DEV_LO, DEV_HI = 0.10, 0.40   # the ground's departure from the spanned surface (m) at which the road's ground starts / is wholly replaced
EDGE_M = 4.0            # the replacement eases in over this distance from the corridor's edge (m)
CORE_K = 2.0            # the road's own prism (the paved half-width x this: pavement and inner verge) is replaced wherever it
                        # departs at all; outside it only the cut or fill beyond DEV_LO
GRAIN_SIGMA = 3.0       # the replaced ground takes the micro-relief of the ground around it: its high pass over this (m)
STREAM_HOLD_M = 2.5     # stream lines through a corridor are held at their own ground within this distance (m)
MAX_SOURCE_RES_M = 10.0  # the drawn DEM is rewilded only from a product this fine (3DEP 1 m / 10 m); not GLO-30
STREAM_NEAR_M = 40.0    # within this distance of a stream line the rule only takes ground away (a fill), never raises it:
                        # a channel under a bridge OSM does not tag, or beside a road along a river, is not a cut to fill
WIN = 800               # solve windows (px) ...
PAD = 120               # ... with this much context on every side
NODATA = -9999.0
ROAD_SKIP = ("path", "footway", "steps", "cycleway", "bridleway")
# the paved half-widths (m), as derive.DECAY_HALF_WIDTH (the pavement a road actually has; OSM's mapping widths are
# generous)
HALF_WIDTH = {"motorway": 8, "motorway_link": 4, "trunk": 7, "trunk_link": 4, "primary": 6, "primary_link": 3.5,
              "secondary": 5, "secondary_link": 3, "tertiary": 4.5, "residential": 3.5, "unclassified": 3.5,
              "living_street": 3, "service": 2.5, "track": 2}


def road_lines(tile: Tile) -> list[tuple]:
    """(geometry in the tile's CRS, paved half-width m) of every road but paths and bridges, from footprint/mask.geojson."""
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    from .fetch_osm import is_bridge
    p = tile.dir / "footprint/mask.geojson"
    if not p.exists():
        return []
    fc = json.loads(p.read_text())
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    out = []
    for f in fc["features"]:
        pr = f.get("properties") or {}
        hw = pr.get("highway")
        if pr.get("class") != "road" or hw in ROAD_SKIP or is_bridge(pr):
            continue
        g = shp_transform(to_tile, shape(f["geometry"]))
        if not g.is_empty:
            out.append((g, float(HALF_WIDTH.get(hw, pr.get("buffer_m") or 2.5))))
    return out


def stream_lines(tile: Tile) -> list:
    """The NHD (or OSM fallback) stream lines in the tile's CRS, from hydro/flowlines.geojson."""
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    p = tile.dir / "hydro/flowlines.geojson"
    if not p.exists():
        return []
    fc = json.loads(p.read_text())
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    out = []
    for f in fc.get("features") or []:
        g = shape(f["geometry"])
        if g.is_empty:
            continue
        x0, y0, x1, y1 = g.bounds
        out.append(shp_transform(to_tile, g) if max(abs(x0), abs(x1)) <= 360 else g)
    return out


def corridor_masks(roads, streams, shape_, transform):
    """(corridor bool, held bool: stream lines inside it, core bool: the road's own prism, near bool: within STREAM_NEAR_M
    of a stream line) on a grid."""
    import shapely
    from rasterio.features import rasterize
    corr = np.zeros(shape_, bool)
    core = np.zeros(shape_, bool)
    if roads:
        geoms = [shapely.buffer(g, h * CORRIDOR_K + CORRIDOR_M) for g, h in roads]
        corr = rasterize([(g, 1) for g in geoms], out_shape=shape_, transform=transform, fill=0, dtype="uint8").astype(bool)
        core = rasterize([(shapely.buffer(g, h * CORE_K), 1) for g, h in roads], out_shape=shape_, transform=transform,
                         fill=0, dtype="uint8").astype(bool)
    held = np.zeros(shape_, bool)
    if streams and corr.any():
        res = abs(transform.a)
        held = rasterize([(shapely.buffer(g, max(STREAM_HOLD_M, res * 0.75)), 1) for g in streams], out_shape=shape_,
                         transform=transform, fill=0, dtype="uint8").astype(bool) & corr
    near = np.zeros(shape_, bool)
    if streams and corr.any():
        near = rasterize([(shapely.buffer(g, STREAM_NEAR_M), 1) for g in streams], out_shape=shape_, transform=transform,
                         fill=0, dtype="uint8").astype(bool) & corr
    return corr, held, core, near


def harmonic_fill(z: np.ndarray, unknown: np.ndarray) -> np.ndarray:
    """z with the `unknown` cells replaced by the solution of Laplace's equation, the other cells held (5-point stencil,
    the window's own edge held where an unknown touches it)."""
    import scipy.sparse as sp
    import scipy.sparse.linalg as spla
    h, w = z.shape
    u = unknown.copy()
    u[0, :] = u[-1, :] = u[:, 0] = u[:, -1] = False
    idx = -np.ones((h, w), np.int64)
    ys, xs = np.nonzero(u)
    n = len(ys)
    if n == 0:
        return z
    idx[ys, xs] = np.arange(n)
    rows, cols, vals = [np.arange(n)], [np.arange(n)], [np.full(n, 4.0)]
    b = np.zeros(n)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ny, nx = ys + dy, xs + dx
        j = idx[ny, nx]
        inside = j >= 0
        rows.append(np.nonzero(inside)[0]); cols.append(j[inside]); vals.append(np.full(inside.sum(), -1.0))
        b[~inside] += z[ny[~inside], nx[~inside]]
    A = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))
    sol = spla.spsolve(A.tocsc(), b)
    out = z.copy()
    out[ys, xs] = sol
    return out


def flatten(z: np.ndarray, corr: np.ndarray, held: np.ndarray, core: np.ndarray, res: float, near=None) -> tuple[np.ndarray, dict]:
    """The road rule on one grid: returns (ground, stats)."""
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    out = z.copy()
    H, W = z.shape
    moved = 0.0
    cells = 0
    max_cut = max_fill = 0.0
    for r0 in range(0, H, WIN):
        for c0 in range(0, W, WIN):
            r1, c1 = min(H, r0 + WIN), min(W, c0 + WIN)
            if not corr[r0:r1, c0:c1].any():
                continue
            R0, C0, R1, C1 = max(0, r0 - PAD), max(0, c0 - PAD), min(H, r1 + PAD), min(W, c1 + PAD)
            zz = z[R0:R1, C0:C1].astype(np.float64)
            cc = corr[R0:R1, C0:C1]
            bad = zz == NODATA
            if bad.any():                             # no ground there: leave the corridor alone where it touches a gap
                from scipy.ndimage import binary_dilation
                cc = cc & ~binary_dilation(bad, iterations=3)
            unknown = cc & ~held[R0:R1, C0:C1] & ~bad
            if not unknown.any():
                continue
            surf = harmonic_fill(zz, unknown)
            # the ground's grain around the corridor laid over the spanned surface, so the replaced strip is not smoother than
            # the slope it rejoins (band-limited noise at the surrounding high pass's amplitude, seeded by the window)
            sg = max(GRAIN_SIGMA / res, 0.75)
            hp = zz - gaussian_filter(np.where(bad, np.median(zz[~bad]) if (~bad).any() else 0.0, zz), sg)
            ring = ~cc & ~bad
            # (a robust amplitude: the median absolute high pass, so the window's own banks and scarps do not inflate it)
            amp = 1.4826 * float(np.median(np.abs(hp[ring]))) if ring.sum() > 100 else 0.0
            if amp > 0:
                rng = np.random.default_rng((r0 * 7919 + c0) & 0xffffffff)
                g = gaussian_filter(rng.standard_normal(zz.shape), sg)
                surf = surf + g * (amp / max(float(np.std(g)), 1e-6))
            dev = zz - surf
            edge = distance_transform_edt(cc) * res
            kc = np.clip(distance_transform_edt(core[R0:R1, C0:C1]) * res / 2.0, 0, 1)   # the prism, eased in over 2 m
            wgt = np.clip(edge / EDGE_M, 0, 1) * np.maximum(kc, np.clip((np.abs(dev) - DEV_LO) / (DEV_HI - DEV_LO), 0, 1)) * unknown
            if near is not None:   # by a stream only a fill comes off (dev > 0); the channel itself is never raised
                wgt = np.where(near[R0:R1, C0:C1] & (dev < 0), 0.0, wgt)
            new = zz - wgt * dev
            rr, cc0 = slice(r0 - R0, r0 - R0 + (r1 - r0)), slice(c0 - C0, c0 - C0 + (c1 - c0))
            out[r0:r1, c0:c1] = new[rr, cc0].astype(z.dtype)
            d = (wgt * dev)[rr, cc0]
            moved += float(np.abs(d).sum()) * res * res
            cells += int((wgt[rr, cc0] > 0).sum())
            max_fill = max(max_fill, float(d.max()))   # ground taken off (a fill)
            max_cut = max(max_cut, float(-d.min()))    # ground put back (a cut)
    return out, {"corridor_share": round(float(corr.mean()), 5), "changed_m2": round(cells * res * res),
                 "volume_m3": round(moved), "max_fill_removed_m": round(max_fill, 2), "max_cut_filled_m": round(max_cut, 2)}


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()[:16]


def _corridor_key(tile: Tile) -> str:
    h = hashlib.sha256(VERSION.encode())
    for rel in ("footprint/mask.geojson", "hydro/flowlines.geojson"):
        p = tile.dir / rel
        h.update(_sha(p).encode() if p.exists() else b"-")
    h.update(json.dumps([CORRIDOR_K, CORRIDOR_M, DEV_LO, DEV_HI, EDGE_M, STREAM_HOLD_M, CORE_K, GRAIN_SIGMA, 'robust-grain', STREAM_NEAR_M]).encode())
    return h.hexdigest()[:16]


def apply(tile: Tile, rel: str, where: np.ndarray | None = None) -> dict:
    """The rule on terrain/<rel> (a DEM GeoTIFF), idempotently: the original kept as <stem>_roaded.tif and recorded in
    <stem>_unroad.json with the output's hash, so a rerun with the same roads changes nothing and a re-fetched product
    becomes the new original. Returns the stats (recorded in the DEM's layer)."""
    p = tile.path(rel)
    orig = p.with_name(p.stem + "_roaded.tif")
    meta_p = p.with_name(p.stem + "_unroad.json")
    meta = read_json(meta_p) if meta_p.exists() else {}
    key = _corridor_key(tile)
    if where is not None:   # the rule only on these cells (the drawn DEM's gaps in the 1 m ground, which has had it)
        key = hashlib.sha256((key + hashlib.sha256(np.packbits(where).tobytes()).hexdigest()).encode()).hexdigest()[:16]
    cur = _sha(p)
    if meta.get("out_sha") == cur and meta.get("key") == key:
        return meta.get("stats", {})
    if meta.get("out_sha") != cur or not orig.exists():
        shutil.copyfile(p, orig)                     # the product as fetched (or re-fetched): the new original
    roads = road_lines(tile)
    with rasterio.open(orig) as src:
        z = src.read(1)
        prof = src.profile
        tr = src.transform
    if not roads:
        stats = {"roads": 0, "note": "no roads in footprint/mask.geojson (or no footprint): the ground as fetched"}
        out = z
    else:
        corr, held, core, near = corridor_masks(roads, stream_lines(tile), z.shape, tr)
        if where is not None:
            corr, held, core, near = corr & where, held & where, core & where, near & where
        out, stats = flatten(z, corr, held, core, abs(tr.a), near)
        stats["roads"] = len(roads)
    with rasterio.open(p, "w", **prof) as dst:
        dst.write(out.astype(prof["dtype"]), 1)
    if p.stem == "dem_1m":
        from rasterio.enums import Resampling
        with rasterio.open(p, "r+") as dst:
            dst.build_overviews([2, 4, 8, 16], Resampling.average)
    stats = {"version": VERSION, **stats}
    write_json(meta_p, {"key": key, "out_sha": _sha(p), "stats": stats,
                        "original": orig.name, "rule": "pipeline/unroad.py"})
    return stats


def road_strip(tile: Tile, n: int) -> np.ndarray | None:
    """The roads' corridors (the height rule's: paved half-width x 3 + 4 m; bridges and paths left out) on an n x n
    grid over the tile, from the OSM lines themselves (so a step before the terrain step's footprint/roads.png can
    use it), or None without roads."""
    from rasterio.transform import from_bounds
    roads = road_lines(tile)
    if not roads:
        return None
    x0, y0, x1, y1 = tile.bounds
    corr, _, _, _ = corridor_masks(roads, [], (n, n), from_bounds(x0, y0, x1, y1, n, n))
    return corr


def mirror_grid(a: np.ndarray, strip: np.ndarray) -> np.ndarray:
    """A grid (2-D, or 3-D with channels last) with the `strip` cells mirrored from beyond their nearest edge, as the
    imagery and the canopy are: the ground classes a road's corridor carries (rock from its cut faces in the slope and
    roughness, pale pavement in the photo) give way to its banks'. A cell whose mirror falls on the strip or off the grid
    takes the nearest cell outside instead."""
    from scipy.ndimage import distance_transform_edt
    if strip is None or not strip.any():
        return a
    _, (iy, ix) = distance_transform_edt(strip, return_indices=True)
    ys, xs = np.nonzero(strip)
    ey, ex = iy[ys, xs], ix[ys, xs]
    sy, sx = 2 * ey - ys, 2 * ex - xs
    n0, n1 = strip.shape
    ok = (sy >= 0) & (sy < n0) & (sx >= 0) & (sx < n1)
    sy, sx = np.where(ok, sy, ey), np.where(ok, sx, ex)
    bad = strip[sy, sx]
    sy, sx = np.where(bad, ey, sy), np.where(bad, ex, sx)
    out = a.copy()
    out[ys, xs] = a[sy, sx]
    return out


MIRROR_WIN = 1000         # 1 m px per window of the canopy mirror, and its pad (the widest erased verge is ~25 m)
MIRROR_PAD = 64


def mirror_canopy(tile: Tile, *grids: np.ndarray) -> dict:
    """The lidar canopy over the erased roads, mirrored from beside them, in place on 1 m grids (the CHM and the
    multi-return share): each pixel of a road's erase strip (footprint/roads.png over erase_imagery.ROAD_ERASE, the
    strip the imagery mirrors) takes the pixel as far beyond its nearest edge as it is inside it, so the crown finder
    plants the wood on either side across the old road (US-50 at home read from the air as a treeless band once its
    pavement was gone: the lidar has no crowns on a road). Bridges are not in footprint/roads.png. Returns counts."""
    from PIL import Image
    from scipy.ndimage import distance_transform_edt
    from .erase_imagery import ROAD_ERASE
    rp = tile.path("footprint/roads.png")
    if not rp.exists() or not grids:
        return {"mirrored_m2": 0, "note": "no footprint/roads.png"}
    n = grids[0].shape[0]
    Image.MAX_IMAGE_PIXELS = None
    road = np.asarray(Image.open(rp).convert("L").resize((n, n), Image.BILINEAR)) > ROAD_ERASE
    done = 0
    for r0 in range(0, n, MIRROR_WIN):
        for c0 in range(0, n, MIRROR_WIN):
            r1, c1 = min(n, r0 + MIRROR_WIN), min(n, c0 + MIRROR_WIN)
            if not road[r0:r1, c0:c1].any():
                continue
            R0, R1, C0, C1 = max(0, r0 - MIRROR_PAD), min(n, r1 + MIRROR_PAD), max(0, c0 - MIRROR_PAD), min(n, c1 + MIRROR_PAD)
            sub = road[R0:R1, C0:C1]
            _, (iy, ix) = distance_transform_edt(sub, return_indices=True)
            ys, xs = np.nonzero(sub[r0 - R0:r1 - R0, c0 - C0:c1 - C0])
            ys, xs = ys + (r0 - R0), xs + (c0 - C0)
            sy, sx = 2 * iy[ys, xs] - ys, 2 * ix[ys, xs] - xs
            ok = (sy >= 0) & (sy < sub.shape[0]) & (sx >= 0) & (sx < sub.shape[1])
            sy, sx, ys, xs = sy[ok], sx[ok], ys[ok], xs[ok]
            ok = ~sub[sy, sx]
            sy, sx, ys, xs = sy[ok], sx[ok], ys[ok], xs[ok]
            for g in grids:
                w = g[R0:R1, C0:C1]
                w[ys, xs] = w[sy, sx]
            done += len(ys)
    return {"mirrored_m2": int(done), "road_m2": int(road.sum())}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", required=True)
    ap.add_argument("--rel", default=None, help="terrain/dem_1m.tif (default when present) or terrain/dem.tif")
    a = ap.parse_args(argv)
    tile = Tile.from_id(a.tile)
    rel = a.rel or ("terrain/dem_1m.tif" if tile.path("terrain/dem_1m.tif").exists() else "terrain/dem.tif")
    print(json.dumps(apply(tile, rel), indent=1))


if __name__ == "__main__":
    main()
