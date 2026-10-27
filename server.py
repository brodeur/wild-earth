"""Wild Earth dev server: static files from the repo root plus a small tile API.

    .venv/bin/python server.py --port 8781 --bind 127.0.0.1

GET  /api/tiles               tiles/index.json
POST /api/tile  {lon, lat}    which tile holds this point, and is it built
POST /api/build {lon, lat} | {tile_id} [, steps]   build it in the background
GET  /api/build/<tile_id>     build progress
GET  /api/edits/<tile_id>     the manifest's append-only `edits` log (a JSON array)
POST /api/edits/<tile_id>  [edit, ...]   validate, stamp (id, at) and append to the log
GET  /api/game                the acorn game's protocol version (clients feature-detect the shared world)
GET  /api/game/ws             WebSocket: one shared acorn-game world per (tile, season), see GameWorld
GET  /api/game/<tile>/<season>   that world's counts (board, round, players), no player ids
GET  /api/weather/<tile_id>   today's weather at the tile centre: Open-Meteo's forecast for yesterday, today
                              and tomorrow in client/weather.json's `days` format, plus `current`; cached
                              30 minutes per tile; 503 when Open-Meteo cannot be reached

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
Weather: only the tile id reaches this server and only the tile's centre reaches Open-Meteo, never a
player's point; nothing about a weather request is logged beyond the request line above.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import queue
import re
import socket
import struct
import threading
import time
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

WEATHER_TTL_S = 30 * 60
WEATHER: dict[str, tuple[float, dict]] = {}   # tile_id -> (monotonic time fetched, answer)
WEATHER_LOCKS: dict[str, threading.Lock] = {}
WEATHER_LOCK = threading.Lock()


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


# ---- the acorn game's shared worlds (docs/game-acorn-stash.md, "v3: shared world") ----------------
# One world per (tile, season), held here and persisted to tiles/<tile>/game/<season>.json (a snapshot,
# at most every SAVE_S while it changes) plus <season>.events.jsonl (every accepted event, round change and
# regrowth, appended with its sequence number; on load the snapshot is read and the log's newer lines
# replayed). The server owns the world: it checks each event with the rules of acorns.js applyEvent (ported
# below), numbers it and sends it to everyone in the world; a conflict (two players and one acorn) goes to the
# first accepted, the other gets a reject and rolls back. It runs the world clock (while anyone is in the
# world), the round and fall regrowth. The first client in a world runs the AI collectors (the AI host);
# when it leaves the next oldest is told so. Transport: a minimal RFC 6455 WebSocket at /api/game/ws.
# Privacy (the doc's "What the node stores about a person"): a player is a hash of an id the browser derives
# per world and per round from a random id it keeps, so ids do not link across rounds, tiles or seasons; the
# season total and the field notes stay in the browser. Persisted, a player id goes only with counts and acorn
# or oak keys, never a position: a player's burial is logged as a count against the player id plus a separate
# 'cache' line (position, anonymous k<n> id); a dig as a count plus an 'uncache' line. On every snapshot the
# log's lines up to it are rewritten without player ids. Messages are never printed.
# v4 (the doc's "v4: defence and pilfering"): two more events, 'raid' (an acorn pulled from a woodpecker granary) and
# 'mob' (a raider driven off: the raid interrupted, or the acorn it carried dropped), and the dig of someone else's
# buried acorn scores for the digger's species and against the owner's. The server has no positions of animals or
# players, so the rule that a raid needs no family member within 8 m is checked by the raider's browser (the AI host
# for AI raiders) and trusted here, as an acorn key's existence is; everything else is checked here: first wins, the
# granary holds one, the raider has room, is a raiding species and is not driven off (DRIVEN_S after a 'mob').
# A cache's owner: an AI collector's id is kept in the cache record; a player's only in memory (GameWorld.owners,
# cleared when a round starts), never written beside the cache's position.
GAME_SEASONS = ("spring", "summer", "fall", "winter")
BOARD_SPECIES = ("melanerpes_formicivorus", "sciurus_griseus", "corvus_corax")
JAY_SPECIES = ("aphelocoma_californica", "cyanocitta_stelleri")   # AI only: they dig, raid and are mobbed; not on the board
RAID_SPECIES = ("corvus_corax", "sciurus_griseus") + JAY_SPECIES  # who may pull an acorn from a granary
DRIVEN_S = 20.0                  # s of world clock a mobbed raider may not raid (acorns.js DRIVEN_S)
PLAYER_CAP = {"corvus_corax": 3, "sciurus_griseus": 1, "melanerpes_formicivorus": 1}   # as acorns.js
AI_CAP_MAX = 3
CACHE_MAX = 300                  # buried acorns kept (acorns.js CACHE_MAX)
REGROW_S, SWEEP_S = 300, 5       # fall regrowth (acorns.js)
STASH_ODDS = 1 / 8
ROUND_S, ROUND_MIN, ROUND_MAX = 600, 20, 3600
GAME_SAVE_S, SUM_S, PING_S, IDLE_S = 2.0, 5.0, 20.0, 60.0
EV_RATE, EV_BURST = 40.0, 120.0  # events per second per connection (the AI host sends for ~100 animals)
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WS_MAX_IN = 64 * 1024
GAME_ID_RE = re.compile(r"^[A-Za-z0-9_.,:@+-]{1,96}$")
SID_RE = re.compile(r"^[0-9a-f]{16,64}$")
HELD_MAX = 200                   # a player's events held while its id for a new round is on the way
GAME_WORLDS: dict[tuple, "GameWorld"] = {}
GAME_LOCK = threading.Lock()
_TICKER: list = []


def seed_of(s: str, salt: int = 0) -> int:
    """acorns.js seedOf: FNV-1a over the string, salted."""
    h = (2166136261 ^ salt) & 0xFFFFFFFF
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def mulberry32(a: int):
    """treegen.js mulberry32, bit for bit."""
    state = [a & 0xFFFFFFFF]

    def nxt() -> float:
        a2 = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = a2
        t = ((a2 ^ (a2 >> 15)) * (1 | a2)) & 0xFFFFFFFF
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


def stash_capacity(oak_id: str) -> int | None:
    """acorns.js oakInfo: one oak in eight has a stash hole, of capacity 3..8, from the tree id alone."""
    rs = mulberry32(seed_of(oak_id, 0x57A5))
    return 3 + int(rs() * 6) if rs() < STASH_ODDS else None


def _gnum(v, what: str) -> float:
    if not _num(v) or not math.isfinite(v):
        raise ValueError(f"{what} must be a number")
    return round(float(v), 2)


def _gid(v, what: str) -> str:
    if not (isinstance(v, str) and GAME_ID_RE.match(v)):
        raise ValueError(f"{what} must be an id")
    return v


def clean_game_event(e, player: bool) -> dict:
    """The fields each event keeps. A player's pickup, deposit and dig keep no position, and no acorn species
    (the field notes are the browser's); a player's burial id is the server's (GameWorld.event)."""
    if not isinstance(e, dict):
        raise ValueError("event must be an object")
    t = e.get("type")
    out: dict = {"type": t}
    if t == "pickup":
        k = _gid(e.get("key"), "key")
        if ":" not in k:
            raise ValueError("key must be <oak>:<n>")
        out["key"] = k
    elif t == "deposit":
        out["oak"] = _gid(e.get("oak"), "oak")
        if e.get("into") not in ("stash", "granary"):
            raise ValueError("into must be stash or granary")
        out["into"] = e["into"]
    elif t == "bury":
        if not player:
            out["id"] = _gid(e.get("id"), "id")
        for k in ("x", "y", "z"):
            out[k] = _gnum(e.get(k), k)
        out["kind"] = "cache" if e.get("kind") == "cache" else "scatter"
    elif t == "dig":
        out["id"] = _gid(e.get("id"), "id")
        out["keep"] = bool(e.get("keep"))
    elif t == "raid":
        out["oak"] = _gid(e.get("oak"), "oak")
    elif t == "mob":
        out["drop"] = bool(e.get("drop"))
    else:
        raise ValueError("type must be pickup, deposit, bury, dig, raid or mob")
    if not player and t in ("pickup", "deposit", "raid"):
        for k in ("x", "y", "z"):   # an AI granary deposit's spot places the granary tag for everyone
            if _num(e.get(k)) and math.isfinite(e[k]):
                out[k] = round(float(e[k]), 2)
    return out


def game_reduce(w: dict, e: dict, owners: dict | None = None) -> str | None:
    """acorns.js applyEvent on the persisted shape. Returns None when applied, else why not. A bury or dig
    without an id is the count half of a player's (replayed from the log; its cache line is separate).
    owners: cache id -> player id (GameWorld.owners, memory only). A dig with an id gets the server's verdict
    written into e (own: the owner or None, osp: its species, pil: someone else's), which the clients apply."""
    c = w["collectors"].get(e["by"])
    if not c:
        return "no such collector"
    t = e["type"]
    if t == "pickup":
        if e["key"] in w["picked"]:
            return "taken"
        if c["carrying"] >= c["cap"]:
            return "full"
        w["picked"][e["key"]] = round(w["clock"], 1)
        c["carrying"] += 1
        return None
    if t == "deposit":
        if c["carrying"] <= 0:
            return "empty"
        into = w["granaries" if e["into"] == "granary" else "stashes"]
        n = into.get(e["oak"], 0)
        if e["into"] == "stash":
            cap = stash_capacity(e["oak"])
            if cap is None:
                return "no stash hole"
            if n >= cap:
                return "stash full"
        into[e["oak"]] = n + 1
        c["carrying"] -= 1
        if _stored(c):
            _game_score(w, c)
        return None
    if t == "bury":
        if c["carrying"] <= 0:
            return "empty"
        if "id" in e and any(k["id"] == e["id"] for k in w["caches"]):
            return "duplicate id"
        c["carrying"] -= 1
        fresh = _stored(c)
        if "id" in e:
            k = {"id": e["id"], "x": e["x"], "y": e["y"], "z": e["z"],
                 "species": c["species"], "kind": e["kind"], "t": round(w["clock"], 1)}
            if e["by"].startswith("p:"):
                if owners is not None:
                    owners[e["id"]] = e["by"]
            elif e["by"] != "~":
                k["by"] = e["by"]          # an AI animal's id (not a person)
            add_cache(w, k)
        if fresh:
            _game_score(w, c)
        return None
    if t == "dig":
        i = -1
        if "id" in e:
            i = next((j for j, k in enumerate(w["caches"]) if k["id"] == e["id"]), -1)
            if i < 0:
                return "no such cache"
        if e["keep"] and c["carrying"] >= c["cap"]:
            return "full"
        if i >= 0:
            k = w["caches"][i]
            own = k.get("by") or (owners or {}).get(k["id"])
            e["own"], e["osp"], e["pil"] = own, k["species"], own != e["by"]
            del w["caches"][i]
            if owners:
                owners.pop(k["id"], None)
        if e["keep"]:
            c["carrying"] += 1
            c["dug"] = c.get("dug", 0) + 1
        if e.get("pil") and e.get("osp"):   # someone else's (an old log line without a verdict: as before v4)
            if e["keep"]:
                c["loot"] = c.get("loot", 0) + 1
            _gain(w, c)
            _lose(w, e["osp"], e.get("own"))
        return None
    if t == "raid":
        if c["species"] not in RAID_SPECIES:
            return "not a raider"
        n = w["granaries"].get(e["oak"], 0)
        if n <= 0:
            return "empty granary"
        if c["carrying"] >= c["cap"]:
            return "full"
        if w["clock"] < c.get("off", 0):
            return "driven off"
        w["granaries"][e["oak"]] = n - 1
        c["carrying"] += 1
        c["dug"] = c.get("dug", 0) + 1     # scored now: storing it again scores nothing
        c["loot"] = c.get("loot", 0) + 1
        _gain(w, c)
        _lose(w, "melanerpes_formicivorus", None)
        return None
    if t == "mob":
        if e["drop"] and c["carrying"] <= 0:
            return "empty"
        c["off"] = round(w["clock"] + DRIVEN_S, 2)
        if e["drop"]:
            c["carrying"] -= 1
            if c.get("loot", 0) > 0:      # it loses what it stole: the raid's score goes back
                c["loot"] -= 1
                c["dug"] = max(0, c.get("dug", 0) - 1)
                _ungain(w, c)
            elif c.get("dug", 0) > 0:
                c["dug"] -= 1
        sp = c["species"]
        w["mobbed"][sp] = w["mobbed"].get(sp, 0) + 1
        r = w.get("round")
        if r and not r["over"]:
            rm = r.setdefault("mobbed", {})
            rm[sp] = rm.get(sp, 0) + 1
        return None
    return "unknown type"


def _stored(c: dict) -> bool:
    """An acorn goes into a store: one the collector dug up or stole (already scored) uses up a dug count and
    scores nothing; True when this one scores (acorns.js stored)."""
    if c.get("dug", 0) > 0:
        c["dug"] -= 1
        if c.get("loot", 0) > 0:
            c["loot"] -= 1
        return False
    return True


def _gain(w: dict, c: dict) -> None:
    """A raid or a pilfer: scored for the raider's species, the round and its 'raided' line (board species only)."""
    sp = c["species"]
    if sp not in BOARD_SPECIES:
        return
    _game_score(w, c)
    w["raided"][sp] = w["raided"].get(sp, 0) + 1
    r = w.get("round")
    if r and not r["over"]:
        rr = r.setdefault("raided", {})
        rr[sp] = rr.get(sp, 0) + 1


def _ungain(w: dict, c: dict) -> None:
    """A dropped stolen acorn: the raid's score taken back (never below 0)."""
    sp = c["species"]
    if sp not in BOARD_SPECIES:
        return
    w["board"][sp] = max(0, w["board"].get(sp, 0) - 1)
    w["raided"][sp] = max(0, w["raided"].get(sp, 0) - 1)
    c["total"] = max(0, c.get("total", 0) - 1)
    r = w.get("round")
    if r and not r["over"]:
        r["counts"][sp] = max(0, r["counts"].get(sp, 0) - 1)
        rr = r.setdefault("raided", {})
        rr[sp] = max(0, rr.get(sp, 0) - 1)
        if c["kind"] == "player" and c["id"] in r["by"]:
            r["by"][c["id"]] = max(0, r["by"][c["id"]] - 1)


def _lose(w: dict, sp: str, own) -> None:
    """The owner's species (and the owner, when known and still here) loses the acorn (never below 0)."""
    if sp in w["board"]:
        w["board"][sp] = max(0, w["board"][sp] - 1)
    o = w["collectors"].get(own) if own else None
    if o:
        o["total"] = max(0, o.get("total", 0) - 1)
    r = w.get("round")
    if r and not r["over"]:
        if sp in r["counts"]:
            r["counts"][sp] = max(0, r["counts"][sp] - 1)
        if o and o["kind"] == "player" and own in r["by"]:
            r["by"][own] = max(0, r["by"][own] - 1)


def set_pre(c: dict, pre) -> None:
    """A logged collector's state before the event: [carrying, dug] (v3), plus [loot, off] (v4)."""
    c["carrying"], c["dug"] = pre[0], pre[1]
    if len(pre) > 3:
        c["loot"], c["off"] = pre[2], pre[3]


def add_cache(w: dict, k: dict) -> None:
    w["caches"].append(k)
    if len(w["caches"]) > CACHE_MAX:
        del w["caches"][: len(w["caches"]) - CACHE_MAX]


def scrub_line(m: dict) -> dict:
    """A log line without player ids: the event stays, whose it was goes."""
    if m.get("t") == "ev" and isinstance(m.get("e"), dict):
        e = m["e"]
        m["e"] = {k: v for k, v in e.items() if not (k in ("by", "own") and str(v).startswith("p:"))}
    elif m.get("t") == "round" and isinstance(m.get("round"), dict):
        m["round"] = {k: v for k, v in m["round"].items() if k != "by"}
    return m


def _game_score(w: dict, c: dict) -> None:
    sp = c["species"]
    w["board"][sp] = w["board"].get(sp, 0) + 1
    c["total"] = c.get("total", 0) + 1
    r = w.get("round")
    if r and not r["over"]:
        r["counts"][sp] = r["counts"].get(sp, 0) + 1
        if c["kind"] == "player":
            r["by"][c["id"]] = r["by"].get(c["id"], 0) + 1


def round_winner(r: dict) -> str | None:
    """acorns.js endRound: the species with the most, none on a tie or an empty round."""
    best, bn, tie = None, -1, False
    for s in BOARD_SPECIES:
        n = r["counts"].get(s, 0)
        if n > bn:
            bn, best, tie = n, s, False
        elif n == bn:
            tie = True
    return best if bn > 0 and not tie else None


def ws_frame(data: bytes, op: int = 1) -> bytes:
    n, b0 = len(data), 0x80 | op
    if n < 126:
        head = struct.pack(">BB", b0, n)
    elif n < 65536:
        head = struct.pack(">BBH", b0, 126, n)
    else:
        head = struct.pack(">BBQ", b0, 127, n)
    return head + data


class GameConn:
    """One WebSocket client. Reads on the request's thread; a writer thread drains its queue, so a slow
    client never holds a world's lock."""

    def __init__(self, sock, rfile):
        self.sock, self.rfile = sock, rfile
        self.q: queue.Queue = queue.Queue(maxsize=4000)
        self.alive, self.world, self.pid = True, None, None
        self.species, self.stale, self.held, self.carry = "corvus_corax", False, [], (0, 0)
        self.tokens, self.tok_t, self.last_rx = EV_BURST, time.monotonic(), time.monotonic()
        threading.Thread(target=self._write, daemon=True).start()

    def send(self, obj) -> None:
        self.raw(ws_frame(json.dumps(obj, separators=(",", ":")).encode()))

    def raw(self, frame: bytes) -> None:
        if not self.alive:
            return
        try:
            self.q.put_nowait(frame)
        except queue.Full:    # far behind: drop it, it reconnects and gets a fresh snapshot
            self.kill()

    def kill(self) -> None:
        self.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _write(self) -> None:
        while True:
            frame = self.q.get()
            if frame is None or not self.alive:
                return
            try:
                self.sock.sendall(frame)
            except OSError:
                self.kill()
                return

    def _read(self, n: int) -> bytes:
        b = self.rfile.read(n)
        if b is None or len(b) < n:
            raise ConnectionError("closed")
        return b

    def recv(self) -> tuple[int, bytes]:
        """One whole message (continuation frames joined): (opcode, payload)."""
        op0, buf = None, b""
        while True:
            b0, b1 = self._read(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if n > WS_MAX_IN or len(buf) + n > WS_MAX_IN:
                raise ConnectionError("message too large")
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n) if n else b""
            if mask:
                data = bytes(c ^ mask[i & 3] for i, c in enumerate(data))
            self.last_rx = time.monotonic()
            if op >= 8:                 # control frames may come between fragments
                if op == 8 or op == 9 or op == 10:
                    return op, data
                continue
            if op0 is None:
                op0 = op
            buf += data
            if b0 & 0x80:
                return op0, buf

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(EV_BURST, self.tokens + (now - self.tok_t) * EV_RATE)
        self.tok_t = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True

    def run(self) -> None:
        try:
            while self.alive:
                op, data = self.recv()
                if op == 8:
                    self.raw(ws_frame(b"", 8))
                    break
                if op == 9:
                    self.raw(ws_frame(data, 10))
                    continue
                if op != 1:
                    continue
                try:
                    msg = json.loads(data)
                except ValueError:
                    self.send({"t": "err", "why": "not JSON"})
                    continue
                if isinstance(msg, dict):
                    self.on_message(msg)
        except (OSError, ConnectionError):
            pass
        except Exception as e:  # noqa: BLE001  (say why a connection ended unexpectedly; never its messages)
            print(f"[game] connection ended: {type(e).__name__}: {str(e)[:120]}", flush=True)
        finally:
            if self.world:
                self.world.leave(self)
            self.alive = False
            try:
                self.q.put_nowait(None)
            except queue.Full:
                pass

    def on_message(self, m: dict) -> None:
        t = m.get("t")
        if t == "hello":
            tile, season, sid = m.get("tile"), m.get("season"), m.get("sid")
            if not (isinstance(tile, str) and TILE_ID_RE.match(tile) and manifest(tile) is not None):
                return self.send({"t": "err", "why": "unknown tile"})
            if season not in GAME_SEASONS:
                return self.send({"t": "err", "why": "season must be one of " + ", ".join(GAME_SEASONS)})
            species = m.get("species") if m.get("species") in PLAYER_CAP else "corvus_corax"
            if self.world:
                self.world.leave(self)
            # sid: the browser's id for this world and round (derived from its own random id; r is the round
            # it was derived for). The wrong round, or none yet: the server says which, the browser asks again.
            game_world(tile, season).join(self, species, sid if isinstance(sid, str) and SID_RE.match(sid) else None,
                                          m.get("r"))
            return
        w = self.world
        if not w:
            return self.send({"t": "err", "why": "say hello first"})
        if t == "id":
            sid = m.get("sid")
            if isinstance(sid, str) and SID_RE.match(sid):
                w.reid(self, sid, m.get("r"))
        elif t == "ev":
            if not self.allow():
                return self.send({"t": "rej", "c": m.get("c"), "why": "too many events"})
            w.event(self, m.get("c"), m.get("e"))
        elif t == "start":
            w.start_round(m.get("length"))
        elif t == "species" and m.get("species") in PLAYER_CAP:
            w.set_species(self, m["species"])


class GameWorld:
    def __init__(self, tile: str, season: str):
        self.tile, self.season = tile, season
        self.dir = TILES_DIR / tile / "game"
        self.snap_path = self.dir / f"{season}.json"
        self.log_path = self.dir / f"{season}.events.jsonl"
        self.lock = threading.RLock()
        self.conns: list[GameConn] = []      # join order: conns[0] runs the AI collectors
        self.s = self.empty()
        self.dirty, self.saved_at, self.log, self.scrubbed = False, 0.0, None, 0
        self.owners: dict[str, str] = {}     # a player's buried acorn -> its player id: memory only (v4)
        self.sweep_t = self.sum_t = self.ping_t = 0.0
        self.load()

    def empty(self) -> dict:
        return {"v": 3, "tile": self.tile, "season": self.season, "seq": 0, "clock": 0.0,
                "picked": {}, "stashes": {}, "granaries": {}, "caches": [],
                "board": {s: 0 for s in BOARD_SPECIES}, "collectors": {}, "round": None, "rounds": 0,
                "cache_n": 0, "raided": {s: 0 for s in BOARD_SPECIES}, "mobbed": {}}

    # -- persistence
    def load(self) -> None:
        if self.snap_path.exists():
            try:
                s = read_json(self.snap_path)
                if isinstance(s, dict) and s.get("v") == 3:
                    self.s = {**self.empty(), **s}
            except ValueError:
                print(f"[game] {self.tile}/{self.season}: snapshot unreadable, starting from the log", flush=True)
        base, replayed = self.s["seq"], 0
        if self.log_path.exists():
            with open(self.log_path) as f:
                for line in f:
                    try:
                        m = json.loads(line)
                    except ValueError:
                        continue          # a torn last line after a crash
                    if isinstance(m, dict) and m.get("seq", 0) > base:   # (a burial's two lines share a seq)
                        self.replay(m)
                        replayed += 1
        if replayed:
            self.save()          # a snapshot covering the replayed lines, and the log scrubbed up to it
        else:
            self.scrub_log(self.s["seq"])
        print(f"[game] {self.tile}/{self.season} loaded: seq {self.s['seq']}, {replayed} replayed", flush=True)

    def replay(self, m: dict) -> None:
        s = self.s
        s["seq"] = max(s["seq"], m["seq"])
        s["clock"] = max(s["clock"], float(m.get("clock", 0)))
        if m.get("t") == "ev":
            e = m["e"]
            if "by" not in e:     # scrubbed: the world still takes it (a log alone rebuilds all but players' counts)
                s["collectors"]["~"] = {"id": "~", "species": m["col"]["sp"], "kind": m["col"]["k"], "cap": m["col"]["cap"],
                                        "total": 0}
                set_pre(s["collectors"]["~"], m["pre"])
                game_reduce(s, {**e, "by": "~"})
                del s["collectors"]["~"]
                if s["round"]:
                    s["round"]["by"].pop("~", None)
                return
            c = self.collector(e["by"], m["col"]["sp"], m["col"]["k"], m["col"]["cap"])
            set_pre(c, m["pre"])
            game_reduce(s, e)
        elif m.get("t") == "cache":
            add_cache(s, m["c"])
            if str(m["c"]["id"]).startswith("k") and m["c"]["id"][1:].isdigit():
                s["cache_n"] = max(s["cache_n"], int(m["c"]["id"][1:]))
        elif m.get("t") == "uncache":
            s["caches"] = [k for k in s["caches"] if k["id"] != m["id"]]
        elif m.get("t") == "round":
            if m["round"]["id"] > s["rounds"]:
                self.new_epoch()
            s["round"] = {**m["round"], "by": dict(m["round"].get("by") or {})}
            s["rounds"] = max(s["rounds"], m["round"]["id"])
        elif m.get("t") == "regrow":
            for k in m["keys"]:
                s["picked"].pop(k, None)

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.snap_path.with_name(f".{self.season}.{uuid.uuid4().hex[:8]}.tmp")
        with open(tmp, "w") as f:
            json.dump({**self.s, "clock": round(self.s["clock"], 2), "saved_at": now_iso()}, f, separators=(",", ":"))
        os.replace(tmp, self.snap_path)
        self.dirty, self.saved_at = False, time.monotonic()
        self.scrub_log(self.s["seq"])

    def scrub_log(self, upto: int) -> None:
        """Rewrite the log's lines up to seq `upto` (all covered by the snapshot) without player ids. Only the
        part written since the last scrub is read; lines after `upto` stay as they are (needed for replay)."""
        if not self.log_path.exists():
            return
        if self.log is not None:
            self.log.close()
            self.log = None
        with open(self.log_path, "rb+") as f:
            f.seek(self.scrubbed)
            out, keep_from = [], None
            for raw in f.read().splitlines():
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue                       # a torn line
                if not isinstance(m, dict):
                    continue
                if m.get("seq", 0) <= upto:
                    m = scrub_line(m)
                elif keep_from is None:
                    keep_from = len(out)
                out.append(json.dumps(m, separators=(",", ":")).encode() + b"\n")
            f.seek(self.scrubbed)
            head = b"".join(out[:keep_from] if keep_from is not None else out)
            f.write(head + b"".join(out[keep_from:] if keep_from is not None else []))
            f.truncate()
            self.scrubbed += len(head)

    def record(self, m: dict, sender: GameConn | None = None, c=None, log: list | None = None) -> None:
        """Number a change, append it to the log and send it to everyone (the sender's copy echoes c). `log`:
        the lines written instead of m (a player's burial or dig: its count and its place, apart)."""
        self.s["seq"] += 1
        stamp = {"seq": self.s["seq"], "clock": round(self.s["clock"], 2)}
        m = {**m, **stamp}
        if self.log is None:
            self.dir.mkdir(parents=True, exist_ok=True)
            self.log = open(self.log_path, "a")
        for line in (log if log is not None else [m]):
            self.log.write(json.dumps({**line, **stamp}, separators=(",", ":")) + "\n")
        self.log.flush()
        self.dirty = True
        for k in self.conns:
            k.send({**m, "c": c} if k is sender else m)

    # -- membership
    def players(self) -> int:
        return len({k.pid for k in self.conns})

    def tell_players(self) -> None:
        n = self.players()
        for i, k in enumerate(self.conns):
            k.send({"t": "players", "n": n, "host": i == 0})

    def epoch(self) -> int:
        """The round a player id belongs to: the running or last round (0 before the first)."""
        return self.s["rounds"]

    def new_epoch(self) -> None:
        """A round starts: every player id ends. Connected players keep their carry under the id they send
        next (reid); the old ids' records go."""
        for k in self.conns:
            c = self.s["collectors"].get(k.pid)
            if c and not k.stale:
                k.carry = (c["carrying"], c.get("dug", 0))
            k.stale = True
        self.s["collectors"] = {i: c for i, c in self.s["collectors"].items() if c["kind"] != "player"}
        self.owners = {}                  # no player's caches carried into the new round's ids

    def reid(self, conn: GameConn, sid: str, r) -> None:
        with self.lock:
            if r != self.epoch():
                return conn.send({"t": "epoch", "r": self.epoch()})
            conn.pid = "p:" + hashlib.sha256(sid.encode()).hexdigest()[:12]
            c = self.collector(conn.pid, conn.species, "player", PLAYER_CAP[conn.species])
            if conn.stale:
                c["carrying"], c["dug"] = min(conn.carry[0], c["cap"]), conn.carry[1]
            conn.stale, held, conn.held = False, conn.held, []
            conn.send({"t": "you", "you": conn.pid, "r": self.epoch()})
            for c_, e in held:
                self.event(conn, c_, e)

    def collector(self, cid: str, species: str, kind: str, cap: int) -> dict:
        c = self.s["collectors"].get(cid)
        if not c:
            c = self.s["collectors"][cid] = {"id": cid, "species": species, "kind": kind, "carrying": 0,
                                             "cap": cap, "total": 0, "dug": 0}
        c["species"], c["cap"] = species, cap
        c["carrying"] = min(c["carrying"], cap)
        return c

    def join(self, conn: GameConn, species: str, sid: str | None, r) -> None:
        with self.lock:
            if sid is None or r != self.epoch():
                return conn.send({"t": "epoch", "r": self.epoch()})
            conn.pid = "p:" + hashlib.sha256(sid.encode()).hexdigest()[:12]
            conn.species, conn.stale, conn.held = species, False, []
            conn.world = self
            self.conns.append(conn)
            self.collector(conn.pid, species, "player", PLAYER_CAP[species])
            conn.send({"t": "welcome", "v": 1, "you": conn.pid, "r": self.epoch(), "host": self.conns[0] is conn,
                       "n": self.players(), "world": self.s})
            self.tell_players()
            print(f"[game] {self.tile}/{self.season}: {self.players()} player(s) here", flush=True)

    def leave(self, conn: GameConn) -> None:
        with self.lock:
            if conn not in self.conns:
                return
            was_host = self.conns[0] is conn
            self.conns.remove(conn)
            conn.world = None
            self.tell_players()
            print(f"[game] {self.tile}/{self.season}: {self.players()} player(s) here"
                  + (", AI host moved" if was_host and self.conns else ""), flush=True)
            if not self.conns and self.dirty:
                self.save()

    def set_species(self, conn: GameConn, species: str) -> None:
        with self.lock:
            conn.species = species
            if not conn.stale:
                self.collector(conn.pid, species, "player", PLAYER_CAP[species])

    # -- the game
    def event(self, conn: GameConn, c, e) -> None:
        with self.lock:
            try:
                player = not (isinstance(e, dict) and e.get("by") is not None)
                if player and conn.stale:        # a new round: this player's next id is on the way
                    if len(conn.held) < HELD_MAX:
                        conn.held.append((c, e))
                    else:
                        conn.send({"t": "rej", "c": c, "why": "new round"})
                    return
                ev = clean_game_event(e, player)
                if player:
                    ev["by"] = conn.pid
                    if ev["type"] == "bury":
                        ev["id"] = f"k{self.s['cache_n'] + 1}"   # anonymous, numbered per world
                    col = self.s["collectors"][conn.pid]
                else:     # an AI collector's event: only from the AI host
                    if self.conns[0] is not conn:
                        return conn.send({"t": "rej", "c": c, "why": "not the AI host"})
                    by = _gid(e.get("by"), "by")
                    sp_ok = e.get("sp") in BOARD_SPECIES or (e.get("sp") in JAY_SPECIES and ev["type"] in ("dig", "raid", "mob"))
                    if by.startswith("p:") or not sp_ok:
                        raise ValueError("by / sp")
                    cap = e.get("cap") if isinstance(e.get("cap"), int) and 1 <= e["cap"] <= AI_CAP_MAX else 1
                    ev["by"] = by
                    col = self.collector(by, e["sp"], "ai", cap)
                    if isinstance(e.get("held"), int):   # the animal's own carry (a re-made animal starts empty)
                        col["carrying"] = max(0, min(e["held"], cap))
                        col["loot"] = min(col.get("loot", 0), col["carrying"])
            except (ValueError, KeyError, TypeError):
                return conn.send({"t": "rej", "c": c, "why": "malformed event"})
            pre = [col["carrying"], col.get("dug", 0), col.get("loot", 0), col.get("off", 0)]
            why = game_reduce(self.s, ev, self.owners)
            if why:
                return conn.send({"t": "rej", "c": c, "why": why})
            m = {"t": "ev", "e": ev, "pre": pre, "col": {"sp": col["species"], "k": col["kind"], "cap": col["cap"]}}
            log = None
            if player and ev["type"] == "bury":   # the count against the player, the place against k<n>
                self.s["cache_n"] += 1
                log = [{**m, "e": {"type": "bury", "by": ev["by"], "kind": ev["kind"]}},
                       {"t": "cache", "c": self.s["caches"][-1]}]
            elif ev["type"] == "dig" and (player or str(ev.get("own") or "").startswith("p:")):
                # a player's dig, or anyone's dig of a player's cache: the count (and whose it was) apart from the place
                log = [{**m, "e": {k: ev[k] for k in ("type", "by", "keep", "own", "osp", "pil") if k in ev}},
                       {"t": "uncache", "id": ev["id"]}]
            self.record(m, conn, c, log)

    def start_round(self, length) -> None:
        with self.lock:
            r = self.s["round"]
            if r and not r["over"]:
                return                     # one is running: everyone is in it
            ln = int(length) if _num(length) else ROUND_S
            ln = max(ROUND_MIN, min(ROUND_MAX, ln))
            self.new_epoch()
            self.s["rounds"] += 1
            self.s["round"] = {"id": self.s["rounds"], "start": round(self.s["clock"], 2), "length": ln,
                               "counts": {s: 0 for s in BOARD_SPECIES}, "by": {}, "over": False, "winner": None,
                               "raided": {s: 0 for s in BOARD_SPECIES}, "mobbed": {}}
            self.record({"t": "round", "round": self.s["round"]})
            print(f"[game] {self.tile}/{self.season}: round {self.s['rounds']} started ({ln} s)", flush=True)

    def tick(self, dt: float) -> None:
        with self.lock:
            now = time.monotonic()
            if self.conns:
                self.s["clock"] += dt
                r = self.s["round"]
                if r and not r["over"] and self.s["clock"] - r["start"] >= r["length"]:
                    r["over"], r["winner"] = True, round_winner(r)
                    self.record({"t": "round", "round": r})
                    print(f"[game] {self.tile}/{self.season}: round {r['id']} over, winner {r['winner']}", flush=True)
                self.sweep_t += dt
                self.sum_t += dt
                self.ping_t += dt
                if self.season == "fall" and self.sweep_t >= SWEEP_S:
                    self.sweep_t = 0.0
                    clock = self.s["clock"]
                    keys = [k for k, tk in self.s["picked"].items()
                            if clock - tk > REGROW_S * (1 + (seed_of(k, 0x6E9) % 1000) / 2000)]
                    for k in keys:
                        del self.s["picked"][k]
                    if keys:
                        self.record({"t": "regrow", "keys": keys})
                if self.sum_t >= SUM_S:
                    self.sum_t = 0.0
                    r = self.s["round"]
                    msg = {"t": "sum", "seq": self.s["seq"], "clock": round(self.s["clock"], 2), "board": self.s["board"],
                           "rc": r["counts"] if r else None, "n": self.players(),
                           "raided": self.s["raided"], "rr": r.get("raided", {}) if r else None}
                    for k in self.conns:
                        k.send(msg)
                if self.ping_t >= PING_S:
                    self.ping_t = 0.0
                    for k in list(self.conns):
                        if now - k.last_rx > IDLE_S:
                            k.kill()           # its reader ends and leaves the world
                        else:
                            k.raw(ws_frame(b"", 9))
            if self.dirty and now - self.saved_at >= GAME_SAVE_S:
                self.save()

    def summary(self) -> dict:
        """For GET /api/game/<tile>/<season>: counts only, no collector ids."""
        with self.lock:
            s, r = self.s, self.s["round"]
            return {"tile": self.tile, "season": self.season, "seq": s["seq"], "clock": round(s["clock"], 1),
                    "players": self.players(), "board": s["board"], "picked": len(s["picked"]),
                    "caches": len(s["caches"]), "granaries": sum(s["granaries"].values()),
                    "stashes": sum(s["stashes"].values()), "raided": s["raided"], "mobbed": s["mobbed"],
                    "round": r and {k: r.get(k) for k in ("id", "length", "counts", "over", "winner", "raided", "mobbed")}
                    | {"left": max(0.0, round(r["start"] + r["length"] - s["clock"], 1))}}


def game_world(tile: str, season: str) -> GameWorld:
    with GAME_LOCK:
        w = GAME_WORLDS.get((tile, season))
        if not w:
            w = GAME_WORLDS[(tile, season)] = GameWorld(tile, season)
        if not _TICKER:
            _TICKER.append(threading.Thread(target=_game_ticker, daemon=True))
            _TICKER[0].start()
        return w


def _game_ticker() -> None:
    last = time.monotonic()
    while True:
        time.sleep(0.5)
        now = time.monotonic()
        dt, last = now - last, now
        with GAME_LOCK:
            worlds = list(GAME_WORLDS.values())
        for w in worlds:
            try:
                w.tick(dt)
            except Exception as e:  # noqa: BLE001  (keep the clock running for the other worlds)
                print(f"[game] tick {w.tile}/{w.season} failed: {type(e).__name__}", flush=True)


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
        if u.path == "/api/game":
            return self.send_json({"protocol": 1, "ws": "/api/game/ws", "seasons": list(GAME_SEASONS)})
        if u.path == "/api/game/ws":
            return self.game_ws()
        if u.path.startswith("/api/game/"):
            parts = u.path.split("/")[3:]
            if len(parts) == 2 and TILE_ID_RE.match(parts[0]) and parts[1] in GAME_SEASONS and manifest(parts[0]):
                return self.send_json(game_world(parts[0], parts[1]).summary())
            return self.send_json({"error": "unknown world"}, 404)
        if u.path.startswith("/api/weather/"):
            return self.api_weather(u.path.rsplit("/", 1)[1])
        if u.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        super().do_GET()

    def api_weather(self, tile_id: str):
        """Today's weather for a built tile. The forecast is asked for the tile centre only (see the
        module docstring); one fetch per tile at a time, the answer kept WEATHER_TTL_S."""
        if not TILE_ID_RE.match(tile_id) or manifest(tile_id) is None:
            return self.send_json({"error": "unknown tile"}, 404)
        with WEATHER_LOCK:
            lock = WEATHER_LOCKS.setdefault(tile_id, threading.Lock())
        with lock:
            hit = WEATHER.get(tile_id)
            if hit and time.monotonic() - hit[0] < WEATHER_TTL_S:
                return self.send_json(hit[1])
            try:
                from pipeline.fetch_weather import today_weather
                wj = TILES_DIR / tile_id / "client" / "weather.json"   # its zone saves a call
                zone = read_json(wj).get("timezone") if wj.exists() else None
                answer = {"tile_id": tile_id, **today_weather(Tile.from_id(tile_id), zone)}
            except Exception:  # noqa: BLE001  (unreachable, refused or malformed: the client keeps last year's day)
                return self.send_json({"error": "weather unavailable", "tile_id": tile_id}, 503)
            WEATHER[tile_id] = (time.monotonic(), answer)
        self.send_json(answer)

    def game_ws(self):
        """RFC 6455 handshake, then this request's thread reads the client's messages until it goes."""
        key = self.headers.get("Sec-WebSocket-Key")
        if "websocket" not in (self.headers.get("Upgrade") or "").lower() or not key:
            return self.send_json({"error": "WebSocket upgrade expected"}, 400)
        accept = base64.b64encode(hashlib.sha1((key.strip() + WS_GUID).encode()).digest()).decode()
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        self.log_request(101)
        self.close_connection = True
        GameConn(self.connection, self.rfile).run()

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
