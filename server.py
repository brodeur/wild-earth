"""Wild Earth dev server: static files from the repo root plus a small tile API.

    .venv/bin/python server.py --port 8781 --bind 127.0.0.1

GET  /api/tiles               tiles/index.json
POST /api/tile  {lon, lat}    which tile holds this point, and is it built
POST /api/build {lon, lat} | {tile_id} [, steps]   build it in the background
GET  /api/build/<tile_id>     build progress
GET  /api/edits/<tile_id>     the manifest's append-only `edits` log (a JSON array)
POST /api/edits/<tile_id>  [edit, ...]   validate, stamp (id, at) and append to the log

Edit types and their fields (note is optional unless marked required):
  species_confidence  species_code, value: verified | flagged, note
  species_note        species_code, note (required)
  mask_polygon        class: mine | canal | agriculture | cleared | other,
                      geometry: GeoJSON Polygon in WGS84, note
  place_note          note (required), geometry: GeoJSON Point or Polygon (optional)
Any edit may carry client_at (when it was made, if it waited in a browser first).
Other fields are dropped.

Privacy: a lon/lat is snapped to its tile and dropped. It is never logged or stored;
the request log prints method, path without query, and status only. Request bodies
(edits carry free-text notes) are never logged, and errors name the field, not the value.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import threading
import uuid
import warnings
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

os.environ.setdefault("PYTHONWARNINGS", "ignore")
warnings.filterwarnings("ignore")

from pipeline.build_tile import ALL_STEPS, run, update_index  # noqa: E402
from pipeline.config import REPO_ROOT, TILES_DIR, Tile, now_iso, read_json  # noqa: E402

JOBS: dict[str, dict] = {}   # tile_id -> {status, steps, current, started_at}
LOCK = threading.Lock()
EDIT_LOCK = threading.Lock()   # serialises manifest read-modify-write for edits
APPENDED: dict[str, list] = {}  # tile_id -> edits this process appended (re-applied after builds)
TILE_ID_RE = re.compile(r"^utm\d{1,2}[ns]_\d{1,4}_\d{1,5}$")

MAX_BODY = 1_000_000
MAX_EDITS = 200          # per request
MAX_NOTE = 2000          # characters
MAX_VERTICES = 5000
BOUNDS_SLACK_DEG = 0.02  # vertices may sit ~2 km outside the tile (edge features)
MASK_CLASSES = {"mine", "canal", "agriculture", "cleared", "other"}
CONFIDENCE = {"verified", "flagged"}
EDIT_TYPES = {"species_confidence", "species_note", "mask_polygon", "place_note"}


def manifest(tile_id: str) -> dict | None:
    p = TILES_DIR / tile_id / "manifest.json"
    return read_json(p) if p.exists() else None


def write_manifest(tile_id: str, m: dict) -> None:
    """Atomic replace, same format as pipeline.config.write_json."""
    p = TILES_DIR / tile_id / "manifest.json"
    tmp = p.with_name(f".manifest.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w") as f:
        json.dump(m, f, indent=1)
        f.write("\n")
    os.replace(tmp, p)


# -- edit validation: messages name the field and index, never the submitted value
def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _text(e: dict, key: str, where: str, required: bool, limit: int = MAX_NOTE) -> str | None:
    v = e.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise ValueError(f"{where}: {key} is required")
        return None
    if not isinstance(v, str):
        raise ValueError(f"{where}: {key} must be a string")
    v = v.strip()
    if len(v) > limit:
        raise ValueError(f"{where}: {key} longer than {limit} characters")
    return v


def _position(pt, where: str, bounds) -> list[float]:
    if not (isinstance(pt, list) and len(pt) in (2, 3) and all(_num(c) for c in pt)):
        raise ValueError(f"{where}: positions must be [lon, lat]")
    lon, lat = float(pt[0]), float(pt[1])
    w, s, e, n = bounds
    k = BOUNDS_SLACK_DEG
    if not (w - k <= lon <= e + k and s - k <= lat <= n + k):
        raise ValueError(f"{where}: position outside the tile (WGS84 lon, lat expected)")
    return [round(lon, 7), round(lat, 7)]


def _geometry(g, where: str, bounds, kinds: tuple[str, ...]) -> dict:
    if not isinstance(g, dict) or g.get("type") not in kinds:
        raise ValueError(f"{where}: geometry must be a GeoJSON {' or '.join(kinds)}")
    c = g.get("coordinates")
    if g["type"] == "Point":
        return {"type": "Point", "coordinates": _position(c, where, bounds)}
    if not (isinstance(c, list) and c and all(isinstance(r, list) for r in c)):
        raise ValueError(f"{where}: Polygon coordinates must be a list of rings")
    rings, total = [], 0
    for ring in c:
        pts = [_position(p, where, bounds) for p in ring]
        if pts and pts[0] != pts[-1]:
            pts.append(list(pts[0]))           # close an open ring
        if len({tuple(p) for p in pts}) < 3:
            raise ValueError(f"{where}: a polygon ring needs at least 3 distinct vertices")
        total += len(pts)
        rings.append(pts)
    if total > MAX_VERTICES:
        raise ValueError(f"{where}: polygon has more than {MAX_VERTICES} vertices")
    return {"type": "Polygon", "coordinates": rings}


def _species_code(e: dict, where: str) -> str:
    v = e.get("species_code")
    if not (isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", v)):
        raise ValueError(f"{where}: species_code is required (letters, digits, _ . -)")
    return v


def clean_edit(e, i: int, bounds) -> dict:
    """Validate one submitted edit and return only the fields its type keeps."""
    where = f"edit {i}"
    if not isinstance(e, dict):
        raise ValueError(f"{where}: must be an object")
    t = e.get("type")
    if t not in EDIT_TYPES:
        raise ValueError(f"{where}: type must be one of {sorted(EDIT_TYPES)}")
    out: dict = {"type": t}
    if t == "species_confidence":
        out["species_code"] = _species_code(e, where)
        if e.get("value") not in CONFIDENCE:
            raise ValueError(f"{where}: value must be one of {sorted(CONFIDENCE)}")
        out["value"] = e["value"]
        note = _text(e, "note", where, False)
    elif t == "species_note":
        out["species_code"] = _species_code(e, where)
        note = _text(e, "note", where, True)
    elif t == "mask_polygon":
        if e.get("class") not in MASK_CLASSES:
            raise ValueError(f"{where}: class must be one of {sorted(MASK_CLASSES)}")
        out["class"] = e["class"]
        out["geometry"] = _geometry(e.get("geometry"), where, bounds, ("Polygon",))
        note = _text(e, "note", where, False)
    else:  # place_note
        note = _text(e, "note", where, True)
        if e.get("geometry") is not None:
            out["geometry"] = _geometry(e["geometry"], where, bounds, ("Point", "Polygon"))
    if note:
        out["note"] = note
    client_at = _text(e, "client_at", where, False, limit=40)
    if client_at:
        out["client_at"] = client_at
    return out


def _merge_appended(tile_id: str, m: dict) -> int:
    """Re-add edits this process appended that the manifest no longer has. Returns count."""
    have = {e.get("id") for e in m.get("edits", [])}
    missing = [e for e in APPENDED.get(tile_id, []) if e["id"] not in have]
    if missing:
        m.setdefault("edits", []).extend(missing)
        m["edits"].sort(key=lambda e: e.get("at", ""))
        print(f"[server] restored {len(missing)} edit(s) to {tile_id} (manifest was rewritten without them)", flush=True)
    return len(missing)


def append_edits(tile_id: str, submitted: list) -> tuple[list, int]:
    """Validate all, then append all (or nothing). Returns (stamped edits, log length)."""
    with EDIT_LOCK:
        m = manifest(tile_id)
        if m is None:
            raise LookupError(tile_id)
        _merge_appended(tile_id, m)
        bounds = m["bounds_wgs84"]
        cleaned = [clean_edit(e, i, bounds) for i, e in enumerate(submitted)]
        at = now_iso()
        stamped = [{"id": uuid.uuid4().hex[:12], "at": at, **e} for e in cleaned]
        m.setdefault("edits", []).extend(stamped)
        write_manifest(tile_id, m)
        APPENDED.setdefault(tile_id, []).extend(stamped)
        return stamped, len(m["edits"])


def restore_edits(tile_id: str) -> dict | None:
    """A pipeline step holds the manifest in memory for the whole step and then rewrites
    it, so edits posted meanwhile are lost (also when the pipeline runs from the command
    line). Put back any this process appended; called after each build step and on every
    edits request. Returns the manifest as it now stands."""
    with EDIT_LOCK:
        m = manifest(tile_id)
        if m is not None and APPENDED.get(tile_id) and _merge_appended(tile_id, m):
            write_manifest(tile_id, m)
        return m


def is_built(tile_id: str) -> bool:
    """Built means playable: the manifest exists and has the client rasters."""
    m = manifest(tile_id)
    return bool(m and "client.heights" in m.get("layers", {}))


def running_job() -> str | None:
    return next((t for t, j in JOBS.items() if j["status"] == "running"), None)


def build_worker(tile: Tile, steps: list[str]) -> None:
    job = JOBS[tile.tile_id]
    warnings.filterwarnings("ignore")
    try:
        for step in steps:   # one step per run() call so the current step is visible
            job["current"] = step
            m = run(tile, [step])
            restore_edits(tile.tile_id)
            last = m["log"][-1]
            job["steps"].append({"step": step, "ok": last["ok"], "seconds": last["seconds"]})
        ok = all(s["ok"] for s in job["steps"])
        job["status"] = "done" if ok else "failed"
    except Exception as e:  # noqa: BLE001
        job["status"], job["error"] = "failed", str(e)[:300]
    job["current"] = None
    job["playable"] = is_built(tile.tile_id)
    print(f"[server] build {tile.tile_id} {job['status']}", flush=True)


class Handler(SimpleHTTPRequestHandler):
    # -- logging: never print the query string (it may hold a lon/lat)
    def log_request(self, code="-", size="-"):
        code = getattr(code, "value", code)
        print(f"{self.command} {urlsplit(self.path).path} {code}", flush=True)

    def end_headers(self):
        path = urlsplit(self.path).path
        if path.endswith((".html", ".js", ".json", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # -- helpers
    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body_any(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("body too large")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def body_json(self) -> dict:
        data = self.body_any()
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    @staticmethod
    def tile_from(data: dict) -> Tile:
        if data.get("tile_id"):
            try:
                return Tile.from_id(str(data["tile_id"]))
            except (ValueError, IndexError):
                raise ValueError("bad tile_id") from None
        try:
            lon, lat = float(data["lon"]), float(data["lat"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("need lon and lat") from None
        if not (-180 <= lon <= 180 and -80 <= lat <= 84):
            raise ValueError("lon/lat out of range (UTM covers lat -80..84)")
        return Tile.from_anchor(lon, lat)   # the point itself goes no further

    # -- routes
    def do_GET(self):
        u = urlsplit(self.path)
        if u.path == "/api/tiles":
            if not (TILES_DIR / "index.json").exists():
                update_index()
            return self.send_json(read_json(TILES_DIR / "index.json"))
        if u.path == "/api/tile":
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            return self.api_tile(q)
        if u.path.startswith("/api/build/"):
            tile_id = u.path.rsplit("/", 1)[1]
            with LOCK:
                job = JOBS.get(tile_id)
                if job:
                    return self.send_json({"tile_id": tile_id, **job})
            if manifest(tile_id):
                return self.send_json({"tile_id": tile_id, "status": "built" if is_built(tile_id) else "partial"})
            return self.send_json({"tile_id": tile_id, "status": "unknown"}, 404)
        if u.path.startswith("/api/edits/"):
            tile_id = u.path.rsplit("/", 1)[1]
            m = restore_edits(tile_id) if TILE_ID_RE.match(tile_id) else None
            if m is None:
                return self.send_json({"error": "unknown tile"}, 404)
            return self.send_json(m.get("edits", []))
        if u.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/edits/"):
            return self.api_edits(path.rsplit("/", 1)[1])
        try:
            data = self.body_json()
            if path == "/api/tile":
                return self.api_tile(data)
            if path == "/api/build":
                return self.api_build(data)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        self.send_json({"error": "not found"}, 404)

    def api_edits(self, tile_id: str):
        if not TILE_ID_RE.match(tile_id) or manifest(tile_id) is None:
            return self.send_json({"error": "unknown tile"}, 404)
        try:
            data = self.body_any()
            if isinstance(data, dict) and isinstance(data.get("edits"), list):
                data = data["edits"]
            if not isinstance(data, list) or not data:
                raise ValueError("body must be a non-empty JSON array of edits")
            if len(data) > MAX_EDITS:
                raise ValueError(f"at most {MAX_EDITS} edits per request")
            added, count = append_edits(tile_id, data)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except LookupError:
            return self.send_json({"error": "unknown tile"}, 404)
        print(f"[server] edits {tile_id} +{len(added)} ({', '.join(sorted({e['type'] for e in added}))})", flush=True)
        self.send_json({"tile_id": tile_id, "added": added, "count": count})

    def api_tile(self, data: dict):
        try:
            tile = self.tile_from(data)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        with LOCK:
            building = JOBS.get(tile.tile_id, {}).get("status") == "running"
        self.send_json({"tile_id": tile.tile_id, "bounds_wgs84": list(tile.bounds_wgs84),
                        "built": is_built(tile.tile_id), "building": building})

    def api_build(self, data: dict):
        tile = self.tile_from(data)
        steps = data.get("steps") or ALL_STEPS
        if not isinstance(steps, list) or any(s not in ALL_STEPS for s in steps):
            raise ValueError(f"steps must be a list drawn from {ALL_STEPS}")
        tid = tile.tile_id
        with LOCK:
            busy = running_job()
            if busy == tid:
                return self.send_json({"tile_id": tid, "status": "already_running"})
            if busy:
                return self.send_json({"tile_id": tid, "status": "busy", "running": busy}, 409)
            if "steps" not in data and is_built(tid):
                return self.send_json({"tile_id": tid, "status": "built"})
            JOBS[tid] = {"status": "running", "steps": [], "current": steps[0],
                         "planned": list(steps), "started_at": now_iso()}
        print(f"[server] build {tid} steps={','.join(steps)}", flush=True)
        threading.Thread(target=build_worker, args=(tile, list(steps)), daemon=True).start()
        self.send_json({"tile_id": tid, "status": "started"})


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8781)
    ap.add_argument("--bind", default="127.0.0.1")
    a = ap.parse_args()
    httpd = ThreadingHTTPServer((a.bind, a.port), partial(Handler, directory=str(REPO_ROOT)))
    print(f"serving {REPO_ROOT} on http://{a.bind}:{a.port}/  (client: /client/, viewer: /viewer/)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
