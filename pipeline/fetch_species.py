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
The search scales with the animal's home range (2026-11-07): GBIF's records of a wide-ranging, cryptic carnivore are
sparse at a 10 km cell's scale (two records of the cougar within 10 km of the Hoh since 2011, though Olympic National Park
documents it), so a mammal with a PanTHERIA home range searches a box around the tile that holds HOME_RANGES of them
(home_range_buffer_m): the cougar's 130 km2 ranges take some 24 km round the tile (12 records on the Hoh), a black bear's
31 km2 or an elk's 30 still the 10 km; capped at PRESENCE_BUFFER_MAX_M.
Each entry of species.json carries `present`, `rule` (records, range or absent), `records_buffer`, `range_share` and
`evidence` (one line). The buffered counts are cached per tile under _cache/gbif/ and not asked again.
"""
from __future__ import annotations

import json
import time
from datetime import date

import numpy as np

from .config import REPO_ROOT, Tile, write_json
from .http import get, get_json_cached
from .species_data import RANGE, SPECIES

GBIF = "https://api.gbif.org/v1"
MAX_PER_SPECIES = 1500
CLASS_KEYS = {"bird": 212, "mammal": 359}
# The plants the tile's records name (2026-11-04, the species registry): the vascular plants (phylum Tracheophyta),
# most-recorded first, so a tile's needs list carries the trees and shrubs GBIF knows there (pipeline/needs.py).
PLANT_KEYS = {"plant": ("phylumKey", 7707728)}
PLANT_LIMIT = 120
PRESENCE_BUFFER_M = 10_000   # records this far around the tile count for its presence
HOME_RANGES = 25             # ... or farther: the search box holds this many of the animal's home ranges (a population)
PRESENCE_BUFFER_MAX_M = 50_000
PRESENCE_YEARS = 15          # ... over the last this many calendar years, this one included
MIN_RECORDS = 3              # records that make a species present
MIN_RANGE_SHARE = 0.05       # share of the tile in the species' elevation band and habitats that makes it present
POLITE_S = 0.25              # pause after each uncached GBIF count


def _q(tile: Tile | None, path: str, params: dict, force=False) -> dict:
    """A GBIF GET, cached (2026-11-04: occurrences, month facets and the inventory were asked again on every run, so
    a rebuild was not repeatable and a GBIF outage failed the step). Per tile under _cache/gbif/q_<hash>.json; the
    name matches, which do not depend on the tile, under pipeline/_cache/gbif/."""
    import hashlib
    key = hashlib.sha256(json.dumps([path, sorted(params.items())], default=str).encode()).hexdigest()[:20]
    cache = (tile.path(f"_cache/gbif/q_{key}.json") if tile is not None
             else REPO_ROOT / "pipeline" / "_cache" / "gbif" / f"q_{key}.json")
    return get_json_cached(f"{GBIF}/{path}", params, cache, force=force, source="gbif")


def match_key(scientific: str) -> int | None:
    r = _q(None, "species/match", {"name": scientific, "strict": "true"})
    return r.get("usageKey") if r.get("matchType") != "NONE" else None


def _epithets(sp: dict) -> set[str]:
    """Every Latin word of a GBIF species record's name and of its subspecies' names (lower case)."""
    words = {w.lower() for w in (sp.get("canonicalName") or sp.get("scientificName") or "").split()}
    key = sp.get("key") or sp.get("usageKey")
    if key:
        try:
            for c in _q(None, f"species/{key}/children", {"limit": 300}).get("results", []):
                words |= {w.lower() for w in (c.get("canonicalName") or "").split()}
        except Exception:   # offline: the record's own words still guard
            pass
    return words


def _english_names(sp: dict) -> list[str]:
    """GBIF's English vernacular names for a species record, the most cited first."""
    from collections import Counter
    key = sp.get("key") or sp.get("usageKey")
    if not key:
        return []
    try:
        res = _q(None, f"species/{key}/vernacularNames", {"limit": 300}).get("results", [])
    except Exception:
        return []
    names = Counter(v["vernacularName"].strip() for v in res if v.get("language") in ("eng", "en") and v.get("vernacularName"))
    return [n for n, _ in names.most_common()]


def common_name(sp: dict) -> str | None:
    """A species record's common name, lower case: GBIF's vernacularName when it is a real name, else its most cited
    English vernacular name; never a Latin word of the species or of its subspecies (2026-11-08: GBIF's record for
    Crotalus oreganus carries the subspecies epithet "abyssus" as its vernacularName, and the northern Pacific
    rattlesnake was called Abyssus in the cast)."""
    bad = None
    for cand in [sp.get("vernacularName") or ""] + _english_names(sp):
        c = " ".join(cand.split()).lower()
        if not c or not any(ch.isalpha() for ch in c):
            continue
        if " " in c or "-" in c:   # an epithet is one word; asking GBIF for the subspecies only for one-word names
            return c
        if bad is None:
            bad = _epithets(sp)
        if all(w in bad for w in c.replace("-", " ").split()):   # only Latin name words: an epithet, not a name
            continue
        return c
    return None


def _bbox_params(tile: Tile) -> dict:
    w, s, e, n = tile.bounds_wgs84
    return {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}",
            "hasCoordinate": "true", "hasGeospatialIssue": "false"}


def occurrences(tile: Tile, key: int) -> list[dict]:
    out, offset = [], 0
    while offset < MAX_PER_SPECIES:
        r = _q(tile, "occurrence/search", {**_bbox_params(tile), "taxonKey": key, "limit": 300, "offset": offset})
        out.extend(r.get("results", []))
        if r.get("endOfRecords") or not r.get("results"):
            break
        offset += 300
    return out


def monthly_counts(tile: Tile, key: int) -> list[int]:
    r = _q(tile, "occurrence/search", {**_bbox_params(tile), "taxonKey": key, "limit": 0, "facet": "month", "facetLimit": 12})
    counts = [0] * 12
    for fac in r.get("facets", []):
        for c in fac.get("counts", []):
            m = int(c["name"])
            if 1 <= m <= 12:
                counts[m - 1] = c["count"]
    return counts


def inventory(tile: Tile, limit=40) -> list[dict]:
    """Most-recorded species of each class in the tile (birds and mammals, `limit` each) and the most-recorded
    vascular plants (PLANT_LIMIT); seed for the local-knowledge review and for the tile's needs (pipeline/needs.py)."""
    rows = []
    groups = [(g, ("classKey", ck), limit) for g, ck in CLASS_KEYS.items()] + [(g, kv, PLANT_LIMIT) for g, kv in PLANT_KEYS.items()]
    for group, (rank, ck), lim in groups:
        r = _q(tile, "occurrence/search", {**_bbox_params(tile), rank: ck, "limit": 0, "facet": "speciesKey", "facetLimit": lim})
        for fac in r.get("facets", []):
            for c in fac.get("counts", []):
                sp = _q(None, f"species/{c['name']}", {})
                rows.append({"gbif_key": int(c["name"]), "group": group,
                             "scientific": sp.get("canonicalName") or sp.get("scientificName"),
                             "family": sp.get("family"), "genus": sp.get("genus"), "order": sp.get("order"),
                             "common": common_name(sp),
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


def home_range_buffer_m(tile: Tile, scientific: str) -> int:
    """The presence search's buffer for a species: PRESENCE_BUFFER_M, or wider so that the tile and its buffer hold
    HOME_RANGES of the animal's home ranges (PanTHERIA, mammals), to PRESENCE_BUFFER_MAX_M; whole km."""
    from . import pantheria
    try:
        hr = (pantheria.lookup(scientific) or {}).get("home_range_km2")
    except Exception:   # noqa: BLE001 (no PanTHERIA: the cell-scale search)
        hr = None
    if not hr:
        return PRESENCE_BUFFER_M
    side_m = (HOME_RANGES * float(hr)) ** 0.5 * 1000
    tile_m = max(tile.bounds[2] - tile.bounds[0], tile.bounds[3] - tile.bounds[1])
    b = (side_m - tile_m) / 2
    return int(min(PRESENCE_BUFFER_MAX_M, max(PRESENCE_BUFFER_M, round(b / 1000) * 1000)))


def records_near(tile: Tile, key: int, years: tuple[int, int], force=False, buf_m: int = PRESENCE_BUFFER_M) -> int:
    """GBIF records of taxon `key` within buf_m of the tile in `years` (inclusive); cached per tile."""
    cache = tile.path(f"_cache/gbif/near_{key}_{buf_m // 1000}km_{years[0]}-{years[1]}.json")
    if cache.exists() and not force:
        return int(json.loads(cache.read_text())["count"])
    w, s, e, n = _buffer_bbox(tile, buf_m)
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


def presence(tile: Tile, keys: dict[str, int | None], force=False, scientific: dict[str, str] | None = None) -> dict[str, dict]:
    """Per species code: present, rule, records_buffer, range_share, evidence (see the module docstring)."""
    y1 = date.today().year
    years = (y1 - PRESENCE_YEARS, y1)
    # the range test is California's (species_data.RANGE: the central Sierra's life zones after Grinnell and Storer):
    # outside California a curated species is present by its records alone, never by a California elevation band
    from .regions import natural_regions
    shares = range_shares(tile) if "california" in natural_regions(tile) else None
    out = {}
    for code, key in keys.items():
        buf = home_range_buffer_m(tile, (scientific or {}).get(code) or "") if key else PRESENCE_BUFFER_M
        n = records_near(tile, key, years, force, buf) if key else 0
        share = shares.get(code) if shares else None
        r = RANGE.get(code)
        band = f"{r['elev_m'][0]}-{r['elev_m'][1]} m on {', '.join(h.replace('_', ' ') for h in r['habitats'])}" if r else "no range"
        rec = f"{n} record{'s' if n != 1 else ''} within {buf // 1000} km in {years[0]}-{years[1]}" + \
            (" (the search widened to hold its home ranges)" if buf > PRESENCE_BUFFER_M else "")
        rng = f"{share:.0%} of the tile in its range ({band})" if share is not None else "no range test (no DEM or habitat raster)"
        if n >= MIN_RECORDS:
            rule, ev = "records", f"{rec} (>= {MIN_RECORDS})"
        elif share is not None and share >= MIN_RANGE_SHARE:
            rule, ev = "range", f"{rng} (>= {MIN_RANGE_SHARE:.0%}); {rec} (< {MIN_RECORDS})"
        else:
            rule, ev = "absent", f"{rec} (< {MIN_RECORDS}); {rng} (< {MIN_RANGE_SHARE:.0%})"
        out[code] = {"present": rule != "absent", "rule": rule, "records_buffer": n, "buffer_m": buf, "range_share": share, "evidence": ev}
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
    pres = presence(tile, {e["code"]: e["gbif_key"] for e in species}, force, {e["code"]: e["scientific"] for e in species})
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
