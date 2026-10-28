"""Indigenous territories from Native Land Digital (native-land.ca) for the client: client/features.json `territories`.

The start screen names, under a tile's locality and roads, the territories Native Land's map draws over the tile
(client/src/arrival.js). Five point queries, the tile's centre and its four corners, to the territories map
(https://native-land.ca/api/index.php?maps=territories&position=lat,lng), the answers cached in
_cache/native_land.json and merged by slug: each territory is { name, slug, url }, the ones more of the five points
fall in first. The API needs a free account's key: NATIVE_LAND_KEY in the environment or the git-ignored .env (copy
.env.example); without one the tile has no territories and the note says so, and nothing fails. The key is never
printed, logged or written anywhere. Native Land asks that their map not be taken for official or legal boundaries of
any Indigenous nation: that disclaimer is in the source's attribution (config.SOURCES native_land), which the credits
show first. derive.client_features calls territories_or_none() when it writes features.json. For a tile already
built:
    python -m pipeline.fetch_territories <tile_id> [--force]
rewrites only features.json's `territories` (and `territories_source`) and refreshes the manifest's client.features
layer and the native_land source.
"""
from __future__ import annotations
import argparse
import json
import os
import requests
from .config import Tile, read_json, sha256, today, write_json

API = "https://native-land.ca/api/index.php"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "wild-earth-pipeline/0.1 (https://github.com/aaronbrodeur/wild-earth)"


def api_key() -> str:
    """NATIVE_LAND_KEY from the environment, else from the repository's .env; '' when there is none."""
    k = os.environ.get("NATIVE_LAND_KEY", "").strip()
    if k:
        return k
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("NATIVE_LAND_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def parse(features: list) -> list[dict]:
    """The API's features (GeoJSON, properties Name / Slug / description) as { name, slug, url }, in the order given."""
    out = []
    for ft in features or []:
        pr = ft.get("properties") or {}
        name = pr.get("Name") or pr.get("name")
        if not name:
            continue
        slug = pr.get("Slug") or pr.get("slug") or name.lower().replace(" ", "-")
        url = pr.get("description") or pr.get("url") or f"https://native-land.ca/maps/territories/{slug}/"
        out.append({"name": name, "slug": slug, "url": url})
    return out


def territories(tile: Tile, *, force=False) -> tuple[list[dict], dict]:
    """(territories, source note) for the tile: the centre and the four corners, merged by slug."""
    key = api_key()
    if not key:
        return [], {"source": "native_land", "status": "no key (NATIVE_LAND_KEY unset; see .env.example)"}
    cache = tile.path("_cache/native_land.json")
    w, s, e, n = tile.bounds_wgs84
    points = [((s + n) / 2, (w + e) / 2), (s, w), (s, e), (n, w), (n, e)]
    data = read_json(cache) if cache.exists() and not force else None
    if data is None:
        data = {"points": [], "retrieved": today()}
        for lat, lon in points:
            r = requests.get(API, params={"maps": "territories", "position": f"{lat:.5f},{lon:.5f}", "key": key},
                             headers={"User-Agent": UA}, timeout=40)
            r.raise_for_status()
            body = r.json()
            if isinstance(body, dict) and body.get("error"):
                raise RuntimeError(f"native-land: {body.get('error')}")
            data["points"].append({"lat": round(lat, 5), "lon": round(lon, 5), "features": parse(body if isinstance(body, list) else body.get("features", []))})
        write_json(cache, data)
    hits: dict[str, dict] = {}
    for pt in data["points"]:
        for t in pt["features"]:
            h = hits.setdefault(t["slug"], {**t, "points": 0})
            h["points"] += 1
    out = sorted(hits.values(), key=lambda t: (-t["points"], t["name"]))
    note = {"source": "native_land", "positions": len(points), "retrieved": data.get("retrieved"),
            "disclaimer": "Native Land's map does not represent or intend to represent official or legal boundaries of any Indigenous nation"}
    return out, note


def territories_or_none(tile: Tile) -> tuple[list[dict], dict | None]:
    """territories() for a build: an outage or a bad key leaves the tile without them rather than failing it."""
    try:
        return territories(tile)
    except Exception as ex:  # noqa: BLE001
        print(f"native-land territories: skipped ({str(ex)[:160]})", flush=True)
        return [], {"source": "native_land", "status": "skipped"}


def refresh(tile_id: str, force=False) -> dict:
    """Rewrite features.json's territories for a built tile and refresh its manifest layer and source."""
    from .build_tile import record_source
    tile = Tile.from_id(tile_id)
    fp = tile.path("client/features.json")
    feats = read_json(fp)
    ts, note = territories(tile, force=force)
    feats["territories"], feats["territories_source"] = ts, note
    with open(fp, "w") as f:
        json.dump(feats, f, separators=(",", ":"))
    mp = tile.path("manifest.json")
    m = read_json(mp)
    layer = m["layers"].get("client.features")
    if layer is not None:
        layer.setdefault("counts", {})["territories"] = len(ts)
        if ts:
            layer.setdefault("sources_used", [])
            if "native_land" not in layer["sources_used"]:
                layer["sources_used"].append("native_land")
            record_source(m, "native_land")
        layer["sha256"], layer["bytes"] = sha256(fp), fp.stat().st_size
        write_json(mp, m)
    return {"tile": tile_id, "territories": [t["name"] for t in ts], "note": note}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tile_id")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    print(json.dumps(refresh(a.tile_id, force=a.force), indent=1))


if __name__ == "__main__":
    main()
