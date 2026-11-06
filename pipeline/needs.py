"""The plants a tile needs, and the ones grown for it now.

A tile needs every species that
  - its vegetation communities name (LANDFIRE EVT for natural cells, BpS for the rewilded human ones, as species_mix
    reads them; communities.named_species reads the names),
  - the species-mix rule that matches each community gives a weight (species_mix.match), and
  - its GBIF records name often (fetch_species.inventory's vascular plants, MIN_RECORDS or more), where the library,
    a trait card or the lexicon knows the species (the rest are listed, not needed: GBIF's most-recorded plants of a
    tile are mostly herbs and garden escapes).
For each, the library is asked for a record. A species with a trait card (library/plant_cards/) and no record is grown
now (pipeline/plantgen.py: automatic, free); one with neither is queued as needing a card, and species_mix draws its
stand-in (communities.stand_in) until it has one. A community whose name the lexicon cannot read and that no rule
matches is listed as `unread`: the cue to extend communities.LEXICON for a new region.

Writes species/plant_needs.json; the registry step (pipeline/registry.py) reads it.
"""
from __future__ import annotations

import json

import numpy as np

from .communities import has_record, named_species, stand_in
from .research import id_of
from .config import Tile, read_json, write_json

MIN_RECORDS = 10        # GBIF records on the tile that make a library-known plant a need
MIN_RECORDS_KNOWN = 2   # a species with a record or card already needs fewer (sparse tiles: the Serengeti's 459 plant records)
MIN_CELLS = 10          # 30 m cells of a community before its species count (a stray pixel is not a forest)


def communities(tile: Tile) -> list[dict]:
    """(source, code, name, cells, habitat) per community on the tile, the way species_mix resolves a cell."""
    import rasterio
    from .species_mix import _is_human
    classes = read_json(tile.path("vegetation/classes.json"))
    evt_tab, bps_tab = classes.get("evt", {}), classes.get("bps", {})
    with rasterio.open(tile.path("vegetation/evt.tif")) as src:
        evt = src.read(1)
    with rasterio.open(tile.path("vegetation/bps.tif")) as src:
        bps = src.read(1)
    pairs, counts = np.unique(np.stack([evt.ravel(), bps.ravel()], 1), axis=0, return_counts=True)
    out: dict[tuple, dict] = {}
    for (e_code, b_code), n in zip(pairs.tolist(), counts.tolist()):
        e = evt_tab.get(str(e_code))
        if e and not _is_human(e):
            key, name = ("evt", e_code), e.get("name")
        else:
            b = bps_tab.get(str(b_code))
            if not b or b.get("habitat") in (None, "human"):
                continue
            key, name = ("bps", b_code), b.get("name")
        r = out.setdefault(key, {"source": key[0], "code": key[1], "name": name, "cells": 0})
        r["cells"] += n
    return sorted(out.values(), key=lambda r: -r["cells"])


# Kinds by family, for a plant GBIF records that neither the library nor a card knows (research's kinds)
WOODY = {"Pinaceae", "Cupressaceae", "Taxaceae", "Fagaceae", "Betulaceae", "Salicaceae", "Sapindaceae", "Aceraceae",
         "Ericaceae", "Rhamnaceae", "Grossulariaceae", "Caprifoliaceae", "Adoxaceae", "Viburnaceae", "Araliaceae",
         "Berberidaceae", "Cornaceae", "Garryaceae", "Anacardiaceae", "Oleaceae", "Juglandaceae", "Platanaceae",
         "Lauraceae", "Myricaceae", "Hydrangeaceae", "Calycanthaceae", "Elaeagnaceae"}
TREE_FAMILIES = {"Pinaceae", "Cupressaceae", "Taxaceae", "Fagaceae", "Juglandaceae", "Platanaceae", "Lauraceae"}
FERNS = {"Dryopteridaceae", "Blechnaceae", "Polypodiaceae", "Dennstaedtiaceae", "Athyriaceae", "Pteridaceae", "Aspleniaceae",
         "Equisetaceae", "Woodsiaceae", "Cystopteridaceae", "Onocleaceae", "Lycopodiaceae", "Selaginellaceae"}
GRAMINOIDS = {"Poaceae": "grass", "Cyperaceae": "emergent", "Juncaceae": "emergent", "Typhaceae": "emergent"}
FORM_KIND = {"tree": "tree", "shrub": "shrub", "multi_stem_shrub_tree": "shrub", "grass": "grass", "forb": "forb", "emergent": "emergent"}
LAYER = {"tree": "tree", "shrub": "shrub", "grass": "ground", "forb": "ground", "emergent": "ground", "fern": "ground", "moss": "ground"}


def kind_of(sid: str, family: str | None) -> str:
    from . import plantgen
    if has_record(sid):
        return FORM_KIND.get(json.loads((plantgen.LIBRARY / f"{sid}.json").read_text()).get("form"), "forb")
    if plantgen.card_path(sid).exists():
        return FORM_KIND.get(plantgen.load_card(sid).get("form"), "forb")
    if family in FERNS:
        return "fern"
    if family in GRAMINOIDS:
        return GRAMINOIDS[family]
    if family in TREE_FAMILIES:
        return "tree"
    if family in WOODY:
        return "shrub"
    return "forb"


def plant_needs(tile: Tile, generate=False) -> dict:
    from . import plantgen
    from .regions import natural_regions
    from .research import TARGET, plant_records
    from .species_mix import match, named_rule
    regions = natural_regions(tile)
    comms = communities(tile)
    needs: dict[str, dict] = {}
    total_cells = sum(c["cells"] for c in comms) or 1

    def need(sid, kind, why, cover=0.0, records=0):
        r = needs.setdefault(sid, {"id": sid, "kind": kind, "why": [], "cover": 0.0, "records": 0})
        if why not in r["why"]:
            r["why"].append(why)
        r["cover"] += cover
        r["records"] = max(r["records"], records)

    unread = []
    for c in comms:
        if c["cells"] < MIN_CELLS or "glacier" in (c["name"] or "").lower():
            continue
        synthetic = (c.get("name") or "")[:1] in ("T", "F", "M") and (c.get("name") or "")[1:2].isdigit()   # an ecosystem group
        rule = None if synthetic else match(c["name"], regions)
        named = [] if synthetic else named_species(c["name"], regions)   # the lexicon is LANDFIRE's names, not the groups'
        if synthetic:
            continue
        c["rule"] = rule["id"] if rule else (named_rule(c["name"], 0) or {}).get("id")
        c["named"] = [sid for sid, _ in named]
        share = c["cells"] / total_cells
        if rule:
            for layer, kind in (("trees", "tree"), ("shrubs", "shrub")):
                tot = sum(rule[layer].values()) or 1
                for sid, w in rule[layer].items():
                    if w > 0:
                        need(sid, kind, f"cover: rule {rule['id']} on {c['name']}", cover=share * w / tot)
        for sid, kind in named:
            need(sid, kind, f"named by {c['source'].upper()} {c['code']} {c['name']} ({c['cells']} cells)",
                 cover=0.0 if rule else share / max(1, len(named)))
        if not rule and not named:
            unread.append({"source": c["source"], "code": c["code"], "name": c["name"], "cells": c["cells"]})

    # GBIF's most-recorded vascular plants on the tile (cached facet counts): the populous species the communities miss
    gbif = []
    for row in plant_records(tile):
        sid = id_of(row["scientific"])
        fam = (row.get("taxonomy") or {}).get("family")
        kind = kind_of(sid, fam)
        known = has_record(sid) or plantgen.card_path(sid).exists()
        gbif.append({"id": sid, "scientific": row["scientific"], "family": fam, "kind": kind, "records": row["records"], "known": known})
    from .regions import covers
    sparse = not covers("landfire", tile)   # outside the US tables a known species needs fewer records (MIN_RECORDS_KNOWN)
    # fill each kind to the density target (research.TARGET) from the top of GBIF's list, known species first
    have = {k: sum(1 for r in needs.values() if LAYER.get(r["kind"]) == k) for k in ("tree", "shrub", "ground")}
    for g in sorted(gbif, key=lambda g: (not g["known"], -g["records"])):
        layer = LAYER.get(g["kind"], "ground")
        if g["records"] < (MIN_RECORDS_KNOWN if g["known"] and sparse else MIN_RECORDS):
            continue
        if g["id"] in needs:
            needs[g["id"]]["records"] = g["records"]
            continue
        if g["known"] or have[layer] < TARGET[layer]:
            need(g["id"], g["kind"], f"GBIF: {g['records']} records on the tile", records=g["records"])
            needs[g["id"]]["scientific"] = g["scientific"]
            have[layer] += 1

    # the library's species of the tile's natural regions (their cards' `regions`) that the records missed: a canopy
    # dipterocarp is rarely collected, an orchid often (world pipeline probes, 2026-11-05)
    if regions:
        from .communities import regions_of
        for rec in sorted(plantgen.LIBRARY.glob("*.json")):
            sid = rec.stem
            if sid in needs or sid == "index":
                continue
            try:
                d = json.loads(rec.read_text())
            except ValueError:
                continue
            if any(r in regions for r in (regions_of(sid, d) or [])) and not set(regions_of(sid, d)) & {"california", "pacific_northwest"}:
                need(sid, FORM_KIND.get(d.get("form"), "forb"), f"regional: a library species of {', '.join(regions)}")

    localized = write_localized(tile)
    for sid, loc in localized.items():
        if loc["points"]:
            need(sid, "tree", f"GBIF: {len(loc['points'])} CC0 / CC BY records on the tile (placed by them: {sid} grows in groves)")

    generated = []
    for sid, r in needs.items():
        r["record"] = has_record(sid)
        r["card"] = plantgen.card_path(sid).exists()
        if not r["record"] and r["card"] and generate:
            if plantgen.write(sid):
                generated.append(sid)
            r["record"] = has_record(sid)
            r["generated_now"] = True
        r["drawn_as"] = sid if r["record"] else stand_in(sid)
        r["cover"] = round(r["cover"], 4)
        if not r["record"]:
            r["queued"] = "needs a trait card (library/plant_cards/): an agent's research, then automatic"
    if generated:
        plantgen.embed()
    by_layer = {k: sum(1 for r in needs.values() if LAYER.get(r["kind"]) == k) for k in ("tree", "shrub", "ground")}
    ranked = sorted(needs.values(), key=lambda r: (-r["cover"], -r["records"], r["id"]))
    for i, r in enumerate(ranked):
        r["rank"] = i + 1
    hands = [{"id": r["id"], "kind": r["kind"], "what": "a trait card", "why": r["why"][:2]} for r in ranked if not r["record"]]
    hands += [{"id": u["name"], "kind": "community", "what": "a lexicon phrase or a species-mix rule", "why": [f"{u['cells']} cells"]}
              for u in unread]
    doc = {"tile": tile.tile_id, "regions": regions, "communities": [c for c in comms if c["cells"] >= MIN_CELLS], "unread": unread,
           "needs": ranked, "gbif_plants": gbif, "generated": generated, "target": {k: TARGET[k] for k in ("tree", "shrub", "ground")},
           "by_layer": by_layer, "hands": hands,
           "summary": {"needed": len(needs), "with_record": sum(1 for r in needs.values() if r["record"]),
                       "generated_now": len(generated), "queued": sum(1 for r in needs.values() if not r["record"]),
                       "unread_communities": len(unread), "by_layer": by_layer,
                       "meets_target": {k: by_layer[k] >= TARGET[k] for k in by_layer}, "hands": len(hands)}}
    write_json(tile.path("species/plant_needs.json"), doc)
    return {"path": "species/plant_needs.json", "kind": "table", "sources_used": ["gbif", "landfire"],
            **{k: v for k, v in doc["summary"].items() if k != "by_layer"}, "by_layer": by_layer}


def write_localized(tile: Tile) -> dict:
    """species/localized.json: the tile's GBIF records of the species placed by where they were seen (species_mix
    LOCALIZED: giant sequoia's groves), CC0 and CC BY records only, since the species mix built on them ships to clients.
    Cached GBIF reads (fetch_species)."""
    from pyproj import Transformer
    from .fetch_species import match_key, occurrences
    from . import species_mix
    LOCALIZED = getattr(species_mix, "LOCALIZED", {})
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    out = {}
    for sid in LOCALIZED:
        key = match_key(sid.replace("_", " ").capitalize())
        pts, lic = [], {}
        for o in occurrences(tile, key) if key else []:
            l = (o.get("license") or "").lower()
            ok = "publicdomain/zero" in l or ("/by/" in l and "-nc" not in l)
            lic[l or "unknown"] = lic.get(l or "unknown", 0) + 1
            if not ok or o.get("decimalLongitude") is None:
                continue
            x, y = to_tile.transform(o["decimalLongitude"], o["decimalLatitude"])
            if x0 <= x <= x1 and y0 <= y <= y1:
                pts.append([round(x - x0, 1), round(y - y0, 1)])
        out[sid] = {"gbif_key": key, "points": pts, "licences_seen": lic,
                    "note": "CC0 and CC BY records only (the species mix built on them ships to clients)"}
    write_json(tile.path("species/localized.json"), out)
    return out
