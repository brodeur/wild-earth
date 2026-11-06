"""Trait cards for a tile's own grasses and forbs: the ground layer of a tile outside the regional tables (world pipeline,
2026-11-06, phase 1 iteration 7).

A tile in no natural-region table (pipeline/regions.py NATURAL: Yellowstone's Lamar Valley, Grand Teton) had no ground
species at all: the library's grasses and forbs are California's and their class weights are not borrowed outside the
tables, so the Lamar's montane sagebrush steppe drew sagebrush over bare ground. This step chooses, for each LANDFIRE
community on the tile, its dominant grasses and forbs by rule from open evidence, writes species/ground.json (each
community's ground species, their weights and the evidence), and writes a sourced trait card (library/plant_cards/<id>.json)
for every chosen species that has no library record, which plantgen grows into a record the grass and forb layers draw.
species_mix.py puts them in the ground layer of their communities' rows (species_mix.own_ground).

Choosing the species (choose()):
  1 the community's description  every EVT and BpS community of the tile gets a LANDFIRE Biophysical Settings model
                 description (LANDFIRE BpS Models and Descriptions; USDA Forest Service, DOI, USGS and The Nature
                 Conservancy; public domain), the docx named by the model code (bps.csv BPS_MODEL: "11260_21" is the
                 montane sagebrush steppe of map zone 21). A BpS row has its own model; an EVT row takes the model of the
                 same ecological system (NatureServe's system names are both the EVT's and the BpS's) in the tile's map
                 zone, else the BpS most common under the EVT's own cells on the tile (the site's potential vegetation:
                 a ruderal grassland on a sagebrush site takes the steppe's grasses, which is what a rewilded site grows).
  2 the names    from the description, in order: its "Dominant and Indicator Species" table (weight TABLE_W), then the
                 binomials of its Vegetation Description section ("Common grasses include: Festuca idahoensis, ...",
                 weight TEXT_W). Old names are resolved by the USDA PLANTS Database (Agropyron spicatum is Pseudoroegneria
                 spicata). A genus alone ("Lupinus spp.") is the tile's most-recorded native congener of the same growth
                 habit in its GBIF records (species/plant_needs.json gbif_plants), else dropped.
  3 the filter   a grass (PLANTS growth habit Graminoid) or a forb (Forb/herb), not a shrub or a tree (those are the shrub
                 and tree layers'); native in the lower 48 (or Alaska, Hawaii) by PLANTS; with a GBIF record within NEAR_DEG
                 of the tile (the description is a map zone's; the record says the species grows here). At most N_GRASS
                 grasses and N_FORB forbs per community, and over the tile at most TILE_GRASS grasses (the grass layer's
                 slots: client/src/grass.js GS_MAX less the generic grass) and TILE_FORB forbs, ranked by cells x weight.

The cards (card()), every value from the USDA PLANTS Database's characteristics of the species (public domain; a species
whose own row has none takes its first infraspecific taxon's, named in the card), by rule:
  height     Height, Mature -> height_m [half, full]; the grass clump's scale = the template's x the card's mid height over
             the template's (as plantgen scales any card)
  habit      Growth Form (Bunch, Rhizomatous, Stoloniferous...) and Duration: a perennial grass is a bunch clump (grass.js
             has two: annual and bunch), an annual an annual clump; a forb's habit from Shape and Orientation
  colour     Foliage Color -> the live leaf (FOLIAGE lexicon); the seasons from Active Growth Period: a season it grows in
             is live, the season after it curing (the tips half straw), then cured straw, then weathered grey (a calendar
             quarter each, as the client's seasons); Fall Conspicuous: autumn colour
  flowering  Bloom Period -> calendar months; Flower Color -> the flower; the head of a Triticeae grass a spike, of any
             other grass a panicle; the forb's flower shape by family (FLOWER_BY_FAMILY)
  cure       how fully a grass dries to straw: 0.8 when it grows in spring only, 0.6 when it keeps growing into summer, 0.4
             when it keeps its leaves (Leaf Retention, or year-round growth)
  habitat    no class weights (drawn only where a community's description names it, never from a tile's class fallback);
             the classes of the communities that named it as named_in_classes; shade from Shade Tolerance
Values no characteristic gives are the template's or a rule's default; the card's notes say which.

    python -m pipeline.ground_cards --tile utm12n_557_4964           # choose, write ground.json and the cards
    python -m pipeline.ground_cards --tile utm12n_557_4964 --plan    # choose only, print
"""
from __future__ import annotations

import argparse
import html
import io
import json
import re
import zipfile
from datetime import date

import numpy as np

from .config import REPO_ROOT, SOURCES, Tile, read_json, write_json

CARDS = REPO_ROOT / "library" / "plant_cards"
LIBRARY = REPO_ROOT / "library" / "species"
CACHE = REPO_ROOT / "pipeline" / "_cache"
BPS_DIR = CACHE / "landfire_bps"      # downloaded description documents: read as data (zip + XML), never executed
PLANTS_DIR = CACHE / "usda_plants"
BPS_DOC_URL = "https://landfirereview.org/zipper.php"
PLANTS_API = "https://plantsservices.sc.egov.usda.gov/api"
VERSION = "1"

TABLE_W, TEXT_W = 1.0, 0.5
NEAR_DEG = 0.5
N_GRASS, N_FORB = 6, 6
TILE_GRASS, TILE_FORB = 11, 16
NON_VEGETATED_BPS = (11, 12, 31)   # open water, ice, barren: no description of plants
AUTHORS = ["Wild Earth (generated by pipeline/ground_cards.py from the USDA PLANTS Database's characteristics)"]

SOURCES["landfire_bps"] = {
    "name": "LANDFIRE Biophysical Settings Models and Descriptions (USDA Forest Service, U.S. Department of the Interior, "
            "U.S. Geological Survey, The Nature Conservancy)",
    "url": "https://landfirereview.org/search.php",
    "license": "Public domain (U.S. Government work; access and use constraints: none)",
    "license_url": "https://landfire.gov/data/faqs",
    "attribution": "LANDFIRE. 2020. Biophysical settings models and descriptions. In: LANDFIRE Biophysical Settings Models and "
                   "Descriptions [Online]. Washington, DC: USDA Forest Service; U.S. Department of the Interior; U.S. Geological "
                   "Survey; Arlington, VA: The Nature Conservancy (Producers). Blankenship et al. 2021, Ecosphere 12(4): e03484",
    "attribution_url": "https://doi.org/10.1002/ecs2.3484",
    "attribution_required": False,
}
SOURCES["usda_plants"] = {
    "name": "USDA, NRCS. The PLANTS Database: plant profiles and characteristics",
    "url": "https://plants.usda.gov",
    "license": "Public domain (U.S. Government work)",
    "license_url": "https://plants.usda.gov/home/help",
    "attribution": "USDA, NRCS. 2026. The PLANTS Database (http://plants.usda.gov). National Plant Data Team, Greensboro, NC USA",
    "attribution_url": "https://plants.usda.gov",
    "attribution_required": False,
}


# --------------------------------------------------------------------------------------------- BpS descriptions

def _norm(name: str) -> tuple:
    """A system name as its words, punctuation and 'and' dropped: 'Lower Montane-Foothill-Valley Grassland' and 'Lower
    Montane, Foothill, and Valley Grassland' are one name."""
    w = re.sub(r"[^a-z0-9]+", " ", (name or "").lower().split(" - ")[0]).split()
    return tuple(x for x in w if x not in ("and", "the", "of"))


def bps_table() -> dict[int, dict]:
    from .fetch_vegetation import _table
    return _table("bps")


def _doc_path(model: str):
    return BPS_DIR / f"{model}.docx"


def fetch_doc(model: str) -> bytes | None:
    """The description document of a BpS model (its docx), from the support site's document zipper; cached. None when the
    site has no document of that name."""
    p = _doc_path(model)
    miss = BPS_DIR / f"{model}.missing"
    if p.exists():
        return p.read_bytes()
    if miss.exists():
        return None
    from . import runlog
    from .http import get
    r = get(BPS_DOC_URL, {"include_sim": "false", "docs": f"{model}.docx"}, timeout=120)
    BPS_DIR.mkdir(parents=True, exist_ok=True)
    runlog.fetched("landfire_bps", str(p), cached=False)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
        inner = [n for n in z.namelist() if n.lower().endswith(".docx")]
    except zipfile.BadZipFile:
        inner = []
    if not inner:
        miss.write_text("no document\n")
        return None
    data = z.read(inner[0])
    p.write_bytes(data)
    return data


def _paragraphs(docx: bytes) -> list[str]:
    """The document's paragraphs as text, table cells separated by tabs (stdlib only: a docx is a zip of XML)."""
    x = zipfile.ZipFile(io.BytesIO(docx)).read("word/document.xml").decode("utf-8")
    x = re.sub(r"</w:tc>", "\t", x)
    x = re.sub(r"</w:p>", "\n", x)
    t = html.unescape(re.sub(r"<[^>]+>", "", x))
    return [ln.strip() for ln in t.split("\n")]


SYMBOL = re.compile(r"^(\{0\})?[A-Z][A-Z0-9]{2,7}$")


def parse_doc(docx: bytes) -> dict:
    """{title, table: [(symbol, scientific)], vegetation: text}: the Dominant and Indicator Species table and the
    Vegetation Description section."""
    ps = _paragraphs(docx)
    out = {"title": next((p for p in ps[1:4] if p and not p.isdigit()), ""), "table": [], "vegetation": ""}
    sec = None
    veg = []
    cells = []
    for p in ps:
        low = p.lower()
        if low.startswith("vegetation description"):
            sec = "veg"; continue
        if "dominant and indicator species" in low:
            sec = "table"; continue
        if sec == "veg" and (low.startswith("bps dominant") or low.startswith("disturbance description")):
            sec = None
        if sec == "table" and (low.startswith("species names are from") or low.startswith("disturbance description")):
            sec = None
        if sec == "veg" and p:
            veg.append(p)
        elif sec == "table":
            cells += [c.strip() for c in p.split("\t")]
    cells = [c for c in cells if c]
    for i, c in enumerate(cells):
        if SYMBOL.match(c) and i + 1 < len(cells) and re.match(r"^[A-Z][a-z]+( [a-z-]+)?", cells[i + 1]):
            out["table"].append((c.replace("{0}", ""), cells[i + 1]))
    out["vegetation"] = " ".join(veg)
    return out


_GENERA: set | None = None


def _genera() -> set:
    global _GENERA
    if _GENERA is None:
        from .tree_cards import wcvp
        w = wcvp()
        _GENERA = {n.split()[0] for n in w["accepted"]} | {n.split()[0] for n in w["synonyms"]}
    return _GENERA


EPITHET_STOP = {"spp", "sp", "ssp", "var", "and", "or", "in", "of", "the", "is", "are", "with", "x"}


def names_in(text: str) -> list[tuple[str, bool]]:
    """The plant names a description's text gives, in order: (binomial, False) or (genus, True) for 'Genus spp.'."""
    out, seen = [], set()
    g = _genera()
    for m in re.finditer(r"\b([A-Z][a-z]{2,})\s+(spp?\.|[a-z][a-z-]{2,})", text):
        genus, ep = m.group(1), m.group(2)
        if genus not in g:
            continue
        if ep.startswith("sp"):
            key = (genus, True) if ep in ("spp.", "sp.") else (f"{genus} {ep}", False)
        elif ep in EPITHET_STOP:
            key = (genus, True)
        else:
            key = (f"{genus} {ep}", False)
        if key not in seen:
            seen.add(key); out.append(key)
    return out


# --------------------------------------------------------------------------------------------------- USDA PLANTS

def _plants_get(path: str, params: dict | None, cache_name: str):
    from .http import get_json_cached
    return get_json_cached(f"{PLANTS_API}/{path}", params, PLANTS_DIR / cache_name, source="usda_plants", timeout=60)


def _strip(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


def plants_lookup(name: str) -> dict | None:
    """The PLANTS profile of the accepted species a name stands for (a synonym is followed), or None."""
    key = re.sub(r"[^a-z]+", "_", name.lower()).strip("_")
    hits = _plants_get("PlantSearch", {"searchText": name}, f"search_{key}.json") or []
    want = name.lower()
    sym = None
    for h in hits:
        p = h.get("Plant") or {}
        sci = _strip(p.get("ScientificName") or "").lower()
        if sci.startswith(want + " ") or sci == want:
            if p.get("Rank") in ("Species", None):
                sym = p.get("Symbol"); break
    if not sym:
        return None
    prof = _plants_get("PlantProfile", {"symbol": sym}, f"profile_{sym}.json")
    acc = prof.get("AcceptedSymbol") or sym
    if acc != sym:
        prof = _plants_get("PlantProfile", {"symbol": acc}, f"profile_{acc}.json")
    return prof


def plants_profile(symbol: str) -> dict | None:
    prof = _plants_get("PlantProfile", {"symbol": symbol}, f"profile_{symbol}.json")
    acc = (prof or {}).get("AcceptedSymbol") or symbol
    if acc != symbol:
        prof = _plants_get("PlantProfile", {"symbol": acc}, f"profile_{acc}.json")
    return prof


def characteristics(prof: dict) -> tuple[dict, str]:
    """{name: value} of the species' PLANTS characteristics, and the taxon they belong to (its own row, else its first
    infraspecific taxon that has them)."""
    def chars(pid):
        rows = _plants_get(f"PlantCharacteristics/{pid}", None, f"chars_{pid}.json") or []
        out = {}
        for r in rows:
            if r.get("CultivarName"):
                continue
            out.setdefault(r["PlantCharacteristicName"], r["PlantCharacteristicValue"])
        return out
    if prof.get("HasCharacteristics"):
        return chars(prof["Id"]), prof["Symbol"]
    sci = _strip(prof.get("ScientificName")).split(" (")[0]
    sci = " ".join(sci.split()[:2])
    hits = _plants_get("PlantSearch", {"searchText": sci}, f"search_{re.sub(r'[^a-z]+', '_', sci.lower()).strip('_')}.json") or []
    ep = sci.split()[-1].lower()
    subs = [h.get("Plant") or {} for h in hits]
    subs = [p for p in subs if p.get("Rank") in ("Subspecies", "Variety") and _strip(p.get("ScientificName")).lower().startswith(sci.lower())]
    subs.sort(key=lambda p: 0 if _strip(p.get("ScientificName")).lower().split(" (")[0].split()[-1] == ep else 1)   # the nominate first
    for p in subs:
        sub = plants_profile(p["Symbol"])
        if sub and sub.get("HasCharacteristics") and sub.get("Symbol") == p["Symbol"]:
            c = chars(sub["Id"])
            if c:
                return c, sub["Symbol"]
    return {}, ""


def family_of(prof: dict) -> str | None:
    for a in prof.get("Ancestors") or []:
        if a.get("Rank") == "Family":
            return (_strip(a.get("ScientificName")).split() or [None])[0]   # without its author
    return None


def native_l48(prof: dict, region="L48") -> bool | None:
    st = [s for s in prof.get("NativeStatuses") or [] if s.get("Region") == region]
    if not st:
        return None
    return any("N" in (s.get("Status") or "") for s in st)


def habit_of(prof: dict) -> str | None:
    gh = prof.get("GrowthHabits") or []
    if "Graminoid" in gh:
        return "grass"
    if "Forb/herb" in gh:
        return "forb"
    return None


# ------------------------------------------------------------------------------------------------------- choosing

def _tile_zone(tile: Tile, bps: np.ndarray, tab: dict) -> int | None:
    vals, counts = np.unique(bps, return_counts=True)
    z = {}
    for v, c in zip(vals.tolist(), counts.tolist()):
        row = tab.get(int(v))
        if row and str(row.get("ZONE", "")).lstrip("-").isdigit() and int(row["ZONE"]) > 0:
            z[int(row["ZONE"])] = z.get(int(row["ZONE"]), 0) + c
    return max(z, key=z.get) if z else None


def _model_zones(model: str) -> list[int]:
    parts = str(model).split("_")[1:]
    return [int(p) for p in parts if p.isdigit()]


def _models_of_name(name: str, tab: dict) -> list[dict]:
    n = _norm(name)
    return [r for r in tab.values() if r.get("BPS_NAME") and _norm(r["BPS_NAME"]) == n and str(r.get("BPS_MODEL", "")).count("_")]


def community_models(tile: Tile) -> tuple[list[dict], int | None, list[str]]:
    """Every EVT and BpS community of the tile with the BpS model that describes it: [{source, code, name, habitat,
    cells, model, how}], the tile's map zone, a log."""
    import rasterio
    classes = read_json(tile.path("vegetation/classes.json"))
    with rasterio.open(tile.path("vegetation/evt.tif")) as s:
        evt = s.read(1)
    with rasterio.open(tile.path("vegetation/bps.tif")) as s:
        bps = s.read(1)
    tab = bps_table()
    zone = _tile_zone(tile, bps, tab)
    out, log = [], []
    for code, e in classes.get("bps", {}).items():
        code = int(code)
        row = tab.get(code)
        if not row or code in NON_VEGETATED_BPS or e.get("habitat") in (None, "water", "human"):
            continue
        out.append({"source": "bps", "code": code, "name": e["name"], "habitat": e.get("habitat"), "cells": e.get("pixels", 0),
                    "model": row["BPS_MODEL"], "how": "its own model (bps.csv BPS_MODEL)"})
    for code, e in classes.get("evt", {}).items():
        code = int(code)
        if e.get("habitat") in (None, "water", "human") or not e.get("name"):
            continue
        models = _models_of_name(e["name"], tab)
        inzone = [m for m in models if zone in _model_zones(m["BPS_MODEL"])]
        if inzone:
            m, how = inzone[0], f"the same system's model in map zone {zone}"
        else:
            under = bps[evt == code]
            vals, counts = np.unique(under, return_counts=True)
            best = None
            for v, c in sorted(zip(vals.tolist(), counts.tolist()), key=lambda vc: -vc[1]):
                r = tab.get(int(v))
                if r and int(v) not in NON_VEGETATED_BPS and r.get("BPS_MODEL") and str(r["BPS_MODEL"]).count("_"):
                    best = (r, c); break
            if models and not best:
                m, how = models[0], "the same system's model (no model in the tile's zone)"
            elif best:
                m, how = best[0], f"the BpS under most of its cells on the tile ({best[1]} of {under.size}: {best[0]['BPS_NAME']})"
            else:
                log.append(f"evt {code} {e['name']}: no BpS model")
                continue
        out.append({"source": "evt", "code": code, "name": e["name"], "habitat": e.get("habitat"), "cells": e.get("pixels", 0),
                    "model": m["BPS_MODEL"], "how": how})
    return out, zone, log


def _resolve(name: str, genus: bool, tile: Tile, recs: list[dict], log: list) -> tuple[dict | None, str]:
    """(PLANTS profile, how) of a description's name: a binomial looked up (synonyms followed), a genus alone the tile's
    most-recorded native congener of a ground growth habit."""
    if genus:
        cong = sorted((g for g in recs if g["scientific"].split()[0] == name and g.get("kind") in ("grass", "forb", "emergent")),
                      key=lambda g: -g["records"])
        for g in cong:
            prof = plants_lookup(g["scientific"])
            if prof and habit_of(prof) and native_l48(prof) is not False:
                return prof, f"'{name} spp.': the tile's most-recorded native congener {g['scientific']} ({g['records']} GBIF records)"
        log.append(f"'{name} spp.' dropped: no native ground congener in the tile's GBIF records")
        return None, ""
    prof = plants_lookup(name)
    if not prof:
        log.append(f"{name} dropped: not in the PLANTS Database")
        return None, ""
    acc = _strip(prof.get("ScientificName")).split(" (")[0]
    acc = " ".join(w for w in acc.split()[:2])
    return prof, (f"named as {name} (PLANTS: {acc})" if acc.lower() != name.lower() else f"named as {name}")


def _sci(prof: dict) -> str:
    """The accepted binomial of a PLANTS profile, without its author or a hybrid's sign (Lupinus ×alpestris)."""
    sci = _strip(prof.get("ScientificName")).split(" (")[0].replace("×", "").replace(" x ", " ")
    return " ".join(sci.split()[:2])


def _sid(prof: dict) -> str:
    from .research import id_of
    return id_of(_sci(prof))


def choose(tile: Tile) -> dict:
    """The tile's ground species per community, with weights and evidence: species/ground.json."""
    from .tree_cards import _near
    comms, zone, log = community_models(tile)
    pn = tile.path("species/plant_needs.json")
    recs = json.loads(pn.read_text()).get("gbif_plants", []) if pn.exists() else []
    from .regions import region_of
    where = region_of(tile)
    region = "AK" if "alaska" in where else "HI" if "hawaii" in where else "PR" if "puerto_rico" in where else "L48"
    parsed: dict[str, dict] = {}
    species: dict[str, dict] = {}
    near_cache: dict[str, int] = {}
    for c in comms:
        model = c["model"]
        if model not in parsed:
            doc = fetch_doc(model)
            parsed[model] = parse_doc(doc) if doc else None
            if not doc:
                log.append(f"BpS model {model}: no description document")
        d = parsed[model]
        c["species"] = []
        if not d:
            continue
        c["doc"] = {"model": model, "title": d["title"], "url": f"{BPS_DOC_URL}?include_sim=false&docs={model}.docx"}
        named = [(sci, False, TABLE_W, f"{model} Dominant and Indicator Species ({sym})") for sym, sci in d["table"]]
        named += [(n, g, TEXT_W, f"{model} Vegetation Description") for n, g in names_in(d["vegetation"])]
        got = {"grass": 0, "forb": 0}
        for nm, genus, w, where in named:
            binom = nm if genus else " ".join(nm.split()[:2])
            prof, how = _resolve(binom, genus, tile, recs, log)
            if not prof:
                continue
            form = habit_of(prof)
            if not form or got[form] >= (N_GRASS if form == "grass" else N_FORB):
                continue
            sid = _sid(prof)
            if any(s["id"] == sid for s in c["species"]):
                continue
            if native_l48(prof, region) is False:
                log.append(f"{c['source']} {c['code']}: {sid} skipped (PLANTS: introduced)")
                continue
            sci = _sci(prof)
            if sid not in near_cache:
                near_cache[sid] = _near(tile, sci, NEAR_DEG)
            if near_cache[sid] == 0:
                log.append(f"{c['source']} {c['code']}: {sci} skipped (no GBIF record within {NEAR_DEG} deg)")
                continue
            got[form] += 1
            c["species"].append({"id": sid, "scientific": sci, "symbol": prof.get("Symbol"), "form": form, "weight": w,
                                 "evidence": f"{where}: {how}; {near_cache[sid]} GBIF records within {NEAR_DEG} deg"})
            s = species.setdefault(sid, {"id": sid, "scientific": sci, "symbol": prof.get("Symbol"), "form": form,
                                         "common": (prof.get("CommonName") or "").strip(), "family": family_of(prof),
                                         "score": 0.0, "classes": {}, "communities": []})
            s["score"] += w * max(c["cells"], 1)
            s["classes"][c["habitat"]] = max(s["classes"].get(c["habitat"], 0.0), w)
            s["communities"].append(f"{c['source']} {c['code']}")
    # the tile's caps: the grass layer's slots and the forb atlas's share, by cells x weight
    keep = set()
    for form, cap in (("grass", TILE_GRASS), ("forb", TILE_FORB)):
        ranked = sorted((s for s in species.values() if s["form"] == form), key=lambda s: -s["score"])
        for s in ranked[cap:]:
            log.append(f"{s['id']}: dropped (the tile's {cap} {form} slots are taken by better-represented species)")
        keep |= {s["id"] for s in ranked[:cap]}
    for c in comms:
        c["species"] = [s for s in c.get("species", []) if s["id"] in keep]
    doc = {"tile": tile.tile_id, "version": VERSION, "map_zone": zone,
           "rule": "pipeline/ground_cards.py choose(): each community's LANDFIRE BpS description (its dominant and indicator "
                   "species, then the species its vegetation description names), grasses and forbs by the PLANTS growth habit, "
                   "native, recorded within 0.5 deg; weights 1.0 table, 0.5 text",
           "communities": comms, "species": sorted((s for s in species.values() if s["id"] in keep), key=lambda s: -s["score"]),
           "log": log}
    return doc


# --------------------------------------------------------------------------------------------------------- cards

# PLANTS Foliage Color / Flower Color / Fruit/Seed Color words -> sRGB (live leaf, flower, seed head)
FOLIAGE = {"green": (104, 140, 76), "dark green": (78, 108, 60), "gray-green": (128, 142, 112), "grey-green": (128, 142, 112),
           "blue-green": (104, 136, 118), "yellow-green": (132, 154, 76), "white-gray": (170, 174, 158), "white-grey": (170, 174, 158),
           "red": (140, 82, 62), "purple": (110, 82, 104), "variegated": (120, 146, 92)}
FLOWER = {"white": (238, 236, 226), "yellow": (236, 196, 52), "orange": (228, 132, 48), "red": (196, 56, 50),
          "purple": (128, 82, 168), "blue": (92, 112, 196), "brown": (136, 104, 72), "green": (150, 168, 96),
          "red-orange": (216, 94, 50), "pink": (226, 140, 170), "lavender": (174, 150, 210), "": (220, 216, 196)}
SEED = {"brown": (150, 120, 86), "black": (70, 62, 54), "yellow": (204, 184, 120), "white": (214, 208, 188),
        "red": (150, 80, 60), "green": (150, 162, 110), "purple": (120, 86, 104), "tan": (190, 168, 128)}
STRAW = (196, 178, 134)            # a cured grass leaf (the library's cured needlegrass and wildrye tips: 182-196, 166-178, 124-142)
WEATHERED = (152, 144, 122)        # last year's leaves through the winter
ROOT_K = (0.6, 0.57, 0.75)         # a grass clump's base against its tip (purple needlegrass's spring palette)
SEASONS = ("winter", "spring", "summer", "fall")
MONTHS = {"early spring": (3, 3), "mid spring": (4, 4), "late spring": (5, 5), "spring": (3, 5), "early summer": (6, 6),
          "mid summer": (7, 7), "late summer": (8, 8), "summer": (6, 8), "fall": (9, 11), "late winter": (2, 2),
          "winter": (12, 2), "year round": (1, 12)}
TRITICEAE = {"Pseudoroegneria", "Elymus", "Leymus", "Pascopyrum", "Agropyron", "Hordeum", "Thinopyrum", "Elytrigia", "Triticum",
             "Secale", "Aegilops", "Taeniatherum", "Psathyrostachys"}
# a forb's flower and leaf by family (forbs.js shapes), the default 'cup' and 'ovate'
FLOWER_BY_FAMILY = {"Asteraceae": "daisy", "Fabaceae": "spike", "Apiaceae": "umbel", "Polygonaceae": "umbel", "Amaryllidaceae": "ball",
                    "Liliaceae": "cup", "Orobanchaceae": "spike", "Plantaginaceae": "spike", "Lamiaceae": "spike", "Boraginaceae": "umbel",
                    "Brassicaceae": "umbel", "Caprifoliaceae": "umbel", "Rubiaceae": "tiny", "Campanulaceae": "cup", "Onagraceae": "spike",
                    "Iridaceae": "cup", "Orchidaceae": "spike", "Crassulaceae": "umbel", "Ranunculaceae": "cup", "Rosaceae": "cup",
                    "Geraniaceae": "cup", "Linaceae": "cup", "Polemoniaceae": "cup", "Hydrophyllaceae": "spike", "Gentianaceae": "spike"}
LEAF_BY_FAMILY = {"Fabaceae": "palmate", "Apiaceae": "ferny", "Geraniaceae": "palmate", "Ranunculaceae": "lobed", "Rosaceae": "pinnate",
                  "Amaryllidaceae": "linear", "Liliaceae": "strap", "Iridaceae": "strap", "Linaceae": "linear", "Polemoniaceae": "linear",
                  "Asteraceae": "ovate", "Polygonaceae": "ovate", "Orobanchaceae": "linear", "Plantaginaceae": "linear"}
HABIT = {"erect": "erect", "semi-erect": "mound", "rounded": "mound", "decumbent": "sprawling", "prostrate": "sprawling",
         "climbing": "climbing", "vase": "mound", "spreading": "sprawling"}
LEAF_SIZE = {"fine": 0.02, "medium": 0.05, "coarse": 0.12}
SHADE = {"intolerant": 0.1, "intermediate": 0.4, "tolerant": 0.7}


def _mix(a, b, t):
    return [round(x + (y - x) * t) for x, y in zip(a, b)]


def _growth_seasons(agp: str) -> set:
    a = (agp or "").lower()
    if "year round" in a:
        return set(SEASONS)
    return {s for s in SEASONS if s in a} or {"spring", "summer"}


def _season_state(grow: set) -> dict:
    """Each calendar season's state: live, curing (the season after growth), cured, weathered (later)."""
    out = {}
    for i, s in enumerate(SEASONS):
        if s in grow:
            out[s] = "live"; continue
        for back in (1, 2, 3):
            if SEASONS[(i - back) % 4] in grow:
                out[s] = ("curing", "cured", "weathered")[back - 1]; break
    return out


def _months(period: str | None) -> list[int] | None:
    p = (period or "").lower().strip()
    if not p or p == "indeterminate":
        return None
    return list(MONTHS.get(p, (0, 0))) if p in MONTHS else None


def _colour(word: str | None, table: dict, default):
    w = (word or "").lower().strip()
    return list(table.get(w, default))


def grass_card(s: dict, prof: dict, ch: dict, chsym: str) -> tuple[dict, list[str]]:
    notes, used = [], []
    annual = "Annual" in (prof.get("Durations") or []) and "Perennial" not in (prof.get("Durations") or [])
    tid = "avena_fatua" if annual else "stipa_pulchra"
    tpl = json.loads((LIBRARY / f"{tid}.json").read_text())
    h_ft = ch.get("Height, Mature (feet)")
    h = round(float(h_ft) * 0.3048, 2) if h_ft else None
    if h is None:
        h = float(tpl["height_m"][1]); notes.append("height: none in PLANTS, the template's")
    height_m = [round(0.5 * h, 2), h]
    scale = (sum(height_m) / 2) / (sum(tpl["height_m"]) / 2)
    tg = tpl["ground"]
    live = _colour(ch.get("Foliage Color"), FOLIAGE, FOLIAGE["green"])
    if not ch.get("Foliage Color"):
        notes.append("leaf colour: none in PLANTS, a mid green")
    seed = _colour(ch.get("Fruit/Seed Color"), SEED, SEED["tan"])
    grow = _growth_seasons(ch.get("Active Growth Period"))
    state = _season_state(grow)
    pal = {}
    for se in SEASONS:
        st = state.get(se, "live")
        tip = {"live": live, "curing": _mix(live, STRAW, 0.55), "cured": list(STRAW), "weathered": list(WEATHERED)}[st]
        root = [round(c * k) for c, k in zip(live, ROOT_K)] if st == "live" else _mix([round(c * k) for c, k in zip(live, ROOT_K)], [round(c * 0.62) for c in tip], 0.6 if st == "curing" else 0.85)
        head = _mix(tip, seed, 0.5) if st == "live" else _mix(tip, seed, 0.3)
        pal[se] = {"root": root, "tip": tip, "head": head, "awn": _mix(head, tip, 0.3)}
    genus = s["scientific"].split()[0]
    months = _months(ch.get("Bloom Period"))
    lr = (ch.get("Leaf Retention") or "").lower() == "yes"
    cure = 0.4 if (lr or len(grow) == 4) else 0.6 if "summer" in grow else 0.8
    ground = {"type": "annual" if annual else "bunch", "height": round(tg["height"] * scale, 2),
              "width": round(min(max(tg["width"] * scale ** 0.5, 0.7), 1.3), 2), "palette": pal,
              "heads": {"shape": "spike" if genus in TRITICEAE else "panicle", **({"months": months} if months else {})}, "cure": cure}
    if not months:
        notes.append("flowering months: no Bloom Period in PLANTS")
    gf = (ch.get("Growth Form") or "").lower()
    if gf and gf != "bunch" and not annual:
        notes.append(f"COMPROMISE: PLANTS growth form '{ch.get('Growth Form')}', drawn as grass.js's bunch clump (it has two: annual and bunch)")
    used += [k for k in ("Height, Mature (feet)", "Foliage Color", "Fruit/Seed Color", "Active Growth Period", "Bloom Period",
                         "Leaf Retention", "Growth Form") if ch.get(k)]
    return {"template": tid, "height_m": height_m, "lifespan": "annual" if annual else "perennial", "ground": ground}, notes + [f"PLANTS characteristics used ({chsym}): " + ", ".join(f"{k} = {ch[k]}" for k in used)]


def forb_card(s: dict, prof: dict, ch: dict, chsym: str) -> tuple[dict, list[str]]:
    notes, used = [], []
    annual = "Annual" in (prof.get("Durations") or []) and "Perennial" not in (prof.get("Durations") or [])
    tid = "lupinus_bicolor" if annual else "achillea_millefolium"
    tpl = json.loads((LIBRARY / f"{tid}.json").read_text())
    h_ft = ch.get("Height, Mature (feet)")
    h = round(float(h_ft) * 0.3048, 2) if h_ft else None
    if h is None:
        h = float(tpl["height_m"][1]); notes.append("height: none in PLANTS, the template's")
    fam = s.get("family") or ""
    leaf_rgb = _colour(ch.get("Foliage Color"), FOLIAGE, FOLIAGE["green"])
    flw = (ch.get("Flower Color") or "").lower()
    months = _months(ch.get("Bloom Period")) or list(tpl["ground"]["flower"]["months"])
    if not ch.get("Bloom Period"):
        notes.append("flowering months: no Bloom Period in PLANTS, the template's")
    grow = _growth_seasons(ch.get("Active Growth Period"))
    # height through the year: up from the first month of growth to full at flowering, full to the end of seed, then down
    first = {"winter": 12, "spring": 3, "summer": 6, "fall": 9}[next(s_ for s_ in SEASONS if s_ in grow) if "winter" not in grow or len(grow) == 4 else "winter"]
    fse = (ch.get("Fruit/Seed Period End") or "").lower()
    end = {"spring": 5, "summer": 8, "fall": 10, "winter": 1}.get(fse.split()[-1] if fse else "", (months[1] % 12) + 2)
    hbm = []
    f0, f1 = months[0], months[1]
    for m in range(1, 13):
        if (m - first) % 12 <= (f0 - first) % 12:
            v = 0.3 + 0.7 * ((m - first) % 12) / max((f0 - first) % 12, 1)
        elif (m - first) % 12 <= (end - first) % 12:
            v = 1.0
        else:
            k = (m - end) % 12
            v = 0.0 if annual else max(0.15, 1.0 - 0.45 * k)
        hbm.append(round(v, 2))
    leaf_shape = LEAF_BY_FAMILY.get(fam, "ovate")
    tex = (ch.get("Foliage Texture") or "medium").lower()
    if tex == "fine" and leaf_shape == "ovate":
        leaf_shape = "linear"
    ground = {"habit": HABIT.get((ch.get("Shape and Orientation") or "").lower(), "erect"),
              "leaf": {"shape": leaf_shape, "size_m": LEAF_SIZE.get(tex, 0.05), "rgb": leaf_rgb},
              "flower": {"shape": FLOWER_BY_FAMILY.get(fam, "cup"), "rgb": _colour(flw, FLOWER, FLOWER[""]),
                         "size_m": 0.05 if (ch.get("Flower Conspicuous") or "").lower() == "yes" else 0.015, "months": months, "per_plant": 3},
              "height_by_month": hbm, "dead_rgb": [150, 130, 100], "density": 0.8}
    used += [k for k in ("Height, Mature (feet)", "Foliage Color", "Foliage Texture", "Flower Color", "Flower Conspicuous", "Bloom Period",
                         "Active Growth Period", "Fruit/Seed Period End", "Shape and Orientation") if ch.get(k)]
    notes.append(f"leaf shape '{leaf_shape}' and flower shape '{ground['flower']['shape']}' from the family ({fam or 'unknown'}), not "
                 "from the species; density 0.8 (a rule default)")
    return {"template": tid, "height_m": [round(0.5 * h, 2), h], "lifespan": "annual" if annual else "perennial", "ground": ground}, notes + [f"PLANTS characteristics used ({chsym}): " + ", ".join(f"{k} = {ch[k]}" for k in used)]


def card(s: dict, zone: int | None) -> dict:
    prof = plants_profile(s["symbol"])
    ch, chsym = characteristics(prof)
    body, notes = (grass_card if s["form"] == "grass" else forb_card)(s, prof, ch, chsym)
    if not ch:
        notes.insert(0, "no PLANTS characteristics for the species or its infraspecific taxa: every value is the template's or a default")
    common = s.get("common") or (prof.get("CommonName") or "")
    shade = SHADE.get((ch.get("Shade Tolerance") or "").lower(), 0.3)
    today = date.today().isoformat()
    region = f"landfire_mz{zone}" if zone else "landfire"
    return {
        "id": s["id"], "scientific": s["scientific"], "common": common, "aliases": [re.sub(r"[^a-z]+", "_", common.lower()).strip("_")] if common else [],
        "family": s.get("family"), "form": s["form"], "deciduous": False, "template": body["template"], "regions": [region],
        "height_m": body["height_m"],
        "patch": {"lifespan": body["lifespan"], "native": True, "ground": body["ground"]},
        "description": f"{common[:1].upper() + common[1:] if common else s['scientific']} ({s['scientific']}, {s.get('family') or ''}): a "
                       f"{body['lifespan']} {'grass' if s['form'] == 'grass' else 'herb'} {body['height_m'][1]:g} m tall at maturity "
                       f"(USDA PLANTS), named by the LANDFIRE descriptions of {', '.join(s['communities'][:4])} on the tile.",
        # no class weights: the species is drawn only where a community's own description names it (species/ground.json),
        # never from the habitat-class fallback of a tile that borrows (a regional tile's empty slots must not draw it);
        # the classes of the communities that named it are kept for people
        "habitat": {"classes": {}, "named_in_classes": {k: round(v, 2) for k, v in s["classes"].items() if k},
                    "floor": 1.0, "mid": 1.0, "steep": 1.0, "north": 1.0, "shade": shade, "disturbed": 1.0},
        "notes": "Written by rule from the USDA PLANTS Database's characteristics (pipeline/ground_cards.py). " + " ".join(n.rstrip(".") + "." for n in notes)
                 + " The client's seasons are calendar quarters; PLANTS' bloom periods are the species' over its US range, not "
                 "corrected for this tile's elevation. Region tag " + region + " (the LANDFIRE map zone whose descriptions named it) is not "
                 "a natural region in pipeline/regions.py: no regional table draws it.",
        "sources": [f"USDA PLANTS profile {prof.get('Symbol')}: {PLANTS_API}/PlantProfile?symbol={prof.get('Symbol')}, read {today}",
                    *([f"USDA PLANTS characteristics ({chsym}): {PLANTS_API}/PlantCharacteristics/<id>, read {today}"] if ch else []),
                    "LANDFIRE BpS descriptions naming it: species/ground.json (" + "; ".join(s["communities"][:6]) + f"), read {today}"],
        "authors": AUTHORS, "generated_by": f"pipeline/ground_cards.py v{VERSION}",
    }


def write_cards(doc: dict, force=False) -> list[str]:
    """A card for every chosen species without a library record (a hand-written card is never replaced), then its record."""
    from . import plantgen
    out = []
    for s in doc["species"]:
        rec = LIBRARY / f"{s['id']}.json"
        cp = CARDS / f"{s['id']}.json"
        if rec.exists() and not (json.loads(rec.read_text()).get("generated") or {}).get("card"):
            s["record"] = "library (hand-written)"
            continue
        if cp.exists() and not json.loads(cp.read_text()).get("generated_by", "").startswith("pipeline/ground_cards.py"):
            s["record"] = "card (hand-written)"
            continue
        new = card(s, doc.get("map_zone"))
        if cp.exists():
            old = json.loads(cp.read_text())
            # the card lists every community that named it, on every tile: merge with what other tiles wrote
            new["regions"] = sorted(set(old.get("regions", [])) | set(new["regions"]))
            for k, v in (old.get("habitat", {}).get("named_in_classes") or {}).items():
                new["habitat"]["named_in_classes"][k] = max(v, new["habitat"]["named_in_classes"].get(k, 0))
            if not force and {k: v for k, v in old.items() if k not in ("sources", "description", "notes")} == \
                    {k: v for k, v in new.items() if k not in ("sources", "description", "notes")}:
                s["record"] = "card"
                plantgen.write(s["id"])
                continue
        cp.write_text(json.dumps(new, indent=1) + "\n")
        plantgen.write(s["id"], force=True)
        s["record"] = "card"
        out.append(s["id"])
    return out


def applies(tile: Tile) -> bool:
    """A tile outside every natural-region table with LANDFIRE's communities (the regional tiles keep their tables)."""
    from .regions import covers, natural_regions
    return not natural_regions(tile) and covers("landfire", tile) and tile.path("vegetation/bps.tif").exists()


def run(tile: Tile) -> dict:
    if not applies(tile):
        return {"path": "species/ground.json", "kind": "table", "skipped": "inside a regional table or no LANDFIRE BpS"}
    doc = choose(tile)
    written = write_cards(doc)
    doc["cards_written"] = written
    write_json(tile.path("species/ground.json"), doc)
    if written:
        from . import plantgen
        plantgen.embed()
    return {"path": "species/ground.json", "kind": "table", "sources_used": ["landfire_bps", "usda_plants", "gbif"],
            "species": len(doc["species"]), "communities": sum(1 for c in doc["communities"] if c.get("species")),
            "cards_written": written}


def own_ground(tile: Tile) -> dict | None:
    """{(source, code): {species id: weight}} from species/ground.json, for species_mix; None when the tile has none."""
    p = tile.path("species/ground.json")
    if not p.exists():
        return None
    doc = json.loads(p.read_text())
    return {(c["source"], int(c["code"])): {s["id"]: float(s["weight"]) for s in c.get("species", [])} for c in doc["communities"]}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tile", required=True)
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    tile = Tile.from_id(a.tile)
    if a.plan:
        doc = choose(tile)
    else:
        print(json.dumps(run(tile)))
        doc = read_json(tile.path("species/ground.json"))
    print("map zone", doc["map_zone"])
    for c in sorted(doc["communities"], key=lambda c: -c["cells"]):
        print(f"  {c['source']} {c['code']} {c['name'][:60]:60s} {c['cells']:6d}  {c.get('model')}  ({c['how']})")
        for s in c.get("species", []):
            print(f"      {s['weight']:.1f} {s['form']:5s} {s['scientific']}")
    for line in doc["log"]:
        print("  .", line)


if __name__ == "__main__":
    main()
