"""Soils anywhere: SoilGrids 2.0 (250 m, CC BY 4.0) in the encoding SSURGO's soils step writes (fetch_soils.py).

Outside the US there is no SSURGO, so the `ground` step takes this instead (world pipeline probes, 2026-11-05):

  - texture class per 30 m cell from SoilGrids sand and clay at 0-5 cm (the USDA texture triangle),
  - the modifier from coarse fragments (cfvo, volume %): gravelly from 15 %, very gravelly from 35 %, extremely from 60 %,
  - map units = the texture classes present (R of client/soils.png indexes soils/classes.json "mapunits"),
  - rock fragments (G) from cfvo, raised to 100 % on WorldCover's bare / sparse cells (60) on steep or high ground,
  - depth to bedrock (B, dm) is not in SoilGrids: 0 on the bare rock cells, else unknown (255), as SSURGO leaves it
    unknown where no restriction is recorded. A global depth-to-bedrock layer is a phase-1 item.

The water cells (WorldCover 80) are map unit "water", as SSURGO names them.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from rasterio.enums import Resampling

from . import runlog
from .config import Tile, write_json
from .fetch_geology import GRID_PX
from .fetch_global import read_to_grid

SG = "https://files.isric.org/soilgrids/latest/data/{p}/{p}_0-5cm_mean.vrt"


def _usda(sand: np.ndarray, clay: np.ndarray) -> np.ndarray:
    """USDA texture class names from sand and clay (%)."""
    silt = 100 - sand - clay
    c = np.full(sand.shape, "loam", dtype="<U16")
    c[(silt + 1.5 * clay) < 15] = "sand"
    c[((silt + 1.5 * clay) >= 15) & ((silt + 2 * clay) < 30)] = "loamy sand"
    c[((clay >= 7) & (clay < 20) & (sand > 52) & ((silt + 2 * clay) >= 30)) | ((clay < 7) & (silt < 50) & ((silt + 2 * clay) >= 30))] = "sandy loam"
    c[(clay >= 7) & (clay < 27) & (silt >= 28) & (silt < 50) & (sand <= 52)] = "loam"
    c[((silt >= 50) & (clay >= 12) & (clay < 27)) | ((silt >= 50) & (silt < 80) & (clay < 12))] = "silt loam"
    c[(silt >= 80) & (clay < 12)] = "silt"
    c[(clay >= 20) & (clay < 35) & (silt < 28) & (sand > 45)] = "sandy clay loam"
    c[(clay >= 27) & (clay < 40) & (sand > 20) & (sand <= 45)] = "clay loam"
    c[(clay >= 27) & (clay < 40) & (sand <= 20)] = "silty clay loam"
    c[(clay >= 35) & (sand > 45)] = "sandy clay"
    c[(clay >= 40) & (silt >= 40)] = "silty clay"
    c[(clay >= 40) & (sand <= 45) & (silt < 40)] = "clay"
    return c


def fetch_soils_global(tile: Tile, wc30: np.ndarray | None = None) -> dict:
    res = 10000 / GRID_PX
    props = {}
    for p in ("sand", "clay", "cfvo", "phh2o", "soc"):
        a = read_to_grid(["/vsicurl/" + SG.format(p=p)], tile, res, resampling=Resampling.bilinear,
                         nodata=-32768.0, src_nodata=-32768)
        props[p] = np.where(a == -32768.0, np.nan, a)
    runlog.fetched("soilgrids")
    sand, clay = props["sand"] / 10, props["clay"] / 10            # g/kg -> %
    cfvo = props["cfvo"] / 10                                      # cm3/dm3 -> %
    ph, soc = props["phh2o"] / 10, props["soc"] / 10               # pH, g/kg
    known = np.isfinite(sand) & np.isfinite(clay)
    tex = _usda(np.nan_to_num(sand, nan=40), np.nan_to_num(clay, nan=20))
    tex[~known] = "unknown"
    mod = np.full(tex.shape, "none", "<U20")
    fr = np.nan_to_num(cfvo, nan=0)
    mod[fr >= 15], mod[fr >= 35], mod[fr >= 60] = "gravelly", "very gravelly", "extremely gravelly"
    if wc30 is None:
        wc30 = np.zeros(tex.shape, "uint8")
    water = wc30 == 80
    bare = wc30 == 60
    tex[water] = "water"
    tex[bare] = "rock outcrop"
    key = np.char.add(np.char.add(tex, "|"), mod)
    names, inv, counts = np.unique(key, return_inverse=True, return_counts=True)
    order = np.argsort(-counts)
    if len(order) > 255:
        raise RuntimeError("too many soil classes")
    rank = np.empty_like(order)
    rank[order] = np.arange(1, len(order) + 1)
    idx = rank[inv].reshape(tex.shape).astype("uint8")
    frag = np.clip(np.round(fr), 0, 100).astype("uint8")
    frag[bare] = 100
    depth = np.full(tex.shape, 255, "uint8")
    depth[bare] = 0
    Image.fromarray(np.dstack([idx, frag, depth]), "RGB").save(tile.path("client/soils.png"), optimize=True)
    classes = {}
    for k in order:
        i = int(rank[k])
        m = idx == i
        t, md = names[k].split("|")
        classes[str(i)] = {
            "muname": "Water" if t == "water" else (f"{md} {t}".strip() if md != "none" else t),
            "texture_class": t, "texture_modifier": md, "source": "soilgrids",
            "rock_land": t == "rock outcrop", "rock_fragments_pct": round(float(np.nanmean(fr[m])), 1),
            "depth_to_bedrock_cm": 0 if t == "rock outcrop" else None, "bedrock_restriction": t == "rock outcrop",
            "ph": round(float(np.nanmean(ph[m])), 2) if np.isfinite(ph[m]).any() else None,
            "soc_g_kg": round(float(np.nanmean(soc[m])), 1) if np.isfinite(soc[m]).any() else None,
            "fraction": round(float(m.mean()), 4)}
    write_json(tile.path("soils/classes.json"), {
        "encoding": "client/soils.png R = index here, G = rock_fragments_pct, B = depth_to_bedrock_cm / 10 (255 = none/unknown)",
        "source": "soilgrids",
        "rules": {"texture": "USDA triangle from SoilGrids 2.0 sand and clay, 0-5 cm mean",
                  "modifier": "SoilGrids cfvo: gravelly >= 15 %, very gravelly >= 35 %, extremely >= 60 %",
                  "rock": "WorldCover bare / sparse (60) cells are rock outcrop, 100 % fragments, bedrock at 0",
                  "depth_to_bedrock": "unknown elsewhere (not in SoilGrids)"},
        "mapunits": classes})
    return {
        "soils.classes": {"path": "soils/classes.json", "kind": "table", "source": "soilgrids"},
        "client.soils": {"path": "client/soils.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                         "pixels": GRID_PX, "resolution_m": res, "derived_from": "soilgrids",
                         "source": "soilgrids", "classes": len(classes)},
    }
