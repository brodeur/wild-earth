"""Research: which species live on a tile, ranked, and why each is on the list (docs/pipeline.md, "Species").

Aaron, 2026-11-04: "the species creation pipeline begins with research - what are the species in this region? We are
specifically looking for the most populous species plus all predators and scavengers. So plants animals trees, even
fungi eventually. We list all the species, then we pick a species density equivalent or greater than the foothills and
start generating assets."

  plants   the cover each species holds in the tile's communities (its LANDFIRE community cells x the species-mix rule's
           weight, or the community's named species) and its GBIF records on the tile (cached facet counts: the 150
           most-recorded vascular plants)
  animals  the GBIF records on the tile per class (birds 150, mammals 80, reptiles, amphibians, fish 30 each, land
           snails and slugs 20; fungi: a place in KINDS, not fetched yet), each species' share of its class's records
           (records follow observers: birds are over-recorded against mammals, the charismatic against the cryptic, so
           species are ranked within their class, never across), and its trophic role from EltonTraits 1.0 (Wilman et
           al. 2014; birds and mammals worldwide; CC BY 4.0 by Ecological Archives' default, "no copyright
           restrictions" on the record): a predator takes 30 % or more of its diet from vertebrates, a scavenger 10 %
           or more from carrion. Every predator and scavenger recorded on the tile is on the list whatever its rank.

Licences: GBIF counts are facets (numbers, no records); the occurrence records themselves stay pipeline-only (the
species step's for_clients: false), and only CC0 / CC BY records place anything a client sees (species_prior, groves).

The density target (TARGET) is the home tile's: 21 trees, 23 shrubs, 26 ground plants and 22 animals, each with a role.
A tile's list is filled to at least that per kind, from the top of each class.
"""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from .config import REPO_ROOT, SOURCES, Tile

KINDS = ("tree", "shrub", "forb", "grass", "emergent", "fern", "moss", "mammal", "bird", "reptile", "amphibian", "fish",
         "invertebrate", "fungus")
TARGET = {"tree": 21, "shrub": 23, "ground": 26, "animal": 22}   # the home tile, utm10n_680_4280 (2026-11-04)
ANIMAL_CLASSES = {  # GBIF class key -> (kind, how many of the most recorded)
    # reptiles: GBIF's backbone has no class Reptilia any more (key 358 returns no records; 2026-11-06): its classes are
    # Squamata, Testudines and Crocodylia, each faceted on its own and ranked together as reptiles (animal_records)
    212: ("bird", 150), 359: ("mammal", 80), 11592253: ("reptile", 30), 11418114: ("reptile", 10), 11493978: ("reptile", 5),
    131: ("amphibian", 30), 204: ("fish", 30),
    225: ("invertebrate", 20),   # Gastropoda: land snails and slugs (the banana slug)
}
PLANT_LIMIT = 150
ELTON_DIR = REPO_ROOT / "pipeline" / "_cache" / "eltontraits"   # a folder of its own: downloaded data, never executed
ELTON_FILES = {"bird": "https://esapubs.org/archive/ecol/E095/178/BirdFuncDat.txt",
               "mammal": "https://esapubs.org/archive/ecol/E095/178/MamFuncDat.txt"}
PREDATOR_VERT, SCAVENGER = 5, 1   # in tenths of the diet (EltonTraits' 10 % steps): 50 % vertebrates, 10 % carrion

SOURCES["eltontraits"] = {
    "name": "EltonTraits 1.0: species-level foraging attributes of the world's birds and mammals",
    "url": "https://esapubs.org/archive/ecol/E095/178/",
    "license": "CC BY 4.0 (Ecological Archives' default; the record states no copyright restrictions)",
    "license_url": "https://esapubs.org/archive/copyright.htm",
    "attribution": "Diet and body mass: Wilman, H., Belmaker, J., Simpson, J., de la Rosa, C., Rivadeneira, M. M. and Jetz, W. "
                   "(2014). EltonTraits 1.0. Ecology 95: 2027. Body masses after Smith et al. 2003 and Dunning 2007",
    "attribution_url": "https://doi.org/10.1890/13-1917.1",
    "attribution_required": True,
}


def _bbox(tile: Tile) -> dict:
    w, s, e, n = tile.bounds_wgs84
    return {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}", "hasCoordinate": "true", "hasGeospatialIssue": "false"}


def _facet(tile: Tile, rank: str, key: int, limit: int) -> list[dict]:
    """The species GBIF has most records of on the tile in a taxon: [{gbif_key, scientific, records, taxonomy}]."""
    from .fetch_species import _q
    r = _q(tile, "occurrence/search", {**_bbox(tile), rank: key, "limit": 0, "facet": "speciesKey", "facetLimit": limit})
    out = []
    for fac in r.get("facets", []):
        for c in fac.get("counts", []):
            sp = _q(None, f"species/{c['name']}", {})
            sci = sp.get("canonicalName") or sp.get("scientificName")
            if not sci:
                continue
            out.append({"gbif_key": int(c["name"]), "scientific": sci, "common": (sp.get("vernacularName") or "").lower() or None,
                        "records": c["count"], "taxonomy": {k: sp.get(k) for k in ("kingdom", "phylum", "class", "order", "family", "genus")}})
    return out


def plant_records(tile: Tile) -> list[dict]:
    return _facet(tile, "phylumKey", 7707728, PLANT_LIMIT)


def animal_records(tile: Tile) -> list[dict]:
    by_kind: dict[str, list] = {}
    for key, (kind, lim) in ANIMAL_CLASSES.items():   # (several GBIF classes may make one kind: the reptiles)
        by_kind.setdefault(kind, []).extend(_facet(tile, "classKey", key, lim))
    out = []
    for kind, rows in by_kind.items():
        rows.sort(key=lambda r: -r["records"])
        tot = sum(r["records"] for r in rows) or 1
        for i, r in enumerate(rows):
            out.append({**r, "kind": kind, "rank_in_class": i + 1, "share_of_class": round(r["records"] / tot, 4)})
    return out


def id_of(scientific: str) -> str:
    parts = scientific.replace("subsp.", "").replace("var.", "").split()
    return "_".join(parts[:2]).lower().replace("-", "_")


# --------------------------------------------------------------------------------------------- EltonTraits

_ELTON: dict | None = None


def eltontraits() -> dict:
    """{binomial: {kind, diet {inv, vend, vect, vfish, vunk, scav, fruit, nect, seed, plant} in tenths, mass_g, nocturnal,
    crepuscular, diurnal}}; downloaded once into its own folder (cached), read as data."""
    global _ELTON
    if _ELTON is not None:
        return _ELTON
    from .http import download
    ELTON_DIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for kind, url in ELTON_FILES.items():
        dest = download(url, None, ELTON_DIR / url.rsplit("/", 1)[1])
        text = dest.read_bytes().decode("latin-1")
        for r in csv.DictReader(io.StringIO(text), delimiter="\t"):
            sci = (r.get("Scientific") or "").strip()
            if not sci:
                continue

            def num(k):
                try:
                    return float(r.get(k) or "nan")
                except ValueError:
                    return float("nan")
            diet = {k.split("-")[1].lower(): num(k) for k in ("Diet-Inv", "Diet-Vend", "Diet-Vect", "Diet-Vfish", "Diet-Vunk",
                                                               "Diet-Scav", "Diet-Fruit", "Diet-Nect", "Diet-Seed", "Diet-PlantO")}
            fam = r.get("BLFamilyLatin") or r.get("MSWFamilyLatin") or ""
            out[sci] = {"kind": kind, "family": fam, "diet": {k: (v / 10 if v == v else None) for k, v in diet.items()},
                        "mass_g": num("BodyMass-Value"),
                        "nocturnal": r.get("Nocturnal") == "1" or r.get("Activity-Nocturnal") == "1",
                        "crepuscular": r.get("Activity-Crepuscular") == "1", "diurnal": r.get("Activity-Diurnal") == "1"}
    # genus and family means, for a name EltonTraits files under another (Cervus canadensis is its Cervus elaphus)
    groups: dict = {}
    for sci, e in list(out.items()):
        for key in ("genus:" + sci.split()[0], "family:" + (e.get("family") or "")):
            groups.setdefault(key, []).append(e)
    for key, es in groups.items():
        diet = {k: sum((e["diet"][k] or 0) for e in es) / len(es) for k in es[0]["diet"]}
        masses = [e["mass_g"] for e in es if e["mass_g"] == e["mass_g"]]
        out[key] = {"kind": es[0]["kind"], "diet": diet, "mass_g": (sum(masses) / len(masses)) if masses else float("nan"),
                    "nocturnal": False, "crepuscular": False, "diurnal": False, "n": len(es)}
    _ELTON = out
    return out


def trophic(sci: str, family: str | None = None) -> dict | None:
    """The trophic role from EltonTraits: the species, else its genus' mean, else its family's (named as such)."""
    et = eltontraits()
    e, level = et.get(" ".join(sci.split()[:2])), "species"
    if not e:
        e, level = et.get("genus:" + sci.split()[0]), "genus"
    if not e and family:
        e, level = et.get("family:" + family), "family"
    if not e:
        return None
    d = {k: (v or 0.0) for k, v in e["diet"].items()}
    vert = d["vend"] + d["vect"] + d["vfish"] + d["vunk"]
    role = []
    if vert >= PREDATOR_VERT:
        role.append("predator")
    if d["scav"] >= SCAVENGER:
        role.append("scavenger")
    plant = d["fruit"] + d["nect"] + d["seed"] + d["planto"]
    if "predator" not in role:
        role.insert(0, "herbivore" if plant >= 7 else "insectivore" if d["inv"] >= 6 else "omnivore")
    return {"role": role, "diet_tenths": {k: round(v, 1) for k, v in d.items()}, "vertebrate_share": round(vert / 10, 2),
            "mass_kg": round(e["mass_g"] / 1000, 4) if e["mass_g"] == e["mass_g"] else None,
            "activity": [k for k in ("nocturnal", "crepuscular", "diurnal") if e.get(k)], "source": f"eltontraits ({level})"}
