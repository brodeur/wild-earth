"""Wild Earth dev server: static files from the repo root plus a small tile API.

    .venv/bin/python server.py --port 8781 --bind 127.0.0.1

GET  /api/tiles               tiles/index.json
POST /api/tile  {lon, lat}    which tile holds this point, and is it built
POST /api/build {lon, lat} | {tile_id} [, steps]   build it in the background
GET  /api/build/<tile_id>     build progress

Privacy: a lon/lat is snapped to its tile and dropped. It is never logged or stored;
the request log prints method, path without query, and status only.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
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


def manifest(tile_id: str) -> dict | None:
    p = TILES_DIR / tile_id / "manifest.json"
    return read_json(p) if p.exists() else None


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

    def body_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            data = None
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
        if u.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            data = self.body_json()
            if path == "/api/tile":
                return self.api_tile(data)
            if path == "/api/build":
                return self.api_build(data)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        self.send_json({"error": "not found"}, 404)

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
