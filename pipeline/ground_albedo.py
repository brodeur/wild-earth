"""The ground at its measured reflectance: the factor from the ground texture's display colour to surface reflectance.

The client draws the ground (and the herb layer tuned to match it: grass blades, the sward sheets and paint, forbs,
litter) with the base texture's colour as albedo. That colour is a display value, not a reflectance: NAIP's digital
numbers on US tiles (each state's acquisition balanced for viewing), and on the world tiles the Sentinel-2 composite
stretched for viewing (fetch_global.sentinel_true_colour: sRGB of 2.5 x reflectance). The fair judge
(tools/probes/sheet.py) showed open ground drawn 12-20 L* brighter than its reflectance, the closed canopies (lit from
their own leaf colours) within 2 (docs/decisions.md, 2026-11-06 iterations 3-4).

The rule, the same on every tile: the factor per channel is the ratio of the open ground's mean surface reflectance in
the Sentinel-2 L2A composite of the reference month to its mean albedo in the texture (linear light, the texture
averaged onto the composite's 20 m pixels), over every open pixel:

    gain_c = sum(reflectance_c) / sum(texture_linear_c)

The reference month is the one the client's season multiplier is relative to (season.js SeasonColour: the NAIP flight
month, seasons.s2_monthly naip_reference, else July), so after the season multiplier for any date the ground's mean is
that month's composite. Open: tree cover under 10 %, shrub cover under 15 % (client/canopy.png), not water, built or
nodata (client/habitat.png 7, 9, 0), no clipped pixel in either (composite byte 255 or 0, texture byte 250 and up).

The composite is read from seasons/s2_MM.tif (float reflectance) where present, else from the client sheet
client/season_rgb.png (255 sRGB(reflectance / 0.35)). A tile with fewer than MIN_OPEN open pixels, or without the
seasons layers, takes the fit of the nearest tile with the same imagery source and year (a NAIP state acquisition is
processed and balanced as one), else the median of that source's fits, else the encoding's own stretch for a
Sentinel-2 texture (0.4). On a Sentinel-2 tile the fit differs from 0.4 by the reference month against the texture's
three-year median: the fit is the one the season multiplier needs.

The saturation (2026-11-06, iteration 9): the client draws the luminance factor (Aaron chose today's hue: the
per-channel factor turned the home foothills red-brown), so the ground keeps the photo's colour balance, and NAIP's is
more saturated than the ground: Lamar's top-down rendered at chroma 21.3 against a fair 14.6. The saturation is the
ratio of the composite's chroma strength to the photo's (each colour less its luminance, after the luminance factor;
linear, Rec. 601 weights as the client's), summed over the same open pixels:

    saturation = sum |d_R| / sum |d_T|,   d = colour - luminance

The client scales the photo's chroma by it about the luminance, so the hue stays the photo's and only the strength is
fitted. (The least-squares projection of d_R on d_T, `saturation_fit`, also counts the hue's disagreement: on the Hoh,
whose open ground is 1 % river bars, it was 0.26 against a strength ratio of 0.98, and would have greyed a whole rain
forest tile.) Capped at 1 (SAT_MAX): every probe renders at or above its fair chroma, and a gain would amplify the
photo's noise. A tile that borrows its gain borrows its saturation.

Output: client/ground_albedo.json and the manifest layer `client.ground_albedo` (gain inline: the client reads it from
the manifest), with the basis, the reference, the open pixel count, the luminance gain and the spread of the per-pixel
ratios.

    python -m pipeline.ground_albedo utm10n_680_4280 [tile ...]     # write it into built tiles (fits first, then the rest)
"""
from __future__ import annotations

import json
import math
import sys

import numpy as np
from PIL import Image

from .config import TILES_DIR, Tile, read_json, write_json

MIN_OPEN = 500                      # open 20 m pixels (20 ha) for a fit of its own
OPEN_TREE, OPEN_SHRUB = 10, 15      # cover % under which a pixel is open ground
EXCLUDE_HABITAT = (0, 7, 9)         # nodata, water, built
S2_STRETCH = 2.5                    # fetch_global.sentinel_true_colour: byte = 255 sRGB(2.5 x reflectance)
SHEET_STRETCH = 0.35                # fetch_sentinel: season_rgb byte = 255 sRGB(reflectance / 0.35)
Y = np.array([0.2126, 0.7152, 0.0722])
Y601 = np.array([0.299, 0.587, 0.114])   # the client's G_LUMA, about which it scales the saturation (terrain.js groundRefl)
SAT_MIN, SAT_MAX = 0.3, 1.0
Image.MAX_IMAGE_PIXELS = None


def _lin(b: np.ndarray) -> np.ndarray:
    x = b.astype("float64") / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def reference_month(m: dict) -> int:
    return (((m["layers"].get("seasons.s2_monthly") or {}).get("naip_reference") or {}).get("month")) or 7


def _composite(tile: Tile, m: dict, month: int, n: int) -> tuple[np.ndarray, np.ndarray, str] | None:
    """(reflectance (n, n, 3), valid (n, n), what) for the month, or None."""
    tif = tile.path(f"seasons/s2_{month:02d}.tif")
    if tif.exists():
        import rasterio
        with rasterio.open(tif) as s:
            a = np.moveaxis(s.read([1, 2, 3]).astype("float64"), 0, -1)
        if a.shape[0] == n:
            ok = np.isfinite(a).all(-1) & (a > 0).all(-1) & (a < SHEET_STRETCH).all(-1)   # the sheet's range, either way
            return np.nan_to_num(a), ok, f"seasons/s2_{month:02d}.tif"
    sr = m["layers"].get("client.season_rgb")
    if not sr or not tile.path(sr["path"]).exists():
        return None
    k = sr.get("layout", {}).get("frame_pixels", 500); cols = sr.get("layout", {}).get("columns", 4)
    r, c = divmod(month - 1, cols)
    b = np.asarray(Image.open(tile.path(sr["path"])).convert("RGB"))[r * k:(r + 1) * k, c * k:(c + 1) * k]
    if k != n:
        return None
    ok = (b.min(-1) > 0) & (b.max(-1) < 255)
    return _lin(b) * SHEET_STRETCH, ok, f"{sr['path']} month {month}"


def fit(tile: Tile, m: dict) -> dict | None:
    """The tile's own fit, or None (no composite, too little open ground)."""
    month = reference_month(m)
    tex_p = tile.path("client/texture_imagery.jpg")
    if not tex_p.exists():
        return None
    tex = np.asarray(Image.open(tex_p).convert("RGB"))
    n = 500
    comp = _composite(tile, m, month, n)
    if comp is None:
        return None
    refl, ok, what = comp
    k = tex.shape[0] // n
    tl = _lin(tex[:n * k, :n * k]).reshape(n, k, n, k, 3).mean(axis=(1, 3))
    clipped = tex[:n * k, :n * k].reshape(n, k, n, k, 3).max(axis=(1, 3)).max(-1) >= 250
    cov = np.asarray(Image.open(tile.path("client/canopy.png")).convert("RGB")).astype("float64")
    hab = np.asarray(Image.open(tile.path("client/habitat.png")).convert("RGB"))[..., 0]
    iy = np.minimum(((np.arange(n) + 0.5) * cov.shape[0] / n).astype(int), cov.shape[0] - 1)
    ix = np.minimum(((np.arange(n) + 0.5) * cov.shape[1] / n).astype(int), cov.shape[1] - 1)
    cv, hb = cov[iy][:, ix], hab[iy][:, ix]
    open_ = ok & ~clipped & (cv[..., 0] < OPEN_TREE) & (cv[..., 1] < OPEN_SHRUB) & ~np.isin(hb, EXCLUDE_HABITAT)
    n_open = int(open_.sum())
    if n_open < MIN_OPEN:
        return {"basis": "too_little_open", "open_pixels": n_open}
    R, T = refl[open_], tl[open_]
    gain = R.sum(0) / T.sum(0)
    ratio_y = (R @ Y) / np.maximum(T @ Y, 1e-4)
    gy = float((R @ Y).sum() / (T @ Y).sum())
    Tg = T * gy
    dR, dT = R - (R @ Y601)[:, None], Tg - (Tg @ Y601)[:, None]
    s_fit = float((dR * dT).sum() / max((dT * dT).sum(), 1e-12))
    s_mag = float(np.linalg.norm(dR, axis=1).sum() / max(np.linalg.norm(dT, axis=1).sum(), 1e-12))
    return {"basis": "fit", "gain": [round(float(g), 4) for g in gain],
            "gain_luminance": round(gy, 4),
            "saturation": round(min(max(s_mag, SAT_MIN), SAT_MAX), 3), "chroma_ratio": round(s_mag, 3),
            "saturation_fit": round(s_fit, 3),
            "reference": what, "reference_month": month, "open_pixels": n_open,
            "open_share": round(n_open / (n * n), 3),
            "ratio_luminance_p25_p50_p75": [round(float(v), 3) for v in np.percentile(ratio_y, [25, 50, 75])],
            "texture_mean_linear": [round(float(v), 4) for v in T.mean(0)],
            "reflectance_mean": [round(float(v), 4) for v in R.mean(0)]}


def _imagery(m: dict) -> tuple[str | None, int | None]:
    nl = m["layers"].get("imagery.naip") or {}
    return nl.get("source"), nl.get("naip_year")


def _centre(tile: Tile) -> tuple[float, float]:
    w, s, e, n = tile.bounds_wgs84
    return (w + e) / 2, (s + n) / 2


def _fitted_others(tile: Tile) -> list[tuple[str, dict, dict]]:
    out = []
    for p in sorted(TILES_DIR.glob("utm*/manifest.json")):
        if p.parent.name == tile.tile_id:
            continue
        try:
            om = read_json(p)
        except Exception:  # noqa: BLE001
            continue
        L = om["layers"].get("client.ground_albedo")
        if L and L.get("basis") == "fit":
            out.append((p.parent.name, om, L))
    return out


def borrowed(tile: Tile, m: dict, why: str) -> dict:
    """The factor for a tile without a fit of its own."""
    src, yr = _imagery(m)
    others = [(t, om, L) for t, om, L in _fitted_others(tile) if _imagery(om) == (src, yr)]
    if others:
        lon, lat = _centre(tile)
        def dist(t):
            olon, olat = _centre(Tile.from_id(t))
            return math.hypot((olon - lon) * math.cos(math.radians(lat)), olat - lat) * 111.0
        t, om, L = min(others, key=lambda x: dist(x[0]))
        return {"basis": "nearest_same_acquisition", "why": why, "from_tile": t, "distance_km": round(dist(t)),
                "gain": L["gain"], "gain_luminance": L["gain_luminance"], "saturation": L.get("saturation", 1.0),
                "imagery": [src, yr]}
    same = [L for t, om, L in _fitted_others(tile) if _imagery(om)[0] == src]
    if same:
        g = np.median(np.array([L["gain"] for L in same]), 0)
        return {"basis": "source_median", "why": why, "tiles": len(same), "gain": [round(float(v), 4) for v in g],
                "gain_luminance": round(float(g @ Y), 4),
                "saturation": round(float(np.median([L.get("saturation", 1.0) for L in same])), 3), "imagery": [src, yr]}
    if src == "sentinel2_l2a":
        g = 1 / S2_STRETCH
        return {"basis": "encoding", "why": why, "gain": [g, g, g], "gain_luminance": g, "imagery": [src, yr]}
    return {"basis": "none", "why": why, "gain": [1.0, 1.0, 1.0], "gain_luminance": 1.0, "imagery": [src, yr]}


def ground_albedo(tile: Tile, m: dict, own_only: bool = False) -> dict | None:
    """The layer info for client.ground_albedo (writes client/ground_albedo.json). own_only: None unless a fit."""
    f = fit(tile, m)
    if f is None or f.get("basis") != "fit":
        if own_only:
            return None
        why = "no Sentinel-2 composite on this tile" if f is None else f"{f['open_pixels']} open pixels (under {MIN_OPEN})"
        f = borrowed(tile, m, why)
    src, yr = _imagery(m)
    if src == "sentinel2_l2a":
        f["encoding_check"] = {"stretch_gain": 1 / S2_STRETCH, "note": "the texture's own encoding (2.5 x the three-year "
                               "median reflectance); the fit also carries the reference month against that median"}
    info = {"path": "client/ground_albedo.json", "kind": "table", "derived_from":
            ["client.texture_imagery", "client.season_rgb", "client.canopy", "client.habitat"],
            "encoding": "gain: per channel (linear R G B) the factor from the ground texture's linear colour to surface "
                        "reflectance; the client multiplies the ground and the herb layer's albedo by it (by its "
                        "luminance, gain_luminance, by default); saturation: the chroma scale about the luminance "
                        "(Rec. 601) that the client applies with the luminance factor",
            "method": "sum of the reference month's L2A reflectance over the sum of the texture's linear colour, open "
                      f"ground (tree < {OPEN_TREE} %, shrub < {OPEN_SHRUB} %, not water or built), 20 m",
            "imagery": {"source": src, "year": yr}, **f}
    write_json(tile.path(info["path"]), {k: v for k, v in info.items() if k not in ("path", "kind")})
    return info


def main(argv: list[str]) -> None:
    from .manifest import add_layer, load_manifest, save
    tiles = [Tile.from_id(t) for t in argv]
    # fits first, so a tile that borrows finds its neighbours' fits
    for own_only in (True, False):
        for t in tiles:
            m = load_manifest(t)
            if not own_only and (m["layers"].get("client.ground_albedo") or {}).get("basis") == "fit":
                continue
            info = ground_albedo(t, m, own_only=own_only)
            if info is None:
                continue
            m = load_manifest(t)   # read again just before writing: other lanes write manifests too
            add_layer(m, t, "client.ground_albedo", info, fetched=False)
            save(t, m)
            print(t.tile_id, info["basis"], info["gain"], info.get("gain_luminance"), info.get("from_tile", ""))


if __name__ == "__main__":
    main(sys.argv[1:])
