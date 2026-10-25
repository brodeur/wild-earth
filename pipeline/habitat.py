"""Habitat classes and resource tables.

LANDFIRE's hundreds of vegetation types are collapsed into a handful of habitat
classes that gameplay and rendering can reason about. Resource scores (0-100) come
from habitat class, modulated by season, canopy cover, slope and water proximity.
Everything here is a first guess meant to be tuned in the viewer.
"""
from __future__ import annotations

CLASSES = {
    1: "oak_woodland", 2: "conifer_forest", 3: "mixed_forest", 4: "chaparral",
    5: "grassland", 6: "riparian", 7: "water", 8: "barren", 9: "human",
}
CODES = {v: k for k, v in CLASSES.items()}
COLORS = {  # RGB for viewers and the rewilded texture
    1: (171, 150, 72), 2: (34, 94, 58), 3: (88, 122, 60), 4: (134, 110, 92),
    5: (214, 196, 120), 6: (74, 142, 118), 7: (70, 130, 220), 8: (190, 185, 175), 9: (220, 60, 60),
}

HUMAN_PHYS_PREFIXES = ("Developed", "Agricultural", "Quarries")


def classify_evt(phys: str, name: str) -> int:
    n = name.lower()
    if phys.startswith(HUMAN_PHYS_PREFIXES):
        return 9
    if phys == "Open Water":
        return 7
    if phys in ("Sparsely Vegetated", "Snow-Ice", "Fill-NoData"):
        return 8
    if phys == "Riparian":
        return 6
    if phys == "Hardwood":
        return 1 if "oak" in n else 3
    if phys == "Conifer":
        return 3 if ("oak" in n or "foothill pine" in n) else 2
    if phys == "Conifer-Hardwood":
        return 3
    if phys in ("Shrubland", "Exotic Tree-Shrub"):
        return 4
    if phys in ("Grassland", "Exotic Herbaceous"):
        return 5
    return 8


def classify_bps(groupveg: str, name: str) -> int:
    g, n = groupveg.lower(), name.lower()
    if "riparian" in g or "riparian" in n:
        return 6
    if "hardwood" in g and "conifer" in g:
        return 3
    if "hardwood" in g:
        return 1 if "oak" in n else 3
    if "conifer" in g:
        return 3 if ("oak" in n or "foothill pine" in n) else 2
    if "shrub" in g or "chaparral" in n:
        return 4
    if "grass" in g or "savanna" in n or "prairie" in n:
        return 5
    if "water" in g:
        return 7
    if "sparse" in g or "barren" in g or "snow" in g:
        return 8
    return 5  # unknown: grassland is the safe foothill default


SEASONS = ["winter", "spring", "summer", "fall"]

# Base score by habitat class code. Missing class = 0.
RESOURCE_BASE = {
    "acorn_mast": {1: 90, 3: 50, 6: 30, 2: 10},
    "grass_forbs": {5: 90, 1: 60, 6: 30, 3: 25, 4: 10, 2: 5},
    "browse": {4: 80, 6: 70, 1: 50, 3: 50, 2: 30, 5: 10},
    "cover": {4: 90, 2: 85, 6: 85, 3: 80, 1: 60, 5: 10, 8: 15},
    "insects": {6: 90, 5: 70, 1: 60, 4: 50, 3: 50, 2: 40},
    "cavity": {1: 80, 3: 60, 6: 60, 2: 50},
    "cliff_or_snag": {2: 60, 3: 50, 1: 40, 8: 50},
    "burrow": {5: 80, 1: 60, 4: 50, 6: 40, 3: 30, 2: 20, 8: 20},
    "water": {7: 100},
}

# Seasonal multiplier for a Mediterranean foothill climate (dry summer, wet winter).
RESOURCE_SEASON = {
    "acorn_mast": {"winter": 0.5, "spring": 0.1, "summer": 0.05, "fall": 1.0},
    "grass_forbs": {"winter": 0.6, "spring": 1.0, "summer": 0.2, "fall": 0.3},
    "browse": {"winter": 0.6, "spring": 1.0, "summer": 0.7, "fall": 0.5},
    "cover": {"winter": 0.85, "spring": 1.0, "summer": 1.0, "fall": 1.0},
    "insects": {"winter": 0.1, "spring": 1.0, "summer": 0.8, "fall": 0.4},
    "cavity": {"winter": 1, "spring": 1, "summer": 1, "fall": 1},
    "cliff_or_snag": {"winter": 1, "spring": 1, "summer": 1, "fall": 1},
    "burrow": {"winter": 0.8, "spring": 1.0, "summer": 1.0, "fall": 1.0},
    "water": {"winter": 1.0, "spring": 1.0, "summer": 0.6, "fall": 0.5},
}

RESOURCE_COLORS = {
    "acorn_mast": (200, 140, 40), "grass_forbs": (150, 210, 80), "browse": (100, 170, 90),
    "cover": (60, 90, 60), "insects": (230, 200, 80), "cavity": (170, 110, 160),
    "cliff_or_snag": (180, 180, 190), "burrow": (190, 130, 90), "water": (80, 150, 240),
}


# --- Rewilded water beds (docs/tile-spec.md "Hydrology rewilding") ------------------------------
# client/channel_profile.png B (rewild_hydro step, DEM grid) is 255 on a former reservoir or
# stock-pond bed and 160 on the 12 m riparian corridor along the restored channel through it. On
# the 30 m vegetation grid a cell becomes riparian where the corridor covers REWILD_CORRIDOR_SHARE
# of it, and grassland (there is no wet-meadow class) where the bed covers REWILD_BED_SHARE and
# LANDFIRE has it as water, barren or human, or where it is water with any real share of bed
# (REWILD_WATER_SHARE: the old shoreline cells). Cells LANDFIRE already sees as vegetation (the
# willow and oak fringe on the old shore) keep their class.
REWILD_BED_SHARE = 0.5
REWILD_WATER_SHARE = 0.15
REWILD_CORRIDOR_SHARE = 0.2
# Cover (tree, shrub, herb %) given to rewilded cells whose LANDFIRE cover is not vegetation
# (EVC under 100: open water, barren, developed): a wet meadow with no canopy of its own (the
# client's savanna rule still sets about one oak per two cells), and a young riparian gallery.
REWILD_COVER = {"meadow": (0, 0, 75), "riparian": (40, 20, 55)}


def rewilded_beds(tile, shape) -> tuple | None:
    """(bed share, corridor share) per cell of a `shape` grid covering the tile, from
    client/channel_profile.png B, or None when the tile has no rewilded beds."""
    import numpy as np
    from PIL import Image
    p = tile.path("client/channel_profile.png")
    if not p.exists():
        return None
    B = np.asarray(Image.open(p).convert("RGB"))[..., 2]
    if not (B > 0).any():
        return None
    n, m = B.shape[0], shape[0]
    idx = np.minimum(((np.arange(n) + 0.5) * m / n).astype(int), m - 1)   # 5 m pixel -> 30 m cell
    cell = (idx[:, None] * m + idx[None, :]).ravel()
    cnt = np.bincount(cell, minlength=m * m).astype("float64")
    share = lambda sel: (np.bincount(cell, weights=sel.ravel(), minlength=m * m) / np.maximum(cnt, 1)).reshape(m, m)  # noqa: E731
    return share(B > 0), share(B == 160)


def rewilded_cells(tile, present) -> tuple | None:
    """(meadow, corridor) boolean masks on the vegetation grid, from the beds and the present-day
    habitat class (habitat_present.tif), or None. See REWILD_* above."""
    import numpy as np
    shares = rewilded_beds(tile, present.shape)
    if shares is None:
        return None
    bed, corr = shares
    corridor = corr >= REWILD_CORRIDOR_SHARE
    open_ground = np.isin(present, (CODES["water"], CODES["barren"], CODES["human"]))
    meadow = ~corridor & (((bed >= REWILD_BED_SHARE) & open_ground)
                          | ((present == CODES["water"]) & (bed >= REWILD_WATER_SHARE)))
    return meadow, corridor


def apply_rewilded_beds(tile, present, habitat) -> dict | None:
    """Rewilded beds into the backfilled habitat raster, in place: meadow cells grassland,
    corridor cells riparian. Returns counts for the manifest, or None."""
    cells = rewilded_cells(tile, present)
    if cells is None:
        return None
    meadow, corridor = cells
    habitat[meadow] = CODES["grassland"]
    habitat[corridor] = CODES["riparian"]
    return {"source": "client.channel_profile (B)", "meadow_cells": int(meadow.sum()), "corridor_cells": int(corridor.sum()),
            "meadow_class": "grassland", "corridor_class": "riparian",
            "rule": f"corridor share >= {REWILD_CORRIDOR_SHARE}: riparian; bed share >= {REWILD_BED_SHARE} on present "
                    f"water, barren or human, or present water with bed share >= {REWILD_WATER_SHARE}: grassland"}


def rewilded_cover(tile, present, evc, tree, shrub, herb):
    """REWILD_COVER into the cover layers (tree, shrub, herb %, 30 m) of rewilded cells whose
    LANDFIRE cover is not vegetation. Returns the three arrays (copies where changed)."""
    cells = rewilded_cells(tile, present)
    if cells is None:
        return tree, shrub, herb
    tree, shrub, herb = tree.copy(), shrub.copy(), herb.copy()
    bare = evc < 100
    for sel, (t, s, h) in ((cells[0] & bare, REWILD_COVER["meadow"]), (cells[1] & bare, REWILD_COVER["riparian"])):
        tree[sel], shrub[sel], herb[sel] = t, s, h
    return tree, shrub, herb
