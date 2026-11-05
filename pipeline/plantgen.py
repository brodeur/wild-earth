"""Grow a species parameter file from a trait card: the automatic part of giving a tile the plants it needs.

A trait card (library/plant_cards/<id>.json) holds what makes a species itself and nothing the generator can reuse
from a near relative: its names, its heights, its crown's outline, its leaf and bark colours by season, its
habitat and who eats it, and the sources they were read from. Its `template` names the library species whose
branching, foliage cards, level-of-detail budgets and age classes it starts from (the same genus where the library
has one, else the same family and leaf type: a fir from Douglas-fir, a pine from ponderosa, a cypress from incense
cedar, an aspen from Fremont cottonwood). The file written is a normal library/species/<id>.json (the schema of
docs/species-library.md) that treegen.js grows like any other:

    record = template, minus everything that was the template's own (its names, notes, sources, photographs,
             growth curves, its measured age classes' dbh and crown widths)
           + the card's identity, heights (every age class scaled by the card's height against the template's,
             unless the card gives an age class its own), crown outline, foliage colours and leaf-on by season,
             bark, photo targets, description, season notes, habitat, relations
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
VERSION = "1"

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


def _mid(h) -> float:
    return (float(h[0]) + float(h[1])) / 2


def build(card: dict) -> dict:
    tid = card["template"]
    tpl = json.loads((LIBRARY / f"{tid}.json").read_text())
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
    if crown.get("shape"):
        rec["crown"]["shape"] = crown["shape"]
    if crown.get("profile"):
        rec["crown"].setdefault("envelope", {})["profile"] = crown["profile"]
    for k in ("lobes", "lobe_depth", "asymmetry", "fill", "edge"):
        if k in crown:
            rec["crown"].setdefault("envelope", {})[k] = crown[k]

    fol = card.get("foliage") or {}
    for k, v in fol.items():
        rec["foliage"][k] = copy.deepcopy(v)
    if card.get("deciduous") is not None and "leaf_on" not in fol:
        on = {"winter": 0.0, "spring": 1.0, "summer": 1.0, "fall": 0.7} if card["deciduous"] else {s: 1.0 for s in ("winter", "spring", "summer", "fall")}
        rec["foliage"]["leaf_on"] = on

    trunk = card.get("trunk") or {}
    for k, v in trunk.items():
        rec["trunk"][k] = copy.deepcopy(v)
    if trunk.get("bark_rgb"):   # the age classes' own bark keeps its offset from the template's mature bark
        t0 = tpl["trunk"].get("bark_rgb")
        for v in rec.get("variants", []):
            vb = ((v.get("set") or {}).get("trunk") or {}).get("bark_rgb")
            if vb and t0:
                v["set"]["trunk"]["bark_rgb"] = [max(0, min(255, round(c + (x - y)))) for c, x, y in zip(trunk["bark_rgb"], vb, t0)]

    targets = {k: v for k, v in (tpl.get("targets") or {}).items() if k not in ("from", "photos")}
    targets.update(card.get("targets") or {})
    summer = rec["foliage"].get("colors", {}).get("summer")
    if summer and "foliage_rg" not in (card.get("targets") or {}):
        targets["foliage_rg"], targets["foliage_bg"] = ratios(summer)
    targets["from"] = (card.get("targets") or {}).get("from") or "the trait card's values (no photographs measured)"
    rec["targets"] = targets

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
    order = ["id", "aliases", "scientific", "common", "form", "architectural_model", "deciduous", "height_m", "stature",
             "variants", "snag", "description", "season_notes", "status", "review", "habitat", "relations", "trunk", "crown", "levels",
             "foliage", "deadwood", "twigs", "lod", "targets", "generated", "notes", "sources", "authors", "license"]
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
