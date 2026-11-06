"""The second and third canopy height maps of a global tile, for the canopy_top step (2026-11-06, iteration 6).

The landcover step reads Meta / WRI's first 1 m canopy height map (CHM v1, Tolan et al. 2024) for the tree cover and the
stand heights. CHM v1 is reported to underestimate tall canopies (Moudry et al. 2024; Brandt et al. 2026, the CHMv2
paper, says v2 "reduces bias in tall forests"), so canopy_top reads two more measurements of the same canopy and picks
by rule (pipeline/canopy_top.py):

  vegetation/canopy_height_v2_10m.tif    Meta / WRI CHM v2 (Brandt et al. 2026, DINOv3 trained on airborne lidar), the
                                         1 m map read at 2 m like v1 (landcover_global.py): per 10 m cell the p95
                                         height, tree cover (>= 4 m) and shrub cover (0.5-4 m) %, v1's own bands
  vegetation/canopy_height_eth_10m.tif   ETH Global Canopy Height 2020 (Lang et al. 2023, Sentinel-2 calibrated on GEDI
                                         RH98 footprints), 10 m: band 1 the canopy top height, band 2 its predictive
                                         standard deviation (m)

Both are CC BY 4.0 and read by window from cloud-optimised GeoTIFFs over anonymous HTTP range requests, never whole:
CHM v2 from the same AWS open-data bucket as v1 (one 1 m file per zoom-10 quadkey, EPSG:3857), ETH from the ETH
library's public share (3 x 3 degree EPSG:4326 tiles named by their south-west corner; the share's token is the public
link's, sent as the WebDAV user name with no password, the share's own documented route). A tile the files do not cover
(sea, a quadkey Meta did not map) reads as no data.
"""
from __future__ import annotations

import math

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

from . import runlog
from .config import SOURCES, USER_AGENT, Tile

META_CHM_V2 = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/{q}.tif"
ETH_SHARE = "cO8or7iOe5dT2Rt"   # the dataset's public libdrive link (README: "the libdrive page"), not a credential
ETH_DAV = "https://libdrive.ethz.ch/public.php/webdav/3deg_cogs/ETH_GlobalCanopyHeight_10m_2020_{name}_{layer}.tif"
NODATA = -9999.0

SOURCES["meta_canopy_height_v2"] = {
    "name": "Meta and WRI global canopy height maps v2 (CHMv2, DINOv3), AWS open data",
    "url": "https://registry.opendata.aws/dataforgood-fb-forestsv2/",
    "license": "CC BY 4.0 (the AWS open-data registry entry dataforgood-fb-forestsv2 and Source Coop's mirror: the "
               "published maps; the DINOv3 licence covers the model weights, which the pipeline never runs)",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "WRI and Meta (Data for Good), CHMv2, CC BY 4.0. Brandt, J. et al. (2026) CHMv2: Improvements in "
                   "Global Canopy Height Mapping using DINOv3, arXiv:2603.06382. Source imagery for CHM © 2016 Vantor",
    "attribution_url": "https://arxiv.org/abs/2603.06382", "attribution_required": True,
}
SOURCES["eth_canopy_height"] = {
    "name": "ETH Global Canopy Height 2020, 10 m (version 1), ETH Zurich research collection",
    "url": "https://doi.org/10.3929/ethz-b-000609802",
    "license": "CC BY 4.0 (the dataset's LICENSE.txt: 'free of charge, without restriction of use')",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Canopy height: Lang, N., Jetz, W., Schindler, K. and Wegner, J. D. (2023). A high-resolution canopy "
                   "height model of the Earth. Nature Ecology & Evolution 7: 1778-1789",
    "attribution_url": "https://doi.org/10.1038/s41559-023-02206-6", "attribution_required": True,
}


def _grid(tile: Tile, res_m: float):
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / res_m))
    return n, from_bounds(x0, y0, x1, y1, n, n)


def _read(hrefs: list[str], tile: Tile, res_m: float, resampling, src_nodata, **env) -> np.ndarray:
    """Mosaic the rasters at hrefs onto the tile grid (first valid value wins; a missing file is no data)."""
    n, transform = _grid(tile, res_m)
    out = np.full((n, n), NODATA, "float32")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT, GDAL_HTTP_MAX_RETRY="4",
                      GDAL_HTTP_RETRY_DELAY="3", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", **env):
        for href in hrefs:
            try:
                src = rasterio.open("/vsicurl/" + href)
            except rasterio.errors.RasterioIOError as e:
                runlog.fallback(f"canopy map file absent ({href.rsplit('/', 1)[-1]}: {str(e)[:60]}): no data there")
                continue
            with src, WarpedVRT(src, crs=tile.crs, transform=transform, width=n, height=n, resampling=resampling,
                                nodata=NODATA, src_nodata=src_nodata) as vrt:
                d = vrt.read(1).astype("float32")
            take = (d != NODATA) & np.isfinite(d) & (out == NODATA)
            out[take] = d[take]
    return out


def _quadkey(lon: float, lat: float, z: int) -> str:
    x = (lon + 180) / 360
    s = math.sin(math.radians(max(-85.05, min(85.05, lat))))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    nt = 2 ** z
    tx, ty = min(nt - 1, int(x * nt)), min(nt - 1, int(y * nt))
    return "".join(str((1 if tx & (1 << (i - 1)) else 0) + (2 if ty & (1 << (i - 1)) else 0)) for i in range(z, 0, -1))


def meta_v2(tile: Tile, res_m: float = 2.0) -> np.ndarray:
    """CHM v2 height (m) on the tile grid: 0 no canopy (the files carry no nodata: 0 is also unmapped), -9999 off the files."""
    w, s, e, n = tile.bounds_wgs84
    keys = sorted({_quadkey(lon, lat, 10) for lon in np.linspace(w, e, 8) for lat in np.linspace(s, n, 8)})
    runlog.fetched("meta_canopy_height_v2")
    return _read([META_CHM_V2.format(q=q) for q in keys], tile, res_m, Resampling.average, None)


def eth_name(lon: float, lat: float) -> str:
    la, lo = int(math.floor(lat / 3) * 3), int(math.floor(lon / 3) * 3)
    return f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"


def eth(tile: Tile, res_m: float = 10.0, layer: str = "Map") -> np.ndarray:
    """ETH canopy top height (layer Map) or its standard deviation (Map_SD), m, on the tile grid; -9999 no data."""
    w, s, e, n = tile.bounds_wgs84
    names = sorted({eth_name(lon, lat) for lon in (w, e) for lat in (s, n)})
    runlog.fetched("eth_canopy_height")
    return _read([ETH_DAV.format(name=nm, layer=layer) for nm in names], tile, res_m, Resampling.average, 255,
                 GDAL_HTTP_AUTH="BASIC", GDAL_HTTP_USERPWD=ETH_SHARE + ":")


def _blocks(a: np.ndarray, k: int) -> np.ndarray:
    n = a.shape[0] // k
    return a[:n * k, :n * k].reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)


def _write(tile: Tile, rel: str, arr: np.ndarray) -> None:
    x0, y0, x1, y1 = tile.bounds
    h, w = arr.shape[-2:]
    with rasterio.open(tile.path(rel), "w", driver="GTiff", dtype="float32", count=arr.shape[0], width=w, height=h,
                       crs=tile.crs, transform=from_bounds(x0, y0, x1, y1, w, h), nodata=NODATA, compress="deflate",
                       predictor=3, tiled=True) as d:
        d.write(arr.astype("float32"))


def fetch(tile: Tile, force: bool = False) -> dict:
    """Write the two maps' 10 m layers on the tile (kept: a rebuild reads the files) and return their layer records."""
    out = {}
    p = tile.path("vegetation/canopy_height_v2_10m.tif")
    if force or not p.exists():
        h2 = meta_v2(tile, 2.0)
        valid = h2 > NODATA + 1
        b = _blocks(np.where(valid, h2, 0.0).astype("float32"), 5)
        p95 = np.percentile(b, 95, axis=-1)
        tree = (b >= 4).mean(-1) * 100
        shrub = ((b >= 0.5) & (b < 4)).mean(-1) * 100
        nod = _blocks(valid.astype("float32"), 5).mean(-1) < 0.5
        stack = np.stack([p95, tree, shrub])
        stack[:, nod] = NODATA
        _write(tile, "vegetation/canopy_height_v2_10m.tif", stack)
    out["vegetation.canopy_height_v2_10m"] = {
        "path": "vegetation/canopy_height_v2_10m.tif", "kind": "raster", "resolution_m": 10.0, "crs": tile.crs,
        "bounds": list(tile.bounds), "source": "meta_canopy_height_v2",
        "encoding": "band 1 the p95 height (m) of the 10 m cell's 2 m means of the 1 m map, band 2 tree cover (>= 4 m) %, "
                    "band 3 shrub cover (0.5-4 m) %; -9999 off the map"}
    p = tile.path("vegetation/canopy_height_eth_10m.tif")
    if force or not p.exists():
        _write(tile, "vegetation/canopy_height_eth_10m.tif", np.stack([eth(tile, 10.0, "Map"), eth(tile, 10.0, "Map_SD")]))
    out["vegetation.canopy_height_eth_10m"] = {
        "path": "vegetation/canopy_height_eth_10m.tif", "kind": "raster", "resolution_m": 10.0, "crs": tile.crs,
        "bounds": list(tile.bounds), "source": "eth_canopy_height",
        "encoding": "band 1 the canopy top height (m; GEDI RH98-calibrated), band 2 its standard deviation (m); -9999 no data"}
    return out
