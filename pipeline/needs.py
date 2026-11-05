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
from .config import Tile, read_json, write_json

MIN_RECORDS = 10        # GBIF records on the tile that make a library-known plant a need
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


def plant_needs(tile: Tile, generate=False) -> dict:
    from . import plantgen
    from .species_mix import match
    comms = communities(tile)
    needs: dict[str, dict] = {}

    def need(sid, kind, why):
        r = needs.setdefault(sid, {"id": sid, "kind": kind, "why": []})
        if why not in r["why"]:
            r["why"].append(why)

    unread = []
    for c in comms:
        if c["cells"] < MIN_CELLS:
            continue
        rule = match(c["name"])
        named = named_species(c["name"])
        c["rule"] = rule["id"] if rule else None
        c["named"] = [s for s, _ in named]
        for sid, kind in named:
            need(sid, kind, f"named by {c['source'].upper()} {c['code']} {c['name']} ({c['cells']} cells)")
        if rule:
            for layer, kind in (("trees", "tree"), ("shrubs", "shrub")):
                for sid, w in rule[layer].items():
                    if w > 0:
                        need(sid, kind, f"rule {rule['id']}")
        if not rule and not named:
            unread.append({"source": c["source"], "code": c["code"], "name": c["name"], "cells": c["cells"]})

    gbif = []
    inv_p = tile.path("species/inventory.json")
    for row in (read_json(inv_p) if inv_p.exists() else []):
        if row.get("group") != "plant" or not row.get("scientific"):
            continue
        sid = row["scientific"].lower().replace(" ", "_").replace("-", "_")
        known = has_record(sid) or plantgen.card_path(sid).exists()
        gbif.append({"id": sid, "scientific": row["scientific"], "family": row.get("family"), "records": row["occurrences"],
                     "known": known})
        if known and row["occurrences"] >= MIN_RECORDS:
            rec = json.loads((plantgen.LIBRARY / f"{sid}.json").read_text()) if has_record(sid) else plantgen.load_card(sid)
            kind = {"tree": "tree", "shrub": "shrub", "multi_stem_shrub_tree": "shrub"}.get(rec.get("form"), "ground")
            need(sid, kind, f"GBIF: {row['occurrences']} records on the tile")

    localized = write_localized(tile)
    for sid, loc in localized.items():
        if loc["points"]:
            need(sid, "tree", f"GBIF: {len(loc['points'])} CC0 / CC BY records on the tile (placed by them: {sid} grows in groves)")

    generated = []
    for sid, r in needs.items():
        r["record"] = has_record(sid)
        r["card"] = plantgen.card_path(sid).exists()
        if not r["record"] and r["card"] and generate and r["kind"] in ("tree", "shrub"):
            if plantgen.write(sid):
                generated.append(sid)
            r["record"] = has_record(sid)
            r["generated_now"] = True
        r["drawn_as"] = sid if r["record"] else stand_in(sid)
        if not r["record"]:
            r["queued"] = "needs a trait card (library/plant_cards/) or a hand-written record"
    if generated:
        plantgen.embed()
    doc = {"tile": tile.tile_id, "communities": [c for c in comms if c["cells"] >= MIN_CELLS], "unread": unread,
           "needs": sorted(needs.values(), key=lambda r: (r["kind"], r["id"])), "gbif_plants": gbif,
           "generated": generated,
           "summary": {"needed": len(needs), "with_record": sum(1 for r in needs.values() if r["record"]),
                       "generated_now": len(generated), "queued": sum(1 for r in needs.values() if not r["record"]),
                       "unread_communities": len(unread)}}
    write_json(tile.path("species/plant_needs.json"), doc)
    return {"path": "species/plant_needs.json", "kind": "table", **doc["summary"]}


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
