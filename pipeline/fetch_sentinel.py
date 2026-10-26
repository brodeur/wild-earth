"""Seasons: Sentinel-2 L2A monthly ground colour, measured rather than guessed.

The base texture is one summer NAIP photo; the client used to recolour it by season with a palette
ratio relative to the photo's own grass and oak means (client/src/season.js). This step measures the
colour instead: every Sentinel-2 L2A scene over the tile since 2019 with scene cloud cover under 40%,
cloud, shadow and snow masked by the scene classification, composited per calendar month as the
median surface reflectance over all years (so each month is a typical January, a typical June ...).

Source: Microsoft Planetary Computer's `sentinel-2-l2a` collection (cloud-optimized GeoTIFFs; the
SAS token comes from `planetary_computer.sign`, anonymous, no key). When signing fails the same
scenes come from the AWS open bucket `sentinel-cogs` through Element 84's Earth Search STAC.

Only the tile's window is read from each COG, at 20 m (the 10 m bands' first overview; SCL is native
20 m). The tile grid is Sentinel's own (UTM 10N, pixel edges on multiples of 20 m), so a window read
needs no resampling; a scene in another CRS goes through a WarpedVRT. Each acquisition date's
reflectance and clear mask are cached as a compressed .npz under pipeline/_cache/sentinel/<tile>/looks/
(data only, loaded with allow_pickle=False), so a re-run reads nothing it has.

Products (docs/tile-spec.md, Seasonal colour):
  client/season_rgb.png    12 frames, 4 x 3, 500 px (20 m) each: median R G B surface reflectance,
                           byte = 255 * sRGB_encode(clamp(reflectance / 0.35, 0, 1))
  client/season_ndvi.png   the same layout, grey: byte = 255 * (NDVI + 0.2) / 1.1, clamped
  seasons/s2_<mm>.tif      float32 per month, bands R G B (reflectance) and NDVI; pipeline only
  seasons/months.json      per month: looks per pixel, fill, per-class colour and NDVI means
"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window

from .config import REPO_ROOT, SOURCES, USER_AGENT, Tile, read_json, write_json

PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
ES_STAC = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"
YEARS = (2019, 2026)                 # search range; the layer records the years actually used
MAX_CLOUD = 40                       # scene-level eo:cloud_cover, percent
RES = 20.0                           # metres: the 10 m bands' first overview, SCL's native grid
BANDS = ("B04", "B03", "B02", "B08")  # red, green, blue, nir
ES_ASSETS = {"B04": "red", "B03": "green", "B02": "blue", "B08": "nir", "SCL": "scl"}
SCL_KEEP = (4, 5, 6, 7)              # vegetation, bare soil, water, unclassified
SCL_CLOUD = (3, 8, 9, 10, 11)        # cloud shadow, cloud medium / high, cirrus, snow: dilated
DILATE_PX = 3
STRETCH = 0.35                       # reflectance at byte 255 (before the sRGB curve)
NDVI_RANGE = (-0.2, 0.9)
MIN_LOOKS = 3
COLS, ROWS = 4, 3
CACHE = REPO_ROOT / "pipeline" / "_cache" / "sentinel"
LEGAL = "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice"
LICENCE = ("Copernicus Sentinel data: free, full and open (Legal notice on the use of Copernicus "
           "Sentinel Data and Service Information)")
_YR = f"{YEARS[0]}-{YEARS[1]}"

SOURCES["copernicus_sentinel2_l2a"] = {
    "name": "Copernicus Sentinel-2 Level-2A surface reflectance via Microsoft Planetary Computer",
    "url": f"{PC_STAC}/collections/{COLLECTION}",
    "license": LICENCE, "license_url": LEGAL,
    "attribution": f"Contains modified Copernicus Sentinel data {_YR}, processed by ESA; via Microsoft Planetary Computer",
    "attribution_url": "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
    "attribution_required": True,
}
SOURCES["copernicus_sentinel2_l2a_aws"] = {
    "name": "Copernicus Sentinel-2 Level-2A surface reflectance via AWS Open Data (sentinel-cogs, Earth Search STAC)",
    "url": f"{ES_STAC}/collections/{COLLECTION}",
    "license": LICENCE, "license_url": LEGAL,
    "attribution": f"Contains modified Copernicus Sentinel data {_YR}, processed by ESA; via AWS Open Data and Element 84 Earth Search",
    "attribution_url": "https://registry.opendata.aws/sentinel-2-l2a-cogs/",
    "attribution_required": True,
}

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT,
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MULTIRANGE="YES",
                GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", GDAL_HTTP_MAX_RETRY="5",
                GDAL_HTTP_RETRY_DELAY="2", GDAL_HTTP_TIMEOUT="60", VSI_CACHE="TRUE")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- scenes

def _search(tile: Tile, provider: str) -> list[dict]:
    """Scene records: id, date, mgrs, baseline, cloud, crs, proj bbox, unsigned asset hrefs."""
    import pystac_client
    end = min(date(YEARS[1], 12, 31), datetime.now(timezone.utc).date())
    url = PC_STAC if provider == "pc" else ES_STAC
    cat = pystac_client.Client.open(url)
    s = cat.search(collections=[COLLECTION], bbox=list(tile.bounds_wgs84),
                   datetime=f"{YEARS[0]}-01-01/{end.isoformat()}",
                   query={"eo:cloud_cover": {"lt": MAX_CLOUD}}, max_items=5000)
    out = []
    for it in s.items():
        p = it.properties
        keys = {b: (b if provider == "pc" else ES_ASSETS[b]) for b in (*BANDS, "SCL")}
        if any(k not in it.assets for k in keys.values()):
            continue
        epsg = p.get("proj:epsg") or p.get("proj:code")
        if isinstance(epsg, str):
            epsg = int(epsg.split(":")[-1])
        out.append({
            "id": it.id, "date": it.datetime.date().isoformat(), "datetime": it.datetime.isoformat(),
            "mgrs": p.get("s2:mgrs_tile") or f"{p.get('mgrs:utm_zone')}{p.get('mgrs:latitude_band')}{p.get('mgrs:grid_square')}",
            "baseline": str(p.get("s2:processing_baseline") or ""), "cloud": p.get("eo:cloud_cover"),
            "epsg": epsg, "geometry": it.geometry, "offset_applied": bool(p.get("earthsearch:boa_offset_applied", False)),
            "hrefs": {b: it.assets[k].href for b, k in keys.items()},
        })
    return out


def _dedupe(scenes: list[dict]) -> list[dict]:
    """One record per (date, MGRS tile): the newest processing baseline wins (reprocessed scenes)."""
    best = {}
    for s in scenes:
        k = (s["date"], s["mgrs"])
        if k not in best or s["baseline"] > best[k]["baseline"]:
            best[k] = s
    return sorted(best.values(), key=lambda s: (s["date"], s["mgrs"]))


def _offset(scene: dict) -> int:
    """L2A DN -> reflectance x 10000. Processing baseline 04.00 (2022-01-25) on adds BOA_ADD_OFFSET -1000."""
    if scene["offset_applied"]:
        return 0
    return -1000 if scene["baseline"] >= "04.00" else 0


# ---------------------------------------------------------------- reading one look

def _read_window(href: str, tile: Tile, n: int, overview: int | None, nearest: bool) -> tuple[np.ndarray, int]:
    """The tile's n x n window at RES from one band COG (0 outside the scene), and the compressed
    bytes of the blocks it touches."""
    kw = {"overview_level": overview} if overview is not None else {}
    x0, y0, x1, y1 = tile.bounds
    out = np.zeros((n, n), "uint16")
    nbytes = 0
    with rasterio.open(href, **kw) as src:
        if src.crs and src.crs.to_epsg() == tile.epsg and abs(src.res[0] - RES) < 1e-6:
            col = int(round((x0 - src.transform.c) / RES))
            row = int(round((src.transform.f - y1) / RES))
            c0, r0 = max(col, 0), max(row, 0)
            c1, r1 = min(col + n, src.width), min(row + n, src.height)
            if c1 <= c0 or r1 <= r0:
                return out, 0
            win = Window(c0, r0, c1 - c0, r1 - r0)
            out[r0 - row:r1 - row, c0 - col:c1 - col] = src.read(1, window=win)
            bh, bw = src.block_shapes[0]
            for bi in range(r0 // bh, (r1 - 1) // bh + 1):
                for bj in range(c0 // bw, (c1 - 1) // bw + 1):
                    try:
                        nbytes += src.block_size(1, bi, bj)
                    except Exception:  # noqa: BLE001
                        pass
        else:
            tr = from_bounds(x0, y0, x1, y1, n, n)
            rs = Resampling.nearest if nearest else Resampling.bilinear
            with WarpedVRT(src, crs=tile.crs, transform=tr, width=n, height=n, resampling=rs,
                           src_nodata=0, nodata=0) as vrt:
                out = vrt.read(1)
            nbytes = int(out.size * 2 * 0.6)   # rough: compressed uint16
    return out, nbytes


def _read_scene(scene: dict, tile: Tile, n: int, sign) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """(reflectance x 10000 int16 (4, n, n), clear mask, covered mask, bytes) for one MGRS scene."""
    from scipy import ndimage
    nbytes = 0
    scl, b = _read_window(sign(scene["hrefs"]["SCL"]), tile, n, None, True)
    nbytes += b
    covered = scl > 0
    if not covered.any():
        return np.zeros((4, n, n), "int16"), covered, covered, nbytes
    cloud = np.isin(scl, SCL_CLOUD)
    cloud = ndimage.binary_dilation(cloud, structure=np.ones((3, 3), bool), iterations=DILATE_PX)
    clear = np.isin(scl, SCL_KEEP) & ~cloud
    refl = np.zeros((4, n, n), "int16")
    off = _offset(scene)
    for k, band in enumerate(BANDS):
        dn, b = _read_window(sign(scene["hrefs"][band]), tile, n, 0, False)
        nbytes += b
        clear &= dn > 0
        refl[k] = np.clip(dn.astype("int32") + off, -32000, 32000)
    return refl, clear & covered, covered, nbytes


def _unsigned(href: str) -> str:
    return href


def _signer(provider: str):
    if provider == "pc":
        import planetary_computer
        return planetary_computer.sign
    return _unsigned


def _fetch_date(day: str, scenes: list[dict], tile: Tile, n: int, path: Path, sign) -> dict:
    """Mosaic a date's scenes (first clear wins) and cache it."""
    with rasterio.Env(**GDAL_ENV):
        refl = np.zeros((4, n, n), "int16")
        clear = np.zeros((n, n), bool)
        covered = np.zeros((n, n), bool)
        nbytes = 0
        for sc in scenes:
            r, c, cov, b = _read_scene(sc, tile, n, sign)
            nbytes += b
            take = c & ~clear
            refl[:, take] = r[:, take]
            clear |= take
            covered |= cov
    refl[:, ~clear] = 0
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, refl=refl, clear=clear, covered=covered,
                        scenes=np.array([s["id"] for s in scenes]), nbytes=np.int64(nbytes))
    os.replace(tmp, path)
    return {"date": day, "clear": float(clear.mean()), "bytes": nbytes}


def _load_look(path: Path) -> dict:
    with np.load(path, allow_pickle=False) as z:
        return {"refl": z["refl"], "clear": z["clear"], "covered": z["covered"],
                "scenes": [str(s) for s in z["scenes"]], "bytes": int(z["nbytes"])}


def fetch_looks(tile: Tile, force=False, workers=12) -> tuple[list[Path], dict]:
    """Search, then read every date not yet cached. Returns the cached look paths and run stats."""
    cache = CACHE / tile.tile_id
    looks_dir = cache / "looks"
    looks_dir.mkdir(parents=True, exist_ok=True)
    provider, scenes, errors = None, None, []
    for prov in ("pc", "es"):
        try:
            sign = _signer(prov)
            found = _search(tile, prov)
            if prov == "pc" and found:
                sign(found[0]["hrefs"]["SCL"])     # anonymous token; fails here if a key is demanded
            provider, scenes = prov, found
            break
        except Exception as e:  # noqa: BLE001
            errors.append(f"{prov}: {e}")
            print(f"sentinel search via {prov} failed ({e})", flush=True)
    if scenes is None:
        raise RuntimeError("; ".join(errors))
    write_json(cache / f"scenes_{provider}.json", scenes)
    # Keep scenes whose MGRS footprint overlaps the tile (the WGS84 bbox search also returns the
    # neighbouring MGRS row, which only touches the tile's corner).
    x0, y0, x1, y1 = tile.bounds
    from pyproj import Transformer
    from shapely.geometry import box, shape
    from shapely.ops import transform as shp_transform
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    tile_box = box(x0, y0, x1, y1)

    def overlaps(s):   # the scene's data footprint covers at least 1% of the tile
        if not s.get("geometry"):
            return True
        return shp_transform(to_tile, shape(s["geometry"])).intersection(tile_box).area > 0.01 * tile_box.area
    scenes = [s for s in _dedupe(scenes) if overlaps(s)]
    by_date = defaultdict(list)
    for s in scenes:
        by_date[s["date"]].append(s)
    n = int(round((x1 - x0) / RES))
    sign = _signer(provider)
    todo = [(d, sc) for d, sc in sorted(by_date.items())
            if force or not (looks_dir / f"{d.replace('-', '')}.npz").exists()]
    print(f"sentinel: {len(scenes)} scenes on {len(by_date)} dates via {provider}; {len(todo)} dates to read",
          flush=True)
    t0, done, failed = time.time(), 0, []
    # Processes, not threads: 12 threads managed one date per 15 s (the remote COG opens appear to
    # serialise); 12 processes read one per 2.7 s, bandwidth-bound.
    with ProcessPoolExecutor(workers) as ex:
        futs = {ex.submit(_fetch_date, d, sc, tile, n, looks_dir / f"{d.replace('-', '')}.npz", sign): d
                for d, sc in todo}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception as e:  # noqa: BLE001
                failed.append(f"{futs[f]}: {str(e)[:200]}")
            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)} dates read, {time.time() - t0:.0f}s", flush=True)
    paths = sorted(looks_dir.glob("*.npz"))
    paths = [p for p in paths if not p.name.endswith(".tmp.npz") and p.stem[:4].isdigit()
             and f"{p.stem[:4]}-{p.stem[4:6]}-{p.stem[6:8]}" in by_date]
    return paths, {"provider": provider, "scenes": len(scenes), "dates": len(by_date),
                   "read_now": len(todo) - len(failed), "failed": failed, "read_seconds": round(time.time() - t0, 1)}


# ---------------------------------------------------------------- compositing

def _srgb_encode(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _class_grids(tile: Tile, n: int) -> dict[str, np.ndarray]:
    """Boolean masks on the 20 m grid for the per-class means: present-day habitat (the satellite
    sees what grows now), open grass where lidar tree cover is under 10%."""
    from rasterio.warp import reproject
    x0, y0, x1, y1 = tile.bounds
    tr = from_bounds(x0, y0, x1, y1, n, n)
    out = {}
    hp = tile.dir / "vegetation/habitat_present.tif"
    if not hp.exists():
        return out
    hab = np.zeros((n, n), "uint8")
    with rasterio.open(hp) as src:
        reproject(src.read(1), hab, src_transform=src.transform, src_crs=src.crs, dst_transform=tr,
                  dst_crs=tile.crs, resampling=Resampling.mode)
    names = {1: "oak_woodland", 2: "conifer_forest", 3: "mixed_forest", 4: "chaparral", 5: "grassland",
             6: "riparian"}
    for code, name in names.items():
        out[name] = hab == code
    ch = tile.dir / "vegetation/canopy_height_10m.tif"
    if ch.exists():
        cover = np.zeros((n, n), "float32")
        with rasterio.open(ch) as src:
            reproject(src.read(2).astype("float32"), cover, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=tr, dst_crs=tile.crs, resampling=Resampling.average)
        out["open_grass"] = (hab == 5) & (cover < 10)
    return out


def _naip_reference(tile: Tile) -> dict | None:
    """The NAIP flight dates under the base texture, for comparing its month with the composites."""
    p = tile.dir / "manifest.json"
    year = None
    if p.exists():
        year = read_json(p).get("layers", {}).get("imagery.naip", {}).get("naip_year")
    if not year:
        return None
    try:
        import pystac_client
        cat = pystac_client.Client.open(PC_STAC)
        items = list(cat.search(collections=["naip"], bbox=list(tile.bounds_wgs84),
                                datetime=f"{year}-01-01/{year}-12-31").items())
    except Exception as e:  # noqa: BLE001
        return {"naip_year": year, "error": str(e)[:200]}
    days = sorted({i.datetime.date().isoformat() for i in items})
    months = [int(d[5:7]) for d in days]
    return {"naip_year": year, "flight_dates": days,
            "month": max(set(months), key=months.count) if months else None}


def build_seasons(tile: Tile, force=False) -> dict:
    t_start = time.time()
    paths, run = fetch_looks(tile, force)
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / RES))
    by_month = defaultdict(list)
    for p in paths:
        by_month[int(p.stem[4:6])].append(p)

    comp = np.full((12, 5, n, n), np.nan, "float32")    # R G B NIR-unused NDVI per month
    looks = np.zeros((12, n, n), "int16")
    years_used, scenes_used, nbytes, dates_used = set(), set(), 0, 0
    for m in range(1, 13):
        stack, ndvi = [], []
        for p in by_month.get(m, []):
            lk = _load_look(p)
            nbytes += lk["bytes"]
            if lk["clear"].mean() < 0.01:
                continue
            dates_used += 1
            years_used.add(int(p.stem[:4]))
            scenes_used.update(lk["scenes"])
            r = lk["refl"].astype("float32") / 10000
            r[:, ~lk["clear"]] = np.nan
            stack.append(r[:3])
            with np.errstate(invalid="ignore", divide="ignore"):
                ndvi.append((r[3] - r[0]) / (r[3] + r[0]))
            looks[m - 1] += lk["clear"]
        if stack:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                comp[m - 1, :3] = np.nanmedian(np.stack(stack), axis=0)
                comp[m - 1, 4] = np.nanmedian(np.stack(ndvi), axis=0)
        print(f"  month {m:02d}: {len(stack)} looks", flush=True)

    # Fill: a pixel with under MIN_LOOKS clear looks takes the mean of the nearest months either side
    # that have enough there; a month whose median looks is under MIN_LOOKS is refused whole and filled.
    months_meta = []
    month_ok = np.array([np.median(looks[i]) >= MIN_LOOKS for i in range(12)])
    final = comp.copy()
    for i in range(12):
        bad = np.ones((n, n), bool) if not month_ok[i] else looks[i] < MIN_LOOKS
        filled = np.zeros((n, n), bool)
        if bad.any():
            acc = np.zeros((5, n, n), "float32")
            cnt = np.zeros((n, n), "float32")
            for side in (-1, 1):
                got = np.zeros((n, n), bool)
                for step in range(1, 6):
                    j = (i + side * step) % 12
                    ok = (looks[j] >= MIN_LOOKS) & month_ok[j] & bad & ~got
                    acc[:, ok] += comp[j][:, ok]
                    cnt[ok] += 1
                    got |= ok
            fill = bad & (cnt > 0)
            final[i][:, fill] = acc[:, fill] / cnt[fill]
            filled = fill
        months_meta.append({"month": i + 1, "looks_dates": len(by_month.get(i + 1, [])),
                            "looks_median": int(np.median(looks[i])), "looks_min": int(looks[i].min()),
                            "looks_p05": int(np.percentile(looks[i], 5)),
                            "refused": bool(not month_ok[i]), "filled_fraction": round(float(filled.mean()), 4),
                            "filled_pixels": int(filled.sum())})

    # Per-class means (sRGB 0..1 of the composite reflectance / STRETCH, and NDVI) for the client.
    classes = _class_grids(tile, n)
    for i, mm in enumerate(months_meta):
        means = {}
        for name, mask in classes.items():
            if mask.sum() < 50:
                continue
            rgb = np.nanmean(final[i, :3][:, mask], axis=1)
            means[name] = {"srgb": [round(float(v), 4) for v in _srgb_encode(rgb / STRETCH)],
                           "reflectance": [round(float(v), 4) for v in rgb],
                           "ndvi": round(float(np.nanmean(final[i, 4][mask])), 3),
                           "cells": int(mask.sum())}
        mm["classes"] = means

    # Per-month float GeoTIFFs (pipeline only).
    tr = from_bounds(x0, y0, x1, y1, n, n)
    prof = {"driver": "GTiff", "dtype": "float32", "count": 4, "width": n, "height": n, "crs": tile.crs,
            "transform": tr, "nodata": float("nan"), "compress": "deflate", "predictor": 3, "tiled": True,
            "blockxsize": 256, "blockysize": 256}
    tifs = []
    for i in range(12):
        rel = f"seasons/s2_{i + 1:02d}.tif"
        with rasterio.open(tile.path(rel), "w", **prof) as dst:
            dst.write(final[i, [0, 1, 2, 4]])
            for b, d in enumerate(["red", "green", "blue", "ndvi"], 1):
                dst.set_band_description(b, d)
            dst.update_tags(WE_MONTH=i + 1, WE_LOOKS_MEDIAN=months_meta[i]["looks_median"],
                            WE_LOOKS_MIN=months_meta[i]["looks_min"], WE_REFUSED=str(months_meta[i]["refused"]),
                            WE_FILLED_FRACTION=months_meta[i]["filled_fraction"])
        tifs.append(rel)

    # Client sheets: frame m at column (m-1) % 4, row (m-1) // 4, top-left first, each north-up.
    rgb_sheet = np.zeros((ROWS * n, COLS * n, 3), "uint8")
    ndvi_sheet = np.zeros((ROWS * n, COLS * n), "uint8")
    lo, hi = NDVI_RANGE
    for i in range(12):
        r, c = divmod(i, COLS)
        rgb = np.nan_to_num(np.moveaxis(final[i, :3], 0, -1), nan=0.0)
        rgb_sheet[r * n:(r + 1) * n, c * n:(c + 1) * n] = np.round(255 * _srgb_encode(rgb / STRETCH)).astype("uint8")
        nd = np.nan_to_num(final[i, 4], nan=lo)
        ndvi_sheet[r * n:(r + 1) * n, c * n:(c + 1) * n] = np.round(255 * np.clip((nd - lo) / (hi - lo), 0, 1)).astype("uint8")
    Image.fromarray(rgb_sheet, "RGB").save(tile.path("client/season_rgb.png"), optimize=True)
    Image.fromarray(ndvi_sheet, "L").save(tile.path("client/season_ndvi.png"), optimize=True)

    yrs = [min(years_used), max(years_used)] if years_used else []
    naip = _naip_reference(tile)
    src_key = "copernicus_sentinel2_l2a" if run["provider"] == "pc" else "copernicus_sentinel2_l2a_aws"
    layout = {"columns": COLS, "rows": ROWS, "frame_pixels": n, "order": "month m (1-12) at column (m-1) % 4, "
              "row (m-1) // 4, rows top to bottom; each frame north-up on the tile grid, pixel centres as other client rasters"}
    common = {"kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds), "resolution_m": RES,
              "pixels": [COLS * n, ROWS * n], "layout": layout, "source": src_key, "years": yrs,
              "derived_from": "seasons.s2_monthly"}
    write_json(tile.path("seasons/months.json"), {
        "source": src_key, "years": yrs, "stretch": STRETCH, "ndvi_range": list(NDVI_RANGE),
        "min_looks": MIN_LOOKS, "naip_reference": naip, "months": months_meta})
    run_meta = {**run, "scenes_used": len(scenes_used), "dates_used": dates_used,
                "bytes_read": nbytes, "seconds": round(time.time() - t_start, 1)}
    return {
        "seasons.s2_monthly": {
            "path": "seasons/months.json", "kind": "raster_set", "files": tifs, "crs": tile.crs,
            "bounds": list(tile.bounds), "resolution_m": RES, "pixels": n, "source": src_key, "years": yrs,
            "pipeline_only": True,
            "encoding": "float32 per calendar month, bands red green blue (surface reflectance 0..1) and NDVI; "
                        "median over all clear looks of all years; NaN where no look",
            "method": {"collection": COLLECTION, "max_scene_cloud_pct": MAX_CLOUD,
                       "scl_kept": list(SCL_KEEP), "scl_masked_dilated": list(SCL_CLOUD), "dilate_px": DILATE_PX,
                       "boa_offset": "-1000 DN for processing baseline >= 04.00",
                       "min_looks": MIN_LOOKS, "fill": "pixels under min_looks (or a whole refused month) take the "
                       "mean of the nearest months either side with enough looks"},
            "run": run_meta, "naip_reference": naip, "months": months_meta},
        "client.season_rgb": {
            "path": "client/season_rgb.png", **common,
            "encoding": f"RGB = 255 * sRGB_encode(clamp(surface reflectance / {STRETCH}, 0, 1)) of bands B04 B03 B02: "
                        f"sampled as an sRGB texture, the linear value times {STRETCH} is reflectance",
            "stretch": {"reflectance_at_255": STRETCH, "curve": "sRGB"},
            "months": [{k: v for k, v in mm.items()} for mm in months_meta],
            "naip_reference": naip},
        "client.season_ndvi": {
            "path": "client/season_ndvi.png", **common,
            "encoding": f"grey byte = 255 * (NDVI - ({NDVI_RANGE[0]})) / {NDVI_RANGE[1] - NDVI_RANGE[0]:g}, clamped: "
                        f"0 = NDVI {NDVI_RANGE[0]}, 255 = {NDVI_RANGE[1]}; NDVI = (B08 - B04) / (B08 + B04), median of per-look NDVI",
            "ndvi_range": list(NDVI_RANGE),
            "months": [{"month": mm["month"], "looks_median": mm["looks_median"], "looks_min": mm["looks_min"],
                        "refused": mm["refused"], "filled_fraction": mm["filled_fraction"],
                        "filled_pixels": mm["filled_pixels"]} for mm in months_meta]},
    }
