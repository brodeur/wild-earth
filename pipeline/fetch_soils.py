"""Soils: SSURGO map units for the tile from USDA NRCS Soil Data Access (SDA).

One SQL request per table, each keyed by the map units intersecting the tile polygon
(SDA_Get_Mukey_from_intersection_with_WktWgs84), plus one for the polygons themselves
(clipped server-side to the tile). For each map unit the dominant component (highest
comppct_r) gives taxonomy, slope, drainage, parent material, the surface horizon's
texture and rock fragments (chfrags fragvol_r summed), and depth to bedrock (shallowest
lithic or paralithic bedrock restriction, else the component's deepest horizon bottom).

Writes soils/mapunits.geojson (WGS84), soils/classes.json, client/soils.png (R = map unit
index, G = surface rock fragments % 0-100, B = depth to bedrock in dm, capped 255).
"""
from __future__ import annotations

import json
import re
import time

import numpy as np
import requests
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from shapely import wkt as shp_wkt
from shapely.geometry import mapping
from shapely.ops import transform as shp_transform

from .config import SOURCES, US_PUBLIC_DOMAIN, USER_AGENT, Tile, write_json
from .fetch_geology import GRID_PX, grid_transform, tile_polygon

SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
SOURCES["usda_ssurgo"] = {"name": "USDA NRCS SSURGO via Soil Data Access", "url": SDA, "license": "public domain",
                          "license_url": US_PUBLIC_DOMAIN,
                          # NRCS's requested citation, without the access date (that is `retrieved`).
                          "attribution": "Soils: Soil Survey Staff, Natural Resources Conservation Service, "
                                         "U.S. Department of Agriculture, Soil Survey Geographic (SSURGO) Database",
                          "attribution_url": "https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo",
                          "attribution_required": False}

BEDROCK_KINDS = ("lithic bedrock", "paralithic bedrock")
ORGANIC_TEXTURES = {"SPM", "MPM", "HPM", "PEAT", "MUCK", "MPT", "MUCKY"}
TEXTURES = {"COS": "coarse sand", "S": "sand", "FS": "fine sand", "VFS": "very fine sand",
            "LCOS": "loamy coarse sand", "LS": "loamy sand", "LFS": "loamy fine sand", "LVFS": "loamy very fine sand",
            "COSL": "coarse sandy loam", "SL": "sandy loam", "FSL": "fine sandy loam", "VFSL": "very fine sandy loam",
            "L": "loam", "SIL": "silt loam", "SI": "silt", "SCL": "sandy clay loam", "CL": "clay loam",
            "SICL": "silty clay loam", "SC": "sandy clay", "SIC": "silty clay", "C": "clay",
            "UWB": "bedrock", "WB": "weathered bedrock", "BR": "bedrock", "FRAG": "fragmental material",
            "SPM": "organic", "MPM": "organic", "HPM": "organic", "VAR": "variable"}
MODIFIERS = {"GR": "gravelly", "GRV": "very gravelly", "GRX": "extremely gravelly", "CB": "cobbly",
             "CBV": "very cobbly", "CBX": "extremely cobbly", "ST": "stony", "STV": "very stony",
             "STX": "extremely stony", "BY": "bouldery", "BYV": "very bouldery", "BYX": "extremely bouldery",
             "CN": "channery", "CNV": "very channery", "CNX": "extremely channery", "FL": "flaggy",
             "FLV": "very flaggy", "FLX": "extremely flaggy", "PGR": "paragravelly", "PGRV": "very paragravelly",
             "PCB": "paracobbly", "PCN": "parachannery", "SR": "stratified", "MK": "mucky", "ASHY": "ashy",
             "GRF": "fine gravelly", "CBA": "angular cobbly", "STA": "angular stony", "CEM": "cemented"}
ROCK_SURFACE = {"UWB", "BR"}   # unweathered / cemented bedrock at the surface counts as 100 % rock


def _sql(tile: Tile, name: str, query: str, force=False) -> list[dict]:
    cache = tile.path(f"_cache/sda/{name}.json")
    if cache.exists() and not force:
        return json.loads(cache.read_text())
    last = None
    for attempt in range(3):
        try:
            r = requests.post(SDA, json={"query": query, "format": "JSON+COLUMNNAME"},
                              headers={"User-Agent": USER_AGENT}, timeout=300)
            if r.status_code == 200:
                table = r.json().get("Table", []) if r.text.strip() else []
                rows = [dict(zip(table[0], row)) for row in table[1:]] if table else []
                cache.write_text(json.dumps(rows))
                time.sleep(0.5)   # polite
                return rows
            last = RuntimeError(f"SDA {r.status_code} for {name}: {r.text[:300]}")
            if r.status_code < 500:
                break
        except requests.RequestException as e:  # noqa: PERF203
            last = e
        time.sleep(5 * (attempt + 1))
    raise last  # type: ignore[misc]


def _f(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _texture(code: str | None, desc: str | None) -> tuple[str, str]:
    """('GRV-SL', 'Very gravelly sandy loam') -> ('sandy loam', 'very gravelly')."""
    if not code:
        return ("unknown", "none") if not desc else (desc.lower(), "none")
    toks = [t for t in re.split(r"[-\s]+", code.upper()) if t]
    bases = [t for t in toks if t in TEXTURES]
    mods = [MODIFIERS[t] for t in toks if t in MODIFIERS and t not in bases]
    base = bases[-1] if bases else None
    return (TEXTURES[base] if base else (desc or code).lower()), (" ".join(mods) if mods else "none")


def _base_code(code: str | None) -> str:
    toks = [t for t in re.split(r"[-\s]+", (code or "").upper()) if t in TEXTURES]
    return toks[-1] if toks else ""


def fetch_soils(tile: Tile, force=False) -> dict:
    tpoly = tile_polygon(tile)
    wkt = shp_wkt.dumps(tpoly, rounding_precision=6)
    keyset = f"SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('{wkt}')"
    cokeys = f"SELECT cokey FROM component WHERE mukey IN ({keyset})"
    chkeys = f"SELECT chkey FROM chorizon WHERE cokey IN ({cokeys})"

    mapunits = _sql(tile, "mapunit", f"SELECT mukey, musym, muname, mukind FROM mapunit WHERE mukey IN ({keyset})", force)
    if not mapunits:
        raise RuntimeError("SDA returned no map units for the tile")
    comps = _sql(tile, "component", "SELECT mukey, cokey, compname, comppct_r, compkind, majcompflag, taxorder, "
                 "taxsubgrp, taxclname, slope_r, drainagecl, localphase FROM component "
                 f"WHERE mukey IN ({keyset})", force)
    hzs = _sql(tile, "chorizon", f"SELECT cokey, chkey, hzname, hzdept_r, hzdepb_r FROM chorizon WHERE cokey IN ({cokeys})", force)
    texs = _sql(tile, "chtexturegrp", f"SELECT chkey, texture, texdesc, rvindicator FROM chtexturegrp WHERE chkey IN ({chkeys})", force)
    frags = _sql(tile, "chfrags", f"SELECT chkey, fragvol_r, fragkind, fragsize_r FROM chfrags WHERE chkey IN ({chkeys})", force)
    restr = _sql(tile, "corestrictions", f"SELECT cokey, reskind, resdept_r FROM corestrictions WHERE cokey IN ({cokeys})", force)
    pms = _sql(tile, "copmgrp", f"SELECT cokey, pmgroupname, rvindicator FROM copmgrp WHERE cokey IN ({cokeys})", force)
    polys = _sql(tile, "mupolygon",
                 "SELECT mukey, mupolygonkey, mupolygongeo.STIntersection(geometry::STGeomFromText("
                 f"'{wkt}', 4326)).STAsText() AS wkt FROM mupolygon WHERE mupolygonkey IN "
                 f"(SELECT * FROM SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84('{wkt}'))", force)

    by_mu: dict[str, list[dict]] = {}
    for c in comps:
        by_mu.setdefault(c["mukey"], []).append(c)
    hz_by_co: dict[str, list[dict]] = {}
    for h in hzs:
        hz_by_co.setdefault(h["cokey"], []).append(h)
    tex_by_ch: dict[str, list[dict]] = {}
    for t in texs:
        tex_by_ch.setdefault(t["chkey"], []).append(t)
    frag_by_ch: dict[str, float] = {}
    for fr in frags:
        frag_by_ch[fr["chkey"]] = frag_by_ch.get(fr["chkey"], 0.0) + (_f(fr["fragvol_r"]) or 0.0)
    res_by_co: dict[str, list[dict]] = {}
    for r in restr:
        res_by_co.setdefault(r["cokey"], []).append(r)
    pm_by_co: dict[str, list[dict]] = {}
    for p in pms:
        pm_by_co.setdefault(p["cokey"], []).append(p)

    attrs: dict[str, dict] = {}
    for mu in mapunits:
        mk = mu["mukey"]
        cs = sorted(by_mu.get(mk, []), key=lambda c: -(_f(c["comppct_r"]) or 0))
        outcrop_pct = sum(_f(c["comppct_r"]) or 0 for c in cs if "rock outcrop" in (c["compname"] or "").lower())
        a = {"mukey": mk, "musym": mu["musym"], "muname": mu["muname"], "mukind": mu["mukind"],
             "rock_outcrop_pct": outcrop_pct, "source": "usda_ssurgo", "licence": "public domain"}
        if not cs:
            attrs[mk] = {**a, "texture_class": "none", "texture_modifier": "none", "rock_fragments_pct": 0,
                         "depth_to_bedrock_cm": None, "bedrock_restriction": False}
            continue
        d = cs[0]
        horizons = sorted(hz_by_co.get(d["cokey"], []), key=lambda h: _f(h["hzdept_r"]) or 0)
        surf, tex = None, None
        for h in horizons:
            rv = [t for t in tex_by_ch.get(h["chkey"], []) if t["rvindicator"] == "Yes"] or tex_by_ch.get(h["chkey"], [])
            code = rv[0]["texture"] if rv else None
            base = _base_code(code)
            if base in ORGANIC_TEXTURES and h is not horizons[-1]:
                continue   # skip duff/litter to the first mineral horizon
            surf, tex = h, (rv[0] if rv else None)
            break
        bedrock = [_f(r["resdept_r"]) for r in res_by_co.get(d["cokey"], [])
                   if (r["reskind"] or "").lower() in BEDROCK_KINDS and _f(r["resdept_r"]) is not None]
        max_depth = max((_f(h["hzdepb_r"]) or 0 for h in horizons), default=None)
        misc_rock = "rock outcrop" in (d["compname"] or "").lower()
        rock_land = "rock land" in (d["compname"] or "").lower()
        rock_surface = bool(tex) and _base_code(tex["texture"]) in ROCK_SURFACE
        if bedrock:
            depth, restricted = min(bedrock), True
        elif misc_rock:
            depth, restricted = 0.0, True
        else:
            depth, restricted = max_depth, False
        tclass, tmod = _texture(tex["texture"] if tex else None, tex["texdesc"] if tex else None)
        if misc_rock and not tex:
            tclass, tmod = "rock outcrop", "none"
        if not tex and (mu["muname"] or "").strip().lower() == "water":
            tclass = "water"
        frag = frag_by_ch.get(surf["chkey"], 0.0) if surf else (100.0 if misc_rock else 0.0)
        if rock_surface or misc_rock:
            frag, depth, restricted = 100.0, 0.0, True
        pm = [p for p in pm_by_co.get(d["cokey"], []) if p["rvindicator"] == "Yes"] or pm_by_co.get(d["cokey"], [])
        attrs[mk] = {**a, "component": d["compname"], "comppct_r": _f(d["comppct_r"]), "compkind": d["compkind"],
                     "taxorder": d["taxorder"], "taxsubgrp": d["taxsubgrp"], "taxclname": d["taxclname"],
                     "surface_horizon": surf["hzname"] if surf else None,
                     "surface_texture": tex["texdesc"] if tex else None, "surface_texture_code": tex["texture"] if tex else None,
                     "texture_class": tclass, "texture_modifier": tmod, "rock_land": rock_land or misc_rock or rock_surface,
                     "rock_fragments_pct": round(min(frag, 100.0), 1),
                     "depth_to_bedrock_cm": depth, "bedrock_restriction": restricted,
                     "component_depth_cm": max_depth, "parent_material": pm[0]["pmgroupname"] if pm else None,
                     "slope_r": _f(d["slope_r"]), "drainage": d["drainagecl"]}

    # Map units in descending tile area get indices 1..N.
    feats, area = [], {}
    fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    shapes = []
    for p in polys:
        if not p["wkt"]:
            continue
        g = shp_wkt.loads(p["wkt"])
        if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon", "GeometryCollection"):
            continue
        if g.geom_type == "GeometryCollection":
            from shapely.ops import unary_union
            g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
            if g.is_empty:
                continue
        gu = shp_transform(fwd.transform, g)
        area[p["mukey"]] = area.get(p["mukey"], 0.0) + gu.area
        shapes.append((gu, p["mukey"]))
        feats.append({"type": "Feature", "geometry": mapping(g),
                      "properties": {"mupolygonkey": p["mupolygonkey"], **attrs.get(p["mukey"], {"mukey": p["mukey"]})}})
    order = sorted(area, key=lambda k: -area[k])
    if len(order) > 255:
        raise RuntimeError(f"{len(order)} map units exceed the 8-bit index")
    index = {mk: i for i, mk in enumerate(order, 1)}
    for f in feats:
        f["properties"]["class_index"] = index.get(f["properties"]["mukey"])
    write_json(tile.path("soils/mapunits.geojson"), {"type": "FeatureCollection", "features": feats})

    tr = grid_transform(tile)
    idx = rasterize([(g, index[mk]) for g, mk in shapes], out_shape=(GRID_PX, GRID_PX), transform=tr, fill=0, dtype="uint8")
    frag_lut = np.zeros(256, "uint8")
    depth_lut = np.full(256, 255, "uint8")
    for mk, i in index.items():
        a = attrs.get(mk, {})
        frag_lut[i] = int(round(a.get("rock_fragments_pct") or 0))
        d = a.get("depth_to_bedrock_cm")
        depth_lut[i] = 255 if d is None else int(min(255, round(d / 10)))
    Image.fromarray(np.dstack([idx, frag_lut[idx], depth_lut[idx]]), "RGB").save(tile.path("client/soils.png"), optimize=True)

    total = idx.size
    classes = {}
    for mk, i in index.items():
        a = {k: v for k, v in attrs.get(mk, {"mukey": mk}).items() if k not in ("source", "licence")}
        classes[str(i)] = {**a, "fraction": round(float((idx == i).sum() / total), 4)}
    write_json(tile.path("soils/classes.json"), {
        "encoding": "client/soils.png R = index here, G = rock_fragments_pct, B = depth_to_bedrock_cm / 10 (255 = none/unknown)",
        "rules": {"dominant_component": "highest comppct_r", "surface_horizon": "shallowest horizon, skipping organic litter",
                  "rock_fragments": "sum of chfrags.fragvol_r in the surface horizon; 100 where the surface is "
                                    "unweathered bedrock (rock land) or the dominant component is Rock outcrop",
                  "depth_to_bedrock": f"min corestrictions.resdept_r for reskind in {list(BEDROCK_KINDS)}; "
                                      "else deepest horizon bottom (bedrock_restriction false); 0 for Rock outcrop"},
        "mapunits": classes})

    return {
        "soils.mapunits": {"path": "soils/mapunits.geojson", "kind": "vector", "source": "usda_ssurgo",
                           "feature_count": len(feats), "mapunits": len(index), "licence": "public domain",
                           "fetch": {"endpoint": SDA, "requests": 8}},
        "soils.classes": {"path": "soils/classes.json", "kind": "table", "source": "usda_ssurgo"},
        "client.soils": {"path": "client/soils.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                         "pixels": GRID_PX, "resolution_m": 10000 / GRID_PX, "derived_from": "soils.mapunits",
                         "encoding": "R = soil map unit index (soils/classes.json; 0 none), G = surface rock fragments % 0-100, "
                                     "B = depth to bedrock dm (255 = none or unknown)",
                         "nodata_fraction": round(float((idx == 0).sum() / total), 4)},
    }
