"""Data-driven species mix per 30 m cell, from the LANDFIRE community names.

The client's first pass used one fixed species mix per habitat class. LANDFIRE EVT already
names the actual community ("California Lower Montane Blue Oak-Foothill Pine Woodland and
Savanna", "Mediterranean California Dry-Mesic Mixed Conifer Forest and Woodland", ...), so each
EVT code in the tile is mapped by keyword rules on its name to weights over the library's tree
and shrub species plus tree and shrub density multipliers. Human cells (Developed, Agricultural, Quarries)
take the rule of their Biophysical Settings name instead, so rewilded cells get the community
that would grow there.

Products (client/, on the 30 m vegetation grid, row 0 = north). Format 2 (2026-10-25): any number of
species. A cell carries only its row and its two density multipliers; the rows carry the weights.
  species_mix_index.png    L     row index into species_mix.json "mixes" (0 = none); RGB (R low byte,
                                 G high byte) if a tile ever has more than 255 rows ("cells.index_bytes": 2)
  species_mix_density.png  RGB   R tree_density, G shrub_density (multiplier = byte / 100), B 0
  species_mix.json         "format": 2, the species columns, the code -> mix table actually used (each
                           row's weights as bytes summing to 255 per layer), per-tile fractions
The weights were never varied per cell (every cell of a row had the row's bytes), so nothing is lost.
Format 1 (four RGBA/RGB weight PNGs and mixes[].bytes with a bytes_layout) is read by the client
for tiles built before; this module no longer writes it.

Every rule is a first guess meant to be tuned in the viewer, like the habitat tables.
"""
from __future__ import annotations

import json
import pathlib
import warnings

import numpy as np
import rasterio
from PIL import Image

from .config import Tile, sha256
from .habitat import CLASSES, HUMAN_PHYS_PREFIXES, rewilded_cells

# Column order of the species (format 2: `species` in species_mix.json, and the order of each row's
# tree_bytes / shrub_bytes, which is the order the client draws species in). These are the species of
# format 1 in its column order, so every existing row keeps its draws bit-identical; a species a rule
# names that is not listed here is appended after them, in the order the rules first name it (columns()).
# Ids are the library's canonical ids (library/species/<id>.json).
TREES = ["quercus_douglasii", "quercus_wislizeni", "pinus_sabiniana", "pinus_ponderosa",
         "salix_lasiolepis", "alnus_rhombifolia", "populus_fremontii"]
SHRUBS = ["arctostaphylos_viscida", "adenostoma_fasciculatum"]
# Short names for the per-tile fraction tables (older docs and reports use them); other species use their id.
SHORT = {"quercus_douglasii": "blue_oak", "quercus_wislizeni": "live_oak", "pinus_sabiniana": "gray_pine",
         "pinus_ponderosa": "ponderosa", "arctostaphylos_viscida": "manzanita", "adenostoma_fasciculatum": "chamise",
         "salix_lasiolepis": "willow", "alnus_rhombifolia": "alder", "populus_fremontii": "cottonwood"}
FORMAT = 2
DENSITY_SCALE = 100   # density byte = round(multiplier * 100); 1.0 = the client's per-habitat-class count
LIBRARY = pathlib.Path(__file__).resolve().parent.parent / "library" / "species"

BLACK_OAK = "black oak (Quercus kelloggii) is not in the library: quercus_wislizeni stands in"
LIVE_OAK_STANDIN = "canyon live oak, madrone and Douglas-fir are not in the library: quercus_wislizeni and pinus_ponderosa stand in"
RIPARIAN = ("valley oak, Oregon ash, bigleaf maple and box elder are not in the library: quercus_douglasii stands in "
            "for valley oak on the banks; the riparian understory (blackberry, wild rose, spicebush) is not in the "
            "library either, so the shrub layer is thin")
CONIFER = "sugar pine, incense cedar, white fir and Douglas-fir are not in the library: pinus_ponderosa stands in"


def _r(rid, kws, trees, shrubs, td, sd, note=None, any_of=False):
    return {"id": rid, "keywords": kws, "any": any_of, "trees": trees, "shrubs": shrubs,
            "tree_density": td, "shrub_density": sd, "note": note}


# Ordered: the first rule whose keywords all appear in the lower-cased name wins
# (any_of=True: any one keyword). Specific before general.
RULES = [
    _r("open_water", ["open water"], {}, {}, 0.0, 0.0),
    _r("wet_meadow_marsh", ["marsh", "wet meadow"], {"salix_lasiolepis": 0.8, "quercus_wislizeni": 0.2}, {"arctostaphylos_viscida": 1},
       0.05, 0.05, "herbaceous wetland: almost no woody plants, a few willows at the edge", any_of=True),
    # Riparian (2026-10-25): arroyo willow thickets at the water, white alder rooted in the bank, Fremont
    # cottonwood scattered on the floodplain, interior live oak (and blue oak for valley oak) up the banks.
    _r("riparian_shrubland", ["riparian", "shrubland"],
       {"salix_lasiolepis": 0.75, "alnus_rhombifolia": 0.1, "quercus_wislizeni": 0.15},
       {"arctostaphylos_viscida": 0.5, "adenostoma_fasciculatum": 0.5}, 1.2, 0.2,
       "willow scrub: arroyo willow is the shrubland; " + RIPARIAN),
    _r("montane_riparian", ["montane riparian systems"],
       {"alnus_rhombifolia": 0.4, "salix_lasiolepis": 0.25, "quercus_wislizeni": 0.15, "pinus_ponderosa": 0.12,
        "populus_fremontii": 0.08},
       {"arctostaphylos_viscida": 1}, 1.3, 0.3, "alder-willow streamside forest with some pine; " + RIPARIAN),
    _r("riparian", ["riparian"],
       {"salix_lasiolepis": 0.38, "alnus_rhombifolia": 0.24, "populus_fremontii": 0.1, "quercus_wislizeni": 0.2,
        "quercus_douglasii": 0.08},
       {"arctostaphylos_viscida": 1}, 1.6, 0.3, RIPARIAN),
    _r("blue_oak_foothill_pine", ["blue oak", "foothill pine"],
       {"quercus_douglasii": 0.65, "quercus_wislizeni": 0.1, "pinus_sabiniana": 0.25},
       {"arctostaphylos_viscida": 0.5, "adenostoma_fasciculatum": 0.5}, 1.0, 0.5),
    _r("blue_oak", ["blue oak"], {"quercus_douglasii": 0.85, "quercus_wislizeni": 0.1, "pinus_sabiniana": 0.05},
       {"arctostaphylos_viscida": 0.4, "adenostoma_fasciculatum": 0.6}, 1.0, 0.4),
    _r("foothill_pine", ["foothill pine"], {"pinus_sabiniana": 0.6, "quercus_douglasii": 0.25, "quercus_wislizeni": 0.15},
       {"arctostaphylos_viscida": 0.4, "adenostoma_fasciculatum": 0.6}, 0.9, 1.0),
    _r("black_oak_conifer", ["black oak", "conifer"], {"pinus_ponderosa": 0.55, "quercus_wislizeni": 0.4, "pinus_sabiniana": 0.05},
       {"arctostaphylos_viscida": 0.8, "adenostoma_fasciculatum": 0.2}, 1.1, 0.6, BLACK_OAK),
    _r("black_oak", ["black oak"], {"quercus_wislizeni": 0.7, "pinus_ponderosa": 0.3},
       {"arctostaphylos_viscida": 0.9, "adenostoma_fasciculatum": 0.1}, 1.0, 0.5, BLACK_OAK),
    _r("mixed_oak_savanna", ["mixed oak savanna"], {"quercus_douglasii": 0.6, "quercus_wislizeni": 0.35, "pinus_sabiniana": 0.05},
       {"arctostaphylos_viscida": 0.3, "adenostoma_fasciculatum": 0.7}, 0.6, 0.3,
       "valley oak (Quercus lobata) is not in the library: quercus_douglasii stands in"),
    _r("mixed_oak", ["mixed oak"], {"quercus_douglasii": 0.4, "quercus_wislizeni": 0.45, "pinus_sabiniana": 0.15},
       {"arctostaphylos_viscida": 0.6, "adenostoma_fasciculatum": 0.4}, 1.0, 0.6),
    _r("mixed_evergreen", ["mixed evergreen"], {"quercus_wislizeni": 0.55, "pinus_ponderosa": 0.45},
       {"arctostaphylos_viscida": 1}, 1.2, 0.5, LIVE_OAK_STANDIN),
    _r("ponderosa_jeffrey", ["ponderosa", "jeffrey pine"], {"pinus_ponderosa": 0.9, "quercus_wislizeni": 0.1},
       {"arctostaphylos_viscida": 0.9, "adenostoma_fasciculatum": 0.1}, 0.8, 0.8,
       "Jeffrey pine is not in the library: pinus_ponderosa stands in", any_of=True),
    _r("dry_mesic_mixed_conifer", ["dry-mesic mixed conifer"], {"pinus_ponderosa": 0.8, "quercus_wislizeni": 0.2},
       {"arctostaphylos_viscida": 1}, 1.0, 0.6, CONIFER),
    _r("mesic_mixed_conifer", ["mixed conifer"], {"pinus_ponderosa": 0.85, "quercus_wislizeni": 0.15},
       {"arctostaphylos_viscida": 1}, 1.2, 0.4, CONIFER),
    _r("lower_montane_conifer", ["lower montane conifer"], {"pinus_ponderosa": 0.75, "quercus_wislizeni": 0.15, "pinus_sabiniana": 0.1},
       {"arctostaphylos_viscida": 0.85, "adenostoma_fasciculatum": 0.15}, 1.0, 0.6, CONIFER + "; black oak as quercus_wislizeni"),
    _r("montane_woodland_chaparral", ["montane woodland and chaparral"],
       {"quercus_wislizeni": 0.5, "pinus_ponderosa": 0.3, "pinus_sabiniana": 0.2},
       {"arctostaphylos_viscida": 0.8, "adenostoma_fasciculatum": 0.2}, 0.6, 1.0, LIVE_OAK_STANDIN),
    _r("serpentine_woodland", ["serpentine", "woodland"], {"pinus_sabiniana": 0.6, "quercus_wislizeni": 0.4},
       {"arctostaphylos_viscida": 0.6, "adenostoma_fasciculatum": 0.4}, 0.6, 1.0,
       "leather oak and McNab cypress are not in the library"),
    _r("xeric_chaparral", ["xeric", "chaparral"], {"pinus_sabiniana": 0.7, "quercus_wislizeni": 0.3},
       {"adenostoma_fasciculatum": 0.8, "arctostaphylos_viscida": 0.2}, 0.15, 1.0),
    _r("dry_mesic_chaparral", ["dry-mesic chaparral"], {"pinus_sabiniana": 0.6, "quercus_wislizeni": 0.4},
       {"adenostoma_fasciculatum": 0.65, "arctostaphylos_viscida": 0.35}, 0.3, 1.0),
    _r("mesic_chaparral", ["mesic", "chaparral"], {"quercus_wislizeni": 0.6, "pinus_sabiniana": 0.4},
       {"arctostaphylos_viscida": 0.6, "adenostoma_fasciculatum": 0.4}, 0.35, 1.0,
       "scrub oak and ceanothus are not in the library"),
    _r("chaparral", ["chaparral"], {"pinus_sabiniana": 0.6, "quercus_wislizeni": 0.4},
       {"adenostoma_fasciculatum": 0.6, "arctostaphylos_viscida": 0.4}, 0.3, 1.0),
    _r("ruderal_forest", ["ruderal forest"],
       {"quercus_wislizeni": 0.4, "quercus_douglasii": 0.25, "pinus_sabiniana": 0.2, "pinus_ponderosa": 0.15},
       {"arctostaphylos_viscida": 0.5, "adenostoma_fasciculatum": 0.5}, 0.8, 0.8,
       "disturbed regrowth of mixed composition: a generic foothill blend"),
    _r("ruderal_scrub", ["ruderal scrub"], {"pinus_sabiniana": 0.5, "quercus_wislizeni": 0.5},
       {"adenostoma_fasciculatum": 0.5, "arctostaphylos_viscida": 0.5}, 0.2, 0.8,
       "disturbed scrub (broom, blackberry): native chaparral shrubs stand in"),
    _r("great_basin_shrub", ["greasewood", "sagebrush"], {"pinus_sabiniana": 1}, {"adenostoma_fasciculatum": 1}, 0.0, 0.6,
       "Great Basin shrub type in the foothills (LANDFIRE edge case): chamise stands in", any_of=True),
    _r("grassland_savanna", ["grassland", "savanna", "prairie", "meadow"], {"quercus_douglasii": 0.85, "pinus_sabiniana": 0.15},
       {"adenostoma_fasciculatum": 1}, 1.0, 0.3, "sparse blue oak savanna over annual grass", any_of=True),
    _r("sparse_rock", ["cliff", "canyon", "sparsely vegetated", "barren"], {"pinus_sabiniana": 0.5, "quercus_wislizeni": 0.5},
       {"adenostoma_fasciculatum": 0.6, "arctostaphylos_viscida": 0.4}, 0.25, 0.3, any_of=True),
]

# Rewilded water beds (habitat.rewilded_cells): not LANDFIRE communities, so not matched by name.
# The corridor along the restored channel is a young riparian strip: willow dominant at the water, alder next,
# a few cottonwoods, live oak where it climbs the old bed's banks; no pine and no chaparral shrubs.
# The meadow keeps a few scattered oaks.
REWILD_MEADOW = _r("rewilded_meadow", [], {"quercus_douglasii": 0.85, "quercus_wislizeni": 0.15}, {}, 0.5, 0.0,
                   "former reservoir or stock-pond bed: wet meadow (sedge, rush, perennial grass) with scattered oaks; "
                   "valley oak (Quercus lobata) is not in the library: quercus_douglasii stands in")
REWILD_RIPARIAN = _r("rewilded_riparian", [],
                     {"salix_lasiolepis": 0.45, "alnus_rhombifolia": 0.25, "populus_fremontii": 0.12, "quercus_wislizeni": 0.18},
                     {}, 2.0, 0.0, "riparian corridor along the restored channel through a former bed; " + RIPARIAN)

# Fallback when no keyword matches: the client's original fixed mix per habitat class (vegetation.js MIX).
HABITAT_DEFAULT = {
    1: ({"quercus_douglasii": 0.55, "quercus_wislizeni": 0.25, "pinus_sabiniana": 0.2}, {"arctostaphylos_viscida": 1}),
    2: ({"pinus_ponderosa": 0.7, "pinus_sabiniana": 0.12, "quercus_wislizeni": 0.18}, {"arctostaphylos_viscida": 1}),
    3: ({"pinus_ponderosa": 0.3, "quercus_wislizeni": 0.3, "quercus_douglasii": 0.2, "pinus_sabiniana": 0.2}, {"arctostaphylos_viscida": 1}),
    4: ({"pinus_sabiniana": 1.0}, {"adenostoma_fasciculatum": 0.6, "arctostaphylos_viscida": 0.4}),
    5: ({"quercus_douglasii": 0.85, "pinus_sabiniana": 0.15}, {"adenostoma_fasciculatum": 1}),
    6: ({"quercus_wislizeni": 0.6, "quercus_douglasii": 0.2, "pinus_ponderosa": 0.2}, {"arctostaphylos_viscida": 1}),
}


def match(name: str) -> dict | None:
    n = (name or "").lower()
    for rule in RULES:
        hit = any(k in n for k in rule["keywords"]) if rule["any"] else all(k in n for k in rule["keywords"])
        if hit:
            return rule
    return None


def _fallback(hab_code: int) -> dict:
    trees, shrubs = HABITAT_DEFAULT.get(hab_code, ({}, {}))
    d = 1.0 if hab_code in HABITAT_DEFAULT else 0.0
    return {"id": f"habitat_default_{CLASSES.get(hab_code, 'none')}", "trees": trees, "shrubs": shrubs,
            "tree_density": d, "shrub_density": d, "note": "no keyword rule matched: habitat-class default mix"}


def _bytes(weights: dict, slots: list[str]) -> list[int]:
    """Weights over slots as bytes summing to exactly 255 (largest remainder, ties to the earlier
    column), or all zero."""
    w = np.array([max(float(weights.get(s, 0)), 0.0) for s in slots])
    if w.sum() <= 0:
        return [0] * len(slots)
    x = w / w.sum() * 255
    b = np.floor(x).astype(int)
    for i in np.argsort(-(x - b), kind="stable")[: 255 - b.sum()]:
        b[i] += 1
    return [int(v) for v in b]


def columns(rules: list[dict]) -> tuple[list[str], list[str]]:
    """Tree and shrub columns: TREES / SHRUBS, then any other species the rules name, in order."""
    trees, shrubs = list(TREES), list(SHRUBS)
    for r in rules:
        for k in r["trees"]:
            if k not in trees:
                trees.append(k)
        for k in r["shrubs"]:
            if k not in shrubs:
                shrubs.append(k)
    for sid in trees + shrubs:
        if not (LIBRARY / f"{sid}.json").exists():
            warnings.warn(f"species mix names {sid}, which has no library/species/{sid}.json; the client skips it")
    return trees, shrubs


def _is_human(e: dict) -> bool:
    return (e.get("phys") or "").startswith(HUMAN_PHYS_PREFIXES) or e.get("habitat") == "human"


def species_mix(tile: Tile) -> dict:
    classes = json.loads(tile.path("vegetation/classes.json").read_text())
    evt_tab, bps_tab = classes.get("evt", {}), classes.get("bps", {})
    with rasterio.open(tile.path("vegetation/evt.tif")) as src:
        evt = src.read(1)
        res = src.res[0]
    with rasterio.open(tile.path("vegetation/bps.tif")) as src:
        bps = src.read(1)
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        hab = src.read(1)
    with rasterio.open(tile.path("vegetation/evc.tif")) as src:
        evc = src.read(1)
    tree_cover = np.where((evc >= 101) & (evc <= 199), evc - 100, 0).astype("float64")
    assert evt.shape == bps.shape == hab.shape, "vegetation rasters must share the 30 m grid"

    # Resolve each cell to a (source, code) row: EVT for natural cells, BpS for human ones,
    # habitat class when a code is missing from the tables.
    rows: dict[tuple, dict] = {}
    index = np.zeros(evt.shape, "int64")
    unmatched = []

    def row_for(source: str, code: int, name: str | None, hab_code: int, rule: dict | None = None) -> int:
        key = (source, code)
        if key not in rows:
            rule = rule or (match(name) if name else None)
            if rule is None:
                rule = _fallback(hab_code)
                unmatched.append({"source": source, "code": code, "name": name, "habitat": CLASSES.get(hab_code)})
            rows[key] = {"index": len(rows) + 1, "source": source, "code": code, "name": name, "rule": rule["id"],
                         "trees": {k: v for k, v in rule["trees"].items() if v},
                         "shrubs": {k: v for k, v in rule["shrubs"].items() if v},
                         "tree_density": rule["tree_density"], "shrub_density": rule["shrub_density"],
                         "note": rule.get("note"), "cells": 0}
            if rows[key]["index"] > 65535:
                raise ValueError("more than 65535 distinct mixes; species_mix_index.png holds 16 bits")
        return rows[key]["index"]

    combos = np.unique(np.stack([evt.ravel(), bps.ravel(), hab.ravel()], 1), axis=0)
    for e_code, b_code, h_code in combos.tolist():
        e = evt_tab.get(str(e_code))
        if e and not _is_human(e):
            idx = row_for("evt", e_code, e.get("name"), h_code)
        else:
            b = bps_tab.get(str(b_code))
            if b and b.get("habitat") not in (None, "human"):
                idx = row_for("bps", b_code, b.get("name"), h_code)
            else:   # BpS human/unknown: grassland savanna, as habitat.py backfills
                idx = row_for("habitat", h_code, None, h_code if h_code != 9 else 5)
        index[(evt == e_code) & (bps == b_code) & (hab == h_code)] = idx

    # Former reservoir and stock-pond beds: their own rows, whatever EVT says (open water, mostly).
    with rasterio.open(tile.path("vegetation/habitat_present.tif")) as src:
        cells = rewilded_cells(tile, src.read(1))
    if cells is not None:
        for k, (sel, rule) in enumerate(zip(cells, (REWILD_MEADOW, REWILD_RIPARIAN))):
            if sel.any():
                index[sel] = row_for("rewild", k + 1, rule["id"].replace("_", " "), 5 if k == 0 else 6, rule)

    table = sorted(rows.values(), key=lambda r: r["index"])
    trees_cols, shrub_cols = columns(table)
    nt, ns = len(trees_cols), len(shrub_cols)
    # Per-row bytes: tree weights over the tree columns, shrub weights over the shrub columns (each
    # summing to 255 or all zero), then the two density bytes. lut[0] (no mix) is all zero.
    lut = np.zeros((len(table) + 1, nt + ns + 2), "int64")
    for r in table:
        tb, sb = _bytes(r["trees"], trees_cols), _bytes(r["shrubs"], shrub_cols)
        td = min(round(r["tree_density"] * DENSITY_SCALE), 255)
        sd = min(round(r["shrub_density"] * DENSITY_SCALE), 255)
        lut[r["index"]] = tb + sb + [td, sd]
        r["cells"] = int((index == r["index"]).sum())
        r["tree_bytes"] = [[k, b] for k, b in zip(trees_cols, tb) if b]
        r["shrub_bytes"] = [[k, b] for k, b in zip(shrub_cols, sb) if b]
        r["density_bytes"] = [td, sd]
    px = lut[index]
    TD, SD = nt + ns, nt + ns + 1
    for old in ("species_mix_a.png", "species_mix_b.png", "species_mix_c.png"):   # format 1 products
        if tile.path(f"client/{old}").exists():
            tile.path(f"client/{old}").unlink()
    index_bytes = 1 if len(table) <= 255 else 2
    if index_bytes == 1:
        Image.fromarray(index.astype("uint8"), "L").save(tile.path("client/species_mix_index.png"), optimize=True)
    else:
        rgb = np.stack([index & 255, index >> 8, np.zeros_like(index)], -1).astype("uint8")
        Image.fromarray(rgb, "RGB").save(tile.path("client/species_mix_index.png"), optimize=True)
    dens = np.stack([px[..., TD], px[..., SD], np.zeros_like(px[..., TD])], -1).astype("uint8")
    Image.fromarray(dens, "RGB").save(tile.path("client/species_mix_density.png"), optimize=True)

    # Per-tile fractions
    n = index.size
    td = px[..., TD].astype("float64") / DENSITY_SCALE
    sd = px[..., SD].astype("float64") / DENSITY_SCALE

    def share(cols, names, weight):
        w = px[..., cols].astype("float64") / 255 * weight[..., None]
        tot = w.sum()
        return {SHORT.get(s, s): round(float(w[..., i].sum() / tot), 4) if tot else 0.0 for i, s in enumerate(names)}

    by_rule: dict[str, int] = {}
    for r in table:
        by_rule[r["rule"]] = by_rule.get(r["rule"], 0) + r["cells"]
    tcols, scols = list(range(nt)), list(range(nt, nt + ns))
    fractions = {
        "from_evt": round(sum(r["cells"] for r in table if r["source"] == "evt") / n, 4),
        "from_bps_backfill": round(sum(r["cells"] for r in table if r["source"] != "evt") / n, 4),
        "tree_share": share(tcols, trees_cols, td),
        "tree_share_by_canopy": share(tcols, trees_cols, td * tree_cover),
        "shrub_share": share(scols, shrub_cols, sd),
        "mean_tree_density": round(float(td.mean()), 4),
        "mean_shrub_density": round(float(sd.mean()), 4),
        "rules": {k: round(v / n, 4) for k, v in sorted(by_rule.items(), key=lambda kv: -kv[1])},
    }
    doc = {
        "format": FORMAT,
        "grid": {"crs": tile.crs, "bounds": list(tile.bounds), "pixels": int(index.shape[0]), "resolution_m": res,
                 "origin": "row 0 = north edge, same grid as client/habitat.png"},
        "species": {"trees": trees_cols, "shrubs": shrub_cols},
        "cells": {
            "index": "client/species_mix_index.png", "index_bytes": index_bytes,
            "density": "client/species_mix_density.png",
        },
        "encoding": {
            "index": "species_mix_index.png: the cell's row in mixes (0 = no mix: the client's habitat-class mix). "
                     "8-bit grey; with index_bytes 2, RGB with the row = R + 256 G",
            "density": f"species_mix_density.png RGB: R tree_density, G shrub_density, multiplier = byte / {DENSITY_SCALE} "
                       "on the client's per-habitat-class plant count (1.0 = the fixed-mix count; the count still scales "
                       "with client/canopy.png cover); B unused. The same bytes as the row's density_bytes",
            "weights": "mixes[].tree_bytes and shrub_bytes: [[species id, byte], ...], the species with a non-zero weight "
                       "in the column order of `species`, each layer summing to 255 (absent: no trees or no shrubs). "
                       "The client draws a species by walking this list in order, so the order is part of the format",
        },
        "mixes": table,
        "unmatched": unmatched,
        "fractions": fractions,
    }
    tile.path("client/species_mix.json").write_text(json.dumps(doc, indent=1))
    files = ["client/species_mix_index.png", "client/species_mix_density.png"]
    return {"path": "client/species_mix.json", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": int(index.shape[0]), "resolution_m": res, "format": FORMAT,
            "files": {f: {"sha256": sha256(tile.path(f)), "bytes": tile.path(f).stat().st_size} for f in files},
            "derived_from": ["vegetation.evt", "vegetation.bps", "vegetation.classes", "vegetation.habitat", "vegetation.evc"],
            "encoding": "format 2: species_mix_index L = row in mixes; species_mix_density RGB = tree_density, shrub_density "
                        "(byte/100); per-row weights as mixes[].tree_bytes / shrub_bytes over species.trees / species.shrubs",
            "species": {"trees": trees_cols, "shrubs": shrub_cols},
            "mixes": len(table), "unmatched": len(unmatched), "fractions": fractions}
