"""The Scavenge game's shared state (docs/game-scavenge.md): the carcasses of a tile, as one part of the acorn game's
world per tile and season (server.py GameWorld, its snapshot's `carrion` and its log's `carrion` lines), carried on the
dig channel's socket (`cev` messages, numbered by their own cseq).

A carcass is born of a kill (a `carcass` event: where, which species, its mass; the server stamps its birth with its own
clock), drawn down by `feed` events (kg taken), and removed by carrion_sweep once its decay reaches 1: one real day for a
deer, half for a jackrabbit, a quarter for a vole, faster in summer and in the afternoon, faster for what has been eaten
(client/src/carrion.js decayOf is the same arithmetic). Events are anonymous: the killer and the feeder are species codes,
never a player's id. Standard library only.
"""
from __future__ import annotations

import math
import re

CAP = 200                       # carcasses kept per world
TILE_M = 10000.0
ID_RE = re.compile(r"^[A-Za-z0-9_.:,-]{1,48}$")
CODE_RE = re.compile(r"^[a-z_]{3,40}$")
ONE_RE = re.compile(r"^[a-z' -]{1,24}$")
TYPES = ("carcass", "feed")
# as carrion.js: LIFE_H by mass, SEASON_HEAT, DIURNAL and its peak, the tiles' zone, EAT_K, BONES_D
LIFE_H = {"large": 24, "mid": 12, "small": 6}
SEASON_HEAT = {"winter": 0.65, "spring": 1.0, "summer": 1.45, "fall": 1.0}
DIURNAL, DIURNAL_PEAK, TILE_UTC = 0.25, 14, -8
EAT_K, BONES_D = 0.45, 0.85


def empty() -> dict:
    return {"v": 1, "seq": 0, "list": {}}


def life_of(mass: float) -> float:
    return LIFE_H["large"] if mass > 5 else LIFE_H["mid"] if mass > 0.5 else LIFE_H["small"]


def _num(v, what: str, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError(f"{what} must be a number in [{lo}, {hi}]")
    return round(float(v), 4)


def _str(v, what: str, rx) -> str:
    if not (isinstance(v, str) and rx.match(v)):
        raise ValueError(f"{what} is malformed")
    return v


def clean(e) -> dict:
    """The fields each event keeps, checked; anything else is dropped."""
    if not isinstance(e, dict) or e.get("type") not in TYPES:
        raise ValueError("type must be one of " + ", ".join(TYPES))
    out = {"type": e["type"], "id": _str(e.get("id"), "id", ID_RE)}
    if e["type"] == "carcass":
        out.update(one=_str(e.get("one"), "one", ONE_RE), sp=_str(e.get("sp"), "sp", CODE_RE),
                   x=_num(e.get("x"), "x", 0, TILE_M), y=_num(e.get("y"), "y", -1000, 9000), z=_num(e.get("z"), "z", -TILE_M, 0),
                   yaw=_num(e.get("yaw", 0), "yaw", -100, 100), size=_num(e.get("size", 1), "size", 0.1, 5),
                   mass=_num(e.get("mass"), "mass", 0.001, 1000))
    else:
        out["kg"] = _num(e.get("kg"), "kg", 0, 50)
    if "by" in e and e["by"] is not None:
        out["by"] = _str(e["by"], "by", CODE_RE)
    if e.get("ai") is True:
        out["ai"] = True
    return out


def decay_of(rec: dict, now: float, season: str) -> float:
    """carrion.js decayOf: the age's warmth (the day's swing integrated) over the life, plus the share eaten."""
    age = max(0.0, now - rec["born"])
    w = 2 * math.pi / 86400

    def ph(t: float) -> float:
        return (t + (TILE_UTC - DIURNAL_PEAK) * 3600) * w

    warm = age + DIURNAL * (math.sin(ph(rec["born"] + age)) - math.sin(ph(rec["born"]))) / w
    m0 = rec["mass"]
    d = SEASON_HEAT.get(season, 1.0) * warm / (rec["lifeH"] * 3600) + EAT_K * (rec["eaten"] / m0 if m0 > 0 else 1)
    if rec["meat"] <= 1e-6:
        d = max(d, BONES_D)
    return min(1.0, d)


def carrion_reduce(c: dict, e: dict, now: float) -> str | None:
    """carrion.js apply on the persisted shape; None when applied, else why not."""
    L = c["list"]
    if e["type"] == "carcass":
        if e["id"] in L:
            return "taken"
        if len(L) >= CAP:
            return "full"
        L[e["id"]] = {"one": e["one"], "sp": e["sp"], "x": e["x"], "y": e["y"], "z": e["z"], "yaw": e["yaw"], "size": e["size"],
                      "mass": e["mass"], "meat": e["mass"], "eaten": 0.0, "born": round(now, 1), "lifeH": life_of(e["mass"]),
                      **({"by": e["by"]} if "by" in e else {})}
        return None
    rec = L.get(e["id"])
    if not rec:
        return "no such carcass"
    got = min(rec["meat"], e["kg"])
    if got <= 0:
        return "nothing left"
    rec["meat"] = round(rec["meat"] - got, 4)
    rec["eaten"] = round(rec["eaten"] + got, 4)
    return None


def carrion_sweep(c: dict, now: float, season: str) -> dict | None:
    """The carcasses whose decay has reached 1: removed. Returns the event ({type: 'gone', ids}) or None."""
    ids = [i for i, rec in c["list"].items() if decay_of(rec, now, season) >= 1]
    if not ids:
        return None
    for i in ids:
        del c["list"][i]
    return {"type": "gone", "ids": ids}


def carrion_apply(c: dict, e: dict, now: float) -> None:
    """A logged line replayed: its event at its time."""
    if e.get("type") == "gone":
        for i in e.get("ids", []):
            c["list"].pop(i, None)
    else:
        carrion_reduce(c, e, now)
