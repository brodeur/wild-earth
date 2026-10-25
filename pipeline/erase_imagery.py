"""Erase humans from the NAIP imagery: the client's "Imagery" base texture.

Present-day NAIP is real and beautiful but full of buildings, lots, lawns, fields and a
quarry. The premise is the world with no humans, with roads kept as decayed pavement, so:

1. Erase mask = OSM footprint features of every class but `road` (buffered by buffer_m, plus
   12 m around buildings for yards, driveways and lots) united with LANDFIRE human cells
   (lawns and lots OSM lacks), minus road pavement. Only the densely built and farmed
   cells (medium and high intensity, agriculture, quarries) are erased whole. The rest of
   LANDFIRE's "human" cells (low intensity, Developed-Roads, and developed or urban forest,
   shrubland and herbaceous) are mostly real oaks and dry grass at 2.5 m, so there only the
   pixels that look built (grey roofs, concrete, gravel, pools, watered lawn) are erased.
2. Small or thin mask components are inpainted from their surroundings (cv2 Telea). Large
   ones are synthesized by image quilting: 32 px patches copied out of clean imagery of the same
   backfilled habitat class elsewhere in the tile, each patch's mean colour matched to the
   clean pixels around it so the new woodland takes on the local brightness.
3. Pavement is bleached toward sun-bleached grey and desaturated (decayed asphalt).

Everything runs on the NAIP grid (2.5 m, 4000 px) and is vectorised per patch.
"""
from __future__ import annotations

import json

import cv2
import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from .config import TILE_SIZE_M, Tile
from .habitat import CLASSES, CODES

Image.MAX_IMAGE_PIXELS = None

BUILDING_EXTRA_M = 12.0       # yards, driveways and lots around a building footprint
SMALL_AREA_M2 = 400.0         # components under this are inpainted (Telea smears anything much bigger)
THIN_DIST_M = 5.0             # ... and so are components whose interior is never deeper than this
INPAINT_RADIUS_PX = 5
PATCH = 32                    # synthesis patch (px)
OVERLAP = 8                   # overlap the min-error seam runs through (px)
LOCAL_M = 100.0               # radius for the local colour target
WIDE_M = 400.0                # fallback radius when a big hole has no clean pixels within LOCAL_M
CORRECTION = 0.25             # clamp of the per-channel mean-colour correction
HUE_SLACK = 0.08              # per-channel freedom around the brightness gain
CLASS_SHARE = 0.5             # a source window counts for a class when at least this share is that class
CANDIDATES = 32               # random source windows considered per patch
BAND = 0.05                   # ... drawn from this share of the class's windows nearest the local brightness
GRAIN_SIGMA_PX = 3.0          # inpainted fills get the synthesized texture's detail finer than this
PAVEMENT = 140                # roads.png weight above which a pixel is pavement
# LANDFIRE EVT physiognomies whose 30 m cells are erased whole. Every other "human" EVT
# (Developed-Low Intensity, Developed-Roads, and phys "Developed": developed and urban forest,
# shrubland, herbaceous) is erased only where the photo looks built. Those cells are 31% of
# utm10n_680_4280 and mostly natural woodland; erasing them whole sent 27% of the tile through
# patch synthesis and replaced real blue oak savanna with dense-stand patches.
FULL_ERASE_PHYS = ("Developed-Medium Intensity", "Developed-High Intensity", "Agricultural", "Quarries")
BUILT_SAT = 0.13              # saturation under which a not-dark pixel is roof, concrete, asphalt or gravel
BUILT_MIN_LUM = 70            # ... darker neutral pixels are shade under canopy
DECAYED_GREY = np.float32([170, 164, 154])
# Fallback when a class has no clean source windows: nearest along this order, then by hand.
FALLBACK_ORDER = ["oak_woodland", "mixed_forest", "grassland", "chaparral"]
FALLBACK_EXTRA = {"conifer_forest": ["mixed_forest"], "riparian": ["oak_woodland"],
                  "water": ["grassland"], "barren": ["grassland", "chaparral"]}


def _fallbacks(code: int) -> list[int]:
    order = [CODES[n] for n in FALLBACK_ORDER]
    name = CLASSES.get(code)
    if code in order:
        i = order.index(code)
        rest = sorted((c for c in order if c != code), key=lambda c: (abs(order.index(c) - i), order.index(c)))
        return [code] + rest
    extra = [CODES[n] for n in FALLBACK_EXTRA.get(name, [])]
    return [code] + extra + [c for c in order if c not in extra]


def _footprint_mask(tile: Tile, shape_, tr) -> np.ndarray:
    with open(tile.path("footprint/mask.geojson")) as f:
        fc = json.load(f)
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    res = abs(tr.a)
    shapes = []
    for feat in fc["features"]:
        pr = feat.get("properties") or {}
        klass = pr.get("class")
        if klass == "road":
            continue
        g = shp_transform(to_tile, shape(feat["geometry"]))
        if g.is_empty:
            continue
        buf = float(pr.get("buffer_m") or 0) + (BUILDING_EXTRA_M if klass == "building" else 0)
        if g.geom_type in ("LineString", "MultiLineString", "Point", "MultiPoint") or buf:
            g = g.buffer(max(buf, res / 2))
        if not g.is_empty:
            shapes.append((g, 1))
    if not shapes:
        return np.zeros(shape_, bool)
    return rasterize(shapes, out_shape=shape_, transform=tr, fill=0, dtype="uint8").astype(bool)


def _human_cells(tile: Tile, present: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """LANDFIRE human cells (30 m) split into (whole, partial) by EVT physiognomy: whole cells
    are erased outright, partial ones only where the photo looks built. Without evt.tif and its
    class table every human cell is whole (the old behaviour)."""
    human = present == CODES["human"]
    try:
        with rasterio.open(tile.path("vegetation/evt.tif")) as src:
            evt = src.read(1)
        with open(tile.path("vegetation/classes.json")) as f:
            meta = json.load(f)["evt"]
    except (OSError, KeyError, ValueError, rasterio.errors.RasterioIOError):
        return human, np.zeros_like(human)
    if evt.shape != present.shape:
        return human, np.zeros_like(human)
    full_codes = [int(k) for k, v in meta.items() if str(v.get("phys", "")).startswith(FULL_ERASE_PHYS)]
    whole = human & np.isin(evt, full_codes)
    return whole, human & ~whole


def _built_pixels(img: np.ndarray) -> np.ndarray:
    """Pixels that look built rather than grown: neutral grey or white and not in shade (roofs,
    concrete, asphalt, gravel lots), blue (pools, tarps), or irrigated green. Natural summer ground
    here is green-dominant canopy or tan dry grass, both well above BUILT_SAT. Specks are dropped
    and the rest grown by one pixel so roof edges and their halo go too."""
    f = img.astype("float32")
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mx = f.max(-1)
    sat = (mx - f.min(-1)) / np.maximum(mx, 1.0)
    built = ((sat < BUILT_SAT) & (lum > BUILT_MIN_LUM)) | ((b > g) & (b > r + 8) & (lum > 60)) | _irrigated(img)
    built = cv2.morphologyEx(built.astype("uint8"), cv2.MORPH_OPEN, np.ones((2, 2), "uint8"))
    return cv2.dilate(built, np.ones((3, 3), "uint8")).astype(bool)


def _upsample_nearest(arr: np.ndarray, n: int) -> np.ndarray:
    return np.asarray(Image.fromarray(arr.astype("uint8"), "L").resize((n, n), Image.NEAREST))


def _irrigated(img: np.ndarray) -> np.ndarray:
    """Bright, distinctly green pixels: watered lawn and pasture in summer imagery (natural
    canopy is darker, dry grass is tan)."""
    r, g, b = (img[..., i].astype("int16") for i in range(3))
    return (g > r + 12) & (g > b + 20) & ((r * 299 + g * 587 + b * 114) // 1000 > 95)


def _source_windows(clean: np.ndarray, cls: np.ndarray, img: np.ndarray, stride=8) -> dict[int, np.ndarray]:
    """Per class, top-left corners (y, x) of PATCH windows that are wholly clean and mostly that class.

    "Mostly" (CLASS_SHARE) rather than "wholly": an 80 m window that is all one 30 m class is rare
    once houses are masked out (84 distinct places for oak woodland in utm10n_680_4280, all dense
    stands), and synthesizing a town from so few repeats them visibly.

    Windows more than 15% irrigated green (lawn, pasture: bright and greener than natural summer
    canopy) are left out; in July nothing unwatered in the foothills is that colour."""
    n = clean.shape[0]
    ys = np.arange(0, n - PATCH + 1, stride)
    yy, xx = np.meshgrid(ys, ys, indexing="ij")
    yy, xx = yy.ravel(), xx.ravel()

    def box_sum(binary):
        s = cv2.integral(binary.astype("uint8"))      # (n+1, n+1), int32
        return s[yy + PATCH, xx + PATCH] - s[yy, xx + PATCH] - s[yy + PATCH, xx] + s[yy, xx]

    full = PATCH * PATCH
    ok = (box_sum(clean) == full) & (box_sum(_irrigated(img)) <= 0.15 * full)
    out = {}
    for c in np.unique(cls):
        sel = ok & (box_sum(cls == c) >= CLASS_SHARE * full)
        if sel.any():
            out[int(c)] = np.stack([yy[sel], xx[sel]], axis=1)
    return out


def _local_mean(img: np.ndarray, clean: np.ndarray, radius_px: int):
    """Mean colour of clean pixels in a (2r+1)^2 box, and the clean fraction there."""
    k = (2 * radius_px + 1, 2 * radius_px + 1)
    w = clean.astype("float32")
    frac = cv2.blur(w, k, borderType=cv2.BORDER_REFLECT)
    s = cv2.blur(img.astype("float32") * w[..., None], k, borderType=cv2.BORDER_REFLECT)
    mean = s / np.maximum(frac, 1e-6)[..., None]
    return mean, frac


def _window_means(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    s = cv2.integral(img)                                   # (n+1, n+1, 3) int32 sums
    y, x = corners[:, 0], corners[:, 1]
    tot = s[y + PATCH, x + PATCH] - s[y, x + PATCH] - s[y + PATCH, x] + s[y, x]
    return tot.astype("float32") / (PATCH * PATCH)


def _gain(mean: np.ndarray, goal: np.ndarray) -> np.ndarray:
    """Per-channel gain (K, 3) taking window means toward the local mean: brightness clamped to
    +/-CORRECTION, and each channel kept within +/-HUE_SLACK of that brightness gain, so a dark
    oak crown next to dry grass is lit like its neighbours without turning lime or tan."""
    lum = np.float32([0.299, 0.587, 0.114])
    b = np.clip((goal @ lum) / np.maximum(mean @ lum, 1.0), 1 - CORRECTION, 1 + CORRECTION)[:, None]
    return np.clip(goal / np.maximum(mean, 1.0), b * (1 - HUE_SLACK), b * (1 + HUE_SLACK)).astype("float32")


def _seam(cost: np.ndarray) -> np.ndarray:
    """Minimum-cost vertical path through `cost` (h, w): the column index per row (image quilting)."""
    h, w = cost.shape
    m = cost.copy()
    inf = np.full(1, np.inf, cost.dtype)
    for i in range(1, h):
        prev = m[i - 1]
        m[i] += np.minimum(np.minimum(np.concatenate([inf, prev[:-1]]), prev), np.concatenate([prev[1:], inf]))
    path = np.empty(h, int)
    j = int(m[-1].argmin())
    path[-1] = j
    for i in range(h - 2, -1, -1):
        lo, hi = max(j - 1, 0), min(j + 2, w)
        j = lo + int(m[i, lo:hi].argmin())
        path[i] = j
    return path


def _synthesize(img: np.ndarray, region: np.ndarray, target: np.ndarray, windows: dict, clean: np.ndarray,
                rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, int]:
    """Texture for every `region` pixel by image quilting from same-class source windows.

    Patches are laid in raster order on a PATCH grid with OVERLAP. For each, CANDIDATES random
    clean windows of the target class are scored by how well they agree with the pixels already
    known under the patch (earlier patches, and the real imagery around the hole) and with the
    mean of clean pixels within 100 m (400 m for big holes); each is first nudged toward that
    mean, clamped to +/-25%. One of the two best is pasted, joined to its left and top
    neighbours along minimum-error seams, so there is no cross-fade to ghost or blur.
    Returns (synth float32 image, placed mask, patch count)."""
    n = img.shape[0]
    res = TILE_SIZE_M / n
    step = PATCH - OVERLAP
    ref = clean & ~_irrigated(img)          # a lawn left outside the mask must not tint the woodland green
    near, near_f = _local_mean(img, ref, int(LOCAL_M / res))
    wide, wide_f = _local_mean(img, ref, int(WIDE_M / res))
    means = {c: _window_means(img, w) for c, w in windows.items()}
    # Windows per class sorted by brightness, so candidates come from ground that already looks like
    # the local ground (savanna for savanna, closed canopy for closed canopy) and the gain stays
    # small. Uniform draws mostly found dense stands, which the gain then lit up to +35% next to
    # dry grass: a flat, washed-out green.
    lumw = np.float32([0.299, 0.587, 0.114])
    by_lum = {c: np.argsort(m @ lumw) for c, m in means.items()}
    sorted_lum = {c: (means[c] @ lumw)[o] for c, o in by_lum.items()}
    src = img.astype("float32")

    canvas = src.copy()
    placed = np.zeros((n, n), bool)
    integ = cv2.integral(region.astype("uint8"))
    starts = np.arange(-OVERLAP // 2, n - OVERLAP, step)
    patches, chains = 0, {}
    for y0 in starts:
        for x0 in starts:
            ya, xa, yb, xb = max(y0, 0), max(x0, 0), min(y0 + PATCH, n), min(x0 + PATCH, n)
            if integ[yb, xb] - integ[ya, xb] - integ[yb, xa] + integ[ya, xa] == 0:
                continue
            reg = region[ya:yb, xa:xb]
            # Target class: majority of the backfilled class over this patch's region pixels.
            c = int(np.bincount(target[ya:yb, xa:xb][reg]).argmax())
            if c not in chains:
                chains[c] = next((k for k in _fallbacks(c) if k in windows), None)
            if chains[c] is None:
                continue
            cand, cmean = windows[chains[c]], means[chains[c]]
            cy, cx = min(y0 + PATCH // 2, n - 1), min(x0 + PATCH // 2, n - 1)
            goal = near[cy, cx] if near_f[cy, cx] > 0.05 else wide[cy, cx] if wide_f[cy, cx] > 0.02 else None

            if goal is None:
                pick = rng.integers(len(cand), size=CANDIDATES)
            else:
                k = chains[c]
                half = max(CANDIDATES * 2, int(BAND * len(cand) / 2))
                i = int(np.searchsorted(sorted_lum[k], float(goal @ lumw)))
                lo = int(np.clip(i - half, 0, max(len(cand) - 2 * half, 0)))
                pick = by_lum[k][lo + rng.integers(min(2 * half, len(cand) - lo), size=CANDIDATES)]
            gain = _gain(cmean[pick], goal) if goal is not None else np.ones((len(pick), 3), "float32")
            dy, dx = np.arange(ya - y0, yb - y0), np.arange(xa - x0, xb - x0)
            ys = cand[pick, 0][:, None] + dy[None, :]
            xs = cand[pick, 1][:, None] + dx[None, :]
            cands = src[ys[:, :, None], xs[:, None, :]] * gain[:, None, None, :]      # (K, h, w, 3)
            win = canvas[ya:yb, xa:xb]
            known = ~reg | placed[ya:yb, xa:xb]
            score = np.zeros(len(pick), "float32")
            if known.any():
                score += np.sqrt(((cands[:, known] - win[known]) ** 2).mean((1, 2)))
            if goal is not None:
                score += np.abs(cmean[pick] - goal).mean(1)        # prefer windows that already look local
            best = np.argsort(score)[:2]
            patch = cands[best[rng.integers(len(best))]]

            # Seams against what is already there, through the left and top overlaps.
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
    return canvas, placed, patches


def _edge_alpha(m: np.ndarray, grow: int) -> tuple[np.ndarray, np.ndarray]:
    """Grow a mask by `grow` px; alpha 1 inside, falling to 0 at the grown edge (~0.5 on the original edge)."""
    region = cv2.dilate(m.astype("uint8"), np.ones((2 * grow + 1, 2 * grow + 1), "uint8"))
    d = cv2.distanceTransform(region, cv2.DIST_L2, 5)
    return region.astype(bool), np.clip(d / (2 * grow), 0, 1)


KEPT_ROADS = ("motorway", "trunk", "primary", "secondary", "tertiary")   # still pavement after ten years
MINOR_FADE = 0.7              # how far minor pavement is blended toward the surrounding ground


def _kept_pavement(tile: Tile, shape_, tr) -> np.ndarray:
    """Pavement of roads that survive as roads (highways and county roads), on the NAIP grid."""
    from .derive import DECAY_HALF_WIDTH
    p = tile.dir / "footprint/mask.geojson"
    if not p.exists():
        return np.zeros(shape_, bool)
    with open(p) as f:
        fc = json.load(f)
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    shapes = []
    for feat in fc["features"]:
        pr = feat.get("properties") or {}
        hw = (pr.get("highway") or "").removesuffix("_link")
        if pr.get("class") != "road" or hw not in KEPT_ROADS:
            continue
        g = shp_transform(to_tile, shape(feat["geometry"]))
        if not g.is_empty:
            shapes.append((g.buffer(DECAY_HALF_WIDTH.get(pr.get("highway"), 4)), 1))
    if not shapes:
        return np.zeros(shape_, bool)
    return rasterize(shapes, out_shape=shape_, transform=tr, fill=0, dtype="uint8").astype(bool)


def _bleach_roads(img: np.ndarray, pave: np.ndarray, kept: np.ndarray, clean: np.ndarray, res: float) -> np.ndarray:
    """Decayed asphalt. Highways and county roads keep their pavement: desaturated and blended
    50% toward sun-bleached grey. Residential streets, service roads and tracks are mostly gone
    under grass: blended toward the surrounding ground, with a faint trace left."""
    out = img.astype("float32")
    px = out[pave]
    lum = px @ np.float32([0.299, 0.587, 0.114])
    bleached = (px * 0.4 + lum[:, None] * 0.6) * 0.5 + DECAYED_GREY * 0.5
    out[pave] = bleached
    minor = pave & ~kept
    if minor.any():
        r = max(3, int(round(40.0 / res)))
        w = clean.astype("float32")
        num = cv2.blur(img.astype("float32") * w[..., None], (2 * r + 1, 2 * r + 1))
        den = cv2.blur(w, (2 * r + 1, 2 * r + 1))[..., None]
        ground = np.where(den > 1e-3, num / np.maximum(den, 1e-3), out)
        out[minor] = out[minor] * (1 - MINOR_FADE) + ground[minor] * MINOR_FADE
    return out.clip(0, 255).astype("uint8")


def _comparison(before: np.ndarray, after: np.ndarray, tile: Tile, lon: float, lat: float, path, size_m=1600.0):
    """Side-by-side crop at full resolution: NAIP left, erased right. The window is kept inside the tile."""
    n = before.shape[0]
    res = TILE_SIZE_M / n
    x, y = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform(lon, lat)
    col, row = (x - tile.bounds[0]) / res, (tile.bounds[3] - y) / res
    w = int(round(size_m / res))
    c0 = int(np.clip(round(col - w / 2), 0, n - w))
    r0 = int(np.clip(round(row - w / 2), 0, n - w))
    gap, cap = 4, 22
    canvas = Image.new("RGB", (2 * w + gap, w), (240, 240, 236))
    canvas.paste(Image.fromarray(before[r0:r0 + w, c0:c0 + w]), (0, 0))
    canvas.paste(Image.fromarray(after[r0:r0 + w, c0:c0 + w]), (w + gap, 0))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except OSError:
        font = ImageFont.load_default()
    for x0, text in ((0, "NAIP 2022"), (w + gap, "erased + synthesized")):
        tw = draw.textlength(text, font=font)
        draw.rectangle([x0 + 8, 8, x0 + 8 + tw + 12, 8 + cap], fill=(15, 21, 18))
        draw.text((x0 + 14, 11), text, fill=(230, 237, 231), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, quality=90)
    return {"path": str(path), "window_px": [r0, c0, w], "centre_px": [round(row), round(col)],
            "shifted_m": [round((c0 + w / 2 - col) * res), round((r0 + w / 2 - row) * res)]}


# Comparison views per tile: (lon, lat, file under docs/)
COMPARISONS = {
    "utm10n_680_4280": [(-120.926, 38.666, "compare-shingle-springs.jpg"),
                        (-120.8959, 38.6938, "compare-us50.jpg")],
}


def erase_imagery(tile: Tile) -> dict:
    from .config import REPO_ROOT
    with rasterio.open(tile.path("imagery/naip.tif")) as src:
        naip = np.moveaxis(src.read(indexes=[1, 2, 3]), 0, -1).copy()
        tr = src.transform
    n = naip.shape[0]
    res = abs(tr.a)
    px_area = res * res

    with rasterio.open(tile.path("vegetation/habitat_present.tif")) as src:
        present = src.read(1)
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        backfilled = src.read(1)
    target = _upsample_nearest(backfilled, n)
    whole_cells, partial_cells = _human_cells(tile, present)
    human_whole = _upsample_nearest(whole_cells, n).astype(bool)
    human_built = _upsample_nearest(partial_cells, n).astype(bool) & _built_pixels(naip)
    human = human_whole | human_built
    roads = np.asarray(Image.open(tile.path("client/roads.png")).convert("L").resize((n, n), Image.BILINEAR))
    pave = roads > PAVEMENT

    # a. Erase mask
    mask = (_footprint_mask(tile, (n, n), tr) | human) & ~pave
    mask_fraction = float(mask.mean())

    # b. Components: small or thin ones are inpainted, large ones synthesized.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype("uint8"), connectivity=8)
    dist = cv2.distanceTransform(mask.astype("uint8"), cv2.DIST_L2, 5)
    on = labels > 0
    maxd = np.zeros(count, "float32")
    np.maximum.at(maxd, labels[on], dist[on])
    area_m2 = stats[:, cv2.CC_STAT_AREA] * px_area
    is_big = (area_m2 >= SMALL_AREA_M2) & (maxd * res >= THIN_DIST_M)
    is_big[0] = False
    big = is_big[labels]
    small = mask & ~big

    # Source windows: clean (no mask, no road or verge) and wholly one backfilled class.
    clean = ~mask & (roads == 0)
    windows = _source_windows(clean, target, naip)
    seed = int.from_bytes(tile.tile_id.encode(), "little") % (2**32)
    rng = np.random.default_rng(seed)
    grow = 3
    big_region, big_alpha = _edge_alpha(big, grow)
    small_region, small_alpha = _edge_alpha(small, 2)
    synth, placed, patches = _synthesize(naip, big_region | small_region, target, windows, clean, rng)
    covered = placed[..., None]
    a = np.where(covered, big_alpha[..., None], 0)
    out = (naip.astype("float32") * (1 - a) + synth * a).clip(0, 255).astype("uint8")

    # Inpaint small components last, so they draw on synthesized surroundings too. Telea alone
    # leaves a smooth smear, so the synthesized texture's fine detail (tree crowns, grass grain)
    # is added on top of the inpainted colour.
    if small.any():
        bgr = np.ascontiguousarray(out[..., ::-1])
        bgr = cv2.inpaint(bgr, small.astype("uint8") * 255, INPAINT_RADIUS_PX, cv2.INPAINT_TELEA)
        filled = bgr[..., ::-1].astype("float32")
        grain = synth - cv2.GaussianBlur(synth, (0, 0), GRAIN_SIGMA_PX)
        filled = filled + np.where(covered, grain, 0)
        a = small_alpha[..., None] * small_region[..., None]
        out = (out.astype("float32") * (1 - a) + filled * a).clip(0, 255).astype("uint8")

    # c. Decayed pavement
    kept = _kept_pavement(tile, (n, n), tr)
    out = _bleach_roads(out, pave, kept, clean, res)

    # d. Season reference colours: the imagery's own summer grass and oak, from clean pixels.
    def class_mean(code):
        sel = clean & (target == code)
        return [round(float(v) / 255, 4) for v in out[sel].reshape(-1, 3).mean(0)] if sel.any() else None
    grass_mean, oak_mean = class_mean(CODES["grassland"]), class_mean(CODES["oak_woodland"])

    # e. Texture
    path = tile.path("client/texture_imagery.jpg")
    Image.fromarray(out, "RGB").save(path, quality=88)

    # f. Comparison crops for the docs
    comps = []
    for lon, lat, name in COMPARISONS.get(tile.tile_id, []):
        comps.append(_comparison(naip, out, tile, lon, lat, REPO_ROOT / "docs" / name))
    for c in comps:
        print(f"  comparison {c['path']} window {c['window_px']} shifted {c['shifted_m']} m", flush=True)

    info = {
        "path": "client/texture_imagery.jpg", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
        "pixels": n, "resolution_m": res, "source": "pc_naip",
        "derived_from": ["imagery.naip", "footprint.mask", "vegetation.habitat_present", "vegetation.habitat",
                         "vegetation.evt", "client.roads"],
        "mask_fraction": round(mask_fraction, 4),
        "human_cells": {"whole_fraction": round(float(whole_cells.mean()), 4),
                        "partial_fraction": round(float(partial_cells.mean()), 4),
                        "partial_erased_fraction": round(float(human_built.mean()), 4)},
        "inpainted_fraction": round(float(small.mean()), 4),
        "synthesized_fraction": round(float(big.mean()), 4),
        "components": {"inpainted": int((~is_big[1:]).sum()), "synthesized": int(is_big[1:].sum()), "patches": patches},
        "source_windows": {str(k): int(len(v)) for k, v in windows.items()},
        "grass_mean": grass_mean, "oak_mean": oak_mean,
        "encoding": "NAIP 2022 RGB with human footprint inpainted or synthesized, pavement bleached; JPEG q88",
    }
    print(f"  mask {mask_fraction:.3f}  inpainted {info['inpainted_fraction']:.3f}  "
          f"synthesized {info['synthesized_fraction']:.3f}  patches {patches}  grass {grass_mean}  oak {oak_mean}", flush=True)
    return info
