"""A reader for uncompressed ArcInfo interchange files (.e00) holding a polygon coverage: the arcs, the polygons'
arc lists and the polygon attribute table. Enough for the held-out judge's Yellowstone maps (tools/probes/
composition.py); not a general e00 library. The file is read as text and never executed.

    cov = read(path)            # {'arcs': {id: [(x, y), ...]}, 'pal': [{'bbox': (x0, y0, x1, y1), 'arcs': [...]}],
                                #  'pat': [{'AREA': ..., 'NAME': ...}, ...], 'precision': 2 or 3}
    polygon(cov, k)             # shapely geometry of polygon k (1 = the universe polygon, k matches pat[k - 1])
"""
from __future__ import annotations

import math
import re


def _floats(line: str) -> list:
    return [float(x) for x in re.findall(r"[-+]?\d\.\d+E[-+]\d+", line)]


def read(path) -> dict:
    with open(path, "r", encoding="latin-1", newline="") as f:
        lines = [ln.rstrip("\r\n") for ln in f]
    if not lines or not lines[0].startswith("EXP  0"):
        raise ValueError("not an uncompressed e00 file (EXP  0 expected)")
    out = {"arcs": {}, "pal": [], "pat": [], "precision": None}
    i = 1
    n = len(lines)
    while i < n:
        head = lines[i]
        sec = head[:3]
        if sec == "ARC":
            out["precision"] = int(head.split()[1])
            per = 1 if out["precision"] == 3 else 2
            i += 1
            while True:
                h = lines[i].split()
                i += 1
                if h[0] == "-1":
                    break
                npts = int(h[6])
                pts = []
                for _ in range(math.ceil(npts / per)):
                    v = _floats(lines[i])
                    i += 1
                    pts += list(zip(v[0::2], v[1::2]))
                out["arcs"][int(h[0])] = pts[:npts]
        elif sec == "PAL":
            double = int(head.split()[1]) == 3
            i += 1
            while True:
                h = lines[i]
                i += 1
                if h.split()[0] == "-1":
                    break
                narcs = int(h.split()[0])
                box = _floats(h)
                if double:
                    box += _floats(lines[i])
                    i += 1
                ids = []
                for _ in range(math.ceil(narcs / 2)):
                    v = [int(x) for x in lines[i].split()]
                    i += 1
                    ids += v[0::3]
                out["pal"].append({"bbox": tuple(box[:4]), "arcs": ids[:narcs]})
        elif sec == "IFO":
            i += 1
            while i < n and not lines[i].startswith("EOI"):
                h = lines[i]
                name = h[:32].strip()
                nitems, nrec = int(h[34:38]), int(h[46:].split()[0])
                i += 1
                items = []
                for _ in range(nitems):
                    d = lines[i]
                    i += 1
                    items.append((d[:16].strip(), int(d[16:19]), int(d[34:37])))   # name, stored width, type
                widths = [_printed(w, t) for _, w, t in items]
                per_rec = math.ceil(sum(widths) / 80)
                recs = []
                for _ in range(nrec):
                    text = "".join(ln.ljust(80)[:80] for ln in lines[i:i + per_rec])
                    i += per_rec
                    if name.endswith(".PAT"):
                        rec, p = {}, 0
                        for (nm, _w, t), pw in zip(items, widths):
                            raw = text[p:p + pw]
                            p += pw
                            rec[nm] = _value(raw, t)
                        recs.append(rec)
                if name.endswith(".PAT"):
                    out["pat"] = recs
            i += 1
        else:
            i += 1
    return out


def _printed(width: int, typ: int) -> int:
    """The printed width of an INFO item in an e00 record."""
    if typ == 60:
        return 24 if width == 8 else 14
    if typ == 50:
        return 11 if width == 4 else 6
    if typ == 40:
        return 14
    return width            # 20 character, 10 date, 30 integer as text


def _value(raw: str, typ: int):
    s = raw.strip()
    if typ in (60, 40):
        return float(s) if s else None
    if typ in (50, 30):
        return int(s) if s else None
    return s


def rings(cov: dict, k: int) -> list:
    """Polygon k's rings as coordinate lists (the outer ring first, then its islands)."""
    out, cur = [], []
    for a in cov["pal"][k - 1]["arcs"]:
        if a == 0:
            if cur:
                out.append(cur)
            cur = []
            continue
        pts = cov["arcs"][abs(a)]
        pts = pts[::-1] if a < 0 else pts
        cur += pts if not cur or cur[-1] != pts[0] else pts[1:]
    if cur:
        out.append(cur)
    return [r for r in out if len(r) >= 4]


def polygon(cov: dict, k: int):
    from shapely.geometry import Polygon
    from shapely.validation import make_valid
    r = rings(cov, k)
    if not r:
        return None
    return make_valid(Polygon(r[0], r[1:]))


def areas_in_box(cov: dict, box: tuple) -> list:
    """[(pat record, area of the polygon inside box in m2), ...] for every polygon that reaches into box
    (x0, y0, x1, y1); the universe polygon (the first) is left out."""
    from shapely.geometry import box as _box
    b = _box(*box)
    out = []
    for k in range(2, len(cov["pal"]) + 1):
        x0, y0, x1, y1 = cov["pal"][k - 1]["bbox"]
        if x1 < box[0] or x0 > box[2] or y1 < box[1] or y0 > box[3]:
            continue
        g = polygon(cov, k)
        if g is None:
            continue
        a = g.intersection(b).area
        if a > 0:
            out.append((cov["pat"][k - 1], a))
    return out
