"""The ecosystem map: an IUCN Global Ecosystem Typology functional group (EFG) for every 30 m cell, anywhere on Earth.

docs/world-pipeline.md, "Ecosystem". Keith et al. 2022 (Nature 610:513) define about 110 ecosystem functional groups
across land, fresh water and sea; the codes here are theirs (T1.1 tropical lowland rainforests, T4.1 trophic savannas, ...).
A cell's group comes from what is measured there, by rules a person can read:

  - the land cover (ESA WorldCover 10 m, the mode in the 30 m cell; LANDFIRE's EVT where the tile has it is kept beside),
  - the climate at the cell: the tile's ERA5 monthly normals moved to the cell's elevation by the standard lapse rate
    (6.5 deg C per km) and classified Koppen-Geiger again, so a tile's valley floor and its summits differ,
  - the canopy height and cover (lidar where flown, else the Meta / WRI map),
  - the soil (SoilGrids pH and clay: a fertile savanna is trophic, T4.1, a leached one pyric, T4.2),
  - the coast (sea cells, and the land within 60 m of them below 10 m elevation).

Human land (cropland, built-up) is rewilded: it takes the group most of its natural neighbours have within 1.5 km, else
the climate's default. Every rule is tagged in RULES so the manifest can say which fired how often.

Each group present has a card in library/ecosystems/<code>.json (written once, reused by every tile of the group): its
structure, plant functional types and their stand-in library species, ground, phenology, animal guilds and look.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import ndimage

from .config import REPO_ROOT

CARDS_DIR = REPO_ROOT / "library" / "ecosystems"

# Codes used by the classifier, with the GET names (Keith et al. 2022). Index = the value in ecosystem.tif (0 = none).
EFG = [
    (None, "none"),
    ("T1.1", "Tropical/subtropical lowland rainforests"),
    ("T1.2", "Tropical/subtropical dry forests and thickets"),
    ("T1.3", "Tropical/subtropical montane rainforests"),
    ("T2.1", "Boreal and temperate high montane forests and woodlands"),
    ("T2.2", "Deciduous temperate forests"),
    ("T2.3", "Oceanic cool temperate rainforests"),
    ("T2.4", "Warm temperate laurophyll forests"),
    ("T2.6", "Temperate pyric sclerophyll forests and woodlands"),
    ("T3.1", "Seasonally dry tropical shrublands"),
    ("T3.2", "Seasonally dry temperate heath and shrublands"),
    ("T3.3", "Cool temperate heathlands"),
    ("T4.1", "Trophic savannas"),
    ("T4.2", "Pyric tussock savannas"),
    ("T4.4", "Temperate woodlands"),
    ("T4.5", "Temperate subhumid grasslands"),
    ("T5.1", "Semi-desert steppe"),
    ("T5.3", "Sclerophyll hot deserts and semi-deserts"),
    ("T5.4", "Cool deserts and semi-deserts"),
    ("T6.1", "Ice sheets, glaciers and perennial snowfields"),
    ("T6.2", "Polar/alpine cliffs, screes, outcrops and lava flows"),
    ("T6.3", "Polar tundra and deserts"),
    ("T6.4", "Temperate alpine grasslands and shrublands"),
    ("T6.5", "Tropical alpine grasslands and herbfields"),
    ("TF1.3", "Permanent marshes"),
    ("MFT1.2", "Intertidal forests and shrublands (mangroves)"),
    ("MT1.1", "Rocky shorelines"),
    ("MT1.3", "Sandy shorelines"),
    ("F1", "Rivers and streams"),
    ("F2", "Lakes"),
    ("M1", "Marine shelf"),
]
CODE = {c: i for i, (c, _) in enumerate(EFG) if c}
NAME = {c: n for c, n in EFG if c}

# WorldCover classes
TREE, SHRUB, GRASS, CROP, BUILT, BARE, SNOW, WATER, WETLAND, MANGROVE, MOSS = 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100


def koppen_grid(t_months: np.ndarray, p_months: list[float], lat: float) -> np.ndarray:
    """Koppen-Geiger per cell: t_months (12, H, W) deg C, p the tile's monthly precipitation (one column for the tile).
    Returns an array of short strings ('Af', 'BSh', 'Cfb', 'ET', ...). Vectorised Peel et al. (2007) rules."""
    from .fetch_global import koppen
    flat = t_months.reshape(12, -1)
    # the rules depend on T only through a few statistics: classify each distinct (rounded) temperature profile once
    key = np.round(flat, 1).T
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    cls = np.array([koppen(list(u), p_months, lat) for u in uniq], dtype="<U4")
    return cls[inv.ravel()].reshape(t_months.shape[1:])


def classify(wc: np.ndarray, dem: np.ndarray, chm: np.ndarray, climate: dict, lat: float, *,
             soil_ph: np.ndarray | None = None, soil_clay: np.ndarray | None = None, res_m: float = 30.0,
             sea: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    """The EFG index per cell (uint8) and a dict of rule counts. All inputs on the same 30 m grid.
    wc: WorldCover class (mode); dem: elevation (m, nan where none); chm: canopy height (m, mean); sea: bool mask."""
    H, W = wc.shape
    z0 = climate.get("elevation_m") or float(np.nanmedian(dem))
    dz = np.nan_to_num(dem, nan=z0) - z0
    t = np.array(climate["t_mean_c"], float)[:, None, None] - 0.0065 * dz[None]
    kg = koppen_grid(t, climate["precip_mm"], lat)
    P = float(climate["annual"]["precip_mm"])
    first, second = np.char.ljust(kg, 1).astype("<U1"), np.array([k[1:2] for k in kg.ravel()]).reshape(kg.shape)
    out = np.zeros((H, W), "uint8")
    rules: dict[str, int] = {}

    def put(mask, code, rule):
        m = mask & (out == 0)
        n = int(m.sum())
        if n:
            out[m] = CODE[code]
            rules[f"{rule} -> {code}"] = rules.get(f"{rule} -> {code}", 0) + n

    if sea is None:
        sea = np.zeros_like(wc, bool)
    tall = np.nan_to_num(chm, nan=0.0)
    A, B, C, D, E = (first == x for x in "ABCDE")
    arid_hot = B & np.char.endswith(kg, "h")
    fertile = np.zeros_like(wc, bool)
    if soil_ph is not None:
        fertile |= np.nan_to_num(soil_ph, nan=0) >= 6.5
    if soil_clay is not None:
        fertile |= np.nan_to_num(soil_clay, nan=0) >= 30
    # water first
    put(sea, "M1", "sea")
    water = wc == WATER
    lab, n = ndimage.label(water)
    if n:
        sizes = ndimage.sum(water, lab, range(1, n + 1))
        elong = np.zeros(n + 1)
        objs = ndimage.find_objects(lab)
        for i, sl in enumerate(objs, 1):
            hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            elong[i] = max(hh, ww) ** 2 / max(1.0, sizes[i - 1])   # a long thin body is a river
        put(water & (elong[lab] > 6), "F1", "water, long and thin")
    put(water, "F2", "water, compact")
    # shore: land within 60 m of the sea and below 10 m
    if sea.any():
        near = ndimage.binary_dilation(sea, iterations=max(1, int(round(60 / res_m))))
        shore = near & ~sea & (np.nan_to_num(dem, nan=99) < 10)
        put(shore & (wc == BARE) & (np.nan_to_num(dem, nan=0) > 2), "MT1.1", "shore, bare rock")
        put(shore & (wc == BARE), "MT1.3", "shore, bare low")
    put(wc == MANGROVE, "MFT1.2", "mangroves")
    put(wc == SNOW, "T6.1", "snow and ice")
    put(wc == WETLAND, "TF1.3", "herbaceous wetland")
    # bare ground and moss
    put((wc == BARE) & B & arid_hot, "T5.3", "bare, hot arid")
    put((wc == BARE) & B, "T5.4", "bare, cool arid")
    put((wc == BARE), "T6.2", "bare rock and scree")
    put((wc == MOSS) & (E | D), "T6.3", "moss and lichen, polar")
    put((wc == MOSS) & A, "T6.5", "moss and lichen, tropical alpine")
    put((wc == MOSS), "T6.4", "moss and lichen, alpine")
    # forests
    forest = (wc == TREE) | ((wc == SHRUB) & (tall >= 5))
    put(forest & A & np.isin(second, ["f", "m"]) & (t.mean(0) >= 20), "T1.1", "tree, tropical wet, lowland")
    put(forest & A & np.isin(second, ["f", "m"]), "T1.3", "tree, tropical wet, montane")
    put(forest & A & (tall >= 12), "T1.2", "tree, tropical seasonal, tall")
    put(forest & (A | arid_hot), "T4.2", "tree, tropical seasonal, open")
    put(forest & (C | D | E) & (P >= 2000), "T2.3", "tree, temperate, over 2,000 mm")
    put(forest & C & (second == "s"), "T2.6", "tree, Mediterranean")
    put(forest & C & (t.min(0) >= 5), "T2.4", "tree, warm temperate")
    put(forest & C, "T2.2", "tree, temperate")
    put(forest & D & np.isin(np.array([k[2:3] for k in kg.ravel()]).reshape(kg.shape), ["c", "d"]), "T2.1", "tree, boreal")
    put(forest & D, "T2.2", "tree, continental")
    put(forest & E, "T2.1", "tree, subpolar or high montane")
    put(forest & B, "T4.4", "tree, semi-arid")
    # shrubs and grass
    open_ = (wc == SHRUB) | (wc == GRASS)
    put(open_ & (A | arid_hot) & fertile, "T4.1", "open, tropical, fertile soil")
    put(open_ & (A | arid_hot) & (wc == SHRUB) & (P < 600), "T3.1", "shrub, tropical dry")
    put(open_ & (A | arid_hot), "T4.2", "open, tropical")
    put(open_ & B & (P < 250), "T5.4", "open, cool desert")
    put(open_ & B, "T5.1", "open, steppe")
    put(open_ & C & (second == "s") & (wc == SHRUB), "T3.2", "shrub, Mediterranean")
    put(open_ & C & (second == "s"), "T4.4", "grass, Mediterranean")
    coastal = np.zeros_like(wc, bool)
    if sea.any():
        coastal = ndimage.distance_transform_edt(~sea) * res_m < 8000
    put(open_ & (C | E | D) & coastal & (P >= 800) & (np.nan_to_num(dem, nan=0) < 400), "T3.3", "open, oceanic heath")
    put(open_ & E & (abs(lat) >= 60), "T6.3", "open, polar")
    put(open_ & (E | D) & (np.nan_to_num(dem, nan=0) >= 600), "T6.4", "open, alpine")
    put(open_ & (C | D), "T4.5", "open, temperate")
    put(open_ & E, "T6.4", "open, cold")
    # human land: the group most natural neighbours have, else by climate
    human = (wc == CROP) | (wc == BUILT)
    if human.any():
        rad = max(1, int(round(1500 / res_m)))
        natural = (out > 0) & ~human & ~np.isin(out, [CODE["M1"], CODE["F1"], CODE["F2"]])
        best = np.zeros_like(out)
        bestn = np.zeros(out.shape, "float32")
        for code in np.unique(out[natural]):
            dens = ndimage.uniform_filter(((out == code) & natural).astype("float32"), size=2 * rad + 1)
            take = dens > bestn
            best[take], bestn[take] = code, dens[take]
        m = human & (best > 0)
        out[m] = best[m]
        rules["human land, rewilded to its neighbours"] = int(m.sum())
    left = out == 0
    if left.any():
        clim = np.where(A, CODE["T4.2"], np.where(B, CODE["T5.1"], np.where(E, CODE["T6.3"], CODE["T4.5"])))
        out[left] = clim[left]
        rules["no rule, by climate"] = int(left.sum())
    return out, rules


def summary(efg: np.ndarray, kg_point: str) -> dict:
    u, c = np.unique(efg[efg > 0], return_counts=True)
    tot = max(1, int(c.sum()))
    groups = sorted(({"code": EFG[i][0], "name": EFG[i][1], "share": round(int(n) / tot, 4),
                      "card": card_status(EFG[i][0])} for i, n in zip(u, c)), key=lambda g: -g["share"])
    return {"koppen_at_point": kg_point, "groups": groups,
            "legend": {str(i): c for i, (c, _) in enumerate(EFG) if c}}


def card_path(code: str) -> Path:
    return CARDS_DIR / f"{code}.json"


def card_status(code: str) -> str:
    return "written" if card_path(code).exists() else "missing"


def load_card(code: str) -> dict | None:
    p = card_path(code)
    return json.loads(p.read_text()) if p.exists() else None
