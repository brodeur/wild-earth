"""Hydrology rewilding: take out the water people made, restore the creeks under it.

Build step `rewild_hydro`, after `channels`. Four parts:

  1. Identify human water. Every NHD waterbody and every OSM water polygon in the tile is judged:
     human when NHD calls it a reservoir (FType 436), when OSM tags it as one (water=reservoir,
     landuse=reservoir or basin, water=wastewater or basin), when an OSM dam (man_made=dam,
     waterway=dam or weir) touches it, or when it is a small pond (under SMALL_POND_M2) on a
     routed channel whose downstream edge carries a dam: the ring is straight there and the ground
     falls away below it, or stands up as a rim above the water. Everything else is kept: ponds
     with no channel through them, wide spots of real creeks (no dam, no straight edge), and
     anything uncertain. Each decision and its reason goes to hydro/human_water.geojson.
  2. Rewild them. The surface is gone from the client (water.js reads the list from the manifest
     layer `hydro.human_water`). The lakebed is the lidar's hydro-flattened water surface, a dead
     flat: a shallow thalweg is carved down the middle of it (least-cost path from each inflow to
     the outlet, staying away from the old shore), 0.2 m deep at the inflow grading to
     OUTLET_CUT_M at the outlet, a few metres wide, into a derived copy of the DEM
     (terrain/dem_rewilded.tif; terrain/dem.tif is never touched). The channels step then routes on
     that copy with these waterbodies no longer held as ponds, so its least-cost breach cuts the
     outlet through the dam or spillway to lower ground below it. The breach reach is checked per
     waterbody; a dam it cannot cut within its limit raises the limit (recorded).
  3. Creek depth and width profile (client/channel_profile.png): per channel, riffles and pools
     from the DEM's long profile along the routed line (local slope against the reach's own slope),
     scaled by a hydraulic-geometry depth from drainage area.
  4. client/features.json is rebuilt from the new channels (derive.client_features), and the
     manifest gets the list, the areas, and status.hydrology_rewilded = true.

client/channel_profile.png, RGB on the DEM grid (5 m, row 0 = north):
  R  thalweg water depth at low-to-moderate flow, 2 cm units (0-5.1 m); 0 off channel
  G  riffle-pool index: 0 deepest pool, 128 run, 255 riffle (width factor 1 + 0.15 (G/127.5 - 1))
  B  rewilded water: 255 former open water (now a meadow or wet flat), 160 the riparian corridor
     along the restored channel through it, 0 elsewhere
R and G are written along each routed centreline and spread to the nearest centreline sample
within FILL_PX pixels, so a lookup anywhere on a drawn ribbon finds its thalweg value.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
import shapely
import shapely.ops
from PIL import Image
from pyproj import Transformer
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import transform as shp_transform

from .config import TILE_SIZE_M, Tile, write_json

SMALL_POND_M2 = 15000.0      # "about 1 ha": stock ponds are judged by their dam below this
STRAIGHT_RMS = 0.12          # downstream edge: RMS off its line / its length below this is straight
STRAIGHT_RMS_CREEK = 0.08    # ... stricter on a creek draining CREEK_KEEP_KM2 or more
STRAIGHT_MIN_M = 12.0        # ... and at least this long
DROP_MIN_M = 1.5             # ground 15-45 m below the outlet at least this much under the water level
DROP_MIN_CREEK_M = 2.0       # ... on a creek draining CREEK_KEEP_KM2 or more
DAM_LINE_M, DAM_NODE_M = 25.0, 80.0   # an OSM dam line / NID dam point this close to a ring holds it
CREEK_KEEP_KM2 = 5.0         # a pond on a creek draining this much with no dam is a wide spot of the creek
OUTLET_CUT_M = 1.2           # thalweg depth below the old water surface at the outlet (>= the breach's 1 m)
INLET_CUT_M = 0.2            # ... and at the inflow
OUTLET_GRADE = 0.005         # the thalweg's grade on past the outlet, through a sill, spillway or dam
OUTLET_TAIL_MAX_M = 300.0    # ... for at most this far (the breach step's own reach)
THALWEG_HALF_M = 4.0         # carved cross-section half width (parabolic)
CORRIDOR_M = 12.0            # riparian corridor either side of the restored channel inside a lakebed
HELD_FRACTION = 0.25         # over this share of a carved thalweg still under > 0.3 m of fill: the breach failed there
FILL_PX = 4                  # profile values spread this many pixels from the centreline
PRESENT = "hydro/channels_present.geojson"   # the present-day routing this step judges against
SAMPLE_M = 2.5               # profile sample spacing along a channel
OSM_WATER_QUERY = """[out:json][timeout:180][bbox:{s},{w},{n},{e}];
(nwr["man_made"="dam"]; nwr["waterway"~"^(dam|weir)$"]; nwr["water"]; nwr["natural"="water"];
 nwr["landuse"~"^(reservoir|basin)$"];);
out geom;"""
OSM_HUMAN_WATER = {"reservoir", "basin", "wastewater", "reflecting_pool", "fishpond", "lagoon"}


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

class _Ctx:
    def __init__(self, tile: Tile):
        self.tile = tile
        with rasterio.open(tile.path("terrain/dem.tif")) as src:
            self.z = src.read(1).astype("float64")
            self.res = src.res[0]
            self.profile = src.profile
            nd = src.nodata
        if nd is not None and (self.z == nd).any():
            self.z[self.z == nd] = self.z[self.z != nd].mean()
        self.n = self.z.shape[0]
        self.x0, self.y0 = tile.bounds[0], tile.bounds[1]
        to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
        self.to_wgs = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True).transform

        def _loc(x, y, z=None):
            xs, ys = to_tile(x, y)
            return np.asarray(xs) - self.x0, np.asarray(ys) - self.y0
        self.local = lambda g: shp_transform(_loc, g)
        self.wgs = lambda g: shp_transform(lambda x, y, z=None: self.to_wgs(np.asarray(x) + self.x0, np.asarray(y) + self.y0), g)
        self.tr = rasterio.transform.from_origin(0, TILE_SIZE_M, self.res, self.res)

    def load(self, rel):
        p = self.tile.dir / rel
        return json.load(open(p))["features"] if p.exists() else []

    def zat(self, x, north, z=None):
        """Bilinear DEM height at tile-local points (arrays)."""
        z = self.z if z is None else z
        n, res = self.n, self.res
        px = np.clip(np.asarray(x) / res - 0.5, 0, n - 1.001)
        py = np.clip((TILE_SIZE_M - np.asarray(north)) / res - 0.5, 0, n - 1.001)
        i, j = np.floor(px).astype(int), np.floor(py).astype(int)
        fx, fy = px - i, py - j
        return ((z[j, i] * (1 - fx) + z[j, i + 1] * fx) * (1 - fy) + (z[j + 1, i] * (1 - fx) + z[j + 1, i + 1] * fx) * fy)

    def rasterize(self, geoms, value=1, out=None, dtype="uint8"):
        from rasterio.features import rasterize
        shapes = [(g, value) for g in geoms if g is not None and not g.is_empty]
        if not shapes:
            return out if out is not None else np.zeros((self.n, self.n), dtype)
        return rasterize(shapes, out_shape=(self.n, self.n), transform=self.tr, fill=0, dtype=dtype,
                         out=out, all_touched=False)


def fetch_osm_water(tile: Tile, force=False) -> list[dict]:
    """OSM water polygons and dams (Overpass), cached at hydro/osm_water.geojson. None on failure."""
    p = tile.dir / "hydro/osm_water.geojson"
    if p.exists() and not force:
        return json.load(open(p))["features"]
    from .fetch_osm import overpass
    w, s, e, n = tile.bounds_wgs84
    q = OSM_WATER_QUERY.format(s=s, w=w, n=n, e=e)
    try:   # mirrors with backoff (fetch_osm.overpass); the raw answer is cached under _cache/
        data = overpass(q, tile.path("_cache/overpass_water.json"), force=force, label="rewild_hydro")
    except Exception as ex:  # noqa: BLE001
        print(f"rewild_hydro: Overpass unavailable: {ex}")
        data = None
    if data is None:
        return None
    feats = osm_water_features(data)
    write_json(p, {"type": "FeatureCollection", "features": feats})
    return feats


def osm_water_features(data: dict) -> list[dict]:
    """GeoJSON features (WGS84) from an Overpass `out geom` answer: water polygons, dam lines and points."""
    from .fetch_osm import _ring
    feats = []
    keys = ("natural", "water", "man_made", "waterway", "landuse", "name", "intermittent", "seasonal")
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        props = {k: tags[k] for k in keys if k in tags}
        props["osm_id"] = f"{el['type']}/{el['id']}"
        rings = []
        if el["type"] == "way" and el.get("geometry"):
            rings = [_ring(el["geometry"])]
        elif el["type"] == "relation":
            rings = [_ring(m["geometry"]) for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        elif el["type"] == "node":
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]}, "properties": props})
            continue
        for ring in rings:
            if len(ring) < 2:
                continue
            closed = len(ring) > 3 and ring[0] == ring[-1]
            dam_line = tags.get("man_made") == "dam" or tags.get("waterway") in ("dam", "weir")
            if closed and not (dam_line and len(ring) < 5):
                geom = {"type": "Polygon", "coordinates": [ring]}
            elif el["type"] == "relation" and len(ring) > 3:
                geom = {"type": "Polygon", "coordinates": [ring + [ring[0]]]}
            else:
                geom = {"type": "LineString", "coordinates": ring}
            feats.append({"type": "Feature", "geometry": geom, "properties": props})
    return feats


# ---------------------------------------------------------------------------
# 1. Identification
# ---------------------------------------------------------------------------

def _straightness(ring_xy: np.ndarray, at: np.ndarray, radius: float):
    """(length, rms / length) of the ring vertices within `radius` of `at`, densified every 1 m."""
    pts = []
    for a, b in zip(ring_xy[:-1], ring_xy[1:]):
        L = float(np.hypot(*(b - a)))
        k = max(1, int(L))
        for t in np.arange(k) / k:
            pts.append(a + (b - a) * t)
    pts = np.asarray(pts)
    near = pts[np.hypot(*(pts - at).T) <= radius]
    if len(near) < 4:
        return 0.0, 1.0
    c = near - near.mean(0)
    u, s, vt = np.linalg.svd(c, full_matrices=False)
    along = c @ vt[0]
    length = float(along.max() - along.min())
    rms = float(np.sqrt(np.mean((c @ vt[1]) ** 2)))
    return length, rms / max(length, 1e-6)


def _judge_pond(ctx: _Ctx, g, chans, osm_polys, osm_dams):
    """Decision and evidence for one waterbody polygon (tile-local)."""
    area = g.area
    ev = {"area_m2": round(area, 1)}
    reasons = []
    # OSM tags on an overlapping polygon
    for og, pr in osm_polys:
        if not og.intersects(g):
            continue
        ov = og.intersection(g).area / max(1.0, min(og.area, area))
        if ov < 0.3:
            continue
        tag = pr.get("water") or pr.get("landuse")
        if pr.get("water") in OSM_HUMAN_WATER or pr.get("landuse") in ("reservoir", "basin"):
            reasons.append(f"OSM {'water' if pr.get('water') else 'landuse'}={tag} ({pr['osm_id']}{', ' + pr['name'] if pr.get('name') else ''})")
        ev.setdefault("osm", []).append({k: pr[k] for k in pr if k in ("osm_id", "water", "natural", "landuse", "name")})
    for dg, pr in osm_dams:
        if dg.distance(g) <= (DAM_NODE_M if dg.geom_type == "Point" else DAM_LINE_M):
            reasons.append(f"OSM {'waterway=' + pr['waterway'] if pr.get('waterway') else 'man_made=dam'} {pr['osm_id']}"
                           f"{' (' + pr['name'] + ')' if pr.get('name') else ''} on its edge")
    # Channels through it (present-day routing: pieces inside the ring, or crossing it)
    through = [c for c in chans if c["line"].intersects(g)]
    level = None
    inner = g.buffer(-ctx.res)
    samp = inner if not inner.is_empty and inner.area > 4 * ctx.res ** 2 else g
    m = ctx.rasterize([samp]).astype(bool)
    if m.any():
        level = float(np.median(ctx.z[m]))
    else:
        level = float(ctx.zat([g.centroid.x], [g.centroid.y])[0])
    ev["level_m"] = round(level, 2)
    main = max(through, key=lambda c: c["area_km2"]) if through else None
    if main is not None:
        ev["channel_area_km2"] = round(main["area_km2"], 3)
        ev["channel_fcode"] = main["fcode"]
        ev["channel_name"] = main["name"]
        # outlet: where the biggest channel leaves the ring, going downstream
        line = main["line"]
        inside = line.intersection(g)
        dpos = [line.project(Point(part.coords[-1])) for part in getattr(inside, "geoms", [inside])
                if not part.is_empty and part.geom_type == "LineString"]
        outlet = line.interpolate(max(dpos) if dpos else line.project(g.centroid))
    else:
        # no routed channel: the outlet is where the ground outside the ring is lowest (a hillside pond's dam)
        band = g.buffer(30).difference(g.buffer(10))
        bm = ctx.rasterize([band]).astype(bool)
        if not bm.any():
            return reasons, ev
        k = np.flatnonzero(bm.ravel())[np.argmin(ctx.z.ravel()[bm.ravel()])]
        r, c = divmod(int(k), ctx.n)
        lowp = Point((c + 0.5) * ctx.res, TILE_SIZE_M - (r + 0.5) * ctx.res)
        outlet = shapely.ops.nearest_points(g.exterior, lowp)[0]
    # drop: lowest ground 15-45 m outside the ring near the outlet, under the water level
    band = g.buffer(45).difference(g.buffer(15)).intersection(outlet.buffer(60))
    bm = ctx.rasterize([band]).astype(bool) if not band.is_empty else None
    drop = level - float(ctx.z[bm].min()) if bm is not None and bm.any() else 0.0
    # crest: the highest ground 0-12 m outside the ring within 25 m of the outlet, over the water level
    band = g.buffer(12).difference(g).intersection(outlet.buffer(25))
    bm = ctx.rasterize([band]).astype(bool) if not band.is_empty else None
    crest = float(np.percentile(ctx.z[bm], 90)) - level if bm is not None and bm.any() else 0.0
    ring = np.asarray(g.exterior.coords)
    L, rel = _straightness(ring, np.array([outlet.x, outlet.y]), max(15.0, 0.35 * np.sqrt(area)))
    ev.update({"outlet": [round(outlet.x, 1), round(outlet.y, 1)], "drop_below_m": round(drop, 2),
               "crest_above_m": round(crest, 2), "edge_len_m": round(L, 1), "edge_rms": round(rel, 3)})
    big = main is not None and main["area_km2"] >= CREEK_KEEP_KM2
    dam = (L >= STRAIGHT_MIN_M and rel <= (STRAIGHT_RMS_CREEK if big else STRAIGHT_RMS)
           and drop >= (DROP_MIN_CREEK_M if big else DROP_MIN_M))
    ev["dam_evidence"] = bool(dam)
    if dam and area < SMALL_POND_M2:
        where = (f"on a routed channel ({main['area_km2']:.2f} km2)" if main is not None
                 else "off the routed network (a hillside tank fed by a swale under 0.15 km2)")
        reasons.append(f"stock pond: {area / 1e4:.2f} ha {where}, straight {L:.0f} m downstream edge, "
                       f"ground {drop:.1f} m below the water within 45 m of it, crest {crest:+.1f} m")
    elif dam and main is not None and not reasons:
        reasons.append(f"impoundment: {area / 1e4:.1f} ha on a routed channel ({main['area_km2']:.2f} km2) behind a straight "
                       f"{L:.0f} m edge, ground {drop:.1f} m below the water within 45 m of it")
    return reasons, ev


def identify(ctx: _Ctx, osm_feats: list[dict]):
    """(human, kept): lists of dicts with id, name, source, geometry (local), reasons, evidence."""
    chans = []
    for f in ctx.load(PRESENT):
        pr = f["properties"]
        chans.append({"line": ctx.local(shape(f["geometry"])), "area_km2": pr.get("area_km2") or 0, "fcode": pr.get("fcode"),
                      "name": pr.get("name"), "order": pr.get("order")})
    osm_polys, osm_dams = [], []
    for f in osm_feats:
        g = ctx.local(shape(f["geometry"]))
        if not g.is_valid:
            g = g.buffer(0)
        pr = f["properties"]
        if pr.get("man_made") == "dam" or pr.get("waterway") in ("dam", "weir"):
            osm_dams.append((g, pr))
        elif g.geom_type in ("Polygon", "MultiPolygon"):
            osm_polys.append((g, pr))
    # the footprint mask's reservoirs (fetch_osm) count too
    for f in ctx.load("footprint/mask.geojson"):
        pr = f["properties"]
        if pr.get("class") == "reservoir" and f["geometry"]["type"] in ("Polygon", "MultiPolygon"):
            g = ctx.local(shape(f["geometry"]))
            osm_polys.append((g if g.is_valid else g.buffer(0), {"osm_id": pr.get("osm_id"), "water": "reservoir", "name": pr.get("name")}))
    box = shapely.box(0, 0, TILE_SIZE_M, TILE_SIZE_M)
    human, kept, nhd_geoms = [], [], []
    for f in ctx.load("hydro/waterbodies.geojson"):
        pr = f["properties"]
        g = ctx.local(shape(f["geometry"]))
        if not g.is_valid:
            g = g.buffer(0)
        g = g.intersection(box)
        if g.is_empty:
            continue
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda p: p.area)
        nhd_geoms.append(g)
        reasons, ev = _judge_pond(ctx, g, chans, osm_polys, osm_dams)
        if str(pr.get("ftype")) == "436" or str(pr.get("fcode") or "").startswith("436"):
            reasons.insert(0, f"NHD FType 436 reservoir (FCode {pr.get('fcode')})")
        reasons = list(dict.fromkeys(reasons))
        rec = {"id": f"nhd:{pr.get('permanent_identifier')}", "nhd_id": pr.get("permanent_identifier"),
               "name": pr.get("gnis_name") or next((o.get("name") for o in ev.get("osm", []) if o.get("name")), None),
               "source": "nhd", "fcode": pr.get("fcode"), "ftype": pr.get("ftype"), "geom": g, "evidence": ev}
        if reasons:
            rec["reasons"] = reasons
            rec["kind"] = ("reservoir" if g.area >= SMALL_POND_M2 or any("436" in r or "reservoir" in r for r in reasons)
                           else "stock_pond")
            human.append(rec)
        else:
            a = ev.get("channel_area_km2")
            rec["kind"] = "natural"
            rec["reasons"] = [("wide spot of a creek: on a channel draining "
                               f"{a:.1f} km2 with no dam" if a and a >= CREEK_KEEP_KM2 else
                               "on a routed channel but no dam (no straight downstream edge with a drop or rim)" if a else
                               "no routed channel through it and no human tag: a natural pond or swale")]
            kept.append(rec)
    # OSM water not in NHD: human by its tags only (the client never drew these; routing already breaches them)
    nhd_union = shapely.union_all(nhd_geoms) if nhd_geoms else None
    for g, pr in osm_polys:
        if nhd_union is not None and g.intersects(nhd_union) and g.intersection(nhd_union).area > 0.3 * g.area:
            continue
        if g.area < 50 or g.intersection(box).is_empty:
            continue
        reasons = []
        if pr.get("water") in OSM_HUMAN_WATER or pr.get("landuse") in ("reservoir", "basin"):
            reasons.append(f"OSM {pr.get('water') and 'water=' + pr['water'] or 'landuse=' + pr['landuse']} ({pr['osm_id']})")
        for dg, dpr in osm_dams:
            if dg.distance(g) <= (DAM_NODE_M if dg.geom_type == "Point" else DAM_LINE_M):
                reasons.append(f"OSM dam {dpr['osm_id']}{' (' + dpr['name'] + ')' if dpr.get('name') else ''} on its edge")
        if not reasons:
            continue
        if any(h.get("osm_id") == pr["osm_id"] for h in human):
            continue
        human.append({"id": f"osm:{pr['osm_id']}", "osm_id": pr["osm_id"], "name": pr.get("name"), "source": "osm",
                      "geom": g.intersection(box), "reasons": reasons,
                      "kind": "reservoir" if g.area >= SMALL_POND_M2 else "pond",
                      "evidence": {"area_m2": round(g.area, 1), "not_in_nhd": True}})
    # de-duplicate OSM polygons repeated across the footprint and the Overpass query
    seen, out = set(), []
    for h in human:
        key = h.get("osm_id") or h["id"]
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out, kept


# ---------------------------------------------------------------------------
# 2. The restored channel through each bed
# ---------------------------------------------------------------------------

def _cell_of(ctx: _Ctx, x, y):
    c = int(min(ctx.n - 1, max(0, x // ctx.res)))
    r = int(min(ctx.n - 1, max(0, (TILE_SIZE_M - y) // ctx.res)))
    return r, c


def carve_thalwegs(ctx: _Ctx, human: list[dict]):
    """Carve a shallow thalweg down the middle of each rewilded bed into a copy of the DEM.

    For a bed with a routed channel through it: the outlet is where the biggest channel leaves the
    ring, the inflows are where channels enter it (or start inside it). A least-cost path from each
    inflow to the outlet over the bed's cells, cost = step x (1 + 30 / (2 + distance to the old
    shore in m)), runs down the middle of the flat instead of along the shore; along it the ground
    is lowered to the old water level minus a cut growing from INLET_CUT_M at the farthest inflow
    to OUTLET_CUT_M at the outlet, with a parabolic cross-section THALWEG_HALF_M either side (never
    raised; at 5 m cells the section is one cell wide). The old water level is the bed's 20th
    percentile (the lidar's hydro-flattened surface; NHD rings take in some bank). Past the outlet
    the same grade (at least OUTLET_GRADE) is carried down the present-day outflow, through the
    spillway or the dam, until the ground falls below the thalweg's end, so no sill is left; any
    depression the carve still leaves is the channels step's to breach.
    Returns (z carved, per-bed records, restored centrelines as local LineStrings)."""
    from scipy.ndimage import distance_transform_edt
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    z = ctx.z.copy()
    present = ctx.load(PRESENT)
    chans = [ctx.local(shape(f["geometry"])) for f in present]
    areas = [f["properties"].get("area_km2") or 0 for f in present]
    lines_out = []
    res, n = ctx.res, ctx.n
    for h in human:
        g = h["geom"]
        h["carve"] = None
        through = [(ln, a) for ln, a in zip(chans, areas) if ln.intersects(g)]
        if not through:
            continue
        mask = ctx.rasterize([g]).astype(bool)
        if mask.sum() < 3:
            continue
        rows, cols = np.nonzero(mask)
        r0, r1, c0, c1 = rows.min() - 1, rows.max() + 2, cols.min() - 1, cols.max() + 2
        r0, c0 = max(r0, 0), max(c0, 0)
        sub = mask[r0:r1, c0:c1]
        edt = distance_transform_edt(sub) * res
        idx = -np.ones(sub.shape, np.int64)
        idx[sub] = np.arange(int(sub.sum()))
        # 8-neighbour graph over the bed's cells
        src, dst, w = [], [], []
        rr, cc = np.nonzero(sub)
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
            r2, c2 = rr + dr, cc + dc
            ok = (r2 >= 0) & (r2 < sub.shape[0]) & (c2 >= 0) & (c2 < sub.shape[1])
            ok[ok] = sub[r2[ok], c2[ok]]
            step = res * (1.414 if dr and dc else 1.0)
            cost = step * (1 + 30.0 / (2 + 0.5 * (edt[rr[ok], cc[ok]] + edt[r2[ok], c2[ok]])))
            src += [idx[rr[ok], cc[ok]], idx[r2[ok], c2[ok]]]
            dst += [idx[r2[ok], c2[ok]], idx[rr[ok], cc[ok]]]
            w += [cost, cost]
        N = int(sub.sum())
        G = coo_matrix((np.concatenate(w), (np.concatenate(src), np.concatenate(dst))), shape=(N, N)).tocsr() if w else None
        main, _ = max(through, key=lambda t: t[1])
        inside = main.intersection(g)
        parts = [p for p in getattr(inside, "geoms", [inside]) if not p.is_empty and p.geom_type == "LineString"]
        if not parts or G is None:
            continue
        out_pt = max((Point(p.coords[-1]) for p in parts), key=lambda q: main.project(q))
        # inflow points: where channels enter the ring (or their heads inside it)
        ins = []
        for ln, a in through:
            for p in [p for p in getattr(ln.intersection(g), "geoms", [ln.intersection(g)]) if not p.is_empty and p.geom_type == "LineString"]:
                q = Point(p.coords[0])
                if q.distance(out_pt) > 2 * res:
                    ins.append(q)
        if not ins:
            continue

        def node(q):
            r, c = _cell_of(ctx, q.x, q.y)
            r, c = r - r0, c - c0
            if 0 <= r < sub.shape[0] and 0 <= c < sub.shape[1] and sub[r, c]:
                return idx[r, c]
            k = np.argmin((rr - r) ** 2 + (cc - c) ** 2)   # nearest bed cell
            return idx[rr[k], cc[k]]
        o = node(out_pt)
        dist, pred = dijkstra(G, indices=o, return_predecessors=True)
        # the old water surface: the hydro-flattened flat, the low fifth of the bed (NHD rings take in bank too)
        level = float(np.percentile(ctx.z[mask], 20))
        paths = []
        for q in ins:
            k = node(q)
            path = [k]
            while path[-1] != o and pred[path[-1]] >= 0:
                path.append(pred[path[-1]])
            if path[-1] != o:
                continue
            paths.append(path)                       # inflow ... outlet
        if not paths:
            continue
        # geodesic length to the outlet along each path
        geo = {}
        for path in paths:
            pts = np.array([[rr[i], cc[i]] for i in path], float)
            seg = np.hypot(*np.diff(pts, axis=0).T) * res
            L = np.concatenate([np.cumsum(seg[::-1])[::-1], [0.0]])
            for i, d in zip(path, L):
                geo[i] = max(geo.get(i, 0.0), float(d))
        Dmax = max(geo.values()) or 1.0
        lowered, deepest = 0, 0.0
        half_px = int(np.ceil(THALWEG_HALF_M / res))
        for i, d in geo.items():
            cut = OUTLET_CUT_M + (INLET_CUT_M - OUTLET_CUT_M) * d / Dmax
            R, C = rr[i] + r0, cc[i] + c0
            zc = level - cut           # to grade: a bank, island or causeway inside the old shore is cut through
            for dr in range(-half_px, half_px + 1):
                for dc in range(-half_px, half_px + 1):
                    r2, c2 = R + dr, C + dc
                    if not (0 <= r2 < n and 0 <= c2 < n):
                        continue
                    rad = np.hypot(dr, dc) * res
                    if rad > THALWEG_HALF_M and (dr or dc):
                        continue
                    zt = zc + cut * (rad / THALWEG_HALF_M) ** 2 if (dr or dc) else zc
                    if zt < z[r2, c2]:
                        deepest = max(deepest, float(ctx.z[r2, c2] - zt))
                        z[r2, c2] = zt
                        lowered += 1
        # Past the outlet: keep the grade down the present-day outflow (spillway or dam) until the
        # ground falls below it, so no sill is left between the thalweg and the creek below.
        z_out = min(level, ctx.z[rr[o] + r0, cc[o] + c0]) - OUTLET_CUT_M
        grade = max(OUTLET_GRADE, (OUTLET_CUT_M - INLET_CUT_M) / Dmax)
        from shapely.ops import substring
        d0 = main.project(out_pt)
        o_xy = ((cc[o] + c0 + 0.5) * res, TILE_SIZE_M - (rr[o] + r0 + 0.5) * res)
        rest = substring(main, d0, main.length)
        tail_line = LineString([o_xy] + (list(rest.coords) if rest.geom_type == "LineString" and rest.length > 0 else [out_pt.coords[0]]))
        tail, sill = 0.0, 0.0
        for dd in np.arange(res / 2, OUTLET_TAIL_MAX_M, res / 2):
            if dd > tail_line.length:
                break
            q = tail_line.interpolate(dd)
            R, C = _cell_of(ctx, q.x, q.y)
            if mask[R, C]:
                continue                            # still in the bed (the outlet cell's own neighbours)
            zt = z_out - grade * dd
            if ctx.z[R, C] <= z_out - 0.05:        # the ground below the dam is lower than the thalweg's end
                break
            if zt < z[R, C]:
                sill = max(sill, float(ctx.z[R, C] - zt))
                z[R, C] = zt
                lowered += 1
            tail = dd
        for path in paths:
            xy = [((cc[i] + c0 + 0.5) * res, TILE_SIZE_M - (rr[i] + r0 + 0.5) * res) for i in path]
            if len(xy) >= 2:
                lines_out.append(LineString(xy))
        h["carve"] = {"inflows": len(paths), "length_m": round(Dmax, 1), "cells": lowered,
                      "outlet_tail_m": round(tail, 1), "outlet_tail_max_cut_m": round(sill, 2),
                      "max_cut_m": round(deepest, 2), "outlet": [round(out_pt.x, 1), round(out_pt.y, 1)],
                      "level_m": round(level, 2)}
    return z, lines_out


# ---------------------------------------------------------------------------
# 3. Depth and width profile
# ---------------------------------------------------------------------------

def mean_depth(area_km2):
    """Reach-mean water depth (m) at low-to-moderate flow from drainage area: 0.10 A^0.32
    (0.06 m at 0.2 km2, 0.12 m at 2, 0.44 m at 100, 0.68 m at 400: a winter trickle in a swale to
    the North Fork Cosumnes in summer)."""
    return 0.10 * max(area_km2, 0.01) ** 0.32


def _gauss(v, sigma_samples):
    from scipy.ndimage import gaussian_filter1d
    if len(v) < 3 or sigma_samples <= 0:
        return v
    return gaussian_filter1d(v, sigma_samples, mode="nearest")


def profile_along(ctx: _Ctx, z, line: LineString, area_km2: float, width: float):
    """Samples along a channel (downstream): (xy, depth m, riffle index t in -1..1).

    The long profile is the DEM bilinear every SAMPLE_M, made non-increasing downstream (the water
    surface cannot climb: a bank or a log in the 5 m cell is dropped), smoothed over
    max(7.5 m, 2.5 water widths); local slope against the reach's own slope (smoothed over
    max(75 m, 10 widths))
    gives t = tanh(1.1 ln((S_local + e) / (S_reach + e))), e = 0.002: a steeper step than the reach
    around it is a riffle (t > 0), a flatter stretch a pool (t < 0). Depth = mean_depth(A) x
    exp(-0.85 t): about 2.3x the mean in the deepest pools, 0.43x on riffles."""
    L = line.length
    ds = np.arange(0.0, L + 1e-6, SAMPLE_M) if L > SAMPLE_M else np.array([0.0, L])
    pts = np.array([line.interpolate(d).coords[0] for d in ds])
    zz = ctx.zat(pts[:, 0], pts[:, 1], z)
    zz = np.minimum.accumulate(zz)
    sl = max(7.5, 2.5 * width) / SAMPLE_M
    zl = _gauss(zz, sl)
    zr = _gauss(zz, max(75.0, 10 * width) / SAMPLE_M)
    S_l = np.maximum(0.0, -np.gradient(zl, SAMPLE_M)) if len(zz) > 1 else np.zeros(len(zz))
    S_r = np.maximum(0.0, -np.gradient(zr, SAMPLE_M)) if len(zz) > 1 else np.zeros(len(zz))
    e = 0.002
    t = np.tanh(1.1 * np.log((S_l + e) / (S_r + e)))
    depth = mean_depth(area_km2) * np.exp(-0.85 * t)
    return pts, depth, t, S_l


def write_profile(ctx: _Ctx, z, human, restored_lines):
    """client/channel_profile.png (see the module docstring) and summary statistics."""
    from scipy.ndimage import distance_transform_edt
    n, res = ctx.n, ctx.res
    D = np.zeros((n, n), "float32")
    T = np.zeros((n, n), "float32")
    have = np.zeros((n, n), bool)
    best = np.full((n, n), -1.0, "float32")     # drainage area of the sample that wrote the cell
    stats = {"reaches": 0, "samples": 0, "riffle_share": 0.0, "pool_share": 0.0}
    tvals = []
    for f in ctx.load("hydro/channels.geojson"):
        pr = f["properties"]
        if pr.get("fcode") == 33600:
            continue
        line = ctx.local(shape(f["geometry"]))
        if line.geom_type != "LineString" or line.length < 1:
            continue
        a = pr.get("area_km2") or 0.15
        w = pr.get("width") or 1.6 * a ** 0.45
        pts, depth, t, _ = profile_along(ctx, z, line, a, w)
        stats["reaches"] += 1
        stats["samples"] += len(pts)
        tvals.append(t)
        c = np.clip((pts[:, 0] // res).astype(int), 0, n - 1)
        r = np.clip(((TILE_SIZE_M - pts[:, 1]) // res).astype(int), 0, n - 1)
        win = a >= best[r, c]                       # the bigger stream owns a shared cell (confluences)
        r, c = r[win], c[win]
        D[r, c] = depth[win]
        T[r, c] = t[win]
        best[r, c] = a
        have[r, c] = True
    if tvals:
        tv = np.concatenate(tvals)
        stats["riffle_share"] = round(float((tv > 0.33).mean()), 3)
        stats["pool_share"] = round(float((tv < -0.33).mean()), 3)
        stats["run_share"] = round(1 - stats["riffle_share"] - stats["pool_share"], 3)
    dist, (ir, ic) = distance_transform_edt(~have, return_indices=True)
    near = dist <= FILL_PX
    R = np.where(near, np.clip(np.round(D[ir, ic] / 0.02), 0, 255), 0).astype("uint8")
    G = np.where(near, np.clip(np.round((T[ir, ic] + 1) * 127.5), 0, 255), 0).astype("uint8")
    R[near & (R == 0)] = 1                      # a channel cell always reads as wet
    # B: the rewilded beds, with the riparian corridor along the restored channel through them
    B = np.zeros((n, n), "uint8")
    beds = [h["geom"] for h in human]
    if beds:
        bed = ctx.rasterize(beds).astype(bool)
        B[bed] = 255
        corr = [ln.buffer(CORRIDOR_M) for ln in restored_lines]
        if corr:
            cm = ctx.rasterize([shapely.union_all(corr).intersection(shapely.union_all(beds).buffer(2 * res))]).astype(bool)
            B[cm & bed] = 160
    Image.fromarray(np.dstack([R, G, B]), "RGB").save(ctx.tile.path("client/channel_profile.png"), optimize=True)
    dd = D[have]
    stats.update({"depth_m_p50": round(float(np.median(dd)), 3) if dd.size else None,
                  "depth_m_p95": round(float(np.percentile(dd, 95)), 3) if dd.size else None,
                  "depth_m_max": round(float(dd.max()), 3) if dd.size else None,
                  "bed_cells": int((B == 255).sum()), "corridor_cells": int((B == 160).sum())})
    return stats


# ---------------------------------------------------------------------------
# Step
# ---------------------------------------------------------------------------

def rewild_hydro(tile: Tile, force=False) -> dict:
    from .channels import BREACH_MAX_M, build_channels
    ctx = _Ctx(tile)
    # Judge against the present-day routing: snapshot hydro/channels.geojson the first time it is
    # present-day (the channels step writes "rewilded": true once this step has run), so a rerun
    # sees the same outlets and reaches as the first.
    ch = tile.dir / "hydro/channels.geojson"
    if ch.exists() and not json.load(open(ch)).get("rewilded"):
        import shutil
        shutil.copyfile(ch, tile.path(PRESENT))
    if not (tile.dir / PRESENT).exists():
        raise RuntimeError("rewild_hydro needs the present-day channels: run the channels step first")
    osm = fetch_osm_water(tile, force)
    osm_ok = osm is not None
    human, kept = identify(ctx, osm or [])
    z_rw, restored = carve_thalwegs(ctx, human)

    # derived DEM: original + carve (terrain/dem.tif is never written)
    prof = dict(ctx.profile)
    prof.update(dtype="float32", count=1, compress="deflate", predictor=3)
    with rasterio.open(tile.path("terrain/dem_rewilded.tif"), "w", **prof) as dst:
        dst.write(z_rw.astype("float32"), 1)
    diff = ctx.z - z_rw

    def write_list(breach_max):
        feats = []
        for rec, rw in [(h, True) for h in human] + [(k, False) for k in kept]:
            props = {k: v for k, v in rec.items() if k not in ("geom",)}
            props["rewilded"] = rw
            props["area_m2"] = round(rec["geom"].area, 1)
            feats.append({"type": "Feature", "geometry": mapping(ctx.wgs(rec["geom"])), "properties": props})
        write_json(tile.path("hydro/human_water.geojson"),
                   {"type": "FeatureCollection", "breach_max_m": breach_max, "features": feats})
    breach_max = BREACH_MAX_M
    write_list(breach_max)
    layers = build_channels(tile)
    # a dam the breach could not cut within its reach leaves water held in the bed: widen and rerun
    widened, prev = [], None
    for _ in range(2):
        chk = layers["hydro.channels"]["stats"].get("rewild_check", {})
        bad = sorted(pid for pid, c in chk.items() if (c["thalweg_held_fraction"] or 0) > HELD_FRACTION)
        if not bad:
            break
        if bad == prev:              # a longer reach did not free them: not a breach-length problem; go back
            widened[-1]["helped"] = False
            breach_max = widened[-1]["from_m"]
            write_list(breach_max)
            layers = build_channels(tile)
            break
        widened.append({"from_m": breach_max, "to_m": breach_max * 2, "held_water": bad})
        prev = bad
        breach_max *= 2
        write_list(breach_max)
        layers = build_channels(tile)
    chk = layers["hydro.channels"]["stats"].get("rewild_check", {})
    for h in human:
        if h.get("nhd_id") in chk:
            h["breach"] = chk[h["nhd_id"]]
    write_list(breach_max)

    pstats = write_profile(ctx, z_rw, human, restored)
    from .derive import client_features
    feats_layer = client_features(tile)

    def summary(rec):
        c = rec["geom"].centroid
        x0, y0, x1, y1 = rec["geom"].bounds
        out = {"id": rec["id"], "name": rec.get("name"), "kind": rec["kind"], "source": rec["source"],
               "area_m2": round(rec["geom"].area, 1), "centroid": [round(c.x, 1), round(c.y, 1)],
               "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)], "reasons": rec["reasons"]}
        if rec.get("nhd_id"):
            out["nhd_id"] = rec["nhd_id"]
        for k in ("carve", "breach"):
            if rec.get(k):
                out[k] = rec[k]
        return out
    area = sum(h["geom"].area for h in human)
    info = {
        "path": "hydro/human_water.geojson", "kind": "vector", "source": "nhdplus_hr",
        "derived_from": ["hydro.waterbodies", "hydro.channels", "footprint.mask", "terrain.dem"] + (["osm"] if osm_ok else []),
        "osm_water": "hydro/osm_water.geojson" if osm_ok else "unavailable (Overpass failed; NHD and the footprint's OSM reservoirs only)",
        "rule": (f"human: NHD FType 436; OSM water=reservoir/basin/wastewater or landuse=reservoir/basin; an OSM dam within "
                 f"{DAM_LINE_M:g} m (line) or {DAM_NODE_M:g} m (NID point); or a pond under {SMALL_POND_M2 / 1e4:g} ha whose ring is "
                 f"straight (>= {STRAIGHT_MIN_M:g} m, RMS <= {STRAIGHT_RMS:g} of its length) at its outlet with ground >= "
                 f"{DROP_MIN_M:g} m below the water 15-45 m beyond it (on a creek >= {CREEK_KEEP_KM2:g} km2: RMS <= "
                 f"{STRAIGHT_RMS_CREEK:g}, >= {DROP_MIN_CREEK_M:g} m). Everything else kept."),
        "rewilded": [summary(h) for h in human],
        "kept": [{"id": k["id"], "area_m2": round(k["geom"].area, 1), "centroid": [round(k["geom"].centroid.x, 1), round(k["geom"].centroid.y, 1)],
                  "reason": k["reasons"][0]} for k in kept],
        "counts": {"rewilded": len(human), "kept": len(kept),
                   "by_kind": {kind: sum(1 for h in human if h["kind"] == kind) for kind in sorted({h["kind"] for h in human})}},
        "rewilded_area_m2": round(area, 1),
        "breach_max_m": breach_max, "breach_widened": widened,
    }
    out = dict(layers)
    out["hydro.human_water"] = info
    out["terrain.dem_rewilded"] = {
        "path": "terrain/dem_rewilded.tif", "kind": "raster", "units": "m", "derived_from": ["terrain.dem", "hydro.human_water"],
        "modification": (f"terrain/dem.tif with a thalweg carved through each rewilded bed that has a channel: least-cost path "
                         f"down the middle of the old flat from each inflow to the outlet, lowered {INLET_CUT_M:g} m below the old "
                         f"water level at the inflow to {OUTLET_CUT_M:g} m at the outlet, parabolic {2 * THALWEG_HALF_M:g} m wide; "
                         "never raised. Routing (hydro.channels) runs on this copy; the client terrain does not show it."),
        "cells_lowered": int((diff > 1e-6).sum()), "max_cut_m": round(float(diff.max()), 2),
    }
    out["client.channel_profile"] = {
        "path": "client/channel_profile.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
        "pixels": ctx.n, "resolution_m": ctx.res, "derived_from": ["hydro.channels", "terrain.dem_rewilded", "hydro.human_water"],
        "encoding": ("RGB, row 0 north. R thalweg water depth, 2 cm units (0-5.1 m), 0 off channel; G riffle-pool index "
                     "(0 deepest pool, 128 run, 255 riffle; local width = reach width x (1 + 0.15 (G/127.5 - 1))); B rewilded "
                     f"water: 255 former open water (meadow or wet flat), 160 riparian corridor within {CORRIDOR_M:g} m of the "
                     f"restored channel, 0 elsewhere. R and G are spread {FILL_PX} px from each centreline."),
        "depth_model": ("mean depth 0.10 A^0.32 m (A km2) x exp(-0.85 t), t = tanh(1.1 ln((S_local + 0.002) / (S_reach + 0.002))); "
                        "S_local over max(7.5 m, 2.5 widths), S_reach over max(75 m, 10 widths), on the non-increasing DEM long profile every 2.5 m"),
        "stats": pstats,
    }
    if feats_layer:
        out["client.features"] = feats_layer
    print("rewild_hydro:", json.dumps({"rewilded": len(human), "kept": len(kept), "area_m2": round(area), "breach_max_m": breach_max,
                                       "widened": widened, "profile": pstats}))
    return out
