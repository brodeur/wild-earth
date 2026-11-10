"""Held-out check 3, eye level: the viewer's frame from where a ground photo was taken, beside the photo
(tools/probes/held_out.py; docs/held-out-judge.md).

Photos    tools/probes/eye_photos.py: a few openly licensed (CC0, CC BY, CC BY-SA, public domain), geotagged ground
          photos per tile from Wikimedia Commons and iNaturalist, chosen by rule and blind to the game; the list with
          attribution is tiles/<tile>/judge/eye_photos.json, the images stay in the git-ignored cache.
Renders   tools/probes/eye_capture.mjs: the viewer at the photo's point, 1.6 m up, level, a tall 75-degree frame, the
          photo's month when it is known, clear sky; toward the photo's heading, or toward eight bearings when the
          photo has none. A photo's tilt is never recorded (from a canyon rim the camera looks down), so a
          VIEW_FOV-degree window is cut from the tall frame at each of SHIFTS heights, and the bearing and window
          whose skyline (the share of sky in each of 16 columns) is nearest the photo's are kept; ties go to the
          level window. The skyline is terrain, the layer the pipeline measures best, so fitting it does not fit
          the colours being judged. A photo with no sky (a close view, a forest interior) cannot be placed this way:
          with a known heading it is compared level; with none it is shown on the sheet and left out of the scores.
Measure   both images cropped to 3:2, scaled to 320 x 213 and cut into three bands (top, middle, bottom). One rule
          for both: sky = bright, blue or colourless pixels reached from the top of their column; green = non-sky
          pixels with CIELAB a* under GREEN_A. Per pair: sky_diff (mean difference of the bands' sky shares: is the
          horizon in the same place), green_diff (mean difference of the bands' green shares of the land), delta_e
          (CIE76 distance between the bands' mean land colours). distance = the mean of sky_diff, green_diff and
          delta_e / 50 (capped at 1): 0 is the same picture by these statistics.
It can    tell a brown render of a green place, a forest drawn where the photo has open ground, a wrong horizon.
It cannot tell species, the shape of plants, texture, or anything finer than a third of the frame; and it is moved by
          things that are not the pipeline's fault: the photo's season, weather, hour, exposure and white balance, its
          real lens and tilt (unknown), GPS error of ten metres or more (decisive at a cliff edge), and people or
          structures in the photo. So the number is weak and the sheets (photo beside render) are the deliverable: a
          person judges them. A better measure needs the camera's lens and tilt (EXIF, or solving them from the
          skyline), photos by month, and a learned comparison (segmenting both images into sky, rock, bare ground,
          grass, shrub, tree and comparing the layouts, or a perceptual embedding distance), validated against human
          rankings of the same sheets.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import judge_common as jc

SIZE = (320, 213)
GREEN_A = -4.0
COLS = 16
PER_SHEET = 5
VIEW_FOV = 45.0
SHIFTS = (-1.0, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75, 1.0)   # the window's place in the tall frame: -1 top, 1 bottom
MIN_SKY = 0.02                                                    # under this share of sky a photo has no skyline to fit


def window(size: tuple, render_fov: float, shift: float) -> tuple:
    """(box, tilt in degrees, down positive): the VIEW_FOV-degree 3:2 window of a frame rendered with a vertical
    field of view of render_fov, moved `shift` (-1 top .. 1 bottom) of the way to the frame's edge."""
    import math
    w, h = size
    f = (h / 2) / math.tan(math.radians(render_fov / 2))
    wh = min(h, 2 * f * math.tan(math.radians(VIEW_FOV / 2)))
    ww = min(w, wh * 1.5)
    cy = h / 2 + shift * (h - wh) / 2
    box = (int(round((w - ww) / 2)), int(round(cy - wh / 2)), int(round((w + ww) / 2)), int(round(cy + wh / 2)))
    return box, round(math.degrees(math.atan((cy - h / 2) / f)), 1)


def load(path, render_fov: float | None = None, shift: float = 0.0) -> np.ndarray:
    """An image as float RGB 0-1, centre-cropped to 3:2 and scaled to SIZE; with render_fov, the window of a tall
    render (window())."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    if render_fov and render_fov > VIEW_FOV:
        im = im.crop(window(im.size, render_fov, shift)[0])
    w, h = im.size
    if w / h > 1.5:
        nw = int(h * 1.5)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / 1.5)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return np.asarray(im.resize(SIZE), dtype=np.float32) / 255


def sky_mask(rgb: np.ndarray) -> np.ndarray:
    """Sky: bright pixels that are blue or nearly colourless, connected to the top of their column."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    cand = (mx > 0.5) & (((b >= r) & (b >= g * 0.95)) | (sat < 0.15))
    return np.logical_and.accumulate(cand, axis=0)


def stats(rgb: np.ndarray) -> dict:
    """The statistics of one image: per band (top, middle, bottom) the sky share, the green share of the land and
    the land's mean CIELAB colour (None where under 5% of the band is land); and the skyline, the sky share of each of
    COLS columns."""
    from skimage import color
    sky = sky_mask(rgb)
    lab = color.rgb2lab(rgb)
    h = rgb.shape[0]
    out = {"sky": [], "green": [], "lab": [], "skyline": [round(float(c.mean()), 4) for c in np.array_split(sky, COLS, axis=1)]}
    for k in range(3):
        rows = slice(k * h // 3, (k + 1) * h // 3)
        s, land = sky[rows], ~sky[rows]
        out["sky"].append(round(float(s.mean()), 4))
        if land.mean() < 0.05:
            out["green"].append(None)
            out["lab"].append(None)
            continue
        L = lab[rows][land]
        out["green"].append(round(float((L[:, 1] < GREEN_A).mean()), 4))
        out["lab"].append([round(float(v), 2) for v in L.mean(0)])
    return out


def skyline_distance(a: dict, b: dict) -> float:
    return float(np.mean(np.abs(np.array(a["skyline"]) - np.array(b["skyline"]))))


def pair_distance(photo: dict, render: dict) -> dict:
    """sky_diff, green_diff, delta_e and the combined distance of a photo's and a render's statistics."""
    sky = float(np.mean([abs(p - r) for p, r in zip(photo["sky"], render["sky"])]))
    bands = [k for k in range(3) if photo["lab"][k] is not None and render["lab"][k] is not None]
    if not bands:
        return {"sky_diff": round(sky, 4), "green_diff": None, "delta_e": None, "lightness_bias": None,
                "distance": round(sky, 4), "bands_compared": 0}
    green = float(np.mean([abs(photo["green"][k] - render["green"][k]) for k in bands]))
    de = float(np.mean([np.linalg.norm(np.array(photo["lab"][k]) - np.array(render["lab"][k])) for k in bands]))
    bias = float(np.mean([render["lab"][k][0] - photo["lab"][k][0] for k in bands]))
    return {"sky_diff": round(sky, 4), "green_diff": round(green, 4), "delta_e": round(de, 2),
            "lightness_bias": round(bias, 2), "distance": round((sky + green + min(de / 50, 1.0)) / 3, 4),
            "bands_compared": len(bands)}


def skyline(rgb: np.ndarray) -> dict:
    return {"skyline": [float(c.mean()) for c in np.array_split(sky_mask(rgb), COLS, axis=1)]}


def choose(photo: dict, candidates: dict) -> tuple:
    """The (bearing, shift) key of candidates ({(bearing, shift): {'skyline': [...]}}) whose skyline is nearest the
    photo's; ties go to the most level window, then the lowest bearing."""
    return min(sorted(candidates, key=lambda k: (abs(k[1]), k[0])),
               key=lambda k: round(skyline_distance(photo, candidates[k]), 6))


def aggregate(pairs: list) -> dict:
    shown = len(pairs)
    pairs = [p for p in pairs if p.get("placed", True)]

    def mean(key):
        v = [p[key] for p in pairs if p.get(key) is not None]
        return round(float(np.mean(v)), 4) if v else None
    return {"pairs": len(pairs), "shown_unplaced": shown - len(pairs),
            "distance_mean": mean("distance"), "sky_diff_mean": mean("sky_diff"),
            "green_diff_mean": mean("green_diff"), "delta_e_mean": mean("delta_e"),
            "lightness_bias_mean": mean("lightness_bias"),
            "headings_known": sum(1 for p in pairs if p.get("heading_known"))}


def sheets(tile: str, pairs: list, photos: dict, rdir: Path) -> list:
    """Side-by-side sheets (photo left, render right, the attribution under each pair) for a person to judge."""
    from PIL import Image, ImageDraw
    W, H, CAP = 540, 360, 34
    out = []
    for s in range(0, len(pairs), PER_SHEET):
        chunk = pairs[s:s + PER_SHEET]
        sheet = Image.new("RGB", (W * 2 + 10, (H + CAP + 8) * len(chunk)), "white")
        d = ImageDraw.Draw(sheet)
        for i, p in enumerate(chunk):
            y = i * (H + CAP + 8)
            ph = photos[p["photo"]]
            for j, rgb in enumerate((load(jc.ROOT / ph["cache"]), load(rdir / p["render"], p.get("render_fov"), p["shift"]))):
                sheet.paste(Image.fromarray((rgb * 255).astype("uint8")).resize((W, H)), (j * (W + 10), y))
            d.text((4, y + H + 2), f"photo: {ph.get('attribution') or ph.get('author')} | {ph.get('licence')} | "
                                   f"{ph.get('taken') or 'date unknown'}"[:150], fill="black")
            how = "photo heading" if p["heading_known"] else "fitted to the skyline" if p["placed"] else "NOT PLACED: no sky"
            d.text((4, y + H + 16), f"{p['photo']}  render: bearing {p['bearing']} deg ({how}), tilt {p['tilt_deg']} deg, "
                                    f"date {p['date']}  distance {p['distance']}  dE {p['delta_e']}  "
                                    f"green diff {p['green_diff']}  sky diff {p['sky_diff']}"[:170], fill="black")
        path = jc.tile_dir(tile) / "judge" / f"eye_level_sheet_{s // PER_SHEET + 1}.jpg"
        sheet.save(path, quality=85)
        out.append(str(path.relative_to(jc.ROOT)))
    return out


def run(tile: str) -> dict:
    jdir = jc.tile_dir(tile) / "judge"
    pp = jdir / "eye_photos.json"
    rdir = jc.tile_cache(tile) / "renders"
    base = {"held_out": True,
            "source": "geotagged ground photos from Wikimedia Commons and iNaturalist (tools/probes/eye_photos.py)",
            "licence": "per photo, one of CC0, public domain, CC BY, CC BY-SA; author, licence and page of each in "
                       f"tiles/{tile}/judge/eye_photos.json"}
    if not pp.exists():
        return {**base, "status": "no photos", "why": f"run tools/probes/eye_photos.py {tile}"}
    listing = json.loads(pp.read_text())
    photos = {p["id"]: p for p in listing.get("photos", [])}
    cp = rdir / "captures.json"
    if not photos:
        return {**base, "status": "no photos", "why": "no openly licensed ground photo passed the rules on this tile",
                "candidates": listing.get("candidates"), "rejected": listing.get("rejected")}
    if not cp.exists():
        return {**base, "status": "no renders", "photos": len(photos),
                "why": f"run tools/probes/eye_capture.mjs for {tile} (a viewer, a headless Chrome and the receiver)"}
    cap = json.loads(cp.read_text())
    by_photo: dict = {}
    for r in cap["renders"]:
        if (rdir / r["file"]).exists() and (jc.ROOT / photos.get(r["photo"], {}).get("cache", "-")).exists():
            by_photo.setdefault(r["photo"], {})[r["bearing"]] = r
    pairs = []
    rfov = cap.get("render_fov_deg")
    for pid, rs in by_photo.items():
        ps = stats(load(jc.ROOT / photos[pid]["cache"]))
        has_sky = float(np.mean(ps["skyline"])) >= MIN_SKY
        shifts = SHIFTS if rfov and has_sky else (0.0,)
        cands = {(b, sh): skyline(load(rdir / r["file"], rfov, sh)) for b, r in rs.items() for sh in shifts}
        b, sh = choose(ps, cands)
        r = rs[b]
        rst = stats(load(rdir / r["file"], rfov, sh))
        known = bool(r.get("heading_known"))
        tilt = 0.0
        if rfov:
            from PIL import Image
            with Image.open(rdir / r["file"]) as im:
                tilt = window(im.size, rfov, sh)[1]
        pairs.append({"photo": pid, "render": r["file"], "bearing": b, "heading_known": known,
                      "placed": known or has_sky, "shift": sh, "tilt_deg": tilt, "render_fov": rfov,
                      "date": r.get("date"), "photo_month": photos[pid].get("month"),
                      "skyline_distance": round(skyline_distance(ps, rst), 4), **pair_distance(ps, rst),
                      "photo_stats": {k: ps[k] for k in ("sky", "green", "lab")},
                      "render_stats": {k: rst[k] for k in ("sky", "green", "lab")}})
    pairs.sort(key=lambda p: (not p["placed"], -(p["distance"] or 0)))
    return {**base, "status": "scored", "fetched": listing.get("fetched"), "captured": cap.get("at", "")[:10],
            "capture": {**{k: cap.get(k) for k in ("hour", "eye_m", "render_fov_deg", "shader_errors")},
                        "compared_fov_deg": VIEW_FOV},
            "licences": sorted({p.get("licence") for p in photos.values() if p.get("licence")}),
            "measure": "per pair, on three bands of each image: the difference of sky shares, of the green share of "
                       "the land, and CIE76 delta E of the land's mean colour; distance = mean(sky_diff, green_diff, "
                       "min(delta_e / 50, 1)), 0 = the same by these statistics",
            "scores": aggregate(pairs), "pairs": pairs, "sheets": sheets(tile, pairs, photos, rdir),
            "limits": "Colour and cover statistics by image band only: no species, shape or texture. Season, weather, "
                      "hour, exposure, the photo's unknown lens and tilt, and GPS error all move the number. The "
                      "sheets are for a person to judge; the number ranks gross mismatches."}
