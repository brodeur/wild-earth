# A snake's client GLB built procedurally, with no mesh to start from (2026-11-07, the snake lane): the same GLB form as
# tools/build_snake.py writes (the snake template: client/src/animalModels.js SNAKE_BODY, RIG.snake), so the client needs
# no change. One rule for every snake, nothing per species: its size from its mass, its shape from its family, its pattern
# from an openly licensed photo of it.
#
#   arch -arm64 .venv/bin/python tools/build_snake_proc.py <code> <out.glb> [--photo <image>] [--strip <debug.png>]
#
# What it does:
#   - size: the body's volume is its mass (the trait card's, the amniote life-history database's for the reptiles) at RHO
#     1,000 kg/m3, as build_snake.py sizes a mesh. Its length comes from the snout-vent length where the amniote database
#     has one (plus the family's tail), else from the family's slenderness (FAMILY: total length over the largest girth;
#     a viper is stout, about 18, a colubrid or an elapid slim, about 30). The girth follows from the volume.
#   - shape (FAMILY, by family): the profile of the girth along the body (the head's length and width over the neck, the
#     neck, where the body is thickest, the vent, the tail's share and its taper), the head's flatness (a viper's broad
#     flat triangle, a colubrid's narrow rounded head), the cross-section a flattened ellipse with the belly on the floor.
#     The head (ahead of the neck) is HEAD 6, the rest BODY 0; each vertex's _PIVOT its centreline point.
#   - pattern: the photo (the reference photo rule's texture reference, pipeline/reference_photos.py, unless --photo):
#     the snake cut from it by the rule's segmenters, its centreline the longest path through the mask's skeleton, the
#     head the wider end; across the body at each step along it the colours from one flank over the back to the other,
#     unrolled into a strip (along x across), each across-column brought to the strip's mean lightness (the photo's light
#     from above taken out). On the body: the back and the upper flanks from the strip, the belly from the appearance
#     card's first underparts colour (pipeline/appearance.py), blended over the lower flanks. Each face of each tier takes
#     its strip colour, the palette made from them (k-means, 10, as build_snake.py) and each face the nearest palette
#     colour.
#   - the tiers as structured tubes (build_snake.py's): rings of 16, 10 and 6 points round, spaced evenly to the tier's
#     budget (lod0 1,200 + 800 log10(mass / 0.1 kg), 1,000-5,000; lod1 0.36, lod2 0.1 of it, at least 120), both ends
#     closed by a fan; flat colour per face.
# The model is judged as any other (pipeline/fauna_models.py acceptance: built, the gate, the fitted appearance check).
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
RHO = 1000.0
HEAD, BODY = 6, 0

# By family: slender (total length / the largest girth), tail (the tail's share of the length), head (its share), head_w
# (the head's widest over the body's largest girth), neck (the neck's girth over the largest), peak (where the body is
# thickest, of the length), head_h (the head's height over its width), body_h (the body's), snout (the snout's tip's width
# over the head's), apex (where the head is widest, of its length). Sources: Greene 1997 (Snakes: the evolution of mystery in nature), Feldman & Meiri 2013 (length-mass
# allometry in snakes): vipers short, heavy and short-tailed with a broad head on a thin neck; colubrids and elapids
# long and slim, the head little wider than the neck; boas and pythons heavy and long.
FAMILY = {
    "viper": dict(slender=18, tail=0.12, head=0.065, head_w=1.2, neck=0.45, peak=0.48, head_h=0.5, body_h=0.82, snout=0.3, apex=0.82),
    "constrictor": dict(slender=22, tail=0.12, head=0.05, head_w=0.9, neck=0.55, peak=0.5, head_h=0.6, body_h=0.85, snout=0.4, apex=0.7),
    "elapid": dict(slender=32, tail=0.18, head=0.04, head_w=0.85, neck=0.7, peak=0.45, head_h=0.7, body_h=0.9, snout=0.5, apex=0.6),
    "colubrid": dict(slender=30, tail=0.25, head=0.045, head_w=0.95, neck=0.72, peak=0.4, head_h=0.68, body_h=0.88, snout=0.45, apex=0.62),
}
GROUP = {"Viperidae": "viper", "Boidae": "constrictor", "Pythonidae": "constrictor", "Elapidae": "elapid"}
AROUND = {"lod0": 16, "lod1": 10, "lod2": 6}


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def width_profile(u, F):
    """The girth (half-width over the largest) at u (0 the snout, 1 the tail tip)."""
    u = np.asarray(u, dtype=np.float64)
    h, vent = F["head"], 1 - F["tail"]
    # the head widens from the snout to its widest at `apex` of its length (a viper's at the jaws' hinge, a broad triangle
    # seen from above; a colubrid's sooner and rounder), then narrows to the neck
    ap = F["apex"] * h
    head = F["head_w"] * (F["snout"] + (1 - F["snout"]) * np.clip(u / ap, 0, 1) ** 0.8) * (1 - (1 - F["neck"] / F["head_w"]) * smooth(ap, h, u))
    body = F["neck"] + (1 - F["neck"]) * smooth(h, F["peak"], u)
    body = np.where(u > F["peak"], 1 - 0.2 * smooth(F["peak"] + 0.1, vent, u), body)
    tail = 0.8 * np.clip(1 - (u - vent) / (1 - vent), 0, 1) ** 0.85 + 0.03
    return np.where(u < h, head, np.where(u < vent, body, np.minimum(body, tail)))


def height_profile(u, F):
    h = F["head"]
    return np.where(u < h, F["head_h"] + (F["body_h"] - F["head_h"]) * smooth(0.6 * h, h, u), F["body_h"])


def lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---- the pattern from the photo ----------------------------------------------------------------------------------
def thin(mask):
    """Zhang-Suen thinning of a boolean mask (a one-pixel skeleton)."""
    img = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            P = [img[1:-1, 1:-1], img[:-2, 1:-1], img[:-2, 2:], img[1:-1, 2:], img[2:, 2:], img[2:, 1:-1], img[2:, :-2], img[1:-1, :-2], img[:-2, :-2]]
            p1, p2, p3, p4, p5, p6, p7, p8, p9 = P
            B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            A = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(np.uint8) for k in range(8))
            c1 = p2 * p4 * p6 if step == 0 else p2 * p4 * p8
            c2 = p4 * p6 * p8 if step == 0 else p2 * p6 * p8
            rm = (p1 == 1) & (B >= 2) & (B <= 6) & (A == 1) & (c1 == 0) & (c2 == 0)
            if rm.any():
                img[1:-1, 1:-1][rm] = 0; changed = True
        if not changed:
            return img[1:-1, 1:-1].astype(bool)


def longest_path(skel):
    """The longest of the shortest paths through a skeleton (two breadth-first searches), as (row, col) pixels."""
    from collections import deque
    pts = set(zip(*np.nonzero(skel)))
    if not pts:
        return []
    def bfs(s):
        prev = {s: None}; q = deque([s]); last = s
        while q:
            p = q.popleft(); last = p
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    n = (p[0] + dy, p[1] + dx)
                    if n in pts and n not in prev:
                        prev[n] = p; q.append(n)
        return last, prev
    a, _ = bfs(next(iter(pts)))
    b, prev = bfs(a)
    path = [b]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    return path


def unroll(photo: Path, n_along=240, n_across=48, debug: Path | None = None):
    """The snake in the photo as a strip (n_along x n_across x 3, linear rgb), the head first, the across axis from its left
    flank over its back to its right; and how it was read."""
    import cv2
    from PIL import Image
    from pipeline import reference_photos as rp
    full = np.asarray(Image.open(photo).convert("RGB"))
    s = 512 / max(full.shape[:2])
    small = np.asarray(Image.fromarray(full).resize((max(1, int(full.shape[1] * s)), max(1, int(full.shape[0] * s)))))
    prob = rp.subject_mask(small)
    fg = (prob >= 128).astype(np.uint8)
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n < 2:
        raise SystemExit("no snake found in the photo")
    comp = (lab_ == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])))
    dist = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 5)
    path = longest_path(thin(comp))
    if len(path) < 20:
        raise SystemExit("the snake's centreline is too short in the photo")
    P = np.array(path, dtype=np.float64)
    k = 7   # smoothed
    Ps = np.array([P[max(0, i - k):i + k + 1].mean(0) for i in range(len(P))])
    seg = np.linalg.norm(np.diff(Ps, axis=0), axis=1); arc = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, arc[-1], n_along)
    C = np.stack([np.interp(t, arc, Ps[:, 0]), np.interp(t, arc, Ps[:, 1])], 1)
    half = np.array([dist[int(round(y)), int(round(x))] for y, x in C])
    half = np.array([np.median(half[max(0, i - 4):i + 5]) for i in range(len(half))])
    m = max(3, n_along // 12)
    flipped = half[-m:].mean() > half[:m].mean()   # the head: the wider end
    if flipped:
        C, half = C[::-1], half[::-1]
    T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    Nrm = np.stack([-T[:, 1], T[:, 0]], 1)   # the across direction (one side; which flank is which does not matter)
    # each cross-section re-centred on the body: the run of mask along the normal through the skeleton's point, its middle
    # the centre and its half length the half-width (the skeleton wanders inside a thick body: the stripes would wave)
    hh, ww_ = comp.shape
    off = np.linspace(-3, 3, 241)
    cen, hw = np.zeros(len(C)), np.zeros(len(C))
    for i in range(len(C)):
        r = max(2.0, half[i])
        q = C[i][None, :] + Nrm[i][None, :] * (off[:, None] * r)
        yy, xx = np.clip(np.rint(q[:, 0]).astype(int), 0, hh - 1), np.clip(np.rint(q[:, 1]).astype(int), 0, ww_ - 1)
        inside = comp[yy, xx]
        mid = len(off) // 2
        if not inside[mid]:
            cen[i], hw[i] = 0.0, r; continue
        a_ = mid
        while a_ > 0 and inside[a_ - 1]: a_ -= 1
        b_ = mid
        while b_ < len(off) - 1 and inside[b_ + 1]: b_ += 1
        cen[i] = (off[a_] + off[b_]) / 2 * r; hw[i] = (off[b_] - off[a_]) / 2 * r
    k2 = 5
    cen = np.array([np.median(cen[max(0, i - k2):i + k2 + 1]) for i in range(len(C))])
    hw = np.array([np.median(hw[max(0, i - k2):i + k2 + 1]) for i in range(len(C))])
    C = C + Nrm * cen[:, None]
    w = np.maximum(hw, np.median(hw) * 0.5) * 0.92
    v = np.linspace(-1, 1, n_across)
    pts = C[:, None, :] + Nrm[:, None, :] * (w[:, None, None] * v[None, :, None])
    ys, xs = pts[..., 0] / s, pts[..., 1] / s
    H, W = full.shape[:2]
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 2); x0 = np.clip(np.floor(xs).astype(int), 0, W - 2)
    fy = np.clip(ys - y0, 0, 1)[..., None]; fx = np.clip(xs - x0, 0, 1)[..., None]
    F = full.astype(np.float64) / 255
    strip = (F[y0, x0] * (1 - fx) * (1 - fy) + F[y0, x0 + 1] * fx * (1 - fy) + F[y0 + 1, x0] * (1 - fx) * fy + F[y0 + 1, x0 + 1] * fx * fy)
    strip = lin(strip)
    # the light from above taken out: the across-columns' mean lightness fitted by a parabola over the across axis (the
    # light's smooth fall-off to the flanks) and divided out; a stripe, a column brighter than its neighbours, stays
    Y = strip @ np.array([0.2126, 0.7152, 0.0722])
    colm = Y.mean(0); fit = np.polyval(np.polyfit(np.linspace(-1, 1, n_across), colm, 2), np.linspace(-1, 1, n_across))
    gain = np.clip(colm.mean() / (fit + 1e-6), 0.6, 1.7)
    strip = np.clip(strip * gain[None, :, None], 0, 1)
    if debug:
        from PIL import Image as I2
        I2.fromarray((np.clip(strip, 0, 1).transpose(1, 0, 2) ** (1 / 2.2) * 255).astype(np.uint8)).resize((n_along * 3, n_across * 3)).save(debug)   # (along across the image, the head at the left)
    return strip, {"photo_px_long": round(float(arc[-1] / s)), "head_end": "flipped" if flipped else "first", "half_width_px": round(float(np.median(half) / s), 1)}


# ---- the mesh --------------------------------------------------------------------------------------------------
def build(code: str, out: Path, photo: Path | None = None, strip_debug: Path | None = None) -> dict:
    from pipeline.appearance import colour_lab, lab_to_hex, _hex_lin
    traits = json.loads((ROOT / "library" / "animals" / "traits" / f"{code}.json").read_text())
    tax = traits.get("taxonomy") or {}
    fam = tax.get("family") or ""
    group = GROUP.get(fam, "colubrid"); F = FAMILY[group]
    mass = float(traits.get("mass_kg") or 0.3)
    svl = None
    try:
        from pipeline.amniote import lookup
        a = lookup(traits.get("scientific") or code.replace("_", " ").capitalize())
        mass = float(a.get("mass_kg") or mass); svl = a.get("svl_m")
    except Exception:
        pass
    V = mass / RHO
    u = np.linspace(0, 1, 2001)
    K = float(np.trapz(width_profile(u, F) * height_profile(u, F), u))   # V = pi R^2 L K
    if svl:
        L = svl / (1 - F["tail"]); R = math.sqrt(V / (math.pi * L * K)); length_by = "the amniote database's snout-vent length and the family's tail"
    else:
        L = (4 * F["slender"] ** 2 * V / (math.pi * K)) ** (1 / 3); R = L / (2 * F["slender"]); length_by = f"the family's slenderness ({F['slender']} girths long)"
    # the pattern
    ref = None
    if photo is None:
        from pipeline import reference_photos as rp
        r = rp.ranked(code, n=1, use="texture")
        if not r:
            raise SystemExit(f"{code}: no texture reference photo (pipeline/reference_photos.py)")
        ref = rp.attribution(r[0]); photo = ROOT / r[0]["file_crop"]
    strip, read = unroll(Path(photo), debug=strip_debug)
    app = {}
    try:
        app = json.loads((ROOT / "library" / "animals" / "appearance" / f"{code}.json").read_text())
    except (OSError, ValueError):
        pass
    belly_word = next(iter((app.get("regions") or {}).get("underparts", {}).get("colours") or []), None)
    bl = colour_lab(belly_word) if belly_word else None
    belly = _hex_lin(lab_to_hex(bl)) if bl is not None else np.array(strip[:, [0, -1]].reshape(-1, 3).mean(0)) * 1.3
    na_, nc_ = strip.shape[:2]

    def colour_at(uu, th):   # th: 0 the back, +-pi the belly
        i = min(na_ - 1, max(0, int(uu * (na_ - 1) + 0.5)))
        a = abs(th)
        if a <= math.pi / 2:
            j = int((th / (math.pi / 2) * 0.5 + 0.5) * (nc_ - 1) + 0.5)
            return strip[i, min(nc_ - 1, max(0, j))]
        edge = strip[i, 0 if th < 0 else nc_ - 1]
        k = float(smooth(math.pi / 2, 0.78 * math.pi, a))
        return edge * (1 - k) + belly * k

    L0 = int(min(5000, max(1000, 1200 + 800 * math.log10(mass / 0.1))))
    tiers_spec = [("lod0", L0), ("lod1", max(120, int(0.36 * L0))), ("lod2", max(120, int(0.1 * L0)))]
    zS, zT = L / 2, -L / 2
    neck_u = F["head"]
    faces_col = []
    tiers = []
    for name, target in tiers_spec:
        na = AROUND[name]; nr = max(8, int(target / (2 * na)))
        us = (np.arange(nr) + 0.5) / nr
        wr, hr = width_profile(us, F) * R, height_profile(us, F) * width_profile(us, F) * R
        verts, piv, part = [], [], []
        for k in range(nr):
            z = zS - us[k] * L; cy = hr[k]
            for j in range(na):
                th = 2 * math.pi * j / na   # 0 the back, pi the belly
                x, y = wr[k] * math.sin(th), cy + hr[k] * math.cos(th)
                y = max(y, 0.12 * hr[k]) if math.cos(th) < -0.6 else y   # the belly flattened on the floor
                verts.append((x, y, z)); piv.append((0.0, cy, z)); part.append(HEAD if us[k] < neck_u else BODY)
        sn = len(verts); verts.append((0.0, hr[0], zS)); piv.append((0.0, hr[0], zS)); part.append(HEAD)
        tl = len(verts); verts.append((0.0, hr[-1], zT)); piv.append((0.0, hr[-1], zT)); part.append(BODY)
        tris, tri_uth = [], []
        for k in range(nr - 1):
            for j in range(na):
                a_, b_ = k * na + j, k * na + (j + 1) % na
                thc = 2 * math.pi * (j + 0.5) / na; thc = thc - 2 * math.pi if thc > math.pi else thc
                uc = (us[k] + us[k + 1]) / 2
                tris += [(a_, b_, b_ + na), (a_, b_ + na, a_ + na)]; tri_uth += [(uc, thc), (uc, thc)]   # (counter-clockwise seen from outside: three.js culls the back faces)
        for j in range(na):
            thc = 2 * math.pi * (j + 0.5) / na; thc = thc - 2 * math.pi if thc > math.pi else thc
            tris.append((sn, (j + 1) % na, j)); tri_uth.append((us[0] / 2, thc))
            o_ = (nr - 1) * na; tris.append((tl, o_ + j, o_ + (j + 1) % na)); tri_uth.append((1 - (1 - us[-1]) / 2, thc))
        cols = np.array([colour_at(uc, thc) for uc, thc in tri_uth])
        faces_col.append(cols)
        tiers.append((name, verts, piv, part, tris))
    # the palette (k-means, 10, in gamma space as build_snake.py) and each face its nearest colour
    allc = np.concatenate(faces_col) ** (1 / 2.2)
    rng = np.random.default_rng(7)
    cent = allc[rng.choice(len(allc), min(10, len(allc)), replace=False)]
    for _ in range(25):
        labl = np.argmin(((allc[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
        for k in range(len(cent)):
            msk = labl == k
            cent[k] = allc[msk].mean(0) if msk.any() else allc[rng.integers(len(allc))]
    PAL = cent ** 2.2
    out_tiers = []
    for (name, verts, piv, part, tris), cols in zip(tiers, faces_col):
        idx_c = np.argmin(((cols[:, None, :] ** (1 / 2.2) - cent[None]) ** 2).sum(-1), axis=1)
        e = dict(pos=[], col=[], part=[], partw=[], piv=[], idx=[])
        key = {}
        for f, t in enumerate(tris):
            c = tuple(float(x) for x in PAL[idx_c[f]])
            for vi in t:
                kk = (vi, idx_c[f])
                if kk not in key:
                    key[kk] = len(e["pos"])
                    e["pos"].append(verts[vi]); e["col"].append(c); e["part"].append(float(part[vi])); e["partw"].append(1.0); e["piv"].append(piv[vi])
                e["idx"].append(key[kk])
        out_tiers.append((name, e))
    common = traits.get("common") or code
    rig = {"kind": "snake", "archetype": "snake", "snout_z": round(zS, 4), "tail_end_z": round(zT, 4), "neck_z": round(zS - neck_u * L, 4),
           "length_m": round(L, 3), "radius_m": round(R, 4), "belly_y": 0.0, "back_y": round(2 * R * F["body_h"], 4),
           "taper": round(float(width_profile(np.array([1 - F["tail"] / 2]), F)[0]), 3)}
    credit = f"; the pattern from {ref['attribution']}" if ref else ""
    extras = {"species": code, "archetype": "snake", "mass_kg": mass, "length_m": round(L, 3), "size_by": f"mass at {RHO:g} kg/m3",
              "length_by": length_by, "family": fam, "shape": group, "colour": "photo (unrolled along the body)", "reference": ref,
              "photo_read": read, "belly": belly_word, "card_length_m": (traits.get("size") or {}).get("length_m"),
              "build": "tools/build_snake_proc.py", "rig": rig,
              "parts": "snake template: the body straight along +z (snout +z), each vertex's pivot its centreline point (its arc parameter in z); HEAD 6 ahead of the neck, BODY 0"}
    write_glb(out, out_tiers, "wild-earth tools/build_snake_proc.py (procedural)",
              f"{common}, built procedurally for Wild Earth (no source mesh){credit}; CC BY-SA 4.0", extras)
    return extras


def write_glb(path, tiers, generator, copyright, extras):
    """tools/animal_glb.py write_glb's form (no Blender): one mesh per tier, POSITION, COLOR_0, _PART, _PARTW, _PIVOT."""
    import struct
    buf = bytearray(); views = []; accs = []
    def add(data, target):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target}); return len(views) - 1
    def acc_f(vals, n):
        arr = np.asarray(vals, dtype=np.float32).reshape(len(vals), n) if n > 1 else np.asarray(vals, dtype=np.float32)
        a = {"bufferView": add(arr.tobytes(), 34962), "componentType": 5126, "count": len(vals), "type": {1: "SCALAR", 3: "VEC3"}[n]}
        if n == 3: a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    def acc_i(vals):
        big = max(vals) > 65535
        arr = np.asarray(vals, dtype=np.uint32 if big else np.uint16)
        accs.append({"bufferView": add(arr.tobytes(), 34963), "componentType": 5125 if big else 5123, "count": len(vals), "type": "SCALAR"})
        return len(accs) - 1
    meshes, nodes = [], []
    for name, t in tiers:
        attrs = {"POSITION": acc_f(t["pos"], 3), "COLOR_0": acc_f(t["col"], 3), "_PART": acc_f(t["part"], 1), "_PARTW": acc_f(t["partw"], 1), "_PIVOT": acc_f(t["piv"], 3)}
        meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": acc_i(t["idx"]), "mode": 4}]})
        nodes.append({"name": name, "mesh": len(meshes) - 1})
    while len(buf) % 4: buf.append(0)
    g = {"asset": {"version": "2.0", "generator": generator, "copyright": copyright}, "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
         "nodes": nodes, "meshes": meshes, "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(buf)}], "extras": extras}
    js = json.dumps(g, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(buf), b"BIN\x00") + bytes(buf)
    Path(path).write_bytes(glb)
    print("WROTE", path, len(glb), "bytes;", ", ".join(f"{n} {len(t['idx']) // 3} tris" for n, t in tiers))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="a snake's GLB built procedurally (see the header)")
    ap.add_argument("code"); ap.add_argument("out"); ap.add_argument("--photo"); ap.add_argument("--strip")
    a = ap.parse_args()
    x = build(a.code, Path(a.out), Path(a.photo) if a.photo else None, Path(a.strip) if a.strip else None)
    print(json.dumps({k: x[k] for k in ("length_m", "length_by", "shape", "photo_read", "belly")}))
