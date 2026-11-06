"""A still for every animal a tile has (the species chips: client/src/nearBar.js, herdMarks.js; the start screen's lineup:
client/src/arrival.js). The stills are shared library assets like the models: one per species code under
client/assets/opening/, listed in its index.json, reused by every tile that has the species.

The static cast's stills are drawn by client/tools/opening_sprites.html (by hand, with tools/sprite_receiver.py). A
tile's own animals (client/fauna.json slots, pipeline/fauna_slots.py) get theirs from this step, by one rule per kind
of slot, nothing per species:

  a slot with its own model   (fauna/<code>.glb, pipeline/fauna_models.py): the model rendered by the same page, in
                              the same light, view and framing as the static stills (3/4 from a little above, facing
                              right), drawn as the client draws it (animalModels.js loadFaunaModel on faunaTemplate's
                              template) and posed as that template's own still is (a quadruped standing, a soarer's wings
                              spread, a standing bird's folded); a still over 512 px on a side is drawn at fewer px per
                              metre (its px_per_m says how many). Entered in index.json `species` with `fauna: true`
                              and its `source` (the GLB's hash): it joins the lineup as the hand-built ones do, and is
                              rendered again when the model changes.
  a stand-in                  (a kin's body, scaled): the body the player sees is the kin's, so its still is the kin's
                              still (the same file, nothing rendered), at the slot's scale (px_per_m divided by it, so a
                              true-to-scale use stays true); a tinted stand-in (fauna.json `tint`) is the kin's body
                              rendered times the tint. Entered in index.json `stand_ins`, which the chips read and the
                              lineup does not (a toucan on a jay's body is not shown on the start screen as a jay).
  a slot the client draws     (its code is a static species): its still is already there.

Rendering runs the page headless: a local server (127.0.0.1, an ephemeral port, serving client/ only and receiving
the PNGs), Google Chrome --headless=new on it (CHROME, else the usual install paths), PIL WebP q90 as the receiver.
With no Chrome the slots that need a render are left without (runlog fallback) and the chips fall back to the kin's
still, else a neutral glyph (nearBar.js).

    arch -arm64 .venv/bin/python -m pipeline.stills utm36s_698_9724 [more tiles] [--force] [--dry-run]

The tile build's `stills` step (pipeline/steps.py, after `animals`) runs the same and writes the tile's report,
fauna/stills.json: per slot the file its chip shows and how it was made.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit

from .config import REPO_ROOT, Tile, now_iso, write_json

OPENING = REPO_ROOT / "client" / "assets" / "opening"
INDEX = OPENING / "index.json"
ASSETS = REPO_ROOT / "client" / "assets"
PAGE = "/client/tools/opening_sprites.html"
RENDER_VERSION = "1"            # bump when the page's framing or light changes: every pipeline still is rendered again
WEBP_Q = 90                     # as tools/sprite_receiver.py
CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "google-chrome-stable",
           "chromium", "chromium-browser"]


def _sha16(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    except OSError:
        return None


def read_index() -> dict:
    try:
        return json.loads(INDEX.read_text())
    except (OSError, ValueError):
        return {"species": {}}


def _tint(slot) -> list | None:
    t = slot.get("tint")
    return [float(v) for v in t[:3]] if isinstance(t, list) and len(t) >= 3 and all(isinstance(v, (int, float)) for v in t[:3]) else None


def plan(slots: list[dict], index: dict, force: bool = False) -> dict:
    """What each slot's chip needs: {renders: [job items], stand_ins: {code: entry}, chips: {code: report}}."""
    species, stand = index.get("species") or {}, index.get("stand_ins") or {}
    renders, entries, chips = [], {}, {}
    for s in slots:
        code = s.get("code")
        if not isinstance(code, str) or not code or code in chips:
            continue
        kin = s.get("kin")
        own = species.get(code)
        if own and not own.get("fauna"):   # a static species: the client draws it, its still is the hand-run page's
            chips[code] = {"file": own["file"], "how": "static"}
            continue
        M = s.get("model")
        if isinstance(M, dict) and isinstance(M.get("path"), str):
            glb = ASSETS / M["path"]
            src = {"model": M["path"], "sha": _sha16(glb), "v": RENDER_VERSION}
            if src["sha"] is None:
                chips[code] = {"file": None, "how": "missing", "why": f"no {M['path']}"}
            elif not force and own and own.get("source") == src and (OPENING / own["file"]).is_file():
                chips[code] = {"file": own["file"], "how": "model"}
                continue
            else:
                renders.append({"code": code, "model": {k: M[k] for k in ("path", "kind", "archetype", "skin") if k in M},
                                "kin": kin, "role": s.get("role"), "archetype": s.get("archetype"), "mass_kg": s.get("mass_kg"),
                                "_source": src, "_slot": "model"})
                chips[code] = {"file": f"{code}.webp", "how": "model"}
                continue
        ks = species.get(kin) if isinstance(kin, str) else None
        if not ks or ks.get("fauna"):
            chips[code] = {"file": None, "how": "missing", "why": f"its kin '{kin}' has no still"}
            continue
        scale = float(s.get("scale") or 1) if isinstance(s.get("scale"), (int, float)) and s.get("scale") > 0 else 1.0
        base = {"kin": kin, "scale": round(scale, 4), "kind": ks.get("kind"), "pose": ks.get("pose"),
                "width": ks.get("width"), "height": ks.get("height"), "foot_px": ks.get("foot_px"),
                "px_per_m": round(ks["px_per_m"] / scale, 3) if ks.get("px_per_m") else None}
        tint = _tint(s)
        if tint:
            src = {"kin": kin, "kin_still": _sha16(OPENING / ks["file"]), "tint": tint, "v": RENDER_VERSION}
            old = stand.get(code)
            if not force and old and old.get("source") == src and (OPENING / old["file"]).is_file():
                entries[code] = old
                chips[code] = {"file": old["file"], "how": "tinted", "kin": kin}
            else:
                renders.append({"code": code, "kin": kin, "tint": tint, "_source": src, "_slot": "tinted", "_base": base})
                chips[code] = {"file": f"{code}.webp", "how": "tinted", "kin": kin}
            continue
        entries[code] = {"file": ks["file"], **base}
        chips[code] = {"file": ks["file"], "how": "stand_in", "kin": kin}
    return {"renders": renders, "stand_ins": entries, "chips": chips}


# ---------------------------------------------------------------------------------------------------------------
# Rendering: the page, headless

def find_chrome() -> str | None:
    for c in ([os.environ["CHROME"]] if os.environ.get("CHROME") else []) + CHROMES:
        p = c if os.path.isabs(c) else shutil.which(c)
        if p and os.path.exists(p):
            return p
    return None


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, job: dict, png_dir: Path):
        self.job, self.png_dir, self.done, self.result = job, png_dir, threading.Event(), None
        super().__init__(("127.0.0.1", 0), _Handler)


class _Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(REPO_ROOT), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/job.json":
            return self._json(200, self.server.job)
        if not path.startswith("/client/") or ".." in path:   # the client's files only (never the repo's .env and the rest)
            return self._json(404, {"error": "not served"})
        return super().do_GET()

    def do_HEAD(self):  # noqa: N802
        return self._json(405, {})

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.startswith("/save/"):
            name = "".join(ch for ch in self.path[len("/save/"):].lower() if ch.isalnum() or ch in "_.-")
            if not name.endswith(".png") or name.startswith("."):
                return self._json(400, {"error": "bad name"})
            (self.server.png_dir / name).write_bytes(data)
            return self._json(200, {"saved": name, "bytes": len(data)})
        if self.path == "/done":
            self.server.result = json.loads(data or b"{}")
            self.server.done.set()
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "unknown"})

    def log_message(self, fmt, *args):
        pass


def render(items: list[dict], timeout_s: float | None = None) -> tuple[dict, dict, Path]:
    """Render job items on the page headless: ({code: {meta, png: Path}}, {code: why failed}, the scratch dir)."""
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("no Chrome to render the stills (set CHROME)")
    tmp = Path(tempfile.mkdtemp(prefix="we-stills-"))
    png = tmp / "png"
    png.mkdir()
    job = {"items": [{k: v for k, v in it.items() if not k.startswith("_")} for it in items]}
    srv = _Server(job, png)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    url = f"{base}{PAGE}?job={quote(base + '/job.json', safe='')}&recv={quote(base, safe='')}&go=1"
    args = [chrome, "--headless=new", f"--user-data-dir={tmp / 'profile'}", "--window-size=1280,800", "--enable-gpu",
            "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--remote-debugging-port=0"]   # (a debugging port keeps the headless browser open on its page)
    if sys.platform == "darwin":
        args.append("--use-angle=metal")
    proc = subprocess.Popen(args + [url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not srv.done.wait(timeout_s or 90 + 20 * len(items)):
            raise RuntimeError(f"the stills page did not finish ({len(items)} stills) at {url}")
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        srv.shutdown()
        srv.server_close()
    res = srv.result or {}
    out = {}
    for code, meta in (res.get("species") or {}).items():
        p = png / f"{code}.png"
        if p.is_file():
            out[code] = {**meta, "png": p}
    failed = dict(res.get("failed") or {})
    for it in items:
        if it["code"] not in out and it["code"] not in failed:
            failed[it["code"]] = "no image came back"
    return out, failed, tmp


@contextmanager
def _locked():
    """One writer of index.json at a time (two tiles' builds in parallel)."""
    OPENING.mkdir(parents=True, exist_ok=True)
    lock = Path(tempfile.gettempdir()) / f"we-stills-{hashlib.sha256(str(INDEX).encode()).hexdigest()[:8]}.lock"   # not in the assets
    with open(lock, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _webp(src: Path, dst: Path) -> int:
    from PIL import Image
    Image.open(src).save(dst, "WEBP", quality=WEBP_Q, alpha_quality=WEBP_Q, method=6)
    return dst.stat().st_size


def stills_for(slots: list[dict], force: bool = False, dry_run: bool = False, log=print) -> dict:
    """Make the slots' stills and enter them in index.json; returns the report (chips, rendered, failed)."""
    p = plan(slots, read_index(), force)
    rendered, failed, tmp = {}, {}, None
    if p["renders"] and not dry_run:
        try:
            got, failed, tmp = render(p["renders"])
            rendered = got
        except RuntimeError as e:
            failed = {it["code"]: str(e) for it in p["renders"]}
            try:
                from . import runlog
                runlog.fallback(f"stills not rendered ({e}): those chips show the kin's still or the glyph")
            except Exception:  # noqa: BLE001
                pass
    if not dry_run:
        by = {it["code"]: it for it in p["renders"]}
        with _locked():
            idx = read_index()
            before = json.dumps({k: v for k, v in idx.items() if k != "stills_pipeline"}, sort_keys=True)
            sp, st = idx.setdefault("species", {}), idx.setdefault("stand_ins", {})
            for code, meta in rendered.items():
                it = by[code]
                meta = dict(meta)
                f = meta.pop("png")
                meta["bytes"] = _webp(f, OPENING / meta["file"])
                meta["source"] = it["_source"]
                meta["generator"] = "pipeline/stills.py"
                if it["_slot"] == "model":
                    sp[code] = {**meta, "fauna": True}
                    st.pop(code, None)
                else:   # a tinted stand-in: its own pixels, its scale's px_per_m
                    b = it["_base"]
                    st[code] = {**meta, "kin": b["kin"], "scale": b["scale"],
                                "px_per_m": round(meta["px_per_m"] / b["scale"], 3)}
            for code, e in p["stand_ins"].items():
                if code not in sp or not sp[code].get("fauna"):
                    st[code] = e
            idx["stand_ins"] = dict(sorted(st.items()))
            named = [v.get("file") for v in sp.values()] + [(idx.get("wisp") or {}).get("file")]
            idx["total_bytes"] = sum((OPENING / f).stat().st_size for f in set(filter(None, named)) if (OPENING / f).is_file())
            # written only when something changed (the step's fingerprint reads index.json: a rewrite for nothing would
            # leave every tile's step stale)
            if json.dumps({k: v for k, v in idx.items() if k != "stills_pipeline"}, sort_keys=True) != before:
                idx["stills_pipeline"] = {"generator": "pipeline/stills.py + client/tools/opening_sprites.html (?job=, headless Chrome)",
                                          "render_version": RENDER_VERSION, "updated": now_iso()}
                write_json(INDEX, idx)
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    for code, why in failed.items():
        p["chips"][code] = {"file": None, "how": "missing", "why": why}
    counts: dict = {}
    for c in p["chips"].values():
        counts[c["how"]] = counts.get(c["how"], 0) + 1
    log(f"stills: {len(rendered)} rendered, {len(failed)} failed; chips {counts}")
    return {"chips": p["chips"], "rendered": sorted(rendered), "failed": failed, "counts": counts}


def tile_slots(tile: Tile) -> list[dict]:
    try:
        f = json.loads((tile.dir / "client" / "fauna.json").read_text())
    except (OSError, ValueError):
        return []
    return [s for s in (f.get("slots") or []) if isinstance(s, dict)]


def tile_stills(tile: Tile, force: bool = False) -> dict:
    """The tile build's step: every slot's still, and the tile's report (fauna/stills.json) as its layer."""
    rep = stills_for(tile_slots(tile), force=force, log=lambda t: print(f"[{tile.tile_id}] {t}", flush=True))
    out = tile.dir / "fauna" / "stills.json"
    write_json(out, {"format": 1, "generated": now_iso(), "generator": "pipeline/stills.py",
                     "note": "Per fauna.json slot: the still its chip shows (client/assets/opening/<file>) and how it was made "
                             "(model: its own model rendered; stand_in: its kin's still; tinted: its kin's body tinted; static: "
                             "the client's own species; missing: none, the chip shows the kin's still or a glyph).",
                     **rep})
    return {"path": "fauna/stills.json", "counts": rep["counts"], "rendered": len(rep["rendered"]), "failed": len(rep["failed"])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="A still for every animal of the tiles (client/assets/opening).")
    ap.add_argument("tiles", nargs="+")
    ap.add_argument("--force", action="store_true", help="render the pipeline's stills again even if current")
    ap.add_argument("--dry-run", action="store_true", help="say what would be rendered; write nothing")
    a = ap.parse_args(argv)
    bad = 0
    for t in a.tiles:
        tile = Tile.from_id(t)
        if a.dry_run:
            p = plan(tile_slots(tile), read_index(), a.force)
            print(f"[{t}] would render {[it['code'] for it in p['renders']]}; stand-ins {len(p['stand_ins'])}; "
                  f"missing {[c for c, v in p['chips'].items() if v['how'] == 'missing']}")
            continue
        info = tile_stills(tile, a.force)
        bad += info["failed"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
