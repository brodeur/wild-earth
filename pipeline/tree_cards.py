"""Trait cards for a tile's dominant trees: which trees make its canopy, and a card for each (world pipeline, 2026-11-06).

A tile whose research found no tree with a trait card drew the library's trees of its climate group (species_mix.
research_rule's functional stand-ins: Bornean dipterocarps in the Amazon). This step chooses the tile's own canopy and
subcanopy trees by rule, writes species/canopy.json (each tree's share of the canopy and the evidence for it), and
writes a trait card (library/plant_cards/<id>.json) for every chosen tree that has a research record, so plantgen
grows it, needs.py lists it with its canopy share as cover and species_mix composes the forest from it.

Choosing the trees (choose()). GBIF record counts are not abundance (Danum's and Manu's most-recorded plants are
orchids, herbs and understorey treelets), so the trees come from three kinds of evidence, in this order:
  1 plots        open plot inventories (_research/_canopy_sources.json `plots`) within PLOT_RADIUS_KM of the tile, at
                 an elevation within PLOT_ELEV_M and in its climate group: the species ranked by the plot's measure
                 (importance value, basal area or stems), the top N_PLOT. A plot species is taken on the plot's
                 authority (it grows in that forest type nearby) and must be a tree in WCVP.
  2 named        open descriptions of the place (`descriptions`: a park's article naming its emergent or
                 characteristic trees) whose box holds the tile centre and whose elevation band holds the tile: each
                 name a WCVP tree with a GBIF record within NEAR_DEG of the tile; a name without one is replaced by a
                 congener that is recorded on the tile (descriptions use older names: Manu's 'Dipteryx micrantha' is
                 the tile's recorded D. ferrea), else dropped. Up to N_NAMED.
  3 records      the tile's most-recorded vascular plants (species/plant_needs.json gbif_plants, research.py) that WCVP
                 calls a tree ('tree', or a palm with 'tree'; not 'shrub or tree', not a climber), at least
                 MIN_RECORDS records, and whose researched maximum height reaches SUBCANOPY_MIN_M (a research record
                 or a height screen, _research/_screen_<tile>.json; unscreened ones are queued). Palms first, up to
                 N_PALMS when no palm came from 1 or 2 (herbaria under-collect palms: they are too big to press),
                 then by records, until the tile has N_TOTAL trees. A species WCVP lists as introduced in the
                 tile's botanical country (TDWG level 3, from the country of its GBIF records) is never taken (the
                 coconut on Sirena's beach).
Shares: each kind of evidence holds a fixed part of the canopy (TIER_SHARE: plots 0.85, named 0.10, records 0.05;
without a plot, named 0.6 and records 0.4), split within the plot tier by the plot's measure, equally among named
trees (no abundance is known) and by records in the records tier (a palm there counts as the tier's mean). The emergents' small share is the plots' finding:
an emergent is one stem among hundreds per hectare.

Growth form: WCVP (the World Checklist of Vascular Plants, Kew; CC BY 4.0; downloaded once into
pipeline/_cache/wcvp/, read as data, never executed): its lifeform_description for the accepted name.

The cards (card()). Each chosen tree needs a research record, _research/<id>.json (the schema in _research/_schema.json):
its heights, bole, crown, leaf, phenology, bark, habitat and who eats it, every value read from a cited source
(Wikipedia, open floras and papers, Useful Tropical Plants...), null where no source gives one. The research is an
agent's web reading, the same procedure for every tree (brief()); the card is written from it by rule, here:
  template   the library record whose architecture it starts from: a palm -> walnut (juglans_hindsii; there is no
             palm architecture, Corner's model, in treegen: the nearest honest template by leaf, pinnate, flagged in
             the card's notes); an emergent (crown position emergent, or 40 m or more) -> light red meranti
             (shorea_leprosula: buttressed clear bole, umbrella crown); a canopy tree (25 m or more) -> white seraya
             (parashorea_malaanonan); a smaller tree -> giant mahang (macaranga_gigantea: a tropical evergreen on one
             stem with an open crown)
  heights    height_m the research's typical range (its max as the tall and record values)
  crown      the outline from the crown's shape word, its width (else the template's ratio) and depth
  leaves     shape and size from the leaf type and dimensions, colour from the colour words (COLOUR lexicon), leaf-on
             by month from the leaf habit and leafless months
  bark       colour words and texture -> bark_rgb and bark_pattern; buttresses -> the root-flare primitive
  habitat    forest types and light -> the habitat block the species mix weights by
Values no source gave are the template's, and the card's notes say which.

    python -m pipeline.tree_cards --tile utm19s_233_8679          # choose, write canopy.json, write the cards it can
    python -m pipeline.tree_cards --tile utm19s_233_8679 --plan   # choose only, print the trees and what is missing
    python -m pipeline.tree_cards --cards iriartea_deltoidea ...  # (re)write cards from research records
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile

from .config import REPO_ROOT, SOURCES, Tile, read_json, write_json

CARDS = REPO_ROOT / "library" / "plant_cards"
RESEARCH = CARDS / "_research"
CANOPY_SOURCES = RESEARCH / "_canopy_sources.json"
WCVP_DIR = REPO_ROOT / "pipeline" / "_cache" / "wcvp"   # a folder of its own: downloaded data, never executed
WCVP_URL = "https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip"
VERSION = "1"

PLOT_RADIUS_KM = 250
PLOT_ELEV_M = 400
NEAR_DEG = 0.5            # a named tree must have a GBIF record this close to the tile
MIN_RECORDS = 2
SUBCANOPY_MIN_M = 12.0
N_TOTAL, N_PLOT, N_NAMED, N_PALMS = 10, 8, 6, 2
TIER_SHARE = {"plot": 0.85, "named": 0.10, "records": 0.05}
TIER_SHARE_NO_PLOT = {"named": 0.6, "records": 0.4}
CLIMBING = ("liana", "climb", "scrambling", "epiphyt", "hemiepiphyt", "parasit")

SOURCES["wcvp"] = {
    "name": "World Checklist of Vascular Plants (WCVP), Royal Botanic Gardens, Kew",
    "url": "https://sftp.kew.org/pub/data-repositories/WCVP/",
    "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Govaerts, R., Nic Lughadha, E., Black, N., Turner, R. and Paton, A. (2021). The World Checklist of Vascular "
                   "Plants, a continuously updated resource for exploring global plant diversity. Scientific Data 8: 215",
    "attribution_url": "https://doi.org/10.1038/s41597-021-00997-6",
    "attribution_required": True,
}
SOURCES["canopy_plots"] = {
    "name": "Open forest-plot inventories and place descriptions read for a tile's canopy (library/plant_cards/_research/"
            "_canopy_sources.json lists each with its citation and licence)",
    "url": "https://doi.org/10.55873/rba.v3i1.274",
    "license": "CC BY 4.0 / CC BY-SA 4.0 (per source)",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "attribution_url": "https://doi.org/10.55873/rba.v3i1.274",
    "attribution": "Vela-Apaza, C. I. & Gonzales-Ojeda, T. (2024). Flora arborea de los bosques de la planicie aluvial inundable "
                   "en el Rio Los Amigos, Amazonia Peruana. Rev. Biodivers. Amaz. 3(1): e274; Wikipedia contributors (Parque "
                   "nacional del Manu, es; Corcovado National Park, en)",
    "attribution_required": True,
}


# ------------------------------------------------------------------------------------------------------------- WCVP

_WCVP: dict | None = None


def wcvp() -> dict:
    """{'accepted': {name: [lifeform, family, climate]}, 'synonyms': {name: accepted name}}: species rank, from the WCVP
    download (once) through a compact index cached beside it."""
    global _WCVP
    if _WCVP is not None:
        return _WCVP
    idx = WCVP_DIR / "index.json"
    if not idx.exists():
        from .http import download
        WCVP_DIR.mkdir(parents=True, exist_ok=True)
        z = zipfile.ZipFile(download(WCVP_URL, None, WCVP_DIR / "wcvp.zip"))
        acc, ids, syn = {}, {}, []
        with z.open("wcvp_names.csv") as f:
            for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="|"):
                if r["taxon_rank"] != "Species":
                    continue
                if r["taxon_status"] == "Accepted":
                    acc[r["taxon_name"]] = [r["lifeform_description"], r["family"], r["climate_description"]]
                    ids[r["plant_name_id"]] = r["taxon_name"]
                elif r["accepted_plant_name_id"]:
                    syn.append((r["taxon_name"], r["accepted_plant_name_id"]))
        native, introduced, areas = {}, {}, {}
        with z.open("wcvp_distribution.csv") as f:
            for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="|"):
                name = ids.get(r["plant_name_id"])
                if not name or not r["area_code_l3"]:
                    continue
                areas[r["area"]] = r["area_code_l3"]
                (introduced if r["introduced"] == "1" else native).setdefault(name, []).append(r["area_code_l3"])
        idx.write_text(json.dumps({"accepted": acc, "synonyms": {n: ids[a] for n, a in syn if a in ids and n not in acc},
                                   "native": native, "introduced": introduced, "areas": areas}))
    _WCVP = json.loads(idx.read_text())
    return _WCVP


def lifeform(name: str) -> tuple[str | None, str, str | None]:
    """(accepted name, WCVP life form, family) of a binomial; (None, '', None) when WCVP does not know it."""
    w = wcvp()
    n = " ".join(name.split()[:2])
    acc = n if n in w["accepted"] else w["synonyms"].get(n)
    if not acc:
        return None, "", None
    lf, fam, _ = w["accepted"][acc]
    return acc, lf, fam


def native_in(name: str, area: str | None) -> bool | None:
    """Whether WCVP lists the species as native in a botanical country (TDWG level-3 code); None when it cannot say."""
    if not area:
        return None
    w = wcvp()
    acc = lifeform(name)[0]
    if not acc:
        return None
    if area in w["native"].get(acc, []):
        return True
    if area in w["introduced"].get(acc, []) or w["native"].get(acc):
        return False
    return None


def tile_area(tile: Tile) -> str | None:
    """The tile's WCVP botanical country (TDWG level 3), from the country of its GBIF records."""
    from .fetch_species import _q
    w, s, e, n = tile.bounds_wgs84
    r = _q(tile, "occurrence/search", {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}", "limit": 0,
                                       "facet": "country", "facetLimit": 1})
    counts = [c for f in r.get("facets", []) for c in f.get("counts", [])]
    if not counts:
        return None
    from .http import get_json_cached
    countries = get_json_cached("https://api.gbif.org/v1/enumeration/country", {},
                                REPO_ROOT / "pipeline" / "_cache" / "gbif" / "enumeration_country.json", source="gbif")
    title = next((c.get("title") for c in countries if c.get("iso2") == counts[0]["name"]), None)
    return wcvp()["areas"].get(title) if title else None


def is_tree(lf: str, strict: bool = False) -> bool:
    """A WCVP life form that is a tree: 'tree' (strict), or also 'shrub or tree'; never a climber or epiphyte."""
    lf = (lf or "").lower()
    if not lf or lf.startswith(CLIMBING):
        return False
    return lf == "tree" if strict else "tree" in lf


# ------------------------------------------------------------------------------------------------------- choosing

def _km(a, b) -> float:
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _near(tile: Tile, name: str, pad: float) -> int:
    """GBIF records of the species within `pad` degrees of the tile (cached under the tile's _cache/gbif)."""
    from .fetch_species import _q, match_key
    key = match_key(name)
    if not key:
        return 0
    w, s, e, n = tile.bounds_wgs84
    r = _q(tile, "occurrence/search", {"taxonKey": key, "decimalLatitude": f"{s - pad},{n + pad}",
                                       "decimalLongitude": f"{w - pad},{e + pad}", "hasCoordinate": "true",
                                       "hasGeospatialIssue": "false", "limit": 0})
    return int(r.get("count") or 0)


PALM_FAMILY_KEY = 7681   # GBIF's Arecaceae


def _palms_on_tile(tile: Tile) -> list[dict]:
    """The palms GBIF has records of on the tile, most-recorded first: [{scientific, records}]."""
    from .research import _facet
    return [{"scientific": r["scientific"], "records": r["records"]} for r in _facet(tile, "familyKey", PALM_FAMILY_KEY, 30)]


def _id(name: str) -> str:
    from .research import id_of
    return id_of(name)


def research_path(sid: str):
    return RESEARCH / f"{sid}.json"


def load_research(sid: str) -> dict | None:
    p = research_path(sid)
    return json.loads(p.read_text()) if p.exists() else None


def _screened_height(tile: Tile, sid: str, sci: str) -> float | None:
    """A tree's sourced maximum height: its research record's, else a height screen's (_research/_screen_<tile>.json)."""
    r = load_research(sid)
    if r and (r.get("height_m") or {}).get("max"):
        return _num(r["height_m"]["max"])
    if r and (r.get("height_m") or {}).get("typical"):
        return _num(r["height_m"]["typical"])
    for p in sorted(RESEARCH.glob("_screen_*.json")):
        for e in json.loads(p.read_text()).get("species", []):
            if e.get("scientific") == sci and e.get("max_m"):
                return float(e["max_m"])
    return None


def _tile_context(tile: Tile) -> dict:
    from .regions import centre
    from .species_mix import climate_group
    nj = tile.path("climate/normals.json")
    normals = json.loads(nj.read_text()) if nj.exists() else {}
    return {"centre": centre(tile), "elevation_m": normals.get("elevation_m"), "koppen": normals.get("koppen"),
            "group": climate_group(normals.get("koppen"))}


def choose(tile: Tile) -> dict:
    """The tile's canopy and subcanopy trees with their shares and evidence: species/canopy.json."""
    from .species_mix import climate_group
    ctx = _tile_context(tile)
    src = json.loads(CANOPY_SOURCES.read_text())
    chosen: dict[str, dict] = {}
    log: list[str] = []

    area = tile_area(tile)
    ctx["wcvp_area"] = area

    def take(sci, tier, value, evidence, **kw):
        acc, lf, fam = lifeform(sci)
        name = acc or sci
        sid = _id(name)
        if sid in chosen:
            chosen[sid]["evidence"].append(evidence)
            return False
        if native_in(name, area) is False:
            log.append(f"{tier}: {name} skipped (WCVP: not native in {area})")
            return False
        chosen[sid] = {"id": sid, "scientific": name, "family": fam, "wcvp_lifeform": lf, "tier": tier, "value": value,
                       "evidence": [evidence], **kw}
        return True

    # 1 plots
    plot_used = []
    for p in src.get("plots", []):
        d = _km(ctx["centre"], p["lonlat"])
        de = abs((ctx["elevation_m"] or 0) - p["elevation_m"]) if ctx["elevation_m"] is not None else 0
        if d > PLOT_RADIUS_KM or de > PLOT_ELEV_M or climate_group(p.get("koppen")) != ctx["group"]:
            log.append(f"plot {p['id']}: not used ({d:.0f} km, {de:.0f} m apart, climate {p.get('koppen')})")
            continue
        plot_used.append({"id": p["id"], "km": round(d), "citation": p["citation"], "licence": p["licence"]})
        n = 0
        for sci, v in sorted(p["species"], key=lambda r: -r[1]):
            if n >= N_PLOT:
                break
            acc, lf, _ = lifeform(sci)
            if not is_tree(lf):
                log.append(f"plot {p['id']}: {sci} skipped (WCVP life form {lf or 'unknown'})")
                continue
            if take(sci, "plot", float(v), f"{p['id']}: {p['measure'].split(' (')[0]} {v} ({d:.0f} km away)"):
                n += 1

    # 2 named in open descriptions of the place
    lon, lat = ctx["centre"]
    recs = {}
    pn = tile.path("species/plant_needs.json")
    gbif = json.loads(pn.read_text()).get("gbif_plants", []) if pn.exists() else []
    for g in gbif:
        recs[g["scientific"]] = g["records"]
    named_n = 0
    for dsc in src.get("descriptions", []):
        w, s, e, n = dsc["box"]
        lo, hi = dsc["elevation_m"]
        el = ctx["elevation_m"]
        if not (w <= lon <= e and s <= lat <= n) or (el is not None and not lo <= el <= hi):
            continue
        for nm in dsc["names"]:
            if named_n >= N_NAMED:
                break
            if not nm.get("name"):
                log.append(f"{dsc['id']}: '{nm['as_written']}' not resolved ({nm['resolved_by']})")
                continue
            acc, lf, _ = lifeform(nm["name"])
            if not is_tree(lf):
                log.append(f"{dsc['id']}: {nm['name']} skipped (WCVP life form {lf or 'unknown'})")
                continue
            near = _near(tile, acc or nm["name"], NEAR_DEG)
            sci, how = acc or nm["name"], f"{near} GBIF records within {NEAR_DEG} deg"
            if near == 0:   # a congener recorded on the tile stands for an outdated or lumped name
                genus = sci.split()[0]
                cong = sorted(((r, g) for g, r in recs.items() if g.split()[0] == genus and is_tree(lifeform(g)[1])), reverse=True)
                if not cong:
                    log.append(f"{dsc['id']}: {sci} dropped (no GBIF record within {NEAR_DEG} deg, no congener on the tile)")
                    continue
                how = f"no GBIF record of {sci} within {NEAR_DEG} deg; its congener {cong[0][1]} has {cong[0][0]} on the tile"
                sci = cong[0][1]
            if take(sci, "named", 1.0, f"{dsc['id']}: named as {nm['as_written']} ({dsc['role']}); {how}",
                    role=dsc["role"], named_as=nm["name"]):
                named_n += 1

    # 3 the tile's records: palms first when none came from the evidence above, then by records
    have_palm = any(c["family"] == "Arecaceae" for c in chosen.values())
    cands = []
    for g in sorted(gbif, key=lambda g: -g["records"]):
        if g["records"] < MIN_RECORDS:
            continue
        acc, lf, fam = lifeform(g["scientific"])
        if not is_tree(lf, strict=True):
            continue
        cands.append((acc or g["scientific"], g["records"], fam))
    palms = []
    if not have_palm:   # the tile's own palm records (the 150 most-recorded plants rarely reach them)
        for r in _palms_on_tile(tile):
            acc, lf, fam = lifeform(r["scientific"])
            if r["records"] >= MIN_RECORDS and is_tree(lf, strict=True) and native_in(acc or r["scientific"], area) is not False:
                palms.append((acc or r["scientific"], r["records"], "Arecaceae"))
    order = palms[:N_PALMS] + cands
    for sci, nrec, fam in order:
        if len(chosen) >= N_TOTAL:
            break
        sid = _id(sci)
        if sid in chosen:
            continue
        if native_in(sci, area) is False:
            log.append(f"records: {sci} skipped (WCVP: not native in {area})")
            continue
        h = _screened_height(tile, sid, sci)
        if h is None:
            take(sci, "records", float(nrec), f"GBIF: {nrec} records on the tile; height not yet screened", provisional=True)
            continue
        if h < SUBCANOPY_MIN_M and fam != "Arecaceae":
            log.append(f"records: {sci} skipped (sourced maximum height {h:g} m < {SUBCANOPY_MIN_M:g} m)")
            continue
        take(sci, "records", float(nrec), f"GBIF: {nrec} records on the tile; sourced maximum height {h:g} m")

    # shares: a palm of the records tier counts as the tier's mean (its few records are the herbaria's, not the forest's)
    rec = [c for c in chosen.values() if c["tier"] == "records"]
    other = [c["value"] for c in rec if c["family"] != "Arecaceae"]
    for c in rec:
        if c["family"] == "Arecaceae" and other:
            c["records"], c["value"] = c["value"], max(c["value"], sum(other) / len(other))
    tiers = {t for t in (c["tier"] for c in chosen.values())}
    part = TIER_SHARE if "plot" in tiers else TIER_SHARE_NO_PLOT
    tot = sum(part.get(t, 0) for t in tiers) or 1
    for t in tiers:
        members = [c for c in chosen.values() if c["tier"] == t]
        s = sum(c["value"] for c in members) or 1
        for c in members:
            c["share"] = round(part.get(t, 0) / tot * (1.0 / len(members) if t == "named" else c["value"] / s), 4)
    trees = sorted(chosen.values(), key=lambda c: -c["share"])
    for c in trees:
        c["research"] = research_path(c["id"]).exists()
        c["card"] = (CARDS / f"{c['id']}.json").exists()
    doc = {"tile": tile.tile_id, "version": VERSION, "context": ctx, "plots": plot_used,
           "rule": "pipeline/tree_cards.py choose(): plots, then named trees of open place descriptions, then the tile's "
                   "most-recorded WCVP trees that reach the subcanopy; shares by tier (TIER_SHARE)",
           "trees": trees, "queued": [{"id": c["id"], "scientific": c["scientific"],
                                       "why": "needs a research record" + (" (its height decides whether it stays)" if c.get("provisional") else "")}
                                      for c in trees if not c["research"]],
           "log": log}
    return doc


# ---------------------------------------------------------------------------------------------------------- cards

# colour words -> sRGB (leaves: a tropical evergreen's mid green unless the sources say otherwise)
LEAF_BASE = (80, 106, 56)
BARK_BASE = (128, 116, 102)
COLOUR = {
    "white": (196, 192, 182), "whitish": (184, 180, 168), "cream": (200, 190, 160), "silver": (176, 176, 168),
    "pale grey": (172, 168, 158), "light grey": (172, 168, 158), "grey": (142, 138, 128), "gray": (142, 138, 128),
    "greyish": (142, 138, 128), "dark grey": (96, 94, 90), "black": (58, 56, 54), "blackish": (70, 66, 62),
    "brown": (116, 94, 76), "brownish": (122, 104, 86), "light brown": (148, 124, 100), "pale brown": (150, 128, 104),
    "dark brown": (82, 66, 54), "reddish brown": (124, 82, 62), "reddish": (136, 88, 70), "red": (150, 70, 56),
    "orange": (196, 120, 60), "yellowish": (170, 152, 96), "yellow": (204, 176, 70), "pink": (200, 130, 140),
    "purple": (120, 70, 100), "pinkish": (186, 140, 136), "greenish": (120, 128, 96),
    "green": LEAF_BASE, "dark green": (52, 76, 40), "deep green": (52, 76, 40), "bright green": (92, 132, 58),
    "light green": (110, 140, 74), "pale green": (118, 142, 84), "yellow-green": (110, 136, 60), "olive": (96, 102, 62),
    "glaucous": (96, 120, 100), "bluish": (90, 116, 104), "dull green": (84, 100, 64),
}


def _colour(words: str | None, base) -> tuple[list[int] | None, str]:
    """The colour `words` name first (the longest lexicon phrase at the earliest place; two phrases joined, as in
    'brown-grey', are mixed), and the phrase; (None, '') if none."""
    import re
    w = (words or "").lower().replace("gray", "grey")
    hits = []
    for k in COLOUR:
        for m in re.finditer(r"\b" + re.escape(k) + r"\b", w):
            hits.append((m.start(), -len(k), m.end(), k))
    if not hits:
        return None, ""
    hits.sort()
    _, _, end, k = hits[0]
    nxt = [h for h in hits[1:] if end <= h[0] <= end + 2]
    if nxt:
        k2 = nxt[0][3]
        return [round((a + b) / 2) for a, b in zip(COLOUR[k], COLOUR[k2])], f"{k}-{k2}"
    return list(COLOUR[k]), k


def _num(x, default=None):
    """A number from a value a source gave as a number or a range (its top)."""
    if x is None:
        return default
    if isinstance(x, (list, tuple)):
        return float(max(x)) if x else default
    return float(x)


def _mid(r, default=None):
    if not r:
        return default
    if isinstance(r, (int, float)):
        return float(r)
    return (float(r[0]) + float(r[-1])) / 2


LEAF_SHAPE = {"pinnate": "pinnate_compound", "bipinnate": "pinnate_compound", "pinnate_palm_frond": "pinnate_compound",
              "palmate_palm_frond": "palmate_compound", "palmate_compound": "palmate_compound", "trifoliate": "trifoliate"}


def _leaf_shape(leaf: dict) -> str:
    t = (leaf.get("type") or "simple").lower()
    if t in LEAF_SHAPE:
        return LEAF_SHAPE[t]
    s, tex = (leaf.get("shape") or "").lower(), (leaf.get("texture") or "").lower()
    if "lanceolate" in s:
        return "lanceolate"
    if "cordate" in s:
        return "cordate"
    if ("elliptic" in s or "oblong" in s or "obovate" in s) and ("gloss" in tex or "leather" in tex or "coriaceous" in tex):
        return "elliptic_glossy"
    return "oval" if s else "elliptic_glossy"


def _median_leaf_size() -> float:
    """The median sourced length of the research records' simple leaves (m): the size a card without its own takes."""
    sizes = []
    for p in RESEARCH.glob("*.json"):
        if p.stem.startswith("_"):
            continue
        lf = json.loads(p.read_text()).get("leaf") or {}
        if (lf.get("type") or "simple") == "simple" and lf.get("length_cm"):
            sizes.append(_mid(lf["length_cm"]) / 100)
    sizes.sort()
    return round(sizes[len(sizes) // 2], 3) if sizes else 0.12


def template_for(r: dict) -> tuple[str, str]:
    """(template id, why) by rule."""
    habit = (r.get("habit") or "").lower()
    h = r.get("height_m") or {}
    top = _num(h.get("max"), _num(h.get("typical"), 0.0))
    pos = ((r.get("crown") or {}).get("position") or "").lower()
    if habit.startswith("palm"):
        return "juglans_hindsii", ("a palm: treegen has no palm architecture (Corner's model: one unbranched stem, a crown "
                                   "of fronds); California black walnut is the nearest by leaf (pinnate)")
    if pos == "emergent" or top >= 40:
        return "shorea_leprosula", "an emergent: a buttressed clear bole under an umbrella crown (light red meranti)"
    if pos == "canopy" or top >= 25:
        return "parashorea_malaanonan", "a canopy tree: a clear bole and a broad crown (white seraya)"
    return "macaranga_gigantea", "a subcanopy tree: a tropical evergreen on one stem with an open crown (giant mahang)"


SHAPES = {   # crown outline: (height fraction within the crown, radius fraction of the crown's half-width)
    "umbrella": [(0.0, 0.35), (0.25, 0.8), (0.55, 1.0), (0.8, 0.95), (0.95, 0.6), (1.0, 0.15)],
    "flat": [(0.0, 0.35), (0.25, 0.8), (0.55, 1.0), (0.8, 0.95), (0.95, 0.6), (1.0, 0.15)],
    "shuttlecock": [(0.0, 0.25), (0.3, 0.75), (0.6, 1.0), (0.85, 0.85), (1.0, 0.35)],
    "narrow": [(0.0, 0.5), (0.2, 0.85), (0.45, 1.0), (0.7, 0.85), (0.9, 0.5), (1.0, 0.1)],
    "conical": [(0.0, 1.0), (0.25, 0.85), (0.5, 0.62), (0.75, 0.38), (0.92, 0.15), (1.0, 0.03)],
    "default": [(0.0, 0.5), (0.2, 0.85), (0.45, 1.0), (0.7, 0.9), (0.9, 0.55), (1.0, 0.12)],
}


def _profile(shape: str, base: float, width_ratio: float) -> list[list[float]]:
    s = (shape or "").lower()
    key = next((k for k in SHAPES if k in s), "default")
    if "spread" in s or "umbrella" in s or "flat" in s:
        key = "umbrella"
    if "palm" in s or "shuttle" in s:
        key = "shuttlecock"
    R, d = width_ratio / 2, 1.0 - base
    return [[round(base + f * d, 3), round(R * r, 3)] for f, r in SHAPES[key]]


def _months_to_seasons(months: list[int]) -> list[str]:
    s = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer",
         8: "summer", 9: "fall", 10: "fall", 11: "fall"}
    out = []
    for m in months or []:
        if s.get(int(m)) and s[int(m)] not in out:
            out.append(s[int(m)])
    return out


def _span(months: list[int]) -> list[int] | None:
    """[from, to] for a list of months (wrapping round the year when shorter so)."""
    ms = sorted({int(m) for m in months or [] if 1 <= int(m) <= 12})
    if not ms or len(ms) == 12:
        return None
    gaps = [(ms[(i + 1) % len(ms)] - ms[i]) % 12 for i in range(len(ms))]
    i = max(range(len(ms)), key=lambda k: gaps[k])
    return [ms[(i + 1) % len(ms)], ms[i]]


def _src(r: dict, block: str) -> str:
    b = r.get(block) or {}
    i = b.get("src") if isinstance(b, dict) else None
    srcs = r.get("sources") or []
    if isinstance(i, int) and 0 <= i < len(srcs):
        return srcs[i].get("title") or srcs[i].get("url") or ""
    return ""


def card(r: dict, regions=("neotropics",)) -> dict:
    """A trait card from a research record, by rule (module docstring)."""
    sid = r["id"]
    tid, why = template_for(r)
    tpl = json.loads((REPO_ROOT / "library" / "species" / f"{tid}.json").read_text())
    h, crown, leaf, ph, bark, bole, hab = (r.get(k) or {} for k in ("height_m", "crown", "leaf", "phenology", "bark", "bole", "habitat"))
    notes, unsourced = [f"Template {tid}: {why}."], []
    palm = (r.get("habit") or "").startswith("palm")

    # heights
    typ = h.get("typical") or ([_num(h["max"]) * 0.6, _num(h["max"]) * 0.85] if h.get("max") else None)
    if isinstance(typ, (int, float)):
        typ = [typ * 0.85, typ]
    if not typ:
        typ = list(tpl["height_m"])
        unsourced.append("height (the template's)")
    lo, hi = float(min(typ)), float(max(typ))
    if hi - lo < 2:
        lo = round(hi * 0.8, 1)
    if lo < 0.4 * hi:   # a range that runs down to saplings: the grown trees' part of it
        lo = round(0.6 * hi, 1)
    top = _num(h.get("max"), hi)
    height = [round(lo, 1), round(hi, 1)]

    # crown
    width = _mid(crown.get("width_m"))
    tpl_targets = tpl.get("targets") or {}
    if width:
        if isinstance(crown.get("width_m"), (int, float)):   # one number: the sources' largest crowns
            width *= 0.7
        wr = round(min(1.1, max(0.2, width / _mid(height))), 3)
    elif palm and leaf.get("length_cm"):
        wr = round(min(1.0, max(0.2, 2 * _mid(leaf["length_cm"]) / 100 * 0.8 / _mid(height))), 3)
        notes.append("Crown width: twice the frond length, the fronds arching (no source gives the crown's width).")
    else:
        wr = float(tpl_targets.get("crown_width_ratio") or 0.6)
        unsourced.append("crown width (the template's ratio)")
    depth = crown.get("depth_fraction")
    if not depth and palm and leaf.get("length_cm"):
        depth = min(0.35, max(0.08, _mid(leaf["length_cm"]) / 100 * 0.9 / _mid(height)))
    if not depth:
        depth = 1.0 - float(tpl_targets.get("crown_base_ratio") or 0.5)
        unsourced.append("crown depth (the template's)")
    base = round(1.0 - float(depth), 3)
    density = (crown.get("density") or "medium").lower()
    fill = {"dense": 0.5, "medium": 0.4, "open": 0.3}.get(density, 0.4)
    porosity = {"dense": 0.2, "medium": 0.3, "open": 0.45}.get(density, 0.3)
    shape_word = crown.get("shape") or ("shuttlecock" if palm else "")
    crown_out = {"shape": "spherical" if palm else ("hemispherical" if "umbrella" in shape_word or "spread" in shape_word else
                                                    "cylindrical" if "narrow" in shape_word else "hemispherical"),
                 "profile": _profile(shape_word, base, wr), "lobes": 4 if density == "open" else 6,
                 "lobe_depth": 0.25 if density == "open" else 0.18, "asymmetry": 0.25 if density == "open" else 0.18,
                 "fill": fill, "edge": 1.1}

    # leaves and seasons
    leaf_shape = _leaf_shape(leaf)
    size_cm = _mid(leaf.get("leaflet_length_cm")) if leaf_shape in ("pinnate_compound", "palmate_compound") and leaf.get("leaflet_length_cm") \
        else _mid(leaf.get("length_cm"))
    if leaf_shape == "pinnate_compound" and not leaf.get("leaflet_length_cm") and leaf.get("length_cm"):
        size_cm = _mid(leaf["length_cm"]) / 3   # a leaflet spray of a compound leaf
    if size_cm:
        leaf_size = round(min(0.6, max(0.03, size_cm / 100)), 3)
        if size_cm / 100 > 0.6:
            notes.append(f"Leaf size clamped to 0.6 m (the source's {size_cm:.0f} cm is past what a leaf card carries).")
    else:
        leaf_size = _median_leaf_size()
        unsourced.append(f"leaf size (the median of the research records' sourced simple leaves, {leaf_size:g} m)")
    green, gword = _colour(leaf.get("upper_colour"), LEAF_BASE)
    if not green:
        green = list(LEAF_BASE)
        unsourced.append("leaf colour (a tropical evergreen's mid green)")
    flush, _ = _colour(leaf.get("new_flush_colour"), LEAF_BASE)
    habit = (ph.get("leaf_habit") or "evergreen").lower()
    off = [int(m) for m in ph.get("leafless_months") or [] if 1 <= int(m) <= 12]
    by_month = [1.0] * 12
    if habit == "deciduous":
        for m in off:
            by_month[m - 1] = 0.0
        if not off:
            notes.append("Deciduous by the sources, but no leafless months given: drawn evergreen.")
    elif habit == "brevideciduous":
        for m in off:
            by_month[m - 1] = 0.35
        if not off:
            notes.append("Briefly deciduous by the sources, but no months given: drawn evergreen.")
    seasons = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "fall": [9, 10, 11]}
    leaf_on = {s: round(sum(by_month[m - 1] for m in ms) / 3, 2) for s, ms in seasons.items()}
    colors = {s: list(green) for s in seasons}
    if flush:
        after = [m % 12 + 1 for m in off] if off else []
        fs = _months_to_seasons(after)
        for s in fs:
            colors[s] = [round(0.6 * g + 0.4 * f) for g, f in zip(green, flush)]
    deciduous = habit in ("deciduous", "brevideciduous") and bool(off)   # a brief leaf-drop is a leaf-drop
    fol = {"colors": colors, "leaf_on": leaf_on, "leaf_on_by_month": by_month, "leaf_size_m": leaf_size,
           "leaf_shape": leaf_shape, "flowers": None, "berries": None}
    fcol, fword = _colour(ph.get("flower_colour"), None)
    fspan = _span(ph.get("flowering_months"))
    if fcol and fspan and fword not in ("green", "greenish"):
        fol["flowers"] = {"season": (_months_to_seasons(ph["flowering_months"]) or ["spring"])[0], "months": fspan,
                          "form": "cluster", "rgb": fcol, "size_m": 0.08, "density": 0.4}

    # trunk
    trunk: dict = {"stems": [1, 1]}
    bcol, bword = _colour(bark.get("colour"), BARK_BASE)
    if bcol:
        trunk["bark_rgb"] = bcol
    else:
        unsourced.append("bark colour (the template's)")
    tex = (bark.get("texture") or "").lower()
    pattern = ("smooth_grey" if ("smooth" in tex or "lenticel" in tex or "ring" in tex) and bword in ("grey", "pale grey", "light grey", "whitish", "white", "silver", "dark grey")
               else "smooth" if ("smooth" in tex or "lenticel" in tex or "ring" in tex)
               else "plates" if ("flak" in tex or "peel" in tex or "scal" in tex)
               else "furrowed" if ("fissur" in tex or "furrow" in tex or "rough" in tex) else None)
    if pattern:
        trunk["bark_pattern"] = pattern
    else:
        unsourced.append("bark texture (the template's)")
    butt = (bole.get("buttresses") or "").lower()
    if palm:
        trunk.update({"split_prob": 0.0, "length_ratio": 1.0, "bole_ratio": round(base, 3), "base_size": round(max(0.5, base - 0.02), 3),
                      "taper": 0.3, "curve_deg": 2, "lean_deg": 3, "flare": 1.15, "roots": False})
        notes.append("Palm stand-in: the bole runs clear and unforked to the crown (split_prob 0, bole and base_size at the "
                     "crown's base) and a compact crown of pinnate leaf sprays stands for the fronds; the walnut's branching "
                     "still makes short limbs inside that crown, which a palm does not have.")
        if bole.get("stilt_roots"):
            notes.append(f"Stilt roots ({bole.get('stilt_root_height_m') or '?'} m) are not drawn: treegen has no stilt-root primitive.")
    elif butt in ("plank", "large plank"):
        bh = _num(bole.get("buttress_height_m"), 4.0 if butt == "large plank" else 2.5)
        trunk.update({"flare": round(min(2.8, 1.6 + bh / 6), 2), "roots": {"buttress": 0.95, "buttresses": [3, 6],
                      "height": round(min(2.4, 1.0 + bh / 5), 2), "roots": [0, 2], "note": f"plank buttresses to about {bh:g} m (sources)"}})
    elif butt == "small":
        trunk.update({"flare": 1.5, "roots": {"buttress": 0.6, "buttresses": [3, 5], "height": 1.0, "roots": [0, 2], "note": "small buttresses (sources)"}})
    elif butt == "none":
        trunk.update({"flare": 1.3, "roots": {"buttress": 0.2, "note": "no buttresses (sources)"}})
    cf = bole.get("clear_fraction")
    if cf and not palm:
        trunk["bole_ratio"] = round(min(0.9, max(0.2, float(cf))), 2)
        trunk["base_size"] = round(min(0.85, max(0.15, float(cf))), 2)

    # habitat
    ft = " ".join(hab.get("forest_types") or []).lower()
    light = (hab.get("light") or "").lower()
    wet = any(k in ft for k in ("flood", "varzea", "swamp", "river", "alluvial", "riparian"))
    upland = any(k in ft for k in ("terra firme", "slope", "ridge", "hill", "upland"))
    habitat = {"classes": {"mixed_forest": 1.0, "riparian": 0.6 if wet else 0.3},
               "floor": 1.3 if wet and not upland else 1.0, "mid": 1.1 if upland else 1.0, "steep": 1.0 if upland else 0.8,
               "north": 1.0, "shade": 0.05 if "pioneer" in light else 0.8 if "shade" in light else 0.4,
               "disturbed": 2.0 if "pioneer" in light else 0.7 if "shade" in light else 1.0}
    eaten = []
    from .research import id_of
    for e in r.get("eaten_by") or []:
        a = (e.get("animal") or "").strip()
        if len(a.split()) < 2 or a.split()[1] in ("spp.", "sp.", "spp"):
            continue
        eaten.append({"animal": id_of(a), "part": {"fruit": "berries"}.get(e.get("part"), e.get("part") or "seeds"),
                      "seasons": _months_to_seasons(ph.get("fruiting_months")) or ["winter", "spring", "summer", "fall"]})

    srcs = r.get("sources") or []
    sources = [f"{s.get('title')}, {s.get('url')} ({s.get('licence')}), read {s.get('read')}" for s in srcs]
    sources.append(f"research record library/plant_cards/_research/{sid}.json (pipeline/tree_cards.py)")
    if unsourced:
        notes.append("NOT SOURCED (the template's or a default value): " + "; ".join(unsourced) + ".")
    if r.get("notes"):
        notes.append("Research notes: " + r["notes"])
    desc_bits = [f"A {'palm' if palm else 'tree'} of {', '.join(hab.get('forest_types') or ['lowland forest'])}, {height[0]:g}-{height[1]:g} m tall"
                 + (f" (to {top:g} m)" if top > height[1] else "") + "."]
    for k in ("text",):
        if bole.get(k):
            desc_bits.append(bole[k].split(". ")[0].rstrip(".") + ".")
        if crown.get(k):
            desc_bits.append(crown[k].split(". ")[0].rstrip(".") + ".")
    if ph.get("fruit"):
        desc_bits.append("Fruit: " + ph["fruit"].split(". ")[0].rstrip(".") + ".")
    season_note = {"evergreen": "Evergreen.", "brevideciduous": "Briefly leafless in the dry season.", "deciduous": "Leafless in the dry season."}.get(habit, "")
    sn = {}
    for s, ms in seasons.items():
        bits = [season_note if any(by_month[m - 1] < 1 for m in ms) else "In leaf."]
        if fol["flowers"] and s in _months_to_seasons(ph.get("flowering_months")):
            bits.append(f"Flowering ({ph.get('flower_colour')}).")
        if s in _months_to_seasons(ph.get("fruiting_months")):
            bits.append("Fruiting.")
        sn[s] = " ".join(bits)
    out = {
        "id": sid, "scientific": r["scientific"], "common": r.get("common") or r["scientific"],
        "aliases": sorted({a.lower().replace(" ", "_") for a in (r.get("aliases") or []) if a}),
        "family": r.get("family"), "form": "tree", "deciduous": deciduous, "template": tid, "regions": list(regions),
        "height_m": height,
        "stature": {"typical_m": round(_mid(height), 1), "tall_m": round(top, 1), "record_m": None,
                    "source": f"{_src(r, 'height_m')} (research record)"},
        "variants_height_m": {"young": [round(max(1.5, lo * 0.15), 1), round(lo * 0.6, 1)], "veteran": [round(hi, 1), round(max(top, hi * 1.1), 1)]},
        "crown": crown_out, "foliage": fol, "trunk": trunk,
        "targets": {"crown_width_ratio": wr, "crown_base_ratio": base, "porosity": porosity,
                    "from": f"pipeline/tree_cards.py from the research record (crown: {crown.get('text') or crown.get('shape') or 'template'}), no photographs measured"},
        "description": " ".join(desc_bits),
        "season_notes": sn,
        "habitat": habitat,
        "relations": {"eaten_by": eaten, "cover_for": []},
        "range": {"elev_m": hab.get("elevation_m") or [0, 1000], "where": hab.get("range") or ""},
        "stand_in": tid,
        "notes": " ".join(notes),
        "sources": sources,
        "authors": ["Wild Earth (pipeline/tree_cards.py from an agent's sourced research record, 2026-11-06); needs local sign-off"],
        "generated_by": {"by": "pipeline/tree_cards.py", "version": VERSION},
    }
    if palm:   # the walnut's limbs as the fronds: as many as the sources count, as long, arching, leafy along their length
        fronds = round(_mid(leaf.get("frond_count"), 8))
        flen = _mid(leaf.get("length_cm"), 300) / 100
        out["patch"] = {
            "foliage": {"flowers": None, "berries": None, "start": 0.0, "parent_start": 0.05, "cards_per_m2": 1.2,
                        "density": 14, "winter_twigs": 0.0, "leaf_on_var": 0.0},
            "levels": [{**tpl["levels"][0], "count": fronds, "down_angle_deg": 55, "down_angle_tip_deg": 20, "down_angle_var_deg": 15,
                        "length_ratio": round(min(3.0, 1.3 * flen / _mid(height)), 3), "length_var": 0.15,
                        "droop_deg": 35, "tropism": 0.0, "curve_deg": 0, "radius_ratio": 0.25, "segments": 4},
                       {**tpl["levels"][1], "count": 9, "start": 0.05, "down_angle_deg": 70, "length_ratio": 0.35, "length_var": 0.2}],
            "snag": {"fraction": 0.0}}
        out["notes"] += (f" The walnut's first-order limbs stand in for the {fronds} fronds ({flen:g} m, arching), leafy along "
                         "their length; a pinnate leaf card stands for the leaflets.")
        out["variant_patches"] = {"young": {"set": {"trunk": {"split_prob": 0.0}}, "note": "a young palm: a rosette of fronds near the ground before the stem rises"}}
    return out


def write_cards(ids=None, force=False) -> list[str]:
    """Write library/plant_cards/<id>.json for every research record (or `ids`) whose card is missing or was written by
    this module from another version of its research; a hand-written card (no generated_by) is never replaced."""
    out = []
    for p in sorted(RESEARCH.glob("*.json")):
        if p.stem.startswith("_") or (ids and p.stem not in ids):
            continue
        r = json.loads(p.read_text())
        cp = CARDS / f"{p.stem}.json"
        if cp.exists():
            old = json.loads(cp.read_text())
            if not old.get("generated_by"):
                continue
        new = card(r)
        if cp.exists() and not force and json.loads(cp.read_text()) == new:
            continue
        cp.write_text(json.dumps(new, indent=1) + "\n")
        out.append(p.stem)
    return out


def brief(tile: Tile, doc: dict) -> str:
    """The research procedure for the trees still without a research record: what an agent reads and writes."""
    miss = [q for q in doc.get("queued", [])]
    if not miss:
        return ""
    lines = [f"Research records needed for {tile.tile_id} ({len(miss)}): write library/plant_cards/_research/<id>.json per "
             "_research/_schema.json, every value from a cited source (Wikipedia, open floras and papers, Useful Tropical "
             "Plants), null where none gives it; then run python -m pipeline.tree_cards --tile " + tile.tile_id]
    lines += [f"  {q['id']} ({q.get('scientific', '')}): {q['why']}" for q in miss]
    return "\n".join(lines)


def run(tile: Tile) -> dict:
    """The plants step's first part: choose the canopy, write canopy.json, write the cards the research allows."""
    doc = choose(tile)
    written = write_cards({c["id"] for c in doc["trees"]})
    for c in doc["trees"]:
        c["card"] = (CARDS / f"{c['id']}.json").exists()
    doc["cards_written"] = written
    write_json(tile.path("species/canopy.json"), doc)
    return {"path": "species/canopy.json", "kind": "table", "sources_used": ["wcvp", "canopy_plots", "gbif"],
            "trees": len(doc["trees"]), "with_card": sum(1 for c in doc["trees"] if c["card"]), "queued": len(doc["queued"]),
            "cards_written": written}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tile")
    ap.add_argument("--plan", action="store_true", help="choose only: print the trees and what is missing")
    ap.add_argument("--cards", nargs="*", help="(re)write the cards of these research records (none: all)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    if a.cards is not None:
        print("cards written:", ", ".join(write_cards(set(a.cards) or None, a.force)) or "-")
    if a.tile:
        tile = Tile.from_id(a.tile)
        if a.plan:
            doc = choose(tile)
        else:
            run(tile)
            doc = read_json(tile.path("species/canopy.json"))
        for c in doc["trees"]:
            print(f"  {c['share']:6.3f} {c['tier']:8s} {c['scientific']:28s} research={'y' if c['research'] else 'n'} "
                  f"card={'y' if c['card'] else 'n'}  {c['evidence'][0]}")
        for line in doc["log"]:
            print("  .", line)
        b = brief(tile, doc)
        if b:
            print(b)


if __name__ == "__main__":
    main()
