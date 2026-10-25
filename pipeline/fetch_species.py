"""Species: GBIF occurrences for the curated species list, plus a tile inventory."""
from __future__ import annotations

from .config import Tile, write_json
from .http import get
from .species_data import SPECIES

GBIF = "https://api.gbif.org/v1"
MAX_PER_SPECIES = 1500
CLASS_KEYS = {"bird": 212, "mammal": 359}


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
    write_json(tile.path("species/species.json"), species)
    write_json(tile.path("species/occurrences.geojson"), {"type": "FeatureCollection", "features": feats})
    write_json(tile.path("species/seasonal.json"), {"months": list(range(1, 13)), "counts": seasonal})
    write_json(tile.path("species/inventory.json"), inventory(tile))
    return {
        "species.list": {"path": "species/species.json", "kind": "table", "source": "gbif",
                         "count": len(species)},
        "species.occurrences": {"path": "species/occurrences.geojson", "kind": "vector",
                                "source": "gbif", "feature_count": len(feats)},
        "species.seasonal": {"path": "species/seasonal.json", "kind": "table", "source": "gbif"},
        "species.inventory": {"path": "species/inventory.json", "kind": "table", "source": "gbif"},
    }
