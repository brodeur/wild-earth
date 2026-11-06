"""Grow a species parameter file from a trait card: the automatic part of giving a tile the plants it needs.

A trait card (library/plant_cards/<id>.json) holds what makes a species itself and nothing the generator can reuse
from a near relative: its names, its heights, its crown's outline, its leaf and bark colours by season, its
habitat and who eats it, and the sources they were read from. Its `template` names the library species whose
branching, foliage cards, level-of-detail budgets and age classes it starts from (the same genus where the library
has one, else the same family and leaf type: a fir from Douglas-fir, a pine from ponderosa, a cypress from incense
cedar, an aspen from Fremont cottonwood). A palm (family Arecaceae, or form "palm") grows from PALM_TEMPLATE whatever its
card's template says: Corner's model, treegen's palm architecture (one unbranched stem, a crown of large leaves at its top;
docs/species-library.md "Palms"), its card's `palm` block the parameters. The file written is a normal library/species/<id>.json (the schema of
docs/species-library.md) that treegen.js grows like any other:

    record = template, minus everything that was the template's own (its names, notes, sources, photographs,
             growth curves, its measured age classes' dbh and crown widths)
           + the card's identity, heights (every age class scaled by the card's height against the template's,
             unless the card gives an age class its own), crown outline, foliage colours and leaf-on by season,
             bark, photo targets, description, season notes, habitat, relations
           + for a dwarf shrub (a woody card whose height tops out at or below DWARF_SHRUB_MAX_M: crowberry, heather,
             the mountain heathers) a `ground` block (ground_block) for the ground layer, which draws it as a carpet
           + the card's `patch` (any other key of the schema, deep-merged) and `variant_patches` per age class
           + a `generated` block: the card, its sha256, the template, the generator version

    python -m pipeline.plantgen abies_magnifica          # one card
    python -m pipeline.plantgen --all                     # every card whose record is missing or older than its card
    python -m pipeline.plantgen --all --force             # every card

A generated record is marked `generated` until someone reviews it in the lineup (client/lineup.html) and adds a
`review` block; the registry (pipeline/registry.py) holds a generated record's fidelity at 2 until then. Records
written by hand (no `generated` block) are never overwritten.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "library" / "species"
CARDS = ROOT / "library" / "plant_cards"
VERSION = "4"   # 2 (2026-11-04): leaf_on_by_month follows the card's deciduous; 3 (2026-11-06): a dwarf shrub's ground block;
# 4 (2026-11-06): palms from PALM_TEMPLATE (Corner's model) and their card's palm block

# Keys of a template that describe the template species itself, not its architecture.
TEMPLATE_OWN = ("id", "aliases", "scientific", "common", "stature", "growth", "description", "season_notes", "status",
                "notes", "sources", "authors", "habitat", "relations", "review", "generated")
# Card keys copied as they are.
IDENTITY = ("id", "aliases", "scientific", "common", "form", "deciduous", "height_m", "stature", "description",
            "season_notes", "habitat", "relations")


def _srgb_to_linear(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def ratios(rgb) -> tuple[float, float]:
    """The photo targets' foliage_rg and foliage_bg (linear light) of an sRGB colour."""
    r, g, b = (_srgb_to_linear(v) for v in rgb)
    return round(r / g, 2), round(b / g, 2)


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def card_path(sid: str) -> pathlib.Path:
    return CARDS / f"{sid}.json"


def load_card(sid: str) -> dict:
    return json.loads(card_path(sid).read_text())


def cards() -> list[str]:
    return sorted(p.stem for p in CARDS.glob("*.json") if not p.stem.startswith("_"))


# A dwarf shrub (2026-11-06): a woody species whose card height tops out at or below this. Its plants are a carpet (a
# heath of crowberry and heather is 60 % cover of mats a hand high), which the shrub layer's whole shrub models, ~11 per
# 30 m cell, cannot draw: the ground layer (client/src/forbs.js) draws it from the record's `ground` block, and
# pipeline/species_mix.py moves it from a community's shrubs into its ground layer.
DWARF_SHRUB_MAX_M = 0.5
WOODY_FORMS = ("shrub", "multi_stem_shrub_tree", "tree")
# the card's leaf shapes and flower forms (the tree generator's vocabulary) as the ground layer's (forbs.js leaf, flower)
GROUND_LEAF = {"lanceolate": "linear", "needle": "linear", "needle_cluster": "linear", "needle_fascicle": "linear",
               "fascicle_wand": "linear", "needle_brush": "linear", "needle_drooping": "linear", "scale": "linear",
               "lobed": "lobed", "palmate": "palmate", "pinnate": "pinnate", "round_vertical": "round"}
GROUND_FLOWER = {"candle": "spike", "spike": "spike", "raceme": "spike", "catkin": "spike", "umbel": "umbel", "cluster": "umbel",
                 "daisy": "daisy", "cup": "cup", "ball": "ball", "head": "ball", "pea": "pea"}


def is_dwarf_shrub(card: dict) -> bool:
    h = card.get("height_m") or [0, 99]
    return card.get("form") in WOODY_FORMS and float(h[1]) <= DWARF_SHRUB_MAX_M


def ground_block(card: dict, rec: dict) -> dict:
    """The ground layer's description of a dwarf shrub, from its card (falling back on the record it grows from): an
    evergreen (or leafy-season) mat as wide as the card's crown width ratio makes it, the card's leaf colour by season,
    leaf shape and size, its flowers and berries in their months."""
    fol = rec.get("foliage") or {}
    cfol = card.get("foliage") or {}
    colors = cfol.get("colors") or fol.get("colors") or {}
    h1 = float(card["height_m"][1])
    cwr = float((card.get("targets") or {}).get("crown_width_ratio") or (rec.get("targets") or {}).get("crown_width_ratio") or 3.0)
    bark = (card.get("trunk") or {}).get("bark_rgb") or (rec.get("trunk") or {}).get("bark_rgb") or [110, 90, 70]
    summer = colors.get("summer") or colors.get("spring") or [70, 90, 60]
    by_season = {k: list(v) for k, v in colors.items() if k in ("winter", "spring", "summer", "fall")}
    deciduous = bool(card.get("deciduous"))
    lom = fol.get("leaf_on_by_month") if isinstance(fol.get("leaf_on_by_month"), list) and len(fol["leaf_on_by_month"]) == 12 else None
    if deciduous:   # the woody mat stays; its leaves go: the bark's colour in winter
        by_season["winter"] = list(bark)
    shape = cfol.get("leaf_shape") or fol.get("leaf_shape") or "oval"
    g = {"habit": "mat", "woody": True, "width_m": round(min(1.5, max(0.4, h1 * cwr)), 2),
         "leaf": {"shape": GROUND_LEAF.get(shape, "ovate"), "size_m": float(cfol.get("leaf_size_m") or fol.get("leaf_size_m") or 0.01),
                  "rgb": list(summer), "rgb_by_season": by_season},
         "height_by_month": [round(max(0.6, v), 2) for v in lom] if (deciduous and lom) else [1.0] * 12,
         "dead_rgb": list(bark), "density": 1.0,
         "from": f"pipeline/plantgen.py ground_block: a dwarf shrub (card height to {h1} m <= {DWARF_SHRUB_MAX_M} m)"}
    fl = cfol.get("flowers") if "flowers" in cfol else fol.get("flowers")
    if fl and fl.get("months") and fl.get("rgb"):
        g["flower"] = {"shape": GROUND_FLOWER.get(fl.get("form"), "tiny"), "rgb": list(fl["rgb"]), "size_m": float(fl.get("size_m") or 0.01),
                       "months": list(fl["months"]), "per_plant": int(round(6 + 30 * float(fl.get("density") or 0.5)))}
    be = cfol.get("berries") if "berries" in cfol else fol.get("berries")
    if be and be.get("months") and be.get("rgb"):
        g["fruit"] = {"rgb": list(be["rgb"]), "size_m": float(be.get("size_m") or 0.006), "months": list(be["months"]),
                      "per_plant": int(round(10 + 40 * float(be.get("density") or 0.5)))}
    return g


def _mid(h) -> float:
    return (float(h[0]) + float(h[1])) / 2


# Palms (2026-11-06): Corner's model in treegen (client/src/treegen.js palmSkeleton: one stem, a spiral of large leaves at
# its apex, the crownshaft, stilt roots, spines and clumps from the record's `palm` block). The template is not a library
# species: it is the architecture's own defaults, which every palm card's `palm` block (pipeline/tree_cards.py writes it
# from a research record's) and heights fill in. Age classes: a young palm (its leaves shorter: treegen scales them by the
# square root of its height's share of the mature height; its stem already its full width), the mature palms (two
# seeds), the tallest of the stand. No snag (a dead palm's stem stands bare a while; not drawn yet).
PALM_ID = "palm"
_SEASONS = ("winter", "spring", "summer", "fall")
PALM_TEMPLATE = {
    "id": PALM_ID, "common": "Corner's-model palm (pipeline/plantgen.py PALM_TEMPLATE)", "form": "tree", "architectural_model": "Corner",
    "deciduous": False, "height_m": [15.0, 25.0],
    "variants": [
        {"name": "young", "weight": 0.25, "height_m": [3.0, 9.0], "note": "a young palm: shorter leaves on a short stem already its full width"},
        {"name": "mature", "weight": 0.6, "seeds": 2, "note": "the file as written"},
        {"name": "veteran", "weight": 0.15, "height_m": [25.0, 28.0], "note": "the tallest palms of the stand"}],
    "snag": {"fraction": 0.0},
    "trunk": {"length_ratio": 1.0, "radius_ratio": 0.02, "taper": 0.1, "flare": 1.0, "bole_ratio": 0.9, "base_size": 0.9, "segments": 6,
              "curve_deg": 3, "curve_var_deg": 8, "lean_deg": 3, "tropism": 0.02, "stems": [1, 1], "split_prob": 0.0,
              "bark_rgb": [142, 138, 128], "bark_pattern": "palm_ringed", "twig_rgb": [110, 112, 80],
              "bark": {"tile_m": [0.5, 0.9], "ring_m": 0.15, "relief": 0.9, "lichen": 0.15}, "roots": False},
    "crown": {"shape": "spherical", "envelope": {"profile": [[0.85, 0.05], [0.92, 0.12], [1.0, 0.04]]}},
    "levels": [],
    "foliage": {"type": "palm", "leaf_shape": "palm_pinnate", "leaf_size_m": 0.6, "cluster_m": 1.0, "density": 1, "orientation": "outward",
                "colors": {s: [80, 106, 56] for s in _SEASONS}, "leaf_on": {s: 1.0 for s in _SEASONS}, "leaf_on_by_month": [1.0] * 12,
                "palette": [[0.8, [1, 1, 1]], [0.2, [1.12, 1.12, 0.95]]], "color_var": [0.08, 0.05], "ao_min": 0.7,
                "leaf_on_var": 0.0, "winter_twigs": 0.0, "flowers": None, "berries": None},
    "lod": {"near_tris_budget": 1600, "near_sides": [7, 3, 3], "mid_sides": [5, 0, 0], "mid_segments": [3, 1], "mid_branches": 0,
            "stilt_roots_max": 24},
    "palm": {},
    "targets": {"crown_width_ratio": 0.3, "crown_base_ratio": 0.85, "porosity": 0.45},
}


def is_palm(card: dict) -> bool:
    return card.get("family") == "Arecaceae" or card.get("form") == "palm" or bool(card.get("palm"))


def template_record(tid: str) -> dict:
    """The record a card grows from: the library species `tid`, or PALM_TEMPLATE for "palm"."""
    if tid == PALM_ID:
        return copy.deepcopy(PALM_TEMPLATE)
    return json.loads((LIBRARY / f"{tid}.json").read_text())


def build(card: dict) -> dict:
    tid = PALM_ID if is_palm(card) else card["template"]
    tpl = template_record(tid)
    rec = {k: copy.deepcopy(v) for k, v in tpl.items() if k not in TEMPLATE_OWN}
    for k in IDENTITY:
        if k in card:
            rec[k] = copy.deepcopy(card[k])
    rec.setdefault("aliases", [])
    scale = _mid(card["height_m"]) / _mid(tpl["height_m"])

    # age classes: the template's, rescaled to the card's heights; their measured dbh / crown width are the template's
    variants = []
    vh = card.get("variants_height_m") or {}
    for v in tpl.get("variants") or []:
        v = copy.deepcopy(v)
        v.pop("grown", None)
        if v["name"] in vh:
            v["height_m"] = vh[v["name"]]
        elif v.get("height_m"):
            v["height_m"] = [round(v["height_m"][0] * scale, 1), round(v["height_m"][1] * scale, 1)]
        if v.get("note"):
            v["note"] = f"(from the {tpl['common']} template) {v['note']}"
        variants.append(v)
    if variants:
        rec["variants"] = variants

    crown = card.get("crown") or {}
    if crown and "crown" not in rec:   # a ground form (grass, forb, emergent) has no crown, trunk or foliage block
        raise ValueError(f"{card['id']}: a crown on a ground-form template ({tid}); give a ground block in patch instead")
    if crown.get("shape"):
        rec["crown"]["shape"] = crown["shape"]
    if crown.get("profile"):
        rec["crown"].setdefault("envelope", {})["profile"] = crown["profile"]
    for k in ("lobes", "lobe_depth", "asymmetry", "fill", "edge"):
        if k in crown:
            rec["crown"].setdefault("envelope", {})[k] = crown[k]

    fol = card.get("foliage") or {}
    for k, v in fol.items():
        rec.setdefault("foliage", {})[k] = copy.deepcopy(v)
    # a template's month-by-month leaf-on wins over the seasons' leaf_on in the client: an evergreen card on a deciduous
    # template (red mountain heather on Sierra gooseberry) came out bare in winter. The card's deciduous decides.
    if card.get("deciduous") is not None and "leaf_on_by_month" not in fol and "leaf_on_by_month" in (rec.get("foliage") or {}):
        lom = rec["foliage"]["leaf_on_by_month"]
        if card["deciduous"] is False:
            rec["foliage"]["leaf_on_by_month"] = [1.0] * 12
        elif min(lom) > 0.9:   # a deciduous card on an evergreen template: a generic temperate schedule
            rec["foliage"]["leaf_on_by_month"] = [0.0, 0.0, 0.2, 0.7, 1.0, 1.0, 1.0, 1.0, 0.9, 0.6, 0.2, 0.0]
    if card.get("deciduous") is not None and "leaf_on" not in fol and "foliage" in rec:
        on = {"winter": 0.0, "spring": 1.0, "summer": 1.0, "fall": 0.7} if card["deciduous"] else {s: 1.0 for s in ("winter", "spring", "summer", "fall")}
        rec["foliage"]["leaf_on"] = on

    trunk = card.get("trunk") or {}
    for k, v in trunk.items():
        rec.setdefault("trunk", {})[k] = copy.deepcopy(v)
    if trunk.get("bark_rgb"):   # the age classes' own bark keeps its offset from the template's mature bark
        t0 = tpl["trunk"].get("bark_rgb")
        for v in rec.get("variants", []):
            vb = ((v.get("set") or {}).get("trunk") or {}).get("bark_rgb")
            if vb and t0:
                v["set"]["trunk"]["bark_rgb"] = [max(0, min(255, round(c + (x - y)))) for c, x, y in zip(trunk["bark_rgb"], vb, t0)]

    targets = {k: v for k, v in (tpl.get("targets") or {}).items() if k not in ("from", "photos")}
    targets.update(card.get("targets") or {})
    summer = (rec.get("foliage") or {}).get("colors", {}).get("summer")
    if summer and "foliage_rg" not in (card.get("targets") or {}):
        targets["foliage_rg"], targets["foliage_bg"] = ratios(summer)
    targets["from"] = (card.get("targets") or {}).get("from") or "the trait card's values (no photographs measured)"
    rec["targets"] = targets

    if tid == PALM_ID:   # a palm: the card's palm block over the architecture's defaults; drawn as a tree
        rec["palm"] = deep_merge(rec.get("palm") or {}, card.get("palm") or {})
        rec["form"] = "tree"
        rec.setdefault("foliage", {})["leaf_shape"] = "palm_palmate" if rec["palm"].get("leaf") == "palmate" else "palm_pinnate"
    if is_dwarf_shrub(card):   # the ground layer's carpet (a card's patch may still refine it)
        rec["ground"] = ground_block(card, rec)
    if card.get("patch"):
        rec = deep_merge(rec, card["patch"])
    for name, p in (card.get("variant_patches") or {}).items():
        for v in rec.get("variants", []):
            if v["name"] == name:
                v.update(deep_merge(v, p))

    if card.get("review"):   # a lineup review is the card's (a regenerated record keeps it)
        rec["review"] = copy.deepcopy(card["review"])
    blob = json.dumps(card, sort_keys=True).encode()
    rec["status"] = card.get("status") or "generated from a trait card, needs review in the lineup and local sign-off"
    rec["notes"] = card.get("notes") or ""
    rec["sources"] = card.get("sources") or []
    rec["authors"] = card.get("authors") or ["Wild Earth (generated by pipeline/plantgen.py from a trait card)"]
    rec["license"] = "CC BY-SA 4.0"
    rec["generated"] = {"by": "pipeline/plantgen.py", "version": VERSION, "card": f"library/plant_cards/{card['id']}.json",
                        "card_sha256": hashlib.sha256(blob).hexdigest()[:16], "template": tid,
                        "template_common": tpl["common"], "height_scale": round(scale, 3)}
    if card.get("regions"):
        rec["regions"] = list(card["regions"])
    order = ["id", "aliases", "scientific", "common", "form", "regions", "architectural_model", "deciduous", "height_m", "stature",
             "variants", "snag", "description", "season_notes", "status", "review", "habitat", "relations", "trunk", "crown", "levels",
             "foliage", "palm", "deadwood", "twigs", "lod", "targets", "generated", "notes", "sources", "authors", "license"]
    return {k: rec[k] for k in order if k in rec} | {k: v for k, v in rec.items() if k not in order}


def stale(sid: str) -> bool:
    """A card's record is missing or was generated from another version of the card or generator."""
    p = LIBRARY / f"{sid}.json"
    if not p.exists():
        return True
    rec = json.loads(p.read_text())
    g = rec.get("generated")
    if not g:
        return False   # written by hand: never replaced
    blob = json.dumps(load_card(sid), sort_keys=True).encode()
    return g.get("card_sha256") != hashlib.sha256(blob).hexdigest()[:16] or g.get("version") != VERSION


def write(sid: str, force=False) -> bool:
    """Write library/species/<sid>.json from its card and list it in index.json; False if nothing changed."""
    p = LIBRARY / f"{sid}.json"
    if p.exists() and not json.loads(p.read_text()).get("generated"):
        return False
    if not force and not stale(sid):
        return False
    rec = build(load_card(sid))
    p.write_text(json.dumps(rec, indent=1) + "\n")
    idx_p = LIBRARY / "index.json"
    idx = json.loads(idx_p.read_text())
    if sid not in idx["species"]:
        idx["species"].append(sid)
        idx_p.write_text(json.dumps(idx, indent=2) + "\n")
    return True


def embed() -> None:
    """Re-embed the library into treegen.js's BUILTIN block (library/embed_builtin.py)."""
    import runpy
    runpy.run_path(str(ROOT / "library" / "embed_builtin.py"), run_name="__main__")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-embed", action="store_true")
    a = ap.parse_args(argv)
    ids = cards() if a.all else a.ids
    changed = [sid for sid in ids if write(sid, a.force)]
    print(f"wrote {len(changed)} of {len(ids)}: {', '.join(changed) or '-'}")
    if changed and not a.no_embed:
        embed()


if __name__ == "__main__":
    main()
