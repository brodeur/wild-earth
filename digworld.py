"""The Dig game's shared state (docs/game-dig.md): the tunnels, chambers, holes and pits of a tile, as one part of the
acorn game's world per tile and season (server.py GameWorld, its snapshot's `dig` and its log's `dig` lines).

The world is changed only by dig_reduce(d, e, now), the port of client/src/dig.js applyEvent: every client applies
the same events in the server's order. Events are anonymous: no player id or AI animal id is ever attached, so a
tunnel's position is never stored beside whose it was. `seen` holds, per tunnel system and per pit, the wall-clock time
(s since the epoch) an animal was last inside (a dig, a visit); dig_decay removes a system or a pit unseen for
DIG_IDLE_S (a week). Standard library only.
"""
from __future__ import annotations

import math
import re

DIG_IDLE_S = 7 * 86400          # a ground hole or a tunnel system no animal has entered for a week goes
TILE_M = 10000.0
N_MAX, S_MAX, P_MAX = 5000, 5000, 120   # as client/src/dig.js (MAX_N, MAX_S, MAX_P): the carving has no per-slot buffers (docs/game-dig.md)
R_MIN, R_MAX, PIT_R_MAX, PIT_D_MAX = 0.01, 0.12, 1.3, 0.75
STEP_MAX = 0.6                  # m from the node a dig starts at (the client's steps are 2 cm; a grown segment 35 cm)
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
TYPES = ("hole", "dig", "grow", "join", "widen", "room", "surface", "pit", "open", "visit", "pull", "den", "denk")
PULL_MAX = 3000                  # plants pulled down from below in one tile and season (a pull is never a player's: no id)
SP_RE = re.compile(r"^[a-z][a-z0-9_]{1,60}$")
ROOM_REACH = 0.45                # m: the farthest an absorbed node lies from a room's centre
# A den (client/src/digDen.js, docs/game-dig.md "Dens"): a room node planned off a tunnel node `at`, its plan in "dn"
# [ax, ay, az, ar, x, y, z, r, k]: it starts where `at` stood (ax.., ar) and, as the den is dug (k, 0..1, only rising:
# `denk`), its centre moves to (x, y, z) and its radius grows to r. The node's x, y, z, r are always the plan at k.
DEN_R_MIN, DEN_R_MAX, DEN_REACH, DEN_MAX, DEN_AT = 0.08, 0.4, 0.7, 200, 0.05


def den_place(n: dict) -> None:
    """A den node's x, y, z, r from its plan at its progress (client/src/dig.js denPlace, the same arithmetic)."""
    ax, ay, az, ar, x, y, z, r, k = n["dn"]
    n["x"], n["y"], n["z"], n["r"] = ax + (x - ax) * k, ay + (y - ay) * k, az + (z - az) * k, ar + (r - ar) * k


def empty() -> dict:
    return {"v": 1, "seq": 0, "nodes": {}, "segs": {}, "pits": {}, "seen": {}, "pulls": {}}


def _num(v, what: str, lo: float = -1e7, hi: float = 1e7) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError(f"{what} must be a number in [{lo}, {hi}]")
    return round(float(v), 4)


def _id(v, what: str) -> str:
    if not (isinstance(v, str) and ID_RE.match(v)):
        raise ValueError(f"{what} must be an id")
    return v


def clean(e) -> dict:
    """The fields each event keeps, checked; anything else (a player or animal id among them) is dropped."""
    if not isinstance(e, dict) or e.get("type") not in TYPES:
        raise ValueError("type must be one of " + ", ".join(TYPES))
    t, out = e["type"], {"type": e["type"]}
    xyz = lambda: {"x": _num(e.get("x"), "x", 0, TILE_M), "y": _num(e.get("y"), "y", -1000, 9000), "z": _num(e.get("z"), "z", -TILE_M, 0)}
    if t == "hole":
        out.update(id=_id(e.get("id"), "id"), **xyz(), r=_num(e.get("r", 0.03), "r", R_MIN, R_MAX))
    elif t == "dig":
        out.update(id=_id(e.get("id"), "id"), seg=_id(e.get("seg"), "seg"), **{"from": _id(e.get("from"), "from")}, **xyz())
        if "r" in e:
            out["r"] = _num(e["r"], "r", R_MIN, R_MAX)
    elif t == "grow":
        out.update(id=_id(e.get("id"), "id"), **xyz())
    elif t == "join":
        out.update(a=_id(e.get("a"), "a"), b=_id(e.get("b"), "b"), seg=_id(e.get("seg"), "seg"))
    elif t == "widen":
        ids = e.get("ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 32:
            raise ValueError("ids must be a list of 1 to 32 ids")
        out.update(ids=[_id(i, "ids") for i in ids], r=_num(e.get("r"), "r", R_MIN, R_MAX))
    elif t == "room":
        ab = e.get("absorb")
        if not isinstance(ab, list) or not 1 <= len(ab) <= 64:
            raise ValueError("absorb must be a list of 1 to 64 ids")
        out.update(id=_id(e.get("id"), "id"), **xyz(), r=_num(e.get("r"), "r", R_MIN, R_MAX), absorb=[_id(i, "absorb") for i in ab])
    elif t == "surface":
        out.update(id=_id(e.get("id"), "id"), y=_num(e.get("y"), "y", -1000, 9000))
    elif t == "den":   # a den planned off node `at`: its centre and radius, and where it starts (at's place and bore)
        out.update(id=_id(e.get("id"), "id"), seg=_id(e.get("seg"), "seg"), at=_id(e.get("at"), "at"), **xyz(),
                   r=_num(e.get("r"), "r", DEN_R_MIN, DEN_R_MAX), ax=_num(e.get("ax"), "ax", 0, TILE_M), ay=_num(e.get("ay"), "ay", -1000, 9000),
                   az=_num(e.get("az"), "az", -TILE_M, 0), ar=_num(e.get("ar"), "ar", R_MIN, R_MAX))
    elif t == "denk":   # a den dug further: its progress, 0..1
        out.update(id=_id(e.get("id"), "id"), k=_num(e.get("k"), "k", 0, 1))
    elif t == "pit":
        out.update(id=_id(e.get("id"), "id"), x=_num(e.get("x"), "x", 0, TILE_M), z=_num(e.get("z"), "z", -TILE_M, 0),
                   y0=_num(e.get("y0"), "y0", -1000, 9000), r=_num(e.get("r"), "r", 0.02, PIT_R_MAX),
                   depth=_num(e.get("depth"), "depth", 0, PIT_D_MAX), hx=_num(e.get("hx"), "hx", 0, TILE_M), hz=_num(e.get("hz"), "hz", -TILE_M, 0))
        if e.get("k") == "form":   # a jackrabbit's scraped form (dig.js DIGGERS), not a coyote's pit
            out["k"] = "form"
    elif t == "open":
        segs = e.get("segs")
        if not isinstance(segs, list) or not 1 <= len(segs) <= 64:
            raise ValueError("segs must be a list of 1 to 64 ids")
        out.update(pit=_id(e.get("pit"), "pit"), segs=[_id(s, "segs") for s in segs])
    elif t == "pull":   # a plant pulled down into a tunnel from below (dig.js): its deterministic id, where it lies, what is left of it
        sp = e.get("sp")
        if not isinstance(sp, str) or not SP_RE.match(sp):
            raise ValueError("sp must be a species id")
        out.update(id=_id(e.get("id"), "id"), **xyz(), sp=sp, left=_num(e.get("left", 1), "left", 0, 1))
    elif t == "visit":
        if "sys" in e:
            out["sys"] = _id(e["sys"], "sys")
        elif "pit" in e:
            out["pit"] = _id(e["pit"], "pit")
        else:
            raise ValueError("a visit names a sys or a pit")
    if e.get("ai") is True:
        out["ai"] = True
    return out


def _adj(d: dict) -> dict:
    """node id -> its segment ids (memory only, rebuilt when missing)."""
    a = d.get("_adj")
    if a is None:
        a = {n: [] for n in d["nodes"]}
        for sid, (x, y) in d["segs"].items():
            a.setdefault(x, []).append(sid)
            a.setdefault(y, []).append(sid)
        d["_adj"] = a
    return a


def _see(d: dict, key: str, now: float) -> None:
    d["seen"][key] = round(now)


def dig_reduce(d: dict, e: dict, now: float) -> str | None:
    """client/src/dig.js applyEvent on the persisted shape; None when applied, else why not."""
    N, S, P, A = d["nodes"], d["segs"], d["pits"], _adj(d)
    t = e["type"]
    taken = lambda i: i in N or i in S or i in P
    if t == "hole":
        if taken(e["id"]) or len(N) >= N_MAX:
            return "taken" if taken(e["id"]) else "full"
        N[e["id"]] = {"x": e["x"], "y": e["y"], "z": e["z"], "r": e["r"], "h": 1, "sys": e["id"], "o": 0}
        A[e["id"]] = []
        _see(d, e["id"], now)
        return None
    if t == "dig":
        a = N.get(e["from"])
        if not a:
            return "no such node"
        if taken(e["id"]) or taken(e["seg"]) or e["id"] == e["seg"]:
            return "taken"
        if len(N) >= N_MAX or len(S) >= S_MAX:
            return "full"
        if math.dist((a["x"], a["y"], a["z"]), (e["x"], e["y"], e["z"])) > STEP_MAX:
            return "too far"
        N[e["id"]] = {"x": e["x"], "y": e["y"], "z": e["z"], "r": e.get("r", min(a["r"], 0.03)), "h": 0, "sys": a["sys"], "o": 0}
        S[e["seg"]] = [e["from"], e["id"]]
        A[e["id"]] = [e["seg"]]
        A.setdefault(e["from"], []).append(e["seg"])
        _see(d, a["sys"], now)
        return None
    if t == "grow":
        n = N.get(e["id"])
        if not n or n["h"] or n.get("k") or len(A.get(e["id"], [])) != 1:
            return "not a face"
        other = S[A[e["id"]][0]]
        o = N[other[0] if other[1] == e["id"] else other[1]]
        if math.dist((o["x"], o["y"], o["z"]), (e["x"], e["y"], e["z"])) > STEP_MAX:
            return "too far"
        n["x"], n["y"], n["z"] = e["x"], e["y"], e["z"]
        _see(d, n["sys"], now)
        return None
    if t == "join":
        a, b = N.get(e["a"]), N.get(e["b"])
        if not a or not b or e["a"] == e["b"]:
            return "no such node"
        if taken(e["seg"]) or len(S) >= S_MAX:
            return "taken"
        if any(e["b"] in S[s] for s in A.get(e["a"], [])):
            return "joined"
        if math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"])) > STEP_MAX:
            return "too far"
        S[e["seg"]] = [e["a"], e["b"]]
        A[e["a"]].append(e["seg"])
        A[e["b"]].append(e["seg"])
        if a["sys"] != b["sys"]:
            old, new = b["sys"], a["sys"]
            for n in N.values():
                if n["sys"] == old:
                    n["sys"] = new
            d["seen"][new] = max(d["seen"].get(new, 0), d["seen"].pop(old, 0))
        _see(d, a["sys"], now)
        return None
    if t == "widen":
        ok = False
        for i in e["ids"]:
            n = N.get(i)
            if n and "dn" not in n:   # (a den grows only as it is dug)
                r = min(R_MAX, max(n["r"], e["r"]))
                if r != n["r"]:
                    n["r"], ok = r, True
                _see(d, n["sys"], now)
        return None if ok else "no change"
    if t == "room":
        # a chamber: one node (a sphere of radius r) in place of the nodes round it; their segments to the outside now
        # end at it, the ones among them go, and of two to the same outside node one stays
        if taken(e["id"]) or len(N) >= N_MAX:
            return "taken"
        ab = [N.get(i) for i in e["absorb"]]
        if any(n is None or n["h"] or "dn" in n for n in ab):   # (a den is never absorbed into a chamber)
            return "no such node"
        sys = {n["sys"] for n in ab}
        if len(sys) != 1 or any(math.dist((n["x"], n["y"], n["z"]), (e["x"], e["y"], e["z"])) > ROOM_REACH for n in ab):
            return "not one place"
        gone, rid = set(e["absorb"]), e["id"]
        N[rid] = {"x": e["x"], "y": e["y"], "z": e["z"], "r": e["r"], "h": 0, "sys": ab[0]["sys"], "o": 1 if any(n["o"] for n in ab) else 0, "k": 1}
        A[rid], dropped, outside = [], set(), set()
        for sid in sorted({x for i in gone for x in A.get(i, [])}):
            a, b = S[sid]
            if a in gone and b in gone:
                dropped.add(sid)
                continue
            other = b if a in gone else a
            if other in outside:
                dropped.add(sid)
                continue
            outside.add(other)
            S[sid] = [rid, other]
            A[rid].append(sid)
        for sid in dropped:
            del S[sid]
        for i in gone:
            del N[i]
            A.pop(i, None)
        for lst in A.values():
            lst[:] = [x for x in lst if x not in dropped]
        for p in P.values():
            p["o"] = [x for x in p["o"] if x not in dropped]
        _see(d, ab[0]["sys"], now)
        return None
    if t == "surface":
        n = N.get(e["id"])
        if not n or n["h"]:
            return "no such node"
        n["h"], n["y"] = 1, e["y"]
        _see(d, n["sys"], now)
        return None
    if t == "pit":
        p = P.get(e["id"])
        if not p:
            if taken(e["id"]) or len(P) >= P_MAX:
                return "taken" if taken(e["id"]) else "full"
            P[e["id"]] = {"x": e["x"], "z": e["z"], "y0": e["y0"], "r": e["r"], "d": e["depth"], "hx": e["hx"], "hz": e["hz"], "o": [], **({"k": "form"} if e.get("k") == "form" else {})}
            _see(d, e["id"], now)
            return None
        if e["depth"] <= p["d"] and e["r"] <= p["r"]:
            return "no change"
        p["d"], p["r"] = max(p["d"], e["depth"]), max(p["r"], e["r"])
        _see(d, e["id"], now)
        return None
    if t == "open":
        p = P.get(e["pit"])
        if not p:
            return "no such pit"
        ok = False
        for s in e["segs"]:
            if s in S and s not in p["o"]:
                p["o"].append(s)
                for n in S[s]:
                    N[n]["o"] = 1
                _see(d, N[S[s][0]]["sys"], now)
                ok = True
        return None if ok else "no change"
    if t == "pull":
        # The plant is gone from the surface for the tile and season (it lies in the tunnel as food until eaten: left
        # falls as it is eaten). Not tied to a tunnel system: it stays when the tunnels decay.
        U = d.setdefault("pulls", {})
        u = U.get(e["id"])
        if u is None:
            if len(U) >= PULL_MAX:
                return "full"
            U[e["id"]] = {"x": e["x"], "y": e["y"], "z": e["z"], "sp": e["sp"], "l": e["left"]}
            return None
        if e["left"] >= u["l"]:
            return "no change"
        u["l"] = e["left"]
        return None
    if t == "den":
        a = N.get(e["at"])
        if not a:
            return "no such node"
        if "dn" in a and a["dn"][8] < 1:
            return "not dug yet"
        if taken(e["id"]) or taken(e["seg"]) or e["id"] == e["seg"]:
            return "taken"
        if len(N) >= N_MAX or len(S) >= S_MAX or sum(1 for n in N.values() if "dn" in n) >= DEN_MAX:
            return "full"
        if math.dist((a["x"], a["y"], a["z"]), (e["ax"], e["ay"], e["az"])) > DEN_AT or math.dist((e["ax"], e["ay"], e["az"]), (e["x"], e["y"], e["z"])) > DEN_REACH:
            return "too far"
        n = {"h": 0, "sys": a["sys"], "o": 0, "k": 1, "dn": [e["ax"], e["ay"], e["az"], e["ar"], e["x"], e["y"], e["z"], e["r"], 0.0]}
        den_place(n)
        N[e["id"]] = n
        S[e["seg"]] = [e["at"], e["id"]]
        A[e["id"]] = [e["seg"]]
        A.setdefault(e["at"], []).append(e["seg"])
        _see(d, a["sys"], now)
        return None
    if t == "denk":
        n = N.get(e["id"])
        if not n or "dn" not in n:
            return "no such den"
        if e["k"] <= n["dn"][8]:
            return "no change"
        n["dn"][8] = e["k"]
        den_place(n)
        _see(d, n["sys"], now)
        return None
    if t == "visit":
        k = e.get("sys") or e.get("pit")
        if k not in d["seen"] and k not in P and not any(n["sys"] == k for n in N.values()):
            return "no such place"
        _see(d, k, now)
        return None
    return "unknown type"


def dig_decay(d: dict, now: float, idle: float | None = None) -> dict | None:
    """The systems and pits no animal has entered for `idle` s (DIG_IDLE_S): removed. Returns the event that
    removed them ({type: 'decay', nodes, segs, pits}) for the clients, or None."""
    idle = DIG_IDLE_S if idle is None else idle
    N, S, P, A, seen = d["nodes"], d["segs"], d["pits"], _adj(d), d["seen"]
    systems = {n["sys"] for n in N.values()}
    old = {s for s in systems if now - seen.get(s, 0) > idle}
    pits = [p for p in P if now - seen.get(p, 0) > idle]
    if not old and not pits:
        return None
    nodes = [i for i, n in N.items() if n["sys"] in old]
    gone = set(nodes)
    segs = [s for s, ab in S.items() if ab[0] in gone or ab[1] in gone]
    for i in nodes:
        del N[i]
        A.pop(i, None)
    for s in segs:
        del S[s]
    for p in pits:
        del P[p]
        seen.pop(p, None)
    for s in old:
        seen.pop(s, None)
    gs = set(segs)
    for p in P.values():
        p["o"] = [s for s in p["o"] if s not in gs]
    return {"type": "decay", "nodes": nodes, "segs": segs, "pits": pits}


def dig_apply_decay(d: dict, e: dict) -> None:
    """A logged decay replayed."""
    N, S, P, A = d["nodes"], d["segs"], d["pits"], _adj(d)
    for i in e.get("nodes", []):
        N.pop(i, None)
        A.pop(i, None)
    gs = set(e.get("segs", []))
    for s in gs:
        S.pop(s, None)
    for p in e.get("pits", []):
        P.pop(p, None)
        d["seen"].pop(p, None)
    for a in A.values():
        a[:] = [s for s in a if s not in gs]
    for p in P.values():
        p["o"] = [s for s in p["o"] if s not in gs]
    live = {n["sys"] for n in N.values()}
    for k in list(d["seen"]):
        if k not in live and k not in P:
            del d["seen"][k]


def persisted(d: dict) -> dict:
    """The snapshot's shape: without the memory-only adjacency."""
    return {k: v for k, v in d.items() if not k.startswith("_")}
