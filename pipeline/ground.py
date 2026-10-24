"""Build step `ground`: geology + soils + outcrop likelihood for the client.

    outcrop = clip(resistance(rock class) * shallowness(depth to bedrock)
                   * terrain(slope, convexity) * (1 - tree_cover/100 * 0.5), 0, 1)

on the 30 m vegetation grid, where shallowness is 1 at <= 25 cm, 0 at >= 150 cm (linear),
terrain = min(slope / 35 deg, 1) + 0.5 * clip(TPI / 1.5 m, 0, 1) with TPI the 30 m cell's
height above the mean of the surrounding 150 m window (convex ground), and tree cover
from LANDFIRE EVC. Water (geology unit or soil map unit) is 0.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, reproject
from scipy.ndimage import uniform_filter

from .config import Tile, write_json
from .fetch_geology import GRID_PX, RESISTANCE, ROCK_CLASSES, fetch_geology, grid_transform

SHALLOW_CM, DEEP_CM = 25.0, 150.0
SLOPE_FULL_DEG = 35.0
TPI_WINDOW_CELLS = 5          # 5 x 30 m = 150 m
TPI_FULL_M = 1.5
CONVEX_BONUS = 0.5
CANOPY_DAMP = 0.5
FORMULA = ("outcrop = clip(resistance[rock_class] * shallowness * terrain * (1 - tree_cover_pct/100 * 0.5), 0, 1); "
           "shallowness = clip((150 - depth_to_bedrock_cm) / (150 - 25), 0, 1) (0 where depth unknown); "
           "terrain = min(slope_deg / 35, 1) + 0.5 * clip(TPI_m / 1.5, 0, 1), TPI = z - mean(z, 150 m window) "
           "on the DEM averaged to 30 m; tree cover from LANDFIRE EVC; water = 0")


def _dem30(tile: Tile) -> np.ndarray:
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        z = src.read(1).astype("float32")
        nod = src.nodata
        if nod is not None and (z == nod).any():
            z[z == nod] = z[z != nod].mean()
        out = np.zeros((GRID_PX, GRID_PX), "float32")
        reproject(z, out, src_transform=src.transform, src_crs=src.crs, dst_transform=grid_transform(tile),
                  dst_crs=tile.crs, resampling=Resampling.average)
    return out


def _tree_cover(tile: Tile) -> np.ndarray:
    with rasterio.open(tile.path("vegetation/evc.tif")) as src:
        evc = src.read(1)
    if evc.shape != (GRID_PX, GRID_PX):
        raise RuntimeError(f"vegetation grid {evc.shape} != {GRID_PX}")
    return np.where((evc >= 101) & (evc <= 199), evc - 100, 0).astype("float32")


def outcrop(tile: Tile) -> tuple[dict, dict]:
    geo = np.asarray(Image.open(tile.path("client/geology.png")))
    soil = np.asarray(Image.open(tile.path("client/soils.png")))
    gcls = json.loads(tile.path("geology/classes.json").read_text())
    scls = json.loads(tile.path("soils/classes.json").read_text())["mapunits"]

    res_lut = np.full(256, RESISTANCE["other"], "float32")
    for i, c in enumerate(ROCK_CLASSES, 1):
        res_lut[i] = RESISTANCE[c]
    resistance = res_lut[geo[..., 1]]

    depth_dm = soil[..., 2].astype("float32")
    depth_cm = depth_dm * 10
    shallow = np.clip((DEEP_CM - depth_cm) / (DEEP_CM - SHALLOW_CM), 0, 1)
    shallow[depth_dm >= 255] = 0

    z = _dem30(tile)
    res = 10000 / GRID_PX
    gy, gx = np.gradient(z, res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    tpi = z - uniform_filter(z, TPI_WINDOW_CELLS, mode="nearest")
    terrain = np.minimum(slope / SLOPE_FULL_DEG, 1) + CONVEX_BONUS * np.clip(tpi / TPI_FULL_M, 0, 1)

    tree = _tree_cover(tile)
    canopy = 1 - tree / 100 * CANOPY_DAMP

    o = np.clip(resistance * shallow * terrain * canopy, 0, 1)
    water = np.zeros(o.shape, bool)
    for i, u in gcls["units"].items():
        if u.get("water"):
            water |= geo[..., 0] == int(i)
    for i, u in scls.items():
        if (u.get("muname") or "").strip().lower() == "water":
            water |= soil[..., 0] == int(i)
    o[water] = 0
    img = np.round(o * 255).astype("uint8")
    Image.fromarray(img, "L").save(tile.path("client/outcrop.png"), optimize=True)

    stats = {"mean": round(float(o.mean()), 4), "fraction_above_0.5": round(float((o > 0.5).mean()), 4),
             "fraction_above_0.25": round(float((o > 0.25).mean()), 4),
             "slope_deg_mean": round(float(slope.mean()), 2), "convex_fraction": round(float((tpi > 0).mean()), 4)}
    info = {"path": "client/outcrop.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": GRID_PX, "resolution_m": res, "encoding": "R = outcrop likelihood 0..255 (0..1)",
            "derived_from": ["client.geology", "client.soils", "terrain.dem", "vegetation.evc"],
            "formula": FORMULA, "resistance": RESISTANCE,
            "params": {"shallow_cm": SHALLOW_CM, "deep_cm": DEEP_CM, "slope_full_deg": SLOPE_FULL_DEG,
                       "tpi_window_m": TPI_WINDOW_CELLS * res, "tpi_full_m": TPI_FULL_M, "convex_bonus": CONVEX_BONUS,
                       "canopy_damp": CANOPY_DAMP},
            **stats}
    return info, {"outcrop": o, "depth_cm": np.where(depth_dm >= 255, np.nan, depth_cm), "geo": geo, "soil": soil}


def ground_classes(tile: Tile, arrays: dict, out_info: dict) -> dict:
    geo, soil = arrays["geo"], arrays["soil"]
    gcls = json.loads(tile.path("geology/classes.json").read_text())
    scls = json.loads(tile.path("soils/classes.json").read_text())["mapunits"]
    total = geo[..., 0].size

    rock = {c: round(float((geo[..., 1] == i).sum() / total), 4) for i, c in enumerate(ROCK_CLASSES, 1)}
    tex, mod = {}, {}
    for i, u in scls.items():
        n = float((soil[..., 0] == int(i)).sum() / total)
        tex[u["texture_class"]] = tex.get(u["texture_class"], 0) + n
        mod[u["texture_modifier"]] = mod.get(u["texture_modifier"], 0) + n
    unmapped = float((soil[..., 0] == 0).sum() / total)
    if unmapped:
        tex["unmapped"] = unmapped
    frag = soil[..., 1][soil[..., 0] > 0].astype(float)
    d = arrays["depth_cm"]
    dv = d[~np.isnan(d)]
    bins = [("0-25", 0, 25), ("25-50", 25, 50), ("50-100", 50, 100), ("100-150", 100, 150), (">=150", 150, 1e9)]
    depth_dist = {k: round(float(((dv >= lo) & (dv < hi)).sum() / total), 4) for k, lo, hi in bins}
    depth_dist["none_or_unknown"] = round(float(np.isnan(d).sum() / total), 4)

    out = {
        "rock_classes": ROCK_CLASSES, "resistance": RESISTANCE,
        "geology": {"encoding": "client/geology.png R = unit index, G = rock class index (1-based into rock_classes)",
                    "units": {i: {"name": u["name"], "rock_class": u["rock_class"], "age": u["age"],
                                  "lithology": u["lithology"], "fraction": u["fraction"]} for i, u in gcls["units"].items()},
                    "source": gcls["source"]["source"]},
        "soils": {"encoding": "client/soils.png R = map unit index, G = surface rock fragments %, B = depth to bedrock dm (255 none)",
                  "mapunits": {i: {k: u.get(k) for k in ("musym", "muname", "component", "texture_class", "texture_modifier",
                                                         "surface_texture", "rock_fragments_pct", "depth_to_bedrock_cm",
                                                         "bedrock_restriction", "rock_outcrop_pct", "rock_land",
                                                         "parent_material", "taxorder", "drainage", "fraction")}
                               for i, u in scls.items()}},
        "fractions": {"rock_class": {k: v for k, v in rock.items() if v},
                      "texture_class": {k: round(v, 4) for k, v in sorted(tex.items(), key=lambda kv: -kv[1])},
                      "texture_modifier": {k: round(v, 4) for k, v in sorted(mod.items(), key=lambda kv: -kv[1])},
                      "depth_to_bedrock": depth_dist},
        "rock_fragments_pct": {"min": float(frag.min()), "p10": float(np.percentile(frag, 10)),
                               "median": float(np.median(frag)), "p90": float(np.percentile(frag, 90)),
                               "max": float(frag.max()), "mean": round(float(frag.mean()), 1)} if frag.size else None,
        "depth_to_bedrock_cm": {"min": float(dv.min()), "median": float(np.median(dv)), "max": float(dv.max())} if dv.size else None,
        "outcrop": {k: out_info[k] for k in ("formula", "mean", "fraction_above_0.5", "fraction_above_0.25")},
    }
    write_json(tile.path("client/ground_classes.json"), out)
    return {"path": "client/ground_classes.json", "kind": "table",
            "derived_from": ["client.geology", "client.soils", "client.outcrop"], "fractions": out["fractions"]}


def build_ground(tile: Tile, force=False) -> tuple[dict, list[str]]:
    layers, errors = {}, []
    try:
        layers.update(fetch_geology(tile, force))
    except Exception as e:  # noqa: BLE001
        errors.append(f"geology: {e}")
    try:
        from .fetch_soils import fetch_soils
        layers.update(fetch_soils(tile, force))
    except Exception as e:  # noqa: BLE001
        errors.append(f"soils (SDA): {e}")
    if "client.geology" in layers and "client.soils" in layers:
        info, arrays = outcrop(tile)
        layers["client.outcrop"] = info
        layers["client.ground_classes"] = ground_classes(tile, arrays, info)
    else:
        errors.append("outcrop and ground_classes skipped: geology and soils both required")
    return layers, errors
