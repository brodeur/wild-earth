"""Stream channels routed by gravity on the DEM, named and classed by NHD.

NHD flowlines say roughly where the streams are; the 5 m lidar DEM says where water actually
goes. This step routes every cell of the DEM downhill and extracts the channel network from
drainage area, then borrows names and permanence (perennial / intermittent / ephemeral) from
the NHD reaches each channel runs alongside.

  1. Routing: depressions at least 1 m deep outside mapped waterbodies are breached along the
     least-cost path (<= 300 m) to lower ground, since lidar sees a road embankment over a culvert
     as a dam; then pysheds fills what is left with the tile border as the outlet, resolves flats,
     and gives D8 flow directions; any cell still without a way out is attached to a neighbour that
     has one, and accumulation runs on the result. Flow from outside the tile is seeded where
     NHD flowlines cross into it (their `totdasqkm`), so a creek entering the tile carries its
     upstream area instead of starting from zero at the edge. The fill makes every border cell an
     outlet, so a creek on a flat floor along the edge wanders out of the tile (and its basin with
     it); a border outlet with an NHD stream within 60 m that stays inside, or leaves and comes
     back in at an inflow seed, is pointed back at that stream (the seed then brings only the area
     the linked flow does not already carry). See _link_edge_leaks.
  2. Channels: cells draining >= `threshold_km2` (0.15 km2). Reaches run between channel heads,
     junctions and outlets, walked downstream cell by cell; short headwater stubs (< 40 m) are
     pruned; Strahler order is computed on what remains (a seeded inflow head starts at its NHD
     stream order). Polylines get a light [1 2 1]/4 smoothing, twice, endpoints fixed.
  3. NHD snapping: every 10 m along each reach, the nearest NHD flowline within 60 m that runs
     the same way (|cos| >= 0.5) and drains a compatible area (within 6x) votes for the reach's
     gnis_name and fcode. A reach with half or more of its samples matched takes the winners;
     unmatched reaches are ephemeral (46007), or intermittent (46003) from 2 km2. NHD stretches
     with no DEM channel within 60 m (flat valley floors, reservoirs) are kept as source "nhd"
     when they drain at least the threshold area (shorter NHD headwater tips above the DEM's
     channel heads are not: there the DEM says no channel has formed yet).
  4. Waterbodies: reaches are split at waterbody rings and the pieces inside are flagged
     `in_waterbody` (the fill routes through flattened reservoirs and ponds; the client draws
     the pond, not the channel under it).

Widths come from drainage area: water width = 1.6 * A^0.45 m (clamped 1-30), bed = 1.5 w + 1.

Writes hydro/channels.geojson (WGS84) and client/channel_depth.png (local incision, dm).
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import numpy as np
import rasterio
import shapely
from PIL import Image
from pyproj import Transformer
from shapely.geometry import LineString, shape
from shapely.ops import substring, transform as shp_transform

from .config import TILE_SIZE_M, Tile, write_json

THRESHOLD_KM2 = 0.15        # drainage area at which a channel forms
MIN_REACH_M = 40.0          # headwater stubs shorter than this are pruned
MATCH_RADIUS_M = 60.0       # NHD flowline search radius
SAMPLE_M = 10.0             # sample spacing along reaches for matching
MATCH_FRACTION = 0.5        # share of a reach's samples that must match for it to take NHD attributes
AREA_RATIO = 6.0            # DEM vs NHD drainage area must agree within this factor to match
INTERMITTENT_KM2 = 2.0      # unmatched DEM channels this big are intermittent, smaller ones ephemeral
DEPTH_RING_M = 20.0         # radius of the ring around a channel cell for channel_depth
BREACH_MAX_M = 300.0        # longest breach (box half-size); hydro/human_water.geojson may raise it
SEED_RUN_M = 500.0          # an inflow seed must route at least min(this, half the NHD line's run inside) before leaving
SEED_SNAP_M = 60.0          # ... else it moves to the lowest cell within this of the line's first 100 m (then 300 m) inside
LEAK_EXIT_M = 100.0         # a border outlet is its NHD stream really leaving when the stream leaves the tile within this
LEAK_CHAIN_M = 3000.0       # how far down the NHD stream to look for its way back into the tile
LEAK_SEARCH_M = 500.0       # how far along the stream, inside, to look for the cell an edge leak is handed to
LEAK_PASSES = 40
PERENNIAL, INTERMITTENT, EPHEMERAL = 46006, 46003, 46007
CANAL = 33600
# D8 encoding (pysheds default order N, NE, E, SE, S, SW, W, NW)
DIRMAP = (64, 128, 1, 2, 4, 8, 16, 32)
OFFSETS = {64: (-1, 0), 128: (-1, 1), 1: (0, 1), 2: (1, 1), 4: (1, 0), 8: (1, -1), 16: (0, -1), 32: (-1, -1)}


def water_width(area_km2: float) -> float:
    return float(min(30.0, max(1.0, 1.6 * max(area_km2, 0.0) ** 0.45)))


def bed_width(width: float) -> float:
    return 1.5 * width + 1.0


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

def _route(dem_path, weights: np.ndarray, z: np.ndarray):
    """(filled dem, downstream flat index per cell or -1, accumulation in weight units).

    `z` is the (breached) elevation array on the DEM grid; pysheds fills what is left."""
    from pysheds.grid import Grid
    from pysheds.sview import Raster
    grid = Grid.from_raster(str(dem_path))
    dem0 = grid.read_raster(str(dem_path))
    dem = Raster(z.astype(dem0.dtype), viewfinder=dem0.viewfinder)
    filled = grid.fill_depressions(grid.fill_pits(dem))
    inflated = grid.resolve_flats(filled)
    fdir = np.asarray(grid.flowdir(inflated, dirmap=DIRMAP)).astype(np.int64)
    zf = np.asarray(filled, dtype="float64")
    nr, nc = fdir.shape
    rows, cols = np.indices(fdir.shape)
    down = np.full(fdir.shape, -1, np.int64)
    for code, (dr, dc) in OFFSETS.items():
        m = fdir == code
        r2, c2 = rows[m] + dr, cols[m] + dc
        ok = (r2 >= 0) & (r2 < nr) & (c2 >= 0) & (c2 < nc)
        idx = np.flatnonzero(m)
        down.flat[idx[ok]] = r2[ok] * nc + c2[ok]
    # Cells pysheds left without a direction (unresolved flats, -2; pits, -1) away from the border
    # would swallow their flow. Attach every cell that does not reach a border outlet to an adjacent
    # cell that does (lowest filled height, preferring no rise), until the whole grid drains.
    down = down.ravel()
    border = np.zeros(fdir.shape, bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    border = border.ravel()
    unresolved = int(((down < 0) & ~border).sum())
    zflat = zf.ravel()
    nbr_off = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    for _ in range(200):
        good = _drains_out(down, border)
        bad = np.flatnonzero(~good)
        if bad.size == 0:
            break
        br, bc = bad // nc, bad % nc
        best = np.full(bad.size, -1, np.int64)
        bz = np.full(bad.size, np.inf)
        for dr, dc in nbr_off:
            r2, c2 = br + dr, bc + dc
            ok = (r2 >= 0) & (r2 < nr) & (c2 >= 0) & (c2 < nc)
            j = np.where(ok, r2 * nc + c2, 0)
            cand = ok & good[j]
            zj = np.where(cand, zflat[j], np.inf)
            # no rise first; a rise only if a cell has no other way out (never needed after a fill)
            zj = np.where(zj <= zflat[bad] + 1e-6, zj, zj + 1e6)
            better = zj < bz
            best[better], bz[better] = j[better], zj[better]
        fix = best >= 0
        if not fix.any():
            break
        down[bad[fix]] = best[fix]
        acc = _accumulate(down, weights.ravel().astype("float64"))
    return zf, down, acc.reshape(fdir.shape), unresolved


def breach(z: np.ndarray, keep: np.ndarray, min_depth=1.0, max_dist_m=BREACH_MAX_M, res=5.0, log=None):
    """Least-cost breaching of depressions (Lindsay 2016, bounded): for each depression at least
    `min_depth` deep whose bottom is not in `keep` (mapped ponds and reservoirs, which should
    fill), find the cheapest path from its bottom to any lower cell within `max_dist_m`, cost =
    sum of how far each cell must be lowered, and carve it as a straight downward grade.
    Lidar sees a road embankment over a culvert as a dam; filling would pond the creek behind it
    and send it out over the lowest spill, often far from the channel (or out of the tile).
    `log`, if a list, gets one entry per depression tried: bottom cell, depth, and the carved path
    (length m, deepest cut m) or None when no lower cell lies within reach.
    Returns (breached z, number of breaches, carved cells)."""
    import heapq
    from scipy.ndimage import label
    from skimage.morphology import reconstruction
    nr, nc = z.shape
    # depressions: priority-flood fill with the border as outlet (morphological reconstruction)
    seed = z.copy()
    seed[1:-1, 1:-1] = z.max()
    filled = reconstruction(seed, z, method="erosion")
    depth = filled - z
    lab, nlab = label(depth > 1e-3, structure=np.ones((3, 3)))
    if not nlab:
        return z, 0, 0
    flat = lab.ravel()
    order = np.argsort(flat, kind="stable")
    bounds = np.searchsorted(flat[order], np.arange(1, nlab + 2))
    zb = z.copy()
    rmax = int(max_dist_m / res)
    nbrs = [(-1, 0, 1.0), (-1, 1, 1.414), (0, 1, 1.0), (1, 1, 1.414), (1, 0, 1.0), (1, -1, 1.414), (0, -1, 1.0), (-1, -1, 1.414)]
    n_breach = carved = 0
    for k in range(1, nlab + 1):
        cells = order[bounds[k - 1]:bounds[k]]
        if cells.size == 0 or depth.flat[cells].max() < min_depth:
            continue
        b = cells[np.argmin(z.flat[cells])]
        if keep.flat[b]:
            continue
        br, bc = divmod(int(b), nc)
        zp = zb.flat[b]
        # Dijkstra on lowering cost
        dist = {int(b): 0.0}
        prev = {}
        heap = [(0.0, int(b))]
        target = -1
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist.get(i, np.inf):
                continue
            r, c = divmod(i, nc)
            if i != b and zb[r, c] < zp:
                target = i
                break
            for dr, dc, _ in nbrs:
                r2, c2 = r + dr, c + dc
                if not (0 <= r2 < nr and 0 <= c2 < nc) or abs(r2 - br) > rmax or abs(c2 - bc) > rmax:
                    continue
                j = r2 * nc + c2
                nd = d + max(0.0, zb[r2, c2] - zp) + 1e-3
                if nd < dist.get(j, np.inf):
                    dist[j] = nd
                    prev[j] = i
                    heapq.heappush(heap, (nd, j))
        if target < 0:
            if log is not None:
                log.append({"bottom": int(b), "depth_m": float(depth.flat[cells].max()), "path": None})
            continue
        path = [target]
        while path[-1] != b:
            path.append(prev[path[-1]])
        path.reverse()                      # bottom ... target
        zt = zb.flat[target]
        m = len(path) - 1
        cut = 0.0
        for s_, i in enumerate(path[1:-1], 1):
            znew = min(zb.flat[i], zp + (zt - zp) * s_ / m)
            cut = max(cut, zb.flat[i] - znew)
            zb.flat[i] = znew
        if log is not None:
            pa = np.asarray(path)
            plen = float(np.hypot(np.diff(pa // nc), np.diff(pa % nc)).sum() * res)
            log.append({"bottom": int(b), "depth_m": float(depth.flat[cells].max()), "path": path,
                        "length_m": plen, "max_cut_m": float(cut)})
        n_breach += 1
        carved += m - 1
    return zb, n_breach, carved


def _drains_out(down: np.ndarray, border: np.ndarray) -> np.ndarray:
    """True where following `down` ends at a border cell with no downstream (a tile outlet).
    Pointer jumping: 23 doublings cover any path on a 4 M cell grid; cycles never resolve."""
    n = down.size
    t = np.where(down >= 0, down, np.arange(n))
    for _ in range(int(np.ceil(np.log2(n))) + 1):
        t = t[t]
    return border[t] & (down[t] < 0)


def _accumulate(down: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Flow accumulation by topological order (Kahn), vectorised per wave."""
    n = down.size
    indeg = np.bincount(down[down >= 0], minlength=n)
    acc = w.copy()
    front = np.flatnonzero(indeg == 0)
    while front.size:
        d = down[front]
        ok = d >= 0
        f, d = front[ok], d[ok]
        np.add.at(acc, d, acc[f])
        np.subtract.at(indeg, d, 1)
        cand = np.unique(d)
        front = cand[indeg[cand] == 0]
    return acc


def _inflow_seeds(tile: Tile, flowlines: list, res: float, n: int, inset=15.0):
    """Cells where NHD flowlines cross into the tile, with the area they bring (km2) and their order.

    NHD flowlines are digitised downstream, so an outside -> inside step is an inflow. The seed
    goes `inset` metres inside the edge, along the line."""
    seeds = []
    inner = shapely.box(inset, inset, TILE_SIZE_M - inset, TILE_SIZE_M - inset)
    tile_box = shapely.box(0, 0, TILE_SIZE_M, TILE_SIZE_M)
    key = lambda xy: (round(float(xy[0]), 1), round(float(xy[1]), 1))  # noqa: E731
    starts = {}   # NHD segments chain end -> start, downstream
    for ft in flowlines:
        starts.setdefault(key(ft["line"].coords[0]), ft["line"])
    for ft in flowlines:
        pr, line = ft["props"], ft["line"]
        area = pr.get("totdasqkm") or 0
        if pr.get("fcode") == CANAL or area <= 0:
            continue
        c = np.asarray(line.coords)
        inside = (c[:, 0] >= 0) & (c[:, 0] <= TILE_SIZE_M) & (c[:, 1] >= 0) & (c[:, 1] <= TILE_SIZE_M)
        for k in np.flatnonzero(~inside[:-1] & inside[1:]):
            # walk along the line from the last outside vertex until `inset` inside the edge
            rest = LineString(c[k:])
            p = None
            for d in np.arange(0.0, rest.length, 2.5):
                q = rest.interpolate(d)
                if inner.contains(q):
                    p = q
                    break
            if p is None:
                continue
            col = int(min(n - 1, max(0, p.x // res)))
            row = int(min(n - 1, max(0, (TILE_SIZE_M - p.y) // res)))
            # the river's run inside the tile from the seed until it next leaves (for _snap_seeds),
            # following the NHD segments downstream for up to 2 x SEED_RUN_M
            xy = list(substring(rest, rest.project(p), rest.length).coords)
            seen, total = {id(line)}, rest.length
            while total < 2 * SEED_RUN_M:
                nxt = starts.get(key(xy[-1]))
                if nxt is None or id(nxt) in seen:
                    break
                seen.add(id(nxt))
                xy.extend(list(nxt.coords)[1:])
                total += nxt.length
            follow = (LineString(xy) if len(xy) > 1 else rest).intersection(tile_box)
            parts = [g for g in getattr(follow, "geoms", [follow]) if g.geom_type == "LineString" and not g.is_empty]
            run = min(parts, key=lambda g: g.distance(p)) if parts else None
            seeds.append({"row": row, "col": col, "x": float(p.x), "y": float(p.y), "area_km2": float(area),
                          "order": pr.get("streamorde") or 1, "name": pr.get("gnis_name"), "run": run, "run_m": run.length if run is not None else 0.0})
    return seeds


def _snap_seeds(seeds: list, down: np.ndarray, zf: np.ndarray, res: float) -> list:
    """Move inflow seeds that drain straight back out of the tile onto the valley floor they feed.

    A seed sits `inset` metres inside the edge on the NHD line. Where the line is offset from the
    lidar's channel and a river runs along the edge, that cell can drain back out within a few
    cells, and the whole upstream basin leaves with it (a 500 km2 river becomes a 10 km2 creek).
    A seed must route at least min(SEED_RUN_M, half the line's run inside the tile) before it
    reaches the border; one that does not moves to the lowest filled cell within SEED_SNAP_M of
    the line's first 100 m inside (then 300 m) that does. Seeds that pass are left where they are.
    Returns what moved."""
    nr, nc = zf.shape
    zflat = zf.ravel()

    def run_cells(i, need):
        return _run_cells(down, nr, nc, i, need)

    moved = []
    for s in seeds:
        need = int(min(SEED_RUN_M, 0.5 * s.get("run_m", 0.0)) / res)
        i0 = s["row"] * nc + s["col"]
        if need < 2 or s.get("run") is None or run_cells(i0, need) >= need:
            continue
        best = None
        for window in (100.0, 300.0):
            seg = substring(s["run"], 0.0, min(window, s["run"].length))
            x0, y0, x1, y1 = seg.buffer(SEED_SNAP_M).bounds
            c0, c1 = max(1, int(x0 // res)), min(nc - 2, int(x1 // res))
            r0, r1 = max(1, int((TILE_SIZE_M - y1) // res)), min(nr - 2, int((TILE_SIZE_M - y0) // res))
            if c1 < c0 or r1 < r0:
                continue
            rr, cc = np.mgrid[r0:r1 + 1, c0:c1 + 1]
            pts = shapely.points((cc.ravel() + 0.5) * res, TILE_SIZE_M - (rr.ravel() + 0.5) * res)
            near = shapely.distance(pts, seg) <= SEED_SNAP_M
            cand = (rr.ravel() * nc + cc.ravel())[near]
            for i in cand[np.argsort(zflat[cand], kind="stable")]:
                if run_cells(i, need) >= need:
                    best = int(i)
                    break
            if best is not None:
                break
        if best is None:
            continue
        r, c = divmod(best, nc)
        moved.append({"name": s["name"], "area_km2": round(s["area_km2"], 1), "from": [s["row"], s["col"]], "to": [r, c],
                      "moved_m": round(float(np.hypot(r - s["row"], c - s["col"]) * res), 1)})
        s["row"], s["col"] = r, c
    return moved


def _run_cells(down: np.ndarray, nr: int, nc: int, i: int, need: int) -> int:
    """Cells routed from `i` (up to `need`) before reaching the tile border."""
    k = 0
    while i >= 0 and k < need:
        r, c = divmod(int(i), nc)
        if r in (0, nr - 1) or c in (0, nc - 1):
            break
        i, k = down[i], k + 1
    return k


def _terminal(down: np.ndarray) -> np.ndarray:
    """The cell each cell's flow ends at (pointer jumping, as _drains_out)."""
    t = np.where(down >= 0, down, np.arange(down.size))
    for _ in range(int(np.ceil(np.log2(down.size))) + 1):
        t = t[t]
    return t


def _link_edge_leaks(nhd: list, seeds: list, down: np.ndarray, zf: np.ndarray, res: float, cell_km2: float,
                     threshold_km2: float) -> tuple[list, np.ndarray]:
    """Hand the flow the tile border swallowed back to the stream it belongs to.

    The fill makes every border cell an outlet. A creek that runs along the edge of the tile on a
    flat floor (Yosemite Creek above the falls, within 40 m of the west edge for 3 km) wanders
    onto a border cell and leaves, its whole basin with it, and below it the same creek starts
    again from nothing. Each border outlet draining >= the threshold with an NHD flowline within
    SEED_SNAP_M is judged against that stream, followed downstream from the outlet:
      - the stream stays inside the tile for LEAK_EXIT_M or more: the exit is the edge's doing.
        The outlet is pointed at the lowest cell within SEED_SNAP_M of the stream, at the first
        station 10 m to LEAK_SEARCH_M further down that routes min(SEED_RUN_M, half the stream's
        run left inside) before reaching the border (else the one that routes furthest).
      - it leaves the tile and comes back within LEAK_CHAIN_M at an inflow seed: the outlet is
        pointed at that seed, and the seed brings only the NHD area the outlets pointed at it do
        not already carry (the tributaries that joined outside).
      - it leaves and does not come back: a true outlet, left alone.
    A link never makes a cycle (its target must not drain to the outlet). Passes repeat until no
    new outlet appears and the seeds' carried areas settle. Mutates `down` and each seed's
    "carried" (km2); returns (links, cell weights for the accumulation)."""
    nr, nc = zf.shape
    n = nr * nc
    zflat = zf.ravel()

    def weights():
        w = np.ones(n)
        for s in seeds:
            w[s["row"] * nc + s["col"]] += max(0.0, s["area_km2"] - s.get("carried", 0.0)) / cell_km2
        return w

    lines = [f for f in nhd if f["props"].get("fcode") != CANAL]
    if not lines:
        return [], weights()
    geoms = [f["line"] for f in lines]
    tree = shapely.STRtree(geoms)
    key = lambda xy: (round(float(xy[0]), 1), round(float(xy[1]), 1))  # noqa: E731
    starts = {}
    for k, g in enumerate(geoms):
        starts.setdefault(key(g.coords[0]), k)

    def downstream(k, d0):
        g = geoms[k]
        xy = list(substring(g, d0, g.length).coords) if d0 < g.length - 0.01 else [g.coords[-1]]
        seen, total = {k}, g.length - d0
        while total < LEAK_CHAIN_M:
            nk = starts.get(key(xy[-1]))
            if nk is None or nk in seen:
                break
            seen.add(nk)
            xy.extend(list(geoms[nk].coords)[1:])
            total += geoms[nk].length
        return LineString(xy) if len(xy) > 1 else None

    border = np.zeros((nr, nc), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    border = border.ravel()
    seed_xy = np.array([[s.get("x", np.nan), s.get("y", np.nan)] for s in seeds]).reshape(-1, 2)
    links, tried = [], set()
    term = _terminal(down)
    for _ in range(LEAK_PASSES):
        acc = _accumulate(down, weights()) * cell_km2
        carried = defaultdict(float)
        for lk in links:
            if lk["seed"] is not None:
                carried[lk["seed"]] += float(acc[lk["from"]])
        settled = True
        for k, s in enumerate(seeds):
            if abs(carried[k] - s.get("carried", 0.0)) > 1e-3:
                settled = False
            s["carried"] = carried[k]
        new = [int(e) for e in np.flatnonzero(border & (down < 0) & (acc >= threshold_km2)) if int(e) not in tried]
        if not new and settled:
            break
        for e in new:
            tried.add(e)
            r, c = divmod(e, nc)
            p = shapely.Point((c + 0.5) * res, TILE_SIZE_M - (r + 0.5) * res)
            hit = tree.query_nearest(p, max_distance=SEED_SNAP_M)
            if len(hit) == 0:
                continue
            k = int(hit[0])
            R = downstream(k, geoms[k].project(p))
            if R is None:
                continue
            ds = np.arange(0.0, R.length, 5.0)
            q = shapely.line_interpolate_point(R, ds)
            qx, qy = shapely.get_x(q), shapely.get_y(q)
            inside = (qx >= 0) & (qx <= TILE_SIZE_M) & (qy >= 0) & (qy <= TILE_SIZE_M)
            deep = (qx >= 15) & (qx <= TILE_SIZE_M - 15) & (qy >= 15) & (qy <= TILE_SIZE_M - 15)
            out = np.flatnonzero(~inside)
            start, link = 10.0, None
            if out.size and ds[out[0]] <= LEAK_EXIT_M:
                back = np.flatnonzero(deep & (np.arange(ds.size) > out[0]))
                if back.size == 0:
                    continue                              # the stream leaves: a true outlet
                start = float(ds[back[0]])
                # the inflow seed where the stream comes back in
                if len(seeds):
                    dd = np.hypot(seed_xy[:, 0] - qx[back[0]], seed_xy[:, 1] - qy[back[0]])
                    j = int(np.nanargmin(dd)) if np.isfinite(dd).any() else -1
                    if j >= 0 and dd[j] <= 40.0:
                        t = seeds[j]["row"] * nc + seeds[j]["col"]
                        if term[t] != e:
                            link = {"from": e, "to": int(t), "kind": "reentry", "seed": j}
            if link is None:
                # stations along the stream while it stays inside, from `start`
                later = np.flatnonzero(~inside & (ds > start))
                end = float(ds[later[0]]) if later.size else float(R.length)
                best, best_run = None, 1
                for d in np.arange(start, min(start + LEAK_SEARCH_M, end), 10.0):
                    sx, sy = float(qx[int(d // 5.0)]), float(qy[int(d // 5.0)])
                    c0, c1 = max(1, int((sx - SEED_SNAP_M) // res)), min(nc - 2, int((sx + SEED_SNAP_M) // res))
                    r0 = max(1, int((TILE_SIZE_M - sy - SEED_SNAP_M) // res))
                    r1 = min(nr - 2, int((TILE_SIZE_M - sy + SEED_SNAP_M) // res))
                    if c1 < c0 or r1 < r0:
                        continue
                    rr, cc = np.mgrid[r0:r1 + 1, c0:c1 + 1]
                    rr, cc = rr.ravel(), cc.ravel()
                    near = np.hypot((cc + 0.5) * res - sx, TILE_SIZE_M - (rr + 0.5) * res - sy) <= SEED_SNAP_M
                    cand = (rr * nc + cc)[near]
                    cand = cand[term[cand] != e]
                    need = int(max(2, min(SEED_RUN_M, 0.5 * (end - d)) / res))
                    hit_i = None
                    for i in cand[np.argsort(zflat[cand], kind="stable")]:
                        run = _run_cells(down, nr, nc, i, need)
                        if run >= need:
                            hit_i = int(i)
                            break
                        if run > best_run:
                            best, best_run = int(i), run
                    if hit_i is not None:
                        best = hit_i
                        break
                if best is None:
                    continue
                link = {"from": e, "to": best, "kind": "stay", "seed": None}
            down[e] = link["to"]
            term[term == e] = term[link["to"]]
            link["name"] = lines[k]["props"].get("gnis_name")
            tr_, tc_ = divmod(link["to"], nc)
            link["jump_m"] = round(float(np.hypot(tr_ - r, tc_ - c) * res), 1)
            links.append(link)
    return links, weights()


# ---------------------------------------------------------------------------
# Network extraction
# ---------------------------------------------------------------------------

def _walk(ch: np.ndarray, down: np.ndarray, breaks=frozenset()):
    """Reaches as lists of flat cell indices: from each head or junction, downstream to the next
    junction (included) or the network outlet. A reach also ends at a cell in `breaks` (an edge
    leak handed to the seed where its stream comes back in) and a new one starts below it.
    Returns (reaches, n_in per channel cell)."""
    idx = np.flatnonzero(ch)
    d = down[idx]
    nin = np.zeros(ch.size, np.int32)
    ok = (d >= 0)
    ok[ok] = ch[d[ok]]
    np.add.at(nin, d[ok], 1)
    starts = idx[(nin[idx] == 0) | (nin[idx] >= 2)]
    below = [int(down[b]) for b in breaks if ch.flat[b] and down[b] >= 0 and ch.flat[down[b]] and nin[down[b]] < 2]
    if below:
        starts = np.concatenate([starts, np.asarray(below, starts.dtype)])
    reaches = []
    for s in starts:
        path = [int(s)]
        c = down[s]
        while c >= 0 and ch[c] and path[-1] not in breaks:
            path.append(int(c))
            if nin[c] >= 2:
                break
            c = down[c]
        reaches.append(path)
    return reaches, nin


def _cell_len(path, nc, res):
    if len(path) < 2:
        return 0.0
    p = np.asarray(path)
    r, c = p // nc, p % nc
    return float(np.hypot(np.diff(r), np.diff(c)).sum() * res)


def extract_network(acc_km2: np.ndarray, down: np.ndarray, threshold_km2: float, res: float,
                    min_reach_m: float = MIN_REACH_M, protect=(), breaks=frozenset()):
    """Channel mask and reaches after pruning headwater stubs shorter than min_reach_m.

    Only true channel heads are pruned (head drainage under twice the threshold): a seeded
    inflow head carries a whole upstream basin and may sit a few cells above its first junction.
    `protect` lists cells (the seeds) that are never pruned."""
    nr, nc = acc_km2.shape
    af = acc_km2.ravel()
    ch = (af >= threshold_km2).copy()
    protect = set(int(i) for i in protect)
    pruned = 0
    for _ in range(4):
        reaches, nin = _walk(ch, down, breaks)
        drop = []
        for p in reaches:
            head = nin[p[0]] == 0
            if not head or _cell_len(p, nc, res) >= min_reach_m or af[p[0]] >= 2 * threshold_km2 \
                    or protect.intersection(p):
                continue
            ends_at_junction = len(p) > 1 and nin[p[-1]] >= 2
            drop.extend(p[:-1] if ends_at_junction else p)   # keep the junction cell: it belongs downstream
            pruned += 1
        if not drop:
            break
        ch[np.asarray(drop)] = False
    reaches, nin = _walk(ch, down, breaks)
    return ch.reshape(nr, nc), reaches, nin, pruned


def strahler(reaches, nin, acc_flat, seed_order: dict, joins=None):
    """Strahler order per reach. Heads start at 1; a reach holding an inflow seed is at least its NHD order."""
    by_end = defaultdict(list)
    for k, p in enumerate(reaches):
        if len(p) > 1:
            by_end[p[-1]].append(k)
    order = [0] * len(reaches)
    for k in sorted(range(len(reaches)), key=lambda k: acc_flat[reaches[k][0]]):
        s = reaches[k][0]
        ups = [order[u] for e in [s] + list((joins or {}).get(s, ())) for u in by_end.get(e, []) if u != k]
        if not ups:
            o = 1
        else:
            top = max(ups)
            o = top + 1 if ups.count(top) >= 2 else top
        # a seed raises the reach it lies on, head or not (an edge leak handed to a seed flows in above it)
        order[k] = max(o, max(seed_order.get(c, 0) for c in (reaches[k][:-1] or reaches[k])))
    return order


def _smooth(xy: np.ndarray, passes=2) -> np.ndarray:
    p = xy.astype("float64").copy()
    for _ in range(passes):
        if len(p) < 3:
            break
        p[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
    return p


# ---------------------------------------------------------------------------
# NHD matching
# ---------------------------------------------------------------------------

def _samples(line: LineString, step=SAMPLE_M):
    L = line.length
    ds = np.arange(step / 2, L, step) if L > step else np.array([L / 2])
    pts = [line.interpolate(d) for d in ds]
    tang = []
    for d in ds:
        a, b = line.interpolate(max(0, d - 5)), line.interpolate(min(L, d + 5))
        t = np.array([b.x - a.x, b.y - a.y])
        tang.append(t / (np.linalg.norm(t) or 1))
    return ds, pts, np.asarray(tang)


def _tangent_at(line: LineString, d: float):
    L = line.length
    a, b = line.interpolate(max(0, d - 5)), line.interpolate(min(L, d + 5))
    t = np.array([b.x - a.x, b.y - a.y])
    return t / (np.linalg.norm(t) or 1)


def _best_match(pt, tang, area, lines, tree, props_area):
    """Index of the nearest compatible line within MATCH_RADIUS_M of pt, and its distance."""
    best, bd = -1, np.inf
    for j in tree.query(pt.buffer(MATCH_RADIUS_M)):
        dj = lines[j].distance(pt)
        if dj > MATCH_RADIUS_M or dj >= bd:
            continue
        a2 = props_area[j]
        if a2 and area and not (1 / AREA_RATIO <= area / a2 <= AREA_RATIO):
            continue
        t2 = _tangent_at(lines[j], lines[j].project(pt))
        if abs(float(np.dot(tang, t2))) < 0.5:
            continue
        best, bd = j, dj
    return best, bd


# ---------------------------------------------------------------------------
# Main step
# ---------------------------------------------------------------------------

def rewild_inputs(tile: Tile):
    """The hydrology rewilding (pipeline/rewild_hydro.py), when it has run: the NHD waterbody ids
    taken out (no longer held as ponds, so their dams are breached and the channel through them is
    an ordinary reach), the derived DEM with the thalweg carved through their beds, and the breach
    limit. None on a present-day tile."""
    p = tile.dir / "hydro/human_water.geojson"
    if not p.exists():
        return None
    fc = json.load(open(p))
    ids = {f["properties"].get("nhd_id") for f in fc.get("features", [])
           if f["properties"].get("rewilded") and f["properties"].get("nhd_id")}
    dem = tile.dir / "terrain/dem_rewilded.tif"
    return {"ids": ids, "dem": dem if dem.exists() else None,
            "breach_max_m": float(fc.get("breach_max_m") or BREACH_MAX_M)}


def build_channels(tile: Tile, threshold_km2: float = THRESHOLD_KM2) -> dict:
    dem_path = tile.path("terrain/dem.tif")
    rw = rewild_inputs(tile)
    # routing runs on the rewilded copy of the DEM when there is one (terrain/dem.tif is never edited)
    with rasterio.open(rw["dem"] if rw and rw["dem"] else dem_path) as src:
        z = src.read(1).astype("float64")
        res = src.res[0]
        nodata = src.nodata
    if nodata is not None and (z == nodata).any():
        z[z == nodata] = z[z != nodata].mean()
    breach_max = rw["breach_max_m"] if rw else BREACH_MAX_M
    nr, nc = z.shape
    cell_km2 = res * res / 1e6
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    to_wgs = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True).transform
    x0, y0 = tile.bounds[0], tile.bounds[1]

    def _loc(x, y, z=None):
        xs, ys = to_tile(x, y)
        return np.asarray(xs) - x0, np.asarray(ys) - y0

    def local(g):
        return shp_transform(_loc, g)

    # NHD flowlines and waterbodies in tile-local metres (x east, north from the south edge)
    def load(rel):
        p = tile.dir / rel
        return json.load(open(p))["features"] if p.exists() else []
    nhd = []
    for ft in load("hydro/flowlines.geojson"):
        g = ft.get("geometry")
        if not g:
            continue
        g = local(shape(g))
        for part in (g.geoms if g.geom_type == "MultiLineString" else [g]):
            if part.length > 0:
                nhd.append({"line": part, "props": ft.get("properties") or {}})
    ponds, rewilded = [], []
    for ft in load("hydro/waterbodies.geojson"):
        g = ft.get("geometry")
        if g:
            g = local(shape(g))
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty:
                continue
            if rw and (ft.get("properties") or {}).get("permanent_identifier") in rw["ids"]:
                rewilded.append((ft["properties"]["permanent_identifier"], g))
            else:
                ponds.append(g)
    pond_union = shapely.union_all(ponds) if ponds else None

    # 1. Routing: breach embankments, fill the rest, D8, with upstream area seeded at inflow points
    from rasterio.features import rasterize
    tr = rasterio.transform.from_origin(0, TILE_SIZE_M, res, res)   # tile-local metres
    keep = (rasterize([(g, 1) for g in ponds], out_shape=z.shape, transform=tr, fill=0, dtype="uint8").astype(bool)
            if ponds else np.zeros(z.shape, bool))
    blog = []
    zb, n_breach, carved = breach(z, keep, res=res, max_dist_m=breach_max, log=blog)
    seeds = _inflow_seeds(tile, nhd, res, nr)
    weights = np.ones((nr, nc))
    for s in seeds:
        weights[s["row"], s["col"]] += s["area_km2"] / cell_km2
    zf, down, acc, unresolved = _route(dem_path, weights, zb)
    seeds_moved = _snap_seeds(seeds, down, zf, res)
    if seeds_moved:   # flow directions do not depend on the weights; only the accumulation is redone
        weights = np.ones((nr, nc))
        for s in seeds:
            weights[s["row"], s["col"]] += s["area_km2"] / cell_km2
        acc = _accumulate(down, weights.ravel()).reshape(nr, nc)
    # flow the border swallowed where its NHD stream stays inside (or comes back in) is handed on
    edge_links, weights = _link_edge_leaks(nhd, seeds, down, zf, res, cell_km2, threshold_km2)
    if edge_links:
        acc = _accumulate(down, weights).reshape(nr, nc)
    # rewilded waterbodies: did the breach cut their outlet, and is any water still held in the bed?
    rewild_check = {}
    if rewilded and rw["dem"]:
        with rasterio.open(dem_path) as src:
            carved_all = (src.read(1).astype("float64") - z) > 1e-4   # the thalwegs carved into the copy
    else:
        carved_all = np.zeros(z.shape, bool)
    for pid, g in rewilded:
        m = rasterize([(g, 1)], out_shape=z.shape, transform=tr, fill=0, dtype="uint8").astype(bool)
        if not m.any():
            continue
        cuts = [e for e in blog if m.flat[e["bottom"]]]
        ok = [e for e in cuts if e["path"] is not None]
        held = zf - zb
        th = carved_all & m
        rewild_check[pid] = {"breaches": len(ok), "unbreached": len(cuts) - len(ok),
                             "breach_length_m": round(max((e["length_m"] for e in ok), default=0.0), 1),
                             "breach_max_cut_m": round(max((e["max_cut_m"] for e in ok), default=0.0), 2),
                             # water still held after routing: on the carved thalweg (a dam the breach did not
                             # cut), and the share of the old bed under more than 0.3 m (hollows left in the flat)
                             "held_on_thalweg_m": round(float(held[th].max()), 2) if th.any() else None,
                             "thalweg_held_fraction": round(float((held[th] > 0.3).mean()), 3) if th.any() else None,
                             "bed_held_fraction": round(float((held[m] > 0.3).mean()), 3),
                             "bed_held_max_m": round(float(held[m].max()), 2), "cells": int(m.sum())}
    acc_km2 = acc * cell_km2
    acc_flat = acc_km2.ravel()

    # 2. Channel network
    seed_cells = [s["row"] * nc + s["col"] for s in seeds]
    # an edge leak handed to the seed where its stream comes back in ran outside the tile in between:
    # the reach ends at the border cell (the hand-over carries the flow; nothing is drawn along the border)
    hidden = frozenset(lk["from"] for lk in edge_links if lk["kind"] == "reentry")
    joins = defaultdict(list)
    for lk in edge_links:
        if lk["kind"] == "reentry":
            joins[lk["to"]].append(lk["from"])
    ch, reaches, nin, pruned = extract_network(acc_km2, down, threshold_km2, res, protect=seed_cells, breaks=hidden)
    # continuity: every reach should end at a junction or at the tile border
    def _edge(i):
        r, c = divmod(int(i), nc)
        return r in (0, nr - 1) or c in (0, nc - 1) or down[i] < 0 or not (0 < down[i] // nc < nr - 1 and 0 < down[i] % nc < nc - 1)
    interior_outlets = sum(1 for p in reaches if nin[p[-1]] < 2 and not _edge(p[-1]))
    seed_order = {}
    for s in seeds:
        i = s["row"] * nc + s["col"]
        seed_order[i] = max(seed_order.get(i, 0), int(s["order"]))
    # a seed lands on a cell whose downstream path is the channel; its head is that path's first channel cell
    for i in list(seed_order):
        c = i
        while c >= 0 and not ch.flat[c]:
            c = down[c]
        if c >= 0 and c != i:
            seed_order[c] = max(seed_order.get(c, 0), seed_order.pop(i))
    orders = strahler(reaches, nin, acc_flat, seed_order, joins)

    dem_reaches = []
    for k, p in enumerate(reaches):
        if len(p) < 2:
            continue
        pa = np.asarray(p)
        r, c = pa // nc, pa % nc
        xy = np.column_stack([(c + 0.5) * res, TILE_SIZE_M - (r + 0.5) * res])
        line = LineString(_smooth(xy)).simplify(0.5)
        cum = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(r), np.diff(c)) * res)])
        a = acc_flat[pa].copy()
        if nin[p[-1]] >= 2:
            a[-1] = a[-2]       # the junction cell carries the confluence; this reach's own flow ends above it
        dem_reaches.append({"line": line, "cells": pa, "order": orders[k], "cum": cum, "acc": a,
                            "area_km2": float(a[-1]), "area_up_km2": float(a[0]),
                            "head": bool(nin[p[0]] == 0)})

    # 3. NHD matching (DEM -> NHD): names, permanence, lateral offset
    # An NHD artificial path (55800) through a rewilded reservoir says nothing about the creek that
    # ran there before the dam: it is left out of the votes (the restored reach takes its permanence
    # from the reaches above and below it like any unmatched DEM reach would).
    rw_union = shapely.union_all([g for _, g in rewilded]) if rewilded else None
    def _through_rewilded(f):
        return (rw_union is not None and f["props"].get("fcode") == 55800
                and f["line"].interpolate(0.5, normalized=True).within(rw_union))
    nhd_in = [f for f in nhd if f["props"].get("fcode") != CANAL and not _through_rewilded(f)]
    nhd_lines = [f["line"] for f in nhd_in]
    nhd_area = [f["props"].get("totdasqkm") for f in nhd_in]
    tree = shapely.STRtree(nhd_lines) if nhd_lines else None
    offsets, reach_offsets = [], []
    for rc in dem_reaches:
        ds, pts, tang = _samples(rc["line"])
        # drainage area at each sample, interpolated along the reach
        a_s = np.interp(ds / max(rc["line"].length, 1e-9) * rc["cum"][-1], rc["cum"], rc["acc"])
        votes_name, votes_fcode, dists, hits = Counter(), Counter(), [], []
        for pt, t, a in zip(pts, tang, a_s):
            j, d = _best_match(pt, t, a, nhd_lines, tree, nhd_area) if tree is not None else (-1, np.inf)
            if j < 0:
                continue
            pr = nhd_in[j]["props"]
            votes_name[pr.get("gnis_name")] += 1
            votes_fcode[_permanence(pr.get("fcode"))] += 1
            dists.append(d)
            hits.append(j)
        matched = len(dists) >= MATCH_FRACTION * len(pts)
        rc["matched"] = matched
        if matched:
            rc["name"] = votes_name.most_common(1)[0][0]
            # perennial beats intermittent beats ephemeral on a tie
            rc["fcode"] = max(votes_fcode.items(), key=lambda kv: (kv[1], _rank(kv[0])))[0]
            rc["nhd_offset_m"] = round(float(np.median(dists)), 1)
            offsets.extend(dists)
            reach_offsets.append(float(np.median(dists)))
        else:
            rc["name"] = None
            rc["fcode"] = INTERMITTENT if rc["area_km2"] >= INTERMITTENT_KM2 else EPHEMERAL

    # NHD -> DEM coverage: keep NHD stretches with no DEM channel nearby
    dem_lines = [rc["line"] for rc in dem_reaches]
    dem_area = [None] * len(dem_reaches)   # coverage is by position and direction only
    from scipy.ndimage import maximum_filter
    near_km2 = maximum_filter(acc_km2, size=11, mode="nearest")   # max drainage within ~25 m
    dtree = shapely.STRtree(dem_lines) if dem_lines else None
    box = shapely.box(0, 0, TILE_SIZE_M, TILE_SIZE_M)
    kept, nhd_len, nhd_cov_len = [], 0.0, 0.0
    nhd_stats = Counter()
    tips_dropped, tips_len = 0, 0.0
    for f in nhd:
        if _through_rewilded(f):
            continue
        pr = f["props"]
        g = f["line"].intersection(box)
        parts = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "LineString" and p.length > 0]
        for line in parts:
            nhd_len += line.length
            ds, pts, tang = _samples(line)
            cov = np.zeros(len(pts), bool)
            for i, (pt, t) in enumerate(zip(pts, tang)):
                if dtree is not None and pr.get("fcode") != CANAL:
                    j, _ = _best_match(pt, t, pr.get("totdasqkm"), dem_lines, dtree, dem_area)
                    cov[i] = j >= 0
            nhd_cov_len += cov.mean() * line.length
            frac = cov.mean()
            nhd_stats["covered" if frac >= MATCH_FRACTION else "partial" if frac > 0 else "uncovered"] += 1
            # runs of uncovered samples become source "nhd" reaches
            run = []
            for i in range(len(pts) + 1):
                if i < len(pts) and not cov[i]:
                    run.append(i)
                    continue
                if run:
                    a = max(0.0, ds[run[0]] - SAMPLE_M / 2)
                    b = min(line.length, ds[run[-1]] + SAMPLE_M / 2)
                    if b - a >= MIN_REACH_M:
                        area = pr.get("totdasqkm") or 0
                        # the DEM's own drainage along the stretch: below the threshold, gravity says no
                        # channel has formed here yet (an NHD headwater tip drawn above the channel head)
                        rr = [_cell(pts[i], res, nr) for i in run]
                        dem_here = float(np.median([near_km2[q] for q in rr]))
                        if dem_here < threshold_km2 and pr.get("fcode") != CANAL:
                            tips_dropped += 1
                            tips_len += b - a
                        else:
                            kept.append({"line": substring(line, a, b), "name": pr.get("gnis_name"),
                                         "fcode": pr.get("fcode"), "order": pr.get("streamorde") or 1,
                                         "area_km2": float(area), "source": "nhd"})
                    run = []

    # 4. Split at waterbodies and assemble features
    feats = []
    def emit(line, props):
        pieces = [(line, False)]
        if pond_union is not None and line.intersects(pond_union):
            inside = line.intersection(pond_union)
            outside = line.difference(pond_union)
            pieces = [(g, True) for g in _parts(inside)] + [(g, False) for g in _parts(outside)]
        for g, inw in pieces:
            if g.length < 1.0:
                continue
            w = water_width(props["area_km2"])
            coords = [to_wgs(x + x0, y + y0) for x, y in g.coords]
            feats.append({"type": "Feature",
                          "geometry": {"type": "LineString", "coordinates": [[round(a, 7), round(b, 7)] for a, b in coords]},
                          "properties": {**props, "width": round(w, 2), "bed_width": round(bed_width(w), 2),
                                         "in_waterbody": inw, "length_m": round(g.length, 1)}})
    for rc in dem_reaches:
        props = {"name": rc["name"], "fcode": rc["fcode"], "order": rc["order"], "area_km2": round(rc["area_km2"], 4),
                 "source": "dem", "nhd_matched": rc["matched"]}
        if rc["matched"]:
            props["nhd_offset_m"] = rc["nhd_offset_m"]
        emit(rc["line"], props)
    for k in kept:
        emit(k["line"], {"name": k["name"], "fcode": k["fcode"], "order": k["order"],
                         "area_km2": round(k["area_km2"], 4), "source": "nhd", "nhd_matched": True})

    write_json(tile.path("hydro/channels.geojson"), {"type": "FeatureCollection", "rewilded": bool(rw), "features": feats})

    # channel_depth.png: local incision of channel cells below a 20 m ring, decimetres
    depth = channel_depth(z, ch, res)
    Image.fromarray(depth, "L").save(tile.path("client/channel_depth.png"), optimize=True)

    # Downhill check on the raw DEM: 200 points spread by length along DEM reaches; at each, the
    # terrain 10 m downstream must not be more than 0.5 m higher.
    climb = downhill_check(z, res, [rc["line"] for rc in dem_reaches])

    dem_len = sum(rc["line"].length for rc in dem_reaches)
    matched_n = sum(rc["matched"] for rc in dem_reaches)
    stats = {
        "threshold_km2": threshold_km2, "seeds": len(seeds), "seeds_moved": seeds_moved,
        "edge_links": len(edge_links),
        "edge_links_detail": [{"name": lk["name"], "kind": lk["kind"], "from": list(divmod(lk["from"], nc)), "to": list(divmod(lk["to"], nc)),
                               "jump_m": lk["jump_m"], "area_km2": round(float(acc_flat[lk["from"]]), 2)} for lk in edge_links][:60],
        "seeds_carried": [{"name": s["name"], "area_km2": round(s["area_km2"], 1), "carried_km2": round(s["carried"], 1)}
                          for s in seeds if s.get("carried", 0) > 0], "breaches": n_breach, "breach_cells": carved, "unresolved_flat_cells": int(unresolved),
        "pruned_stubs": pruned, "interior_outlets": interior_outlets, "channel_cells": int(ch.sum()),
        "dem_reaches": len(dem_reaches), "dem_matched": matched_n, "dem_unmatched": len(dem_reaches) - matched_n,
        "nhd_flowlines": len(nhd), "nhd_covered": nhd_stats["covered"], "nhd_partial": nhd_stats["partial"],
        "nhd_uncovered": nhd_stats["uncovered"], "nhd_kept_reaches": len(kept), "nhd_tips_dropped": tips_dropped, "nhd_tips_length_km": round(tips_len / 1000, 2),
        "dem_length_km": round(dem_len / 1000, 2), "nhd_kept_length_km": round(sum(k["line"].length for k in kept) / 1000, 2),
        "nhd_length_km": round(nhd_len / 1000, 2), "nhd_covered_length_km": round(nhd_cov_len / 1000, 2),
        "median_offset_m": round(float(np.median(offsets)), 1) if offsets else None,
        "median_reach_offset_m": round(float(np.median(reach_offsets)), 1) if reach_offsets else None,
        "p90_offset_m": round(float(np.percentile(offsets, 90)), 1) if offsets else None,
        "in_waterbody_pieces": sum(f["properties"]["in_waterbody"] for f in feats),
        "features": len(feats), "downhill_check": climb,
        "max_area_km2": round(float(acc_km2.max()), 2),
        "breach_max_m": breach_max,
    }
    if rw:
        stats["rewilded_waterbodies"] = len(rewilded)
        stats["rewild_check"] = rewild_check
        stats["routed_on"] = "terrain/dem_rewilded.tif" if rw["dem"] else "terrain/dem.tif"
    print("channels:", json.dumps({k: v for k, v in stats.items() if k != "rewild_check"}))
    return {
        "hydro.channels": {"path": "hydro/channels.geojson", "kind": "vector", "source": "usgs_3dep",
                           "derived_from": ["terrain.dem", "hydro.flowlines", "hydro.waterbodies"] + (["hydro.human_water", "terrain.dem_rewilded"] if rw else []),
                           "feature_count": len(feats), "method": f"least-cost breach (<= {breach_max:g} m) of depressions >= 1 m outside waterbodies"
                                     + (" (human water rewilded: not held as ponds, routed on terrain/dem_rewilded.tif)" if rw else "")
                                     + ", then pysheds fill + resolve_flats, D8, NHD-seeded inflow, edge leaks handed back to their NHD stream",
                           "params": {"threshold_km2": threshold_km2, "min_reach_m": MIN_REACH_M,
                                      "match_radius_m": MATCH_RADIUS_M, "width": "1.6*A^0.45 clamp 1-30",
                                      "bed_width": "1.5*width+1"},
                           "stats": stats},
        "client.channel_depth": {"path": "client/channel_depth.png", "kind": "raster", "crs": tile.crs,
                                 "bounds": list(tile.bounds), "pixels": nr, "resolution_m": res,
                                 "derived_from": ["terrain.dem", "hydro.channels"],
                                 "encoding": f"uint8 decimetres: mean DEM on a {DEPTH_RING_M:g} m ring minus the channel cell, "
                                             "clamped 0-25 m, x10; 0 off channel"},
    }


def _cell(pt, res, n):
    col = int(min(n - 1, max(0, pt.x // res)))
    row = int(min(n - 1, max(0, (TILE_SIZE_M - pt.y) // res)))
    return row, col


def _parts(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    out = []
    for p in getattr(g, "geoms", []):
        out.extend(_parts(p))
    if g.geom_type == "MultiLineString":
        merged = shapely.line_merge(g)
        return _parts(merged) if merged.geom_type == "LineString" else [p for p in merged.geoms]
    return out


def _permanence(fcode):
    if fcode in (PERENNIAL, 55800):
        return PERENNIAL
    if fcode in (INTERMITTENT, 33400):
        return INTERMITTENT
    if fcode == EPHEMERAL:
        return EPHEMERAL
    return INTERMITTENT if fcode is None else fcode


def _rank(fcode):
    return {PERENNIAL: 3, INTERMITTENT: 2, EPHEMERAL: 1}.get(fcode, 0)


def channel_depth(z: np.ndarray, ch: np.ndarray, res: float, ring_m: float = DEPTH_RING_M) -> np.ndarray:
    from scipy.ndimage import correlate
    r = ring_m / res
    k = int(np.ceil(r + 0.5))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    d = np.hypot(yy, xx)
    ring = ((d >= r - 0.5) & (d < r + 0.5)).astype("float64")
    ring /= ring.sum()
    mean_ring = correlate(z, ring, mode="nearest")
    depth = np.clip(mean_ring - z, 0, 25)
    out = np.where(ch, np.round(depth * 10), 0).astype("uint8")
    return out


def _bilinear(z, res, x, north):
    n = z.shape[0]
    px = np.clip(x / res - 0.5, 0, n - 1.001)
    py = np.clip((TILE_SIZE_M - north) / res - 0.5, 0, n - 1.001)
    i, j = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = px - i, py - j
    return ((z[j, i] * (1 - fx) + z[j, i + 1] * fx) * (1 - fy) + (z[j + 1, i] * (1 - fx) + z[j + 1, i + 1] * fx) * fy)


def downhill_check(z, res, lines, n=200, ahead=10.0, tol=0.5, seed=7):
    lines = [l for l in lines if l.length > ahead]
    if not lines:
        return None
    L = np.array([l.length - ahead for l in lines])
    cum = np.cumsum(L)
    rng = np.random.default_rng(seed)
    viol, rises = 0, []
    for u in rng.random(n) * cum[-1]:
        k = int(np.searchsorted(cum, u))
        d = u - (cum[k - 1] if k else 0)
        a, b = lines[k].interpolate(d), lines[k].interpolate(d + ahead)
        za, zb = _bilinear(z, res, np.array([a.x, b.x]), np.array([a.y, b.y]))
        rises.append(zb - za)
        viol += zb > za + tol
    return {"points": n, "step_m": ahead, "tolerance_m": tol, "violations": int(viol),
            "violation_rate": round(viol / n, 3), "max_rise_m": round(float(max(rises)), 2)}
