"""A community's trees and shrubs, and how much of each, from its LANDFIRE description's succession classes
(docs/decisions.md, 2026-11-10 "weights of a community's species"; docs/species-library.md).

A community's name lists the species its system is named for, and until 2026-11-10 each got the same weight. The name
says nothing of how much, and it may list only the climax: "Rocky Mountain Subalpine Dry-Mesic Spruce-Fir Forest and
Woodland" names Engelmann spruce and subalpine fir, while its description for the Yellowstone map zone says "These
forests are dominated by Pinus contorta" and gives lodgepole pine the upper canopy of 88% of the landscape.

LANDFIRE says how much itself. Every Biophysical Settings model description (the documents pipeline/ground_cards.py
already fetches for the ground layer and the herbaceous cover) divides its system into up to five succession classes
(A-E), gives each the share of the landscape it holds under the reference condition ("Class B 33"), and lists up to
four indicator species per class with their canopy position, in order of dominance (the field of the Rapid Assessment
models the descriptions grew from: "up to four dominant species for the vegetation class, in order of dominance",
"About LFRA Vegetation Models", USDA Forest Service FEIS; the documents of the built tiles agree: the species a
description's text calls dominant leads its classes).

The weight of a species in a layer of a community is therefore

    sum over the classes of  class share x (position / rank) / (the sum of position / rank over the layer's species)
                             x rarity

- rank: its place among the class's species of that layer (1, 2, 3, ...): reciprocal ranks, the plain reading of an
  order without magnitudes;
- position, trees only (POSITION): 1 in the upper canopy, 1/2 mid-upper, 1/4 in the middle, 0 below (seedlings under
  another canopy are not that class's trees). A shrub is in the shrub layer wherever it stands under the trees;
- only species that belong to the tile: MIN_LOCAL_RECORDS or more GBIF records near it (communities.local_records).
  A description is written for a whole map zone and names plants of its far corners (alpine larch, in Yellowstone's).
  The share of a listed species that is not found here stays unassigned: the layer's weights sum to the description's
  coverage of the tile, and species_mix.named_rule gives the rest to the name's own species (or, with none, to the
  described ones in proportion);
- rarity: min(1, records / LOCAL_RECORDS_FULL), the ground layer's factor: a species with a handful of records near the
  tile is a rarity there (Rocky Mountain juniper at the Grand Canyon, second in the zone's pinyon-juniper classes);
- a genus alone ("Salix", "Juniperus") is the library's best-recorded species of that genus near the tile;
- a species the library has no record of keeps its weight and goes the way of every such species (species_mix.resolve:
  a local relative, or missing and reported), so the mix document's `missing` is also the list of cards a
  description asks for.

A description speaks for a community only when it is the model of that very system (ground_cards.community_models:
"its own model", "the same system's model"). A community that borrowed the model under most of its cells (bedrock,
ruderal grassland, the lodgepole forest LANDFIRE maps as a type of its own on spruce-fir ground) keeps its name's
reading. Nothing here reads a park's maps, plots or lists: those are the held-out judge's (tools/probes).
"""
from __future__ import annotations

import json
import re

from .config import Tile

CLASS = re.compile(r"^Class\s+([A-E])\s*(\d{1,3})\s*(\D.*)?$")
POSITION = {"upper": 1.0, "all": 1.0, "none": 1.0, "mid-upper": 0.5, "middle": 0.25, "low-mid": 0.0, "lower": 0.0}
OWN = ("its own model", "the same system's model")   # ground_cards.community_models' `how`, by its first words
RANKS = {"ssp.", "ssp", "subsp.", "var.", "spp.", "spp", "sp.", "sp", "x"}
_DOCS: dict = {}
_LAYERS: dict = {}
_IDS: dict = {}
_KINDS: dict = {}


def classes_of(docx: bytes) -> list[dict]:
    """[{class, share, stage, species: [(scientific name, position)]}] from a description: its succession classes,
    each with its share of the reference landscape (0-1) and its indicator species in the order written."""
    from .ground_cards import SYMBOL, _paragraphs
    ps = [p for p in _paragraphs(docx) if p]
    out, i = [], 0
    while i < len(ps):
        m = CLASS.match(ps[i])
        if not m:
            i += 1
            continue
        c = {"class": m.group(1), "share": int(m.group(2)) / 100.0, "stage": (m.group(3) or "").strip(), "species": []}
        j = i + 1
        while j < len(ps) and ps[j] != "Canopy Position" and not ps[j].startswith("Description") and not CLASS.match(ps[j]):
            j += 1
        if j < len(ps) and ps[j] == "Canopy Position":
            j += 1
            while j + 1 < len(ps) and not ps[j].startswith("Description") and not CLASS.match(ps[j]):
                if SYMBOL.match(ps[j]) and re.match(r"^[A-Z][a-z]+", ps[j + 1]):
                    pos = next((p.lower() for p in ps[j + 2:j + 5] if p.lower() in POSITION), "none")
                    c["species"].append((ps[j + 1], pos))
                    j += 2
                else:
                    j += 1
        if 0 < c["share"] <= 1:
            out.append(c)
        i = j
    return out


def binomial(sci: str) -> tuple[str, bool]:
    """('Pinus ponderosa', False) from 'Pinus ponderosa var. scopulorum'; ('Salix', True) from 'Salix' or 'Salix spp.'."""
    w = [x for x in re.sub(r"[^A-Za-z.\- ]", " ", sci).split()]
    if len(w) < 2 or w[1].lower() in RANKS or not w[1][0].islower():
        return w[0], True
    return f"{w[0]} {w[1].lower()}", False


def _sid(name: str) -> str:
    return re.sub(r"[^a-z]+", "_", name.lower()).strip("_")


def _plants(name: str) -> dict | None:
    try:
        from .ground_cards import plants_lookup
        return plants_lookup(name)
    except Exception:  # noqa: BLE001 (offline: nothing known of a plant the library has no record of)
        return None


def _lexicon_kinds() -> dict:
    """{id: tree | shrub} of every species the name readings know (communities' tables)."""
    if not _KINDS:
        from . import communities as C
        _KINDS.update({sid: kind for table in C._tables() for sp in table.values() for sid, kind in sp})
    return _KINDS


def species_id(name: str) -> tuple[str, str | None]:
    """(library id, layer) of a binomial: the library's record of that name, else of the name USDA PLANTS accepts for
    it, else the accepted name as an id (a species without a record). layer: tree | shrub by the record's form; without
    a record, as the name readings know it (communities' tables), else by PLANTS' growth habits (a shrub or subshrub is a
    shrub; one PLANTS calls both shrub and tree is a tree only in a family of trees, needs.TREE_FAMILIES: a juniper,
    not a chokecherry); None for a grass, a forb, or a plant nothing knows."""
    if name in _IDS:
        return _IDS[name]
    from .communities import LIBRARY, _woody_records
    sid, layer, prof = _sid(name), None, None
    if not (LIBRARY / f"{sid}.json").exists():
        prof = _plants(name)
        if prof:
            from .ground_cards import _strip
            acc = _strip(prof.get("ScientificName")).split()[:2]
            if len(acc) == 2 and acc[1][:1].islower():
                sid = _sid(" ".join(acc))     # the accepted name (a synonym followed), with or without a record
    if (LIBRARY / f"{sid}.json").exists():
        form = _woody_records().get(sid)
        layer = "tree" if form in ("tree", "palm") else "shrub" if form else None
    elif sid in _lexicon_kinds():
        layer = _lexicon_kinds()[sid]
    elif prof:
        from .ground_cards import family_of
        from .needs import TREE_FAMILIES
        habits = set(prof.get("GrowthHabits") or [])
        if "Tree" in habits and (not habits & {"Shrub", "Subshrub"} or family_of(prof) in TREE_FAMILIES):
            layer = "tree"
        elif habits & {"Shrub", "Subshrub"}:
            layer = "shrub"
    _IDS[name] = (sid, layer)
    return _IDS[name]


def genus_species(genus: str, tile) -> tuple[str, str] | None:
    """(library id, layer) of the library's woody species of a genus best recorded near the tile; None when none is."""
    from .communities import _woody_records, genus_of, local_records
    from .species_mix import MIN_LOCAL_RECORDS
    best = None
    for sid, form in _woody_records().items():
        if genus_of(sid) != genus.lower():
            continue
        n = local_records(tile, sid)
        if n is not None and n >= MIN_LOCAL_RECORDS and (best is None or n > best[0]):
            best = (n, sid, "tree" if form in ("tree", "palm") else "shrub")
    return (best[1], best[2]) if best else None


def own_models(tile: Tile) -> dict:
    """{(source, code): model} of the tile's communities described by the model of their own system."""
    k = tile.tile_id
    if k not in _DOCS:
        from . import ground_cards
        out = {}
        if ground_cards.applies(tile):
            models, _, _ = ground_cards.community_models(tile)
            out = {(c["source"], int(c["code"])): c["model"] for c in models if c["how"].startswith(OWN)}
        _DOCS[k] = out
    return _DOCS[k]


def rarity(n) -> float:
    """A species with a handful of records near the tile is a rarity there: its weight x min(1, records /
    LOCAL_RECORDS_FULL), the factor the borrowed ground cards already take (species_mix._local_ok)."""
    from .species_mix import LOCAL_RECORDS_FULL
    return min(1.0, (n or 0) / LOCAL_RECORDS_FULL)


def weights_of(classes: list[dict], tile, named: dict | None = None) -> dict:
    """{"tree": {id: weight}, "shrub": {id: weight}, "coverage": {"tree": c, "shrub": c}} from a description's classes
    (the module docstring's sum), over the species that belong to the tile. named: {id: layer}, the species the
    community's name names here (its reading by the tile's records). Its layer wins over the record's form, and where
    the description lists a species of the map zone that is not recorded near the tile, the name's species of the same
    genus takes its place in the order (the zone's blackbrush shrubland lists Nevada Mormon tea; the Grand Canyon's
    "Mormon-tea" is green Mormon tea). A species' weight is its share of the layer over the landscape's classes that
    have the layer, x its rarity here; a listed species that is not found here leaves its share unassigned, so a
    layer's weights sum to its coverage: how much of what the description lists for the layer is found near the tile
    (0-1), which is how far the caller trusts it."""
    from .communities import genus_of, local_records
    from .species_mix import MIN_LOCAL_RECORDS
    named = named or {}
    out = {"tree": {}, "shrub": {}}
    total = {"tree": 0.0, "shrub": 0.0}
    for c in classes:
        rows = {"tree": [], "shrub": []}
        for sci, pos in c["species"]:
            name, genus_only = binomial(sci)
            got = genus_species(name, tile) if genus_only else species_id(name)
            if not got:
                continue
            sid, layer = got[0], named.get(got[0], got[1])
            n = local_records(tile, sid)
            if n is None or n < MIN_LOCAL_RECORDS:
                twin = next((s for s in named if genus_of(s) == genus_of(sid)), None)
                sid, layer, n = (twin, named[twin], local_records(tile, twin)) if twin else (sid, layer, 0)
            if layer not in rows or sid in [s for s, _, _ in rows[layer]]:
                continue
            rank = len(rows[layer]) + 1          # its place among the class's species of the layer, local or not
            rows[layer].append((sid, (POSITION.get(pos, 1.0) if layer == "tree" else 1.0) / rank, rarity(n)))
        for layer, sp in rows.items():
            listed = sum(w for _, w, _ in sp)
            if listed <= 0:
                continue
            total[layer] += c["share"]
            for sid, w, r in sp:
                if w * r > 0:
                    out[layer][sid] = out[layer].get(sid, 0.0) + c["share"] * w * r / listed
    for layer, t in total.items():
        out[layer] = {sid: w / t for sid, w in out[layer].items()}
    out["coverage"] = {layer: sum(out[layer].values()) for layer in total}
    return out


# The tallest layer a description may give a community, by its Vegetation Type: a tree listed in a shrubland's classes
# (the junipers of the blackbrush shrubland's late class) or a shrub in a meadow's (Woods' rose) stands above the
# system as an emergent, in no amount the description states, and is no layer of it. Such a layer is the name's to
# give ("Pinyon-Juniper Shrubland", "Juniper Savanna").
LAYERS_OF_TYPE = {"forest and woodland": ("tree", "shrub"), "woody wetland": ("tree", "shrub"), "shrubland": ("shrub",),
                  "steppe/savanna": ("shrub",), "herbaceous": ()}


def vegetation_type(docx: bytes) -> str:
    from .ground_cards import _paragraphs
    ps = [p for p in _paragraphs(docx) if p]
    i = next((i for i, p in enumerate(ps) if p == "Vegetation Type"), None)
    return ps[i + 1].lower() if i is not None and i + 1 < len(ps) else ""


def described(tile, source: str, code: int, named: dict | None = None) -> dict | None:
    """{"model", "type", "tree": {id: weight}, "shrub": {id: weight}, "coverage": {layer: 0-1}} for a community whose
    own system's description lists succession classes; None for a community without one (no tile, a tile inside a
    regional table, a borrowed model, a document without classes). A layer above the description's Vegetation Type
    (LAYERS_OF_TYPE) is given only when the name names a species in it."""
    if tile is None:
        return None
    model = own_models(tile).get((source, int(code)))
    if not model:
        return None
    k = (tile.tile_id, model)
    if k not in _LAYERS:
        from .ground_cards import fetch_doc
        doc = fetch_doc(model)
        _LAYERS[k] = (classes_of(doc), vegetation_type(doc)) if doc else ([], "")
    classes, vtype = _LAYERS[k]
    if not classes:
        return None
    out = {"model": model, "type": vtype, **weights_of(classes, tile, named)}
    for layer in ("tree", "shrub"):
        if layer not in LAYERS_OF_TYPE.get(vtype, ()) and layer not in (named or {}).values():
            out[layer] = {}
    return out


def main(argv=None) -> None:
    """python -m pipeline.succession --tile <id>: each community's description as this module reads it."""
    import argparse
    from . import ground_cards
    from . import species_mix as sm
    from .regions import natural_regions
    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument("--tile", required=True)
    a = ap.parse_args(argv)
    tile = Tile.from_id(a.tile)
    sm.CONTEXT["regions"], sm.CONTEXT["tile"] = natural_regions(tile), tile
    models, zone, _ = ground_cards.community_models(tile) if ground_cards.applies(tile) else ([], None, [])
    print("map zone", zone)
    for c in sorted(models, key=lambda c: -c["cells"]):
        d = described(tile, c["source"], c["code"])
        print(f"{c['source']} {c['code']} {c['name'][:70]:70s} {c['cells']:6d}  {c['model']}  ({c['how'][:40]})")
        for layer in ("tree", "shrub"):
            if d and d[layer]:
                tot = sum(d[layer].values())
                print(f"    {layer:5s} (found here {d['coverage'][layer]:.2f}) " + ", ".join(f"{s} {w / tot:.2f}" for s, w in sorted(d[layer].items(), key=lambda kv: -kv[1])))
    print(json.dumps({"communities": len(models), "described": len(own_models(tile))}))


if __name__ == "__main__":
    main()
