"""Human footprint mask from OpenStreetMap via Overpass.

Marks what to erase and backfill. Each feature carries `class` and `buffer_m`
(half-width used when rasterising lines).
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from .config import USER_AGENT, Tile, write_json
from .http import post

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

ROAD_HALF_WIDTH = {
    "motorway": 18, "motorway_link": 8, "trunk": 14, "trunk_link": 7, "primary": 10,
    "primary_link": 6, "secondary": 8, "secondary_link": 5, "tertiary": 6, "tertiary_link": 4,
    "residential": 5, "unclassified": 5, "living_street": 4, "service": 3, "track": 2.5,
    "path": 1, "footway": 1, "cycleway": 1.5, "bridleway": 1.5, "steps": 1,
}

QUERY = """
[out:json][timeout:180][bbox:{s},{w},{n},{e}];
(
  way["building"];
  relation["building"];
  way["highway"];
  way["railway"~"^(rail|light_rail|narrow_gauge|disused|abandoned)$"];
  way["power"="line"];
  way["waterway"~"^(canal|ditch)$"];
  way["landuse"~"^(quarry|industrial|orchard|vineyard|farmland|farmyard|landfill)$"];
  relation["landuse"~"^(quarry|industrial|orchard|vineyard|farmland|landfill)$"];
  way["man_made"~"^(dam|reservoir_covered|pipeline|wastewater_plant|water_works)$"];
  way["water"="reservoir"];
  relation["water"="reservoir"];
  way["natural"="water"]["water"="reservoir"];
  way["aeroway"];
  way["leisure"~"^(golf_course|pitch|park|sports_centre)$"];
);
out geom;
"""


def classify(tags: dict) -> tuple[str, float] | None:
    if "building" in tags:
        return "building", 0
    if "highway" in tags:
        return "road", ROAD_HALF_WIDTH.get(tags["highway"], 3)
    if "railway" in tags:
        return "rail", 4
    if tags.get("power") == "line":
        return "power", 2
    if tags.get("waterway") in ("canal", "ditch"):
        return "canal", 2
    if tags.get("landuse") in ("quarry", "landfill") or tags.get("man_made") == "dam":
        return "mine" if tags.get("landuse") == "quarry" else "other", 0
    if tags.get("landuse") in ("orchard", "vineyard", "farmland", "farmyard"):
        return "agriculture", 0
    if tags.get("water") == "reservoir":
        return "reservoir", 0
    if tags.get("landuse") == "industrial" or tags.get("aeroway") or tags.get("leisure"):
        return "cleared", 0
    if tags.get("man_made"):
        return "other", 2
    return None


def _ring(geom) -> list[list[float]]:
    return [[p["lon"], p["lat"]] for p in geom]


def to_features(elements: list[dict]) -> list[dict]:
    feats = []
    for el in elements:
        tags = el.get("tags", {})
        cls = classify(tags)
        if not cls:
            continue
        klass, buf = cls
        props = {"class": klass, "buffer_m": buf, "source": "osm",
                 "osm_id": f"{el['type']}/{el['id']}", "name": tags.get("name")}
        for k in ("highway", "building", "landuse", "railway", "power", "waterway", "water"):
            if k in tags:
                props[k] = tags[k]
        if el["type"] == "way" and el.get("geometry"):
            ring = _ring(el["geometry"])
            closed = len(ring) > 3 and ring[0] == ring[-1]
            areal = klass in ("building", "mine", "agriculture", "reservoir", "cleared") or (
                closed and "highway" not in tags and "railway" not in tags)
            geom = ({"type": "Polygon", "coordinates": [ring]} if (closed and areal)
                    else {"type": "LineString", "coordinates": ring})
            feats.append({"type": "Feature", "geometry": geom, "properties": props})
        elif el["type"] == "relation":
            outers = [_ring(m["geometry"]) for m in el.get("members", [])
                      if m.get("role") == "outer" and m.get("geometry")]
            for ring in outers:
                if len(ring) > 3:
                    if ring[0] != ring[-1]:
                        ring.append(ring[0])
                    feats.append({"type": "Feature",
                                  "geometry": {"type": "Polygon", "coordinates": [ring]},
                                  "properties": props})
    return feats


# Overpass mirrors are often at capacity (502/504) for many minutes; a tile build waits for them
# rather than failing. Each round tries every mirror once (requests, then the system curl, whose
# TLS some mirrors need), then backs off 60 s, 120 s, ... (capped at 10 min) until the budget ends.
OVERPASS_BUDGET_S = float(os.environ.get("WE_OVERPASS_BUDGET_S", 3600))


def _answer(data) -> dict:
    """An Overpass JSON answer, or raise if it is an error or a truncated (timed-out) result."""
    if not isinstance(data, dict) or "elements" not in data:
        raise RuntimeError("not an Overpass JSON answer")
    remark = data.get("remark") or ""
    if "runtime error" in remark or "Query timed out" in remark or "out of memory" in remark:
        raise RuntimeError(f"Overpass remark: {remark[:200]}")
    return data


def overpass(query: str, cache: Path | None = None, *, force=False, budget_s: float | None = None,
             label="overpass") -> dict:
    """Run an Overpass query over the mirrors with backoff; cache the raw answer if `cache` is given."""
    if cache is not None and cache.exists() and not force:
        return json.loads(cache.read_text())
    budget = OVERPASS_BUDGET_S if budget_s is None else budget_s
    t0, wait, rnd, last = time.time(), 60.0, 0, None
    while True:
        rnd += 1
        for url in MIRRORS:
            try:
                data = _answer(post(url, {"data": query}, timeout=240, retries=1).json())
            except Exception as ex:  # noqa: BLE001
                last = ex
                try:
                    out = subprocess.run(["curl", "-s", "-f", "-m", "230", "-A", USER_AGENT, url,
                                          "--data-urlencode", f"data={query}"],
                                         capture_output=True, timeout=240, check=True).stdout
                    data = _answer(json.loads(out))
                except Exception as ex2:  # noqa: BLE001
                    last = f"{str(ex)[:160]} / curl: {str(ex2)[:120]}"
                    print(f"{label}: round {rnd} {url} failed: {last}", flush=True)
                    continue
            if cache is not None:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(data))
            print(f"{label}: {url} answered in round {rnd} after {time.time() - t0:.0f}s", flush=True)
            return data
        if time.time() - t0 + wait > budget:
            raise RuntimeError(f"all Overpass mirrors failed for {time.time() - t0:.0f}s ({rnd} rounds): {last}")
        print(f"{label}: all mirrors failed in round {rnd}; retrying in {wait:.0f}s", flush=True)
        time.sleep(wait)
        wait = min(wait * 2, 600.0)


def fetch_osm(tile: Tile, force=False) -> dict:
    out = tile.path("footprint/mask.geojson")
    w, s, e, n = tile.bounds_wgs84
    q = QUERY.format(s=s, w=w, n=n, e=e)
    data = overpass(q, tile.path("_cache/overpass_footprint.json"), force=force, label="osm")
    feats = to_features(data.get("elements", []))
    counts: dict[str, int] = {}
    for f in feats:
        counts[f["properties"]["class"]] = counts.get(f["properties"]["class"], 0) + 1
    write_json(out, {"type": "FeatureCollection", "features": feats})
    return {"path": "footprint/mask.geojson", "kind": "vector", "source": "osm",
            "feature_count": len(feats), "class_counts": counts,
            "osm_base": (data.get("osm3s") or {}).get("timestamp_osm_base")}
