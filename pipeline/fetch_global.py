"""Global sources: what stands in for the US-only ones anywhere on Earth (world pipeline, phase 1).

docs/world-pipeline.md, "Land". Every source here is global and its licence lets derived layers reach a client:

  copernicus_dem_glo30   Copernicus DEM GLO-30 (a surface model: under forest it carries part of the canopy, so the
                         dem step lowers it by a share of the canopy height below); via Microsoft Planetary Computer
  esa_worldcover         ESA WorldCover 10 m 2021 (CC BY 4.0): the land-cover classes that stand in for LANDFIRE
  meta_canopy_height     Meta / WRI global canopy height 1 m (Tolan et al. 2024; CC BY 4.0), cloud-optimised GeoTIFFs
                         on the AWS open-data bucket, one per zoom-9 quadkey: read by window, never whole
  soilgrids              ISRIC SoilGrids 2.0 250 m (CC BY 4.0): texture, organic carbon and pH at 0-5 cm
  open_meteo (climate)   ERA5 daily over ten years through the Open-Meteo archive (CC BY 4.0): monthly normals and the
                         Koppen-Geiger class the ecosystem map reads

Each reader returns an array on the tile's own grid (EPSG of the tile, north up, the tile's bounds) at the resolution asked,
and records the read with runlog.fetched. The raw answers are cached under the tile's _cache/ like the other fetchers.
"""
from __future__ import annotations

import json
import math
from datetime import date

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

from . import runlog
from .config import SOURCES, USER_AGENT, Tile
from .http import HEADERS

PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
META_CHM = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{q}.tif"
SOILGRIDS = "https://files.isric.org/soilgrids/latest/data/{p}/{p}_0-5cm_mean.vrt"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

SOURCES["copernicus_dem_glo30"] = {
    "name": "Copernicus DEM GLO-30 (public instance) via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30",
    "license": "Copernicus DEM licence (free, full and open: reproduce, distribute, adapt; the notice is required)",
    "license_url": "https://spacedata.copernicus.eu/documents/20123/121286/CSCDA_ESA_Mission-specific+Annex_31_Oct_22.pdf",
    "attribution": "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the "
                   "European Union and ESA; all rights reserved",
    "attribution_url": "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
    "attribution_required": True,
}
SOURCES["esa_worldcover"] = {
    "name": "ESA WorldCover 10 m 2021 v200 via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/esa-worldcover",
    "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA "
                   "WorldCover consortium",
    "attribution_url": "https://esa-worldcover.org/", "attribution_required": True,
}
SOURCES["meta_canopy_height"] = {
    "name": "Meta and WRI global 1 m canopy height (Tolan et al. 2024), AWS open data",
    "url": "https://registry.opendata.aws/dataforgood-fb-forests/",
    "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Canopy height: Meta and World Resources Institute (2024), Tolan et al., Remote Sensing of "
                   "Environment 300:113888",
    "attribution_url": "https://doi.org/10.1016/j.rse.2023.113888", "attribution_required": True,
}
SOURCES["iucn_get"] = {
    "name": "IUCN Global Ecosystem Typology 2.0 (the functional group codes and names; the rules are the pipeline's)",
    "url": "https://global-ecosystems.org/", "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Ecosystem groups: Keith, D.A. et al. (2022) A function-based typology for Earth's ecosystems. Nature 610:513",
    "attribution_url": "https://doi.org/10.1038/s41586-022-05318-4", "attribution_required": True,
}
SOURCES["soilgrids"] = {
    "name": "ISRIC SoilGrids 2.0 (250 m), 0-5 cm mean",
    "url": "https://www.isric.org/explore/soilgrids",
    "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Soil: ISRIC SoilGrids 2.0 (Poggio et al. 2021, SOIL 7:217)",
    "attribution_url": "https://doi.org/10.5194/soil-7-217-2021", "attribution_required": True,
}


# ---------------------------------------------------------------------------------------------- grid and reading

def grid(tile: Tile, res_m: float):
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / res_m))
    return n, from_bounds(x0, y0, x1, y1, n, n)


def _env():
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT,
                        GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="3", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.vrt,.ovr")


def read_to_grid(hrefs: list[str], tile: Tile, res_m: float, *, resampling=Resampling.bilinear, nodata=-9999.0,
                 dtype="float32", band=1, src_nodata=None) -> np.ndarray:
    """Mosaic the rasters at hrefs onto the tile's grid (first valid value wins)."""
    n, transform = grid(tile, res_m)
    out = np.full((n, n), nodata, dtype)
    with _env():
        for href in hrefs:
            with rasterio.open(href) as src:
                kw = {"src_nodata": src_nodata} if src_nodata is not None else {}
                with WarpedVRT(src, crs=tile.crs, transform=transform, width=n, height=n,
                               resampling=resampling, nodata=nodata, **kw) as vrt:
                    data = vrt.read(band).astype(dtype)
            take = (data != nodata) & np.isfinite(data) & (out == nodata)
            out[take] = data[take]
    return out


def pc_items(collection: str, tile: Tile, query: dict | None = None, limit=50) -> list[dict]:
    import requests
    body = {"collections": [collection], "bbox": list(tile.bounds_wgs84), "limit": limit}
    if query:
        body["query"] = query
    last = None
    for attempt in range(3):
        try:
            r = requests.post(PC_STAC, json=body, headers=HEADERS, timeout=120)
            r.raise_for_status()
            return r.json().get("features", [])
        except Exception as e:  # noqa: BLE001
            last = e
            import time
            time.sleep(4 * (attempt + 1))
    raise last  # type: ignore[misc]


def _sign(href: str) -> str:
    import planetary_computer
    return planetary_computer.sign(href)


# ---------------------------------------------------------------------------------------------- DEM

def copernicus_dem(tile: Tile, res_m: float) -> np.ndarray:
    items = pc_items("cop-dem-glo-30", tile)
    if not items:
        raise RuntimeError("no Copernicus GLO-30 items over this tile (open sea?)")
    runlog.fetched("copernicus_dem_glo30")
    return read_to_grid([_sign(i["assets"]["data"]["href"]) for i in items], tile, res_m)


# ---------------------------------------------------------------------------------------------- land cover

WORLDCOVER = {10: "tree cover", 20: "shrubland", 30: "grassland", 40: "cropland", 50: "built-up", 60: "bare / sparse",
              70: "snow and ice", 80: "permanent water", 90: "herbaceous wetland", 95: "mangroves", 100: "moss and lichen"}


def worldcover(tile: Tile, res_m: float = 10.0) -> np.ndarray:
    items = pc_items("esa-worldcover", tile)
    items = [i for i in items if "2021" in i["id"]] or items
    if not items:
        raise RuntimeError("no ESA WorldCover items over this tile")
    runlog.fetched("esa_worldcover")
    a = read_to_grid([_sign(i["assets"]["map"]["href"]) for i in items], tile, res_m,
                     resampling=Resampling.nearest, nodata=0, dtype="uint8")
    return a


# ---------------------------------------------------------------------------------------------- canopy height

def _quadkey(lon: float, lat: float, z: int) -> str:
    x = (lon + 180) / 360
    s = math.sin(math.radians(max(-85.05, min(85.05, lat))))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    nt = 2 ** z
    tx, ty = min(nt - 1, int(x * nt)), min(nt - 1, int(y * nt))
    return "".join(str((1 if tx & (1 << (i - 1)) else 0) + (2 if ty & (1 << (i - 1)) else 0)) for i in range(z, 0, -1))


def canopy_height(tile: Tile, res_m: float = 1.0) -> np.ndarray:
    """Meta / WRI canopy height (m) on the tile grid; 0 where the map says no canopy, -9999 where it has no data."""
    w, s, e, n = tile.bounds_wgs84
    keys = sorted({_quadkey(lon, lat, 9) for lon in np.linspace(w, e, 6) for lat in np.linspace(s, n, 6)})
    hrefs = [META_CHM.format(q=q) for q in keys]
    runlog.fetched("meta_canopy_height")
    rs = Resampling.average if res_m > 1.5 else Resampling.bilinear
    out = read_to_grid(["/vsicurl/" + h for h in hrefs], tile, res_m, resampling=rs, nodata=-9999.0, src_nodata=255)
    return out


# ---------------------------------------------------------------------------------------------- soils

SOIL_PROPS = {"clay": 0.1, "sand": 0.1, "soc": 0.1, "phh2o": 0.1}   # stored as ints: g/kg x10 for clay/sand, dg/kg soc, pH x10


def soilgrids(tile: Tile, res_m: float = 30.0) -> dict[str, np.ndarray]:
    out = {}
    for p, scale in SOIL_PROPS.items():
        a = read_to_grid(["/vsicurl/" + SOILGRIDS.format(p=p)], tile, res_m, resampling=Resampling.bilinear,
                         nodata=-32768.0, src_nodata=-32768)
        a = np.where(a == -32768.0, np.nan, a * scale)
        out[p] = a.astype("float32")
    runlog.fetched("soilgrids")
    return out


# ---------------------------------------------------------------------------------------------- climate

def koppen(t: list[float], p: list[float], lat: float) -> str:
    """Koppen-Geiger class from monthly mean temperature (deg C) and precipitation (mm), Peel et al. 2007 rules."""
    t, p = np.asarray(t, float), np.asarray(p, float)
    T, P = t.mean(), p.sum()
    summer = slice(3, 9) if lat >= 0 else None   # April-September in the north
    idx = np.arange(12)
    hs = (idx >= 3) & (idx <= 8) if lat >= 0 else ~((idx >= 3) & (idx <= 8))
    Ps, Pw = p[hs].sum(), p[~hs].sum()
    pth = 2 * T + (28 if Ps >= 0.7 * P else 0 if Pw >= 0.7 * P else 14)
    tmax, tmin = t.max(), t.min()
    if tmax < 10:
        return "EF" if tmax < 0 else "ET"
    if P < 10 * pth:
        k = "BW" if P < 5 * pth else "BS"
        return k + ("h" if T >= 18 else "k")
    if tmin >= 18:
        pmin = p.min()
        return "Af" if pmin >= 60 else ("Am" if pmin >= 100 - P / 25 else "Aw")
    first = "C" if tmin > 0 else "D"   # Peel uses 0 deg C (Koppen's -3)
    psmin, psmax, pwmin, pwmax = p[hs].min(), p[hs].max(), p[~hs].min(), p[~hs].max()
    if psmin < 40 and psmin < pwmax / 3:
        second = "s"
    elif pwmin < psmax / 10:
        second = "w"
    else:
        second = "f"
    warm = (t > 10).sum()
    third = "a" if tmax >= 22 else ("b" if warm >= 4 else ("d" if first == "D" and tmin < -38 else "c"))
    return first + second + third


def climate_normals(tile: Tile, years: int = 10, force=False) -> dict:
    """Monthly normals at the tile centre from ten years of ERA5 daily values (Open-Meteo archive), cached."""
    from .http import get_json_cached
    w, s, e, n = tile.bounds_wgs84
    lat, lon = (s + n) / 2, (w + e) / 2
    end = date(date.today().year - 1, 12, 31)
    start = date(end.year - years + 1, 1, 1)
    params = {"latitude": round(lat, 4), "longitude": round(lon, 4), "start_date": start.isoformat(),
              "end_date": end.isoformat(), "timezone": "GMT",
              "daily": "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,"
                       "relative_humidity_2m_mean,et0_fao_evapotranspiration,sunshine_duration"}
    d = get_json_cached(OPEN_METEO_ARCHIVE, params, tile.path(f"_cache/climate_{start.year}_{end.year}.json"),
                        force=force, source="open_meteo")
    days = d["daily"]
    months = np.array([int(x[5:7]) for x in days["time"]])
    yrs = np.array([int(x[:4]) for x in days["time"]])
    nyr = len(set(yrs.tolist()))

    def mean(k):
        v = np.array([np.nan if x is None else x for x in days[k]], float)
        return [float(np.nanmean(v[months == m])) for m in range(1, 13)]

    def total(k):
        v = np.array([0.0 if x is None else x for x in days[k]], float)
        return [float(v[months == m].sum() / nyr) for m in range(1, 13)]

    t, p = mean("temperature_2m_mean"), total("precipitation_sum")
    out = {
        "source": "open_meteo", "period": [start.isoformat(), end.isoformat()], "point": [round(lon, 4), round(lat, 4)],
        "elevation_m": d.get("elevation"),
        "t_mean_c": [round(x, 1) for x in t], "t_max_c": [round(x, 1) for x in mean("temperature_2m_max")],
        "t_min_c": [round(x, 1) for x in mean("temperature_2m_min")], "precip_mm": [round(x, 1) for x in p],
        "snow_cm": [round(x, 1) for x in total("snowfall_sum")], "rh_pct": [round(x, 1) for x in mean("relative_humidity_2m_mean")],
        "pet_mm": [round(x, 1) for x in total("et0_fao_evapotranspiration")],
        "sun_h": [round(x / 3600, 1) for x in total("sunshine_duration")],
    }
    out["annual"] = {"t_mean_c": round(float(np.mean(t)), 1), "precip_mm": round(float(np.sum(p))),
                     "pet_mm": round(float(np.sum(out["pet_mm"])))}
    out["koppen"] = koppen(t, p, lat)
    return out


# ---------------------------------------------------------------------------------------------- imagery

SOURCES.setdefault("sentinel2_l2a", {
    "name": "Copernicus Sentinel-2 L2A via Microsoft Planetary Computer",
    "url": "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
    "license": "Copernicus Sentinel data terms (free, full and open)",
    "license_url": "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice",
    "attribution": "Contains modified Copernicus Sentinel data", "attribution_url": "https://sentinels.copernicus.eu/",
    "attribution_required": True})

CLOUDY_SCL = (0, 1, 3, 8, 9, 10)   # no data, saturated, cloud shadow, cloud medium / high, cirrus


def sentinel_true_colour(tile: Tile, res_m: float = 10.0, max_items: int = 14, years: int = 3) -> tuple[np.ndarray, dict]:
    """A cloud-masked median true-colour composite of the clearest Sentinel-2 L2A scenes of the last `years` years,
    as uint8 RGB (3, n, n) on the tile grid at res_m, encoded like the seasons step's colour (sRGB of 2.5 x reflectance)."""
    from datetime import date as _d
    end = _d.today()
    rng = f"{end.year - years}-{end.month:02d}-01/{end.isoformat()}"
    items = []
    for cc in (20, 50, 80):
        items = pc_items("sentinel-2-l2a", tile, query={"eo:cloud_cover": {"lt": cc}}, limit=200)
        items = [i for i in items if rng.split("/")[0] <= i["properties"]["datetime"][:10]]
        if len(items) >= 6:
            break
    if not items:
        raise RuntimeError("no Sentinel-2 L2A scenes over this tile")
    items = sorted(items, key=lambda i: i["properties"].get("eo:cloud_cover", 100))[:max_items]
    n, _ = grid(tile, res_m)
    stack = []
    for it in items:
        try:
            scl = read_to_grid([_sign(it["assets"]["SCL"]["href"])], tile, res_m, resampling=Resampling.nearest,
                               nodata=0, dtype="uint8")
            bands = [read_to_grid([_sign(it["assets"][b]["href"])], tile, res_m, nodata=0, dtype="float32")
                     for b in ("B04", "B03", "B02")]
        except Exception as e:  # noqa: BLE001
            runlog.note(f"sentinel scene {it['id']} unreadable: {str(e)[:120]}")
            continue
        off = 1000.0 if float(it["properties"].get("s2:processing_baseline", "0") or 0) >= 4.0 else 0.0
        rgb = np.stack([(b - off) / 10000.0 for b in bands])
        bad = np.isin(scl, CLOUDY_SCL) | (bands[0] == 0)
        rgb[:, bad] = np.nan
        stack.append(rgb.astype("float32"))
    if not stack:
        raise RuntimeError("no readable Sentinel-2 scenes")
    med = np.nanmedian(np.stack(stack), axis=0)
    clear = np.isfinite(med[0]).mean()
    med = np.where(np.isfinite(med), med, np.nanmedian(med))
    from .fetch_sentinel import _srgb_encode
    out = np.round(_srgb_encode(np.clip(med * 2.5, 0, 1)) * 255).astype("uint8")
    runlog.fetched("sentinel2_l2a")
    return out, {"source": "sentinel2_l2a", "scenes": len(stack), "clear_fraction": round(float(clear), 4),
                 "dates": sorted(i["properties"]["datetime"][:10] for i in items)}


# ---------------------------------------------------------------------------------------------- the tile's seasons

NORTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"]


def season_months(climate: dict, lat: float) -> tuple[list[str], str]:
    """The season name of each month (January first) on this tile, and the rule. The season-keyed tables (resources,
    calendars, colours) were written for a Mediterranean north: spring lush, summer dry and cured, fall the turn and the
    mast, winter cool and wet. A temperate south shifts them six months; a seasonally dry tropics maps them onto its own
    rainfall: the wettest three months spring, the driest three summer, the three after them fall, the rest winter; a
    climate wet all year (driest month over 60 mm) keeps the north's names (its plants are evergreen anyway)."""
    p = [float(x) for x in climate["precip_mm"]]
    if abs(lat) < 23.5 and min(p) < 60:
        block = lambda i: sum(p[(i + k) % 12] for k in range(3))   # noqa: E731
        wet = max(range(12), key=block)
        dry = min(range(12), key=block)
        out = [None] * 12
        for k in range(3):
            out[(wet + k) % 12] = "spring"
        for k in range(3):
            if out[(dry + k) % 12] is None:
                out[(dry + k) % 12] = "summer"
        i = (dry + 3) % 12
        for _ in range(3):
            if out[i] is None:
                out[i] = "fall"
            i = (i + 1) % 12
        out = [s or "winter" for s in out]
        return out, f"tropical wet and dry: spring from month {wet + 1}, summer from month {dry + 1}"
    if lat < -23.5:
        return NORTH[6:] + NORTH[:6], "southern temperate: the north's seasons shifted six months"
    return list(NORTH), "the north's calendar quarters"
