"""Ground-only base texture: the tree crowns and their shadows taken out of the erased NAIP imagery.

    python -m pipeline.inpaint_crowns utm10n_680_4280 [more tile ids] [--sheet DIR]

Trees are drawn in 3D over the ground texture, so a crown left in the photo is a dark blob under
every tree (and a canopy-green tint once the season turns). This step keeps the photo's time of year
and replaces only what the lidar says is canopy:

1. Mask (2.5 m, the texture grid). Core: pixels whose 1 m CHM is >= 3 m over at least 30% of the
   pixel (trees and tall shrubs; chaparral under 3 m keeps its own tint), grown 1 px. Shadow lobe:
   every canopy pixel cast along the sun's shadow direction by its height x cot(elevation), over a
   +-5 degree fan, kept where the photo is DARK_MARGIN darker than the clean ground of its class
   around it. The sun is fitted to the photo, not assumed: per 5 km quadrant (neighbouring NAIP
   quarter quads are flown on different days) the hour of the flight date whose shadow lobe is
   darkest. NAIP 2022 here was flown in the early afternoon (about 14:00-14:30 PDT, sun 215-226 deg,
   66-69 deg up), so shadows fall north-east and are short. Then up to GROW_PX of dark pixels next to
   the mask (crowns displaced in the photo, the lidar's lag). Pavement and open water are never
   touched. Areas erase_imagery erased are quilted woodland with crowns of their own and a CHM of
   houses, so there only dark pixels are filled (no buildings come back: no source window is erased).
2. Ground colour. For each habitat class (riparian its own), a normalised convolution of the lit
   clean pixels of that class (2 px clear of the mask, not built, no road, not water, not watered
   lawn, not shade) at 15, 60, 250 and 1000 m, each scale weighted by its support, so the colour is
   the lit ground beside a crown where there is some and the class's ground farther off under closed
   canopy. Classes are blended by a 30 m blur of the 30 m class map so its cells do not show.
3. Texture. Image quilting as in erase_imagery (_gain, _seam), with 12 px (30 m) patches because
   wholly clean 80 m windows are rare once most of the tile is canopy: per patch, CANDIDATES windows
   from the KNN nearest clean, shadow-free windows of its class (oak woodland, chaparral and the
   forests also borrow grassland texture; riparian and barren only their own), gained toward the
   ground colour, scored against the pixels already there plus a penalty per earlier use of the
   window, one of the best four pasted along minimum-error seams. Vectorised per patch.
4. The synthesized texture's low frequencies (sigma 20 m) are replaced by the ground colour, so the
   fill carries the patches' grain but the brightness of the lit ground around it: no patchwork, and
   never brighter than the ground beside it. Minor pavement, which erase_imagery faded 70% toward its
   surrounding ground, follows 70% of that ground's change; highways and county roads stay exact.

Outputs: client/texture_ground.jpg (same grid as texture_imagery.jpg, JPEG q88) and
client/texture_ground_mask.png (1000 px, 8-bit share of each 10 m pixel filled: 255 filled, 0 kept).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import resource
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from scipy.spatial import cKDTree

from .config import TILE_SIZE_M, Tile
from .erase_imagery import (PAVEMENT, _built_pixels, _footprint_mask, _gain, _human_cells, _irrigated,
                            _kept_pavement, _rewilded_beds, _seam, _upsample_nearest)
from .habitat import CLASSES, CODES

Image.MAX_IMAGE_PIXELS = None

TALL_M = 3.0                  # CHM height that counts as canopy (trees and tall shrubs)
TALL_SHARE = 0.3              # ... over at least this share of a 2.5 m pixel's 1 m cells
DARK_MARGIN = 0.12            # a lobe or grown pixel must be this much darker than its clean ground
GROW_PX = 2                   # dark pixels this close to the mask join it
FAN_DEG = 5.0                 # shadow direction tolerance
FIT_HOURS = (8.0, 17.0)       # local (PDT) hours searched for the flight
SHADE_CUT = 0.75              # share of a class's median clean brightness below which a pixel is shade, not ground
ROAD_CLEAN = 60               # client/roads.png weight above which a pixel is no source (verge, faded track)
SCALES_M = (15.0, 60.0, 250.0, 1000.0)
SCALE_WEIGHTS = (1.0, 0.3, 0.1, 0.03)
SUPPORT_FULL = 0.2            # a scale counts fully once this share of its footprint is clean ground
CLASS_BLUR_M = 30.0
LOW_SIGMA_PX = 8.0            # low frequencies of the fill below this are the ground colour
PATCH, OVERLAP, WSTRIDE = 12, 3, 3
KNN, CANDIDATES = 160, 24
USE_PENALTY = 3.0             # score units (RMS grey levels) per earlier use of a window
CLASS_SHARE = 0.5
LUM = np.float32([0.299, 0.587, 0.114])
# NAIP flight dates (Planetary Computer item datetimes); the hour is fitted. Others: 15 July.
NAIP_DATES = {"utm10n_680_4280": "2022-07-21", "utm10n_690_4280": "2022-07-20", "utm10n_680_4270": "2022-06-21"}
# Fallback class when a class has no clean windows: riparian borrows only from riparian first.
FALLBACK = {"conifer_forest": ["mixed_forest", "oak_woodland"], "mixed_forest": ["conifer_forest", "oak_woodland"],
            "oak_woodland": ["grassland", "mixed_forest"], "chaparral": ["oak_woodland", "grassland"],
            "grassland": ["oak_woodland"], "riparian": ["oak_woodland", "grassland"], "barren": ["grassland", "chaparral"],
            "water": ["riparian"], "human": ["grassland"]}

# Classes whose clean windows also lend texture (not colour) to a class's patches.
SHARE_TEXTURE = {"oak_woodland": ["grassland"], "grassland": ["oak_woodland"], "chaparral": ["grassland", "oak_woodland"],
                 "conifer_forest": ["mixed_forest", "oak_woodland", "grassland"],
                 "mixed_forest": ["conifer_forest", "oak_woodland", "grassland"]}

# Comparison windows (tile metres x, north, label); a riparian one is picked from the class map.
SHEET_WINDOWS = {"utm10n_680_4280": [(4309, 3440, "blue oak savanna"), (2958, 9835, "ponderosa stand")]}


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------------------------- sun

def sun_position(lat: float, lon: float, when_utc: dt.datetime) -> tuple[float, float]:
    """(azimuth from north, elevation) in degrees; NOAA low-precision formulae (about 0.1 degree)."""
    n = (when_utc - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400
    L = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    ha = math.radians((gmst * 15 + lon) % 360) - ra
    la = math.radians(lat)
    el = math.asin(math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha))
    az = math.atan2(-math.sin(ha), math.tan(dec) * math.cos(la) - math.sin(la) * math.cos(ha))
    return math.degrees(az) % 360, math.degrees(el)


def shadow_lobe(h: np.ndarray, canopy: np.ndarray, az: float, el: float, res: float, fan=0.0) -> np.ndarray:
    """Ground each canopy pixel shades: cast along the shadow direction (az + 180) by h cot(el), in
    0.7 px steps, over azimuths az - fan .. az + fan."""
    reach = h / math.tan(math.radians(max(el, 5.0))) / res
    n0, n1 = h.shape
    out = np.zeros(h.shape, bool)
    smax = float(reach[canopy].max()) if canopy.any() else 0.0
    for a in ((az - fan, az, az + fan) if fan else (az,)):
        d = math.radians((a + 180) % 360)
        ex, nn = math.sin(d), math.cos(d)
        for s in np.arange(0.7, smax + 0.7, 0.7):
            dx, dy = int(round(s * ex)), int(round(-s * nn))
            src = canopy & (reach >= s)
            out[max(0, dy):n0 - max(0, -dy), max(0, dx):n1 - max(0, -dx)] |= \
                src[max(0, -dy):n0 - max(0, dy), max(0, -dx):n1 - max(0, dx)]
    return out


def fit_sun(tile: Tile, lum: np.ndarray, h: np.ndarray, canopy: np.ndarray, date: str) -> list[dict]:
    """Per 5 km quadrant, the hour of `date` whose shadow lobe is darkest against the ground ringing
    the canopy (the lobe outside a 1 px ring of canopy, against the 2-4 px ring), hours in 0.5 h then
    0.1 h steps. At 5 m the 1 px ring swallows most of a summer shadow and the fit drifts late."""
    lon, lat = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True).transform(
        tile.bounds[0] + TILE_SIZE_M / 2, tile.bounds[1] + TILE_SIZE_M / 2)
    y, m, d = map(int, date.split("-"))
    utc_off = 7 if 3 <= m <= 10 else 8               # PDT in the NAIP season
    hs, ls, cs = h, lum, canopy
    near = cv2.dilate(cs.astype("uint8"), np.ones((3, 3), "uint8")).astype(bool)
    ring = cv2.dilate(cs.astype("uint8"), np.ones((9, 9), "uint8")).astype(bool) & ~near
    k = hs.shape[0] // 2
    quads = [(slice(0, k), slice(0, k), "NW"), (slice(0, k), slice(k, None), "NE"),
             (slice(k, None), slice(0, k), "SW"), (slice(k, None), slice(k, None), "SE")]

    def score(hour):
        az, el = sun_position(lat, lon, dt.datetime(y, m, d) + dt.timedelta(hours=hour + utc_off))
        if el < 10:
            return az, el, [9.0] * 4
        lb = shadow_lobe(hs, cs, az, el, TILE_SIZE_M / lum.shape[0]) & ~near
        out = []
        for qy, qx, _ in quads:
            a, r = lb[qy, qx], ring[qy, qx] & ~lb[qy, qx]
            out.append(float(ls[qy, qx][a].mean() / ls[qy, qx][r].mean()) if a.sum() > 2000 and r.sum() > 2000 else 9.0)
        return az, el, out

    coarse = {hr: score(hr) for hr in np.arange(FIT_HOURS[0], FIT_HOURS[1] + 0.01, 0.5)}
    fits = []
    for qi, (_, _, name) in enumerate(quads):
        h0 = min(coarse, key=lambda hr: coarse[hr][2][qi])
        fine = {hr: score(hr) for hr in np.arange(h0 - 0.4, h0 + 0.41, 0.1)}
        best = min(fine, key=lambda hr: fine[hr][2][qi])
        az, el, sc = fine[best]
        fits.append({"quadrant": name, "local_hour": round(float(best), 2), "azimuth": round(az, 1),
                     "elevation": round(el, 1), "lobe_over_ring": round(sc[qi], 3)})
    # A quadrant with too few trees to fit takes the tile's median hour.
    good = [f for f in fits if f["lobe_over_ring"] < 0.95]
    if good and len(good) < 4:
        hr = float(np.median([f["local_hour"] for f in good]))
        az, el = sun_position(lat, lon, dt.datetime(y, m, d) + dt.timedelta(hours=hr + utc_off))
        for f in fits:
            if f["lobe_over_ring"] >= 0.95:
                f.update(local_hour=round(hr, 2), azimuth=round(az, 1), elevation=round(el, 1), fallback=True)
    return fits


# --------------------------------------------------------------------------------------- ground colour

def _nblur(img: np.ndarray, w: np.ndarray, sigma_px: float, scale: int):
    """(sum of img*w, sum of w) under a gaussian, computed at 1/scale resolution and upsampled."""
    n = w.shape[0]
    if scale > 1:
        m = n // scale
        ws = cv2.resize(w, (m, m), interpolation=cv2.INTER_AREA)
        ims = cv2.resize(img * w[..., None], (m, m), interpolation=cv2.INTER_AREA)
        s = sigma_px / scale
    else:
        ws, ims, s = w, img * w[..., None], sigma_px
    num = cv2.GaussianBlur(ims, (0, 0), s, borderType=cv2.BORDER_REFLECT)
    den = cv2.GaussianBlur(ws, (0, 0), s, borderType=cv2.BORDER_REFLECT)
    if scale > 1:
        num = cv2.resize(num, (n, n), interpolation=cv2.INTER_LINEAR)
        den = cv2.resize(den, (n, n), interpolation=cv2.INTER_LINEAR)
    return num, den


def ground_colour(img: np.ndarray, clean: np.ndarray, target: np.ndarray, res: float) -> tuple[np.ndarray, dict]:
    """Per-pixel colour of lit, clean ground of the pixel's class: a multi-scale normalised
    convolution per class, the classes blended by a CLASS_BLUR_M blur of the class map."""
    n = img.shape[0]
    f = img.astype("float32")
    acc = np.zeros((n, n, 3), "float32")
    wsum = np.zeros((n, n), "float32")
    classes = [int(c) for c in np.unique(target)]
    means = {}
    for c in classes:
        sel = clean & (target == c)
        if sel.sum() >= 500:
            means[c] = f[sel].mean(0)
    for c in classes:
        src = c if c in means else next((CODES[k] for k in FALLBACK.get(CLASSES[c], []) if CODES[k] in means), None)
        if src is None:
            continue
        wc = cv2.GaussianBlur((target == c).astype("float32"), (0, 0), CLASS_BLUR_M / res)
        if wc.max() < 1e-3:
            continue
        w = (clean & (target == src)).astype("float32")
        # Each scale's mean, weighted by its weight times its support (saturating at SUPPORT_FULL), so a
        # few stray clean pixels in a dense stand do not outvote the wider ground: no blotches.
        num = np.broadcast_to(means[src] * 1e-3, (n, n, 3)).astype("float32")   # the class mean, weakest
        den = np.full((n, n), 1e-3, "float32")
        for sm, a in zip(SCALES_M, SCALE_WEIGHTS):
            sigma = sm / res
            nb, db = _nblur(f, w, sigma, 1 if sigma < 10 else (4 if sigma < 60 else 16))
            ws = a * np.minimum(db / SUPPORT_FULL, 1.0)
            num += (ws / np.maximum(db, 1e-6))[..., None] * nb
            den += ws
            del nb, db, ws
        acc += wc[..., None] * (num / den[..., None])
        wsum += wc
    return acc / np.maximum(wsum, 1e-6)[..., None], {CLASSES[c]: [round(float(v), 1) for v in m] for c, m in means.items()}


# ------------------------------------------------------------------------------------------ synthesis

def _windows(clean: np.ndarray, target: np.ndarray, img: np.ndarray) -> dict:
    """Per class: corners (y, x) of PATCH windows wholly clean and at least CLASS_SHARE that class,
    with their mean colours."""
    n = clean.shape[0]
    ys = np.arange(0, n - PATCH + 1, WSTRIDE)
    yy, xx = np.meshgrid(ys, ys, indexing="ij")
    yy, xx = yy.ravel(), xx.ravel()

    def box(a):
        s = cv2.integral(a)
        return s[yy + PATCH, xx + PATCH] - s[yy, xx + PATCH] - s[yy + PATCH, xx] + s[yy, xx]

    full = PATCH * PATCH
    ok = box(clean.astype("uint8")) == full
    sums = box(img)                                            # (K, 3) int sums
    out = {}
    for c in np.unique(target):
        sel = ok & (box((target == c).astype("uint8")) >= CLASS_SHARE * full)
        if sel.sum() >= 20:
            corners = np.stack([yy[sel], xx[sel]], 1)
            out[int(c)] = {"corners": corners, "mean": sums[sel].astype("float32") / full,
                           "tree": cKDTree(corners + PATCH / 2)}
    return out


def quilt(img: np.ndarray, region: np.ndarray, target: np.ndarray, known_ok: np.ndarray, goal: np.ndarray,
          windows: dict, rng: np.random.Generator) -> tuple[np.ndarray, dict]:
    """Image quilting of `region` from same-class clean windows near each patch (see module doc)."""
    n = img.shape[0]
    src = img.astype("float32")
    canvas = src.copy()
    placed = np.zeros((n, n), bool)
    step = PATCH - OVERLAP
    starts = np.arange(-OVERLAP // 2, n - OVERLAP, step)
    Y0, X0 = np.meshgrid(starts, starts, indexing="ij")
    Y0, X0 = Y0.ravel(), X0.ravel()
    YA, XA = np.maximum(Y0, 0), np.maximum(X0, 0)
    YB, XB = np.minimum(Y0 + PATCH, n), np.minimum(X0 + PATCH, n)

    def box(a):
        s = cv2.integral(a.astype("uint8"))
        return s[YB, XB] - s[YA, XB] - s[YB, XA] + s[YA, XA]

    has = box(region) > 0
    # Class per patch: the majority class of its region pixels, then the first fallback with windows.
    classes = [int(c) for c in np.unique(target[region])]
    counts = np.stack([box(region & (target == c)) for c in classes], 1)
    pcls = np.array(classes)[counts.argmax(1)]
    chain = {}
    for c in classes:
        chain[c] = c if c in windows else next((CODES[k] for k in FALLBACK.get(CLASSES[c], [])
                                                if CODES[k] in windows), None)
    # Texture pool per class: its own windows plus those of classes whose open ground is the same dry
    # grass (the colour comes from the class's own clean ground in step 4 either way). Riparian and
    # barren keep their own, so creek floors stay creek floors.
    pools = {}
    for c in classes:
        k = chain[c]
        if k is None:
            continue
        ks = [k] + [CODES[x] for x in SHARE_TEXTURE.get(CLASSES[k], []) if CODES[x] in windows]
        corners = np.concatenate([windows[x]["corners"] for x in ks])
        corners, first = np.unique(corners, axis=0, return_index=True)
        means = np.concatenate([windows[x]["mean"] for x in ks])[first]
        pools[c] = {"corners": corners, "mean": means, "tree": cKDTree(corners + PATCH / 2),
                    "uses": np.zeros(len(corners), "float32")}
    idx = np.flatnonzero(has)
    nbrs = np.full((len(Y0), KNN), -1, np.int64)
    dist = np.full(len(Y0), np.nan, "float32")
    for c in classes:
        sel = idx[pcls[idx] == c]
        if c not in pools or not len(sel):
            continue
        kk = min(KNN, len(pools[c]["corners"]))
        cy = (Y0[sel] + PATCH / 2).astype("float32")
        cx = (X0[sel] + PATCH / 2).astype("float32")
        dd, ii = pools[c]["tree"].query(np.stack([cy, cx], 1), k=kk)
        ii = ii.reshape(len(sel), kk)
        nbrs[sel, :kk] = ii
        dist[sel] = np.median(dd.reshape(len(sel), kk), 1)
    res = TILE_SIZE_M / n
    patches = 0
    for p in idx:
        c = int(pcls[p])
        if c not in pools:
            continue
        y0, x0, ya, xa, yb, xb = Y0[p], X0[p], YA[p], XA[p], YB[p], XB[p]
        reg = region[ya:yb, xa:xb]
        nb = nbrs[p]
        nb = nb[nb >= 0]
        pick = nb[rng.choice(len(nb), size=min(CANDIDATES, len(nb)), replace=False)]
        W = pools[c]
        cy, cx = min(y0 + PATCH // 2, n - 1), min(x0 + PATCH // 2, n - 1)
        g = goal[cy, cx]
        gain = _gain(W["mean"][pick], np.broadcast_to(g, (len(pick), 3)))
        dy, dx = np.arange(ya - y0, yb - y0), np.arange(xa - x0, xb - x0)
        ys = W["corners"][pick, 0][:, None] + dy[None, :]
        xs = W["corners"][pick, 1][:, None] + dx[None, :]
        cands = src[ys[:, :, None], xs[:, None, :]] * gain[:, None, None, :]
        win = canvas[ya:yb, xa:xb]
        known = (~reg & known_ok[ya:yb, xa:xb]) | placed[ya:yb, xa:xb]
        score = np.abs(W["mean"][pick] - g).mean(1) * 0.5
        if known.any():
            score += np.sqrt(((cands[:, known] - win[known]) ** 2).mean((1, 2)))
        # A window used before costs USE_PENALTY per use, and the pick is random among the best
        # four: quilting otherwise copies one good match down a whole row (a track repeated in dashes).
        score += USE_PENALTY * W["uses"][pick]
        best = np.argsort(score)[:4]
        b = best[rng.integers(len(best))]
        W["uses"][pick[b]] += 1
        patch = cands[b]
        take = np.ones(reg.shape, bool)
        err = ((patch - win) ** 2).sum(-1) * known
        if xa == x0 and x0 > 0:
            path = _seam(err[:, :OVERLAP])
            take[:, :OVERLAP] &= np.arange(OVERLAP)[None, :] >= path[:, None]
        if ya == y0 and y0 > 0:
            path = _seam(err[:OVERLAP, :].T.copy())
            take[:OVERLAP, :] &= np.arange(OVERLAP)[:, None] >= path[None, :]
        write = reg & (take | ~placed[ya:yb, xa:xb])
        win[write] = patch[write]
        placed[ya:yb, xa:xb] |= reg
        patches += 1
    d = dist[idx] * res
    d = d[np.isfinite(d)]
    stats = {"patches": patches, "patch_px": PATCH, "overlap_px": OVERLAP,
             "source_distance_m": {"median": round(float(np.median(d))), "p90": round(float(np.percentile(d, 90))),
                                   "max": round(float(d.max()))} if len(d) else None}
    return canvas, stats


# ------------------------------------------------------------------------------------------------ main

def _protected(tile: Tile, naip: np.ndarray, tr, n: int) -> dict:
    """What erase_imagery erased or rewilded (its exact mask, rebuilt with its own helpers), pavement
    and open water. Pavement and water are never changed; erased pixels only where they are dark
    (the woodland patches erase_imagery quilted into them carry crowns of their own)."""
    with rasterio.open(tile.path("vegetation/habitat_present.tif")) as src:
        present = src.read(1)
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        backfilled = src.read(1)
    whole, partial = _human_cells(tile, present)
    human = _upsample_nearest(whole, n).astype(bool) | (_upsample_nearest(partial, n).astype(bool) & _built_pixels(naip))
    roads = np.asarray(Image.open(tile.path("client/roads.png")).convert("L").resize((n, n), Image.BILINEAR))
    pave = roads > PAVEMENT
    erased = (_footprint_mask(tile, (n, n), tr) | human) & ~pave
    beds = _rewilded_beds(tile, n)
    if beds is not None:
        erased |= beds[0]
    water = _upsample_nearest((backfilled == CODES["water"]) | (present == CODES["water"]), n).astype(bool)
    if beds is not None:
        water &= ~beds[0]
    return {"erased": erased & ~pave & ~water, "pavement": pave, "water": water, "roads": roads,
            "target": _upsample_nearest(backfilled, n)}


def inpaint_crowns(tile: Tile, sheet_dir: Path | None = None) -> dict:
    t0 = time.time()
    with rasterio.open(tile.path("imagery/naip.tif")) as src:
        naip = np.moveaxis(src.read(indexes=[1, 2, 3]), 0, -1).copy()
        tr = src.transform
        tags = src.tags()
    img = np.asarray(Image.open(tile.path("client/texture_imagery.jpg")).convert("RGB"))
    n = img.shape[0]
    assert naip.shape[0] == n, "texture_imagery.jpg and imagery/naip.tif must share the grid"
    res = TILE_SIZE_M / n
    with rasterio.open(tile.path("vegetation/chm_1m.tif")) as src:
        chm = src.read(1)
    tall_share = cv2.resize((chm >= TALL_M * 100).astype("float32"), (n, n), interpolation=cv2.INTER_AREA)
    # Height for the shadow: the tallest 1 m cell around each 2.5 m pixel.
    h = cv2.resize(cv2.dilate(chm, np.ones((3, 3), "uint16")), (n, n), interpolation=cv2.INTER_NEAREST).astype("float32") / 100
    del chm
    canopy = tall_share >= TALL_SHARE
    h = np.where(canopy, h, 0).astype("float32")
    lum = img.astype("float32") @ LUM
    log(f"  loaded {time.time() - t0:.0f}s, canopy {canopy.mean():.3f}")

    aux = _protected(tile, naip, tr, n)
    del naip
    roads, target, erased = aux["roads"], aux["target"], aux["erased"]
    # Open water only: the 30 m water cells also hold the riparian canopy over a river's banks.
    aux["water"] &= ~canopy
    hard = aux["pavement"] | aux["water"]                  # never changed

    # 1. Sun, from the photo's own shadows.
    date = NAIP_DATES.get(tile.tile_id) or f"{tags.get('WE_NAIP_YEAR') or 2022}-07-15"
    sun = fit_sun(tile, lum, h, canopy, date)
    log(f"  sun {[(f['quadrant'], f['local_hour'], f['azimuth'], f['elevation'], f['lobe_over_ring']) for f in sun]}  {time.time() - t0:.0f}s")
    k3 = np.ones((3, 3), "uint8")
    core = cv2.dilate(canopy.astype("uint8"), k3).astype(bool)
    lobe = np.zeros((n, n), bool)
    half = n // 2
    for f, (qy, qx) in zip(sun, [(slice(0, half), slice(0, half)), (slice(0, half), slice(half, None)),
                                 (slice(half, None), slice(0, half)), (slice(half, None), slice(half, None))]):
        # each quadrant's own sun, cast over the whole tile then kept to the quadrant (lobes cross the line)
        q = np.zeros((n, n), bool)
        q[qy, qx] = True
        pad = cv2.dilate(q.astype("uint8"), np.ones((41, 41), "uint8")).astype(bool)
        lobe |= shadow_lobe(np.where(pad, h, 0), canopy & pad, f["azimuth"], f["elevation"], res, FAN_DEG) & q
    lobe &= ~core

    # 2. Clean ground before the dark test: nothing near canopy or its lobe.
    near = cv2.dilate((core | lobe).astype("uint8"), k3).astype(bool)
    k3e = cv2.dilate(erased.astype("uint8"), k3).astype(bool)
    base_clean = ~hard & ~k3e & (roads <= ROAD_CLEAN) & ~_irrigated(img)
    # Deep shade, water the 30 m water class misses, canopy the CHM missed: darker than SHADE_CUT of
    # the class's median clean ground is never ground colour.
    # In a dense stand every clean pixel is a shaded gap, so the tile's own median counts too.
    tile_med = float(np.median(lum[base_clean & ~near]))
    base_clean &= lum >= SHADE_CUT * tile_med
    for c in np.unique(target):
        sel = base_clean & ~near & (target == c)
        if sel.sum() >= 500:
            base_clean &= ~((target == c) & (lum < SHADE_CUT * float(np.median(lum[sel]))))
    clean0 = base_clean & ~near
    goal0, _ = ground_colour(img, clean0, target, res)
    dark = lum < (goal0 @ LUM) * (1 - DARK_MARGIN)
    mask = core | (lobe & dark)
    reach = cv2.dilate(mask.astype("uint8"), np.ones((2 * GROW_PX + 1,) * 2, "uint8")).astype(bool)
    for _ in range(GROW_PX):
        mask |= cv2.dilate(mask.astype("uint8"), k3).astype(bool) & dark & reach
    mask &= ~hard & ~erased
    # Erased areas: the CHM there is houses and real trees, the pixels quilted woodland, so dark is
    # all that marks a crown (specks under 2x2 dropped, then grown 1 px inside the erased area).
    ed = cv2.morphologyEx((erased & dark).astype("uint8"), cv2.MORPH_OPEN, np.ones((2, 2), "uint8"))
    erased_mask = cv2.dilate(ed, k3).astype(bool) & erased
    mask |= erased_mask
    protect = hard
    region = cv2.dilate(mask.astype("uint8"), k3).astype(bool) & ~protect          # + 1 px feather
    alpha = np.where(mask, 1.0, np.where(region, 0.5, 0.0)).astype("float32")
    mask_fraction = float(mask.mean())
    log(f"  mask {mask_fraction:.3f} (core {float((core & ~protect & ~erased).mean()):.3f}, lobe {float((lobe & dark & ~protect & ~erased).mean()):.3f}, "
        f"erased-dark {float(erased_mask.mean()):.3f} of erased {float(erased.mean()):.3f}, "
        f"region {float(region.mean()):.3f})  {time.time() - t0:.0f}s")

    # 3. Ground colour from the final clean set, then texture.
    # Lit ground only: 2 px clear of the fill (crown edges, JPEG ringing) and not darkish (sky-lit shade
    # is bluer and greyer than the lit grass beside it).
    lit = base_clean & ~cv2.dilate(region.astype("uint8"), np.ones((5, 5), "uint8")).astype(bool) \
        & (lum >= (goal0 @ LUM) * (1 - DARK_MARGIN / 2))
    goal, class_means = ground_colour(img, lit, target, res)
    # Texture windows: 2 px clear of the fill and with no dark pixel (a shrub under 3 m, a crown's edge
    # shadow), or quilting repeats those as dark crescents across the fill.
    clean = base_clean & ~cv2.dilate(region.astype("uint8"), np.ones((5, 5), "uint8")).astype(bool) & ~dark
    windows = _windows(clean, target, img)
    log(f"  clean {clean.mean():.3f}, windows {({CLASSES[c]: len(w['corners']) for c, w in windows.items()})}  {time.time() - t0:.0f}s")
    seed = int.from_bytes(tile.tile_id.encode(), "little") % (2**32)
    synth, qstats = quilt(img, region, target, ~protect, goal, windows, np.random.default_rng(seed + 7))
    log(f"  quilted {qstats}  {time.time() - t0:.0f}s")

    # 4. Low frequencies of the fill -> the ground colour.
    rw = region.astype("float32")
    low = cv2.GaussianBlur(synth * rw[..., None], (0, 0), LOW_SIGMA_PX) / \
        np.maximum(cv2.GaussianBlur(rw, (0, 0), LOW_SIGMA_PX), 1e-4)[..., None]
    fill = synth * np.clip(goal / np.maximum(low, 1.0), 0.5, 2.0)
    out = img.astype("float32") * (1 - alpha[..., None]) + fill * alpha[..., None]
    out[protect] = img[protect]
    # Minor pavement: erase_imagery faded it 70% toward the ground within 40 m, which under a stand was
    # canopy; the same 70% of the change in that ground moves it onto the new ground. Kept roads stay.
    kept = _kept_pavement(tile, (n, n), tr)
    minor = aux["pavement"] & ~kept
    if minor.any():
        r = max(3, int(round(40.0 / res)))
        w = ((roads == 0) & ~erased).astype("float32")
        den = np.maximum(cv2.blur(w, (2 * r + 1, 2 * r + 1)), 1e-3)[..., None]
        g_old = cv2.blur(img.astype("float32") * w[..., None], (2 * r + 1, 2 * r + 1)) / den
        g_new = cv2.blur(out * w[..., None], (2 * r + 1, 2 * r + 1)) / den
        out[minor] += 0.7 * (g_new[minor] - g_old[minor])
    out = out.clip(0, 255).round().astype("uint8")

    path = tile.path("client/texture_ground.jpg")
    Image.fromarray(out).save(path, quality=88)
    mpath = tile.path("client/texture_ground_mask.png")
    m = cv2.resize(alpha, (1000, 1000), interpolation=cv2.INTER_AREA)
    Image.fromarray((m * 255).round().astype("uint8")).save(mpath, optimize=True)
    elapsed = time.time() - t0

    parts = {"kept_pavement": kept & aux["pavement"], "water": aux["water"] & ~aux["pavement"]}
    checks = run_checks(img, out, region, mask, protect, parts, lit, target, canopy, goal, seed)
    ch = erased & (np.abs(out.astype("int16") - img).max(-1) > 0)
    checks["erased_built"] = {"fraction_of_tile": round(float(erased.mean()), 4),
                              "share_changed": round(float(ch.sum() / max(erased.sum(), 1)), 3),
                              "lum_changed_before": round(float(lum[ch].mean()), 1) if ch.any() else None,
                              "lum_changed_after": round(float((out[ch].astype("float32") @ LUM).mean()), 1) if ch.any() else None}
    checks["minor_pavement"] = {"fraction_of_tile": round(float(minor.mean()), 4),
                                "lum_before": round(float(lum[minor].mean()), 1) if minor.any() else None,
                                "lum_after": round(float((out[minor].astype("float32") @ LUM).mean()), 1) if minor.any() else None}
    peak_gb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1 << 30 if sys.platform == "darwin" else 1 << 20)
    year = tags.get("WE_NAIP_YEAR")
    info = {
        "client.texture_ground": {
            "path": "client/texture_ground.jpg", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": n, "resolution_m": res, "source": tags.get("WE_SOURCE", "pc_naip"),
            "derived_from": ["client.texture_imagery", "imagery.naip", "vegetation.chm_1m", "vegetation.habitat",
                             "vegetation.habitat_present", "vegetation.evt", "footprint.mask", "client.roads",
                             "client.channel_profile"],
            "mask_fraction": round(mask_fraction, 4), "filled_fraction": round(float(region.mean()), 4),
            "erased_dark_fraction": round(float(erased_mask.mean()), 4),
            "sun": sun, "naip_date": date,
            "method": (f"crowns (CHM >= {TALL_M:g} m over >= {TALL_SHARE:g} of a pixel, +1 px) and their shadow lobes "
                       f"(h cot(sun elevation) toward azimuth + 180, +-{FAN_DEG:g} deg, sun hour fitted per 5 km quadrant, "
                       f"kept where {DARK_MARGIN:.0%} darker than clean ground of the class), +{GROW_PX} px of dark "
                       f"neighbours, +1 px feather; filled by quilting {PATCH} px patches from the nearest clean windows "
                       f"of the habitat class, low frequencies (sigma {LOW_SIGMA_PX * res:g} m) set to a multi-scale "
                       f"normalised convolution of the class's clean ground ({', '.join(f'{s:g}' for s in SCALES_M)} m)"),
            "class_clean_means": class_means, "synthesis": qstats,
            "encoding": f"NAIP {year + ' ' if year else ''}RGB as client.texture_imagery with tree crowns and their "
                        "shadows replaced by synthesized ground of the same class and season; JPEG q88",
        },
        "client.texture_ground_mask": {
            "path": "client/texture_ground_mask.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": 1000, "resolution_m": TILE_SIZE_M / 1000, "derived_from": ["client.texture_ground"],
            "encoding": "8-bit grey, row 0 north: share of the 10 m pixel replaced in client/texture_ground.jpg "
                        "(255 all filled, 0 all photo; the 1 px feather counts half)",
        },
        "checks": checks, "seconds": round(elapsed), "peak_memory_gb": round(peak_gb, 2),
    }
    if sheet_dir is not None:
        info["sheet"] = comparison_sheet(tile, img, out, mask, core, target, sheet_dir)
    return info


# ----------------------------------------------------------------------------------------------- checks

def run_checks(img, out, region, mask, protect, parts, clean, target, canopy, goal, seed) -> dict:
    f, o = img.astype("float32"), out.astype("float32")
    rng = np.random.default_rng(seed)
    n = img.shape[0]
    # 200 random tall-CHM pixels inside the mask (away from the tile edge)
    ys, xs = np.nonzero(canopy & mask)
    keep = (ys > 3) & (ys < n - 4) & (xs > 3) & (xs < n - 4)
    ys, xs = ys[keep], xs[keep]
    pick = rng.choice(len(ys), size=min(200, len(ys)), replace=False)
    ys, xs = ys[pick], xs[pick]
    lum_o, lum_i = o @ LUM, f @ LUM

    def local_std(l, y, x):
        return np.array([l[a - 2:a + 3, b - 2:b + 3].std() for a, b in zip(y, x)])

    cmeans, cstd, cvar5 = {}, {}, {}
    for c in np.unique(target):
        sel = clean & (target == c)
        if sel.sum() < 500:
            continue
        cmeans[int(c)] = f[sel].mean(0)
        cstd[int(c)] = float(lum_i[sel].std())
        inner = sel & (cv2.erode(clean.astype("uint8"), np.ones((5, 5), "uint8")) > 0)
        if inner.sum() >= 200:
            sel = inner
        cy, cx = np.nonzero(sel & (np.arange(n)[:, None] > 3) & (np.arange(n)[:, None] < n - 4)
                            & (np.arange(n)[None, :] > 3) & (np.arange(n)[None, :] < n - 4))
        q = rng.choice(len(cy), size=min(2000, len(cy)), replace=False)
        cvar5[int(c)] = float(np.median(local_std(lum_i, cy[q], cx[q])))
    cls = target[ys, xs]
    ok = np.array([int(c) in cmeans for c in cls])
    d_class = np.array([float(np.abs(o[y, x] @ LUM - cmeans[int(c)] @ LUM)) / cstd[int(c)] if int(c) in cmeans else np.nan
                        for y, x, c in zip(ys, xs, cls)])
    before_z = np.array([float(np.abs(f[y, x] @ LUM - cmeans[int(c)] @ LUM)) / cstd[int(c)] if int(c) in cmeans else np.nan
                         for y, x, c in zip(ys, xs, cls)])
    lstd_o = local_std(lum_o, ys, xs)
    lstd_ref = np.array([cvar5.get(int(c), np.nan) for c in cls])
    samples = {
        "n": int(len(ys)),
        "abs_lum_diff_over_class_std_median": round(float(np.nanmedian(d_class)), 2),
        "within_1_std": round(float(np.nanmean(d_class[ok] < 1.0)), 3),
        "within_2_std": round(float(np.nanmean(d_class[ok] < 2.0)), 3),
        "before_within_1_std": round(float(np.nanmean(before_z[ok] < 1.0)), 3),
        "lum_after_minus_class_mean_median": round(float(np.nanmedian(
            [o[y, x] @ LUM - cmeans[int(c)] @ LUM for y, x, c in zip(ys, xs, cls) if int(c) in cmeans])), 1),
        "lum_before_minus_class_mean_median": round(float(np.nanmedian(
            [f[y, x] @ LUM - cmeans[int(c)] @ LUM for y, x, c in zip(ys, xs, cls) if int(c) in cmeans])), 1),
        "local_std_5px_over_clean_median": round(float(np.nanmedian(lstd_o / lstd_ref)), 2),
    }
    unchanged = {k: int((np.abs(o[v] - f[v]).max() if v.any() else 0)) for k, v in parts.items()}
    per_class = {}
    for c, cm in cmeans.items():
        sel = region & (target == c)
        if sel.sum() < 1000:
            continue
        fm = o[sel].mean(0)
        allm = o[(target == c) & ~protect].mean(0)
        per_class[CLASSES[c]] = {
            "clean_mean": [round(float(v), 1) for v in cm], "filled_mean": [round(float(v), 1) for v in fm],
            "filled_rel_diff_max": round(float(np.abs(fm / cm - 1).max()), 3),
            "lum_filled_over_clean": round(float((fm @ LUM) / (cm @ LUM)), 3),
            "lum_unprotected_after_over_clean": round(float((allm @ LUM) / (cm @ LUM)), 3),
            "filled_px": int(sel.sum())}
    rip = CODES["riparian"]
    riparian = None
    if rip in cmeans and CODES["grassland"] in cmeans and (region & (target == rip)).sum() > 1000:
        fm = o[region & (target == rip)].mean(0)
        riparian = {"filled_mean": [round(float(v), 1) for v in fm],
                    "dist_to_riparian_clean": round(float(np.linalg.norm(fm - cmeans[rip])), 1),
                    "dist_to_grassland_clean": round(float(np.linalg.norm(fm - cmeans[CODES["grassland"]])), 1)}
    return {"tall_samples": samples, "protected_max_abs_change": unchanged, "classes": per_class, "riparian": riparian}


# ------------------------------------------------------------------------------------------- comparison

def comparison_sheet(tile: Tile, before, after, mask, core, target, out_dir: Path, size_m=1600.0, scale=0.5) -> dict:
    n = before.shape[0]
    res = TILE_SIZE_M / n
    w = int(round(size_m / res))
    wins = [((x / res), ((TILE_SIZE_M - y) / res), label) for x, y, label in SHEET_WINDOWS.get(tile.tile_id, [])]
    def share(binary):
        """Share of `binary` in each 1.6 km window on a 400 m grid: [(share, col, row)]."""
        s = cv2.integral(binary.astype("uint8"))
        return [((s[r0 + w, c0 + w] - s[r0, c0 + w] - s[r0 + w, c0] + s[r0, c0]) / (w * w), c0 + w / 2, r0 + w / 2)
                for r0 in range(0, n - w + 1, 160) for c0 in range(0, n - w + 1, 160)]
    if len(wins) < 2:                     # no hand-picked windows: open savanna and the densest canopy
        cov = share(core)
        v, c, r = min(cov, key=lambda t: abs(t[0] - 0.4))
        wins.append((c, r, f"savanna ({v:.0%} canopy)"))
        v, c, r = max(cov)
        wins.append((c, r, f"densest canopy ({v:.0%})"))
    v, c, r = max(share(target == CODES["riparian"]))
    wins.append((c, r, f"riparian ({v:.0%} of window)"))
    overlay = before.astype("float32").copy()
    lobe_part = mask & ~core
    overlay[core & mask] = overlay[core & mask] * 0.35 + np.float32([230, 40, 200]) * 0.65
    overlay[lobe_part] = overlay[lobe_part] * 0.35 + np.float32([40, 200, 230]) * 0.65
    overlay = overlay.astype("uint8")
    p = int(w * scale)
    gap, cap = 6, 24
    sheet = Image.new("RGB", (3 * p + 2 * gap, 3 * (p + cap) + 2 * gap), (240, 240, 236))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except OSError:
        font = ImageFont.load_default()
    placed = []
    for i, (col, row, label) in enumerate(wins[:3]):
        c0 = int(np.clip(round(col - w / 2), 0, n - w))
        r0 = int(np.clip(round(row - w / 2), 0, n - w))
        y = i * (p + cap + gap)
        for j, (arr, name) in enumerate(((before, "texture_imagery"), (overlay, "mask: CHM (magenta), dark (cyan)"),
                                         (after, "texture_ground"))):
            crop = Image.fromarray(arr[r0:r0 + w, c0:c0 + w]).resize((p, p), Image.LANCZOS)
            sheet.paste(crop, (j * (p + gap), y + cap))
            draw.text((j * (p + gap) + 4, y + 4), f"{label} - {name}" if j == 0 else name, fill=(20, 24, 22), font=font)
        placed.append({"label": label, "x_m": round((c0 + w / 2) * res), "north_m": round(TILE_SIZE_M - (r0 + w / 2) * res)})
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{tile.tile_id}_sheet.png"
    sheet.save(path, optimize=True)
    return {"path": str(path), "windows": placed, "panel_scale": scale}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tiles", nargs="+")
    ap.add_argument("--sheet", type=Path, default=None, help="write a before / mask / after sheet into this directory")
    a = ap.parse_args(argv)
    for tid in a.tiles:
        log(tid)
        info = inpaint_crowns(Tile.from_id(tid), a.sheet)
        print(json.dumps(info, indent=1, default=str), flush=True)


if __name__ == "__main__":
    sys.exit(main())
