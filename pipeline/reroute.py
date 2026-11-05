"""Every stream and river re-routed onto the lowest ground of the 1 m lidar terrain (build step `reroute`, after
`rewild_hydro`, before `water`).

Aaron (2026-11-04): "We need a step in the pipeline where the water is re-routed according to the LIDAR maps - it needs
to be at the lowest point, period." The channels step routes the network by gravity on the 5 m DEM and takes names and
permanence from NHD; a 5 m cell is wider than most creeks here and the reach lines are smoothed cell centres, so on the
1 m ground a centreline runs a metre to several metres off the real thalweg: up a bank, through the toe of a spur, and
the water step then carved a trench beside the dry creek. This step keeps the 5 m network's topology and attributes
(which reach is which, its order, drainage area, NHD name and permanence, width) and replaces its geometry with the
path water takes on the 1 m ground:

  1. The corridor: every DEM-sourced reach buffered by CORRIDOR_M + its water width, rasterised on the 1 m grid. The
     routing below never leaves it, so a trace cannot slip into the next valley over a low saddle the 5 m routing
     already ruled out.
  2. Conditioning, priority-flood with breaching (carving): from the network's outlets (the border cells within
     OUTLET_R_M of a reach leaving the tile, the lowest cell near an interior outlet, then the lowest cell of any part of
     the corridor still unreached) the corridor is flooded in order of height, ties first come first served (so a flat
     is crossed breadth first from its outlet). A cell reached from a higher one is a pit: rather than filling it to the
     spill height, the path from the spill cell back to the outlet is lowered to the pit's height (a breach), so a road
     fill over an erased culvert is cut where the flood first crossed it and makes no false lake. Each cell's flow
     direction is the cell it was reached from (its lowest neighbour on a path to the outlet); accumulation is summed
     back down those directions over the corridor (cells, not km2: only its maxima are used).
     A rewilded reservoir bed's restored thalweg (terrain/dem_rewilded.tif's carve, 5 m) is applied to the 1 m ground
     first, so the trace runs down the restored channel rather than across the old flat.
  3. Snapping: each node of the 5 m network (a head, a junction, a waterbody crossing, an outlet) moves to the cell of
     greatest accumulation within NODE_R_M (HEAD_R_M at a head); each reach is the flow path from its upstream node
     down to its downstream node. A tributary that meets the main stem above the junction node stops where it meets
     it (the bigger stream owns the shared cells). A trace that never reaches its node (within HIT_M) keeps the 5 m
     line with its ends moved to the new nodes, and is logged (`kept`).
  4. The line: the trace's cell centres smoothed over SMOOTH_M, then every vertex moved across the flow to the middle
     of the lowest ground of its cross-section (the 1 m DEM over +-0.75 water widths, the run of ground within CENTRE_TOL_M
     of the minimum that holds it), smoothed lightly and centred again within 1 m, simplified to SIMPLIFY_M.

NHD-sourced stretches (no DEM channel nearby: the map's line is the best fit there is) and canals keep their geometry and
are counted (`nhd_kept`). The 5 m routed lines are kept as hydro/channels_5m.geojson; channels.geojson carries
`"rerouted": true` and per reach `rerouted` (true, or "kept"), `snap_shift_m` (median distance of the new line from the
5 m one) and `snap_shift_max_m`. A rerun reads channels_5m.geojson while channels.geojson is marked rerouted.

Downstream of the line, re-derived here: client/channel_profile.png R and G (the thalweg depth and riffle-pool index,
on the 1 m long profile; B, the rewilded beds, kept), client/channel_depth.png (incision on the 5 m grid along the new
lines) and client/features.json (derive.client_features). The water step reads the new lines and takes each reach's
level from the 1 m ground along it.
"""
from __future__ import annotations

import json
import time

import numpy as np
import rasterio
from numba import njit
from PIL import Image
from scipy import ndimage
from shapely.geometry import LineString, mapping, shape

from .config import TILE_SIZE_M, Tile, write_json

CORRIDOR_M = 25.0        # corridor half width beyond the water width
NODE_R_M = 12.0          # a junction, crossing or outlet node moves to the most accumulated cell within this
HEAD_R_M = 4.0           # ... a head within this
HIT_M = 3.0              # a trace passing this close to its node reaches it
OUTLET_R_M = 30.0        # border cells within this of a reach leaving the tile are the flood's outlets
BELOW_M = 150.0          # a trace joining the flow path this far under its node has reached it
ROAD_MIN = 128           # client/roads.png weight: pavement and the inner verge
ROAD_GROW_M = 10.0       # ... grown this far to take in the fill slopes and ditches
BURN_HALF_M = 1.5        # a 5 m reach crossing a road is cut into the 1 m ground this far either side
SMOOTH_M = 1.5           # gaussian sigma over the trace's cell centres
CENTRE_R_M = (1.5, 22.0) # cross-section half span for centring: clip(0.75 x water width, these); wide enough to span
                         # a hydro-flattened river's flat surface (the Merced, 28 m), so the line runs down its middle
CENTRE_TOL_M = 0.02      # the lowest ground: within clip(0.02 widths, this, 0.15 m) of the cross-section's minimum
                         # (the second pass, within 1 m, this alone)
SIMPLIFY_M = 0.3         # simplified to max(this, 0.08 widths)
CANAL = 33600
DEM_AGREE_M = 3.0        # the 5 m DEM must be the 1 m ground averaged to within this (std): see dem_agreement
FIVE_M = "hydro/channels_5m.geojson"


# ---------------------------------------------------------------------------
# The 1 m ground
# ---------------------------------------------------------------------------

class FineDEM:
    """terrain/dem_1m.tif (nodata filled from terrain/dem.tif) with a bilinear sampler between pixel centres."""

    def __init__(self, tile: Tile, z5: np.ndarray | None = None):
        with rasterio.open(tile.path("terrain/dem_1m.tif")) as src:
            z = src.read(1)
            nod = src.nodata
        bad = ~np.isfinite(z)
        if nod is not None:
            bad |= z == nod
        if bad.any():
            if z5 is None:
                with rasterio.open(tile.path("terrain/dem.tif")) as src:
                    z5 = src.read(1).astype("float64")
            n5 = z5.shape[0]
            rr, cc = np.nonzero(bad)
            z[rr, cc] = ndimage.map_coordinates(z5, [(rr + 0.5) * n5 / z.shape[0] - 0.5, (cc + 0.5) * n5 / z.shape[1] - 0.5],
                                                order=1, mode="nearest")
        self.z = z.astype("float32", copy=False)
        self.n = z.shape[0]
        self.res = TILE_SIZE_M / self.n
        self.nodata_cells = int(bad.sum())

    def at(self, x, north, z=None):
        z = self.z if z is None else z
        n, res = self.n, self.res
        px = np.clip(np.asarray(x, "float64") / res - 0.5, 0, n - 1.001)
        py = np.clip((n * res - np.asarray(north, "float64")) / res - 0.5, 0, n - 1.001)
        i, j = np.floor(px).astype(np.int64), np.floor(py).astype(np.int64)
        fx, fy = px - i, py - j
        return ((z[j, i] * (1 - fx) + z[j, i + 1] * fx) * (1 - fy) + (z[j + 1, i] * (1 - fx) + z[j + 1, i + 1] * fx) * fy)


# ---------------------------------------------------------------------------
# Priority-flood with breaching, on a mask
# ---------------------------------------------------------------------------

@njit(cache=True)
def _hpush(hk, hs, hi, size, k, s, i):
    j = size
    hk[j] = k; hs[j] = s; hi[j] = i
    while j > 0:
        p = (j - 1) >> 1
        if hk[p] < hk[j] or (hk[p] == hk[j] and hs[p] < hs[j]):
            break
        hk[p], hk[j] = hk[j], hk[p]
        hs[p], hs[j] = hs[j], hs[p]
        hi[p], hi[j] = hi[j], hi[p]
        j = p
    return size + 1


@njit(cache=True)
def _hpop(hk, hs, hi, size):
    top = hi[0]
    size -= 1
    hk[0] = hk[size]; hs[0] = hs[size]; hi[0] = hi[size]
    j = 0
    while True:
        a = 2 * j + 1
        if a >= size:
            break
        b = a + 1
        m = a
        if b < size and (hk[b] < hk[a] or (hk[b] == hk[a] and hs[b] < hs[a])):
            m = b
        if hk[j] < hk[m] or (hk[j] == hk[m] and hs[j] < hs[m]):
            break
        hk[m], hk[j] = hk[j], hk[m]
        hs[m], hs[j] = hs[j], hs[m]
        hi[m], hi[j] = hi[j], hi[m]
        j = m
    return top, size


@njit(cache=True)
def flood(z, mask, lab, adj, parent, order, n_done, seeds, nr, nc):
    """Priority-flood from `seeds` over `mask` (flat arrays), breaching every pit: z is lowered in place along the
    path from a pit's spill cell to the outlet, never raised. lab: each cell's territory (the nearest reach); the flood
    passes from one territory to another only where adj[a, b] (the same reach, or two that share a node), so water
    follows the network's topology and never slips over a low saddle into an unrelated creek's corridor.
    parent: -2 unreached, -1 outlet, else the flat index the cell drains to. order: cells in the order they were taken
    (each after the cell it drains to), from n_done on. Returns the new n_done."""
    cap = 0
    for i in range(mask.size):
        if mask[i]:
            cap += 1
    cap += seeds.size + 1
    hk = np.empty(cap, np.float32)
    hs = np.empty(cap, np.int64)
    hi = np.empty(cap, np.int64)
    size = 0
    seq = 0
    for s in seeds:
        if parent[s] == -2:
            parent[s] = -1
            size = _hpush(hk, hs, hi, size, z[s], seq, s)
            seq += 1
    dr = (-1, -1, -1, 0, 0, 1, 1, 1)
    dc = (-1, 0, 1, -1, 1, -1, 0, 1)
    while size > 0:
        c, size = _hpop(hk, hs, hi, size)
        order[n_done] = c
        n_done += 1
        r0 = c // nc
        c0 = c - r0 * nc
        zc = z[c]
        for k in range(8):
            r = r0 + dr[k]
            q = c0 + dc[k]
            if r < 0 or r >= nr or q < 0 or q >= nc:
                continue
            nb = r * nc + q
            if not mask[nb] or parent[nb] != -2 or not adj[lab[c], lab[nb]]:
                continue
            parent[nb] = c
            zn = z[nb]
            if zn < zc:
                # a pit: breach the way out instead of filling it
                p = c
                while p >= 0 and z[p] > zn:
                    z[p] = zn
                    p = parent[p]
            size = _hpush(hk, hs, hi, size, z[nb], seq, nb)
            seq += 1
    return n_done


@njit(cache=True)
def accumulate(parent, order, n_done, acc):
    """Cells draining through each cell (itself included), summed down the flow directions."""
    for k in range(n_done):
        acc[order[k]] = 1.0
    for k in range(n_done - 1, -1, -1):
        c = order[k]
        p = parent[c]
        if p >= 0:
            acc[p] += acc[c]


def condition(z: np.ndarray, mask: np.ndarray, outlets: np.ndarray, lab: np.ndarray | None = None, adj: np.ndarray | None = None):
    """Breach-conditioned heights, flow directions and accumulation over `mask` (2-D), the flood kept to the
    territories' adjacency (lab, adj; one territory when not given). Corridor parts no outlet reaches are flooded from
    their own lowest cell. Returns (zc 2-D float32, parent flat int64, acc 2-D float32, stats)."""
    nr, nc = z.shape
    zc = z.astype("float32").ravel().copy()
    m = mask.ravel()
    if lab is None:
        lab = np.zeros(m.size, np.int32)
        adj = np.ones((1, 1), np.bool_)
    lab = lab.ravel()
    parent = np.full(zc.size, -2, np.int64)
    order = np.empty(int(m.sum()) + 1, np.int64)
    n_done = flood(zc, m, lab, adj, parent, order, 0, np.asarray(outlets, np.int64), nr, nc)
    extra = 0
    left = m & (parent == -2)
    if left.any():
        lab, k = ndimage.label(left.reshape(nr, nc), structure=np.ones((3, 3)))
        lab = lab.ravel()
        idx = np.flatnonzero(lab)
        zz = zc[idx]
        o = np.lexsort((zz, lab[idx]))
        first = np.ones(o.size, bool)
        first[1:] = lab[idx][o][1:] != lab[idx][o][:-1]
        seeds = idx[o][first]
        extra = int(seeds.size)
        n_done = flood(zc, m, lab, adj, parent, order, n_done, seeds.astype(np.int64), nr, nc)
    acc = np.zeros(zc.size, np.float32)
    accumulate(parent, order, n_done, acc)
    cut = z.ravel()[m] - zc[m]
    stats = {"corridor_cells": int(m.sum()), "outlets": int(len(outlets)), "unreached_parts": extra,
             "breached_cells": int((cut > 1e-4).sum()), "breach_p99_m": round(float(np.percentile(cut, 99)), 3) if cut.size else 0,
             "breach_max_m": round(float(cut.max()), 2) if cut.size else 0}
    return zc.reshape(nr, nc), parent, acc.reshape(nr, nc), stats


# ---------------------------------------------------------------------------
# The network as nodes and edges
# ---------------------------------------------------------------------------

def isotonic_down(v: np.ndarray) -> np.ndarray:
    """The non-increasing sequence nearest v in least squares (pool adjacent violators): a long profile's trend that
    neither hangs on the deepest hole (a running minimum does: a 1 m pit holds the level down for the rest of the
    reach) nor climbs over a hump."""
    v = np.asarray(v, "float64")
    if v.size < 2:
        return v.copy()
    val, wt, cnt = [], [], []
    for x in v:
        val.append(float(x)); wt.append(1.0); cnt.append(1)
        while len(val) > 1 and val[-2] < val[-1]:
            w = wt[-2] + wt[-1]
            m = (val[-2] * wt[-2] + val[-1] * wt[-1]) / w
            c = cnt[-2] + cnt[-1]
            val.pop(); wt.pop(); cnt.pop()
            val[-1], wt[-1], cnt[-1] = m, w, c
    return np.repeat(val, cnt)


def _nodes(lines: list[LineString], tol=0.5):
    """Endpoint clusters: (node of each line's start, node of its end, node positions)."""
    from scipy.spatial import cKDTree
    pts = np.array([[ln.coords[0], ln.coords[-1]] for ln in lines], "float64").reshape(-1, 2)
    par = np.arange(len(pts))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for a, b in cKDTree(pts).query_pairs(tol):
        ra, rb = find(a), find(b)
        if ra != rb:
            par[rb] = ra
    roots = np.array([find(a) for a in range(len(pts))])
    uniq, node = np.unique(roots, return_inverse=True)
    pos = np.array([pts[node == k].mean(axis=0) for k in range(len(uniq))])
    return node[0::2], node[1::2], pos


def _cells_near(x, y, r, res, n):
    """Flat indices (and their centres) of the cells within r of (x, y)."""
    c0, c1 = int(max(0, (x - r) // res)), int(min(n - 1, (x + r) // res))
    size = n * res
    r0, r1 = int(max(0, (size - y - r) // res)), int(min(n - 1, (size - y + r) // res))
    rr, cc = np.mgrid[r0:r1 + 1, c0:c1 + 1]
    cx, cy = (cc + 0.5) * res, size - (rr + 0.5) * res
    ok = np.hypot(cx - x, cy - y) <= r
    return (rr[ok] * n + cc[ok]), cx[ok], cy[ok]


def _snap_node(x, y, r, acc_flat, zc_flat, reached, res, n):
    idx, _, _ = _cells_near(x, y, r, res, n)
    idx = idx[reached[idx]]
    if idx.size == 0:
        return -1
    a = acc_flat[idx]
    best = idx[a == a.max()]
    return int(best[np.argmin(zc_flat[best])])


def _trace(start, goal, parent, n, limit, hit_cells, below=frozenset(), outlet_cells=0):
    """The flow path from `start`; stops at `goal`, at a cell of `below` (the flow path a little way down from the
    goal: the stream met the one it joins just under the node), at an outlet within outlet_cells of the goal, at the
    passing cell nearest the goal when that is within hit_cells, or fails after `limit` cells. Returns (path, reached)."""
    gr, gc = divmod(goal, n)
    path = [start]
    c = start
    best_k, best_d = 0, np.inf
    for _ in range(limit):
        if c == goal or c in below:
            return path, True
        r, q = divmod(c, n)
        d = max(abs(r - gr), abs(q - gc))
        if d < best_d:
            best_d, best_k = d, len(path) - 1
        p = parent[c]
        if p < 0:
            if d <= outlet_cells:
                return path, True
            break
        path.append(int(p))
        c = int(p)
    if c == goal:
        return path, True
    if best_d <= hit_cells:
        return path[:best_k + 1] + [goal], True
    return path, False


# ---------------------------------------------------------------------------
# The line: smoothed and centred on the lowest ground
# ---------------------------------------------------------------------------

def _normals(p):
    d = np.gradient(p, axis=0) if len(p) > 1 else np.array([[1.0, 0.0]])
    if len(p) > 4:
        d = ndimage.uniform_filter1d(d, 5, axis=0, mode="nearest")
    L = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
    return np.column_stack([-d[:, 1] / L, d[:, 0] / L])


def centre_offsets(p: np.ndarray, dem: FineDEM, half: float, step=0.25, tol=CENTRE_TOL_M) -> np.ndarray:
    """Per vertex, the offset across the flow (along _normals) to the middle of the run of lowest ground (within tol
    of the cross-section's minimum over +-half, the section smoothed over a tenth of its span so lidar noise on a
    river's surface does not break the run) that holds the minimum; 0 at the ends."""
    if len(p) < 3:
        return np.zeros(len(p))
    nrm = _normals(p)
    offs = np.arange(-half, half + 1e-9, step)
    X = p[:, 0:1] + nrm[:, 0:1] * offs[None, :]
    Y = p[:, 1:2] + nrm[:, 1:2] * offs[None, :]
    Z = dem.at(X.ravel(), Y.ravel()).reshape(X.shape)
    sg = 0.1 * half / step
    if sg >= 1:
        Z = ndimage.gaussian_filter1d(Z, sg, axis=1, mode="nearest")
    out = np.zeros(len(p))
    k0 = np.argmin(Z, axis=1)
    zmin = Z[np.arange(len(p)), k0]
    low = Z <= zmin[:, None] + tol
    for i in range(1, len(p) - 1):
        a = b = k0[i]
        row = low[i]
        while a > 0 and row[a - 1]:
            a -= 1
        while b < len(offs) - 1 and row[b + 1]:
            b += 1
        out[i] = 0.5 * (offs[a] + offs[b])
    return out


def centre_on_low(p: np.ndarray, dem: FineDEM, half: float, sigma_m: float = 1.0, tol: float = CENTRE_TOL_M) -> np.ndarray:
    """The line moved onto the lowest ground of its cross-sections: centre_offsets, median-filtered over three vertices
    and smoothed over sigma_m (vertices are 1 m apart), so the move follows the channel rather than each vertex's own
    noise."""
    if len(p) < 3:
        return p
    o = centre_offsets(p, dem, half, tol=tol)
    o = ndimage.median_filter(o, 3, mode="nearest")
    if len(o) > 3 and sigma_m > 0:
        o = ndimage.gaussian_filter1d(o, sigma_m, mode="nearest")
    o[0] = o[-1] = 0
    return p + _normals(p) * o[:, None]


def _gsmooth(p, sigma_pts):
    if len(p) < 4 or sigma_pts <= 0:
        return p
    q = ndimage.gaussian_filter1d(p, sigma_pts, axis=0, mode="nearest")
    q[0], q[-1] = p[0], p[-1]
    return q


def _resample(p, step=1.0):
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] < step:
        return p
    t = np.linspace(0, s[-1], max(2, int(round(s[-1] / step)) + 1))
    return np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])


def shape_line(path_xy: np.ndarray, dem: FineDEM, width: float) -> np.ndarray:
    """A trace's cell centres to a centreline on the lowest ground: smoothed over max(SMOOTH_M, 0.4 widths) (a wide
    ribbon cannot follow a wiggle narrower than itself), centred on the low ground over +-clip(0.75 widths, CENTRE_R_M)
    with the move smoothed over max(1 m, 0.3 widths), then again within 1 m, resampled to 1 m between. On a flat
    (a hydro-flattened river, the lidar's water surface) the lowest run is the whole surface: the line takes its middle."""
    p = _resample(path_xy, 1.0)
    p = _gsmooth(p, max(SMOOTH_M, 0.4 * width))
    half = float(np.clip(0.75 * width, *CENTRE_R_M))
    p = centre_on_low(p, dem, half, max(1.0, 0.3 * width), float(np.clip(0.02 * width, CENTRE_TOL_M, 0.15)))
    p = _resample(p, 1.0)
    p = centre_on_low(p, dem, 1.0, 1.0)
    return p


def _cells_xy(cells, n, res):
    r, c = np.divmod(np.asarray(cells, np.int64), n)
    return np.column_stack([(c + 0.5) * res, n * res - (r + 0.5) * res])


# ---------------------------------------------------------------------------
# The step
# ---------------------------------------------------------------------------

def dem_agreement(z5: np.ndarray, z1: np.ndarray) -> float:
    """Std (m) of terrain/dem.tif minus the 1 m ground's block mean, inside a 500 m inset: 0.3 m on the foothill tiles,
    1 m on Yosemite 270_4180 (cliffs), 13.8 m on 267_4175, whose 5 m DEM is the 3DEP seamless product."""
    f = z1.shape[0] // z5.shape[0]
    a = z1.reshape(z5.shape[0], f, z5.shape[1], f).mean(axis=(1, 3))
    k = z5.shape[0] // 20
    d = (z5 - a)[k:-k, k:-k]
    return float(np.nanstd(d))


def territories(edges: list[dict], n: int, res: float) -> np.ndarray:
    """Each 1 m cell's nearest reach (1-based index into edges), from a 2 m distance transform."""
    from rasterio.features import rasterize
    n2 = n // 2
    tr2 = rasterio.transform.from_origin(0, n * res, 2 * res, 2 * res)
    # the bigger streams last, so a cell two reaches share (a junction) is the bigger one's
    order = sorted(range(len(edges)), key=lambda i: edges[i]["area"])
    seed = rasterize([(edges[i]["line"], i + 1) for i in order], out_shape=(n2, n2), transform=tr2, fill=0,
                     dtype="int32", all_touched=True)
    _, (ir, ic) = ndimage.distance_transform_edt(seed == 0, return_indices=True)
    lab2 = seed[ir, ic]
    del ir, ic
    return np.repeat(np.repeat(lab2, 2, axis=0), 2, axis=1).astype(np.int32)


def _rewild_carve(tile: Tile, dem: FineDEM):
    """The restored thalwegs through rewilded beds (terrain/dem.tif - terrain/dem_rewilded.tif, 5 m) cut into the 1 m
    ground, so the trace runs down them."""
    p_rw = tile.path("terrain/dem_rewilded.tif")
    if not p_rw.exists():
        return 0
    with rasterio.open(tile.path("terrain/dem.tif")) as a, rasterio.open(p_rw) as b:
        cut5 = a.read(1).astype("float32") - b.read(1).astype("float32")
    cut5[~np.isfinite(cut5)] = 0
    cut5 = np.maximum(cut5, 0)
    if not (cut5 > 1e-3).any():
        return 0
    f = dem.n // cut5.shape[0]
    cut1 = np.repeat(np.repeat(cut5, f, axis=0), f, axis=1)
    dem.z -= cut1
    return int((cut1 > 1e-3).sum())


def road_zone(tile: Tile) -> np.ndarray | None:
    """The erased roads and their fills on the 5 m grid: client/roads.png at the inner verge or more (ROAD_MIN),
    grown ROAD_GROW_M."""
    p = tile.path("client/roads.png")
    if not p.exists():
        return None
    w = np.asarray(Image.open(p).convert("L"))
    zone = w >= ROAD_MIN
    k = int(round(ROAD_GROW_M / (TILE_SIZE_M / w.shape[0])))
    return ndimage.binary_dilation(zone, np.ones((3, 3), bool), iterations=k) if k > 0 else zone


def burn_roads(edges: list[dict], dem: FineDEM, zone5: np.ndarray) -> dict:
    """Where a 5 m reach crosses an erased road (road_zone), its line is cut into the 1 m ground as a strip
    BURN_HALF_M either side, graded from the lowest ground at its way in to the lowest at its way out (never rising):
    the culvert under the fill. Without it the 1 m trace runs along the ditch at the fill's toe to wherever the fill's
    crest is lowest. Returns counts."""
    n, res = dem.n, dem.res
    n5 = zone5.shape[0]
    r5 = n * res / n5
    runs = cut_cells = 0
    deepest = 0.0
    for e in edges:
        ln = e["line"]
        ds = np.arange(0.0, ln.length + 1e-6, 1.0)
        if ds.size < 2:
            continue
        P = np.array([ln.interpolate(d).coords[0] for d in ds])
        c = np.clip((P[:, 0] // r5).astype(int), 0, n5 - 1)
        r = np.clip(((n * res - P[:, 1]) // r5).astype(int), 0, n5 - 1)
        inz = zone5[r, c]
        if not inz.any():
            continue
        lab, k = ndimage.label(inz)
        for j in range(1, k + 1):
            idx = np.flatnonzero(lab == j)
            i0, i1 = max(idx[0] - 1, 0), min(idx[-1] + 1, len(P) - 1)

            def low(i):
                cells, _, _ = _cells_near(P[i, 0], P[i, 1], 4.0, res, n)
                return float(dem.z.ravel()[cells].min())
            zin = low(i0)
            zout = min(low(i1), zin)
            prof = np.interp(ds[i0:i1 + 1], [ds[i0], ds[i1]], [zin, zout])
            for (x, y), zp in zip(P[i0:i1 + 1], prof):
                cells, _, _ = _cells_near(x, y, BURN_HALF_M, res, n)
                zf = dem.z.ravel()
                old = zf[cells]
                new = np.minimum(old, zp)
                deepest = max(deepest, float((old - new).max()))
                cut_cells += int((new < old).sum())
                zf[cells] = new
            runs += 1
    return {"crossings": runs, "cells_lowered": cut_cells, "deepest_m": round(deepest, 2)}


def reroute(tile: Tile) -> dict:
    t0 = time.time()
    from .rewild_hydro import _Ctx
    ctx = _Ctx(tile)
    dem = FineDEM(tile, ctx.z)
    agree = dem_agreement(ctx.z, dem.z)
    if agree > DEM_AGREE_M:
        raise RuntimeError(f"terrain/dem.tif is not the 1 m ground averaged (std of the difference {agree:.1f} m > {DEM_AGREE_M:g} m): "
                           "the client draws the 5 m heights, so water on the 1 m thalweg would not sit on the drawn ground. "
                           "Rebuild terrain/dem.tif from terrain/dem_1m.tif (and the steps after it) first.")
    ch_path = tile.path("hydro/channels.geojson")
    doc = json.load(open(ch_path))
    if doc.get("rerouted"):
        if not tile.path(FIVE_M).exists():
            raise RuntimeError("channels.geojson is rerouted but hydro/channels_5m.geojson is missing: run the channels step")
        doc = json.load(open(tile.path(FIVE_M)))
    else:
        write_json(tile.path(FIVE_M), doc)
    feats = doc["features"]
    rw_cells = _rewild_carve(tile, dem)
    n, res = dem.n, dem.res

    # edges: the DEM-sourced reaches (and their waterbody pieces), downstream-oriented
    edges = []
    for k, f in enumerate(feats):
        pr = f["properties"]
        if pr.get("source") != "dem" or pr.get("fcode") == CANAL:
            continue
        g = ctx.local(shape(f["geometry"]))
        if g.geom_type != "LineString" or g.length < 1:
            continue
        edges.append({"k": k, "line": g, "width": float(pr.get("width") or 2.0), "area": float(pr.get("area_km2") or 0.15),
                      "pond": bool(pr.get("in_waterbody"))})
    lines = [e["line"] for e in edges]
    s_node, e_node, pos = _nodes(lines)
    zone5 = road_zone(tile)
    road_stats = burn_roads(edges, dem, zone5) if zone5 is not None else None
    n_in = np.bincount(e_node, minlength=len(pos))
    n_out = np.bincount(s_node, minlength=len(pos))

    # 1. corridor, and each cell's territory: the nearest reach (on a 2 m grid)
    from rasterio.features import rasterize
    tr1 = rasterio.transform.from_origin(0, TILE_SIZE_M, res, res)
    shapes = [(e["line"].buffer(CORRIDOR_M + e["width"], resolution=4), 1) for e in edges]
    mask = rasterize(shapes, out_shape=(n, n), transform=tr1, fill=0, dtype="uint8").astype(bool)
    lab = territories(edges, n, res)
    adj = np.eye(len(edges) + 1, dtype=np.bool_)
    touching = {}
    for ei in range(len(edges)):
        for v in (s_node[ei], e_node[ei]):
            touching.setdefault(int(v), []).append(ei + 1)
    for es in touching.values():
        for a in es:
            adj[a, es] = True

    # 2. outlets: border cells near a reach leaving the tile; the lowest cell near an interior outlet
    outlets = []
    border = np.zeros((n, n), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    for v in np.flatnonzero(n_out == 0):
        x, y = pos[v]
        on_edge = min(x, y, TILE_SIZE_M - x, TILE_SIZE_M - y) < 10.0
        idx, _, _ = _cells_near(x, y, OUTLET_R_M if on_edge else 10.0, res, n)
        idx = idx[mask.ravel()[idx]]
        if on_edge:
            idx = idx[border.ravel()[idx]]
            outlets.extend(idx.tolist())
        elif idx.size:
            outlets.append(int(idx[np.argmin(dem.z.ravel()[idx])]))
    outlets = np.unique(np.asarray(outlets, np.int64))
    zc, parent, acc, cstats = condition(dem.z, mask, outlets, lab, adj)
    del mask, lab
    zc_f, acc_f = zc.ravel(), acc.ravel()
    reached = parent >= -1

    # 3. nodes and traces
    fine = np.full(len(pos), -1, np.int64)
    for v, (x, y) in enumerate(pos):
        fine[v] = _snap_node(x, y, HEAD_R_M if n_in[v] == 0 else NODE_R_M, acc_f, zc_f, reached, res, n)
    traces = []
    below_of = {}
    for ei, e in enumerate(edges):
        a, b = fine[s_node[ei]], fine[e_node[ei]]
        if a < 0 or b < 0 or e["pond"]:   # across a kept pond's flat water there is no lowest line: drawn as the pond
            traces.append(None)
            continue
        if b not in below_of:
            chain, c = [], int(parent[b])
            while c >= 0 and len(chain) < BELOW_M / res:
                chain.append(c)
                c = int(parent[c])
            below_of[b] = frozenset(chain)
        path, ok = _trace(a, b, parent, n, int(4 * e["line"].length / res) + 400, HIT_M / res, below_of[b], OUTLET_R_M / res)
        traces.append(path if ok else None)
    # a tributary meeting the bigger stream above the junction node stops where it meets it
    by_end = {}
    for ei in range(len(edges)):
        by_end.setdefault(int(e_node[ei]), []).append(ei)
    truncated = 0
    for v, ins in by_end.items():
        ins = [ei for ei in ins if traces[ei] is not None]
        if len(ins) < 2:
            continue
        ins.sort(key=lambda ei: -edges[ei]["area"])
        owned = set(traces[ins[0]])
        for ei in ins[1:]:
            t = traces[ei]
            for j, c in enumerate(t[:-1]):
                if c in owned:
                    traces[ei] = t[:j + 1]
                    truncated += 1
                    break
            owned.update(traces[ei])

    # 4. lines
    new_feats = [dict(f) for f in feats]
    shifts_med, shifts_max, kept_ids = [], [], []
    ok_n = kept_n = pond_n = 0
    for ei, e in enumerate(edges):
        f = feats[e["k"]]
        old = e["line"]
        if traces[ei] is not None and len(traces[ei]) >= 2:
            p = shape_line(_cells_xy(traces[ei], n, res), dem, e["width"])
            how = True
            ok_n += 1
        else:
            p = np.asarray(old.coords, "float64")
            for end, v in ((0, s_node[ei]), (-1, e_node[ei])):
                if fine[v] >= 0:
                    p[end] = _cells_xy([fine[v]], n, res)[0]
            how = "pond" if e["pond"] else "kept"
            if e["pond"]:
                pond_n += 1
            else:
                kept_n += 1
                kept_ids.append({"name": f["properties"].get("name"), "order": f["properties"].get("order"),
                                 "length_m": round(old.length, 1), "at": [round(float(old.coords[0][0])), round(float(old.coords[0][1]))]})
        ln = LineString(p).simplify(max(SIMPLIFY_M, 0.08 * e["width"])) if len(p) > 2 else LineString(p)
        # the shift: each new vertex's distance from the 5 m line (every 2.5 m)
        ds = np.arange(0, ln.length + 1e-6, 2.5)
        sh = np.array([old.distance(ln.interpolate(d)) for d in ds]) if ds.size else np.zeros(1)
        shifts_med.append(float(np.median(sh)))
        shifts_max.append(float(sh.max()))
        pr = dict(f["properties"])
        pr.update(rerouted=how, snap_shift_m=round(float(np.median(sh)), 2), snap_shift_max_m=round(float(sh.max()), 1),
                  length_m=round(ln.length, 1))
        new_feats[e["k"]] = {"type": "Feature", "geometry": mapping(ctx.wgs(ln)), "properties": pr}

    # 4b. the ice, meltwater from its toes, and the tile's seams (pipeline/water_seams.py)
    from . import water_seams as WS
    items = []
    for k, f in enumerate(new_feats):
        g = ctx.local(shape(f["geometry"])) if f.get("geometry") else None
        items.append({"line": g, "pr": dict(f["properties"]), "k": k})
    flow5 = []

    def flow_fn():
        if not flow5:
            flow5.append(WS.Flow5(tile))
        return flow5[0]
    ice, masses = WS.ice_mask(tile, ctx)
    ice_stats = melt_stats = None
    if ice is not None:
        ice_stats = WS.clip_ice(items, ice, ctx.res, masses)
        melt_stats = WS.meltwater(items, ice, masses, flow_fn(), dem, ctx)
    crossings, seam_stats = WS.seams_pass(tile, ctx, dem, items, flow_fn)
    WS.write_edges(tile, crossings, seam_stats)
    new_feats = [{"type": "Feature", "properties": it["pr"],
                  "geometry": mapping(ctx.wgs(it["line"])) if it["line"] is not None else None} for it in items]
    for f in new_feats:
        f["geometry"]["coordinates"] = [[round(a, 7), round(b, 7)] for a, b, *_ in f["geometry"]["coordinates"]] \
            if f["geometry"]["type"] == "LineString" else f["geometry"]["coordinates"]
    nhd_kept = [f for f in feats if f["properties"].get("source") != "dem" or f["properties"].get("fcode") == CANAL]
    write_json(ch_path, {**{k: v for k, v in doc.items() if k != "features"}, "rerouted": True, "features": new_feats})

    # 5. downstream of the line: profile R, G (B kept), channel_depth, features.json
    lines_new = [it["line"] for it in items if WS._is_line(it) and not it["pr"].get("on_ice")]
    pstats = write_profile_fine(tile, ctx, dem)
    from .channels import channel_depth
    ch5 = ctx.rasterize([ln for ln in lines_new], dtype="uint8").astype(bool)
    with rasterio.open(tile.path("terrain/dem_rewilded.tif") if tile.path("terrain/dem_rewilded.tif").exists() else tile.path("terrain/dem.tif")) as src:
        z5 = src.read(1).astype("float64")
    Image.fromarray(channel_depth(z5, ch5, ctx.res), "L").save(tile.path("client/channel_depth.png"), optimize=True)
    from .derive import client_features
    feats_layer = client_features(tile)

    sm, sx = np.array(shifts_med), np.array(shifts_max)
    stats = {
        "reaches": len(edges), "traced": ok_n, "kept": kept_n, "pond_pieces": pond_n, "kept_reaches": kept_ids[:40],
        "roads": road_stats,
        "tributaries_stopped_at_main": truncated, "nhd_kept": len(nhd_kept),
        "nodes": len(pos), "nodes_unsnapped": int((fine < 0).sum()),
        "snap_shift_m": {"median_of_reach_medians": round(float(np.median(sm)), 2) if sm.size else None,
                         "p90_of_reach_medians": round(float(np.percentile(sm, 90)), 2) if sm.size else None,
                         "max": round(float(sx.max()), 1) if sx.size else None},
        "conditioning": cstats, "dem_5m_vs_1m_std_m": round(agree, 2), "rewild_carve_cells_1m": rw_cells, "dem_1m_nodata_filled": dem.nodata_cells,
        "params": {"corridor_m": f"{CORRIDOR_M:g} + water width", "node_r_m": NODE_R_M, "head_r_m": HEAD_R_M,
                   "hit_m": HIT_M, "outlet_r_m": OUTLET_R_M, "smooth_m": SMOOTH_M, "centre_r_m": list(CENTRE_R_M),
                   "centre_tol_m": CENTRE_TOL_M, "simplify_m": SIMPLIFY_M},
        "profile": pstats, "ice": ice_stats, "meltwater": melt_stats, "seams": seam_stats,
        "seconds": round(time.time() - t0, 1),
    }
    print("reroute:", json.dumps({k: v for k, v in stats.items() if k not in ("kept_reaches", "params")}))
    out = {"hydro.channels_5m": {"path": FIVE_M, "kind": "vector", "derived_from": ["hydro.channels"],
                                 "encoding": "the channels step's network as it routed it on the 5 m DEM, before the reroute step moved it onto the 1 m ground"},
           "hydro.edges": {"path": WS.EDGES, "kind": "table", "derived_from": ["hydro.channels", "terrain.dem_1m"],
                           "crossings": len(crossings),
                           "encoding": "every stream crossing a tile edge (UTM): side, along, x, y, dir in/out, tangent, name, fcode, "
                                       "order, area_km2, width, bed_width, level, depth, half_width (the water step's), source own "
                                       "or neighbour <id> (pipeline/water_seams.py)"},
           "client.channel_depth": {"path": "client/channel_depth.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                                    "pixels": ctx.n, "resolution_m": ctx.res, "derived_from": ["terrain.dem", "hydro.channels"],
                                    "encoding": "uint8 decimetres: mean DEM on a 20 m ring minus the channel cell, clamped 0-25 m, x10; 0 off channel "
                                                "(channel cells: the rerouted lines rasterised on the 5 m grid)"}}
    if feats_layer:
        out["client.features"] = feats_layer
    return out, stats


def write_profile_fine(tile: Tile, ctx, dem: FineDEM) -> dict:
    """client/channel_profile.png R and G from the rerouted lines and the 1 m long profile; B (the rewilded beds) kept."""
    from .rewild_hydro import write_profile
    p = tile.path("client/channel_profile.png")
    keep_b = np.asarray(Image.open(p).convert("RGB"))[:, :, 2].copy() if p.exists() else None
    return write_profile(ctx, None, [], [], zat=lambda x, y: dem.at(x, y), keep_b=keep_b)


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tile", required=True)
    a = ap.parse_args(argv)
    from .config import Tile
    out, stats = reroute(Tile.from_id(a.tile))
    print(json.dumps(stats, indent=1)[:3000])


if __name__ == "__main__":
    main()
