"""Dense-urban mask: where a city's blocks go whole, streets and street trees with them.

The rewild rules elsewhere were written for foothill tiles: a few roads kept as decayed clearings,
houses erased where the photo looks built, every lidar crown a tree. In a city that leaves the
street grid as a lattice of clearings, the lawns and back yards of every block between the erased
roofs, and the street trees standing in rows along the vanished grid. Inside this mask instead:

  - streets are gone (derive._road_weights: weight 0, no pavement, no verge), freeways excepted;
  - every pixel is erased and synthesized from clean imagery of the cell's rewilded habitat class
    (erase_imagery), whatever LANDFIRE's development intensity;
  - lidar crowns go unless the 30 m rewilded class is a forest or woodland (lidar.crowns).

footprint/urban.tif, uint8 on the DEM grid (5 m), 1 densely built, 0 not:

1. Building cover: OSM building footprints rasterised at 2.5 m, averaged to 5 m.
2. Density: the mean building cover within URBAN_RADIUS_M. Seed where it is at least URBAN_SHARE,
   or at least MEDHIGH_SHARE on LANDFIRE EVT Developed-Medium or High Intensity cells (commercial
   blocks with big roofs and lots between them). The EVT cells alone are not enough: Developed-High
   is also a foothill freeway interchange or a shopping centre's car park (2.6% of utm10n_680_4280).
3. Kept within NEAR_BUILDING_M of a building (or on those EVT cells), so the 100 m density does not
   spill into the park or the sea beside the last block.
4. Closed by CLOSE_M (the streets between blocks), holes under HOLE_HA filled (a square, a school
   yard), components under MIN_HA dropped: a town centre or a commercial strip in the foothills is
   not a city and keeps the foothill rules.

The thresholds were set on the five built tiles. San Francisco's blocks run 30-60% building cover
within 100 m and form patches of 93 ha (Sausalito) to 4400 ha (the Sunset to Twin Peaks). The
foothill tiles reach 41-64% at their densest point, but their patches after the same closing are at
most 47 ha (utm10n_690_4280, Placerville) and 25 ha (utm10n_680_4280).

    python -m pipeline.urban utm10n_540_4180 [more tile ids] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys

import cv2
import numpy as np
import rasterio
from rasterio.transform import from_bounds

from .config import TILE_SIZE_M, Tile, read_json

URBAN_RADIUS_M = 100.0        # density window radius
URBAN_SHARE = 0.15            # building cover within URBAN_RADIUS_M that makes ground densely built
MEDHIGH_SHARE = 0.075         # ... on EVT Developed-Medium / High Intensity cells
MEDHIGH_PHYS = ("Developed-Medium Intensity", "Developed-High Intensity")
NEAR_BUILDING_M = 25.0        # the mask keeps to within this of a building (half a street plus the front yard)
CLOSE_M = 40.0                # closing radius: the streets between blocks, and planted medians
HOLE_HA = 3.0                 # enclosed gaps smaller than this are filled
MIN_HA = 75.0                 # components smaller than this are dropped
RES_M = 5.0                   # the DEM grid
BUILD_RES_M = 2.5             # building raster, averaged to RES_M


def _disk(radius_px: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius_px + 1, 2 * radius_px + 1))


def _buildings(tile: Tile, n: int) -> tuple[np.ndarray, int]:
    """Share of each n x n cell under an OSM building footprint, and the building count."""
    import shapely
    from pyproj import Transformer
    from rasterio.features import rasterize
    p = tile.dir / "footprint/mask.geojson"
    if not p.exists():
        return np.zeros((n, n), "float32"), 0
    feats = [f["geometry"] for f in read_json(p)["features"] if (f.get("properties") or {}).get("class") == "building"]
    if not feats:
        return np.zeros((n, n), "float32"), 0
    geoms = shapely.from_geojson([json.dumps(g) for g in feats])
    t = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    geoms = shapely.transform(geoms, lambda xy: np.column_stack(t.transform(xy[:, 0], xy[:, 1])))
    k = int(round(RES_M / BUILD_RES_M))
    x0, y0, x1, y1 = tile.bounds
    fine = rasterize(((g, 1) for g in geoms if not g.is_empty), out_shape=(n * k, n * k),
                     transform=from_bounds(x0, y0, x1, y1, n * k, n * k), dtype="uint8")
    return cv2.resize(fine.astype("float32"), (n, n), interpolation=cv2.INTER_AREA), len(feats)


def _medhigh(tile: Tile, n: int) -> np.ndarray:
    """EVT Developed-Medium / High Intensity cells on the n x n grid (nearest), or all False."""
    try:
        with rasterio.open(tile.path("vegetation/evt.tif")) as src:
            evt = src.read(1)
        meta = read_json(tile.path("vegetation/classes.json"))["evt"]
    except (OSError, KeyError, ValueError, rasterio.errors.RasterioIOError):
        return np.zeros((n, n), bool)
    codes = [int(k) for k, v in meta.items() if str(v.get("phys", "")).startswith(MEDHIGH_PHYS)]
    cells = np.isin(evt, codes).astype("uint8")
    return cv2.resize(cells, (n, n), interpolation=cv2.INTER_NEAREST).astype(bool)


def compute(tile: Tile) -> tuple[np.ndarray, dict]:
    """(mask bool n x n on the DEM grid, stats)."""
    n = int(round(TILE_SIZE_M / RES_M))
    share, count = _buildings(tile, n)
    medhigh = _medhigh(tile, n)
    k = _disk(int(round(URBAN_RADIUS_M / RES_M))).astype("float32")
    dens = cv2.filter2D(share, -1, k / k.sum(), borderType=cv2.BORDER_REFLECT)
    seed = (dens >= URBAN_SHARE) | (medhigh & (dens >= MEDHIGH_SHARE))
    near = cv2.dilate((share > 0).astype("uint8"), _disk(int(round(NEAR_BUILDING_M / RES_M)))).astype(bool)
    m = (seed & (near | medhigh)).astype("uint8")
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, _disk(int(round(CLOSE_M / RES_M))))
    px_ha = RES_M * RES_M / 1e4
    # Fill enclosed gaps: components of the complement that do not touch the tile edge.
    cnt, lab, st, _ = cv2.connectedComponentsWithStats((m == 0).astype("uint8"), connectivity=4)
    edge = (st[:, cv2.CC_STAT_LEFT] == 0) | (st[:, cv2.CC_STAT_TOP] == 0) | \
        (st[:, cv2.CC_STAT_LEFT] + st[:, cv2.CC_STAT_WIDTH] == n) | (st[:, cv2.CC_STAT_TOP] + st[:, cv2.CC_STAT_HEIGHT] == n)
    fill = ~edge & (st[:, cv2.CC_STAT_AREA] * px_ha < HOLE_HA)
    fill[0] = False                                        # label 0 is the mask itself
    holes = int(fill.sum())
    m = m.astype(bool) | fill[lab]
    cnt, lab, st, _ = cv2.connectedComponentsWithStats(m.astype("uint8"), connectivity=8)
    area = st[:, cv2.CC_STAT_AREA] * px_ha
    keep = area >= MIN_HA
    keep[0] = False
    mask = keep[lab]
    stats = {"fraction": round(float(mask.mean()), 4), "area_ha": round(float(mask.sum() * px_ha), 1),
             "components": int(keep.sum()), "component_area_ha": sorted((round(float(a), 1) for a in area[keep]), reverse=True)[:10],
             "dropped_components": int((~keep[1:]).sum()), "dropped_area_ha": round(float(area[1:][~keep[1:]].sum()), 1),
             "holes_filled": holes, "buildings": count, "building_cover": round(float(share.mean()), 4),
             "building_cover_inside": round(float(share[mask].mean()), 4) if mask.any() else None,
             "seed_fraction": round(float(seed.mean()), 4), "evt_medhigh_fraction": round(float(medhigh.mean()), 4),
             "evt_medhigh_inside": round(float(medhigh[mask].mean()), 4) if mask.any() else None}
    return mask, stats


def build(tile: Tile) -> dict:
    """Write footprint/urban.tif and return its manifest layer."""
    mask, stats = compute(tile)
    n = mask.shape[0]
    x0, y0, x1, y1 = tile.bounds
    prof = {"driver": "GTiff", "dtype": "uint8", "count": 1, "width": n, "height": n, "crs": tile.crs,
            "transform": from_bounds(x0, y0, x1, y1, n, n), "nodata": None, "tiled": True,
            "blockxsize": 256, "blockysize": 256, "compress": "deflate"}
    with rasterio.open(tile.path("footprint/urban.tif"), "w", **prof) as dst:
        dst.write(mask.astype("uint8")[None])
    return {"path": "footprint/urban.tif", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": n, "resolution_m": RES_M, "source": "osm", "sources_used": ["landfire"],
            "derived_from": ["footprint.mask", "vegetation.evt"],
            "encoding": "uint8, row 0 north: 1 densely built (streets, blocks and street trees rewilded whole), 0 not",
            "method": (f"OSM building cover (rasterised at {BUILD_RES_M:g} m) averaged within {URBAN_RADIUS_M:g} m; dense where "
                       f">= {URBAN_SHARE:g}, or >= {MEDHIGH_SHARE:g} on LANDFIRE EVT Developed-Medium / High Intensity cells; "
                       f"kept within {NEAR_BUILDING_M:g} m of a building or on those cells; closed by {CLOSE_M:g} m, enclosed "
                       f"gaps under {HOLE_HA:g} ha filled, components under {MIN_HA:g} ha dropped"),
            "stats": stats}


def load(tile: Tile, n: int) -> np.ndarray:
    """The urban mask on an n x n tile grid (nearest), from footprint/urban.tif, else computed from
    the footprint (not written), else all False."""
    p = tile.dir / "footprint/urban.tif"
    if p.exists():
        with rasterio.open(p) as src:
            m = src.read(1)
    elif (tile.dir / "footprint/mask.geojson").exists():
        m = compute(tile)[0].astype("uint8")
    else:
        return np.zeros((n, n), bool)
    if m.shape[0] == n:
        return m.astype(bool)
    return cv2.resize(m.astype("uint8"), (n, n), interpolation=cv2.INTER_NEAREST).astype(bool)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tiles", nargs="+")
    ap.add_argument("--dry-run", action="store_true", help="compute and print the stats, write nothing")
    a = ap.parse_args(argv)
    for tid in a.tiles:
        tile = Tile.from_id(tid)
        stats = compute(tile)[1] if a.dry_run else build(tile)["stats"]
        print(tid, json.dumps(stats), flush=True)


if __name__ == "__main__":
    sys.exit(main())
