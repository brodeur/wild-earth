"""Build step `substrate`: what the ground is made of, how its rock breaks, and where the rock is bare.

Reads what the `ground`, `lidar`, `naip` and `veg` steps already wrote (nothing is fetched) and writes

    client/substrate.png   5 m grid (2000 px), RGB, row 0 = the north edge:
                           R  exposed rock 0..255 (0..1): how much of the cell is bare rock face
                           G  lithology index (1-based into substrate.json `lithologies`; 0 none)
                           B  the exposed patch's size: 0 outside a patch, else round(32 log2(1 + area / 100 m2))
                              capped at 255 (100 m2 -> 32, 1000 m2 -> 111, 1 ha -> 213)
    client/substrate.json  the lithologies with their cliff morphology (how each rock breaks), the orientations
                           derived for this tile, the geology unit -> lithology table, the exposure formula and stats

Lithology (docs/tile-spec.md "Substrate and exposed rock"): each geology unit (geology/classes.json, from the
Macrostrat / SGMC map) goes to one of a small set of lithologies by its rock class and, where the rock class is too
coarse, its name and lithology text (talus, till, fill and landslides are surficial deposits that make no cliff;
basalt makes columns, andesite blocks). The unit polygons are rasterized at 5 m (the 30 m geology grid would put
square steps along every contact).

Morphology: each lithology carries how its rock breaks: the form (sheeted granite: exfoliation sheets parallel to the
surface and two steep joint sets, big smooth faces with long cracks; fissile slate and shale: a steep cleavage that
splits the face into many small plates and chips; bedded sandstone: ledges along the beds; columnar basalt; ...), the
size of its facets at two or three scales, how elongated they are and along what, how much a facet tilts from the face,
the crack width, the talus it sheds, and its colour. Orientations come from the data where the data has them:
  - the foliation or bedding strike of a lithology: the length-weighted mean orientation (doubled angles) of the
    geologic contacts of its units inside the tile (in a steeply dipping belt like the Sierra foothills the contacts
    run along the strike); kept when the resultant length is at least STRIKE_MIN_R, else the regional default
  - the steep joint sets: the strike of the lithology's steep faces on the DEM (aspect + 90 degrees, slope-weighted,
    folded to 0..180), whose histogram peaks are the joints the faces broke along; the strongest one or two peaks
  - dips are not in the map data: the lithology's default (recorded as such)

Exposed rock: on the 5 m grid from the DEM (and the 1 m lidar DEM where the tile has it), the canopy (lidar tree and
shrub cover at 10 m, else LANDFIRE EVC tree cover at 30 m), the NAIP photo and the soils:
    steep    = smoothstep(28, 52, slope)            slope = max(5 m slope, 0.85 x the 1 m slope's 5 m mean)
    bare     = (1 - tree) (1 - 0.5 shrub)            on a tile without lidar: 1 - 0.6 tree (EVC is coarse)
    spectral = (1 - smoothstep(0.35 ref, 0.75 ref, exg)) (0.55 + 0.45 smoothstep(0.18, 0.42, luma)) grey
               on the humans-erased NAIP (client/texture_imagery.jpg: roofs and roads are not rock); exg the photo's excess green (2G - R - B) / (R + G + B) over 5 m: grey or pale, not green; ref the
               median exg under tree cover over 50% on this tile (the photo's own green, at least 0.06); grey =
               1 - 0.6 smoothstep(0.04, 0.09, yel), yel = (R - B) / (R + G + B): dry summer grass is pale too, but yellow
    convex   = 1 + 0.25 clip(TPI / 3 m, -1, 1)       TPI = z - its 40 m gaussian mean (spurs and rims are barer)
    prior    = the soil map unit's Rock outcrop component % / 100
    rock     = 0 on surficial deposits (a cut bank past 60 degrees keeps 0.5) and water, else 1
    exposed  = clip(rock (steep bare^0.7 (0.3 + 0.7 spectral) convex + 0.45 prior smoothstep(15, 35, slope) spectral), 0, 1)
    and at any slope at least rock bare (1 - smoothstep(0.25 ref, 0.5 ref, exg)) smoothstep(0.40, 0.55, luma) times 0.9 on
    LANDFIRE's barren class (client/habitat.png 8), else 0.6 (1 - smoothstep(0.02, 0.05, yel)): the pale bare slabs (the
    backs of the domes), which are rock though no cliff
then a 5 m gaussian. A patch is a connected run (8-neighbour) of cells over 0.5.
"""
from __future__ import annotations

import json
import math
import re

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from scipy.ndimage import gaussian_filter, label, zoom
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from .config import Tile, write_json

PX = 2000                      # the 5 m grid of client/heights.png
RES = 10000 / PX
STRIKE_MIN_R = 0.25            # contacts' resultant length below which their mean strike is not used
JOINT_MIN_CELLS = 150          # steep 5 m cells a lithology needs for its own joint sets
JOINT_SLOPE_DEG = 55
PATCH_MIN = 0.5
BARREN = 8                     # client/habitat.png: LANDFIRE barren (rock, scree)

# The lithologies and how each breaks. form: the shader's family. facet_m: facet sizes, big to small (m); elong: a
# facet's length over its width (> 1 along `along`); along: 'dip' (down the face), 'strike' (the foliation's trace on
# the face), 'bedding' (the bedding's trace); tilt_deg: how far a facet's plane turns from the face, at each scale;
# open: the share of facet edges that are open joints, at each scale (granite: a few long ones; slate: nearly all);
# steps: the share of edges where one facet stands proud of the next; tone: a facet's own brightness spread;
# crack_m: the joints' width at the big scale; step_m: the recess at a facet edge; talus: what falls off ('blocks',
# 'plates', 'chips', 'rubble', 'columns', 'none'); colour: linear albedo; dip_deg / dip_source: the planar fabric.
LITHOLOGIES = [
    {"name": "granitic", "form": "sheeted", "cliff": True, "facet_m": [46.0, 9.0, 1.8], "elong": 2.4, "along": "dip",
     "tilt_deg": [11.0, 4.0, 1.5], "open": [0.55, 0.3, 0.0], "steps": [0.35, 0.15, 0.0], "tone": 0.05, "crack_m": 0.35, "step_m": 1.5, "talus": "blocks", "colour": [0.56, 0.54, 0.50], "dip_deg": None,
     "notes": "massive; exfoliation sheets parallel to the surface, two steep joint sets: big smooth faces, long cracks"},
    {"name": "slate_phyllite", "form": "fissile", "cliff": True, "facet_m": [4.0, 1.1, 0.3], "elong": 1.6, "along": "strike",
     "tilt_deg": [5.0, 10.0, 9.0], "open": [0.8, 0.75, 0.7], "steps": [0.6, 0.55, 0.5], "tone": 0.06, "crack_m": 0.05, "step_m": 0.25, "talus": "plates", "colour": [0.27, 0.27, 0.27], "dip_deg": 75.0,
     "notes": "slaty cleavage, steep: crumbly faces of many small plates and edges, platy talus"},
    {"name": "schist", "form": "foliated", "cliff": True, "facet_m": [8.0, 2.0, 0.5], "elong": 2.0, "along": "strike",
     "tilt_deg": [6.0, 11.0, 8.0], "open": [0.7, 0.6, 0.4], "steps": [0.5, 0.4, 0.3], "tone": 0.06, "crack_m": 0.08, "step_m": 0.4, "talus": "plates", "colour": [0.36, 0.35, 0.33], "dip_deg": 70.0,
     "notes": "wavy foliation, silvery; slabby faces"},
    {"name": "greenstone_metavolcanic", "form": "blocky", "cliff": True, "facet_m": [10.0, 2.4, 0.6], "elong": 1.25, "along": "dip",
     "tilt_deg": [12.0, 15.0, 8.0], "open": [0.6, 0.5, 0.4], "steps": [0.45, 0.35, 0.2], "tone": 0.08, "crack_m": 0.10, "step_m": 0.5, "talus": "rubble", "colour": [0.29, 0.31, 0.27], "dip_deg": None,
     "notes": "massive to blocky, irregular joints; knobby dark faces"},
    {"name": "sandstone_conglomerate", "form": "bedded", "cliff": True, "facet_m": [16.0, 3.0, 0.7], "elong": 2.2, "along": "bedding",
     "tilt_deg": [8.0, 6.0, 3.0], "open": [0.6, 0.4, 0.2], "steps": [0.6, 0.3, 0.1], "tone": 0.07, "crack_m": 0.12, "step_m": 0.8, "talus": "blocks", "colour": [0.48, 0.43, 0.36], "dip_deg": 12.0,
     "notes": "bedded: ledges and overhangs along the beds, vertical joints between"},
    {"name": "basalt", "form": "columnar", "cliff": True, "facet_m": [12.0, 1.1, 0.3], "elong": 4.0, "along": "dip",
     "tilt_deg": [10.0, 14.0, 5.0], "open": [0.3, 0.9, 0.4], "steps": [0.3, 0.6, 0.2], "tone": 0.05, "crack_m": 0.06, "step_m": 0.4, "talus": "columns", "colour": [0.17, 0.17, 0.17], "dip_deg": None,
     "notes": "columnar jointing: vertical columns about a metre across"},
    {"name": "volcanic", "form": "blocky", "cliff": True, "facet_m": [8.0, 2.0, 0.5], "elong": 1.4, "along": "dip",
     "tilt_deg": [12.0, 15.0, 8.0], "open": [0.6, 0.5, 0.4], "steps": [0.45, 0.35, 0.2], "tone": 0.08, "crack_m": 0.08, "step_m": 0.5, "talus": "rubble", "colour": [0.33, 0.31, 0.29], "dip_deg": None,
     "notes": "andesite, rhyolite, tuff and mudflow rock: blocky, rough"},
    {"name": "serpentinite", "form": "scaly", "cliff": True, "facet_m": [4.0, 1.0, 0.3], "elong": 1.5, "along": "strike",
     "tilt_deg": [8.0, 18.0, 14.0], "open": [0.7, 0.7, 0.6], "steps": [0.5, 0.5, 0.4], "tone": 0.07, "crack_m": 0.04, "step_m": 0.2, "talus": "chips", "colour": [0.24, 0.29, 0.25], "dip_deg": 60.0,
     "notes": "sheared: scaly, slickensided lenses, waxy green"},
    {"name": "limestone_marble", "form": "massive", "cliff": True, "facet_m": [26.0, 5.0, 1.0], "elong": 1.8, "along": "dip",
     "tilt_deg": [8.0, 4.0, 2.0], "open": [0.5, 0.25, 0.05], "steps": [0.3, 0.1, 0.0], "tone": 0.05, "crack_m": 0.2, "step_m": 0.8, "talus": "blocks", "colour": [0.58, 0.57, 0.54], "dip_deg": None,
     "notes": "massive; solution flutes down the face"},
    {"name": "surficial", "form": "none", "cliff": False, "facet_m": [3.0, 0.8, 0.2], "elong": 1.0, "along": "dip",
     "tilt_deg": [14.0, 10.0, 5.0], "open": [0.5, 0.4, 0.2], "steps": [0.3, 0.2, 0.1], "tone": 0.06, "crack_m": 0.0, "step_m": 0.0, "talus": "none", "colour": [0.42, 0.39, 0.34], "dip_deg": None,
     "notes": "alluvium, till, talus, dune sand, fill, landslides: no bedrock face (a cut bank at most)"},
]
LITH_INDEX = {l["name"]: i + 1 for i, l in enumerate(LITHOLOGIES)}
ROCK_CLASS_LITH = {"granitic": "granitic", "slate_phyllite": "slate_phyllite", "schist": "schist",
                   "greenstone_metavolcanic": "greenstone_metavolcanic", "sandstone_conglomerate": "sandstone_conglomerate",
                   "volcanic": "volcanic", "serpentinite": "serpentinite", "limestone_marble": "limestone_marble",
                   "alluvium": "surficial", "other": "surficial"}
SURFICIAL = r"\btalus\b|\btill\b|moraine|landslide|debris|\bfill\b|\bdune|beach|alluvi|colluvi|\bsand deposits\b|surficial|glacial"
FISSILE = r"^(shale|mudstone|claystone|argillite)"
# Regional defaults where the tile's own contacts do not give a strike (azimuth, degrees clockwise from north, the
# right-hand rule: the fabric dips to the right of it): the Mother Lode belt's N35W, steep to the north-east.
DEFAULT_STRIKE_DEG = 325.0


def lithology_of(unit: dict) -> tuple[str, str]:
    """(lithology, why) for a geology/classes.json unit."""
    name, lith, desc = (unit.get("name") or ""), (unit.get("lithology") or ""), (unit.get("description") or "")
    if unit.get("water"):
        return "surficial", "water"
    if re.search(SURFICIAL, name.lower()):
        return "surficial", "name: surficial deposit"
    rc = unit.get("rock_class") or "other"
    majors = re.findall(r"Major:\s*([^;]*)", lith)
    first = majors[0].split(",")[0].strip().lower() if majors else ""
    if rc in ("sandstone_conglomerate", "other") and re.search(FISSILE, first):
        return "slate_phyllite", f"major lithology {first}: fissile"
    if rc in ("volcanic", "greenstone_metavolcanic") and first.startswith("basalt"):
        return "basalt", "major lithology basalt"
    if rc == "other":
        text = f"{name} {lith} {desc}".lower()
        for pat, l in (("granit|granodiorit|tonalit|diorit|monzonit", "granitic"), ("basalt", "basalt"),
                       ("andesit|rhyolit|dacit|tuff|volcanic", "volcanic"), ("sandstone|conglomerate", "sandstone_conglomerate")):
            if re.search(pat, text):
                return l, f"text: {pat.split('|')[0]}"
        return "surficial", "rock class other, no bedrock named"
    return ROCK_CLASS_LITH[rc], f"rock class {rc}"


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _grid(tile: Tile):
    x0, y0, x1, y1 = tile.bounds
    return from_bounds(x0, y0, x1, y1, PX, PX)


def _read(tile: Tile, rel: str, band=1, resampling=Resampling.average, px=PX):
    """A raster of the tile on the 5 m grid (or px), float32, nodata as nan; None when it is not there."""
    p = tile.path(rel)
    if not p.exists():
        return None
    with rasterio.open(p) as src:
        a = src.read(band).astype("float32")
        out = np.full((px, px), np.nan, "float32")
        x0, y0, x1, y1 = tile.bounds
        reproject(a, out, src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                  dst_transform=from_bounds(x0, y0, x1, y1, px, px), dst_crs=tile.crs, dst_nodata=np.nan,
                  resampling=resampling)
    return out


def _fill(a):
    if a is None:
        return None
    m = np.isnan(a)
    if m.any():
        a = a.copy(); a[m] = np.nanmean(a) if (~m).any() else 0
    return a


def _slope_deg(z, res):
    gy, gx = np.gradient(z, res)
    return np.degrees(np.arctan(np.hypot(gx, gy))), gx, -gy   # gy along rows (south); -gy is d/dnorth


def _slope1m_mean(tile: Tile):
    """The 1 m lidar DEM's slope (degrees), averaged over each 5 m cell, in strips; None without it."""
    p = tile.path("terrain/dem_1m.tif")
    if not p.exists():
        return None
    out = np.zeros((PX, PX), "float32")
    with rasterio.open(p) as src:
        if src.width != 10000 or src.height != 10000:
            return None
        nod = src.nodata
        step = 500
        for r0 in range(0, 10000, step):
            a, b = max(r0 - 1, 0), min(r0 + step + 1, 10000)
            z = src.read(1, window=((a, b), (0, 10000))).astype("float32")
            if nod is not None:
                bad = z == nod
                if bad.any():
                    z[bad] = np.nan
            gy, gx = np.gradient(z, 1.0)
            s = np.degrees(np.arctan(np.hypot(gx, gy)))[r0 - a:r0 - a + step]
            s = np.nan_to_num(s, nan=0.0)
            out[r0 // 5:(r0 + step) // 5] = s.reshape(step // 5, 5, 2000, 5).mean(axis=(1, 3))
    return out


def _naip(tile: Tile):
    """(excess green, luma, yellowness, which photo) on the 5 m grid: the humans-erased NAIP the client draws
    (client/texture_imagery.jpg: roofs and roads are not rock) where it exists, else the NAIP itself; or Nones."""
    p = tile.path("client/texture_imagery.jpg")
    if p.exists():
        im = Image.open(p).convert("RGB")
        a = np.asarray(im.resize((PX, PX), Image.BOX)).astype("float32") / 255.0   # rows north to south, as the grid
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        src = "client/texture_imagery.jpg (NAIP, humans erased)"
    elif tile.path("imagery/naip.tif").exists():
        r, g, b = [_fill(_read(tile, "imagery/naip.tif", k)) / 255.0 for k in (1, 2, 3)]
        src = "imagery/naip.tif"
    else:
        return None, None, None, None
    s = r + g + b + 1e-3
    return (2 * g - r - b) / s, 0.299 * r + 0.587 * g + 0.114 * b, (r - b) / s, src


def _cover(tile: Tile):
    """(tree, shrub, source): cover fractions 0..1 on the 5 m grid."""
    if tile.path("vegetation/canopy_height_10m.tif").exists():
        tree = _fill(_read(tile, "vegetation/canopy_height_10m.tif", 2, Resampling.bilinear)) / 100
        shrub = _fill(_read(tile, "vegetation/canopy_height_10m.tif", 3, Resampling.bilinear)) / 100
        return np.clip(tree, 0, 1), np.clip(shrub, 0, 1), "lidar canopy_height_10m (tree >= 4 m, shrub 0.5-4 m)"
    evc = _read(tile, "vegetation/evc.tif", 1, Resampling.nearest)
    tree = np.where((evc >= 101) & (evc <= 199), evc - 100, 0).astype("float32") / 100
    tree = gaussian_filter(tree, 3.0)   # the 30 m cells' edges softened (15 m)
    return tree, np.zeros_like(tree), "LANDFIRE EVC tree cover (30 m, smoothed)"


def _rasterize_units(tile: Tile, unit_lith: dict[int, int]):
    """Lithology index at 5 m from geology/units.geojson (larger polygons first, so inliers win)."""
    gj = json.loads(tile.path("geology/units.geojson").read_text())
    fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    shapes, feats = [], []
    for f in gj["features"]:
        g = shp_transform(fwd.transform, shape(f["geometry"]))
        ui = int(f["properties"]["unit_index"])
        shapes.append((g, unit_lith.get(ui, 0))); feats.append((g, ui))
    shapes.sort(key=lambda s: -s[0].area)
    lith = rasterize(shapes, out_shape=(PX, PX), transform=_grid(tile), fill=0, dtype="uint8")
    return lith, feats


def _contact_strikes(tile: Tile, feats, unit_lith: dict[int, int]) -> dict[int, dict]:
    """Per lithology: the length-weighted mean orientation of its units' contacts inside the tile (doubled angles)."""
    x0, y0, x1, y1 = tile.bounds
    acc: dict[int, list] = {}
    for g, ui in feats:
        li = unit_lith.get(ui, 0)
        if not li:
            continue
        polys = getattr(g, "geoms", [g])
        for p in polys:
            for ring in [p.exterior, *p.interiors]:
                c = np.asarray(ring.coords)
                if len(c) < 2:
                    continue
                a, b = c[:-1], c[1:]
                mid = (a + b) / 2
                inside = (mid[:, 0] > x0 + 80) & (mid[:, 0] < x1 - 80) & (mid[:, 1] > y0 + 80) & (mid[:, 1] < y1 - 80)
                d = b - a
                L = np.hypot(d[:, 0], d[:, 1])
                az = np.arctan2(d[:, 0], d[:, 1])          # azimuth from north, clockwise
                s = acc.setdefault(li, [0.0, 0.0, 0.0])
                s[0] += float((L * np.cos(2 * az))[inside].sum()); s[1] += float((L * np.sin(2 * az))[inside].sum())
                s[2] += float(L[inside].sum())
    out = {}
    for li, (c2, s2, tot) in acc.items():
        if tot <= 0:
            continue
        R = math.hypot(c2, s2) / tot
        az = (math.degrees(math.atan2(s2, c2)) / 2) % 180
        out[li] = {"strike_deg": round(az, 1), "resultant": round(R, 3), "contact_km": round(tot / 1000, 2)}
    return out


def _joint_sets(slope, ge, gn, lith, li) -> dict | None:
    """The steep faces' strikes in lithology li: the histogram's one or two strongest peaks (degrees, 0..180)."""
    m = (lith == li) & (slope > JOINT_SLOPE_DEG)
    n = int(m.sum())
    if n < JOINT_MIN_CELLS:
        return None
    strike = (np.degrees(np.arctan2(gn[m], -ge[m])) % 180.0)
    w = (slope[m] - JOINT_SLOPE_DEG + 5) / 35
    h, _ = np.histogram(strike, bins=36, range=(0, 180), weights=w)
    k = np.exp(-0.5 * (np.arange(-6, 7) * 5 / 10.0) ** 2); k /= k.sum()
    hs = np.array([sum(h[(i + j) % 36] * k[j + 6] for j in range(-6, 7)) for i in range(36)])
    order = np.argsort(-hs)
    peaks = [int(order[0])]
    for i in order[1:]:
        d = min(abs(int(i) - peaks[0]), 36 - abs(int(i) - peaks[0]))
        if d >= 6 and hs[i] >= 0.55 * hs[peaks[0]]:
            peaks.append(int(i)); break
    uniform = hs.mean()
    return {"strikes_deg": [round(p * 5 + 2.5, 1) for p in peaks], "peak_over_mean": [round(float(hs[p] / uniform), 2) for p in peaks],
            "cells": n}


def build_substrate(tile: Tile) -> dict:
    gcls = json.loads(tile.path("geology/classes.json").read_text())
    units = {int(k): u for k, u in gcls["units"].items()}
    unit_lith, unit_rows = {}, {}
    for ui, u in units.items():
        l, why = lithology_of(u)
        unit_lith[ui] = LITH_INDEX[l]
        unit_rows[str(ui)] = {"name": u.get("name"), "rock_class": u.get("rock_class"), "lithology": l, "why": why,
                              "fraction": u.get("fraction")}
    lith, feats = _rasterize_units(tile, unit_lith)
    water_units = [ui for ui, u in units.items() if u.get("water")]

    dem_rel = "terrain/dem_banked.tif" if tile.path("terrain/dem_banked.tif").exists() else "terrain/dem.tif"
    z = _fill(_read(tile, dem_rel, 1, Resampling.bilinear))
    slope5, ge, gn = _slope_deg(z, RES)
    s1 = _slope1m_mean(tile)
    slope = np.maximum(slope5, 0.85 * s1) if s1 is not None else slope5
    tpi = z - gaussian_filter(z, 40 / RES)
    tree, shrub, cover_src = _cover(tile)
    exg, luma, yel, photo_src = _naip(tile)
    hab = np.asarray(Image.open(tile.path("client/habitat.png")).resize((PX, PX), Image.NEAREST)) if tile.path("client/habitat.png").exists() else None
    barren = (hab == BARREN) if hab is not None else np.zeros((PX, PX), bool)

    # soils: the map unit's Rock outcrop component %, rasterized from soils/mapunits.geojson
    prior = np.zeros((PX, PX), "float32")
    smu = tile.path("soils/mapunits.geojson")
    if smu.exists():
        sc = json.loads(tile.path("soils/classes.json").read_text())["mapunits"]
        pct = {u["mukey"]: (u.get("rock_outcrop_pct") or 0) for u in sc.values()}
        fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
        shapes = [(shp_transform(fwd.transform, shape(f["geometry"])), float(pct.get(f["properties"].get("mukey"), 0)))
                  for f in json.loads(smu.read_text())["features"] if f.get("geometry")]
        shapes = [s for s in shapes if s[1] > 0]
        if shapes:
            prior = rasterize(shapes, out_shape=(PX, PX), transform=_grid(tile), fill=0, dtype="float32") / 100

    steep = _smooth(28, 52, slope)
    bare = (1 - tree) * (1 - 0.5 * shrub) if s1 is not None and "lidar" in cover_src else 1 - 0.6 * tree
    bare = np.clip(bare, 0, 1)
    if exg is not None:
        # green relative to this photo's own canopy (NAIP's colour balance differs by year and state: bare granite at
        # Yosemite reads 0.02, its forest 0.19; the foothills' oaks 0.15)
        canopy = tree > 0.5
        ref = float(np.median(exg[canopy])) if canopy.sum() > 1000 else float(np.percentile(exg, 70))
        ref = max(ref, 0.06)
        grey = 1 - 0.6 * _smooth(0.04, 0.09, yel)   # rock is grey; dry summer grass is as pale, but yellow
        spectral = (1 - _smooth(0.35 * ref, 0.75 * ref, exg)) * (0.55 + 0.45 * _smooth(0.18, 0.42, luma)) * grey
    else:
        spectral = np.full((PX, PX), 0.6, "float32")
    convex = 1 + 0.25 * np.clip(tpi / 3.0, -1, 1)
    surf = lith == LITH_INDEX["surficial"]
    rock = np.where(surf, 0.5 * _smooth(58, 66, slope), 1.0)
    rock[lith == 0] = 1.0   # no unit mapped here (none expected): treat as bedrock
    e = rock * (steep * bare ** 0.7 * (0.3 + 0.7 * spectral) * convex + 0.45 * prior * _smooth(15, 35, slope) * spectral)
    if exg is not None:   # bare slabs at any slope: pale, grey and unforested (the granite domes' backs)
        slab = bare * (1 - _smooth(0.25 * ref, 0.5 * ref, exg)) * _smooth(0.40, 0.55, luma)
        e = np.maximum(e, rock * slab * np.where(barren, 0.9, 0.6 * (1 - _smooth(0.02, 0.05, yel))))
    e = gaussian_filter(np.clip(e, 0, 1).astype("float32"), 1.0)
    # water: the geology's water units, and the client's water zones where the tile has them (open water, not banks)
    if water_units:
        wmask = rasterize([(g, 1) for g, ui in feats if ui in water_units], out_shape=(PX, PX), transform=_grid(tile),
                          fill=0, dtype="uint8").astype(bool)
        e[wmask] = 0

    lab, n = label(e > PATCH_MIN, structure=np.ones((3, 3)))
    area = np.bincount(lab.ravel(), minlength=n + 1).astype("float64") * RES * RES
    area[0] = 0
    code = np.where(lab > 0, np.minimum(255, np.round(32 * np.log2(1 + area[lab] / 100))), 0).astype("uint8")

    img = np.dstack([np.round(e * 255).astype("uint8"), lith, code])
    Image.fromarray(img, "RGB").save(tile.path("client/substrate.png"), optimize=True)

    # orientations from the data
    strikes = _contact_strikes(tile, feats, unit_lith)
    lith_out = []
    for i, L in enumerate(LITHOLOGIES, 1):
        frac = float((lith == i).mean())
        row = {**L, "index": i, "fraction": round(frac, 4)}
        exp_here = e[lith == i]
        row["exposed_fraction"] = round(float((exp_here > PATCH_MIN).mean()), 4) if exp_here.size else 0.0
        st = strikes.get(i)
        if L["dip_deg"] is not None:
            if st and st["resultant"] >= STRIKE_MIN_R:
                # contacts give the strike's line; the right-hand rule's sense: the regional dip to the north-east
                az = st["strike_deg"]
                cand = [az, az + 180]
                az = min(cand, key=lambda a: abs(((a - DEFAULT_STRIKE_DEG + 180) % 360) - 180)) % 360
                row["fabric"] = {"strike_deg": round(az, 1), "dip_deg": L["dip_deg"], "strike_source": "geologic contacts",
                                 "contacts": st, "dip_source": "lithology default"}
            else:
                row["fabric"] = {"strike_deg": DEFAULT_STRIKE_DEG, "dip_deg": L["dip_deg"], "strike_source": "regional default (N35W)",
                                 "contacts": st, "dip_source": "lithology default"}
        js = _joint_sets(slope5, ge, gn, lith, i) if L["cliff"] else None
        row["joints"] = js or {"strikes_deg": [], "source": "too few steep faces"}
        if js:
            row["joints"]["source"] = f"DEM: strikes of the faces steeper than {JOINT_SLOPE_DEG} degrees"
        lith_out.append(row)

    big = area[1:] if n else np.zeros(0)
    stats = {"exposed_fraction": round(float((e > PATCH_MIN).mean()), 4), "exposed_mean": round(float(e.mean()), 4),
             "patches": int(n), "patches_over_1000m2": int((big >= 1000).sum()), "patches_over_1ha": int((big >= 10000).sum()),
             "largest_patch_m2": int(big.max()) if big.size else 0, "slope_source": "max(5 m, 0.85 x 1 m mean)" if s1 is not None else "5 m",
             "cover_source": cover_src, "photo": photo_src or "none", "photo_green_ref": round(ref, 4) if exg is not None else None, "dem": dem_rel}
    doc = {"encoding": {"png": "client/substrate.png", "pixels": PX, "resolution_m": RES, "row0": "north",
                        "R": "exposed rock 0..255 (0..1)", "G": "lithology index, 1-based into lithologies (0 none)",
                        "B": "exposed patch size: round(32 log2(1 + area / 100 m2)), 0 outside a patch"},
           "lithologies": lith_out, "units": unit_rows, "stats": stats, "formula": __doc__.split("Exposed rock:")[1].strip()}
    write_json(tile.path("client/substrate.json"), doc)
    return {
        "client.substrate": {"path": "client/substrate.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                             "pixels": PX, "resolution_m": RES, "encoding": doc["encoding"],
                             "derived_from": ["geology.units", "geology.classes", "soils.mapunits", dem_rel.replace("/", ".").replace(".tif", ""),
                                              "imagery.naip", "vegetation"], **stats},
        "client.substrate_classes": {"path": "client/substrate.json", "kind": "table", "derived_from": ["client.substrate"]},
    }
