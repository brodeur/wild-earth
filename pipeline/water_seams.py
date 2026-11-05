"""Streams that continue across a tile seam, and meltwater from the permanent ice: the reroute step's last passes over
the rerouted lines, and the water step's levels where a stream crosses an edge.

Seams. Tiles sit on whole kilometres, so a stream that leaves one tile enters its neighbour on the same edge line. Each
tile routes, clips and reroutes its own network, so on its own each side would end the stream a few metres from the
other's, 20 m inside the edge, with another order, width, level or bank. Every stream crossing a tile edge is recorded
in hydro/edges.json (`crossings`, UTM metres in the tile's zone):

  side, along     the edge (west, east, south, north) and the position along it (northing on west/east, easting on
                  south/north); x, y the crossing point on the edge line itself
  dir             "in" (the stream enters this tile there) or "out"
  tangent         the flow direction at the edge (unit, east/north), the line's last LEAD_M straight along it
  name, fcode, order, area_km2, width, bed_width   the reach's identity at the edge
  level, depth, half_width                         the water surface, thalweg depth and half width at the edge (the
                  water step fills them in)
  source          "own", or "neighbour <tile id>" when adopted

The first tile built decides; a neighbour built later adopts. When a built neighbour's hydro/edges.json has a crossing
on the shared edge within EDGE_TOL_M of one of ours (the other way round: its out is our in), ours takes its point,
tangent, name, fcode, area, width, level and depth, and the higher of the two orders. A higher order here than there is
recorded (`order_over_neighbour`); the seams step then asks for the neighbour's reroute and water to run again, which
adopts it back. Crossings of the neighbour's that flow into this tile with no stream of ours near them start an inflow
here, traced down the whole tile's 5 m flow directions to the network. Without a built neighbour the crossing is our
own: the line's end carried straight on to the edge, then to the lowest 1 m ground along the edge within
clip(0.75 widths, 3, 15) m. Either way the line is cut back to the last vertex STRAIGHT_M from the edge and runs
straight from there to the crossing point.

In the water step (stream_samples), each crossing reach's level is moved to the recorded level at the edge, the move
fading to nothing over LEVEL_BLEND_M along the reach (then non-increasing again), the thalweg depth likewise, and the
half width eases to exactly width / 2 at the edge (the wander and riffle swell off), so the bed, the wet margin, the
bank and the riparian zones meet the neighbour's at the same place, width and height.

Ice. terrain/ice.tif (the ice step: LANDFIRE Snow-Ice and OSM glaciers) with NHD's Ice Mass waterbodies (FType 378)
is the ice. A stretch of line on the ice (runs shorter than ICE_RUN_M ignored) is kept as a feature with `on_ice` and
not drawn: there is no open stream on a glacier surface at this scale, and the routed line across it is the ice's
drainage, not water. The line below the ice starts at the toe and is `meltwater` (perennial, `glacier` the ice mass's
name). Then the whole tile is routed on the 5 m DEM (breached priority flood to the border), the ice area carried down
the flow directions: every first cell off the ice that MELT_ICE_KM2 or more of ice drains through starts a meltwater
stream, traced down to the network (or the border). A head whose trace meets a drawn stream within MELT_MIN_RUN_M
adds no line: that stream is tagged as fed by the glacier. Meltwater lines and the streams they feed are perennial.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from numba import njit
from scipy import ndimage
from shapely.geometry import LineString, Point, shape
from shapely.ops import substring
from shapely.strtree import STRtree

from .config import TILE_SIZE_M, Tile, write_json

EDGES = "hydro/edges.json"
EDGE_NEAR_M = 40.0       # a free line end within this of a tile edge may be a crossing
EDGE_TOL_M = 60.0        # a neighbour's crossing within this along the edge is the same stream
INFLOW_KM2 = 0.3         # a head near an edge is a stream coming in when it drains at least this (a fresh head drains 0.15)
STRAIGHT_M = 12.0        # the line runs straight for its last this-many metres to the crossing
LEAD_M = 6.0             # ... the last of them along the crossing's tangent when adopted
OWN_R_M = (3.0, 15.0)    # an own crossing: the lowest edge ground within clip(0.75 widths, these) of the carried-on line
JOIN_HIT_M = 3.0         # a line end this close to another line is joined to it (not free)
LEVEL_BLEND_M = 60.0     # the level, depth and width move to the edge's over this far along the reach
LEVEL_FADE = 0.05        # ... the level's move fading no faster than this per metre
ICE_RUN_M = 10.0         # on-ice and off-ice runs along a line shorter than this are absorbed
MELT_ICE_KM2 = 0.05      # ice area through a cell off the ice that starts a meltwater stream
MELT_MIN_RUN_M = 25.0    # ... unless its trace meets a drawn stream within this (that stream is tagged instead)
TRACE_LIMIT_M = 8000.0
TRACE_SMOOTH_M = 8.0     # a 5 m trace's staircase smoothed over this (gaussian sigma) before centring
BETWEEN_ICE_M = 150.0    # an off-ice run shorter than this with ice at both ends stays under the ice
ICE_FTYPE = 378
PERENNIAL = 46006
CANAL = 33600
SIDES = ("west", "east", "south", "north")
OPP = {"west": "east", "east": "west", "south": "north", "north": "south"}
OUTWARD = {"west": (-1.0, 0.0), "east": (1.0, 0.0), "south": (0.0, -1.0), "north": (0.0, 1.0)}
S_M = TILE_SIZE_M


# ---------------------------------------------------------------------------
# Edge geometry (tile-local metres: x east from the west edge, north from the south edge)
# ---------------------------------------------------------------------------

def edge_dist(x, y, side):
    return {"west": x, "east": S_M - x, "south": y, "north": S_M - y}[side]


def nearest_side(x, y):
    d = {s: edge_dist(x, y, s) for s in SIDES}
    s = min(d, key=d.get)
    return s, float(d[s])


def _along_local(x, y, side):
    return y if side in ("west", "east") else x


def _edge_point(a_local, side):
    return {"west": (0.0, a_local), "east": (S_M, a_local), "south": (a_local, 0.0), "north": (a_local, S_M)}[side]


def _unit(v):
    v = np.asarray(v, "float64")
    n = float(np.hypot(*v))
    return v / n if n > 1e-9 else np.array([0.0, 0.0])


# ---------------------------------------------------------------------------
# The whole tile's 5 m flow (for meltwater and inflows)
# ---------------------------------------------------------------------------

@njit(cache=True)
def accumulate_w(parent, order, n_done, w, acc):
    """Weighted accumulation down the flow directions: acc = w summed over every cell draining through (itself too)."""
    for k in range(n_done):
        acc[order[k]] = w[order[k]]
    for k in range(n_done - 1, -1, -1):
        c = order[k]
        p = parent[c]
        if p >= 0:
            acc[p] += acc[c]


class Flow5:
    """The 5 m DEM (rewilded when there is one) routed to the tile border by the reroute step's breaching flood."""

    def __init__(self, tile: Tile):
        from .reroute import flood
        p = tile.path("terrain/dem_rewilded.tif")
        p = p if p.exists() else tile.path("terrain/dem.tif")
        with rasterio.open(p) as src:
            z = src.read(1).astype("float64")
            nod = src.nodata
        bad = ~np.isfinite(z) | ((z == nod) if nod is not None else False)
        if bad.any():
            z[bad] = float(np.nanmean(np.where(bad, np.nan, z)))
        self._build(z)

    @classmethod
    def from_array(cls, z: np.ndarray) -> "Flow5":
        f = cls.__new__(cls)
        f._build(np.asarray(z, "float64"))
        return f

    def _build(self, z: np.ndarray):
        from .reroute import flood
        self.n = n = z.shape[0]
        self.res = S_M / n
        zc = z.astype("float32").ravel().copy()
        border = np.zeros((n, n), bool)
        border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
        self.parent = np.full(zc.size, -2, np.int64)
        self.order = np.empty(zc.size + 1, np.int64)
        lab = np.zeros(zc.size, np.int32)
        adj = np.ones((1, 1), np.bool_)
        self.n_done = flood(zc, np.ones(zc.size, np.bool_), lab, adj, self.parent, self.order, 0,
                            np.flatnonzero(border.ravel()).astype(np.int64), n, n)
        self.zc = zc

    def acc(self, w: np.ndarray) -> np.ndarray:
        out = np.zeros(self.n * self.n, np.float64)
        accumulate_w(self.parent, self.order, self.n_done, np.asarray(w, np.float64).ravel(), out)
        return out

    def cell(self, x, y):
        n, r = self.n, self.res
        c = int(np.clip(x // r, 0, n - 1))
        q = int(np.clip((S_M - y) // r, 0, n - 1))
        return q * n + c

    def xy(self, cells):
        r, c = np.divmod(np.asarray(cells, np.int64), self.n)
        return np.column_stack([(c + 0.5) * self.res, S_M - (r + 0.5) * self.res])

    def trace(self, start: int, hit: np.ndarray, limit_m=TRACE_LIMIT_M, skip_hit_cells=0, stop=None):
        """The flow path from `start` to the first cell of `hit` (flat bool; the first skip_hit_cells cells may be
        on it without stopping), or to the border. A cell of `stop` (flat bool) ends it unreached. Returns (cells,
        the hit cell, or -1 at the border, or -2 stopped)."""
        path, c = [start], start
        for k in range(int(limit_m / self.res)):
            if hit[c] and k >= skip_hit_cells:
                return path, c
            if stop is not None and k > 0 and stop[c]:
                return path[:-1], -2
            p = int(self.parent[c])
            if p < 0:
                return path, -1
            path.append(p)
            c = p
        return path, -1


# ---------------------------------------------------------------------------
# Items: the channel features as local lines, drawn or not
# ---------------------------------------------------------------------------

def _drawn(pr) -> bool:
    return not pr.get("on_ice") and not pr.get("in_waterbody") and pr.get("fcode") != CANAL


def _is_line(it) -> bool:
    return it["line"] is not None and it["line"].geom_type == "LineString" and it["line"].length >= 1.0


def _downstream(items: list[dict], i: int) -> int | None:
    """The drawn line item i flows into: the biggest one passing within JOIN_HIT_M of its end and running on past it."""
    E = Point(items[i]["line"].coords[-1])
    best, ba = None, -1.0
    for j, it in enumerate(items):
        if j == i or not _is_line(it) or not _drawn(it["pr"]):
            continue
        ln = it["line"]
        if ln.distance(E) > JOIN_HIT_M:
            continue
        if ln.length - ln.project(E) < JOIN_HIT_M:   # it ends here too: a sibling, not the receiving stream
            continue
        a = float(it["pr"].get("area_km2") or 0)
        if a > ba:
            best, ba = j, a
    return best


def _walk_down(items, i, fn, limit=2000):
    seen = {i}
    j = _downstream(items, i)
    while j is not None and j not in seen and len(seen) < limit:
        if fn(items[j]) is False:
            break
        seen.add(j)
        j = _downstream(items, j)
    return len(seen) - 1


# ---------------------------------------------------------------------------
# Ice
# ---------------------------------------------------------------------------

def ice_mask(tile: Tile, ctx) -> tuple[np.ndarray | None, list]:
    """(the 5 m ice mask: terrain/ice.tif or NHD Ice Mass, None without either; the NHD ice masses as (polygon, name))."""
    m = None
    p = tile.path("terrain/ice.tif")
    if p.exists():
        with rasterio.open(p) as src:
            m = src.read(1) > 0
        if m.shape != (ctx.n, ctx.n):
            m = ndimage.zoom(m.astype("uint8"), ctx.n / m.shape[0], order=0) > 0
    masses = []
    for f in ctx.load("hydro/waterbodies.geojson") or []:
        pr = f["properties"]
        if str(pr.get("ftype")) == str(ICE_FTYPE):
            g = ctx.local(shape(f["geometry"]))
            if not g.is_valid:
                g = g.buffer(0)
            masses.append((g, pr.get("gnis_name")))
    if masses:
        r = ctx.rasterize([g for g, _ in masses]).astype(bool)
        m = r if m is None else (m | r)
    if m is not None and not m.any():
        m = None
    return m, masses


def _glacier_name(masses, x, y, r=150.0):
    pt = Point(x, y)
    best, bd = None, r
    for g, name in masses:
        if not name:
            continue
        d = g.distance(pt)
        if d <= bd:
            best, bd = name, d
    return best


def _clean_runs(on: np.ndarray, k: int) -> np.ndarray:
    """Absorb runs shorter than k samples: lone ice on rock first, then lone rock in the ice."""
    on = on.copy()
    for val in (True, False):
        i = 0
        while i < len(on):
            j = i
            while j < len(on) and on[j] == on[i]:
                j += 1
            if on[i] == val and (j - i) < k and i > 0 and j < len(on):
                on[i:j] = not val
            i = j
    return on


def clip_ice(items: list[dict], ice: np.ndarray, res: float, masses: list) -> dict:
    """Split every line at the ice's edge: on-ice pieces `on_ice` (not drawn), the piece leaving the ice `meltwater`."""
    n = ice.shape[0]
    out, split, whole = [], 0, 0
    step = 2.5
    for it in items:
        if not _is_line(it) or it["pr"].get("fcode") == CANAL:
            out.append(it)
            continue
        ln = it["line"]
        L = ln.length
        ds = np.arange(0.0, L + 1e-6, step)
        pts = np.array([ln.interpolate(d).coords[0] for d in ds])
        c = np.clip((pts[:, 0] // res).astype(int), 0, n - 1)
        r = np.clip(((S_M - pts[:, 1]) // res).astype(int), 0, n - 1)
        on = ice[r, c]
        if not on.any():
            out.append(it)
            continue
        on = _clean_runs(on, int(ICE_RUN_M / step))
        if not on.any():
            out.append(it)
            continue
        if on.all():
            it["pr"] = {**it["pr"], "on_ice": True}
            out.append(it)
            whole += 1
            continue
        # the runs, as distances along the line
        bounds = [0] + [i for i in range(1, len(on)) if on[i] != on[i - 1]] + [len(on)]
        for a, b in zip(bounds[1:-2], bounds[2:-1]):   # inner off-ice runs, ice either side
            if not on[a] and (b - a) * step < BETWEEN_ICE_M:
                on[a:b] = True
        bounds = [0] + [i for i in range(1, len(on)) if on[i] != on[i - 1]] + [len(on)]
        if len(bounds) == 2:
            it["pr"] = {**it["pr"], "on_ice": True}
            out.append(it)
            whole += 1
            continue
        prev_ice = False
        for a, b in zip(bounds[:-1], bounds[1:]):
            d0 = ds[a] if a > 0 else 0.0
            d1 = ds[b] if b < len(ds) else L
            if d1 - d0 < 1.0:
                continue
            g = substring(ln, d0, d1)
            if g.geom_type != "LineString":
                continue
            pr = dict(it["pr"])
            if on[a]:
                pr["on_ice"] = True
            elif prev_ice:
                x, y = g.coords[0]
                pr.update(meltwater=True, glacier=_glacier_name(masses, x, y), fcode=PERENNIAL)
            pr["length_m"] = round(g.length, 1)
            out.append({**it, "line": g, "pr": pr})
            prev_ice = bool(on[a])
        split += 1
    items[:] = out
    return {"lines_split_at_ice": split, "lines_on_ice": whole + split,
            "on_ice_km": round(sum(it["line"].length for it in items if _is_line(it) and it["pr"].get("on_ice")) / 1000, 2)}


def _hit_raster(items, ctx, grow=1) -> np.ndarray:
    geoms = [it["line"] for it in items if _is_line(it) and not it["pr"].get("on_ice") and it["pr"].get("fcode") != CANAL]
    r = ctx.rasterize(geoms).astype(bool)
    if grow:
        r = ndimage.binary_dilation(r, iterations=grow)
    return r


def _new_line(flow: Flow5, cells, dem, width, head_xy=None, join_to: LineString | None = None):
    """A 5 m trace as a line on the lowest 1 m ground: from head_xy (when given) down the cells, onto join_to."""
    from .reroute import SIMPLIFY_M, shape_line
    from .reroute import _gsmooth, _resample
    xy = flow.xy(cells)
    if head_xy is not None:
        xy = np.vstack([np.asarray(head_xy, "float64")[None, :], xy])
    if len(xy) >= 3:
        # the 5 m flow directions step in eights: a long planar slope comes out a staircase; smoothed over
        # TRACE_SMOOTH_M first, then centred on the low ground like every rerouted line
        p = shape_line(_gsmooth(_resample(xy, 1.0), TRACE_SMOOTH_M), dem, width)
    else:
        p = xy
    if head_xy is not None:
        p[0] = head_xy
    if join_to is not None:
        q = join_to.interpolate(join_to.project(Point(p[-1])))
        p = np.vstack([p, [[q.x, q.y]]])
    ln = LineString(p)
    return ln.simplify(max(SIMPLIFY_M, 0.08 * width)) if len(p) > 2 else ln


def meltwater(items: list[dict], ice: np.ndarray, masses: list, flow: Flow5, dem, ctx) -> dict:
    """Streams from the ice's toes: every first cell off the ice draining MELT_ICE_KM2 of ice or more."""
    from .channels import bed_width, water_width
    n, res = flow.n, flow.res
    cell_km2 = res * res / 1e6
    ice_f = ice.ravel()
    a_ice = flow.acc(ice_f * cell_km2)
    a_tot = flow.acc(np.full(n * n, cell_km2))
    big = ~ice_f & (a_ice >= MELT_ICE_KM2)
    # heads: cells of `big` none of whose donors is in `big`
    donors = flow.parent >= 0
    src = np.flatnonzero(donors & big)
    fed = np.zeros(n * n, bool)
    fed[flow.parent[src]] = True
    heads = np.flatnonzero(big & ~fed)
    heads = heads[np.argsort(-a_ice[heads])]
    hit = _hit_raster(items, ctx).ravel()
    added, tagged, at_border, back_on_ice = 0, set(), 0, 0
    lines_by_cell = None
    for h in heads:
        path, hc = flow.trace(int(h), hit, stop=ice_f)
        run = (len(path) - 1) * res
        if hc == -2:      # back onto the ice (a rock island in the glacier): under the ice again, no stream
            back_on_ice += 1
            continue
        x, y = flow.xy([h])[0]
        name = _glacier_name(masses, x, y)
        if hc >= 0:
            # the stream it meets
            hx, hy = flow.xy([hc])[0]
            P = Point(hx, hy)
            cand = [(it["line"].distance(P), j) for j, it in enumerate(items)
                    if _is_line(it) and not it["pr"].get("on_ice") and it["pr"].get("fcode") != CANAL]
            dj, j = min(cand) if cand else (np.inf, None)
            if run < MELT_MIN_RUN_M and j is not None:
                tagged.add(j)
                pr = items[j]["pr"]
                if not pr.get("glacier"):
                    pr["glacier"] = name
                continue
            join_to = items[j]["line"] if j is not None and dj < 4 * res else None
            cells = path[:-1] if len(path) > 1 else path
        else:
            if run < MELT_MIN_RUN_M:
                continue
            join_to, cells, j = None, path, None
            at_border += 1
        area = float(a_tot[path[-1]])
        w = water_width(area)
        ln = _new_line(flow, cells, dem, w, join_to=join_to)
        if ln.length < MELT_MIN_RUN_M:
            continue
        pr = {"name": None, "fcode": PERENNIAL, "order": 1, "area_km2": round(area, 4), "source": "dem",
              "nhd_matched": False, "width": round(w, 2), "bed_width": round(bed_width(w), 2), "in_waterbody": False,
              "length_m": round(ln.length, 1), "rerouted": "meltwater", "meltwater": True, "glacier": name,
              "ice_km2": round(float(a_ice[h]), 3)}
        items.append({"line": ln, "pr": pr, "k": None})
        if j is not None:
            tagged.add(j)
        # later heads stop at this one
        r = ctx.rasterize([ln]).astype(bool)
        hit |= ndimage.binary_dilation(r, iterations=1).ravel()
        added += 1
    # the streams the ice feeds run all year: the tagged ones and every one below them
    fed_lines = 0

    def perennial(it):
        nonlocal fed_lines
        if it["pr"].get("fcode") != PERENNIAL:
            it["pr"]["fcode"] = PERENNIAL
            it["pr"]["fed_by_ice"] = True
            fed_lines += 1
    starts = list(tagged) + [i for i, it in enumerate(items) if it["pr"].get("meltwater")]
    for j in starts:
        it = items[j]
        if not _is_line(it):
            continue
        it["pr"]["meltwater"] = True
        if it["pr"].get("fcode") != PERENNIAL:
            it["pr"]["fcode"] = PERENNIAL
            it["pr"]["fed_by_ice"] = True
            fed_lines += 1
        _walk_down(items, j, perennial)
    return {"heads": int(heads.size), "lines_added": added, "streams_tagged": len(tagged), "to_border": at_border,
            "back_on_ice": back_on_ice,
            "made_perennial": fed_lines, "melt_ice_km2": MELT_ICE_KM2,
            "ice_km2": round(float(ice_f.sum()) * cell_km2, 2)}


# ---------------------------------------------------------------------------
# Seams
# ---------------------------------------------------------------------------

def neighbour_crossings(tile: Tile) -> dict:
    """{side: (neighbour tile id, [its crossings on the shared edge])} for every built neighbour with hydro/edges.json."""
    from .seams import neighbours
    out = {}
    for side, nb in neighbours(tile):
        p = nb.dir / EDGES
        if not p.exists():
            continue
        try:
            recs = json.loads(p.read_text()).get("crossings", [])
        except Exception:  # noqa: BLE001
            continue
        out[side] = (nb.tile_id, [r for r in recs if r.get("side") == OPP[side]])
    return out


def _own_point(dem, side, q, width):
    """The lowest 1 m ground along the edge (0.5 m in) within clip(0.75 widths, OWN_R_M) of q (the local along)."""
    R = float(np.clip(0.75 * width, *OWN_R_M))
    a = np.clip(np.arange(q - R, q + R + 1e-6, 0.5), 0.5, S_M - 0.5)
    inner = {"west": 0.5, "east": S_M - 0.5, "south": 0.5, "north": S_M - 0.5}[side]
    if side in ("west", "east"):
        g = dem.at(np.full(a.size, inner), a)
    else:
        g = dem.at(a, np.full(a.size, inner))
    g = ndimage.gaussian_filter1d(g.astype("float64"), 2.0, mode="nearest")
    k = np.flatnonzero(g <= g.min() + 1e-3)
    k = k[np.argmin(np.abs(a[k] - q))]
    return float(a[k])


def _set_end(p: np.ndarray, X, side, at_start: bool, tangent=None) -> np.ndarray:
    """The line (downstream order) with the end at the edge cut back to STRAIGHT_M off it and run straight to X (the
    last LEAD_M along `tangent`, the flow direction, when given)."""
    q = p[::-1].copy() if at_start else p.copy()
    d = np.array([edge_dist(x, y, side) for x, y in q])
    j = len(q)
    while j > 1 and d[j - 1] < STRAIGHT_M:
        j -= 1
    q = q[:j]
    tail = []
    if tangent is not None:
        t = np.asarray(tangent, "float64") * (-1.0 if at_start else 1.0)   # travel toward the edge
        A = np.asarray(X) - t * LEAD_M
        if edge_dist(A[0], A[1], side) > 0.5 and np.hypot(*(A - q[-1])) > 1.0 and \
                0 <= A[0] <= S_M and 0 <= A[1] <= S_M:
            tail.append(A)
    tail.append(np.asarray(X, "float64"))
    q = np.vstack([q, np.array(tail)])
    return q[::-1] if at_start else q


def _theirs(rec: dict, r: dict) -> None:
    """The neighbour's own level and depth at the crossing (before it met ours), for the shared level."""
    rec["level_theirs"] = r.get("level_own") if r.get("level_own") is not None else r.get("level")
    rec["depth_theirs"] = r.get("depth_own") if r.get("depth_own") is not None else r.get("depth")
    rec["seen_neighbour"] = True


def _crossing_record(it, side, X, x0, y0, direction, tangent, source):
    pr = it["pr"]
    return {"side": side, "along": round(float(_along_local(X[0], X[1], side) + (y0 if side in ("west", "east") else x0)), 2),
            "x": round(float(X[0] + x0), 2), "y": round(float(X[1] + y0), 2), "dir": direction,
            "tangent": [round(float(tangent[0]), 4), round(float(tangent[1]), 4)],
            "name": pr.get("name"), "fcode": pr.get("fcode"), "order": int(pr.get("order") or 1),
            "area_km2": pr.get("area_km2"), "width": pr.get("width"), "bed_width": pr.get("bed_width"),
            "level": None, "depth": None, "half_width": None, "level_own": None, "depth_own": None,
            "level_theirs": None, "depth_theirs": None, "seen_neighbour": False, "source": source}


def seams_pass(tile: Tile, ctx, dem, items: list[dict], flow_fn) -> tuple[list, dict]:
    """Find every crossing, adopt a built neighbour's or make our own, reshape the lines' ends onto the edge, start
    the neighbour's inflows we lack. Returns (crossing records, stats)."""
    from .channels import bed_width
    x0, y0 = tile.bounds[0], tile.bounds[1]
    nbs = neighbour_crossings(tile)
    # drop the zero-length junk (a border cell's own reach)
    before = len(items)
    items[:] = [it for it in items if not (it["line"] is not None and it["line"].geom_type == "LineString"
                                           and it["line"].length < 1.0)]
    dropped = before - len(items)
    drawn = [i for i, it in enumerate(items) if _is_line(it) and _drawn(it["pr"])]
    tree = STRtree([items[i]["line"] for i in drawn])
    cands = []
    for k, i in enumerate(drawn):
        ln, pr = items[i]["line"], items[i]["pr"]
        for at_start in (True, False):
            P = ln.coords[0] if at_start else ln.coords[-1]
            side, de = nearest_side(*P)
            if de > EDGE_NEAR_M:
                continue
            near = [drawn[j] for j in tree.query(Point(P).buffer(JOIN_HIT_M)) if drawn[j] != i
                    and items[drawn[j]]["line"].distance(Point(P)) <= JOIN_HIT_M]
            if near:
                continue
            cands.append({"i": i, "at_start": at_start, "side": side, "P": np.array(P), "dir": "in" if at_start else "out",
                          "area": float(pr.get("area_km2") or 0)})
    recs, used = [], set()
    adopted = own = inflows = order_over = 0
    unmatched_theirs = []
    # match each candidate to the neighbour's crossings (theirs out = ours in), nearest first, same name preferred
    pairs = []
    for ci, c in enumerate(cands):
        if c["side"] not in nbs:
            continue
        a_here = _along_local(*c["P"], c["side"]) + (y0 if c["side"] in ("west", "east") else x0)
        for ri, r in enumerate(nbs[c["side"]][1]):
            if r.get("dir") == c["dir"]:
                continue
            d = abs(r["along"] - a_here)
            if d <= EDGE_TOL_M:
                same = (r.get("name") or None) == (items[c["i"]]["pr"].get("name") or None)
                pairs.append((d - (30.0 if same else 0.0), ci, ri))
    pairs.sort()
    match = {}
    for _, ci, ri in pairs:
        if ci in match or (cands[ci]["side"], ri) in used:
            continue
        match[ci] = ri
        used.add((cands[ci]["side"], ri))
    for ci, c in enumerate(cands):
        it = items[c["i"]]
        pr = it["pr"]
        side, at_start = c["side"], c["at_start"]
        p = np.asarray(it["line"].coords, "float64")
        if ci in match:
            tid, theirs = nbs[side]
            r = theirs[match[ci]]
            X = (r["x"] - x0, r["y"] - y0)
            t = np.asarray(r["tangent"], "float64")
            mine = int(pr.get("order") or 1)
            order = max(mine, int(r.get("order") or 1))
            pr.update(name=r.get("name"), fcode=r.get("fcode"), area_km2=r.get("area_km2"), width=r.get("width"),
                      bed_width=r.get("bed_width"), order=order)
            p = _set_end(p, X, side, at_start, t)
            rec = _crossing_record(it, side, X, x0, y0, c["dir"], t, f"neighbour {tid}")
            _theirs(rec, r)
            if order > int(r.get("order") or 1):
                rec["order_over_neighbour"] = True
                order_over += 1
            adopted += 1
        else:
            if at_start and c["area"] < INFLOW_KM2:
                continue    # a fresh head that happens to sit near the edge
            # carried on: the direction over the last 15 m
            ln = it["line"]
            if at_start:
                Pin = np.asarray(ln.interpolate(min(15.0, ln.length)).coords[0])
            else:
                Pin = np.asarray(ln.interpolate(max(0.0, ln.length - 15.0)).coords[0])
            P = c["P"]
            dvec = _unit(P - Pin)
            nrm = np.asarray(OUTWARD[side])
            de = edge_dist(P[0], P[1], side)
            cosang = float(dvec @ nrm)
            Q = P + dvec * (de / cosang) if cosang > 0.3 else P + nrm * de
            q = float(np.clip(_along_local(Q[0], Q[1], side), 0.5, S_M - 0.5))
            X = _edge_point(round(_own_point(dem, side, q, float(pr.get("width") or 2.0)), 2), side)   # cm: as recorded
            p = _set_end(p, X, side, at_start)
            t = _unit(p[1] - p[0]) if at_start else _unit(p[-1] - p[-2])
            rec = _crossing_record(it, side, X, x0, y0, c["dir"], t, "own")
            own += 1
        if side in nbs:
            rec["neighbour"] = nbs[side][0]
        it["line"] = LineString(p)
        pr["length_m"] = round(it["line"].length, 1)
        pr["crossing"] = f"{side}:{rec['dir']}"
        recs.append(rec)
        if at_start and ci in match:
            o = pr["order"]
            _walk_down(items, c["i"], lambda d: d["pr"].__setitem__("order", max(int(d["pr"].get("order") or 1), o)))
    # their streams flowing into us with no stream of ours near: an inflow, traced down our 5 m flow to the network
    flow = None
    for side, (tid, theirs) in nbs.items():
        for ri, r in enumerate(theirs):
            if (side, ri) in used or r.get("dir") != "out":
                continue
            X = np.array([r["x"] - x0, r["y"] - y0])
            if flow is None:
                flow = flow_fn()
                hit = _hit_raster(items, ctx).ravel()
            t_in = np.asarray(r.get("tangent") or (-np.asarray(OUTWARD[side])), "float64")
            if float(t_in @ -np.asarray(OUTWARD[side])) < 0.3:
                t_in = -np.asarray(OUTWARD[side])
            for k_in in (1.5, 3.5, 6.5):     # the border column drains out of the tile: start a cell or more in
                inner = X + _unit(t_in) * (flow.res * k_in)
                path, hc = flow.trace(flow.cell(*inner), hit)
                run = (len(path) - 1) * flow.res
                if hc >= 0 or run >= 30.0:
                    break
            if run < 30.0 and hc < 0:
                unmatched_theirs.append({"along": r["along"], "name": r.get("name"), "order": r.get("order"), "why": "leaves again"})
                continue
            j = None
            if hc >= 0:
                P = Point(*flow.xy([hc])[0])
                cand = [(items[i]["line"].distance(P), i) for i in range(len(items))
                        if _is_line(items[i]) and _drawn(items[i]["pr"])]
                if cand:
                    dj, j = min(cand)
            w = float(r.get("width") or 2.0)
            ln = _new_line(flow, path[:-1] if hc >= 0 and len(path) > 1 else path, dem, w, head_xy=X,
                           join_to=items[j]["line"] if j is not None else None)
            p = _set_end(np.asarray(ln.coords, "float64"), tuple(X), side, True, r.get("tangent"))
            ln = LineString(p)
            pr = {"name": r.get("name"), "fcode": r.get("fcode"), "order": int(r.get("order") or 1),
                  "area_km2": r.get("area_km2"), "source": "dem", "nhd_matched": bool(r.get("name")), "width": w,
                  "bed_width": r.get("bed_width") or round(bed_width(w), 2), "in_waterbody": False,
                  "length_m": round(ln.length, 1), "rerouted": "inflow", "crossing": f"{side}:in"}
            items.append({"line": ln, "pr": pr, "k": None})
            rec = _crossing_record(items[-1], side, tuple(X), x0, y0, "in", r.get("tangent") or [0, 0], f"neighbour {tid}")
            _theirs(rec, r)
            rec["neighbour"] = tid
            recs.append(rec)
            hit |= ndimage.binary_dilation(ctx.rasterize([ln]).astype(bool), iterations=1).ravel()
            o = pr["order"]
            _walk_down(items, len(items) - 1, lambda d: d["pr"].__setitem__("order", max(int(d["pr"].get("order") or 1), o)))
            inflows += 1
    # their streams that expect water from us where we have none
    for side, (tid, theirs) in nbs.items():
        for ri, r in enumerate(theirs):
            if (side, ri) not in used and r.get("dir") == "in":
                unmatched_theirs.append({"along": r["along"], "name": r.get("name"), "order": r.get("order"),
                                         "why": "their inflow has no stream on this side"})
    recs.sort(key=lambda r: (r["side"], r["along"]))
    stats = {"crossings": len(recs), "adopted": adopted, "own": own, "inflows_started": inflows,
             "order_over_neighbour": order_over, "zero_length_dropped": dropped,
             "neighbours_with_edges": {s: v[0] for s, v in nbs.items()}, "unmatched_neighbour": unmatched_theirs[:20]}
    return recs, stats


def write_edges(tile: Tile, recs: list, stats: dict) -> None:
    write_json(tile.path(EDGES), {"tile": tile.tile_id, "crs": tile.crs, "crossings": recs, "stats": stats,
                                  "note": "streams crossing the tile's edges (pipeline/water_seams.py): the first tile "
                                          "built decides, a neighbour built later adopts"})


# ---------------------------------------------------------------------------
# The water step: the levels at the edges
# ---------------------------------------------------------------------------

def _crossing_ends(S: dict, tile: Tile):
    """[(record index, record, reach id, sample index at the edge)] for each crossing with a drawn reach end on it."""
    p = tile.path(EDGES)
    if not p.exists() or S["x"].size == 0:
        return [], []
    recs = json.loads(p.read_text()).get("crossings", [])
    # the neighbour's own level and depth as they are now (its water step may have run since our reroute copied them)
    try:
        nbs = neighbour_crossings(tile)
    except Exception:  # noqa: BLE001
        nbs = {}
    for r in recs:
        if r["side"] in nbs:
            for o in nbs[r["side"]][1]:
                if o.get("dir") != r["dir"] and abs(o["along"] - r["along"]) < 1.0:
                    _theirs(r, o)
                    break
    x0, y0 = tile.bounds[0], tile.bounds[1]
    reach = S["reach"].astype(int)
    brk = np.flatnonzero(np.diff(reach) != 0)
    first = np.concatenate([[0], brk + 1])
    last = np.concatenate([brk, [reach.size - 1]])
    out = []
    for k, r in enumerate(recs):
        X = np.array([r["x"] - x0, r["y"] - y0])
        idx = first if r["dir"] == "in" else last
        d = np.hypot(S["x"][idx] - X[0], S["y"][idx] - X[1])
        j = int(np.argmin(d))
        if d[j] <= 2.0:
            out.append((k, r, int(reach[idx[j]]), int(idx[j])))
    return recs, out


def edge_levels(S: dict, tile: Tile) -> dict:
    """Move each crossing reach's level, depth and half width to the edge's (in place; see the module doc). The
    shared level at a crossing is the mean of the two tiles' own levels there (each side's ground at the edge differs
    by the ground's own step across the seam, metres on a steep creek); each side moves to it fading over
    max(LEVEL_BLEND_M, the move / LEVEL_FADE) along its reach. Each side's own level is kept for record_levels."""
    from .water import MIN_DEPTH_M
    recs, ends = _crossing_ends(S, tile)
    if not recs:
        return {"crossings": 0}
    reach = S["reach"].astype(int)
    moved, most, steps = 0, 0.0, []
    own = {}
    for k, r, rid, i in ends:
        sl = np.flatnonzero(reach == rid)
        s = S["s"][sl]
        from_edge = (s - s[0]) if r["dir"] == "in" else (s[-1] - s)
        L_own, D_own = float(S["L"][i]), float(S["D"][i])
        own[k] = (L_own, D_own)
        w = np.clip(1.0 - from_edge / LEVEL_BLEND_M, 0.0, 1.0)
        half = S["width"][sl] / 2
        S["wh"][sl] = half + (S["wh"][sl] - half) * (1 - w)
        if r.get("level_theirs") is not None:
            target = 0.5 * (L_own + float(r["level_theirs"]))
            dL = target - L_own
            steps.append(abs(float(r["level_theirs"]) - L_own))
            wl = np.clip(1.0 - from_edge / max(LEVEL_BLEND_M, abs(dL) / LEVEL_FADE), 0.0, 1.0)
            L = S["L"][sl] + dL * wl
            L = np.minimum.accumulate(L) if r["dir"] == "in" else np.maximum.accumulate(L[::-1])[::-1]
            S["L"][sl] = L
            moved += 1
            most = max(most, abs(dL))
            if r.get("depth_theirs") is not None:
                dD = 0.5 * (D_own + float(r["depth_theirs"])) - D_own
                S["D"][sl] = np.maximum(S["D"][sl] + dD * wl, MIN_DEPTH_M)
    S["_edge_own"] = own
    st = np.array(steps)
    return {"crossings": len(recs), "on_reaches": len(ends), "levels_moved": moved, "most_m": round(most, 3),
            "own_level_step_m": {"median": round(float(np.median(st)), 2), "max": round(float(st.max()), 2)} if st.size else None}


def record_levels(tile: Tile, S: dict) -> dict:
    """Write the level, depth and half width at each crossing into hydro/edges.json (the water step, after levels)."""
    recs, ends = _crossing_ends(S, tile)
    if not recs:
        return {"crossings": 0}
    own = S.get("_edge_own", {})
    for k, r, rid, i in ends:
        if k in own:
            r["level_own"], r["depth_own"] = round(own[k][0], 3), round(own[k][1], 3)
        r["level"] = round(float(S["L"][i]), 3)
        r["depth"] = round(float(S["D"][i]), 3)
        r["half_width"] = round(float(S["wh"][i]), 3)
    p = tile.path(EDGES)
    doc = json.loads(p.read_text())
    doc["crossings"] = recs
    write_json(p, doc)
    return {"crossings": len(recs), "levels_recorded": len(ends)}
