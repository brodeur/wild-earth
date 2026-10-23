"""Hydrology: NHDPlus HR flowlines and waterbodies, with an OSM fallback.

The USGS MapServer times out on big pages, so queries are slim and paged at 200.
"""
from __future__ import annotations

from .config import SOURCES, Tile, write_json
from .http import get

PLUS = SOURCES["nhdplus_hr"]["url"]
FLOWLINE_LAYER, WATERBODY_LAYER = 3, 9  # NetworkNHDFlowline, NHDWaterbody
FLOWLINE_FIELDS = "permanent_identifier,gnis_name,fcode,ftype,lengthkm,streamorde,totdasqkm"
WATERBODY_FIELDS = "permanent_identifier,gnis_name,fcode,ftype,areasqkm"
PAGE = 200


def _query(layer_id: int, tile: Tile, fields: str) -> list[dict]:
    w, s, e, n = tile.bounds_wgs84
    feats, offset = [], 0
    while True:
        r = get(f"{PLUS}/{layer_id}/query", {
            "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "outSR": 4326,
            "geometryPrecision": 6, "resultOffset": offset, "resultRecordCount": PAGE, "f": "geojson",
        }, timeout=180, retries=4).json()
        if "error" in r:
            raise RuntimeError(f"NHD query error: {r['error']}")
        batch = r.get("features", [])
        for f in batch:
            f["properties"] = {k.lower(): v for k, v in f["properties"].items()}
        feats.extend(batch)
        if len(batch) < PAGE or not r.get("properties", {}).get("exceededTransferLimit", True):
            break
        offset += len(batch)
    return feats


def _osm_fallback(tile: Tile) -> tuple[list[dict], list[dict]]:
    from .fetch_osm import MIRRORS, _ring
    from .http import post
    w, s, e, n = tile.bounds_wgs84
    q = f"""[out:json][timeout:180][bbox:{s},{w},{n},{e}];
(way["waterway"~"^(river|stream)$"]; way["natural"="water"]; relation["natural"="water"];); out geom;"""
    data = None
    for url in MIRRORS:
        try:
            data = post(url, {"data": q}).json()
            break
        except Exception:  # noqa: BLE001
            continue
    if data is None:
        raise RuntimeError("OSM hydro fallback failed on all mirrors")
    flow, water = [], []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        props = {"gnis_name": tags.get("name"), "fcode": None, "ftype": tags.get("waterway") or tags.get("water"),
                 "source": "osm", "osm_id": f"{el['type']}/{el['id']}"}
        if el["type"] == "way" and el.get("geometry"):
            ring = _ring(el["geometry"])
            if "waterway" in tags:
                flow.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": ring}, "properties": props})
            elif len(ring) > 3:
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                water.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props})
        elif el["type"] == "relation":
            for m in el.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    ring = _ring(m["geometry"])
                    if len(ring) > 3:
                        if ring[0] != ring[-1]:
                            ring.append(ring[0])
                        water.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props})
    return flow, water


def fetch_hydro(tile: Tile, force=False) -> dict:
    source = "nhdplus_hr"
    try:
        flow = _query(FLOWLINE_LAYER, tile, FLOWLINE_FIELDS)
        water = _query(WATERBODY_LAYER, tile, WATERBODY_FIELDS)
    except Exception as e:  # noqa: BLE001
        print(f"NHDPlus HR failed ({e}); falling back to OSM waterways")
        flow, water = _osm_fallback(tile)
        source = "osm"
    write_json(tile.path("hydro/flowlines.geojson"), {"type": "FeatureCollection", "features": flow})
    write_json(tile.path("hydro/waterbodies.geojson"), {"type": "FeatureCollection", "features": water})
    reservoirs = [f["properties"].get("gnis_name") for f in water
                  if str(f["properties"].get("fcode") or "").startswith("436")]
    return {
        "hydro.flowlines": {"path": "hydro/flowlines.geojson", "kind": "vector", "source": source,
                            "feature_count": len(flow)},
        "hydro.waterbodies": {"path": "hydro/waterbodies.geojson", "kind": "vector", "source": source,
                              "feature_count": len(water), "reservoirs": reservoirs},
    }
