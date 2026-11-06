"""Is mapped water water? Every waterbody tested against the tile's own Sentinel-2 months.

NHD and OSM map water that is not there: NHD's Swamp/Marsh (FType 466) polygons are wet meadows most of the year, a
stock pond dries by June, an OSM multipolygon whose outer ring came in pieces closes each piece into a sliver across
dry land, an old oxbow has filled with forest. The water step drew every one of them as open water (on Yellowstone's
Lamar Valley a 6.3 ha NHD marsh beside the river was a dark pond on green meadow). This step tests each mapped
polygon (hydro/waterbodies.geojson: NHD lakes, ponds, marshes, reservoirs; on OSM tiles natural=water of every kind,
river polygons included) against the monthly composites (seasons/s2_MM.tif: median L2A surface reflectance 2019-2026,
bands red, green, blue and NDVI; the composites carry no SWIR, so NDWI uses near infrared recovered from NDVI and red).

Per month and per pixel (20 m) of the polygon's core (the polygon shrunk by half a pixel, so no pixel mixes in the
shore):

  invalid    no data (a NaN, |NDVI| at 1)
  bright     green >= 0.2, or NDVI < 0.1 with blue >= 0.12: ice, snow, slush or cloud. A frozen lake is not dry, so
             these pixels leave the count (SCL already masks snow out of the composite; lake ice gets through)
  water      NDWI = (green - NIR) / (green + NIR) > 0 (McFeeters), or NIR < 0.04 (only water, or deep shadow, is that
             dark in the near infrared: a dark pond with algae has NDWI near 0 but NIR 0.01-0.03), NIR = red (1 + NDVI)
             / (1 - NDVI)
  land       the rest

The month's water fraction is water / (water + land); the month is observed when water + land covers at least half
the core (a month the composite refused for snow or the polar night is not observed at all). A month is wet when its
fraction is at least WET_FRAC. Then:

  dry        observed in MIN_MONTHS months or more and wet in none: not drawn as water (no surface, no basin, no pond
             zone; the streams through it are drawn as streams). Its bed is recorded: `meadow` where the greenest
             observed month's median NDVI is >= 0.3 (a wet meadow, a marsh's sedge, a filled oxbow's forest), else
             `bare` (gravel, sand, mud: a dry river bar, a playa); the imagery under it already shows which.
  permanent  wet in at least PERMANENT_SHARE of the observed months
  seasonal   wet in some months: drawn as the client's seasonal ponds (water in the wet season, the dry pan after)

A polygon whose core holds fewer than MIN_CORE_PX pixels (about 50 m across: below what 20 m pixels can say) or with
fewer than MIN_MONTHS observed months is unresolved and keeps its tags: NHD's intermittent lake/pond FCodes (39001,
39005, 39006, 436xx) and Swamp/Marsh (46600), OSM intermittent=yes, seasonal=* (not "no") and natural=wetland are
seasonal; every other tag is permanent. A tile without the seasons step classes every polygon by its tags.

Output: hydro/waterbody_seasons.json and the manifest layer `hydro.waterbody_seasons`, both with every polygon's class,
basis, core pixels and water fraction per calendar month (null: not observed). The water step (kept_ponds), the
terrain step's client/features.json (waterbodies: `water`, `wet_months`; the dry ones under `dry_waterbodies`) and
the resources step's water score read it.
"""
from __future__ import annotations

import json

import numpy as np

from .config import Tile, write_json

WET_FRAC = 0.25          # a month is wet when this share of the core's clear pixels is open water
PERMANENT_SHARE = 0.75   # wet in this share of the observed months: permanent
MIN_CORE_PX = 2          # 20 m pixels wholly inside the polygon needed to judge it
MIN_MONTHS = 3           # observed months needed to judge it
CORE_INSET_M = 10.0      # half a pixel
BRIGHT_GREEN = 0.2
BRIGHT_BLUE = 0.12
DARK_NIR = 0.04
MEADOW_NDVI = 0.3
REFUSE_FILLED = 0.5      # a month the composite filled over more than this share of the tile is not used

NHD_SEASONAL = {39001, 39005, 39006, 43601, 43603, 43604, 43605, 43606, 43607, 43608, 43609, 43610, 43611, 43612, 46600}
OUT = "hydro/waterbody_seasons.json"


def body_id(props: dict, index: int) -> str:
    """A waterbody's key in hydro/waterbodies.geojson: its NHD permanent identifier; else its OSM id with its position
    (the OSM fallback writes one feature per outer ring, so a multipolygon lake's rings share the id), else the
    position."""
    if props.get("permanent_identifier"):
        return str(props["permanent_identifier"])
    return f"{props['osm_id']}#{index}" if props.get("osm_id") else f"#{index}"


def load_classes(tile: Tile) -> dict[str, dict] | None:
    """id -> the body's record (class, wet_months, bed ...), or None when the step has not run on the tile."""
    p = tile.path(OUT)
    if not p.exists():
        return None
    doc = json.loads(p.read_text())
    return {b["id"]: b for b in doc.get("bodies", [])}


def _osm_tags(tile: Tile) -> dict[str, dict]:
    """The OSM tags of the fallback's waterbodies (the raw Overpass answer the hydro step cached), by osm_id."""
    p = tile.path("_cache/overpass_hydro.json")
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return {}
    return {f"{el['type']}/{el['id']}": el.get("tags", {}) for el in data.get("elements", []) if "id" in el}


def tag_class(props: dict, tags: dict | None = None) -> tuple[str, str]:
    """The class the tags give (seasonal | permanent) and why."""
    fc = props.get("fcode")
    try:
        fc = int(fc) if fc is not None else None
    except (TypeError, ValueError):
        fc = None
    if fc is not None:
        if fc in NHD_SEASONAL:
            return "seasonal", f"NHD FCode {fc} ({'swamp/marsh' if fc == 46600 else 'intermittent'})"
        return "permanent", f"NHD FCode {fc}"
    t = {**(tags or {}), **{k: v for k, v in props.items() if k in ("intermittent", "seasonal") and v}}
    if str(t.get("intermittent", "")).lower() == "yes":
        return "seasonal", "OSM intermittent=yes"
    if t.get("seasonal") and str(t.get("seasonal")).lower() != "no":
        return "seasonal", f"OSM seasonal={t.get('seasonal')}"
    if t.get("natural") == "wetland":
        return "seasonal", "OSM natural=wetland"
    kind = t.get("water") or props.get("ftype")
    return "permanent", f"OSM natural=water{f', water={kind}' if kind else ''}"


def _months(tile: Tile):
    """{month: (clear, water, ndvi)} boolean/float grids for every usable month, the grid's transform and CRS."""
    import rasterio
    meta = tile.path("seasons/months.json")
    if not meta.exists():
        return {}, None, None, None
    months = json.loads(meta.read_text()).get("months", [])
    out, tr, crs, shape = {}, None, None, None
    for mm in months:
        p = tile.path(f"seasons/s2_{mm['month']:02d}.tif")
        if mm.get("refused") or (mm.get("filled_fraction") or 0) > REFUSE_FILLED or not p.exists():
            continue
        with rasterio.open(p) as r:
            a = r.read().astype("float32")
            tr, crs, shape = r.transform, r.crs, (r.height, r.width)
        R, G, B, V = a[:4]
        with np.errstate(all="ignore"):
            valid = np.isfinite(R) & np.isfinite(G) & np.isfinite(B) & np.isfinite(V) & (np.abs(V) < 0.999)
            N = R * (1 + V) / np.maximum(1 - V, 1e-3)
            ndwi = (G - N) / np.maximum(G + N, 1e-6)
            bright = valid & ((G >= BRIGHT_GREEN) | ((V < 0.1) & (B >= BRIGHT_BLUE)))
            clear = valid & ~bright
            water = clear & ((ndwi > 0) | (N < DARK_NIR))
        out[int(mm["month"])] = (clear, water, np.where(valid, V, np.nan))
    return out, tr, crs, shape


def judge(fracs: dict[int, float | None], core_px: int) -> tuple[str | None, list[int], str]:
    """The imagery's class from the observed months' water fractions (None: unresolved), the wet months, and why."""
    obs = {m: f for m, f in fracs.items() if f is not None}
    if core_px < MIN_CORE_PX:
        return None, [], f"{core_px} core pixel(s) of 20 m: too small to judge"
    if len(obs) < MIN_MONTHS:
        return None, [], f"{len(obs)} observed month(s)"
    wet = sorted(m for m, f in obs.items() if f >= WET_FRAC)
    if not wet:
        return "dry", wet, f"no month with {WET_FRAC:.0%} open water in {len(obs)} observed (max {max(obs.values()):.0%})"
    if len(wet) >= PERMANENT_SHARE * len(obs):
        return "permanent", wet, f"open water in {len(wet)} of {len(obs)} observed months"
    return "seasonal", wet, f"open water in {len(wet)} of {len(obs)} observed months"


def classify(tile: Tile) -> dict:
    from pyproj import Transformer
    from rasterio.features import rasterize
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    feats = json.loads(tile.path("hydro/waterbodies.geojson").read_text()).get("features", [])
    months, tr, crs, grid = _months(tile)
    tags = _osm_tags(tile)
    to_tile = Transformer.from_crs("EPSG:4326", crs or tile.crs, always_xy=True).transform
    bodies, counts = [], {"permanent": 0, "seasonal": 0, "dry": 0}
    basis_n = {"imagery": 0, "tags": 0}
    for i, f in enumerate(feats):
        pr = f.get("properties") or {}
        if str(pr.get("ftype")) == "378":    # NHD Ice Mass: a glacier (water_seams.py), not a waterbody
            continue
        bid = body_id(pr, i)
        try:
            g = shp_transform(to_tile, shape(f["geometry"]))
        except Exception:  # noqa: BLE001
            continue
        if g.is_empty:
            continue
        fracs: dict[int, float | None] = {}
        core_px, bed, green_ndvi = 0, None, None
        if months:
            core = g.buffer(-CORE_INSET_M)
            mask = (rasterize([core], out_shape=grid, transform=tr, fill=0, default_value=1, dtype="uint8").astype(bool)
                    if not core.is_empty else np.zeros(grid, bool))
            core_px = int(mask.sum())
            if core_px:
                for mo, (clear, water, V) in sorted(months.items()):
                    k = int(clear[mask].sum())
                    fracs[mo] = round(float(water[mask].sum()) / k, 3) if k >= 0.5 * core_px else None
                    v = V[mask]
                    if np.isfinite(v).any():
                        med = float(np.nanmedian(v))
                        green_ndvi = med if green_ndvi is None else max(green_ndvi, med)
        cls, wet, why = judge(fracs, core_px)
        basis = "imagery"
        if cls is None:
            cls, tag_why = tag_class(pr, tags.get(str(pr.get("osm_id"))))
            basis, why = "tags", f"{why}; by its tags: {tag_why}"
            wet = []
        if cls == "dry":
            bed = "meadow" if (green_ndvi or 0) >= MEADOW_NDVI else "bare"
        counts[cls] += 1
        basis_n[basis] += 1
        bodies.append({
            "id": bid, "index": i, "name": pr.get("gnis_name") or pr.get("name"),
            "source": pr.get("source") or ("nhd" if pr.get("permanent_identifier") else None),
            "fcode": pr.get("fcode"), "ftype": pr.get("ftype"), "area_m2": round(float(g.area), 1),
            "core_px": core_px, "class": cls, "basis": basis, "reason": why, "wet_months": wet,
            **({"bed": bed, "max_ndvi": round(green_ndvi, 3) if green_ndvi is not None else None} if bed else {}),
            # water fraction per calendar month, January first (null: not observed)
            "water_fraction": [fracs.get(m) for m in range(1, 13)] if months else None,
        })
    rule = {"bands": "seasons/s2_MM.tif red, green, blue, NDVI (no SWIR); NIR = red (1 + NDVI) / (1 - NDVI)",
            "water_pixel": f"NDWI (green - NIR) / (green + NIR) > 0 or NIR < {DARK_NIR}, and not bright",
            "bright_pixel": f"green >= {BRIGHT_GREEN} or (NDVI < 0.1 and blue >= {BRIGHT_BLUE}): ice, snow, cloud (not counted)",
            "core": f"the polygon inset {CORE_INSET_M:g} m (pixels wholly inside), at least {MIN_CORE_PX} pixels",
            "wet_month": f"water fraction of the core's clear pixels >= {WET_FRAC}; observed when clear >= half the core",
            "classes": f"dry: wet in none of >= {MIN_MONTHS} observed months; permanent: wet in >= {PERMANENT_SHARE:.0%} "
                       f"of them; seasonal: the rest; unresolved: by the tags",
            "dry_bed": f"meadow when the greenest observed month's median NDVI >= {MEADOW_NDVI}, else bare"}
    doc = {"rule": rule, "months_used": sorted(months), "counts": counts, "basis": basis_n, "bodies": bodies}
    write_json(tile.path(OUT), doc)
    print(f"water_seasons: {len(bodies)} waterbodies, {counts} ({basis_n}), months {sorted(months)}")
    return {
        "hydro.waterbody_seasons": {
            "path": OUT, "kind": "table", "derived_from": ["hydro.waterbodies", "seasons.s2_monthly"],
            "method": "every mapped waterbody against the tile's monthly Sentinel-2 composites (pipeline/water_seasons.py)",
            "rule": rule, "months_used": sorted(months), "counts": counts, "basis": basis_n,
            # the evidence per polygon: class, basis, core pixels, water fraction per month (January first)
            "evidence": [{"id": b["id"], "class": b["class"], "basis": b["basis"], "core_px": b["core_px"],
                          **({"bed": b["bed"]} if "bed" in b else {}),
                          "water_fraction": b["water_fraction"]} for b in bodies],
        }
    }


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tile", required=True)
    a = ap.parse_args()
    classify(Tile.from_id(a.tile))
