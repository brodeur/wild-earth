"""Indigenous territories from Native Land Digital (native-land.ca) for the client: client/territories.json.

The start screen names, on the row under a place's name, the territories Native Land's map draws over the tile
(client/src/title.js, arrival.js). Five point queries, the tile's centre and its four corners, to the territories map
(https://native-land.ca/api/index.php?maps=territories&position=lat,lng), the answers cached in
_cache/native_land.json and merged by slug: each territory is { name, slug, url }, the ones more of the five points
fall in first. The API needs a free account's key: NATIVE_LAND_KEY (or NATIVE_LAND_API_KEY) in the environment or the git-ignored .env (copy
.env.example; from a git worktree, which has no .env of its own, the main checkout's .env is read). The key is never
printed, logged or written anywhere.

The `territories` step of the build graph (pipeline/steps.py, 2026-11-06) runs step_output: it writes
client/territories.json { territories, source } (the manifest layer client.territories). Without a key the step is
recorded `refused` ("no Native Land key"), not done: --status and the build audit report it until a key is there and
the step has run, so a tile never passes with its territories silently missing. Before the step, derive wrote them
into features.json (and wrote none without a key); the client reads territories.json and falls back to that. Native Land asks that their map not be taken for official or legal boundaries of
any Indigenous nation: that disclaimer is in the source's attribution (config.SOURCES native_land), which the credits
show first. For a tile already built:
    python -m pipeline.fetch_territories <tile_id> [--force]
runs the graph's territories step on it (--force asks Native Land again instead of the cache).
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


def env_files() -> list[str]:
    """The .env files to look in: this checkout's, then (in a git worktree) the main checkout's."""
    out = [os.path.join(ROOT, ".env")]
    try:
        import subprocess
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            main = os.path.join(os.path.dirname(common), ".env")
            if os.path.abspath(main) != os.path.abspath(out[0]):
                out.append(main)
    except Exception:  # noqa: BLE001
        pass
    return out


KEY_NAMES = ("NATIVE_LAND_KEY", "NATIVE_LAND_API_KEY")   # either name; the first wins (2026-11-06: Aaron's .env has the second)


def api_key() -> str:
    """The Native Land key (KEY_NAMES, in order) from the environment, else from a .env (env_files); '' when there is
    none. Never printed."""
    for name in KEY_NAMES:
        k = os.environ.get(name, "").strip()
        if k:
            return k
    for path in env_files():
        if not os.path.exists(path):
            continue
        found = {}
        with open(path) as f:
            for line in f:
                line = line.strip()
                for name in KEY_NAMES:
                    if line.startswith(name + "=") and name not in found:
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if v:
                            found[name] = v
        for name in KEY_NAMES:
            if name in found:
                return found[name]
    return ""


NO_KEY = "no Native Land key (NATIVE_LAND_KEY or NATIVE_LAND_API_KEY): the territories cannot be fetched (a free Native Land account's key in .env; see .env.example)"


# Entries of Native Land's map whose drawn polygon is plainly wrong, left out with the reason (kept in each tile's
# territories source note, `excluded`, so it shows): checked against the geometry the API returns, 2026-11-06.
EXCLUDED = {
    "cayuse-umatilla-and-walla-walla": "its polygon on Native Land's map spans 124.8 W to 104.6 W and 38.6 N to 50.1 N, most of "
                                       "the American West, far past the Cayuse, Umatilla and Walla Walla homelands on the "
                                       "Columbia Plateau (a drawing error in their data; it named the Sierra foothills, the "
                                       "Olympic coast, the Tetons and Lamar)",
}


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
        return [], {"source": "native_land", "status": "no key (NATIVE_LAND_KEY or NATIVE_LAND_API_KEY unset; see .env.example)"}
    cache = tile.path("_cache/native_land.json")
    w, s, e, n = tile.bounds_wgs84
    points = [((s + n) / 2, (w + e) / 2), (s, w), (s, e), (n, w), (n, e)]
    data = read_json(cache) if cache.exists() and not force else None
    if data is None:
        data = {"points": [], "retrieved": today()}
        for lat, lon in points:
            # the key travels in the query string, so neither the URL nor requests' own messages (which quote it) may
            # reach a log, the manifest or the console: a failure says only its HTTP status or its kind
            try:
                r = requests.get(API, params={"maps": "territories", "position": f"{lat:.5f},{lon:.5f}", "key": key},
                                 headers={"User-Agent": UA}, timeout=40)
            except requests.RequestException as ex:
                raise RuntimeError(f"native-land request failed ({type(ex).__name__})") from None
            if r.status_code != 200:
                raise RuntimeError(f"native-land answered HTTP {r.status_code}")
            try:
                body = r.json()
            except ValueError:
                raise RuntimeError("native-land answered with something that is not JSON") from None
            if isinstance(body, dict) and body.get("error"):
                raise RuntimeError(f"native-land: {body.get('error')}")
            data["points"].append({"lat": round(lat, 5), "lon": round(lon, 5), "features": parse(body if isinstance(body, list) else body.get("features", []))})
        write_json(cache, data)
    hits: dict[str, dict] = {}
    excluded = {}
    for pt in data["points"]:
        for t in pt["features"]:
            if t["slug"] in EXCLUDED:
                excluded[t["slug"]] = {"name": t["name"], "slug": t["slug"], "why": EXCLUDED[t["slug"]]}
                continue
            h = hits.setdefault(t["slug"], {**t, "points": 0})
            h["points"] += 1
    out = sorted(hits.values(), key=lambda t: (-t["points"], t["name"]))
    note = {"source": "native_land", "positions": len(points), "retrieved": data.get("retrieved"),
            "disclaimer": "Native Land's map does not represent or intend to represent official or legal boundaries of any Indigenous nation",
            **({"excluded": list(excluded.values())} if excluded else {})}
    return out, note


def step_output(tile: Tile, force=False) -> dict:
    """The territories step's body: client/territories.json and its layer record. Refused without a key."""
    from . import runlog
    if not api_key():
        raise runlog.Refused(NO_KEY)
    ts, note = territories(tile, force=force)
    fp = tile.path("client/territories.json")
    fp.parent.mkdir(parents=True, exist_ok=True)
    with open(fp, "w") as f:
        json.dump({"territories": ts, "source": note}, f, separators=(",", ":"))
    return {"path": "client/territories.json", "kind": "json", "source": "native_land", "counts": {"territories": len(ts)},
            "retrieved": note.get("retrieved")}


def refresh(tile_id: str, force=False) -> dict:
    """Run the graph's territories step on a built tile (its manifest record, fingerprint and layer kept as a build keeps them)."""
    from .steps import build
    return build(Tile.from_id(tile_id), steps=["territories"], force={"territories"} if force else set())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tile_id")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    print(json.dumps(refresh(a.tile_id, force=a.force), indent=1))


if __name__ == "__main__":
    main()
