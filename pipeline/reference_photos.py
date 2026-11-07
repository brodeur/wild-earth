"""Reference photos of a species: a few openly licensed photos of the whole animal, side-on, the best picked by rule
(world pipeline phase 1, iterations 7 and 8; docs/decisions.md 2026-11-06).

A text-to-3D model that fails its species (the judge's verdict, the feature check in pipeline/appearance.py, or the build's
leg gate) gets one more try from a photo of the animal (pipeline/fauna_models.py, the second rung): Meshy's image-to-3D
from the photo, or the photo as the texture reference of a refine. This step finds the photos. One rule for every species:

  sources   iNaturalist research-grade observations of the species whose photos carry CC0, CC BY or CC BY-SA (the API's
            photo_license filter, each photo's own licence_code checked again), those within LOCAL_KM of the tile first
            (the local population's look; one from elsewhere scores NOT_LOCAL of it), adults first (the Life Stage
            annotation), then any, by community votes; and Wikimedia Commons files found by the scientific name whose licence
            (extmetadata LicenseShortName) is CC0, CC BY or CC BY-SA (no NC, ND, GFDL-only or unmarked files). Each kept
            with its licence, author, attribution line and page URL.
  fetch     each candidate's ~500 px rendition into its own new, empty folder under pipeline/_cache/references/<code>/
            (git-ignored), read as image data with PIL; nothing fetched is executed.
  mask      the animal is cut from the background by two openly licensed salient-object segmenters (U-2-Net and
            IS-Net, Apache-2.0) run locally as data by OpenCV's DNN module, the mean of their maps (iteration 8; GrabCut,
            iteration 7's cut, took rocks and hillsides for the animal), its largest piece kept; masks are cached.
  score     each 0-1, from the mask: whole (the animal does not run out of the frame), size (it fills a fair part of the
            frame; a snake's body thick enough to show its pattern), one animal (the largest piece holds the mask),
            clearly seen (a narrow uncertain band at its outline: not behind twigs, in tall grass or blurred), a body (the
            mask fills its convex hull: no skeleton), side-on (wider than tall, with light under the belly between fore and
            hind legs; a snake laid out, not balled up), the head toward an end of the box (a head-on moose's antlers
            widen the box like a side view), legs clear (legs longer than a fraction of the height, at least two leg
            pieces), standing square (the leg pieces' leans: a stride opens them into a V, a lifted foot ends above the
            ground; image-to-3D keeps the photo's pose and the build's gate needs four feet down), the described colours
            (the share of the animal's pixels within the check's own tolerance of a colour pipeline/appearance.py names),
            plain background (few edges and little colour spread outside the animal). The product ranks; a photo is
            usable only when its pose scores pass USABLE (a snake's, a texture reference, may lose its tail to the frame).
            The first usable one is the reference, and its full-size rendition is fetched (into its own folder) and
            cropped to the animal with a margin; when none is usable the species has no reference photo (the badger,
            2026-11-06: its photos walk, lie down or are a rock).
  use       a photo serves image-to-3D only when it passes USABLE; as a refine's texture reference only whole, size,
            clearly seen and a body are asked (usable_for): its pose binds nothing. pipeline/fauna_models.py acceptance
            records which photo a served model came from and whether today's rule still takes it for that use.
            Measured and not adopted (2026-11-06, iteration 10): a grazing or head-down pose from the silhouette (the
            outer columns' top against the back line, and the head end's protrusion beyond the torso against the back
            and belly): on the 30 top candidates of the five Lamar quadrupeds, the four head-down photos (two pronghorn,
            a moose, a goat) fall inside the head-up ones' range on both measures (a moose grazing reads +0.19, a
            pronghorn head-up +1.55), so no threshold separates them; a head detector is needed, not the mask.
  judge     none since iteration 8: the rule chooses alone (validated on iteration 7's picks and the photos whose meshes
            failed the gate, docs/decisions.md 2026-11-06 iteration 8). --pick stays as a recorded manual override, and a
            judge's earlier pick is kept in the store as "judged".
  store     library/animals/references/<code>.json: every candidate's source, licence, author, attribution, page URL and
            scores, and the chosen one. The photo goes with the Meshy job that uses it (reference.jpg and reference.json,
            the attribution, beside job.json).

  arch -arm64 .venv/bin/python -m pipeline.reference_photos <code> [<code> ...] [--refresh | --rescore] [--sheet out.png]
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "library" / "animals" / "references"
CACHE = ROOT / "pipeline" / "_cache" / "references"
UA = {"User-Agent": "wild-earth-pipeline/1 (world pipeline reference photos; https://github.com/)"}
OPEN = {"cc0": "CC0 1.0", "cc-by": "CC BY 4.0", "cc-by-sa": "CC BY-SA 4.0"}
COMMONS_OK = re.compile(r"^(?:CC0(?: 1\.0)?|CC BY(?:-SA)? \d\.\d(?: [a-z]{2,3})?|CC BY(?:-SA)?)$", re.I)
PER_SOURCE = 24
LOCAL_KM = 300          # an iNaturalist observation this near the tile is the local population's
NOT_LOCAL = 0.75        # a photo from elsewhere scores this much of a local one, when the tile has local photos


def _get(url: str, tries: int = 3, binary: bool = False):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                b = r.read()
                return b if binary else json.loads(b)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                return None
            time.sleep(4 * (k + 1))
        except Exception:
            time.sleep(3 * (k + 1))
    return None


def inaturalist(sci: str, n: int = PER_SOURCE, near: tuple | None = None) -> list[dict]:
    """Openly licensed photos of research-grade observations, adults first, by votes; with near (lat, lon), those within
    LOCAL_KM of the tile first (the local population's look: a Yellowstone garter snake is not a coastal red-spotted one)."""
    out, seen = [], set()
    geo = [f"&lat={near[0]:.4f}&lng={near[1]:.4f}&radius={LOCAL_KM}"] if near else []
    for extra in [g + a for g in geo for a in ("&term_id=1&term_value_id=2", "")] + ["&term_id=1&term_value_id=2", ""]:
        q = (f"https://api.inaturalist.org/v1/observations?taxon_name={urllib.parse.quote(sci)}&quality_grade=research"
             f"&photo_license=cc0,cc-by,cc-by-sa&photos=true&per_page=50&order_by=votes{extra}")
        d = _get(q) or {}
        time.sleep(1.0)
        for o in d.get("results", []):
            for ph in (o.get("photos") or [])[:2]:
                lic = (ph.get("license_code") or "").lower()
                if lic not in OPEN or ph["id"] in seen or ph.get("hidden"):
                    continue
                seen.add(ph["id"])
                user = o.get("user") or {}
                out.append({"source": "inaturalist", "id": f"inat_{ph['id']}", "licence": OPEN[lic],
                            "author": user.get("name") or user.get("login"), "attribution": ph.get("attribution"),
                            "page": o.get("uri") or f"https://www.inaturalist.org/observations/{o.get('id')}",
                            "photo_page": f"https://www.inaturalist.org/photos/{ph['id']}",
                            "url_small": ph["url"].replace("square", "medium"), "url_large": ph["url"].replace("square", "large"),
                            "adult": "term_id" in extra, "local": "&lat=" in extra})
                if len(out) >= n:
                    return out
    return out


def commons(sci: str, n: int = PER_SOURCE) -> list[dict]:
    """Wikimedia Commons files found by the scientific name, CC0 / CC BY / CC BY-SA only."""
    q = ("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": f'"{sci}" filetype:bitmap', "gsrnamespace": 6,
        "gsrlimit": 50, "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 500, "format": "json"}))
    d = _get(q) or {}
    time.sleep(1.0)
    out = []
    for p in sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata") or {}
        lic = (md.get("LicenseShortName") or {}).get("value", "").strip()
        if not COMMONS_OK.match(lic) or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        cats = (md.get("Categories") or {}).get("value", "") + " " + p.get("title", "") + " " + (md.get("ObjectName") or {}).get("value", "")
        if sci.lower() not in cats.lower().replace("_", " "):   # a file that only mentions it (another animal in view)
            continue
        strip = lambda v: html.unescape(re.sub(r"<[^>]+>", "", v or "")).strip()
        author = strip((md.get("Artist") or {}).get("value"))
        large = ii.get("thumburl", "").replace("/500px-", "/1280px-") if ii.get("width", 0) > 1280 else ii.get("url")
        out.append({"source": "wikimedia commons", "id": f"commons_{p['pageid']}", "licence": lic, "author": author,
                    "attribution": f"{author or 'unknown'}, {lic}, via Wikimedia Commons ({p.get('title')})",
                    "page": ii.get("descriptionurl"), "url_small": ii.get("thumburl") or ii.get("url"), "url_large": large})
        if len(out) >= n:
            break
    return out


def _fetch(url: str, folder: Path) -> Path | None:
    """One download into its own new, empty folder."""
    if folder.exists() and any(folder.iterdir()):
        f = next((x for x in folder.iterdir() if x.name.startswith("photo")), None)
        if f:
            return f
    folder.mkdir(parents=True, exist_ok=False) if not folder.exists() else None
    b = _get(url, binary=True)
    time.sleep(0.3)
    if not b or len(b) < 2000:
        return None
    ext = ".png" if b[:4] == b"\x89PNG" else ".jpg"
    p = folder / f"photo{ext}"
    p.write_bytes(b)
    return p


def _load(p: Path, side: int = 512):
    from PIL import Image
    im = Image.open(p).convert("RGB")
    k = side / max(im.size)
    if k < 1:
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))))
    return np.asarray(im)


# ---- the subject mask (iteration 8): two openly licensed salient-object models run locally as data ----
# GrabCut (iteration 7) took rocks and hillsides for the animal on busy photos, so a judge picked from a contact sheet.
# The cut is now learned: U-2-Net (Qin et al. 2020) and IS-Net / DIS (Qin et al. 2022), class-agnostic salient-object
# segmenters, both Apache-2.0 (code and weights, github.com/xuebinqin/U-2-Net and /DIS), in the ONNX exports published
# by rembg (MIT, github.com/danielgatis/rembg releases v0.0.0). They are fetched once, each into its own new folder in
# the git-ignored cache, pinned by SHA-256, and run as data by OpenCV's DNN module (no model code is executed); the mask
# is the mean of their two probability maps (each min-max scaled, as their authors do), cut at one half.
SEG_DIR = ROOT / "pipeline" / "_cache" / "segmentation"
SEGMENTERS = {
    "u2net": {"url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx", "file": "u2net.onnx",
              "sha256": "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491", "side": 320,
              "mean": (0.485, 0.456, 0.406), "std": (0.229, 0.224, 0.225),
              "licence": "Apache-2.0 (U-2-Net, Qin et al. 2020); ONNX export by rembg (MIT)"},
    "isnet_general_use": {"url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
                          "file": "isnet-general-use.onnx", "sha256": "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
                          "side": 1024, "mean": (0.5, 0.5, 0.5), "std": (1.0, 1.0, 1.0),
                          "licence": "Apache-2.0 (IS-Net / DIS, Qin et al. 2022); ONNX export by rembg (MIT)"},
}
_NETS: dict = {}


def segmenters_ready() -> bool:
    return all((SEG_DIR / k / v["file"]).exists() for k, v in SEGMENTERS.items())


def _segmenter(name: str):
    """One salient-object model as an OpenCV DNN net, fetched on first use into its own new, empty folder."""
    import hashlib
    import cv2
    if name in _NETS:
        return _NETS[name]
    m = SEGMENTERS[name]
    folder = SEG_DIR / name
    p = folder / m["file"]
    if not p.exists():
        if folder.exists() and any(folder.iterdir()):
            raise SystemExit(f"{folder}: not empty and no {m['file']} in it")
        folder.mkdir(parents=True, exist_ok=True)
        b = _get(m["url"], binary=True)
        if not b or hashlib.sha256(b).hexdigest() != m["sha256"]:
            raise SystemExit(f"{name}: the download did not match its pinned SHA-256")
        p.write_bytes(b)
    _NETS[name] = cv2.dnn.readNetFromONNX(str(p))
    return _NETS[name]


def subject_mask(img: np.ndarray) -> np.ndarray:
    """The animal's probability per pixel (uint8, 255 = subject): the mean of the two segmenters' maps."""
    import cv2
    acc = np.zeros(img.shape[:2], np.float32)
    for name, m in SEGMENTERS.items():
        x = cv2.resize(img.astype(np.float32), (m["side"], m["side"]), interpolation=cv2.INTER_LANCZOS4) / max(float(img.max()), 1.0)
        x = (x - np.array(m["mean"], np.float32)) / np.array(m["std"], np.float32)
        net = _segmenter(name)
        net.setInput(x.transpose(2, 0, 1)[None].astype(np.float32))
        p = net.forward()[0, 0]
        p = (p - p.min()) / max(float(p.max() - p.min()), 1e-9)
        acc += cv2.resize(p, (img.shape[1], img.shape[0]))
    return np.clip(acc / len(SEGMENTERS) * 255, 0, 255).astype(np.uint8)


def _mask_for(code: str, cid: str, img: np.ndarray) -> np.ndarray:
    """The subject mask of a cached candidate photo, kept beside the cache (a rescore runs no model)."""
    from PIL import Image
    p = CACHE / code / "_masks" / f"{cid}.png"
    if p.exists():
        m = np.asarray(Image.open(p).convert("L"))
        if m.shape == img.shape[:2]:
            return m
    m = subject_mask(img)
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(m).save(p)
    return m


# ---- the pose filter (iteration 8): a standing, side-on, whole animal, from the mask's silhouette ----
# Image-to-3D keeps the photo's pose and the build's gate (tools/build_quadruped.py) needs four feet on the floor, fore
# and hind apart. Read from the silhouette in the animal's box: the ground line (the lowest 3% of its columns' bottoms)
# and the belly (the median bottom of the middle columns standing clear of the ground): a side-on standing animal shows
# light under its belly between fore and hind legs (BELLY_GAP of the middle columns); lying down, sunk in grass or a rock
# shows none. The legs are the pieces of the lower 65% of the leg zone (between belly and ground); each piece's lean is
# the slope of its midline. Standing square, the legs are near vertical and lean together; a stride opens them into a
# V (fore and hind legs leaning opposite ways: the spread of the leans, STRIDE_DEG), a lifted foot ends above the ground
# (LIFT of the animal's height; the far feet stand a little higher in perspective). Taken from the iteration-7 records:
# the goat's stride (spread 67 deg), the two badgers walking (43 and 95 deg) and the moose photos whose meshes the gate
# refused (37 and 40 deg) fail it; the goat's and the pronghorn's photos whose meshes passed stand at 13 and 22 deg.
BELLY_GAP = 0.10        # under this share of the middle columns clear of the ground there is no belly to see: not side-on
LEG_ZONE = 0.12         # legs shorter than this share of the animal's height (lying, sunk in grass) score nothing
STRIDE_DEG = 18.0       # leans spreading more than this (degrees) open into a stride; 20 more and the stance scores 0
LEAN_DEG = 15.0         # all legs leaning together more than this (a lunge, a slope)
LIFT = 0.06             # a leg ending this far (of the animal's height) above the ground line is lifting; 0.08 more scores 0
CLEAR_PX = 4.0         # an uncertain band wider than this (pixels, at 512 px) is an animal not clearly seen; 12 more scores 0
COLOUR_REACH = 16.0    # CIEDE2000 (kL 2) within which a photo's pixel is in a described colour: the check's own MATCH_DE
SOLID = 0.35           # a mask filling under this share of its convex hull is a frame (a skeleton), not a body
USABLE = {"quadruped": {"whole": 0.5, "size": 0.5, "side": 0.5, "legs": 0.5, "stance": 0.6, "solid": 0.5, "clear": 0.3},
          # a snake's photo is a texture reference (its pattern), not image-to-3D's pose: its tail may leave the frame
          "snake": {"whole": 0.3, "size": 0.5, "side": 0.5, "clear": 0.3},
          # (2026-11-06) a snake photo for image-to-3D, which keeps the photo's pose, must hold the whole body, tail and all
          # (the build traces one tube from end to end). Loops are not measured: the segmenters fill the background a loop
          # encloses (a terciopelo coiled on a couch read as a solid shape), so a loop shows only in the build's gate
          "snake_image": {"whole": 0.8, "size": 0.5, "side": 0.5, "clear": 0.3},
          "other": {"whole": 0.5, "size": 0.5, "solid": 0.5, "clear": 0.3}}


def _runs(row: np.ndarray) -> list[tuple[int, int]]:
    r = row.astype(np.int8)
    st = list(np.nonzero((r[1:] == 1) & (r[:-1] == 0))[0] + 1)
    en = list(np.nonzero((r[1:] == 0) & (r[:-1] == 1))[0] + 1)
    if len(r) and r[0]:
        st = [0] + st
    if len(r) and r[-1]:
        en = en + [len(r)]
    return list(zip(st, en))


def legs_of(sub: np.ndarray) -> dict:
    """The silhouette's legs (sub: the animal's mask cropped to its box): belly_gap, leg_zone (of the height), and per
    leg piece its lean (degrees, signed) and lift (its end above the ground line, of the height)."""
    import cv2
    bh, bw = sub.shape
    area = float(sub.sum())
    has = sub.any(0)
    out = {"belly_gap": 0.0, "leg_zone": 0.0, "pieces": 0, "leans": [], "lifts": []}
    if not has.any():
        return out
    bottom = np.where(has, bh - 1 - np.argmax(sub[::-1], 0), -1)
    g = float(np.percentile(bottom[has], 97))
    mid = np.zeros_like(has)
    mid[int(0.1 * bw):int(0.9 * bw)] = True
    clear = has & mid & (bottom < g - 0.12 * bh)
    out["belly_gap"] = round(float(clear.sum() / max(1, mid.sum())), 3)
    if clear.sum() < 0.05 * bw:
        return out
    belly = float(np.median(bottom[clear]))
    leg_h = g - belly
    out["leg_zone"] = round(leg_h / bh, 3)
    top = int(belly + 0.35 * leg_h)
    band = sub[top:int(g) + 1].astype(np.uint8)
    nb, lb, sb, _ = cv2.connectedComponentsWithStats(band)
    for i in range(1, nb):
        if sb[i, cv2.CC_STAT_AREA] < 0.0012 * area or sb[i, cv2.CC_STAT_HEIGHT] < 0.25 * band.shape[0]:
            continue
        m = lb == i
        rows = np.nonzero(m.any(1))[0]
        mids = [(r, float(np.nonzero(m[r])[0].mean())) for r in rows if len(_runs(m[r])) == 1]
        lean = 0.0
        if len(mids) > 4:
            rr, mm = np.array(mids).T
            lean = float(np.degrees(np.arctan(np.polyfit(rr, mm, 1)[0])))
        out["leans"].append(round(lean, 1))
        out["lifts"].append(round(float((g - (top + rows.max())) / bh), 3))
    out["pieces"] = len(out["leans"])
    return out


def pose(prob: np.ndarray, plan: str = "quadruped") -> dict:
    """The pose filter's scores (0-1) of a subject mask, and the animal's box and mask (see the section's comment)."""
    import cv2
    h, w = prob.shape
    fg = cv2.morphologyEx((prob >= 128).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n < 2:
        return {"whole": 0.0, "size": 0.0, "single": 0.0, "side": 0.0, "legs": 0.0, "stance": 0.0, "comp": None}
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    comp = lab_ == k
    area = float(comp.sum())
    ys, xs = np.nonzero(comp)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    # whole: the animal does not run out of the frame (pixels on the frame's edge, against its box's half perimeter)
    edge = float(comp[0].sum() + comp[-1].sum() + comp[:, 0].sum() + comp[:, -1].sum())
    out = {"whole": float(np.clip(1 - edge / (0.1 * (bw + bh)), 0, 1)), "single": area / float(stats[1:, cv2.CC_STAT_AREA].sum()),
           "aspect": bw / bh, "box": [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h], "comp": comp, "area": area}
    # clearly seen: the segmenters are sure where the animal ends; behind twigs, in tall grass, blurred or camouflaged
    # it fades into a wide uncertain band (the pixels between 0.15 and 0.85 near its outline, over the outline's length)
    cu8 = comp.astype(np.uint8)
    per = sum(cv2.arcLength(c, True) for c in cv2.findContours(cu8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0])
    ring = cv2.dilate(cu8, np.ones((31, 31), np.uint8)).astype(bool) & ~cv2.erode(cu8, np.ones((31, 31), np.uint8)).astype(bool)
    band = float((((prob > 40) & (prob < 215)) & ring).sum() / max(per, 1.0))
    out.update({"band_px": round(band, 2), "clear": float(np.clip(1 - (band - CLEAR_PX) / 12, 0, 1))})
    if plan == "snake":
        # large in frame: the body's thickness (twice the area over the outline) against the frame; laid out, not
        # balled up: its length over its thickness
        cs, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        thick = 2 * area / max(1.0, float(cv2.arcLength(max(cs, key=cv2.contourArea), True)))
        out.update({"size": float(np.clip((thick / max(h, w) - 0.01) / 0.035, 0, 1)),
                    "side": float(np.clip((area / thick ** 2 - 4) / 8, 0, 1)), "legs": 1.0, "stance": 1.0,
                    "thick": thick / max(h, w), "head_end": 1.0, "solid": 1.0})
        return out
    out["size"] = float(np.clip((max(bw / w, bh / h) - 0.2) / 0.25, 0, 1))
    # a body, not a frame: the mask's share of its convex hull (a skeleton in a museum, 0.3, is no animal to model)
    hull = cv2.convexHull(np.column_stack([xs, ys]).astype(np.int32))
    out["solid"] = float(np.clip((area / max(1.0, cv2.contourArea(hull)) - SOLID) / 0.2, 0, 1))
    if plan != "quadruped":
        out.update({"side": float(np.clip((out["aspect"] - 0.9) / 0.6, 0, 1)), "legs": 1.0, "stance": 1.0, "head_end": 1.0})
        return out
    # the head at one end: seen side-on, the top of the silhouette (head, horns, antlers, or the rump of a grazer) lies
    # toward an end of the box; seen head-on, a moose's antlers stand over its middle and widen the box like a side view
    top = comp[y0:y0 + max(1, int(0.2 * bh)), x0:x1 + 1]
    c = float(np.nonzero(top)[1].mean() / bw) if top.any() else 0.5
    out["head_end"] = float(np.clip((abs(c - 0.5) - 0.1) / 0.2, 0, 1))
    L = legs_of(comp[y0:y1 + 1, x0:x1 + 1])
    side = np.clip((out["aspect"] - 0.7) / 0.4, 0, 1) * np.clip((L["belly_gap"] - BELLY_GAP) / 0.2, 0, 1)
    legs = np.clip((L["leg_zone"] - LEG_ZONE) / 0.12, 0, 1) * (1.0 if L["pieces"] >= 2 else 0.15)
    t = L["leans"]
    spread = (max(t) - min(t)) if len(t) >= 2 else 90.0
    lean = abs(float(np.median(t))) if t else 90.0
    stance = np.clip(1 - (spread - STRIDE_DEG) / 20, 0, 1) * np.clip(1 - (lean - LEAN_DEG) / 15, 0, 1)
    for x in L["lifts"]:
        stance *= np.clip(1 - (x - LIFT) / 0.08, 0, 1)
    out.update({"side": float(side), "legs": float(legs), "stance": float(stance), "spread": round(spread, 1), "lean": round(lean, 1),
                **{k: L[k] for k in ("belly_gap", "leg_zone", "leans", "lifts")}})
    return out


def usable(s: dict, plan: str) -> list[str]:
    """What keeps a scored photo from being used (empty when it is usable): the scores under USABLE."""
    lim = USABLE.get(plan, USABLE["other"])
    return [k for k, v in lim.items() if s.get(k, 0.0) < v]


def usable_for(s: dict, plan: str, use: str) -> list[str]:
    """What keeps a scored photo from serving one use (empty when it can): 'image' (image-to-3D, which copies the photo's
    pose: every USABLE score) or 'texture' (a refine's texture reference: the colours and pattern of the whole animal,
    clearly seen, large enough; its pose binds nothing, so side-on, legs and stance are not asked; a snake's as before)."""
    if plan == "snake" and use == "image":
        return usable(s, "snake_image")
    if use == "image" or plan == "snake":
        return usable(s, plan)
    return [k for k, v in USABLE["other"].items() if s.get(k, 0.0) < v]


def score(img: np.ndarray, plan: str = "quadruped", described: np.ndarray | None = None, prob: np.ndarray | None = None) -> dict:
    """The rule's scores (module docstring) of one photo, and the animal's box (fractions of the frame). prob: the
    subject mask (subject_mask), computed when not given."""
    import cv2
    if prob is None:
        prob = subject_mask(img)
    p = pose(prob, plan)
    comp = p.pop("comp")
    if comp is None:
        return {"total": 0.0, "usable": False, "why_not": ["no subject"]}
    area = p.pop("area")
    bgr = img[:, :, ::-1].copy()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 160) > 0
    bg = ~cv2.dilate(comp.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    ed = float(edges[bg].mean()) if bg.any() else 1.0
    labi = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3)[bg.ravel()].astype(np.float64)
    spread = float(labi.std(0).mean()) if len(labi) else 99.0
    plain = float(np.clip(1 - ed / 0.12, 0, 1) * 0.6 + np.clip(1 - spread / 40, 0, 1) * 0.4)
    # the described colours (pipeline/appearance.py): the share of the animal's pixels within reach of a colour the
    # description names (lighting shifts a photo: COLOUR_REACH); a stained or backlit animal, or
    # another species, scores lower
    colour = 1.0
    if described is not None and len(described):
        from .appearance import de2000, lab as _lab
        px = img[comp][:: max(1, int(area // 4000))].astype(np.float64) / 255
        lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
        colour = float((de2000(_lab(lin), described).min(1) <= COLOUR_REACH).mean())
    whole = p["whole"] if plan != "snake" else 0.4 + 0.6 * p["whole"]   # a snake's photo is a texture reference
    total = (whole * p["size"] * (0.4 + 0.6 * p["single"]) * p["clear"] * p["side"] * (0.5 + 0.5 * p["head_end"]) * p["solid"]
             * (0.3 + 0.7 * p["legs"]) * p["stance"] * (0.5 + 0.5 * plain) * (0.3 + 0.7 * colour))
    r = lambda v: round(float(v), 3)
    out = {"total": r(total), **{k: (r(v) if isinstance(v, (float, np.floating)) else v) for k, v in p.items() if k != "box"},
           "plain": r(plain), "colour": r(colour), "box": [r(x) for x in p["box"]], "mask": "subject (U-2-Net + IS-Net)"}
    why = usable(out, plan)
    out["usable"] = not why
    if why:
        out["why_not"] = why
    return out


def described_colours(code: str, t: dict) -> np.ndarray | None:
    """Lab of every colour the species' described appearance names (ground and markings), or None."""
    from .appearance import colour_lab, research
    try:
        app = research(code, t.get("scientific") or code.replace("_", " ").capitalize(), t.get("common"), log=lambda *_: None)
    except Exception:
        return None
    cols = [c for e in (app.get("regions") or {}).values() for c in e.get("colours", []) + [x for m in e.get("markings", []) for x in m["colours"]]]
    labs = [colour_lab(re.sub(r"\s+(tip|tuft)$", "", c)) for c in cols]
    labs = [x for x in labs if x is not None]
    return np.array(labs) if labs else None


def _traits(code: str) -> dict:
    from .fauna_models import _traits as t
    return t(code)


def plan_of(code: str) -> str:
    """quadruped, snake or other (the scoring's side-on and legs rules)."""
    try:
        e = json.loads((ROOT / "library" / "animals" / "models.json").read_text())["species"].get(code) or {}
    except (OSError, ValueError):
        e = {}
    if e.get("kind") == "snake":
        return "snake"
    t = _traits(code)
    plan = (t.get("body_plan") or (t.get("locomotion") or {}).get("body_plan") or "").lower()
    return "quadruped" if e.get("kind") == "quadruped" or plan == "quadruped" else "snake" if "snake" in plan else "other"


def tile_centre(tile: str) -> tuple | None:
    try:
        b = json.loads((ROOT / "tiles" / tile / "manifest.json").read_text())["bounds_wgs84"]
    except (OSError, ValueError, KeyError):
        return None
    return ((b[1] + b[3]) / 2, (b[0] + b[2]) / 2)


def find(code: str, refresh: bool = False, log=print, tile: str | None = None) -> dict:
    """The species' reference photos (module docstring), from the store unless refresh."""
    sp = STORE / f"{code}.json"
    if sp.exists() and not refresh:
        try:
            return json.loads(sp.read_text())
        except ValueError:
            pass
    t = _traits(code)
    sci = t.get("scientific") or code.replace("_", " ").capitalize()
    plan = plan_of(code)
    near = tile_centre(tile) if tile else None
    cands = inaturalist(sci, PER_SOURCE + (12 if near else 0), near) + commons(sci)
    described = described_colours(code, t)
    log(f"{code}: {len(cands)} openly licensed candidates ({sum(c['source'] == 'inaturalist' for c in cands)} iNaturalist, "
        f"{sum(c['source'] != 'inaturalist' for c in cands)} Commons)")
    for c in cands:
        p = _fetch(c["url_small"], CACHE / code / c["id"])
        if not p:
            c["score"] = {"total": 0.0, "usable": False, "error": "fetch failed"}
            continue
        c["file_small"] = str(p.relative_to(ROOT))
    _score_all(code, cands, plan, described)
    chosen = _choose(code, cands)
    out = {"format": 2, "code": code, "scientific": sci, "plan": plan, "retrieved": dt.date.today().isoformat(),
           **({"near": {"tile": tile, "lat_lon": near, "km": LOCAL_KM}} if near else {}),
           "by": "pipeline/reference_photos.py", "licences": "CC0, CC BY or CC BY-SA only, each photo's own",
           "chosen": chosen["id"] if chosen else None, "candidates": cands}
    STORE.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(out, indent=1) + "\n")
    if chosen:
        log(f"{code}: chose {chosen['id']} ({chosen['licence']}, {chosen['author']}) score {chosen['score']['total']}: {chosen['page']}")
    else:
        log(f"{code}: no usable photo (none whole, large, side-on and standing square)")
    return out


def _score_all(code: str, cands: list[dict], plan: str, described) -> None:
    """Every candidate with a cached photo scored (its subject mask cached too), the local ones first, best first."""
    for c in cands:
        if not c.get("file_small") or not (ROOT / c["file_small"]).exists():
            c["score"] = {"total": 0.0, "usable": False, "error": "no photo"}
            continue
        try:
            img = _load(ROOT / c["file_small"])
            c["score"] = score(img, plan, described, _mask_for(code, c["id"], img))
        except Exception as e:   # an unreadable image scores nothing
            c["score"] = {"total": 0.0, "usable": False, "error": str(e)[:80]}
    if any(c.get("local") for c in cands):
        for c in cands:
            c["score"]["local"] = 1.0 if c.get("local") else NOT_LOCAL
            c["score"]["total"] = round(c["score"]["total"] * c["score"]["local"], 3)
    cands.sort(key=lambda c: (not c["score"].get("usable"), -c["score"]["total"]))


def _choose(code: str, cands: list[dict]) -> dict | None:
    """The best usable candidate whose full-size rendition fetches (none when no photo passes USABLE)."""
    for c in [c for c in cands if c["score"].get("usable")][:5]:
        if _prepare(code, c):
            return c
    return None


def crop_to_animal(p: Path, box, folder: Path) -> Path | None:
    """The photo cropped to the animal's box with a 12% margin (the image Meshy is given), in its own new folder."""
    if not box:
        return None
    from PIL import Image
    im = Image.open(p).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = box
    mx, my = 0.12 * (x1 - x0), 0.12 * (y1 - y0)
    b = (max(0, int((x0 - mx) * W)), max(0, int((y0 - my) * H)), min(W, int((x1 + mx) * W)), min(H, int((y1 + my) * H)))
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / "reference.png"
    im.crop(b).save(out)
    return out


def rescore(code: str) -> dict:
    """The stored candidates scored again from their cached photos (a rule change costs no downloads, but the chosen
    photo's full-size rendition). A judge's earlier pick is kept as a record ("judged"), no longer as the choice."""
    sp = STORE / f"{code}.json"
    d = json.loads(sp.read_text())
    described = described_colours(code, _traits(code))
    if d.get("chosen_by"):
        d["judged"] = {"chosen": d.get("chosen"), "shortlist": d.get("shortlist"), **d["chosen_by"]}
    d.pop("shortlist", None); d.pop("chosen_by", None)
    _score_all(code, d["candidates"], d.get("plan", "quadruped"), described)
    c = _choose(code, d["candidates"])
    d["chosen"] = c["id"] if c else None
    d["format"] = 2
    sp.write_text(json.dumps(d, indent=1) + "\n")
    return d


def _prepare(code: str, c: dict) -> bool:
    """The candidate's full-size rendition fetched (its own folder) and cropped to the animal."""
    p = _fetch(c["url_large"], CACHE / code / (c["id"] + "_large"))
    if not p:
        return False
    crop = crop_to_animal(p, c["score"].get("box"), CACHE / code / (c["id"] + "_crop"))
    c["file_large"] = str(p.relative_to(ROOT))
    c["file_crop"] = str(crop.relative_to(ROOT)) if crop else None
    return bool(crop)


def judge_pick(code: str, photo_ids: str, why: str) -> dict:
    """A judge's override of the rule's choice (--pick), recorded with the reason and the rule's ranks. Iteration 7 needed
    it on every species (GrabCut's cut); since iteration 8 the rule chooses alone and this stays only as a manual
    override, not part of the pipeline's run."""
    sp = STORE / f"{code}.json"
    d = json.loads(sp.read_text())
    ids = [x.strip() for x in photo_ids.split(",") if x.strip()]
    ranks = [x["id"] for x in d["candidates"]]
    for pid in ids:
        if not _prepare(code, next(c for c in d["candidates"] if c["id"] == pid)):
            raise SystemExit(f"{pid}: the full-size photo could not be fetched")
    c = next(c for c in d["candidates"] if c["id"] == ids[0])
    d["chosen"] = ids[0]
    # the judge's shortlist, in its order: a second photo (when the first one's mesh fails the build's gate) comes from
    # it, never from the rule's order alone (2026-11-06: the rule's first badger, lying down, made a mesh the gate let by)
    d["shortlist"] = ids
    d["chosen_by"] = {"by": "the judge (Claude, from the contact sheet of the rule's top candidates)",
                      "rule_rank": [ranks.index(i) + 1 for i in ids], "why": why, "date": dt.date.today().isoformat()}
    sp.write_text(json.dumps(d, indent=1) + "\n")
    return c


def ranked(code: str, skip: set | None = None, n: int = 2, use: str = "image") -> list[dict]:
    """The best n candidates usable for the use ('image': image-to-3D, every USABLE score; 'texture': a refine's texture
    reference, usable_for) not in skip (photo ids already used), each prepared (full size, cropped): the chosen one first,
    then the rule's order (a judge's shortlist, where one was given with --pick, instead)."""
    d = find(code, log=lambda *_: None)
    out = []
    plan = d.get("plan", "quadruped")
    ok = (lambda c: c["score"].get("usable", d.get("format", 1) < 2) and (plan != "snake" or not usable_for(c["score"], plan, "image"))) if use == "image" else \
         (lambda c: "total" in c["score"] and not c["score"].get("error") and not usable_for(c["score"], plan, use))
    order = [c for c in d.get("candidates", []) if ok(c)]
    if d.get("shortlist"):
        order = [next(c for c in d["candidates"] if c["id"] == i) for i in d["shortlist"]]
    for c in sorted(order, key=lambda c: c["id"] != d.get("chosen")):
        if len(out) >= n or (use == "image" and c["score"].get("total", 0) <= 0):
            break   # (a texture reference's total carries the pose scores it does not need)
        if skip and c["id"] in skip:
            continue
        if _prepare(code, c):
            out.append(c)
    (STORE / f"{code}.json").write_text(json.dumps(d, indent=1) + "\n")
    return out


def chosen(code: str) -> dict | None:
    """The chosen reference of a species (finding it first if needed), with its files."""
    d = find(code, log=lambda *_: None)
    return next((c for c in d.get("candidates", []) if c["id"] == d.get("chosen")), None)


def attribution(c: dict) -> dict:
    return {k: c.get(k) for k in ("source", "id", "licence", "author", "attribution", "page", "photo_page", "url_large")}


def contact_sheet(code: str, out: Path, n: int = 8) -> Path:
    from PIL import Image, ImageDraw
    d = find(code, log=lambda *_: None)
    tiles = []
    for c in d["candidates"][:n]:
        if not c.get("file_small"):
            continue
        im = Image.open(ROOT / c["file_small"]).convert("RGB")
        im.thumbnail((300, 300))
        t = Image.new("RGB", (300, 330), "white"); t.paste(im, (0, 0))
        dr = ImageDraw.Draw(t)
        s = c["score"]
        dr.text((3, 302), f"{c['id']} {s['total']:.2f} {'*' if c['id'] == d['chosen'] else ''}", fill=(0, 0, 0))
        dr.text((3, 316), f"w{s.get('whole')} s{s.get('side')} l{s.get('legs')} st{s.get('stance')} {'ok' if s.get('usable') else s.get('why_not', '')}", fill=(0, 0, 0))
        tiles.append(t)
    sheet = Image.new("RGB", (300 * min(4, len(tiles)), 330 * ((len(tiles) + 3) // 4)), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, (300 * (i % 4), 330 * (i // 4)))
    sheet.save(out)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("codes", nargs="+")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--rescore", action="store_true", help="score the stored candidates again from their cached photos")
    ap.add_argument("--tile", help="prefer iNaturalist observations near this tile (the local population)")
    ap.add_argument("--sheet", help="a contact sheet of the top candidates (one code), for the judge")
    ap.add_argument("--pick", help="the judge's shortlist (candidate ids, best first) for the one code named, with --why")
    ap.add_argument("--why", default="")
    a = ap.parse_args(argv)
    if a.pick:
        c = judge_pick(a.codes[0], a.pick, a.why)
        print(f"{a.codes[0]}: {c['id']} ({c['licence']}, {c['author']}) {c['page']}")
        return 0
    for code in a.codes:
        rescore(code) if a.rescore else find(code, a.refresh, tile=a.tile)
        if a.sheet:
            print(contact_sheet(code, Path(a.sheet)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
