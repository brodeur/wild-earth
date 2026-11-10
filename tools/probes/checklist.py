"""Held-out check 1, species lists: the plants and animals a tile lists against the park's own checklist
(tools/probes/held_out.py; docs/held-out-judge.md).

Reference  NPSpecies, the National Park Service's vetted species list per park unit (IRMA; a US Government work in
           the public domain), read from its open REST service with no key:
           https://irmaservices.nps.gov/v3/rest/npspecies/detaillist/<UNIT>/<category>?format=json
           Each record carries the scientific name and its synonyms, Occurrence (Present, Probably Present,
           Unconfirmed, Not In Park), Nativeness (Native, Non-native, Unknown), Abundance (Abundant, Common, Uncommon,
           Rare, Occasional; rarely filled for plants) and tags (Vagrant, Historical, False Report). The pipeline
           never reads NPSpecies (its lists come from GBIF records and the curated library), so the check is held out.
Drawn      animals: species/animals.json entries with `listed` (the tile's list), each marked `spawned` when the
           client has a slot for it (client/fauna.json). Plants: every species with a share above zero in
           client/species_mix.json, with its layer and share (tools/probes/composition.py drawn_shares).
Matching   by binomial against the list's names and synonyms; then through SPLITS (a species split or lumped since the
           list was made, each entry a published taxonomic change); then, for animals, by the species epithet within the
           same family when exactly one record fits (a genus transfer: Picoides villosus / Leuconotopicus villosus);
           then, with the network, by GBIF's synonyms of the drawn name (GBIF's backbone used as a thesaurus only).
Baseline   The rewilding baseline (docs/brief.md, 2026-11-10): today's ecosystems; introduced species filtered out;
           native species that people removed restored and marked as restored. So: a drawn species the list has as
           present and native is a hit; a drawn species the list marks non-native is an error, named; a drawn native
           the list tags Historical (gone from the park) is a hit, listed under restored_drawn (the tile should mark
           it restored; the pipeline has no such field yet); a Historical native the tile lacks is a gap, named
           restorable_absent, apart from the ordinary misses.
Scores     precision per group = hits (present and native, or a restored native) / drawn species the list decides
           on (a record with no occurrence yet, or of unknown origin, is counted as `undecided` and left out). For
           plants also by share: the share of each layer's drawn plants whose species is present and native.
           recall per group = the list's present, native, Abundant or Common species (vagrants left out) that the
           tile lists / all of them. Plants have no abundance on the list: their recall is the composition check's job.
Named      not_on_list (drawn, the park does not list it), non_native (listed as introduced), not_present (listed as
errors     unconfirmed, a false report, not in the park, or a non-native of the past), expected_absent (a common
           native the tile lacks), restorable_absent (a native gone from the park that the tile does not restore),
           group_absent (a whole group the park has and the tile has none of: fish).
Limits     A park is far larger than a 10 km tile. Precision is sound: a species the whole park lacks is wrong on a
           tile inside it (when the tile lies only partly in the park, `tile_in_park` says how much, and a species of
           the land outside can be right). Recall is an upper bound on what is missing: a species common in the park
           may live in a habitat the tile lacks (a North Rim squirrel on a South Rim tile), so expected_absent names
           candidates to check, and only a whole missing group is certain. The list reflects survey effort: a park's
           list can lack a real species (then not_on_list is the list's gap, rarely), and its abundance classes are
           judgements. The Historical tag does not say why a species is gone (people or not), and a park list holds
           only the losses someone recorded: Grand Canyon's has four fish and no wolf, grizzly or jaguar. So
           restorable_absent is a lower bound on what the baseline asks to restore; a range source of the world
           without people (PHYLACINE, reserved as a pipeline input) would give the rest.
"""
from __future__ import annotations

import json
import re

import judge_common as jc

API = "https://irmaservices.nps.gov/v3/rest/npspecies/detaillist/{unit}/{category}"
CATEGORIES = {"mammal": "Mammal", "bird": "Bird", "reptile": "Reptile", "amphibian": "Amphibian", "fish": "Fish",
              "plant": "Vascular Plant"}
BOUNDARY = ("https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/"
            "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query")
PRESENT = {"present", "probably present"}
COMMON = {"abundant", "common"}
RANK = {"present_native": 0, "historic_native": 1, "present_unknown_origin": 2, "non_native": 3, "unreviewed": 4,
        "not_present": 5}
HITS = ("present_native", "historic_native")             # right under the rewilding baseline
UNDECIDED = ("present_unknown_origin", "unreviewed")     # the list makes no statement: left out of precision
MAX_NAMED = 40
# Species split from (or lumped into) another since the park lists were compiled: the drawn name on the left is the
# list's name on the right. Taxonomic facts only, each with its authority; a not_on_list animal whose genus is on the
# list is worth checking against this kind of change before it is believed.
SPLITS = {
    "aphelocoma woodhouseii": "aphelocoma californica",   # Western Scrub-Jay split, AOS 57th supplement, 2016
    "troglodytes pacificus": "troglodytes troglodytes",   # Winter Wren split, AOU 51st supplement, 2010
    "astur atricapillus": "accipiter gentilis",           # Northern Goshawk split, AOS 64th supplement, 2023
    "falco atricapillus": "accipiter gentilis",           # the same bird under its basionym (GBIF's backbone)
    "empidonax occidentalis": "empidonax difficilis",     # Western Flycatcher lump, AOS 64th supplement, 2023
}


def _s(v) -> str:
    return str(v or "").strip()


def status(rec: dict) -> str:
    """present_native | historic_native | present_unknown_origin | non_native | unreviewed | not_present, from a
    NPSpecies record. historic_native: a native the list tags Historical and no longer has as present (gone from the
    park): under the rewilding baseline it is to be restored. unreviewed: the record has no occurrence yet (the list
    has the name and has not said whether it is in the park)."""
    tags = _s(rec.get("OccurrenceTags")).lower()
    nat = _s(rec.get("Nativeness")).lower()
    here = _s(rec.get("Occurrence")).lower() in PRESENT
    if "false report" in tags:
        return "not_present"
    if ("historical" in tags or "extirpated" in tags) and not here:
        return "historic_native" if nat == "native" else "not_present"
    if not _s(rec.get("Occurrence")):
        return "unreviewed"
    if not here:
        return "not_present"
    return "present_native" if nat == "native" else "non_native" if nat == "non-native" else "present_unknown_origin"


def is_vagrant(rec: dict) -> bool:
    return "vagrant" in _s(rec.get("NPSTags")).lower()


def index(records: list) -> dict:
    """{binomial: the list's best record under that name}, over each record's name and its synonyms. Subspecies fold
    into their species; where several records share a binomial the one with the best standing answers."""
    out: dict = {}
    for rec in records:
        names = [rec.get("ScientificName")] + [s.get("ScientificName") for s in rec.get("Synonyms") or []]
        for nm in names:
            b = jc.binomial(nm)
            if b and (b not in out or RANK[status(rec)] < RANK[status(out[b])]):
                out[b] = rec
    return out


def match(names: list, family: str | None, idx: dict, records: list, synonyms=None):
    """(record, how) for a drawn species known under `names`, or (None, None). The list can hold a species twice
    (an old name left unreviewed beside the current one): of the records reached by name, by a split, or by the
    epithet within the family, the one with the best standing answers; GBIF's synonyms are asked only when none is."""
    bs = [b for b in (jc.binomial(n) for n in names) if b]
    cands = []
    for b in bs:
        if b in idx:
            cands.append((idx[b], "name"))
    for b in bs:
        if SPLITS.get(b) in idx:
            cands.append((idx[SPLITS[b]], "taxonomic split or lump"))
    if family and bs:
        stem = jc.epithet_stem(bs[0])
        hits = {}
        for r in records:
            rb = jc.binomial(r.get("ScientificName"))
            if rb and _s(r.get("Family")).lower() == family.lower() and jc.epithet_stem(rb) == stem:
                hits[rb] = idx.get(rb, r)
        for b in bs:                       # the names already tried: what is left must be one species to count
            hits.pop(b, None)
        if len(hits) == 1:
            cands += [(r, "epithet in the same family") for r in hits.values()]
    if not cands and synonyms and bs:
        for b in synonyms(bs[0]):
            if b in idx:
                cands.append((idx[b], "GBIF synonym"))
    if not cands:
        return None, None
    return min(cands, key=lambda c: RANK[status(c[0])])


def score_group(drawn: list, records: list, synonyms=None, recall=True) -> dict:
    """One group (birds, say). drawn: [{'name', 'alt': [names], 'family', 'id', 'common', ...extra}];
    records: the park's NPSpecies records of that group."""
    idx = index(records)
    genera = {jc.genus(r.get("ScientificName")) for r in records}
    classes = {"present_native": 0, "historic_native": 0, "present_unknown_origin": 0, "non_native": 0,
               "unreviewed": 0, "not_present": 0, "not_on_list": 0}
    restored = []
    errors, matched, rows = [], set(), []
    for d in drawn:
        rec, how = match([d["name"]] + list(d.get("alt") or []), d.get("family"), idx, records, synonyms)
        extra = {k: d[k] for k in ("id", "common", "layer", "drawn_share", "spawned") if d.get(k) is not None}
        if rec is None:
            classes["not_on_list"] += 1
            errors.append({"kind": "not_on_list", "species": d["name"], **extra,
                           "genus_on_list": jc.genus(d["name"]) in genera})
            rows.append((d, "not_on_list"))
            continue
        st = status(rec)
        classes[st] += 1
        matched.add(jc.binomial(rec.get("ScientificName")) or rec["Id"])
        rows.append((d, st))
        if st == "historic_native":
            restored.append({"species": d["name"], **extra, "listed_as": rec.get("ScientificName"),
                             "occurrence_tags": rec.get("OccurrenceTags")})
        elif st == "non_native":
            errors.append({"kind": "non_native", "species": d["name"], **extra, "listed_as": rec.get("ScientificName"),
                           "nativeness_tags": rec.get("NativenessTags") or None})
        elif st == "not_present":
            errors.append({"kind": "not_present", "species": d["name"], **extra, "listed_as": rec.get("ScientificName"),
                           "occurrence": rec.get("Occurrence") or "not stated",
                           "occurrence_tags": rec.get("OccurrenceTags") or None})
    n = len(drawn)
    judged = n - sum(classes[k] for k in UNDECIDED)
    hits = sum(classes[k] for k in HITS)
    out = {"drawn": n, "judged": judged, "on_list_present_native": classes["present_native"],
           "restored_drawn": restored, "hits": hits,
           "precision": round(hits / judged, 4) if judged else None, "classes": classes}
    # the baseline's gaps: natives the list has as gone from the park (Historical) that the tile does not draw.
    # Reported apart from the ordinary misses: these need restoring, not just listing
    gone: dict = {}
    for r in records:
        if status(r) == "historic_native":
            gone[jc.binomial(r.get("ScientificName")) or r["Id"]] = r
    for k, r in sorted(gone.items(), key=lambda kv: _s(kv[1].get("ScientificName"))):
        if k not in matched:
            errors.append({"kind": "restorable_absent", "species": r.get("ScientificName"),
                           "common": _s(r.get("CommonNames")).split(",")[0] or None,
                           "occurrence": r.get("Occurrence"), "occurrence_tags": r.get("OccurrenceTags")})
    out["list_historic_native"] = len(gone)
    out["restorable_absent"] = sum(1 for k in gone if k not in matched)
    if recall:
        # by species: a park's subspecies records (three juncos) are one species to find
        by_species: dict = {}
        for r in records:
            if status(r) == "present_native" and _s(r.get("Abundance")).lower() in COMMON and not is_vagrant(r):
                k = jc.binomial(r.get("ScientificName")) or r["Id"]
                if k not in by_species or _s(r.get("Abundance")).lower() == "abundant":
                    by_species[k] = r
        ref = list(by_species.values())
        got = [k for k in by_species if k in matched]
        missing = sorted((r for k, r in by_species.items() if k not in matched),
                         key=lambda r: (_s(r.get("Abundance")).lower() != "abundant", _s(r.get("ScientificName"))))
        out.update({"list_common_native": len(ref), "of_them_drawn": len(got),
                    "recall": round(len(got) / len(ref), 4) if ref else None})
        native = [r for r in records if status(r) == "present_native"]
        out["list_present_native"] = len(native)
        for r in missing[:MAX_NAMED]:
            errors.append({"kind": "expected_absent", "species": r.get("ScientificName"),
                           "common": _s(r.get("CommonNames")).split(",")[0] or None, "abundance": r.get("Abundance")})
        out["expected_absent"] = len(missing)
        if not n and native:
            errors.insert(0, {"kind": "group_absent", "list_present_native": len(native),
                              "list_common_native": len(ref),
                              "examples": [_s(r.get("CommonNames")).split(",")[0] or r.get("ScientificName")
                                           for r in (ref or native)[:6]]})
    out["errors"] = errors
    out["_rows"] = rows
    return out


def score(drawn: dict, park: dict, synonyms=None) -> dict:
    """drawn: {group: [species]}; park: {group: [NPSpecies records]} -> the check's scores and named errors."""
    groups, errors = {}, []
    for g in CATEGORIES:
        if g not in park:
            continue
        r = score_group(drawn.get(g, []), park[g], synonyms, recall=(g != "plant"))
        rows = r.pop("_rows")
        if g == "plant":
            by_layer: dict = {}
            for d, st in rows:
                lay = by_layer.setdefault(d.get("layer") or "?", [0.0, 0.0])
                lay[0] += (d.get("drawn_share") or 0.0) if st not in UNDECIDED else 0.0
                lay[1] += (d.get("drawn_share") or 0.0) if st in HITS else 0.0
            r["precision_by_share"] = {k: round(v[1] / v[0], 4) if v[0] else None for k, v in by_layer.items()}
        if g != "plant":
            sp = [(d, st) for d, st in rows if d.get("spawned") and st not in UNDECIDED]
            r["spawned"] = len(sp)
            r["spawned_precision"] = round(sum(st in HITS for _, st in sp) / len(sp), 4) if sp else None
        errors += [dict(e, group=g) for e in r.pop("errors")]
        groups[g] = r
    animals = [g for g in groups if g != "plant" and groups[g]["drawn"]]
    n = sum(groups[g]["judged"] for g in animals)
    ok = sum(groups[g]["hits"] for g in animals)
    ref = sum(groups[g].get("list_common_native") or 0 for g in groups if g != "plant")
    got = sum(groups[g].get("of_them_drawn") or 0 for g in groups if g != "plant")
    return {"scores": {"animal_precision": round(ok / n, 4) if n else None,
                       "animal_recall_common": round(got / ref, 4) if ref else None,
                       "plant_precision": groups.get("plant", {}).get("precision"),
                       "plant_precision_by_share": groups.get("plant", {}).get("precision_by_share"),
                       "groups_absent": [e["group"] for e in errors if e["kind"] == "group_absent"],
                       "introduced_drawn": sum(1 for e in errors if e["kind"] == "non_native"),
                       "restorable_absent": {g: v["restorable_absent"] for g, v in groups.items() if v["restorable_absent"]},
                       "restored_drawn": sum(len(v["restored_drawn"]) for v in groups.values())},
            "groups": groups, "errors": errors}


# --- the tile's side --------------------------------------------------------------------------------------------------

def drawn_from_tile(tile: str) -> dict:
    import composition
    d = jc.tile_dir(tile)
    out: dict = {g: [] for g in CATEGORIES}
    out["not_judged"] = {}
    ap = d / "species" / "animals.json"
    if ap.exists():
        slots = set()
        fp = d / "client" / "fauna.json"
        if fp.exists():
            slots = {s.get("code") for s in json.loads(fp.read_text()).get("slots", [])}
        for a in json.loads(ap.read_text()).get("animals", []):
            if not a.get("listed"):
                continue
            kind = a.get("kind")
            if kind not in out:
                out["not_judged"][kind] = out["not_judged"].get(kind, 0) + 1
                continue
            out[kind].append({"name": a["scientific"], "alt": [a.get("gbif_scientific"), jc.id_to_name(a.get("id", ""))],
                              "family": (a.get("taxonomy") or {}).get("family"), "id": a.get("id"),
                              "common": a.get("common"), "spawned": a.get("id") in slots})
    mp = d / "client" / "species_mix.json"
    if mp.exists():
        for layer, shares in composition.drawn_shares(json.loads(mp.read_text())).items():
            for sid, s in shares.items():
                out["plant"].append({"name": jc.id_to_name(sid), "id": sid, "layer": layer, "drawn_share": round(s, 4)})
    return out


# --- the park's side --------------------------------------------------------------------------------------------------

def fetch_park(unit: str, refresh=False) -> tuple:
    """({group: records}, date fetched): one request per group, cached under pipeline/_cache/judge/npspecies/<unit>/."""
    out, when = {}, None
    for g, cat in CATEGORIES.items():
        p = jc.fetch(API.format(unit=unit, category=cat.replace(" ", "%20")),
                     jc.PARK_CACHE / "npspecies" / unit / g / "list.json", {"format": "json"}, refresh=refresh)
        text = p.read_text(encoding="utf-8-sig").strip()
        out[g] = json.loads(text) if text else []
        import datetime as dt
        when = dt.date.fromtimestamp(p.stat().st_mtime).isoformat()
    return out, when


def gbif_synonyms(refresh=False):
    """A function binomial -> [binomials GBIF's backbone gives as the same species], cached per name."""
    def f(b: str) -> list:
        slug = re.sub(r"[^a-z]+", "_", b)
        base = jc.PARK_CACHE / "gbif_names" / slug
        try:
            m = json.loads(jc.fetch("https://api.gbif.org/v1/species/match", base / "match" / "match.json",
                                    {"name": b, "strict": "true"}, refresh=refresh).read_text())
            key = m.get("acceptedUsageKey") or m.get("usageKey")
            if not key:
                return []
            names = [m.get("species"), m.get("canonicalName")]
            s = json.loads(jc.fetch(f"https://api.gbif.org/v1/species/{key}/synonyms", base / "synonyms" / "synonyms.json",
                                    {"limit": 200}, refresh=refresh).read_text())
            names += [r.get("canonicalName") for r in s.get("results", [])]
            return [x for x in dict.fromkeys(jc.binomial(n) for n in names) if x and x != b]
        except (RuntimeError, ValueError):
            return []
    return f


def tile_in_park(tile: str, unit: str, refresh=False):
    """The share of the tile's square inside the park's boundary (NPS Land Resources Division boundary service), or
    None when the service does not answer."""
    from shapely.geometry import box, shape
    man = jc.manifest(tile)
    w, s, e, n = man["bounds_wgs84"]
    epsg = man["crs"].split(":")[1]
    try:
        p = jc.fetch(BOUNDARY, jc.tile_cache(tile) / "park_boundary" / f"{unit}.geojson",
                     {"where": f"UNIT_CODE='{unit}'", "geometry": f"{w},{s},{e},{n}",
                      "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                      "outFields": "UNIT_CODE", "outSR": epsg, "maxAllowableOffset": 25, "geometryPrecision": 0,
                      "f": "geojson"}, refresh=refresh)
        fc = json.loads(p.read_text())
        sq = box(*man["bounds"])
        a = sum(shape(f["geometry"]).buffer(0).intersection(sq).area for f in fc.get("features", []))
        return round(min(a / sq.area, 1.0), 4)
    except Exception:  # noqa: BLE001  the share is a note beside the scores, never a reason to fail the check
        return None


def run(tile: str, refresh=False, offline=False) -> dict:
    cfg = jc.parks().get(tile)
    if not cfg or not cfg.get("park"):
        return {"held_out": True, "status": "no reference",
                "why": "the tile is not in a park with an open checklist (tools/probes/parks.json)"}
    unit = cfg["park"]
    park, when = fetch_park(unit, refresh)
    drawn = drawn_from_tile(tile)
    not_judged = drawn.pop("not_judged")
    res = score(drawn, park, None if offline else gbif_synonyms(refresh))
    return {"held_out": True, "status": "scored",
            "source": f"NPSpecies, the National Park Service's species list for {cfg['park_name']} ({unit}), IRMA",
            "url": API.format(unit=unit, category="<category>") + "?format=json",
            "licence": "public domain (a work of the US National Park Service)",
            "attribution": "National Park Service, NPSpecies - The National Park Service biodiversity database (IRMA)",
            "fetched": when, "park": unit, "tile_in_park": None if offline else tile_in_park(tile, unit, refresh),
            "list_sizes": {g: len(v) for g, v in park.items()}, "not_judged": not_judged,
            "baseline": "the rewilding baseline (docs/brief.md, 2026-11-10): introduced species are errors; natives "
                        "the list has as gone from the park are to be restored (drawn: a hit; lacking: a gap)",
            "measure": "precision = drawn species the list has as present and native, or as a native gone from the "
                       "park (restored) / drawn species the list decides on; recall = the list's present, native, "
                       "Abundant or Common species that the tile lists / all of them",
            **res,
            "limits": "A park is larger than a 10 km tile: precision is sound for a tile inside the park; recall is "
                      "an upper bound on what is missing (a species common in the park may live outside the tile's "
                      "habitats), so expected_absent names candidates and only a whole missing group is certain. "
                      "Invertebrates are not judged (the lists are incomplete)."}
