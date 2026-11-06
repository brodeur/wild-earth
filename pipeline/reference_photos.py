"""Reference photos of a species: a few openly licensed photos of the whole animal, side-on, the best picked by rule
(world pipeline phase 1, iteration 7; docs/decisions.md 2026-11-06).

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
  score     the animal is cut from the background by GrabCut (OpenCV) from a rectangle inset from the frame, its largest
            piece kept; then, each 0-1: whole (the animal does not touch the frame), side-on (its box is wider than tall,
            a snake's long and thin), size (it fills a fair part of the frame, not a speck nor cropped), one animal (the
            largest piece holds the mask), legs clear (a quadruped's lowest band of the mask splits into separate columns,
            not a body sunk in grass), standing square (each leg piece of the mask's lowest band reaches the ground line: a
            stride's lifted foot does not; an image-to-3D mesh keeps the photo's pose and the build needs four feet down),
            the described colours (the share of the animal's pixels near a colour pipeline/appearance.py names), plain background (few edges and little colour spread outside the animal). The
            product ranks; the first is the reference, and its full-size rendition is fetched (into its own folder) and
            cropped to the animal with a margin.
  judge     the cut is GrabCut's, without a learned model, and a busy photo fools it (rocks or a hillside taken for the
            animal), so the scores make a shortlist: the judge (Claude) looks at a contact sheet of the top candidates
            against the same criteria and confirms the first or picks another (--pick, recorded with its reason and the
            rule's rank as chosen_by);
  store     library/animals/references/<code>.json: every candidate's source, licence, author, attribution, page URL and
            scores, and the chosen one. The photo goes with the Meshy job that uses it (reference.jpg and reference.json,
            the attribution, beside job.json).

  arch -arm64 .venv/bin/python -m pipeline.reference_photos <code> [<code> ...] [--refresh] [--sheet out.png]
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


def score(img: np.ndarray, plan: str = "quadruped", described: np.ndarray | None = None) -> dict:
    """The rule's scores (module docstring) of one photo, and the animal's box (fractions of the frame)."""
    import cv2
    h, w = img.shape[:2]
    bgr = img[:, :, ::-1].copy()
    mask = np.zeros((h, w), np.uint8)
    ix, iy = int(0.04 * w), int(0.04 * h)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, mask, (ix, iy, w - 2 * ix, h - 2 * iy), bgd, fgd, 4, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return {"total": 0.0}
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n < 2:
        return {"total": 0.0}
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    comp = lab == k
    area = float(comp.sum())
    single = area / max(1.0, float(fg.sum()))
    ys, xs = np.nonzero(comp)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    # the cut cannot reach outside its rectangle: an animal running out of the frame touches the rectangle's edge
    inner = comp[iy:h - iy, ix:w - ix]
    edge = np.concatenate([inner[:3].ravel(), inner[-3:].ravel(), inner[:, :3].ravel(), inner[:, -3:].ravel()])
    whole = float(np.clip(1 - edge.mean() * 12, 0, 1))
    aspect = bw / bh
    side = float(np.clip((aspect - 0.9) / 0.6, 0, 1)) if plan != "snake" else float(np.clip((aspect - 1.2) / 1.5, 0.2, 1))
    fill = bw / w
    size = float(np.clip((fill - 0.25) / 0.2, 0, 1))   # a cropped animal is caught by whole
    legs, stance = 1.0, 1.0
    if plan == "quadruped":
        runs = []
        for yy in range(int(y0 + 0.82 * bh), int(y0 + 0.95 * bh)):
            row = comp[yy, x0:x1 + 1].astype(np.int8)
            starts = int(((row[1:] == 1) & (row[:-1] == 0)).sum() + row[0])
            runs.append(starts)
        legs = float(np.clip((np.median(runs) - 1) / 2, 0, 1)) if runs else 0.0
        # standing square, all four feet down (the build's gate refuses a stride: an image-to-3D mesh keeps the photo's
        # pose): each leg piece of the mask's lowest 15% must reach its lowest 3%; a lifted foot ends above it
        band = comp[int(y0 + 0.85 * bh):y1 + 1, x0:x1 + 1].astype(np.uint8)
        nb, lb, sb, _ = cv2.connectedComponentsWithStats(band)
        pieces = [i for i in range(1, nb) if sb[i, cv2.CC_STAT_AREA] > 0.002 * area]
        if pieces:
            floor = band.shape[0] - max(2, int(0.03 * bh))
            down = [i for i in pieces if sb[i, cv2.CC_STAT_TOP] + sb[i, cv2.CC_STAT_HEIGHT] >= floor]
            stance = len(down) / len(pieces)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 160) > 0
    bg = ~cv2.dilate(comp.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    ed = float(edges[bg].mean()) if bg.any() else 1.0
    labi = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3)[bg.ravel()].astype(np.float64)
    spread = float(labi.std(0).mean()) if len(labi) else 99.0
    plain = float(np.clip(1 - ed / 0.12, 0, 1) * 0.6 + np.clip(1 - spread / 40, 0, 1) * 0.4)
    # the described colours (pipeline/appearance.py): the share of the animal's pixels within reach of a colour the
    # description names (lighting shifts a photo, so the reach is twice the check's); a stained or backlit animal, or
    # another species, scores lower
    colour = 1.0
    if described is not None and len(described):
        from .appearance import de2000, lab as _lab
        px = img[comp][:: max(1, int(area // 4000))].astype(np.float64) / 255
        lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
        colour = float((de2000(_lab(lin), described).min(1) <= 32).mean())
    total = (whole * side * size * (0.4 + 0.6 * single) * (0.3 + 0.7 * legs) * (0.2 + 0.8 * stance) * (0.5 + 0.5 * plain)
             * (0.3 + 0.7 * colour))
    r = lambda v: round(float(v), 3)
    return {"total": r(total), "whole": r(whole), "side": r(side), "size": r(size), "single": r(single), "legs": r(legs), "stance": r(stance),
            "plain": r(plain), "colour": r(colour), "aspect": r(aspect), "box": [r(x0 / w), r(y0 / h), r((x1 + 1) / w), r((y1 + 1) / h)]}


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
            c["score"] = {"total": 0.0, "error": "fetch failed"}
            continue
        c["file_small"] = str(p.relative_to(ROOT))
        try:
            c["score"] = score(_load(p), plan, described)
        except Exception as e:   # an unreadable image scores nothing
            c["score"] = {"total": 0.0, "error": str(e)[:80]}
    if any(c.get("local") for c in cands):
        for c in cands:
            c["score"]["local"] = 1.0 if c.get("local") else NOT_LOCAL
            c["score"]["total"] = round(c["score"]["total"] * c["score"]["local"], 3)
    cands.sort(key=lambda c: -c["score"]["total"])
    chosen = None
    for c in cands[:5]:   # the best whose full-size rendition fetches
        if _prepare(code, c):
            chosen = c
            break
    out = {"format": 1, "code": code, "scientific": sci, "plan": plan, "retrieved": dt.date.today().isoformat(),
           **({"near": {"tile": tile, "lat_lon": near, "km": LOCAL_KM}} if near else {}),
           "by": "pipeline/reference_photos.py", "licences": "CC0, CC BY or CC BY-SA only, each photo's own",
           "chosen": chosen["id"] if chosen else None, "candidates": cands}
    STORE.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(out, indent=1) + "\n")
    if chosen:
        log(f"{code}: chose {chosen['id']} ({chosen['licence']}, {chosen['author']}) score {chosen['score']['total']}: {chosen['page']}")
    return out


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
    """The stored candidates scored again from their cached photos (a rule change costs no downloads)."""
    sp = STORE / f"{code}.json"
    d = json.loads(sp.read_text())
    t = _traits(code)
    described = described_colours(code, t)
    for c in d["candidates"]:
        if c.get("file_small") and (ROOT / c["file_small"]).exists():
            c["score"] = score(_load(ROOT / c["file_small"]), d.get("plan", "quadruped"), described)
            if any(x.get("local") for x in d["candidates"]):
                c["score"]["local"] = 1.0 if c.get("local") else NOT_LOCAL
                c["score"]["total"] = round(c["score"]["total"] * c["score"]["local"], 3)
    d["candidates"].sort(key=lambda c: -c["score"]["total"])
    d["chosen"] = None
    d.pop("shortlist", None); d.pop("chosen_by", None)
    for c in d["candidates"][:5]:
        if _prepare(code, c):
            d["chosen"] = c["id"]; break
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
    """The judge's pick from the rule's shortlist (the contact sheet of its top candidates): the cut from the background
    is GrabCut's, without a learned model, and on a busy photo it takes rocks or a hillside for the animal, so the
    scores rank but the judge (Claude, looking at the shortlist against the same criteria: the whole animal, side-on,
    standing square with four feet down, plain background) confirms or overrides the first. Recorded with the reason."""
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


def ranked(code: str, skip: set | None = None, n: int = 2) -> list[dict]:
    """The best n candidates not in skip (photo ids already used), each prepared (full size, cropped): the chosen one
    (the rule's first, or the judge's pick) first, then the rule's order."""
    d = find(code, log=lambda *_: None)
    out = []
    order = d.get("candidates", [])
    if d.get("shortlist"):
        order = [next(c for c in order if c["id"] == i) for i in d["shortlist"]]
    for c in sorted(order, key=lambda c: c["id"] != d.get("chosen")):
        if len(out) >= n or c["score"].get("total", 0) <= 0:
            break
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
        dr.text((3, 316), f"w{s.get('whole')} s{s.get('side')} z{s.get('size')} l{s.get('legs')} p{s.get('plain')}", fill=(0, 0, 0))
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
