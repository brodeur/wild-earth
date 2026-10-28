"""Species: GBIF occurrences for the curated species list, plus a tile inventory, and which of the curated species
live on the tile (`present`).

Presence (2026-10-27): every tile used to get all the curated species, so the Yosemite Valley tile had brush rabbits
and jackrabbits. A species is present on a tile if
  records: GBIF has at least MIN_RECORDS records of it within PRESENCE_BUFFER_M of the tile in the last PRESENCE_YEARS
           years (a single record or a pair can be a misidentification, a vagrant or a coordinate obscured to a box);
  or range: at least MIN_RANGE_SHARE of the tile lies in its elevation band on one of its habitat classes
           (species_data.RANGE; the tile's DEM and rewilded habitat raster), which keeps the species GBIF misses (the
           brush rabbit has no record within 10 km of the home tile since 2011, the mountain lion two around Yosemite
           Valley) where it can live.
Each entry of species.json carries `present`, `rule` (records, range or absent), `records_buffer`, `range_share` and
`evidence` (one line). The buffered counts are cached per tile under _cache/gbif/ and not asked again.
"""
from __future__ import annotations

import json
import time
from datetime import date

import numpy as np

from .config import Tile, write_json
from .http import get
from .species_data import RANGE, SPECIES

GBIF = "https://api.gbif.org/v1"
MAX_PER_SPECIES = 1500
CLASS_KEYS = {"bird": 212, "mammal": 359}
PRESENCE_BUFFER_M = 10_000   # records this far around the tile count for its presence
PRESENCE_YEARS = 15          # ... over the last this many calendar years, this one included
MIN_RECORDS = 3              # records that make a species present
MIN_RANGE_SHARE = 0.05       # share of the tile in the species' elevation band and habitats that makes it present
POLITE_S = 0.25              # pause after each uncached GBIF count


def match_key(scientific: str) -> int | None:
    r = get(f"{GBIF}/species/match", {"name": scientific, "strict": "true"}).json()
    return r.get("usageKey") if r.get("matchType") != "NONE" else None


def _bbox_params(tile: Tile) -> dict:
    w, s, e, n = tile.bounds_wgs84
    return {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}",
            "hasCoordinate": "true", "hasGeospatialIssue": "false"}


def occurrences(tile: Tile, key: int) -> list[dict]:
    out, offset = [], 0
    while offset < MAX_PER_SPECIES:
        r = get(f"{GBIF}/occurrence/search", {**_bbox_params(tile), "taxonKey": key,
                                               "limit": 300, "offset": offset}).json()
        out.extend(r.get("results", []))
        if r.get("endOfRecords") or not r.get("results"):
            break
        offset += 300
    return out


def monthly_counts(tile: Tile, key: int) -> list[int]:
    r = get(f"{GBIF}/occurrence/search", {**_bbox_params(tile), "taxonKey": key, "limit": 0,
                                           "facet": "month", "facetLimit": 12}).json()
    counts = [0] * 12
    for fac in r.get("facets", []):
        for c in fac.get("counts", []):
            m = int(c["name"])
            if 1 <= m <= 12:
                counts[m - 1] = c["count"]
    return counts


def inventory(tile: Tile, limit=40) -> list[dict]:
    """Most-recorded species of each class in the tile; seed for the local-knowledge review."""
    rows = []
    for group, ck in CLASS_KEYS.items():
        r = get(f"{GBIF}/occurrence/search", {**_bbox_params(tile), "classKey": ck, "limit": 0,
                                               "facet": "speciesKey", "facetLimit": limit}).json()
        for fac in r.get("facets", []):
            for c in fac.get("counts", []):
                sp = get(f"{GBIF}/species/{c['name']}").json()
                rows.append({"gbif_key": int(c["name"]), "group": group,
                             "scientific": sp.get("canonicalName") or sp.get("scientificName"),
                             "common": (sp.get("vernacularName") or "").lower() or None,
                             "occurrences": c["count"]})
    return rows


def _buffer_bbox(tile: Tile, buf_m: float) -> tuple[float, float, float, float]:
    """The tile's bounds grown by buf_m on every side, as a lon/lat box (edges sampled, so the box holds the square)."""
    from pyproj import Transformer
    inv = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    xs, ys = np.linspace(x0 - buf_m, x1 + buf_m, 9), np.linspace(y0 - buf_m, y1 + buf_m, 9)
    pts = [inv.transform(x, y) for x in xs for y in (ys[0], ys[-1])] + [inv.transform(x, y) for x in (xs[0], xs[-1]) for y in ys]
    lons, lats = zip(*pts)
    return min(lons), min(lats), max(lons), max(lats)


def records_near(tile: Tile, key: int, years: tuple[int, int], force=False) -> int:
    """GBIF records of taxon `key` within PRESENCE_BUFFER_M of the tile in `years` (inclusive); cached per tile."""
    cache = tile.path(f"_cache/gbif/near_{key}_{PRESENCE_BUFFER_M // 1000}km_{years[0]}-{years[1]}.json")
    if cache.exists() and not force:
        return int(json.loads(cache.read_text())["count"])
    w, s, e, n = _buffer_bbox(tile, PRESENCE_BUFFER_M)
    params = {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}", "hasCoordinate": "true",
              "hasGeospatialIssue": "false", "taxonKey": key, "year": f"{years[0]},{years[1]}", "limit": 0}
    count = int(get(f"{GBIF}/occurrence/search", params).json()["count"])
    cache.write_text(json.dumps({"count": count, "params": params, "fetched": date.today().isoformat()}))
    time.sleep(POLITE_S)
    return count


def range_shares(tile: Tile) -> dict[str, float] | None:
    """Per species, the share of the tile inside its elevation band (species_data.RANGE) on one of its habitat classes,
    on the 30 m habitat grid (the DEM averaged onto it); None without a DEM or a habitat raster."""
    import rasterio
    from rasterio.enums import Resampling
    from .habitat import CODES
    dem_p, hab_p = tile.dir / "terrain/dem.tif", tile.dir / "vegetation/habitat.tif"
    if not dem_p.exists() or not hab_p.exists():
        return None
    with rasterio.open(hab_p) as src:
        hab = src.read(1)
    with rasterio.open(dem_p) as src:
        z = src.read(1, out_shape=hab.shape, resampling=Resampling.average, masked=True).filled(np.nan)
    ok = (hab > 0) & np.isfinite(z)
    if not ok.any():
        return None
    out = {}
    for code, r in RANGE.items():
        lo, hi = r["elev_m"]
        m = ok & (z >= lo) & (z <= hi) & np.isin(hab, [CODES[h] for h in r["habitats"]])
        out[code] = round(float(m.sum() / ok.sum()), 4)
    return out


def presence(tile: Tile, keys: dict[str, int | None], force=False) -> dict[str, dict]:
    """Per species code: present, rule, records_buffer, range_share, evidence (see the module docstring)."""
    y1 = date.today().year
    years = (y1 - PRESENCE_YEARS, y1)
    shares = range_shares(tile)
    out = {}
    for code, key in keys.items():
        n = records_near(tile, key, years, force) if key else 0
        share = shares.get(code) if shares else None
        r = RANGE.get(code)
        band = f"{r['elev_m'][0]}-{r['elev_m'][1]} m on {', '.join(h.replace('_', ' ') for h in r['habitats'])}" if r else "no range"
        rec = f"{n} record{'s' if n != 1 else ''} within {PRESENCE_BUFFER_M // 1000} km in {years[0]}-{years[1]}"
        rng = f"{share:.0%} of the tile in its range ({band})" if share is not None else "no range test (no DEM or habitat raster)"
        if n >= MIN_RECORDS:
            rule, ev = "records", f"{rec} (>= {MIN_RECORDS})"
        elif share is not None and share >= MIN_RANGE_SHARE:
            rule, ev = "range", f"{rng} (>= {MIN_RANGE_SHARE:.0%}); {rec} (< {MIN_RECORDS})"
        else:
            rule, ev = "absent", f"{rec} (< {MIN_RECORDS}); {rng} (< {MIN_RANGE_SHARE:.0%})"
        out[code] = {"present": rule != "absent", "rule": rule, "records_buffer": n, "range_share": share, "evidence": ev}
    return out


def fetch_species(tile: Tile, force=False) -> dict:
    species, feats, seasonal = [], [], {}
    for sp in SPECIES:
        key = sp.get("gbif_key") or match_key(sp["scientific"])   # a pinned taxon key, else the name match
        entry = {**sp, "gbif_key": key, "sources": ["gbif"], "confidence": "unverified"}
        if key:
            occ = occurrences(tile, key)
            for o in occ:
                feats.append({"type": "Feature",
                              "geometry": {"type": "Point",
                                           "coordinates": [o["decimalLongitude"], o["decimalLatitude"]]},
                              "properties": {"species_code": sp["code"], "gbif_id": o.get("key"),
                                             "date": (o.get("eventDate") or "")[:10] or None,
                                             "month": o.get("month"), "year": o.get("year"),
                                             "basis": o.get("basisOfRecord"),
                                             "dataset": o.get("datasetKey"),
                                             "license": o.get("license")}})
            entry["occurrence_count"] = len(occ)
            seasonal[sp["code"]] = monthly_counts(tile, key)
        species.append(entry)
    pres = presence(tile, {e["code"]: e["gbif_key"] for e in species}, force)
    for e in species:
        e.update(pres[e["code"]])
    write_json(tile.path("species/species.json"), species)
    write_json(tile.path("species/occurrences.geojson"), {"type": "FeatureCollection", "features": feats})
    write_json(tile.path("species/seasonal.json"), {"months": list(range(1, 13)), "counts": seasonal})
    write_json(tile.path("species/inventory.json"), inventory(tile))
    return {
        "species.list": {"path": "species/species.json", "kind": "table", "source": "gbif",
                         "count": len(species), "present": sum(1 for e in species if e["present"]),
                         "absent": [e["code"] for e in species if not e["present"]]},
        "species.occurrences": {"path": "species/occurrences.geojson", "kind": "vector",
                                "source": "gbif", "feature_count": len(feats)},
        "species.seasonal": {"path": "species/seasonal.json", "kind": "table", "source": "gbif"},
        "species.inventory": {"path": "species/inventory.json", "kind": "table", "source": "gbif"},
    }
