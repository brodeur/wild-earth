"""Likeness: a generated model against photographs of its species (docs/avatar-realism.md "The gates before credits";
docs/decisions.md 2026-11-12).

The appearance check (pipeline/appearance.py) asks whether a model wears the colours a description names. A coat can
pass it and still not be the animal's: the generated coyote (2026-11-12) had a grey back, a black saddle and rufous
legs, every one a colour the description names, and read as a jackal. This step asks the other question: set among
photographs of animals, is the model taken for its own species? One rule for every four-legged species, no colour
words, nothing per species, nothing fitted to our verdicts:

  photos    the species' openly licensed reference photos (pipeline/reference_photos.py: iNaturalist research grade and
            Wikimedia Commons, CC0 / CC BY / CC BY-SA only, each with its licence and author in
            library/animals/references/<code>.json; the photos themselves stay in the git-ignored cache and are never
            shipped), those the photo rule scores whole, large, clearly seen, a body, one animal and side-on (PHOTO)
            and that stand at the species' usual aspect (ASPECT);
  render    the generated source (the Meshy job's textured model.glb; the built model's vertex colours when there is
            no source) side-on from both sides, in its own colours under a plain sky (SKY: a face turned up gets the
            whole sky, one turned down what the ground returns), drawn far faces first: a picture of the model to set
            beside pictures of animals, before anything is built from it;
  picture   photo and render alike: the animal alone, cut from its ground by its mask or silhouette, on plain grey, so
            the habitat cannot speak for the species;
  recognise a network trained to tell pictures apart (DINOv2 small; the section "recognition" says where it comes from
            and how it is kept) gives each picture an embedding. A species' portrait is the mean of its photos'. The
            model is recognised when (1) its own species' portrait is the nearest of every species' in the store and
            (2) it is as near it as all but FLOOR_Q of the species' own photos are to the rest. `why` names the rival
            ("nearer the photos of lupulella mesomelas (0.78) than its own species' (0.75)");
  coat      beside the verdict, not deciding it: colour by body region, the same code on a photo's mask and a render's
            silhouette (the belly line and the ground line as the photo rule finds them; the trunk's middle columns cut
            into back, flank and underside; the legs; the two ends), in CIELAB against the flank, each measure in the
            photos' own spreads; those more than OFF spreads out are put in words a texture prompt or a person can use
            ("the trunk 13 yellower than the photos'"). Measured as a verdict and not adopted: a photo left out and set
            against every species' cloud lands on its own 42 % of the time (seven species);
  validate  --validate: every photo left out in turn against every portrait, every served model, every model with a
            recorded verdict (2026-11-12, 12 species: 169 of 188 photos on their own species; 8 of 9 served models
            pass, the coyote does not; agrees with 9 of 13 recorded verdicts).

A species is told only from the species whose photos are in the store: fetch its kin's with its own.

  arch -arm64 .venv/bin/python -m pipeline.likeness <code> [<code> ...] [--source <job folder or model.glb>] [--sheet out.jpg]
  arch -arm64 .venv/bin/python -m pipeline.likeness --validate [--sheet out.jpg]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from . import reference_photos as rp
from .appearance import lab, read_glb

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "client" / "assets" / "fauna"
PHOTO = {"whole": 0.5, "size": 0.5, "clear": 0.3, "solid": 0.5, "single": 0.8, "side": 0.5}   # a photo the measures can read
MIN_PHOTOS = 6          # under this many readable photos a species has no cloud, and the rule says so instead of deciding
SKY = 0.6               # the render's light: 1 on a face turned up, 1 - SKY on one turned down, between by the normal
RENDER_PX = 448
WIDTH = 128             # every picture's animal is brought to this many pixels across before it is measured, so a photo's
                        # hair and grain and a model's facets average out alike and only the coat's pattern is left
ASPECT = 1.3            # a photo whose box is this many times narrower or wider than the species' usual is turned to or
                        # from the camera, or is not the whole animal
FENCE = 1.5             # a photo further from the others than the upper quartile + FENCE x the interquartile range is not
                        # the animal standing in daylight (two animals, a wet coat, a photo of a screen): left out, once
TRUNK = (0.22, 0.78)    # the trunk's columns (of the animal's box): clear of the head, the neck and the rump
END = 0.12              # the outer columns that are the ends
BANDS = (0.3, 0.7)      # the trunk's back / flank / underside, from the back line (0) to the belly line (1)
FLOOR = {"L": 4.0, "a": 2.5, "b": 2.5, "s": 3.0, "c": 2.5}   # the least spread a measure is given (CIELAB units)
LIMIT_Q = 0.9
REGIONS = ("back", "flank", "under", "legs", "ends")
FEATURES = ([("trunk", "L"), ("trunk", "a"), ("trunk", "b")] + [(r, ch) for r in ("back", "under", "legs", "ends") for ch in ("L", "a", "b")]
            + [("back", "s"), ("flank", "s"), ("trunk", "c")])
NAMES = {"back": "the back", "under": "the underside", "legs": "the legs", "ends": "the head and rump", "trunk": "the trunk", "flank": "the flank"}


# ---- the picture of the model ----

def render(glb: Path, flip: bool = False, px: int = RENDER_PX, sky: float = SKY) -> tuple[np.ndarray, np.ndarray]:
    """(linear RGB image, silhouette) of a built model seen side-on (from +x; flip: from -x, mirrored so the head stays
    on the same side), drawn far faces first, each face its vertices' mean colour under the plain sky."""
    import cv2
    P, C, _, I = read_glb(glb)
    tri = P[I]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ny = n[:, 1] / (np.linalg.norm(n, axis=1) + 1e-12)
    col = C[I].mean(1) * (1 - sky + sky * (0.5 + 0.5 * ny))[:, None]
    lo, hi = P.min(0), P.max(0)
    k = (px - 24) / max(hi[2] - lo[2], hi[1] - lo[1])
    w, h = int((hi[2] - lo[2]) * k) + 24, int((hi[1] - lo[1]) * k) + 24
    u = (tri[:, :, 2] - lo[2]) * k + 12
    v = (hi[1] - tri[:, :, 1]) * k + 12
    depth = tri[:, :, 0].mean(1) * (-1 if flip else 1)
    img = np.zeros((h, w, 3), np.float32)
    sil = np.zeros((h, w), np.uint8)
    pts = np.round(np.stack([u, v], -1) * 16).astype(np.int32)   # (fixed point, 4 fractional bits)
    for f in np.argsort(depth):
        cv2.fillConvexPoly(img, pts[f], tuple(float(x) for x in col[f]), lineType=cv2.LINE_8, shift=4)
        cv2.fillConvexPoly(sil, pts[f], 1, lineType=cv2.LINE_8, shift=4)
    return img.astype(np.float64), sil.astype(bool)


def read_source(glb: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(positions, linear colour per face, triangles) of a generated source (a Meshy job's model.glb: one textured mesh):
    each face the mean of its texture at its corners and its middle."""
    import io
    import struct
    from PIL import Image
    b = Path(glb).read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bin_ = b[off + 8:off + 8 + struct.unpack("<I", b[off:off + 4])[0]]
    ct = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    nc = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def acc(i):
        a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
        dt_ = np.dtype(ct[a["componentType"]]); k = nc[a["type"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        st = bv.get("byteStride") or dt_.itemsize * k
        if st == dt_.itemsize * k:
            return np.frombuffer(bin_, dtype=dt_, count=a["count"] * k, offset=o).reshape(a["count"], k).astype(np.float64)
        return np.stack([np.frombuffer(bin_, dtype=dt_, count=k, offset=o + r * st) for r in range(a["count"])]).astype(np.float64)

    def world(node, M, out):
        nd = j["nodes"][node]
        T = np.eye(4)
        if "matrix" in nd:
            T = np.array(nd["matrix"], float).reshape(4, 4).T
        else:
            if "scale" in nd:
                T = np.diag(list(nd["scale"]) + [1.0]) @ T
            if "rotation" in nd:
                x, y, z, w = nd["rotation"]
                R = np.eye(4)
                R[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                             [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                             [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
                T = R @ T
            if "translation" in nd:
                Tr = np.eye(4); Tr[:3, 3] = nd["translation"]; T = Tr @ T
        M = M @ T
        if "mesh" in nd:
            out.append((nd["mesh"], M))
        for c in nd.get("children", []):
            world(c, M, out)
    found = []
    for r in (j.get("scenes") or [{"nodes": list(range(len(j["nodes"])))}])[j.get("scene", 0)]["nodes"]:
        world(r, np.eye(4), found)
    images = {}

    def image(i):
        if i not in images:
            im = j["images"][i]; bv = j["bufferViews"][im["bufferView"]]
            o = bv.get("byteOffset", 0)
            images[i] = to_linear(np.asarray(Image.open(io.BytesIO(bin_[o:o + bv["byteLength"]])).convert("RGB")))
        return images[i]
    P, C, I, base = [], [], [], 0
    for mi, M in found:
        for pr in j["meshes"][mi]["primitives"]:
            at = pr["attributes"]
            p = acc(at["POSITION"]); p = p @ M[:3, :3].T + M[:3, 3]
            idx = acc(pr["indices"]).astype(int).reshape(-1, 3) if "indices" in pr else np.arange(len(p)).reshape(-1, 3)
            mat = j["materials"][pr["material"]] if "material" in pr else {}
            pbr = mat.get("pbrMetallicRoughness") or {}
            col = np.tile(np.array((pbr.get("baseColorFactor") or [0.5, 0.5, 0.5, 1])[:3], float), (len(idx), 1))
            tex = pbr.get("baseColorTexture")
            if tex is not None and "TEXCOORD_0" in at:
                img = image(j["textures"][tex["index"]]["source"])
                uv = acc(at["TEXCOORD_0"])[idx]                      # (faces, 3, 2)
                pts = np.concatenate([uv, uv.mean(1, keepdims=True)], 1)
                px = np.clip((pts[..., 0] % 1.0) * img.shape[1], 0, img.shape[1] - 1).astype(int)
                py = np.clip((pts[..., 1] % 1.0) * img.shape[0], 0, img.shape[0] - 1).astype(int)
                col = img[py, px].mean(1) * col
            P.append(p); C.append(col); I.append(idx + base); base += len(p)
    return np.vstack(P), np.vstack(C), np.vstack(I)


def render_source(glb: Path, flip: bool = False, px: int = RENDER_PX, sky: float = SKY) -> tuple[np.ndarray, np.ndarray]:
    """(linear RGB image, silhouette) of a generated source seen side-on under the plain sky: up is the file's y, the
    body's length the longer horizontal axis of its faces (by area), the view along the other."""
    import cv2
    P, col, I = read_source(glb)
    tri = P[I]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(n, axis=1) + 1e-12
    cen = tri.mean(1)
    h = cen[:, [0, 2]] - np.average(cen[:, [0, 2]], axis=0, weights=area)
    w, v = np.linalg.eigh((h * area[:, None]).T @ h)
    along = v[:, np.argmax(w)]                                    # (x, z) of the body's length
    side = np.array([-along[1], along[0]])
    A = P[:, [0, 2]] @ along
    D = P[:, [0, 2]] @ side * (-1 if flip else 1)
    if flip:
        A = -A
    col = col * (1 - sky + sky * (0.5 + 0.5 * n[:, 1] / area))[:, None]
    lo_a, hi_a, lo_y, hi_y = A.min(), A.max(), P[:, 1].min(), P[:, 1].max()
    k = (px - 24) / max(hi_a - lo_a, hi_y - lo_y)
    wpx, hpx = int((hi_a - lo_a) * k) + 24, int((hi_y - lo_y) * k) + 24
    u = (A[I] - lo_a) * k + 12
    vv = (hi_y - P[:, 1][I]) * k + 12
    img = np.zeros((hpx, wpx, 3), np.float32)
    sil = np.zeros((hpx, wpx), np.uint8)
    pts = np.round(np.stack([u, vv], -1) * 16).astype(np.int32)
    for f in np.argsort(D[I].mean(1)):
        cv2.fillConvexPoly(img, pts[f], tuple(float(x) for x in col[f]), lineType=cv2.LINE_8, shift=4)
        cv2.fillConvexPoly(sil, pts[f], 1, lineType=cv2.LINE_8, shift=4)
    return img.astype(np.float64), sil.astype(bool)


def to_srgb(lin: np.ndarray) -> np.ndarray:
    c = np.clip(lin, 0, 1)
    return (np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255 + 0.5).astype(np.uint8)


def to_linear(srgb: np.ndarray) -> np.ndarray:
    c = srgb.astype(np.float64) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---- the regions: one rule for a photo's mask and a render's silhouette ----

def regions(comp: np.ndarray) -> dict | None:
    """{region: mask} of a side-on animal's silhouette (module docstring), or None when no belly line can be read (no
    light under the belly: lying down, in tall grass, head-on)."""
    import cv2
    comp = cv2.erode(comp.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)   # the outline's mixed pixels
    if not comp.any():
        return None
    ys, xs = np.nonzero(comp)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    sub = comp[y0:y1 + 1, x0:x1 + 1]
    bh, bw = sub.shape
    has = sub.any(0)
    top = np.where(has, np.argmax(sub, 0), bh)
    bottom = np.where(has, bh - 1 - np.argmax(sub[::-1], 0), -1)
    g = float(np.percentile(bottom[has], 97))
    mid = np.zeros_like(has)
    mid[int(0.1 * bw):int(0.9 * bw)] = True
    clear = has & mid & (bottom < g - 0.12 * bh)
    if clear.sum() < 0.05 * bw:
        return None
    belly = float(np.median(bottom[clear]))
    leg_h = g - belly
    if leg_h < 0.08 * bh or leg_h < 5:
        return None
    rows = np.arange(bh)[:, None]
    cols = np.arange(bw)[None, :]
    floor = np.minimum(bottom, belly)[None, :]                     # the trunk ends at the belly line over a leg
    v = (rows - top[None, :]) / np.maximum(floor - top[None, :], 1.0)
    trunk = sub & (cols >= TRUNK[0] * bw) & (cols <= TRUNK[1] * bw) & (rows <= floor)
    out = {"back": trunk & (v < BANDS[0]), "flank": trunk & (v >= BANDS[0]) & (v <= BANDS[1]), "under": trunk & (v > BANDS[1]),
           "legs": sub & (rows > belly + 0.35 * leg_h) & (rows < g - 0.08 * leg_h),
           "ends": sub & ((cols < END * bw) | (cols > (1 - END) * bw)) & (rows <= belly)}
    full = {}
    for k, m in out.items():
        if m.sum() < 12:
            return None
        f = np.zeros_like(comp)
        f[y0:y1 + 1, x0:x1 + 1] = m
        full[k] = f
    return full


def normalised(lin: np.ndarray, comp: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """The picture cut to the animal's box and brought to WIDTH pixels across (area means of the animal's own pixels:
    the background does not bleed in)."""
    import cv2
    ys, xs = np.nonzero(comp)
    if not len(ys):
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    k = WIDTH / (x1 - x0)
    size = (WIDTH, max(8, int(round((y1 - y0) * k))))
    interp = cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR
    m = comp[y0:y1, x0:x1].astype(np.float32)
    cover = cv2.resize(m, size, interpolation=interp)
    img = cv2.resize((lin[y0:y1, x0:x1] * m[:, :, None]).astype(np.float32), size, interpolation=interp)
    img = img / np.maximum(cover, 1e-6)[:, :, None]
    return img.astype(np.float64), cover >= 0.5


def measures(lin: np.ndarray, comp: np.ndarray) -> dict | None:
    """The measures (FEATURES, as a dict keyed 'region.channel') of one picture: lin its linear RGB, comp the animal."""
    nz = normalised(lin, comp)
    if nz is None:
        return None
    lin, comp = nz
    reg = regions(comp)
    if reg is None:
        return None
    L = {k: lab(lin[m]) for k, m in reg.items()}
    med = {k: np.median(v, axis=0) for k, v in L.items()}
    trunk = np.median(np.vstack([L["back"], L["flank"], L["under"]]), axis=0)
    out = {"trunk.L": trunk[0], "trunk.a": trunk[1], "trunk.b": trunk[2]}
    for r in ("back", "under", "legs", "ends"):
        d = med[r] - med["flank"]
        out.update({f"{r}.L": d[0], f"{r}.a": d[1], f"{r}.b": d[2]})
    for r in ("back", "flank"):   # the pattern: how far the region's lightness ranges (a saddle, spots, stripes; a plain coat little)
        out[f"{r}.s"] = np.percentile(L[r][:, 0], 90) - np.percentile(L[r][:, 0], 10)
    tr = np.vstack([L["back"], L["flank"], L["under"]])   # and its colour's range (patches of another colour; light and shade move it little)
    ch = np.hypot(tr[:, 1], tr[:, 2])
    out["trunk.c"] = np.percentile(ch, 90) - np.percentile(ch, 10)
    return {k: float(v) for k, v in out.items()}


KEYS = [f"{r}.{ch}" for r, ch in FEATURES]


def _vec(m: dict) -> np.ndarray:
    return np.array([m[k] for k in KEYS])


# ---- the photos' cloud ----

def readable(c: dict) -> bool:
    s = c.get("score") or {}
    return bool(c.get("file_small")) and not s.get("error") and all(s.get(k, 0.0) >= v for k, v in PHOTO.items())


def photos(code: str, store: dict | None = None) -> list[dict]:
    """The species' readable photos (the store's candidates that pass PHOTO and stand at the species' usual aspect)."""
    d = store if store is not None else json.loads((rp.STORE / f"{code}.json").read_text())
    cands = [c for c in d.get("candidates", []) if readable(c) and (ROOT / c["file_small"]).exists()]
    usual = float(np.median([c["score"]["aspect"] for c in cands])) if cands else 1.0
    return [c for c in cands if usual / ASPECT <= c["score"]["aspect"] <= usual * ASPECT]


def _photo(code: str, c: dict) -> tuple[np.ndarray, np.ndarray | None]:
    img = rp._load(ROOT / c["file_small"])
    return img, rp.pose(rp._mask_for(code, c["id"], img), "quadruped").get("comp")


def photo_measures(code: str, store: dict | None = None) -> list[dict]:
    """[{id, m}] of the species' readable photos (the masks are the photo rule's, cached)."""
    out = []
    for c in photos(code, store):
        img, comp = _photo(code, c)
        if comp is None:
            continue
        m = measures(to_linear(img), comp)
        if m:
            out.append({"id": c["id"], "m": m})
    return out


def _floor() -> np.ndarray:
    return np.array([FLOOR[ch] for _, ch in FEATURES])


def _cloud(F: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = np.median(F, axis=0)
    s = np.maximum(1.4826 * np.median(np.abs(F - c), axis=0), _floor())
    return c, s


def _offsets(f: np.ndarray, F: np.ndarray) -> np.ndarray:
    c, s = _cloud(F)
    return (f - c) / s


def cloud(code: str, store: dict | None = None) -> dict | None:
    """The species' cloud: its photos' measures, their centre and spread, and its own range (each photo against the
    others): the distances' LIMIT_Q quantile and the largest single offset. None under MIN_PHOTOS readable photos."""
    ph = photo_measures(code, store)
    if len(ph) < MIN_PHOTOS:
        return None
    F = np.array([_vec(p["m"]) for p in ph])
    own = lambda F: np.array([_offsets(F[i], np.delete(F, i, 0)) for i in range(len(F))])
    d = np.sqrt((own(F) ** 2).mean(1))
    q1, q3 = np.percentile(d, [25, 75])
    keep = d <= q3 + FENCE * (q3 - q1)
    left = [p["id"] for p, k in zip(ph, keep) if not k]
    if keep.sum() >= MIN_PHOTOS and not keep.all():
        F, ph = F[keep], [p for p, k in zip(ph, keep) if k]
    c, s = _cloud(F)
    loo = own(F)
    d = np.sqrt((loo ** 2).mean(1))
    return {"code": code, "n": len(F), "ids": [p["id"] for p in ph], "left_out": left, "F": F, "centre": c, "spread": s, "own": d,
            "limit": float(np.quantile(d, LIMIT_Q)), "worst": float(np.abs(loo).max())}


def distance(f: np.ndarray, cl: dict) -> tuple[float, np.ndarray]:
    z = (f - cl["centre"]) / cl["spread"]
    return float(np.sqrt((z ** 2).mean())), z


# ---- recognition: the picture's nearness to each species' photos, as a learned eye sees them ----
# The coat's measures above cannot name a species: a photo left out and set against every species' cloud lands on its
# own 42% of the time (seven species, 2026-11-12). A network trained to tell pictures apart can: DINOv2 (Oquab et al.
# 2023, the small ViT-S/14; code and weights Apache-2.0, facebook/dinov2-small) in the ONNX export published as
# Xenova/dinov2-small on Hugging Face, fetched once into its own new folder in the git-ignored cache, pinned by
# SHA-256 and run as data by OpenCV's DNN module, as the photo rule's two segmenters are (no model code is executed;
# nothing of it ships). Each picture is the animal alone, cut from its ground by its mask and set on plain grey, so
# the habitat cannot speak for the species and a render meets a photo on equal ground; its embedding is the network's
# class token, at unit length. A species' portrait is the mean of its photos' embeddings; nearness is the cosine.
EMBED_DIR = ROOT / "pipeline" / "_cache" / "embedding"
EMBEDDER = {"name": "dinov2_small", "url": "https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx", "file": "model.onnx",
            "sha256": "83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea", "side": 224,
            "mean": (0.485, 0.456, 0.406), "std": (0.229, 0.224, 0.225),
            "licence": "Apache-2.0 (DINOv2, Oquab et al. 2023; facebook/dinov2-small); ONNX export Xenova/dinov2-small"}
PICTURE = 1             # the picture rule's version (the cached embeddings' folder carries it)
FILL = 0.86             # the animal's longer side, of the picture's
GROUND = 128            # the plain ground (sRGB grey)
FLOOR_Q = 0.1           # a model must be as near its species' portrait as all but this share of the species' photos
_NET: list = []


def ready() -> bool:
    """Whether the embedding network is on disk (a check that must not reach the network asks first)."""
    return (EMBED_DIR / EMBEDDER["name"] / EMBEDDER["file"]).exists()


def embedder():
    """The embedding network as an OpenCV DNN net, fetched on first use into its own new, empty folder."""
    import hashlib
    import cv2
    if _NET:
        return _NET[0]
    folder = EMBED_DIR / EMBEDDER["name"]
    p = folder / EMBEDDER["file"]
    if not p.exists():
        if folder.exists() and any(folder.iterdir()):
            raise SystemExit(f"{folder}: not empty and no {EMBEDDER['file']} in it")
        folder.mkdir(parents=True, exist_ok=True)
        b = rp._get(EMBEDDER["url"], binary=True)
        if not b or hashlib.sha256(b).hexdigest() != EMBEDDER["sha256"]:
            raise SystemExit(f"{EMBEDDER['name']}: the download did not match its pinned SHA-256")
        p.write_bytes(b)
    _NET.append(cv2.dnn.readNetFromONNX(str(p)))
    return _NET[0]


def picture(rgb: np.ndarray, comp: np.ndarray) -> np.ndarray:
    """The animal alone on plain grey, its longer side FILL of a square picture (uint8 sRGB)."""
    import cv2
    side = EMBEDDER["side"]
    ys, xs = np.nonzero(comp)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    k = side * FILL / max(x1 - x0, y1 - y0)
    w, h = max(2, int(round((x1 - x0) * k))), max(2, int(round((y1 - y0) * k)))
    interp = cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC
    c2 = cv2.resize(rgb[y0:y1, x0:x1].astype(np.float32), (w, h), interpolation=interp)
    m2 = cv2.resize(comp[y0:y1, x0:x1].astype(np.float32), (w, h), interpolation=interp)[:, :, None]
    out = np.full((side, side, 3), float(GROUND), np.float32)
    oy, ox = (side - h) // 2, (side - w) // 2
    out[oy:oy + h, ox:ox + w] = c2 * m2 + GROUND * (1 - m2)
    return np.clip(out, 0, 255).astype(np.uint8)


def embed(pic: np.ndarray) -> np.ndarray:
    net = embedder()
    x = (pic.astype(np.float32) / 255 - np.array(EMBEDDER["mean"], np.float32)) / np.array(EMBEDDER["std"], np.float32)
    net.setInput(x.transpose(2, 0, 1)[None])
    v = net.forward()[0, 0].astype(np.float64)
    return v / np.linalg.norm(v)


def portrait(code: str, store: dict | None = None) -> dict | None:
    """The species' portrait: its readable photos' embeddings (cached beside the photos), their mean, and the species'
    own range: each photo's nearness to the mean of the others. None under MIN_PHOTOS."""
    ids, E = [], []
    cache = rp.CACHE / code / f"_embed_{EMBEDDER['name']}_{PICTURE}"
    for c in photos(code, store):
        f = cache / f"{c['id']}.npy"
        if f.exists():
            e = np.load(f)
        else:
            img, comp = _photo(code, c)
            if comp is None:
                continue
            e = embed(picture(img, comp))
            cache.mkdir(parents=True, exist_ok=True)
            np.save(f, e)
        ids.append(c["id"]); E.append(e)
    if len(E) < MIN_PHOTOS:
        return None
    E = np.array(E)
    unit = lambda v: v / np.linalg.norm(v)
    own = np.array([float(E[i] @ unit(np.delete(E, i, 0).mean(0))) for i in range(len(E))])
    return {"code": code, "n": len(E), "ids": ids, "E": E, "centre": unit(E.mean(0)), "own": own, "floor": float(np.quantile(own, FLOOR_Q))}


_PORTRAITS: dict = {}


def portraits() -> dict:
    """{code: portrait} of every four-legged species in the reference store with enough readable photos (kept for the
    process while the store's files do not change)."""
    files = sorted(rp.STORE.glob("*.json"))
    key = tuple((p.name, p.stat().st_mtime_ns) for p in files)
    if _PORTRAITS.get("key") == key:
        return _PORTRAITS["value"]
    out = {}
    for p in files:
        d = json.loads(p.read_text())
        if d.get("plan") != "quadruped":
            continue
        pt = portrait(p.stem, d)
        if pt:
            out[p.stem] = pt
    _PORTRAITS.update({"key": key, "value": out})
    return out


def typical(code: str) -> list[str]:
    """The species' readable photos' ids, the most typical first (the nearest the others' mean): the photo a refine
    should copy a coat from is the species' usual one, not its best pose."""
    pt = portraits().get(code)
    return [pt["ids"][i] for i in np.argsort(-pt["own"])] if pt else []


def recognise(code: str, pictures: list, pts: dict) -> dict:
    """Whose photos the model's pictures (each (sRGB image, silhouette)) are nearest: `own` the nearness to its species'
    portrait, `rival` the nearest other species and its nearness, `margin` own - rival, `floor` the nearness all but
    FLOOR_Q of the species' own photos reach. Recognised when its own species is the nearest and it reaches the floor."""
    f = np.mean([embed(picture(rgb, comp)) for rgb, comp in pictures], axis=0)
    f = f / np.linalg.norm(f)
    near = {b: float(f @ pt["centre"]) for b, pt in pts.items()}
    order = sorted(near, key=near.get, reverse=True)
    rivals = [b for b in order if b != code]
    own = near[code]
    out = {"own": round(own, 3), "floor": round(pts[code]["floor"], 3), "rank": order.index(code) + 1, "of": len(order),
           "rival": rivals[0] if rivals else None, "rival_nearness": round(near[rivals[0]], 3) if rivals else None,
           "margin": round(own - near[rivals[0]], 3) if rivals else None, "photos": pts[code]["n"]}
    why = []
    if rivals and near[rivals[0]] >= own:
        why.append(f"nearer the photos of {rivals[0].replace('_', ' ')} ({near[rivals[0]]:.2f}) than its own species' ({own:.2f})")
    if own < pts[code]["floor"]:
        why.append(f"further from its species' photos ({own:.2f}) than nine in ten of them are from each other ({pts[code]['floor']:.2f})")
    out.update({"ok": not why, "why": why})
    return out


# ---- the rule ----
OFF = 3.0               # a coat measure this many spreads from the photos' middle is named in the verdict's words


def _main_checkout() -> Path:
    """The main checkout (a worktree has none of the git-ignored job files; the main checkout holds them)."""
    import subprocess
    try:
        common = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--git-common-dir"], capture_output=True, text=True).stdout.strip()
        return (Path(common) if Path(common).is_absolute() else ROOT / common).resolve().parent
    except OSError:
        return ROOT


def source_at(job: Path | str | None) -> Path | None:
    """A job's generated model (model.glb), here or in the main checkout."""
    if not job:
        return None
    job = Path(job)
    rel = job.relative_to(ROOT) if job.is_absolute() and ROOT in job.parents else job
    for base in (ROOT, _main_checkout()):
        p = (base / rel / "model.glb") if not rel.is_absolute() else rel / "model.glb"
        if p.exists():
            return p
    return None


def source_of(code: str) -> Path | None:
    """The generated source the species' served model was built from."""
    from .fauna_models import job_of, registry
    e = registry().get("species", {}).get(code) or {}
    glb = ROOT / e.get("glb", f"client/assets/fauna/{code}.glb")
    return source_at(job_of(code, glb)) if glb.exists() else None


def views(source: Path | None = None, glb: Path | None = None) -> tuple[list, str]:
    """The model's pictures, both sides: of the generated source when there is one, else of the built model."""
    if source is not None:
        return [render_source(source, flip) for flip in (False, True)], "the generated source"
    return [render(glb, flip) for flip in (False, True)], "the built model"


def _words(key: str, v: float, c: float) -> str:
    r, ch = key.split(".")
    if ch == "c":
        return f"{NAMES[r]} colour strength ranges over {v:.0f}; the photos' over {c:.0f} ({'patches of another colour' if v > c else 'flatter than the animal'})"
    if ch == "s":
        return f"{NAMES[r]} lightness ranges over {v:.0f}; the photos' over {c:.0f} ({'more' if v > c else 'less'} pattern than the animal's)"
    if ch == "L":
        side = lambda x: f"{abs(x):.0f} {'lighter' if x > 0 else 'darker'}"
        return (f"{NAMES[r]} lightness {v:.0f}; the photos' {c:.0f}" if r == "trunk" else
                f"{NAMES[r]} {side(v)} than the flank; the photos' is {side(c)}")
    axis = ("redder", "greener") if ch == "a" else ("yellower", "bluer")
    d = v - c
    return f"{NAMES[r]} {abs(d):.0f} {axis[0] if d > 0 else axis[1]} than the photos'" + ("" if r == "trunk" else " (against the flank)")


def coat(vs: list, cl: dict | None) -> dict | None:
    """The coat's measures of the model's pictures against the species' cloud: its distance, the photos' own limit, and
    the measures standing more than OFF spreads out, in words a texture prompt or a person can use. It describes; the
    verdict is recognition's (see the section above: these measures cannot name a species)."""
    if cl is None:
        return None
    ms = [m for m in (measures(lin, sil) for lin, sil in vs) if m]
    if not ms:
        return {"why": "the silhouette shows no belly line: not a standing animal side-on"}
    f = np.array([np.mean([m[k] for m in ms]) for k in KEYS])
    d, z = distance(f, cl)
    order = np.argsort(-np.abs(z))
    return {"distance": round(d, 2), "limit": round(cl["limit"], 2), "photos": cl["n"],
            "off": [{"measure": KEYS[i], "offset": round(float(z[i]), 1), "words": _words(KEYS[i], float(f[i]), float(cl["centre"][i]))}
                    for i in order if abs(z[i]) > OFF]}


def likeness(code: str, source: Path | None = None, glb: Path | None = None, pts: dict | None = None, cl: dict | None = None) -> dict:
    """The rule on a species' model (module docstring): `ok` (None when the species has too few readable photos to
    judge by), `why`, `seen` (what was pictured), `recognition` and `coat`."""
    if source is None and glb is None:
        source = source_of(code)
        glb = ASSETS / f"{code}.glb"
    if source is None and (glb is None or not Path(glb).exists()):
        return {"ok": None, "why": ["no model to picture"]}
    pts = pts if pts is not None else portraits()
    if code not in pts:
        return {"ok": None, "why": [f"under {MIN_PHOTOS} readable reference photos of the species: nothing to judge by"]}
    vs, seen = views(Path(source) if source else None, Path(glb) if glb else None)
    rec = recognise(code, [(to_srgb(lin), sil) for lin, sil in vs], pts)
    if cl is None:
        try:
            cl = cloud(code)
        except (OSError, ValueError):
            cl = None
    return {"ok": rec["ok"], "why": rec["why"], "seen": seen, "recognition": {k: v for k, v in rec.items() if k not in ("ok", "why")},
            "coat": coat(vs, cl), "by": f"pipeline/likeness.py ({EMBEDDER['name']}, picture {PICTURE})"}


def correction(r: dict) -> str:
    """The verdict's coat words as a sentence for a texture prompt ('' when the coat's measures name nothing)."""
    off = ((r or {}).get("coat") or {}).get("off") or []
    return ("Against photographs of the animal: " + "; ".join(o["words"] for o in off[:4]) + ".") if off else ""


# ---- the rule checked against itself ----

def clouds() -> dict:
    """{code: cloud} of every four-legged species in the reference store with enough readable photos."""
    out = {}
    for p in sorted(rp.STORE.glob("*.json")):
        d = json.loads(p.read_text())
        if d.get("plan") != "quadruped":
            continue
        cl = cloud(p.stem, d)
        if cl:
            out[p.stem] = cl
    return out


def validate(log=print) -> dict:
    """What the rule can tell apart (no credits, no downloads but uncached photos' embeddings): (1) each species'
    photos, one left out at a time, against every portrait: the share nearest their own species (a measure that cannot
    name a photo's species cannot judge a model's); (2) every served four-legged model; (3) every model with a recorded
    verdict (pipeline/appearance.py known_verdicts) whose generated source is on disk."""
    from .appearance import known_verdicts
    pts = portraits()
    codes = sorted(pts)
    unit = lambda v: v / np.linalg.norm(v)
    hits, total, conf, per = 0, 0, {}, {}
    for a in codes:
        n = 0
        for i, f in enumerate(pts[a]["E"]):
            near = {b: (float(pts[a]["own"][i]) if b == a else float(f @ pts[b]["centre"])) for b in codes}
            best = max(near, key=near.get)
            n += best == a
            if best != a:
                conf[(a, best)] = conf.get((a, best), 0) + 1
        per[a] = {"photos": pts[a]["n"], "nearest_own": round(n / pts[a]["n"], 2), "floor": round(pts[a]["floor"], 3)}
        hits += n; total += pts[a]["n"]
    log(f"photos: {total} of {len(codes)} species; nearest their own species' portrait (one left out): {hits} ({hits / max(total, 1):.0%}); "
        f"by chance {1 / max(len(codes), 1):.0%}")
    for (a, b), k in sorted(conf.items(), key=lambda kv: -kv[1])[:10]:
        log(f"  {a} taken for {b}: {k} of {pts[a]['n']}")
    cls = {}

    def run(code, source, glb):
        if code not in cls:
            cls[code] = cloud(code)
        r = likeness(code, source, glb, pts, cls[code])
        rec = r.get("recognition") or {}
        log(f"  {code:26s} {'pass' if r['ok'] else 'FAIL'}  own {rec.get('own')}  floor {rec.get('floor')}  rival {rec.get('rival')} {rec.get('rival_nearness')}  "
            f"margin {rec.get('margin'):+.3f}  [{r.get('seen')}]" + ("  coat: " + ", ".join(o["measure"] + f" {o['offset']:+.1f}" for o in (r.get("coat") or {}).get("off") or []) if (r.get("coat") or {}).get("off") else ""))
        return r
    reg = json.loads((ROOT / "library" / "animals" / "models.json").read_text())["species"]
    log("served models:")
    models = {}
    for code in codes:
        e = reg.get(code) or {}
        glb = ROOT / e.get("glb", f"client/assets/fauna/{code}.glb")
        if e.get("kind", "quadruped") != "quadruped" or not glb.exists():
            continue
        models[code] = run(code, source_of(code), glb)
    log("recorded verdicts:")
    judged = []
    for k in known_verdicts():
        if k["code"] not in pts or k["entry"].get("kind") != "quadruped":
            continue
        src = source_of(k["code"]) if k["model"] == "current" else source_at(k.get("job"))
        if src is None:
            continue
        log(f"   the recorded verdict: {k['verdict']} ({k['model'] if k['model'] == 'current' else Path(k['model']).name[:8]})")
        r = run(k["code"], src, None)
        judged.append({"code": k["code"], "model": k["model"], "verdict": k["verdict"], "ok": r["ok"]})
    agree = sum((j["verdict"] == "accepted") == bool(j["ok"]) for j in judged)
    log(f"served models: {len(models)}, pass {sum(bool(m['ok']) for m in models.values())}; recorded verdicts: {len(judged)}, the rule agrees with {agree}")
    return {"species": per, "photos_nearest_own": round(hits / max(total, 1), 3), "chance": round(1 / max(len(codes), 1), 3),
            "models": models, "judged": judged}


def sheet(codes: list[str], out: Path, sources: dict | None = None, n: int = 4) -> Path:
    """A picture for a person to check the rule's verdicts by: per species a row: the model as the rule pictures it and
    what the rule says, the n photos nearest the species' portrait, and, when a rival is nearer, the rival's two."""
    from PIL import Image, ImageDraw
    W, H = 232, 276
    pts = portraits()

    def cell(pic, text):
        t = Image.new("RGB", (W, H), "white"); t.paste(Image.fromarray(pic), (4, 4))
        dr = ImageDraw.Draw(t)
        for j, line in enumerate(text[:3]):
            dr.text((4, 232 + 13 * j), line[:38], fill=(0, 0, 0))
        return t

    def nearest(code, k):
        d = json.loads((rp.STORE / f"{code}.json").read_text())
        by = {c["id"]: c for c in d["candidates"]}
        out = []
        for i in np.argsort(-pts[code]["own"])[:k]:
            c = by[pts[code]["ids"][i]]
            img, comp = _photo(code, c)
            out.append(cell(picture(img, comp), [f"{code.replace('_', ' ')}: {c['id']}", str(c.get("licence")), (c.get("author") or "")[:38]]))
        return out
    rows = []
    for code in codes:
        if code not in pts:
            continue
        src = (sources or {}).get(code)
        r = likeness(code, src, None, pts) if src else likeness(code, pts=pts)
        cells = []
        if r.get("ok") is not None:
            vs, _ = views(Path(src) if src else source_of(code), ASSETS / f"{code}.glb")
            rec = r["recognition"]
            cells.append(cell(picture(to_srgb(vs[0][0]), vs[0][1]), [f"{code.replace('_', ' ')}: {'pass' if r['ok'] else 'FAIL'}", f"own {rec['own']} floor {rec['floor']}",
                                                                     f"rival {str(rec['rival']).replace('_', ' ')} {rec['rival_nearness']}"]))
        cells += nearest(code, n)
        if r.get("ok") is False and (r.get("recognition") or {}).get("rival") and r["recognition"]["margin"] <= 0:
            cells += nearest(r["recognition"]["rival"], 2)
        rows.append(cells)
    if not rows:
        raise SystemExit("no species with a portrait")
    sh = Image.new("RGB", (W * max(len(r) for r in rows), H * len(rows)), "white")
    for y, cells in enumerate(rows):
        for x, t in enumerate(cells):
            sh.paste(t, (W * x, H * y))
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    sh.save(out, quality=88)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("codes", nargs="*")
    ap.add_argument("--source", help="a generated model (a job folder or its model.glb) other than the served model's (one code)")
    ap.add_argument("--validate", action="store_true", help="the rule against the photos, the served models and the recorded verdicts")
    ap.add_argument("--sheet", help="a picture of the models and their species' photos, to check the verdicts by")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.validate:
        v = validate()
        if a.json:
            print(json.dumps({k: v[k] for k in ("species", "photos_nearest_own", "chance", "judged")}, indent=1))
        if a.sheet:
            print(sheet(sorted(v["models"]), Path(a.sheet)))
        return 0
    src = None
    if a.source:
        src = Path(a.source)
        src = src / "model.glb" if src.is_dir() else src
    pts = portraits()
    for code in a.codes:
        r = likeness(code, src, None, pts) if src else likeness(code, pts=pts)
        if a.json:
            print(json.dumps({code: r}, indent=1))
            continue
        if r.get("ok") is None:
            print(f"{code}: not judged: {'; '.join(r['why'])}")
            continue
        rec = r["recognition"]
        print(f"{code}: {'pass' if r['ok'] else 'FAIL'} ({r['seen']}; {rec['photos']} photos; {rec['of']} species to tell it from)")
        print(f"   nearness to its species' photos {rec['own']} (their own floor {rec['floor']}); nearest other species {rec['rival']} {rec['rival_nearness']}")
        for w in r["why"]:
            print(f"   {w}")
        for o in (r.get("coat") or {}).get("off") or []:
            print(f"   coat: {o['words']}  [{o['measure']} {o['offset']:+.1f} spreads]")
    if a.sheet and a.codes:
        print(sheet(a.codes, Path(a.sheet), {a.codes[0]: src} if src else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
