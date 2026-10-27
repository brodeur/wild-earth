"""Named places from OpenStreetMap (Overpass) for the client: client/features.json `places`.

One Overpass query for the tile's place nodes (city, town, village, suburb, neighbourhood, hamlet, locality),
cached in _cache/overpass_places.json like the footprint query (fetch_osm.overpass: the same mirrors, backoff
and User-Agent). Each place is { name, kind, x, north } in tile-local metres (x east, north from the south
edge), as the roads are. The opening screen titles a tile's card with its best-ranked place (PLACE_RANK, ties
to the one nearest the tile centre; client/src/arrival.js), and the client's place names (placenames.js)
read them as points.

derive.client_features calls places() when it writes features.json. For a tile already built:

    python -m pipeline.fetch_places <tile_id> [--force]

rewrites only features.json's `places` (and `places_source`) and refreshes the manifest's client.features
layer (sha256, bytes, counts.places, places_from).
"""
from __future__ import annotations

import argparse
import json

from pyproj import Transformer

from .config import Tile, read_json, sha256, write_json
from .fetch_osm import overpass

KINDS = ("city", "town", "village", "suburb", "neighbourhood", "hamlet", "locality")
PLACE_RANK = {k: i for i, k in enumerate(KINDS)}   # lower ranks first
QUERY = """[out:json][timeout:120];
node["place"~"^({kinds})$"]["name"]({s},{w},{n},{e});
out body;"""
PLACES_BUDGET_S = 600   # a tile build waits this long at most for the mirrors, then goes on without places


def places(tile: Tile, *, force=False, budget_s: float | None = PLACES_BUDGET_S) -> tuple[list[dict], dict]:
    """(places, source note) for the tile, best-ranked first, then nearest the centre."""
    w, s, e, n = tile.bounds_wgs84
    data = overpass(QUERY.format(kinds="|".join(KINDS), s=s, w=w, n=n, e=e), tile.path("_cache/overpass_places.json"),
                    force=force, budget_s=budget_s, label="osm places")
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    size = x1 - x0
    out = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind, name = tags.get("place"), tags.get("name")
        if el.get("type") != "node" or kind not in PLACE_RANK or not name:
            continue
        x, y = to_tile.transform(el["lon"], el["lat"])
        x, y = x - x0, y - y0
        if not (0 <= x <= size and 0 <= y <= y1 - y0):
            continue   # the bbox in degrees reaches a little past the UTM square
        out.append({"name": name, "kind": kind, "x": round(x, 1), "north": round(y, 1), "osm_id": el.get("id")})
    c = size / 2
    out.sort(key=lambda p: (PLACE_RANK[p["kind"]], (p["x"] - c) ** 2 + (p["north"] - c) ** 2))
    note = {"source": "osm", "query": "node[place~city|town|village|suburb|neighbourhood|hamlet|locality][name]",
            "osm_base": (data.get("osm3s") or {}).get("timestamp_osm_base")}
    return out, note


def places_or_none(tile: Tile) -> tuple[list[dict], dict | None]:
    """places() for a build: an Overpass outage leaves the tile without places rather than failing it."""
    try:
        return places(tile)
    except Exception as ex:  # noqa: BLE001
        print(f"osm places: skipped ({str(ex)[:200]})", flush=True)
        return [], None


def refresh(tile_id: str, force=False) -> dict:
    """Rewrite features.json's places for a built tile and refresh its manifest layer."""
    tile = Tile.from_id(tile_id)
    fp = tile.path("client/features.json")
    feats = read_json(fp)
    ps, note = places(tile, force=force)
    feats["places"], feats["places_source"] = ps, note
    with open(fp, "w") as f:   # compact, as derive.client_features writes it
        json.dump(feats, f, separators=(",", ":"))
    mp = tile.path("manifest.json")
    m = read_json(mp)
    layer = m["layers"].get("client.features")
    if layer is not None:
        layer.setdefault("counts", {})["places"] = len(ps)
        layer["places_from"] = "osm"
        if "osm" not in layer.get("derived_from", []):
            layer.setdefault("derived_from", []).append("osm")
        layer["sha256"], layer["bytes"] = sha256(fp), fp.stat().st_size
        write_json(mp, m)
    return {"tile": tile_id, "places": len(ps), "best": ps[0] if ps else None,
            "osm_source_recorded": "osm" in m.get("sources", {})}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tiles", nargs="+")
    ap.add_argument("--force", action="store_true", help="query Overpass again instead of using the cache")
    a = ap.parse_args()
    for t in a.tiles:
        print(json.dumps(refresh(t, force=a.force)))


if __name__ == "__main__":
    main()
