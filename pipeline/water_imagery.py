"""Is the drawn water where the imagery shows water? The reverse of water_seasons.py, and the large rivers moved onto it.

Iteration 8 (pipeline/water_seasons.py) asked of every mapped polygon whether the imagery shows water inside it. This
step asks the reverse, per reach: does every drawn channel have water under it, and is there water in the imagery that
nothing draws? On Yellowstone's Lamar Valley the drawn Lamar River follows the 5 m DEM's routed thalweg
(pipeline/channels.py) 20-200 m from the channel NAIP and Sentinel-2 show: the DEM predates the June 2022 flood, and on a
braided gravel bed the D8 route picks an old channel or a terrace swale; the imagery's water was painted as dark ground.

The water, per pixel (seasons/s2_MM.tif, 20 m, the monthly median composites; the same water pixel as water_seasons.py:
NDWI from green and the near infrared recovered from NDVI and red > 0, or NIR < 0.04, bright ice/snow/cloud not
counted). The tiles' imagery/naip.tif is RGB at 2.5 m (no NIR band; on the world tiles it is Sentinel-2's own RGB),
so it is not used for water here.

  frequency   wet months / observed months per pixel (observed: clear in the composite)
  water       frequency >= WATER_FREQ in at least MIN_MONTHS observed months, on ground the 5 m DEM holds under
              FLAT_SLOPE (a shadowed cliff is as dark as water in the near infrared, and water lies flat), not the sea
              (DEM <= SEA_M); bilinear onto the 5 m grid and taken at WATER_FREQ again (the 0.5 contour of a 20 m
              mask: a river is resolved from about half a pixel wide)

The reverse test, per reach (hydro/channels.geojson; the pieces drawn as a kept pond, canals and lines on ice left out):
every SAMPLE_M along the line, is there water within max(w / 2, ON_MIN_M) of it (`on`), and within max(NEAR_MIN_M, 2 w)
(`near`)? A reach is `on water` at on >= ON_SHARE, `off water` when on < ON_SHARE but near >= NEAR_SHARE (the imagery's
water is there, the line misses it), else `no water seen` (narrower than the pixel, under the canopy, a muddy river
whose NDWI stays under 0, or dry in the months observed: the Serengeti's seasonal Seronera). The undrawn water: every
connected patch of imagery water at least UNDRAWN_MIN_M2 that no drawn reach (w / 2 + COVER_M) and no drawn pond
(+ COVER_M) covers, with its area, place, frequency and nearest reach.

The move, for the large rivers only (drawn width >= MOVE_W_M: the imagery resolves them; smaller streams keep the
DEM's routing, which the 20 m pixel cannot judge). The large reaches are cut into stems (the biggest drainage first,
each walked up its biggest large inflow and down to where it joins a bigger stem or leaves). A stem `off water` along
its whole length (on < ON_SHARE, near >= NEAR_SHARE) is traced again through the imagery: the least-cost path on the
5 m grid within CORRIDOR_M of the drawn line, from its upstream end to its downstream end, where a metre of water costs
1 + 2 exp(-d_in / 6 m) (d_in the distance inside the water: the middle of the channel is cheapest) and a metre of land
LAND_COST x (0.4 + 0.6 min(1, d_dem / 30 m)) (d_dem the distance from the DEM's line: through a stretch the imagery
cannot see, the path keeps to the DEM's routing). An end on the tile edge stays put (the seams with the neighbours,
pipeline/water_seams.py, are the edge crossings); an interior end moves to the imagery water within NODE_R_M; a stem
that joins a moved one ends at its new junction. The path is smoothed (SMOOTH_M), the stem cut back into its reaches
at its nodes' projections, and every other reach that meets a moved node is bent to it over a taper (2 x the shift +
20 m). A moved reach takes the imagery's width where the water is resolved wider than drawn (the median cross-section
of the water mask >= RESOLVED_W_M: two pixels): a wide or braided river's water polygon, drawn as the ribbon of its
width. A side channel of a braided river (a patch of the river's water off the moved ribbon, at least SIDE_MIN_M long)
is added as its own reach (`source: imagery`, `anabranch: true`) along the patch's skeleton, at its measured width.

Outputs: hydro/channels.geojson rewritten (`imagery_moved: true`; per reach `imagery_on` before and after, `imagery_moved`,
`imagery_shift_m`, `imagery_width_m`), the lines before the move in hydro/channels_dem.geojson (a rerun starts from
them), the evidence in hydro/water_imagery.json (the rule, per reach and per stem before and after, the undrawn water),
client/channel_profile.png R and G, client/channel_depth.png and client/features.json re-derived as the reroute step
does. Build step `water_imagery`, after `reroute` and `seasons`, before `water`.
"""
from __future__ import annotations

import json
import time

import numpy as np
import rasterio
from scipy import ndimage
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import substring

from .config import TILE_SIZE_M, Tile, write_json
from .water_seasons import BRIGHT_BLUE, BRIGHT_GREEN, _months

WATER_FREQ = 0.5          # a pixel is water when wet in this share of its observed months
MIN_MONTHS = 3            # ... observed in at least this many
FLAT_SLOPE = 0.2          # the DEM's slope (smoothed over 10 m) under this at the pixel: water lies flat
NDWI_Q = 75              # the pixel's NDWI: this percentile over its clear months
BG_BOX_M = 300.0          # the land around it: the mean NDWI of the never-wet pixels within this box
WATER_EM_DEFAULT = 0.3    # open water's NDWI when the tile has fewer than 10 always-wet pixels
SEA_M = 0.5               # DEM at or under this: the sea, not drawn as a channel
SAMPLE_M = 10.0           # reach test spacing
ON_MIN_M = 10.0           # `on`: water within max(w / 2, this) of the line
NEAR_MIN_M = 60.0         # `near`: water within max(this, 2 w)
ON_SHARE = 0.6            # a reach on water: this share of its samples on
NEAR_SHARE = 0.5          # ... off water: under ON_SHARE on, this share near
MOVE_W_M = 10.0           # the large rivers: drawn width at least this (half a 20 m pixel)
MOVE_ON, MOVE_GAIN = 0.5, 0.2   # ... and moved only when the trace is on water over this share of it and gains this
                                # share over the old line
CORRIDOR_M = 600.0        # the re-trace stays within this of the drawn stem
FLOOR_H_M = 10.0          # ... on ground at most this over the drawn line's DEM at its nearest cell (the valley floor: the Lamar's
                          # 2022 channel runs 6-8 m over the DEM's thalweg across its gravel plain)
BEND_MAX_M = 30.0         # a reach meeting a moved node is bent to it up to this shift, extended to it beyond
NODE_R_M = 60.0           # an interior stem end moves to the imagery water within this
LAND_COST = 12.0          # a metre of land against a metre of mid-channel water (about 1.2)
DEM_NEAR_M = 30.0         # ... land within this of the DEM's line is cheaper (0.4 at the line)
SMOOTH_M = 10.0           # gaussian sigma over the traced cells
WIDTH_RUN_M = 200.0       # ... a running median along the stem over this, per reach the median of its part
MIN_REACH_M = 10.0        # a moved stem's reach keeps at least min(this, half its share of the new length)
RESOLVED_W_M = 40.0       # the imagery's width replaces the drawn one when its median is at least this (two pixels)
SIDE_MIN_M = 150.0        # a braid's side channel: a patch of the river's water off the main ribbon at least this long
SIDE_R_M = 250.0          # ... within this of it
SIDE_COVER_M = 10.0       # ... off the ribbon: beyond w / 2 + this
COVER_M = 20.0            # undrawn water: beyond w / 2 + this of a reach, this of a pond
UNDRAWN_MIN_M2 = 1600.0   # ... patches of at least this (four pixels)
EDGE_M = 10.0             # a stem end this close to the tile edge is a seam crossing: it stays put
CANAL = 33600
DEM_LINES = "hydro/channels_dem.geojson"
OUT = "hydro/water_imagery.json"
RES = 5.0                 # the trace grid


# ---------------------------------------------------------------------------
# The imagery's water
# ---------------------------------------------------------------------------
class WaterMap:
    """The imagery's water: the 20 m frequency, the 5 m mask, its in/out distances."""

    def __init__(self, tile: Tile, z5: np.ndarray):
        months, tr, crs, shp = _months(tile)
        self.months = sorted(months)
        self.ok = bool(months)
        n5 = z5.shape[0]
        self.n = n5
        if not self.ok:
            self.freq20 = None
            self.w5 = np.zeros((n5, n5), bool)
            self.f5 = np.zeros((n5, n5), "float32")
            return
        wet = np.zeros(shp, "float32")
        obs = np.zeros(shp, "float32")
        for clear, water, _ in months.values():
            wet += water
            obs += clear
        freq = np.where(obs >= MIN_MONTHS, wet / np.maximum(obs, 1), 0.0).astype("float32")
        # the DEM's slope at each 20 m pixel, and the sea
        zs = ndimage.gaussian_filter(z5, 10.0 / RES)
        gy, gx = np.gradient(zs, RES)
        slope = np.hypot(gx, gy)
        k = n5 // shp[0]
        slope20 = slope.reshape(shp[0], k, shp[1], k).mean(axis=(1, 3)) if n5 % shp[0] == 0 else \
            ndimage.zoom(slope, shp[0] / n5, order=1)[:shp[0], :shp[1]]
        z20 = z5.reshape(shp[0], k, shp[1], k).min(axis=(1, 3)) if n5 % shp[0] == 0 else ndimage.zoom(z5, shp[0] / n5, order=1)
        self.sea20 = z20 <= SEA_M
        self.steep20 = slope20 >= FLAT_SLOPE
        ok = (obs >= MIN_MONTHS) & ~self.steep20 & ~self.sea20
        # the water fraction of a pixel narrower than the river is not: NDWI (its upper quartile over the observed
        # months) unmixed between the land around it and the tile's open water
        nd = np.stack([ndwi for ndwi in _ndwi(tile, sorted(months))])
        with np.errstate(all="ignore"):
            ndq = np.nanpercentile(nd, NDWI_Q, axis=0)
        ndq = np.where(np.isfinite(ndq), ndq, -1.0).astype("float32")
        dry = ok & (freq == 0)
        box = BG_BOX_M / 20.0
        num = ndimage.uniform_filter(np.where(dry, ndq, 0.0), int(box))
        den = ndimage.uniform_filter(dry.astype("float32"), int(box))
        land_med = float(np.median(ndq[dry])) if dry.any() else -0.3
        bg = np.where(den > 0.1, num / np.maximum(den, 1e-6), land_med)
        always = ok & (freq >= 0.9)
        w_em = float(np.median(ndq[always])) if always.sum() >= 10 else WATER_EM_DEFAULT
        self.water_em, self.land_med = w_em, land_med
        span = np.maximum(w_em - bg, 0.1)
        frac = np.clip((ndq - bg) / span, 0.0, 1.0)
        self.frac20 = np.where(ok, frac, 0.0).astype("float32")
        self.raw20 = freq
        self.freq20 = np.where(ok, np.maximum(freq, self.frac20), 0.0).astype("float32")
        self.obs20 = obs
        # bilinear onto the 5 m grid (pixel centres: 20 m at 10 + 20 i, 5 m at 2.5 + 5 j)
        c = (np.arange(n5) * RES + RES / 2 - 10.0) / 20.0
        rr, cc = np.meshgrid(c, c, indexing="ij")
        self.f5 = ndimage.map_coordinates(self.freq20, [rr, cc], order=1, mode="nearest").astype("float32")
        self.w5 = self.f5 >= WATER_FREQ
        sea5 = ndimage.map_coordinates(self.sea20.astype("float32"), [rr, cc], order=0, mode="nearest") > 0.5
        self.sea5 = sea5
        self.d_in = ndimage.distance_transform_edt(self.w5) * RES       # metres inside the water (0 on land)

    def at(self, x, north):
        """The 5 m water mask at tile-local points."""
        n = self.n
        c = np.clip((np.asarray(x) / RES).astype(int), 0, n - 1)
        r = np.clip(((TILE_SIZE_M - np.asarray(north)) / RES).astype(int), 0, n - 1)
        return self.w5[r, c]

    def freq_at(self, x, north):
        n = self.n
        c = np.clip((np.asarray(x) / RES).astype(int), 0, n - 1)
        r = np.clip(((TILE_SIZE_M - np.asarray(north)) / RES).astype(int), 0, n - 1)
        return self.f5[r, c]


def _ndwi(tile: Tile, months: list[int]):
    """Each used month's NDWI (NaN where not clear), as water_seasons._months reads the composites."""
    for mm in months:
        with rasterio.open(tile.path(f"seasons/s2_{mm:02d}.tif")) as r:
            a = r.read().astype("float32")
        R, G, B, V = a[:4]
        with np.errstate(all="ignore"):
            valid = np.isfinite(R) & np.isfinite(G) & np.isfinite(B) & np.isfinite(V) & (np.abs(V) < 0.999)
            N = R * (1 + V) / np.maximum(1 - V, 1e-3)
            ndwi = (G - N) / np.maximum(G + N, 1e-6)
            bright = valid & ((G >= BRIGHT_GREEN) | ((V < 0.1) & (B >= BRIGHT_BLUE)))
        yield np.where(valid & ~bright, ndwi, np.nan)


def _normals(p: np.ndarray) -> np.ndarray:
    t = np.gradient(p, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    return np.stack([-t[:, 1], t[:, 0]], axis=1)


def _samples(line: LineString, step: float = SAMPLE_M) -> np.ndarray:
    L = line.length
    ds = np.linspace(0, L, max(2, int(np.ceil(L / step)) + 1))
    return np.array([line.interpolate(d).coords[0][:2] for d in ds])


def reach_test(line: LineString, width: float, wm: WaterMap) -> dict:
    """Share of the line's samples with imagery water within the `on` and `near` distances."""
    p = _samples(line)
    nrm = _normals(p)
    h_on, h_near = max(width / 2, ON_MIN_M), max(NEAR_MIN_M, 2 * width)

    def share(h):
        o = np.arange(-h, h + 1e-6, 2.5)
        q = p[:, None, :] + nrm[:, None, :] * o[None, :, None]
        return wm.at(q[..., 0], q[..., 1]).any(axis=1)
    on, near = share(h_on), share(h_near)
    return {"on": round(float(on.mean()), 3), "near": round(float(near.mean()), 3), "samples": len(p)}


def verdict(t: dict) -> str:
    if t["on"] >= ON_SHARE:
        return "on water"
    if t["near"] >= NEAR_SHARE:
        return "off water"
    return "no water seen"


def water_width(line: LineString, wm: WaterMap, max_half: float = 150.0, mask: np.ndarray | None = None) -> float | None:
    """Median width of the water mask's run through the line, over the samples on water (None: none on water)."""
    w = width_samples(line, wm, max_half, mask)
    w = w[np.isfinite(w)]
    return float(np.median(w)) if w.size else None


def width_samples(line: LineString, wm: WaterMap, max_half: float = 150.0, mask: np.ndarray | None = None) -> np.ndarray:
    """The water mask's run through the line at every SAMPLE_M (NaN where the line is not on water)."""
    p = _samples(line)
    nrm = _normals(p)
    o = np.arange(-max_half, max_half + 1e-6, 2.5)
    q = p[:, None, :] + nrm[:, None, :] * o[None, :, None]
    if mask is None:
        w = wm.at(q[..., 0], q[..., 1])
    else:
        n = mask.shape[0]
        c = np.clip((q[..., 0] / RES).astype(int), 0, n - 1)
        r = np.clip(((TILE_SIZE_M - q[..., 1]) / RES).astype(int), 0, n - 1)
        w = mask[r, c]
    mid = len(o) // 2
    out = []
    for row in w:
        if not row[mid - 2:mid + 3].any():
            out.append(np.nan)
            continue
        c = mid - 2 + int(np.argmax(row[mid - 2:mid + 3]))
        a = c
        while a > 0 and row[a - 1]:
            a -= 1
        b = c
        while b < len(row) - 1 and row[b + 1]:
            b += 1
        out.append((b - a + 1) * 2.5)
    return np.array(out, "float64")


# ---------------------------------------------------------------------------
# Stems and the trace
# ---------------------------------------------------------------------------
def _stems(edges: list[dict], s_node, e_node) -> list[list[int]]:
    """The large reaches cut into stems, biggest drainage first: each walked up its biggest large inflow and down its
    large outflow until a reach already in a stem."""
    large = [i for i, e in enumerate(edges) if e["large"]]
    by_start, by_end = {}, {}
    for i in large:
        by_start.setdefault(int(s_node[i]), []).append(i)
        by_end.setdefault(int(e_node[i]), []).append(i)
    used, stems = set(), []
    for i in sorted(large, key=lambda i: -edges[i]["area"]):
        if i in used:
            continue
        stem = [i]
        used.add(i)
        while True:   # down
            nxt = [j for j in by_start.get(int(e_node[stem[-1]]), []) if j not in used]
            if not nxt:
                break
            j = max(nxt, key=lambda j: edges[j]["area"])
            stem.append(j)
            used.add(j)
        while True:   # up
            prv = [j for j in by_end.get(int(s_node[stem[0]]), []) if j not in used]
            if not prv:
                break
            j = max(prv, key=lambda j: edges[j]["area"])
            stem.insert(0, j)
            used.add(j)
        stems.append(stem)
    return stems


def _on_edge(x, y) -> bool:
    return min(x, y, TILE_SIZE_M - x, TILE_SIZE_M - y) < EDGE_M


def _cell(x, y, n):
    return (int(np.clip((TILE_SIZE_M - y) / RES, 0, n - 1)), int(np.clip(x / RES, 0, n - 1)))


def _snap_to_water(x, y, wm: WaterMap, allowed: np.ndarray):
    """The deepest-inside water cell within NODE_R_M of (x, y), inside `allowed` (None: none there)."""
    n = wm.n
    r0, c0 = _cell(x, y, n)
    k = int(NODE_R_M / RES)
    a, b = max(0, r0 - k), min(n, r0 + k + 1)
    c, d = max(0, c0 - k), min(n, c0 + k + 1)
    rr, cc = np.mgrid[a:b, c:d]
    ok = wm.w5[a:b, c:d] & allowed[a:b, c:d] & (np.hypot(rr - r0, cc - c0) * RES <= NODE_R_M)
    if not ok.any():
        return None
    # the nearest water, then the deepest-inside cell within 10 m of it
    dist = np.where(ok, np.hypot(rr - r0, cc - c0), np.inf)
    dmin = dist.min()
    near = ok & (dist <= dmin + 10.0 / RES)
    score = np.where(near, wm.d_in[a:b, c:d], -1)
    j = int(np.argmax(score))
    r, cl = rr.ravel()[j], cc.ravel()[j]
    return ((cl + 0.5) * RES, TILE_SIZE_M - (r + 0.5) * RES)


def trace_stem(old: LineString, start, end, start_fixed: bool, end_fixed: bool, wm: WaterMap, z5: np.ndarray | None = None):
    """The least-cost path through the imagery's water from start to end within CORRIDOR_M of the old stem line.
    Returns (path xy, start used, end used) or None."""
    from rasterio.features import rasterize
    from skimage.graph import MCP_Geometric
    n = wm.n
    from shapely.ops import unary_union
    # the corridor around the old line, and around the way to an end already moved (a junction on a moved stem)
    zone = unary_union([old] + [LineString([old.coords[i][:2], p]) for i, p in ((0, start), (-1, end))
                                if Point(p).distance(Point(old.coords[i][:2])) > 1.0]).buffer(CORRIDOR_M)
    x0, y0, x1, y1 = zone.bounds
    c0, c1 = int(max(0, x0 // RES)), int(min(n, x1 // RES + 1))
    r0, r1 = int(max(0, (TILE_SIZE_M - y1) // RES)), int(min(n, (TILE_SIZE_M - y0) // RES + 1))
    h, w = r1 - r0, c1 - c0
    tr = rasterio.transform.from_origin(c0 * RES, TILE_SIZE_M - r0 * RES, RES, RES)
    corr = rasterize([(zone, 1)], out_shape=(h, w), transform=tr, fill=0, dtype="uint8").astype(bool)
    on_line = rasterize([(old.buffer(RES), 1)], out_shape=(h, w), transform=tr, fill=0, dtype="uint8").astype(bool)
    d_dem, (ir, ic) = ndimage.distance_transform_edt(~on_line, return_indices=True)
    d_dem = d_dem * RES
    win = (slice(r0, r1), slice(c0, c1))
    # the valley floor: ground at most FLOOR_H_M over the old line's DEM at its nearest cell (a braided river's whole
    # gravel plain, not the terrace above it nor the next valley's pond)
    if z5 is not None:
        zw = z5[win]
        corr &= (zw - zw[ir, ic]) <= FLOOR_H_M
    water = wm.w5[win]
    d_in = wm.d_in[win]
    cost = np.where(water, 1.0 + 2.0 * np.exp(-d_in / 6.0),
                    LAND_COST * (0.4 + 0.6 * np.minimum(1.0, d_dem / DEM_NEAR_M)))
    cost = np.where(corr, cost, np.inf)
    full_allowed = np.zeros((n, n), bool)
    full_allowed[win] = corr
    if not start_fixed:
        s = _snap_to_water(*start, wm, full_allowed)
        start = s if s is not None else start
    if not end_fixed:
        e = _snap_to_water(*end, wm, full_allowed)
        end = e if e is not None else end
    rs, cs = _cell(*start, n)
    re_, ce = _cell(*end, n)
    rs, cs, re_, ce = rs - r0, cs - c0, re_ - r0, ce - c0
    if not (0 <= rs < h and 0 <= cs < w and 0 <= re_ < h and 0 <= ce < w):
        return None
    cost[rs, cs] = max(1.0, cost[rs, cs]) if np.isfinite(cost[rs, cs]) else LAND_COST
    cost[re_, ce] = max(1.0, cost[re_, ce]) if np.isfinite(cost[re_, ce]) else LAND_COST
    m = MCP_Geometric(cost, fully_connected=True)
    cum, _ = m.find_costs([(rs, cs)], [(re_, ce)])
    if not np.isfinite(cum[re_, ce]):
        return None
    cells = np.array(m.traceback((re_, ce)))
    xy = np.stack([(cells[:, 1] + c0 + 0.5) * RES, TILE_SIZE_M - (cells[:, 0] + r0 + 0.5) * RES], axis=1)
    xy[0] = start
    xy[-1] = end
    # smooth, ends held
    if len(xy) > 4:
        sig = SMOOTH_M / RES
        pad = int(3 * sig) + 1
        ext = np.concatenate([np.repeat(xy[:1], pad, 0), xy, np.repeat(xy[-1:], pad, 0)])
        sm = ndimage.gaussian_filter1d(ext, sig, axis=0)[pad:-pad]
        wgt = np.minimum(1.0, np.minimum(np.arange(len(xy)), np.arange(len(xy))[::-1]) / (2 * sig))[:, None]
        xy = xy * (1 - wgt) + sm * wgt
    return xy, tuple(start), tuple(end)


def _smoothstep(u):
    u = np.clip(u, 0.0, 1.0)
    return 1 - u * u * (3 - 2 * u)


def bend(line: LineString, d_start, d_end) -> LineString:
    """The line with its start moved by d_start and its end by d_end, each tapered over 2 |d| + 20 m."""
    p = np.asarray(line.coords, "float64")[:, :2]
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
    L = seg[-1] if seg[-1] > 0 else 1.0
    out = p.copy()
    ts = 2 * np.hypot(*d_start) + 20.0 if d_start is not None else 0.0
    te = 2 * np.hypot(*d_end) + 20.0 if d_end is not None else 0.0
    if ts + te > L and ts + te > 0:
        k = L / (ts + te)
        ts, te = ts * k, te * k
    if d_start is not None and ts > 0:
        out += np.outer(_smoothstep(seg / ts), d_start)
    if d_end is not None and te > 0:
        out += np.outer(_smoothstep((L - seg) / te), d_end)
    if d_start is not None:
        out[0] = p[0] + d_start
    if d_end is not None:
        out[-1] = p[-1] + d_end
    # a short line can come back with densified noise; densify the taper first for a smooth bend
    return LineString(out)


def _densify(line: LineString, step=5.0) -> LineString:
    L = line.length
    if L < 2 * step:
        return line
    ds = np.r_[np.arange(0, L, step), L]
    return LineString([line.interpolate(d).coords[0][:2] for d in ds])


# ---------------------------------------------------------------------------
# Side channels of a braided river
# ---------------------------------------------------------------------------
def side_channels(river_lines: list[tuple[LineString, float, dict]], wm: WaterMap, corridor_mask: np.ndarray) -> list[dict]:
    """Patches of a large river's imagery water off its moved ribbon (beyond w / 2 + SIDE_COVER_M), within its corridor,
    whose skeleton's longest path is at least SIDE_MIN_M: each a side channel along that path at its measured width."""
    from rasterio.features import rasterize
    from skimage.morphology import skeletonize
    n = wm.n
    tr = rasterio.transform.from_origin(0, TILE_SIZE_M, RES, RES)
    shapes = [(ln.buffer(w / 2 + SIDE_COVER_M), 1) for ln, w, _ in river_lines]
    if not shapes:
        return []
    cover = rasterize(shapes, out_shape=(n, n), transform=tr, fill=0, dtype="uint8").astype(bool)
    off = wm.w5 & corridor_mask & ~cover
    lab, k = ndimage.label(off, structure=np.ones((3, 3)))
    out = []
    if not k:
        return out
    objs = ndimage.find_objects(lab)
    for i, sl in enumerate(objs, 1):
        m = lab[sl] == i
        if m.sum() * RES * RES < SIDE_MIN_M * 10:
            continue
        sk = skeletonize(np.pad(m, 1))[1:-1, 1:-1]
        pts = np.argwhere(sk)
        if len(pts) < SIDE_MIN_M / RES:
            continue
        path = _longest_path(pts)
        if path is None or len(path) < 2:
            continue
        xy = np.stack([(path[:, 1] + sl[1].start + 0.5) * RES, TILE_SIZE_M - (path[:, 0] + sl[0].start + 0.5) * RES], axis=1)
        ln = LineString(xy)
        if ln.length < SIDE_MIN_M:
            continue
        ln = LineString(ndimage.gaussian_filter1d(np.asarray(ln.coords), 1.0, axis=0, mode="nearest"))
        # which river: the nearest moved line; orient downstream with it
        best = min(river_lines, key=lambda t: t[0].distance(ln))
        par, pw, pr = best
        a, b = par.project(Point(ln.coords[0])), par.project(Point(ln.coords[-1]))
        if b < a:
            ln = LineString(list(ln.coords)[::-1])
        patch = np.zeros(off.shape, bool)
        patch[sl] = m
        wid = water_width(ln, wm, max_half=60.0, mask=patch) or 10.0
        out.append({"line": ln, "width": round(min(wid, pw), 1), "parent": pr, "area_m2": float(m.sum() * RES * RES)})
    return out


def _longest_path(pts: np.ndarray):
    """The longest shortest path through an 8-connected skeleton (two BFS passes)."""
    from collections import deque
    idx = {tuple(p): i for i, p in enumerate(pts)}
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    def bfs(s):
        prev = {s: None}
        q = deque([s])
        last = s
        while q:
            u = q.popleft()
            last = u
            p = pts[u]
            for dr, dc in nb:
                v = idx.get((p[0] + dr, p[1] + dc))
                if v is not None and v not in prev:
                    prev[v] = u
                    q.append(v)
        return last, prev
    a, _ = bfs(0)
    b, prev = bfs(a)
    path = []
    u = b
    while u is not None:
        path.append(pts[u])
        u = prev[u]
    return np.array(path)


# ---------------------------------------------------------------------------
# The step
# ---------------------------------------------------------------------------
def water_imagery(tile: Tile) -> tuple[dict, dict]:
    t0 = time.time()
    from rasterio.features import rasterize
    from .reroute import _nodes
    from .rewild_hydro import _Ctx
    from .water import kept_ponds
    ctx = _Ctx(tile)
    ch_path = tile.path("hydro/channels.geojson")
    doc = json.load(open(ch_path))
    if doc.get("imagery_moved"):
        if not tile.path(DEM_LINES).exists():
            raise RuntimeError("channels.geojson is moved onto the imagery but hydro/channels_dem.geojson is missing: run the channels step")
        doc = json.load(open(tile.path(DEM_LINES)))
    else:
        write_json(tile.path(DEM_LINES), doc)
    feats = doc["features"]
    zpath = tile.path("terrain/dem_rewilded.tif") if tile.path("terrain/dem_rewilded.tif").exists() else tile.path("terrain/dem.tif")
    with rasterio.open(zpath) as src:
        z5 = src.read(1).astype("float64")
    wm = WaterMap(tile, z5)
    n = wm.n

    # every drawable reach
    edges = []
    for k, f in enumerate(feats):
        pr = f["properties"]
        if not f.get("geometry") or pr.get("fcode") == CANAL or pr.get("on_ice"):
            continue
        g = ctx.local(shape(f["geometry"]))
        if g.geom_type != "LineString" or g.length < 1:
            continue
        w = float(pr.get("width") or 2.0)
        edges.append({"k": k, "line": LineString([c[:2] for c in g.coords]), "width": w, "area": float(pr.get("area_km2") or 0.0),
                      "pond": bool(pr.get("in_waterbody")), "source": pr.get("source"),
                      "large": w >= MOVE_W_M and not pr.get("in_waterbody") and pr.get("source") == "dem"})
    tests_before = {}
    for e in edges:
        if not e["pond"] and wm.ok:
            tests_before[e["k"]] = reach_test(e["line"], e["width"], wm)

    new_lines = {e["k"]: e["line"] for e in edges}
    moved_k, stem_log, node_shift, stem_width = set(), [], {}, {}
    if wm.ok and edges:
        lines = [e["line"] for e in edges]
        s_node, e_node, pos = _nodes(lines, tol=1.0)
        node_new = {}
        for stem in _stems(edges, s_node, e_node):
            old = LineString([c for j, i in enumerate(stem) for c in (edges[i]["line"].coords if j == 0 else edges[i]["line"].coords[1:])])
            wmax = max(edges[i]["width"] for i in stem)
            t = reach_test(old, wmax, wm)
            v = verdict(t)
            names = sorted({feats[edges[i]["k"]]["properties"].get("name") or "" for i in stem} - {""})
            rec = {"reaches": len(stem), "names": names, "length_m": round(old.length), "area_km2": round(edges[stem[0]]["area"], 1),
                   "width": wmax, "before": t, "verdict": v}
            if v == "on water":
                stem_log.append(rec)
                continue
            vs, ve = int(s_node[stem[0]]), int(e_node[stem[-1]])
            start, end = tuple(pos[vs]), tuple(pos[ve])
            s_fixed = vs in node_new or _on_edge(*start)
            e_fixed = ve in node_new or _on_edge(*end)
            if vs in node_new:
                start = node_new[vs]
            if ve in node_new:
                end = node_new[ve]
            res = trace_stem(old, start, end, s_fixed, e_fixed, wm, z5)
            if res is None:
                rec["verdict"] = "off water (no path)"
                stem_log.append(rec)
                continue
            xy, start, end = res
            new = LineString(xy)
            t_after = reach_test(new, wmax, wm)
            if t_after["on"] < max(MOVE_ON, t["on"] + MOVE_GAIN):
                rec.update(verdict=f"{v} (kept: the trace is not on the imagery's water)", after=t_after)
                stem_log.append(rec)
                continue
            # cut at the stem's interior nodes' projections, kept in order
            # (a node near the new line: its projection; one far from it, where the river crossed its plain: the
            # same share of the way along as on the old line), each reach at least half its share of the new length
            Lo, Ln = old.length, new.length
            cum = np.cumsum([edges[i]["line"].length for i in stem])
            params = [0.0]
            for j, i in enumerate(stem[:-1]):
                q_ = Point(pos[int(e_node[i])])
                p_ = new.project(q_) if new.distance(q_) <= 2 * BEND_MAX_M else cum[j] / Lo * Ln
                gap = min(MIN_REACH_M, 0.5 * edges[i]["line"].length * Ln / Lo)
                params.append(max(params[-1] + gap, p_))
            params.append(Ln)
            params = np.array(params)
            if params[-2] > Ln - 1.0:      # squeezed against the end: spread proportionally
                params = np.r_[0.0, cum / Lo * Ln]
            # the imagery's width along the stem, a running median over WIDTH_RUN_M, per reach the median of its part
            wsm = width_samples(new, wm)
            k_ = max(1, int(WIDTH_RUN_M / SAMPLE_M) // 2)
            run = np.array([np.nanmedian(wsm[max(0, t - k_):t + k_ + 1]) if np.isfinite(wsm[max(0, t - k_):t + k_ + 1]).any()
                            else np.nan for t in range(len(wsm))])
            dpos = np.linspace(0, Ln, len(wsm))
            for j, i in enumerate(stem):
                a, b = params[j], params[j + 1]
                seg = substring(new, a, b) if b - a > 0.5 else LineString([new.interpolate(a), new.interpolate(min(Ln, a + 0.5))])
                new_lines[edges[i]["k"]] = seg
                moved_k.add(edges[i]["k"])
                sel = run[(dpos >= a - 1e-6) & (dpos <= b + 1e-6)]
                sel = sel[np.isfinite(sel)]
                stem_width[edges[i]["k"]] = float(np.median(sel)) if sel.size else None
            ids = [int(s_node[i]) for i in stem] + [ve]
            for j, v_ in enumerate(ids):
                p_ = new.interpolate(params[j]).coords[0][:2]
                if v_ not in node_new:
                    node_new[v_] = p_
                    node_shift[v_] = (p_[0] - pos[v_][0], p_[1] - pos[v_][1])
            sh = np.array([old.distance(new.interpolate(d)) for d in np.arange(0, new.length, 10.0)])
            rec.update(verdict="moved", after=t_after, shift_m_median=round(float(np.median(sh)), 1),
                       shift_m_max=round(float(sh.max()), 1), ends=[["fixed" if s_fixed else "snapped"], ["fixed" if e_fixed else "snapped"]])
            stem_log.append(rec)
        # every other reach meeting a moved node is bent to it
        bent = extended = 0
        # at a node moved far, one connector: the biggest reach ending (or starting) there is extended, the others keep
        # meeting it at the old junction
        owner_e, owner_s = {}, {}
        for i, e in enumerate(edges):
            if e["k"] in moved_k:
                continue
            for v_, own in ((int(e_node[i]), owner_e), (int(s_node[i]), owner_s)):
                if v_ in node_shift and (v_ not in own or e["area"] > edges[own[v_]]["area"]):
                    own[v_] = i
        connectors = []
        for i in sorted(range(len(edges)), key=lambda i: -edges[i]["area"]):
            e = edges[i]
            if e["k"] in moved_k:
                continue
            ds = node_shift.get(int(s_node[i]))
            de = node_shift.get(int(e_node[i]))
            if ds is not None and np.hypot(*ds) > BEND_MAX_M and owner_s.get(int(s_node[i])) != i:
                ds = None
            if de is not None and np.hypot(*de) > BEND_MAX_M and owner_e.get(int(e_node[i])) != i:
                de = None
            if ds is None and de is None:
                continue
            if (ds is None or np.hypot(*ds) < 0.5) and (de is None or np.hypot(*de) < 0.5):
                continue
            # a short shift bends the reach's end to the node; a long one (the river moved across its plain) extends
            # it straight from where it met the old line to the new node, its own course left in its own valley
            ln = _densify(e["line"])
            far_s = ds is not None and np.hypot(*ds) > BEND_MAX_M
            far_e = de is not None and np.hypot(*de) > BEND_MAX_M
            ln = bend(ln, None if (ds is None or far_s) else np.array(ds), None if (de is None or far_e) else np.array(de))
            if far_s or far_e:
                c = [tuple(q[:2]) for q in ln.coords]
                if far_e:
                    p0 = np.array(c[-1])
                    p1 = p0 + np.array(de)
                    # a connector starting near one already drawn (a cluster of short old reaches) joins it there
                    near_c = [cn for cn in connectors if cn.distance(Point(p0)) < BEND_MAX_M]
                    if near_c:
                        cn = min(near_c, key=lambda cn: cn.distance(Point(p0)))
                        p1 = np.array(cn.interpolate(cn.project(Point(p0))).coords[0][:2])
                    if np.hypot(*(p1 - p0)) > 0.5:
                        seg = [tuple(p0 + (p1 - p0) * u) for u in np.linspace(0, 1, max(2, int(np.hypot(*(p1 - p0)) / 5)))]
                        c += seg[1:]
                        if not near_c:
                            connectors.append(LineString(seg))
                if far_s:
                    p1 = np.array(c[0])
                    p0 = p1 + np.array(ds)
                    c = [tuple(p0 + (p1 - p0) * u) for u in np.linspace(0, 1, max(2, int(np.hypot(*ds) / 5)))[:-1]] + c
                ln = LineString(c)
                extended += 1
            new_lines[e["k"]] = ln
            bent += 1
    else:
        bent = extended = 0

    # the map's own stretches of a moved river (NHD-sourced, kept where the DEM had no channel) that the imagery shows
    # dry, within the corridor of the river's new line: the map's water where there is none, dropped
    dropped = set()
    old_moved = [e["line"] for e in edges if e["k"] in moved_k] + [new_lines[k] for k in moved_k]
    if old_moved:
        from shapely.ops import unary_union
        mu = unary_union(old_moved)
        for e in edges:
            tb = tests_before.get(e["k"])
            x0_, y0_, x1_, y1_ = e["line"].bounds
            if (e["source"] == "nhd" and e["width"] >= MOVE_W_M and not e["pond"] and tb and verdict(tb) == "no water seen"
                    and e["line"].distance(mu) < CORRIDOR_M
                    and min(x0_, y0_, TILE_SIZE_M - x1_, TILE_SIZE_M - y1_) >= EDGE_M):
                dropped.add(e["k"])

    # widths from the imagery, the side channels
    widths = {}
    river = []
    for e in edges:
        if e["k"] in moved_k:
            ww = stem_width.get(e["k"])
            widths[e["k"]] = ww
            river.append((new_lines[e["k"]], max(e["width"], ww or 0) if (ww or 0) >= RESOLVED_W_M else e["width"],
                          feats[e["k"]]["properties"]))
    sides = []
    if river:
        tr = rasterio.transform.from_origin(0, TILE_SIZE_M, RES, RES)
        corr = rasterize([(feats_line.buffer(SIDE_R_M), 1) for feats_line, _, _ in river], out_shape=(n, n),
                         transform=tr, fill=0, dtype="uint8").astype(bool)
        sides = side_channels(river, wm, corr)

    # write
    new_feats = []
    by_k = {e["k"]: e for e in edges}
    tests_after = {}
    for k, f in enumerate(feats):
        pr = dict(f["properties"])
        if k in dropped:
            continue
        if k in by_k and not by_k[k]["pond"]:
            e = by_k[k]
            ln = new_lines[k]
            tb = tests_before.get(k)
            ta = reach_test(ln, e["width"], wm) if (wm.ok and (k in moved_k or ln is not e["line"])) else tb
            tests_after[k] = ta
            if tb:
                pr["imagery_on"] = tb["on"]
            if k in moved_k or ln is not e["line"]:
                pr["imagery_on_after"] = ta["on"] if ta else None
                pr["imagery_moved"] = "moved" if k in moved_k else "bent"
                ds = np.arange(0, ln.length + 1e-6, 5.0)
                pr["imagery_shift_m"] = round(float(np.median([e["line"].distance(ln.interpolate(d)) for d in ds])), 1)
                pr["length_m"] = round(ln.length, 1)
            if k in moved_k and widths.get(k):
                pr["imagery_width_m"] = round(widths[k], 1)
                if widths[k] >= RESOLVED_W_M and widths[k] > e["width"]:
                    from .channels import bed_width
                    pr["width_dem"] = e["width"]
                    pr["width"] = round(widths[k], 1)
                    pr["bed_width"] = round(bed_width(widths[k]), 1)
            if ln is e["line"]:
                geom = f["geometry"]
            else:
                geom = mapping(ctx.wgs(ln))
                geom["coordinates"] = [[round(a, 7), round(b, 7)] for a, b, *_ in geom["coordinates"]]
            new_feats.append({"type": "Feature", "properties": pr, "geometry": geom})
        else:
            new_feats.append(f)
    for s in sides:
        pp = s["parent"]
        from .channels import bed_width
        pr = {"name": pp.get("name"), "fcode": pp.get("fcode"), "order": pp.get("order"), "area_km2": pp.get("area_km2"),
              "source": "imagery", "anabranch": True, "nhd_matched": False, "width": s["width"],
              "bed_width": round(bed_width(s["width"]), 1), "in_waterbody": False, "length_m": round(s["line"].length, 1),
              "imagery_on": 1.0}
        geom = mapping(ctx.wgs(s["line"]))
        geom["coordinates"] = [[round(a, 7), round(b, 7)] for a, b, *_ in geom["coordinates"]]
        new_feats.append({"type": "Feature", "properties": pr, "geometry": geom})

    # the undrawn water
    undrawn = []
    if wm.ok:
        tr = rasterio.transform.from_origin(0, TILE_SIZE_M, RES, RES)
        cover_shapes = [(new_lines[e["k"]].buffer(e["width"] / 2 + COVER_M), 1) for e in edges if not e["pond"] and e["k"] not in dropped]
        cover_shapes += [(s["line"].buffer(s["width"] / 2 + COVER_M), 1) for s in sides]
        try:
            cover_shapes += [(p["geom"].buffer(COVER_M), 1) for p in kept_ponds(ctx)]
        except Exception:  # noqa: BLE001
            pass
        cover = rasterize(cover_shapes, out_shape=(n, n), transform=tr, fill=0, dtype="uint8").astype(bool) if cover_shapes else np.zeros((n, n), bool)
        off = wm.w5 & ~cover & ~wm.sea5
        lab, k = ndimage.label(off, structure=np.ones((3, 3)))
        if k:
            areas = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, k + 1)) * RES * RES
            coms = ndimage.center_of_mass(np.ones_like(lab), lab, np.arange(1, k + 1))
            fmean = ndimage.mean(wm.f5, lab, np.arange(1, k + 1))
            from shapely.strtree import STRtree
            keep = [e for e in edges if not e["pond"] and e["k"] not in dropped]
            ls = [new_lines[e["k"]] for e in keep]
            names = [feats[e["k"]]["properties"].get("name") for e in keep]
            wids = [e["width"] for e in keep]
            tree = STRtree(ls) if ls else None
            # what the map says there: a reservoir the rewilding took out (human water, not drawn by the rule), a
            # polygon water_seasons found dry, a mapped polygon the client cannot draw (a self-intersecting ring)
            from shapely.validation import make_valid
            from .water_seasons import body_id, load_classes
            classes = load_classes(tile) or {}
            masks = {}
            rw = [ctx.local(shape(f["geometry"])) for f in ctx.load("hydro/human_water.geojson")
                  if f["properties"].get("rewilded") and f.get("geometry")]
            dry_g, bad_g = [], []
            for i, f in enumerate(ctx.load("hydro/waterbodies.geojson")):
                if not f.get("geometry"):
                    continue
                g = ctx.local(shape(f["geometry"]))
                c = classes.get(body_id(f["properties"], i))
                if c and c["class"] == "dry":
                    dry_g.append(make_valid(g))
                elif not g.is_valid:
                    bad_g.append(make_valid(g))
            for name, gs in (("rewilded", rw), ("dry", dry_g), ("invalid_ring", bad_g)):
                gs = [g for g in gs if not g.is_empty]
                masks[name] = rasterize([(g, 1) for g in gs], out_shape=(n, n), transform=tr, fill=0, dtype="uint8").astype(bool) if gs else None
            mapped_n = {}
            for j in np.argsort(-areas):
                if areas[j] < UNDRAWN_MIN_M2:
                    break
                r, c = coms[j]
                x, y = (c + 0.5) * RES, TILE_SIZE_M - (r + 0.5) * RES
                rec = {"at": [round(x), round(y)], "area_m2": round(float(areas[j])), "freq_mean": round(float(fmean[j]), 2)}
                if tree is not None:
                    q = int(tree.nearest(Point(x, y)))
                    rec.update(nearest_reach=names[q], nearest_width=wids[q], nearest_m=round(ls[q].distance(Point(x, y))))
                cell = lab == j + 1
                rec["map"] = "unmapped"
                for name in ("rewilded", "dry", "invalid_ring"):
                    if masks.get(name) is not None and (masks[name] & cell).sum() >= 0.5 * cell.sum():
                        rec["map"] = {"rewilded": "a rewilded reservoir or pond (human water, not drawn by the rule)",
                                      "dry": "a mapped polygon water_seasons judged dry",
                                      "invalid_ring": "a mapped polygon whose ring self-intersects (water.js skips it)"}[name]
                        break
                mapped_n[rec["map"]] = mapped_n.get(rec["map"], 0) + 1
                undrawn.append(rec)

    changed = bool(moved_k or bent or sides or dropped)
    restored = False
    if changed:
        out_doc = {**{kk: vv for kk, vv in doc.items() if kk != "features"}, "imagery_moved": True, "features": new_feats}
        write_json(ch_path, out_doc)
    elif json.load(open(ch_path)).get("imagery_moved"):
        # nothing to move now, but an earlier run moved lines: the DEM's lines back
        write_json(ch_path, doc)
        restored = True

    # the evidence
    counts_b, counts_a = {}, {}
    rows = []
    for e in edges:
        if e["pond"] or e["k"] not in tests_before or e["k"] in dropped:
            continue
        tb, ta = tests_before[e["k"]], tests_after.get(e["k"]) or tests_before[e["k"]]
        vb, va = verdict(tb), verdict(ta)
        counts_b[vb] = counts_b.get(vb, 0) + 1
        counts_a[va] = counts_a.get(va, 0) + 1
        if e["width"] >= MOVE_W_M or e["k"] in moved_k or vb != "no water seen":
            pr = feats[e["k"]]["properties"]
            rows.append({"k": e["k"], "name": pr.get("name"), "width": e["width"], "length_m": round(e["line"].length),
                         "before": tb, "after": ta, "verdict_before": vb, "verdict_after": va,
                         "moved": "moved" if e["k"] in moved_k else ("bent" if new_lines[e["k"]] is not e["line"] else None)})
    rule = {"water_pixel": "seasons/s2_MM.tif: NDWI (NIR from red and NDVI) > 0 or NIR < 0.04, not bright (water_seasons.py)",
            "water": f"per 20 m pixel max(frequency, fraction): frequency = wet months / observed (>= {MIN_MONTHS}); fraction = "
                     f"its NDWI's {NDWI_Q}th percentile over the clear months unmixed between the never-wet land within "
                     f"{BG_BOX_M:g} m and the tile's always-wet water (median NDWI; {WATER_EM_DEFAULT} with under 10 such pixels); "
                     f"DEM slope < {FLAT_SLOPE}, DEM > {SEA_M} m; bilinear onto the 5 m grid, water at >= {WATER_FREQ}",
            "naip": "imagery/naip.tif is RGB (no NIR band): not used",
            "reach": f"on: water within max(w/2, {ON_MIN_M:g} m); near: within max({NEAR_MIN_M:g} m, 2 w); every {SAMPLE_M:g} m; "
                     f"on water >= {ON_SHARE}, off water: near >= {NEAR_SHARE}, else no water seen",
            "move": f"stems of DEM reaches with width >= {MOVE_W_M:g} m not on water: least-cost path on the 5 m grid within "
                    f"{CORRIDOR_M:g} m of the drawn stem on ground <= {FLOOR_H_M:g} m over its nearest DEM line cell (water "
                    f"1 + 2 exp(-d_in/6 m), land {LAND_COST:g} x (0.4 + 0.6 min(1, d_dem/{DEM_NEAR_M:g} m))), edge ends fixed, "
                    f"interior ends snapped to water within {NODE_R_M:g} m, a junction on a moved stem taken as moved, smoothed "
                    f"{SMOOTH_M:g} m; kept when on >= {MOVE_ON} and >= the old line's + {MOVE_GAIN}; the reaches meeting a moved "
                    f"node bent to it over 2 |shift| + 20 m (shift <= {BEND_MAX_M:g} m) or extended straight to it (one per node)",
            "nhd_dropped": f"NHD-sourced stretches with width >= {MOVE_W_M:g} m, no water seen, within {CORRIDOR_M:g} m of a moved "
                           "stem's old or new line, off the tile edge: the map's pieces of a river where the imagery shows none",
            "width": f"a moved reach takes the water's median cross-section when >= {RESOLVED_W_M:g} m and wider than drawn",
            "side_channels": f"the river's water within {SIDE_R_M:g} m, off the moved ribbon (w/2 + {SIDE_COVER_M:g} m), its "
                             f"skeleton's longest path >= {SIDE_MIN_M:g} m: a reach at its measured width (source imagery)",
            "undrawn": f"water patches >= {UNDRAWN_MIN_M2:g} m2 beyond w/2 + {COVER_M:g} m of every reach and {COVER_M:g} m of every kept pond"}
    stats = {"months_used": wm.months, "water_cells_5m": int(wm.w5.sum()), "reaches_tested": sum(counts_b.values()),
             "verdicts_before": counts_b, "verdicts_after": counts_a,
             "stems": len(stem_log), "stems_moved": sum(1 for s in stem_log if s["verdict"] == "moved"),
             "reaches_moved": len(moved_k), "reaches_bent": bent, "reaches_extended": extended, "nhd_dropped": len(dropped), "side_channels": len(sides),
             "undrawn_patches": len(undrawn), "undrawn_m2": round(sum(u["area_m2"] for u in undrawn)),
             "undrawn_by_map": {m_: round(sum(u["area_m2"] for u in undrawn if u["map"] == m_)) for m_ in sorted({u["map"] for u in undrawn})},
             "seconds": round(time.time() - t0, 1)}
    write_json(tile.path(OUT), {"rule": rule, "stats": stats, "stems": stem_log, "reaches": rows,
                                "side_channels": [{"name": s["parent"].get("name"), "width": s["width"], "length_m": round(s["line"].length),
                                                   "area_m2": round(s["area_m2"])} for s in sides],
                                "nhd_dropped": [{"k": k, "name": feats[k]["properties"].get("name"), "length_m": round(by_k[k]["line"].length),
                                                 "width": by_k[k]["width"]} for k in sorted(dropped)],
                                "undrawn": undrawn})
    print("water_imagery:", json.dumps(stats))

    # downstream of the lines, as the reroute step does
    layers = {}
    if changed or restored:
        if doc.get("rerouted") and tile.path("terrain/dem_1m.tif").exists():
            from .reroute import FineDEM, write_profile_fine
            pstats = write_profile_fine(tile, ctx, FineDEM(tile, ctx.z))
        else:
            from PIL import Image
            from .rewild_hydro import write_profile
            p = tile.path("client/channel_profile.png")
            keep_b = np.asarray(Image.open(p).convert("RGB"))[:, :, 2].copy() if p.exists() else None
            pstats = write_profile(ctx, z5, [], [], keep_b=keep_b)
        stats["profile"] = pstats
        from PIL import Image
        from .channels import channel_depth
        lines_new = [new_lines[e["k"]] for e in edges if e["k"] not in dropped] + [s["line"] for s in sides]
        ch5 = ctx.rasterize(lines_new, dtype="uint8").astype(bool)
        Image.fromarray(channel_depth(z5, ch5, ctx.res), "L").save(tile.path("client/channel_depth.png"), optimize=True)
        from .derive import client_features
        fl = client_features(tile)
        if fl:
            layers["client.features"] = fl
    layers["hydro.water_imagery"] = {
        "path": OUT, "kind": "table", "derived_from": ["hydro.channels", "seasons.s2_monthly", "terrain.dem"],
        "method": "the reverse test of mapped water: drawn reaches against the imagery's water, the large rivers moved onto it "
                  "(pipeline/water_imagery.py)", "rule": rule, "stats": stats}
    layers["hydro.channels_dem"] = {"path": DEM_LINES, "kind": "vector", "derived_from": ["hydro.channels"],
                                    "encoding": "the channels as the DEM routed them (after the reroute step), before the water_imagery step "
                                                "moved the large rivers onto the imagery's water"}
    return layers, stats


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tile", required=True)
    a = ap.parse_args(argv)
    layers, stats = water_imagery(Tile.from_id(a.tile))
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
