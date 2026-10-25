"""Bedrock geology: map units for the tile from the Macrostrat API, falling back to the
USGS State Geologic Map Compilation (SGMC) feature service, mapped to rock classes.

Macrostrat's `geologic_units/map` answers point queries only (no bbox), but each answer
carries the whole polygon. So the tile is sampled on a coarse grid, then every part of the
tile not yet covered is queried at its representative point until the tile is covered.
The finest Burwell scale that answers at every sample point is used, and within it the
State Geologic Map Compilation (source 133) when present.

Writes geology/units.geojson (WGS84), geology/classes.json, client/geology.png
(R = unit index, G = rock class index, on the 30 m vegetation grid).
"""
from __future__ import annotations

import json
import re
import time

import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from .config import CC_BY_4, SOURCES, USGS_CREDITS, Tile, write_json
from .http import get

MACROSTRAT = "https://macrostrat.org/api/v2/geologic_units/map"
SGMC = ("https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/"
        "SB_5888bf4fe4b05ccb964bab9d_USGS_SGMC_feature/FeatureServer/3")
SCALES = ["large", "medium", "small", "tiny"]
PREFERRED_SOURCES = [133]          # Macrostrat source_id of the SGMC (USGS DS 1052)
GRID_N = 5                         # initial sample grid per side
GRID_PX = 333                      # the 30 m vegetation grid (10 000 m / 333)

# Macrostrat asks for credit to Macrostrat and to the original map; CC BY 4.0 also asks that changes
# be indicated. Each unit's original map reference is in units.geojson `reference`.
SOURCES["macrostrat"] = {"name": "Macrostrat API geologic_units/map (Burwell map compilation)",
                         "url": MACROSTRAT, "license": "CC-BY 4.0 (Macrostrat); SGMC polygons public domain",
                         "license_url": CC_BY_4,
                         "attribution": "Geology: Macrostrat (macrostrat.org), CC BY 4.0, from the USGS State Geologic "
                                        "Map Compilation; clipped to the tile and reclassified",
                         "attribution_url": "https://macrostrat.org",
                         "attribution_required": True}
SOURCES["usgs_sgmc"] = {"name": "USGS State Geologic Map Compilation (Horton et al. 2017, DS 1052, doi:10.3133/ds1052)",
                        "url": SGMC, "license": "public domain", "license_url": USGS_CREDITS,
                        "attribution": "Geology: Horton, J.D., San Juan, C.A., and Stoeser, D.B., 2017, The State Geologic "
                                       "Map Compilation (SGMC) geodatabase of the conterminous United States, "
                                       "U.S. Geological Survey Data Series 1052",
                        "attribution_url": "https://doi.org/10.3133/ds1052",
                        "attribution_required": False}

ROCK_CLASSES = ["greenstone_metavolcanic", "serpentinite", "slate_phyllite", "schist", "granitic",
                "volcanic", "sandstone_conglomerate", "limestone_marble", "alluvium", "other"]
RESISTANCE = {"greenstone_metavolcanic": 0.9, "granitic": 0.8, "serpentinite": 0.8, "schist": 0.6,
              "slate_phyllite": 0.6, "volcanic": 0.7, "sandstone_conglomerate": 0.4,
              "limestone_marble": 0.7, "alluvium": 0.0, "other": 0.4}

# Keyword rules, tried in this order against each major lithology, then the name, then the
# description. Old volcanic rocks (bottom age >= 145 Ma, Jurassic or older) count as
# metavolcanic: in the accreted terranes of the Sierra foothills they are greenstone.
RULES = [
    ("serpentinite", r"serpentin|ultramafic|peridotit|dunite|harzburgite|pyroxenite"),
    ("greenstone_metavolcanic", r"greenstone|meta-?volcanic|metabasalt|meta-?andesite|amphibolite|spilite"),
    ("slate_phyllite", r"slate|phyllite|argillite"),
    ("schist", r"schist|gneiss|hornfels|quartzite|metasediment"),
    ("limestone_marble", r"limestone|marble|dolomite|dolostone|carbonate"),
    ("granitic", r"granit|granodiorit|tonalit|diorit|monzonit|syenit|gabbro|trondhjemit|plutonic|intrusive|pegmatit|aplite"),
    ("volcanic", r"volcanic|andesit|basalt|rhyolit|dacit|tuff|pyroclastic|lahar|mudflow|latite"),
    ("alluvium", r"alluvi|terrace|alluvial fan|unconsolidated|colluvi|landslide|surficial|\bgravels?\b|\bsands?\b"),
    ("sandstone_conglomerate", r"sandstone|conglomerate|gr[ae]ywacke|siltstone|mudstone|shale|breccia|clastic|sedimentary"),
]
OLD_VOLCANIC_MA = 145.0
QUATERNARY_MA = 2.58


def rock_class(majors: list[str], name: str, descrip: str, b_age: float | None, t_age: float | None) -> str:
    for text in [*majors, name or "", descrip or ""]:
        t = text.lower()
        if not t.strip():
            continue
        if t.strip() == "water":
            return "other"
        for cls, pat in RULES:
            if re.search(pat, t):
                if cls == "volcanic" and b_age is not None and b_age >= OLD_VOLCANIC_MA:
                    return "greenstone_metavolcanic"
                if cls == "sandstone_conglomerate" and b_age is not None and b_age <= QUATERNARY_MA:
                    return "alluvium"
                return cls
    return "other"


def tile_polygon(tile: Tile, buffer_m=60.0, per_side=20) -> Polygon:
    """The rotated UTM square in WGS84, densified, buffered outward a little."""
    x0, y0, x1, y1 = tile.bounds
    x0, y0, x1, y1 = x0 - buffer_m, y0 - buffer_m, x1 + buffer_m, y1 + buffer_m
    t = np.linspace(0, 1, per_side, endpoint=False)
    ring = ([(x0 + (x1 - x0) * s, y0) for s in t] + [(x1, y0 + (y1 - y0) * s) for s in t]
            + [(x1 - (x1 - x0) * s, y1) for s in t] + [(x0, y1 - (y1 - y0) * s) for s in t])
    inv = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True)
    return Polygon([inv.transform(x, y) for x, y in ring])


def _macrostrat_point(tile: Tile, lon: float, lat: float) -> list[dict]:
    cache = tile.path(f"_cache/macrostrat/pt_{lat:.5f}_{lon:.5f}.json")
    if cache.exists():
        return json.loads(cache.read_text())
    r = get(MACROSTRAT, {"lat": f"{lat:.6f}", "lng": f"{lon:.6f}", "format": "geojson"}, timeout=120).json()
    if "success" not in r:
        raise RuntimeError(f"Macrostrat error: {str(r)[:300]}")
    data = r["success"]["data"]
    feats = data.get("features", []) if isinstance(data, dict) else []
    cache.write_text(json.dumps(feats))
    time.sleep(0.25)   # polite
    return feats


def _parse_macrostrat_lith(lith: str) -> tuple[list[str], str]:
    """'Major:{slate,graywacke}, Minor:{siltstone}' -> (['slate', 'graywacke'], 'Major: slate, graywacke; Minor: siltstone')."""
    groups = re.findall(r"(\w+):\{([^}]*)\}", lith or "")
    if not groups:
        parts = [p.strip() for p in (lith or "").split(",") if p.strip()]
        return parts[:3], lith or ""
    majors = []
    for k, v in groups:
        if k.lower() == "major":
            majors = [p.strip() for p in v.split(",") if p.strip()]
    return majors, "; ".join(f"{k}: {', '.join(p.strip() for p in v.split(','))}" for k, v in groups)


def _from_macrostrat(tile: Tile, tpoly: Polygon) -> tuple[list[dict], dict]:
    fwd = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    pts = [fwd.transform(x0 + (i + 0.5) * (x1 - x0) / GRID_N, y0 + (j + 0.5) * (y1 - y0) / GRID_N)
           for j in range(GRID_N) for i in range(GRID_N)]
    answers = [_macrostrat_point(tile, lon, lat) for lon, lat in pts]
    requests = len(pts)

    # Finest scale answering at every sample point; within it the preferred source.
    scale_cover = {s: sum(any(f["properties"].get("scale") == s for f in a) for a in answers) for s in SCALES}
    full = [s for s in SCALES if scale_cover[s] == len(pts)]
    if not full:
        raise RuntimeError(f"no Macrostrat scale covers the tile: {scale_cover}")
    scale = full[0]
    src_cover: dict[int, int] = {}
    for a in answers:
        for sid in {f["properties"]["source_id"] for f in a if f["properties"].get("scale") == scale}:
            src_cover[sid] = src_cover.get(sid, 0) + 1
    ranked = sorted(src_cover, key=lambda s: (s not in PREFERRED_SOURCES, -src_cover[s], s))
    source_id = ranked[0]

    def pick(feats):
        return [f for f in feats if f["properties"].get("scale") == scale and f["properties"]["source_id"] == source_id]

    polys: dict[int, dict] = {}
    for a in answers:
        for f in pick(a):
            polys[f["properties"]["map_id"]] = f
    holes = []
    for _ in range(80):
        covered = unary_union([shape(f["geometry"]).buffer(0) for f in polys.values()]) if polys else Polygon()
        gap = tpoly.difference(covered)
        for h in holes:
            gap = gap.difference(h)
        pieces = [g for g in getattr(gap, "geoms", [gap]) if not g.is_empty and g.area > 1e-8]
        if not pieces:
            break
        piece = max(pieces, key=lambda g: g.area)
        p = piece.representative_point()
        got = pick(_macrostrat_point(tile, p.x, p.y))
        requests += 1
        new = [f for f in got if f["properties"]["map_id"] not in polys and shape(f["geometry"]).buffer(0).contains(p)]
        if new:
            for f in new:
                polys[f["properties"]["map_id"]] = f
        else:
            holes.append(piece.buffer(1e-5))

    features = []
    for f in polys.values():
        pr = f["properties"]
        majors, lith = _parse_macrostrat_lith(pr.get("lith", ""))
        b_age = pr.get("b_age") or pr.get("b_int_age")
        t_age = pr.get("t_age") or pr.get("t_int_age")
        b_int, t_int = pr.get("b_int_name"), pr.get("t_int_name")
        age = (b_int if b_int == t_int else f"{b_int} to {t_int}") if b_int else pr.get("best_int_name")
        features.append({"geom": shape(f["geometry"]).buffer(0), "props": {
            "name": pr.get("name"), "strat_name": pr.get("strat_name") or None, "lithology": lith,
            "lith_major": majors, "description": pr.get("descrip") or None, "age": age,
            "age_best": pr.get("best_int_name"),
            "age_bottom_ma": b_age, "age_top_ma": t_age, "color": pr.get("color"),
            "map_id": pr["map_id"], "source": "macrostrat", "macrostrat_source_id": source_id,
            "macrostrat_scale": scale, "licence": "public domain (USGS SGMC) via Macrostrat, CC-BY 4.0"
            if source_id == 133 else "CC-BY 4.0 (Macrostrat)",
            "reference": (pr.get("comments") or "").split("Original map source:")[-1].strip() or None}})
    meta = {"source": "macrostrat", "endpoint": MACROSTRAT, "scale": scale, "macrostrat_source_id": source_id,
            "scale_coverage_of_sample_points": scale_cover, "sample_points": len(pts), "requests": requests,
            "uncovered_pieces": len(holes)}
    return features, meta


_ICS = {"quaternary": (0, 2.58), "pleistocene": (0.0117, 2.58), "tertiary": (2.58, 66), "neogene": (2.58, 23.03),
        "pliocene": (2.58, 5.333), "miocene": (5.333, 23.03), "paleogene": (23.03, 66), "oligocene": (23.03, 33.9),
        "eocene": (33.9, 56), "paleocene": (56, 66), "cretaceous": (66, 145), "jurassic": (145, 201.4),
        "triassic": (201.4, 251.9), "permian": (251.9, 298.9), "carboniferous": (298.9, 358.9),
        "devonian": (358.9, 419.2), "silurian": (419.2, 443.8), "ordovician": (443.8, 485.4),
        "cambrian": (485.4, 538.8), "neoproterozoic": (538.8, 1000), "mesoproterozoic": (1000, 1600),
        "paleoproterozoic": (1600, 2500)}


def _sgmc_age(s: str | None) -> tuple[str | None, float | None, float | None]:
    if not s:
        return None, None, None
    parts = [p.strip() for p in s.split(" - ")]
    last = parts[-1].lower().replace("-", " ")
    for word in reversed(last.split() + [p.lower() for p in parts[::-1]]):
        for k, (lo, hi) in _ICS.items():
            if k in word:
                return parts[-1].replace("-", " "), lo, hi
    return parts[-1], None, None


def _from_sgmc(tile: Tile) -> tuple[list[dict], dict]:
    w, s, e, n = tile.bounds_wgs84
    fields = "UNIT_LINK,UNIT_NAME,ORIG_LABEL,AGE_MIN,AGE_MAX,MAJOR1,MAJOR2,MAJOR3,MINOR1,MINOR2,MINOR3,INCIDENTAL,GENERALIZED_LITH,REFERENCE"
    feats, offset = [], 0
    while True:
        r = get(f"{SGMC}/query", {
            "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "outSR": 4326,
            "geometryPrecision": 6, "maxAllowableOffset": 0.0001, "resultOffset": offset,
            "resultRecordCount": 200, "f": "geojson"}, timeout=300).json()
        if "error" in r:
            raise RuntimeError(f"SGMC query error: {r['error']}")
        batch = r.get("features", [])
        feats.extend(batch)
        if len(batch) < 200:
            break
        offset += len(batch)
    out = []
    for f in feats:
        pr = f["properties"]
        majors = [pr[k] for k in ("MAJOR1", "MAJOR2", "MAJOR3") if pr.get(k)]
        minors = [pr[k] for k in ("MINOR1", "MINOR2", "MINOR3") if pr.get(k)]
        lith = "; ".join(x for x in [f"Major: {', '.join(majors)}" if majors else "",
                                     f"Minor: {', '.join(minors)}" if minors else "",
                                     f"Incidental: {pr['INCIDENTAL']}" if pr.get("INCIDENTAL") else ""] if x)
        tname, t_lo, _ = _sgmc_age(pr.get("AGE_MIN"))
        bname, _, b_hi = _sgmc_age(pr.get("AGE_MAX"))
        out.append({"geom": shape(f["geometry"]).buffer(0), "props": {
            "name": pr.get("UNIT_NAME"), "strat_name": pr.get("ORIG_LABEL"), "lithology": lith,
            "lith_major": [m.lower() for m in majors], "description": pr.get("GENERALIZED_LITH"),
            "age": bname if bname == tname else f"{bname} to {tname}", "age_bottom_ma": b_hi, "age_top_ma": t_lo,
            "color": None, "unit_link": pr.get("UNIT_LINK"), "source": "usgs_sgmc", "licence": "public domain",
            "reference": pr.get("REFERENCE")}})
    return out, {"source": "usgs_sgmc", "endpoint": SGMC, "requests": offset // 200 + 1}


def grid_transform(tile: Tile, px=GRID_PX):
    from rasterio.transform import from_bounds
    x0, y0, x1, y1 = tile.bounds
    return from_bounds(x0, y0, x1, y1, px, px)


def fetch_geology(tile: Tile, force=False, prefer="macrostrat") -> dict:
    tpoly = tile_polygon(tile)
    errors = []
    features = meta = None
    order = ["macrostrat", "usgs_sgmc"] if prefer == "macrostrat" else ["usgs_sgmc", "macrostrat"]
    for src in order:
        try:
            features, meta = _from_macrostrat(tile, tpoly) if src == "macrostrat" else _from_sgmc(tile)
            if features:
                break
            errors.append(f"{src}: no features")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{src}: {e}")
            print(f"geology source {src} failed: {e}")
    if not features:
        raise RuntimeError("geology unavailable: " + "; ".join(errors))
    meta["fallback_errors"] = errors

    # Clip to the tile, group polygons into units.
    units: dict[tuple, int] = {}
    unit_rows = []
    out_feats = []
    for f in features:
        g = f["geom"].intersection(tpoly)
        if g.is_empty or g.area < 1e-10:
            continue
        p = f["props"]
        key = (p["name"], p["lithology"], p["age"])
        if key not in units:
            units[key] = len(unit_rows) + 1
            rc = rock_class(p["lith_major"], p["name"] or "", p["description"] or "", p["age_bottom_ma"], p["age_top_ma"])
            unit_rows.append({"name": p["name"], "lithology": p["lithology"], "age": p["age"],
                              "age_bottom_ma": p["age_bottom_ma"], "age_top_ma": p["age_top_ma"],
                              "rock_class": rc, "rock_class_index": ROCK_CLASSES.index(rc) + 1,
                              "water": (p["name"] or "").strip().lower() == "water",
                              "description": p["description"], "reference": p["reference"], "color": p["color"]})
        p = {**p, "unit_index": units[key], "rock_class": unit_rows[units[key] - 1]["rock_class"]}
        out_feats.append({"type": "Feature", "geometry": mapping(g), "properties": p})

    write_json(tile.path("geology/units.geojson"), {"type": "FeatureCollection", "features": out_feats})

    # Rasterise unit index onto the 30 m grid (tile CRS).
    fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    tr = grid_transform(tile)
    shapes = [(shp_transform(fwd.transform, shape(f["geometry"])), f["properties"]["unit_index"]) for f in out_feats]
    # Larger polygons first so small ones (inliers) win.
    shapes.sort(key=lambda s: -s[0].area)
    unit = rasterize(shapes, out_shape=(GRID_PX, GRID_PX), transform=tr, fill=0, dtype="uint8")
    rc_lut = np.zeros(256, "uint8")
    for i, row in enumerate(unit_rows, 1):
        rc_lut[i] = row["rock_class_index"]
    rcls = rc_lut[unit]
    Image.fromarray(np.dstack([unit, rcls, np.zeros_like(unit)]), "RGB").save(tile.path("client/geology.png"), optimize=True)

    total = unit.size
    for i, row in enumerate(unit_rows, 1):
        row["fraction"] = round(float((unit == i).sum() / total), 4)
    fractions = {c: round(float((rcls == i).sum() / total), 4) for i, c in enumerate(ROCK_CLASSES, 1) if (rcls == i).any()}
    classes = {"rock_classes": ROCK_CLASSES, "resistance": RESISTANCE,
               "units": {str(i): r for i, r in enumerate(unit_rows, 1)}, "rules": [list(r) for r in RULES],
               "rule_notes": f"first match over major lithologies, then name, then description; volcanic with bottom "
                             f"age >= {OLD_VOLCANIC_MA} Ma -> greenstone_metavolcanic; clastic sedimentary with "
                             f"bottom age <= {QUATERNARY_MA} Ma -> alluvium; 'water' -> other",
               "source": meta}
    write_json(tile.path("geology/classes.json"), classes)

    src = meta["source"]
    sources_used = ["macrostrat", "usgs_sgmc"] if (src == "macrostrat" and meta.get("macrostrat_source_id") == 133) else [src]
    return {
        "geology.units": {"path": "geology/units.geojson", "kind": "vector", "source": src, "sources_used": sources_used,
                          "feature_count": len(out_feats), "units": len(unit_rows), "fetch": meta,
                          "licence": out_feats[0]["properties"]["licence"] if out_feats else None},
        "geology.classes": {"path": "geology/classes.json", "kind": "table", "source": src},
        "client.geology": {"path": "client/geology.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                           "pixels": GRID_PX, "resolution_m": 10000 / GRID_PX, "derived_from": "geology.units",
                           "encoding": "R = geology unit index (geology/classes.json units; 0 none), "
                                       "G = rock class index (1-based into rock_classes)",
                           "rock_class_fractions": fractions},
    }
