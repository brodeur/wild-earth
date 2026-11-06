"""Land cover anywhere: the `landcover` step outside LANDFIRE (world pipeline probes, 2026-11-05).

The base and flora stages read LANDFIRE's rasters (EVT, EVC, EVH, BpS at 30 m) and the habitat classes made from them.
Outside the US this writes the same files from global sources, so every reader keeps working unchanged:

  vegetation/worldcover.tif, worldcover_30m.tif   ESA WorldCover 2021 at 10 m, and its mode at 30 m
  vegetation/canopy_height_10m.tif                Meta / WRI canopy height read at 2 m, per 10 m cell: p95 height, tree
                                                  cover (>= 4 m) and shrub cover (0.5-4 m) %, the lidar step's bands
  vegetation/ecosystem.tif, ecosystem.json        the IUCN GET functional group per 30 m cell (pipeline/ecosystem.py)
  vegetation/evt.tif, bps.tif                     synthetic codes: 9000 + the ecosystem index (present and potential),
                                                  9101 cropland and 9102 built-up (present only); named in classes.json
                                                  with a LANDFIRE-style physiognomy so habitat.classify_evt reads them
  vegetation/evc.tif, evh.tif                     LANDFIRE's own code scheme (1xx tree cover % / height m, 2xx shrub,
                                                  3xx herb), filled from the canopy map and the WorldCover class
  vegetation/habitat_present.tif, habitat.tif     the habitat classes, human land rewilded from the potential code
  climate/normals.json                            ERA5 monthly normals and the Koppen class at the tile centre

Every value comes from a measurement except the shrub and herb cover and height (WorldCover gives the class, not the
cover): those are typical values per class, marked so in classes.json.
"""
from __future__ import annotations

import numpy as np
import rasterio
from rasterio.transform import from_bounds

from . import ecosystem as eco
from . import fetch_global as G
from . import runlog
from .config import Tile, write_json
from .habitat import CLASSES, COLORS, apply_rewilded_beds, classify_bps, classify_evt

RES_M = 30.0
NODATA = -9999

PHYS = {  # physiognomy per ecosystem group, as LANDFIRE names it, so habitat.classify_evt places it
    "T1.1": "Hardwood", "T1.2": "Hardwood", "T1.3": "Hardwood", "T2.1": "Conifer", "T2.2": "Hardwood",
    "T2.3": "Conifer", "T2.4": "Hardwood", "T2.6": "Hardwood", "T3.1": "Shrubland", "T3.2": "Shrubland",
    "T3.3": "Shrubland", "T4.1": "Grassland", "T4.2": "Grassland", "T4.4": "Conifer-Hardwood", "T4.5": "Grassland",
    "T5.1": "Grassland", "T5.3": "Sparsely Vegetated", "T5.4": "Sparsely Vegetated", "T6.1": "Snow-Ice",
    "T6.2": "Sparsely Vegetated", "T6.3": "Grassland", "T6.4": "Grassland", "T6.5": "Grassland",
    "TF1.3": "Riparian", "MFT1.2": "Riparian", "MT1.1": "Sparsely Vegetated", "MT1.3": "Sparsely Vegetated",
    "F1": "Open Water", "F2": "Open Water", "M1": "Open Water",
}
GROUPVEG = {"Hardwood": "Hardwood", "Conifer": "Conifer", "Conifer-Hardwood": "Hardwood-Conifer",
            "Shrubland": "Shrubland", "Grassland": "Grassland", "Sparsely Vegetated": "Sparse", "Snow-Ice": "Snow-Ice",
            "Riparian": "Riparian", "Open Water": "Open Water"}
HUMAN = {40: (9101, "Agricultural", "Cropland (ESA WorldCover; rewilded)"),
         50: (9102, "Developed-High Intensity", "Built-up (ESA WorldCover; rewilded)")}
# typical cover and height for the classes WorldCover names but does not measure (marked as such)
SHRUB_COVER, SHRUB_H_DM, HERB_COVER, HERB_H_DM = 45, 10, 70, 5
# the dwarf-shrub cover % of the open cells by ecosystem group (typical of each: Atlantic heath 50-80 %, Mediterranean
# garrigue and tropical dry scrub about half, arctic and alpine tundra a third); height DWARF_H_DM dm
DWARF_SHRUB, DWARF_H_DM = {"T3.3": 60, "T3.2": 50, "T3.1": 45, "T6.3": 35, "T6.4": 30}, 3


def _write(tile, rel, arr, dtype, nodata, count=1):
    x0, y0, x1, y1 = tile.bounds
    h, w = arr.shape[-2:]
    with rasterio.open(tile.path(rel), "w", driver="GTiff", dtype=dtype, count=count, width=w, height=h, crs=tile.crs,
                       transform=from_bounds(x0, y0, x1, y1, w, h), nodata=nodata, compress="deflate") as dst:
        dst.write(arr.astype(dtype) if count > 1 else arr.astype(dtype)[None])


def _blocks(a: np.ndarray, k: int) -> np.ndarray:
    """(n, n) -> (n/k, n/k, k*k) blocks."""
    n = a.shape[0] // k * k
    a = a[:n, :n]
    return a.reshape(n // k, k, n // k, k).transpose(0, 2, 1, 3).reshape(n // k, n // k, k * k)


def _mode30(wc10: np.ndarray) -> np.ndarray:
    b = _blocks(wc10, 3)
    out = np.zeros(b.shape[:2], "uint8")
    best = np.zeros(b.shape[:2], "int16")
    for c in np.unique(wc10):
        if c == 0:
            continue
        cnt = (b == c).sum(-1)
        take = cnt > best
        out[take], best[take] = c, cnt[take]
    return out


def _resize(a: np.ndarray, n: int, order=1) -> np.ndarray:
    from scipy.ndimage import zoom
    return zoom(a, n / a.shape[0], order=order)[:n, :n]


def fetch_vegetation_global(tile: Tile) -> dict:
    n30 = int(round(10000 / RES_M))     # 333
    w, s, e, nn = tile.bounds_wgs84
    lat = (s + nn) / 2
    # --- measurements
    wc10 = G.worldcover(tile, 10.0)
    _write(tile, "vegetation/worldcover.tif", wc10, "uint8", 0)
    wc30 = _mode30(wc10)[:n30, :n30]
    if wc30.shape[0] < n30:
        wc30 = np.pad(wc30, ((0, n30 - wc30.shape[0]), (0, n30 - wc30.shape[1])), mode="edge")
    _write(tile, "vegetation/worldcover_30m.tif", wc30, "uint8", 0)
    chm2 = G.canopy_height(tile, 2.0)                    # 5000 x 5000
    valid2 = chm2 > -9000
    h = np.where(valid2, chm2, 0.0).astype("float32")
    b10 = _blocks(h, 5)                                  # 1000 x 1000 x 25
    p95 = np.percentile(b10, 95, axis=-1).astype("float32")
    tree10 = ((b10 >= 4).mean(-1) * 100).astype("float32")
    shrub10 = (((b10 >= 0.5) & (b10 < 4)).mean(-1) * 100).astype("float32")
    _write(tile, "vegetation/canopy_height_10m.tif", np.stack([p95, tree10, shrub10]), "float32", NODATA, count=3)
    b30 = _blocks(h, 15)[:n30, :n30]
    tree30 = ((b30 >= 4).mean(-1) * 100)
    h90 = np.percentile(b30, 90, axis=-1)
    climate = G.climate_normals(tile)
    write_json(tile.path("climate/normals.json"), climate)
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        dem = src.read(1, out_shape=(n30, n30), resampling=rasterio.enums.Resampling.average).astype("float32")
        dem[dem <= NODATA + 1] = np.nan
    soil = G.soilgrids(tile, RES_M)
    ph = soil["phh2o"][:n30, :n30]
    clay = soil["clay"][:n30, :n30]          # % (fetch_global scales g/kg)
    # sea: open water touching the tile edge, mostly at sea level
    from scipy import ndimage
    water = wc30 == 80
    lab, nl = ndimage.label(water)
    sea = np.zeros_like(water)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    for i in edge:
        m = lab == i
        if np.nanmean(np.nan_to_num(dem[m], nan=0) <= 2.0) > 0.7 and m.sum() > 500:
            sea |= m
    efg, rules = eco.classify(wc30, dem, h90, climate, lat, soil_ph=ph, soil_clay=clay, res_m=RES_M, sea=sea)
    _write(tile, "vegetation/ecosystem.tif", efg, "uint8", 0)
    summ = eco.summary(efg, climate["koppen"])
    summ["rules"] = rules
    write_json(tile.path("vegetation/ecosystem.json"), summ)
    # --- LANDFIRE-shaped rasters
    present = (9000 + efg.astype("int16")).astype("int16")
    for wcc, (code, _, _) in HUMAN.items():
        present[wc30 == wcc] = code
    bps = (9000 + efg.astype("int16")).astype("int16")
    evc = np.full((n30, n30), 31, "int16")                      # barren
    evh = np.full((n30, n30), 31, "int16")
    treeish = (tree30 >= 10) | ((wc30 == 10) & (tree30 >= 3))
    evc[treeish] = 100 + np.clip(np.round(np.maximum(tree30[treeish], 10)), 10, 99).astype("int16")
    evh[treeish] = 100 + np.clip(np.round(h90[treeish]), 1, 99).astype("int16")
    shrub = ~treeish & (wc30 == 20)
    evc[shrub], evh[shrub] = 200 + SHRUB_COVER, 200 + SHRUB_H_DM
    herb = ~treeish & np.isin(wc30, [30, 90, 100, 40])
    evc[herb], evh[herb] = 300 + HERB_COVER, 300 + HERB_H_DM
    # Dwarf shrubs the canopy map cannot see (it starts at 0.5 m) and WorldCover calls grass or moss: in a heathland,
    # shrubland or tundra group the open cells carry the group's dwarf-shrub cover at 0.3 m (Lofoten's heath was drawn
    # bare: its crowberry, heather and juniper had no cover to stand in)
    for code, cover in DWARF_SHRUB.items():
        m = herb & (efg == eco.CODE[code])
        evc[m], evh[m] = 200 + cover, 200 + DWARF_H_DM
    evc[wc30 == 80], evh[wc30 == 80] = 11, 11
    evc[wc30 == 70], evh[wc30 == 70] = 12, 12
    evc[wc30 == 50], evh[wc30 == 50] = 24, 24
    for k, a in (("evt", present), ("bps", bps), ("evc", evc), ("evh", evh)):
        _write(tile, f"vegetation/{k}.tif", a, "int16", NODATA)
    # --- classes, as fetch_vegetation writes them
    from .fetch_vegetation import _table
    classes = {"habitat": {str(k): {"name": v, "color": COLORS[k]} for k, v in CLASSES.items()},
               "source": "world pipeline: ESA WorldCover, Meta canopy height, ERA5, SoilGrids (pipeline/landcover_global.py)"}
    evt_class, bps_class, evt_tab, bps_tab = {}, {}, {}, {}
    for code in np.unique(present):
        code = int(code)
        if code in (9101, 9102):
            _, phys, name = HUMAN[40 if code == 9101 else 50]
            group = "Human"
        else:
            efgc = eco.EFG[code - 9000][0]
            phys, name, group = PHYS.get(efgc, "Sparsely Vegetated"), f"{efgc} {eco.NAME.get(efgc, '')}", efgc
        evt_class[code] = classify_evt(phys, name)
        evt_tab[str(code)] = {"name": name, "phys": phys, "group": group, "habitat": CLASSES[evt_class[code]],
                              "color": list(COLORS[evt_class[code]]), "pixels": int((present == code).sum()),
                              "synthetic": True}
    for code in np.unique(bps):
        code = int(code)
        efgc = eco.EFG[code - 9000][0]
        phys = PHYS.get(efgc, "Sparsely Vegetated")
        name = f"{efgc} {eco.NAME.get(efgc, '')}"
        bps_class[code] = classify_bps(GROUPVEG.get(phys, "Sparse"), name)
        bps_tab[str(code)] = {"name": name, "group": GROUPVEG.get(phys, "Sparse"), "habitat": CLASSES[bps_class[code]],
                              "pixels": int((bps == code).sum()), "synthetic": True}
    classes["evt"], classes["bps"] = evt_tab, bps_tab
    for k, arr in (("evc", evc), ("evh", evh)):
        tab = _table(k)
        classes[k] = {str(int(c)): {"name": (tab.get(int(c)) or {}).get("CLASSNAMES", "?"), "pixels": int((arr == c).sum())}
                      for c in np.unique(arr)}
    classes["evc_note"] = (f"tree cover from the canopy map; shrub ({SHRUB_COVER} %) and herb ({HERB_COVER} %) cover are "
                           "typical values for the WorldCover class, not measured; open cells of a heath, shrubland or "
                           f"tundra group carry its dwarf-shrub cover ({DWARF_SHRUB})")

    def remap(arr, lut):
        out = np.zeros(arr.shape, "uint8")
        for c, cls in lut.items():
            out[arr == c] = cls
        return out

    present_cls, bps_cls = remap(present, evt_class), remap(bps, bps_class)
    rewilded = present_cls.copy()
    human = present_cls == 9
    fill = np.where((bps_cls == 0) | (bps_cls == 9), 5, bps_cls)
    rewilded[human] = fill[human]
    beds = apply_rewilded_beds(tile, present_cls, rewilded)
    _write(tile, "vegetation/habitat_present.tif", present_cls, "uint8", 0)
    _write(tile, "vegetation/habitat.tif", rewilded, "uint8", 0)
    write_json(tile.path("vegetation/classes.json"), classes)
    runlog.fallback("outside LANDFIRE: land cover from ESA WorldCover 2021, canopy from Meta / WRI 1 m canopy height, "
                    "ecosystem groups (IUCN GET) from cover, ERA5 climate and SoilGrids", source="esa_worldcover")
    total = max(1, int((present_cls > 0).sum()))
    hist = lambda a: {CLASSES[c]: round(float((a == c).sum() / total), 4) for c in CLASSES if (a == c).any()}  # noqa: E731
    src = {"source": "esa_worldcover", "sources": ["esa_worldcover", "meta_canopy_height", "open_meteo", "soilgrids"]}
    out = {f"vegetation.{k}": {"path": f"vegetation/{k}.tif", "kind": "raster", "resolution_m": RES_M, **src,
                               "synthetic": True, "classes": len(classes[k])} for k in ("evt", "evc", "evh", "bps")}
    out["vegetation.habitat_present"] = {"path": "vegetation/habitat_present.tif", "kind": "raster", "resolution_m": RES_M,
                                         "derived_from": "vegetation.evt", "fractions": hist(present_cls)}
    out["vegetation.habitat"] = {"path": "vegetation/habitat.tif", "kind": "raster", "resolution_m": RES_M,
                                 "derived_from": ["vegetation.evt", "vegetation.bps"],
                                 "backfilled_fraction": round(float(human.sum() / total), 4), "fractions": hist(rewilded)}
    if beds:
        out["vegetation.habitat"]["rewilded_beds"] = beds
    out["vegetation.classes"] = {"path": "vegetation/classes.json", "kind": "table"}
    out["vegetation.worldcover"] = {"path": "vegetation/worldcover.tif", "kind": "raster", "resolution_m": 10.0,
                                    "source": "esa_worldcover",
                                    "fractions": {G.WORLDCOVER.get(int(c), str(c)): round(float((wc10 == c).mean()), 4)
                                                  for c in np.unique(wc10) if c}}
    out["vegetation.canopy_height_10m"] = {"path": "vegetation/canopy_height_10m.tif", "kind": "raster", "resolution_m": 10.0,
                                           "bands": ["p95 height m", "tree cover % (>= 4 m)", "shrub cover % (0.5-4 m)"],
                                           "source": "meta_canopy_height",
                                           "stats": {"p95_median_m": round(float(np.median(p95)), 1),
                                                     "p95_p90_m": round(float(np.percentile(p95, 90)), 1),
                                                     "tree_cover_mean": round(float(tree10.mean()), 1)}}
    out["vegetation.ecosystem"] = {"path": "vegetation/ecosystem.tif", "kind": "raster", "resolution_m": RES_M,
                                   "legend": "vegetation/ecosystem.json", "groups": summ["groups"][:8],
                                   "koppen": climate["koppen"], "source": "iucn_get",
                                   "rules": "pipeline/ecosystem.py"}
    months, rule = G.season_months(climate, lat)
    out["climate.normals"] = {"path": "climate/normals.json", "kind": "table", "source": "open_meteo",
                              "koppen": climate["koppen"], "annual": climate["annual"],
                              "season_months": months, "season_rule": rule}
    return out
