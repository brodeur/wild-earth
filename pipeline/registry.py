"""The species registry: every species the game knows or needs, the assets it has, and how far along each is.

    python -m pipeline.registry                 # rebuild library/registry.json from what exists, print the summary
    python -m pipeline.registry --tile <id>     # one tile's report (species/registry.json), as the build's registry step

Built by scanning, never by hand:
  plants   library/species/<id>.json (treegen.js grows trees and shrubs from them; grass.js, forbs.js and emergents.js
           draw the ground forms), their age classes (variants), season colours, habitat and relations blocks, the
           trait card they were generated from (library/plant_cards/, pipeline/plantgen.py) and whether it was reviewed
  animals  library/animals/<id>.json (the adopted mesh tiers, the source: Meshy job, CC0 download or contributor, the
           rig and clips), the leg engine (the GLB's extras.skin.legs, client/src/legs.js), the voice in
           client/src/sound.js, the behaviour tables in pipeline/species_data.py (senses, diet, needs, calendar), the
           locomotion tree (library/animals/locomotion.json), whether a player can take its body (groundControl.js,
           flierControl.js, playable.js OWN), and the Meshy credits its jobs cost (library/animals/jobs/*/*/job.json)
  tiles    tiles/*/client/species_mix.json (the plants drawn, by share), species/species.json (the animals present),
           species/plant_needs.json (pipeline/needs.py) and species/inventory.json (GBIF's most-recorded animals)

The key is the scientific name (genus and species, as GBIF matches it); `id` is the library id.

Fidelity (LEVELS), per asset and for the species (its best asset):
  0  none: nothing of its own; a stand-in species is drawn in its place (plants) or nothing is (animals)
  1  stand-in look: another species' model with its own size and colour (a generated record whose card changes only
     heights and colours; an animal drawn with another's mesh)
  2  its own model: its own crown, branching and foliage (plants: a hand-written record, or one generated from a card
     that gives its own crown outline or leaf; a generated record stays here until it is reviewed in the lineup); its
     own mesh (animals), not animated
  3  rigged and animated (animals: a part rig or a skin with clips); grown (plants: three or more age classes and
     colours for all four seasons; trees and shrubs bake their own impostors in the client)
  4  full: behaviour, sound and seasonal states (animals: senses and diet in species_data, a calendar, a voice); the
     ecology (plants: a habitat block placing it and relations naming who eats it)
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import struct
from pathlib import Path

from .config import REPO_ROOT, TILES_DIR, Tile, now_iso, read_json, write_json

LIB = REPO_ROOT / "library"
CLIENT = REPO_ROOT / "client"
OUT = LIB / "registry.json"
LEVELS = {
    0: "none: a stand-in species is drawn in its place (plants) or nothing is (animals)",
    1: "stand-in look: another species' model with its own size and colour",
    2: "its own model: own crown, branching and foliage (plants) or own mesh (animals), not animated",
    3: "rigged and animated (animals); grown: three or more age classes and four seasons' colours (plants)",
    4: "full: behaviour, sound and seasonal states (animals); the ecology, habitat and relations (plants)",
}
MESHY_BUDGET = 1000                 # credits Aaron authorized (2026-10-25); more needs his go-ahead
MESHY_ESTIMATE = {"bird": 30, "quadruped": 30, "rodent": 30, "reptile": 25, "other": 30}
MESHY_ESTIMATE_NOTE = ("a 'latest' model preview (20) and a texture refine (10); rigging and clips by our own tools "
                       "(tools/rig_quadruped.py, the bird and rodent part-rig templates), no credits")
# Not part of a world with the humans removed.
DOMESTIC = {"Homo sapiens", "Felis catus", "Canis familiaris", "Canis lupus", "Bos taurus", "Equus caballus", "Ovis aries",
            "Capra hircus", "Gallus gallus", "Columba livia", "Anser anser", "Mus musculus", "Rattus rattus",
            "Rattus norvegicus", "Passer domesticus"}
PLANT_FORMS = {"tree": "tree", "shrub": "shrub", "multi_stem_shrub_tree": "shrub", "grass": "grass", "forb": "forb",
               "emergent": "emergent"}


def _sci_key(s: str) -> str:
    parts = (s or "").replace("subsp.", "").replace("var.", "").split()
    return " ".join(parts[:2]) if len(parts) >= 2 else (s or "")


def _id_of(s: str) -> str:
    return _sci_key(s).lower().replace(" ", "_").replace("-", "_")


# --------------------------------------------------------------------------------------------- plants

def plant_entry(rec: dict, path: Path) -> dict:
    form = rec.get("form")
    kind = PLANT_FORMS.get(form, form)
    gen = rec.get("generated")
    reviewed = bool(rec.get("review"))
    variants = [v["name"] for v in rec.get("variants") or []]
    seasons = (rec.get("foliage") or {}).get("colors") or {}
    eco = bool(rec.get("habitat")) and bool((rec.get("relations") or {}).get("eaten_by") or (rec.get("relations") or {}).get("cover_for"))
    why = []
    if kind in ("grass", "forb", "emergent"):
        g = rec.get("ground") or {}
        lvl = 2 if g else 0
        why.append("its own ground block (drawn by grass.js / forbs.js / emergents.js)" if g else "no ground block")
        if lvl and (g.get("palette") or g.get("height_by_month")):
            lvl = 3
            why.append("season palette or heights by month")
        if lvl == 3 and eco:
            lvl = 4
            why.append("habitat and relations")
        model = {"generator": "grass.js / forbs.js / emergents.js from the record's ground block", "file": str(path.relative_to(REPO_ROOT))}
    else:
        own_form = True
        if gen:
            card = {}
            cp = REPO_ROOT / gen.get("card", "")
            if cp.exists():
                card = json.loads(cp.read_text())
            own_form = bool((card.get("crown") or {}).get("profile") or (card.get("foliage") or {}).get("leaf_shape")
                            or card.get("patch") or (card.get("crown") or {}).get("shape"))
        lvl = 2 if own_form else 1
        why.append(("generated from its trait card on the " + gen["template_common"] + " template" if gen else "hand-written record")
                   + ("" if own_form else ": the template's form, its own size and colour"))
        if lvl == 2 and len(variants) >= 3 and all(k in seasons for k in ("winter", "spring", "summer", "fall")):
            lvl = 3
            why.append(f"{len(variants)} age classes, four seasons' colours")
        if lvl == 3 and eco:
            lvl = 4
            why.append("habitat and relations")
        if gen and not reviewed and lvl > 2:
            why.append(f"held at 2 until reviewed in the lineup (would be {lvl})")
            lvl = 2
        model = {"generator": "client/src/treegen.js LIBRARY (procedural; impostors baked by impostorBake.js)",
                 "file": str(path.relative_to(REPO_ROOT)), "age_classes": variants, "impostor": True,
                 "season_colours": sorted(seasons), "growth_curve": bool(rec.get("growth")), "snag": bool(rec.get("snag"))}
        if gen:
            model["generated"] = {k: gen[k] for k in ("card", "template", "version") if k in gen}
            model["reviewed"] = reviewed
    return {"id": rec["id"], "scientific": rec.get("scientific"), "common": rec.get("common"), "kind": kind,
            "fidelity": lvl, "why": why,
            "assets": {"model": {"fidelity": lvl, **model}},
            "provenance": {"status": rec.get("status"), "authors": rec.get("authors"), "sources": len(rec.get("sources") or [])},
            "license": rec.get("license"), "tiles": []}


def plant_card_entry(card: dict) -> dict:
    return {"id": card["id"], "scientific": card.get("scientific"), "common": card.get("common"),
            "kind": PLANT_FORMS.get(card.get("form"), card.get("form")), "fidelity": 0,
            "why": ["a trait card, no record yet: the plants step grows it when a tile needs it"],
            "assets": {"model": {"fidelity": 0, "card": f"library/plant_cards/{card['id']}.json", "stand_in": card.get("stand_in")}},
            "license": "CC BY-SA 4.0", "tiles": []}


# --------------------------------------------------------------------------------------------- animals

def _glb_json(path: Path) -> dict | None:
    try:
        with open(path, "rb") as f:
            magic, _, _ = struct.unpack("<4sII", f.read(12))
            if magic != b"glTF":
                return None
            n, kind = struct.unpack("<II", f.read(8))
            return json.loads(f.read(n)) if kind == 0x4E4F534A else None
    except Exception:  # noqa: BLE001
        return None


def _client_text(name: str) -> str:
    p = CLIENT / "src" / name
    return p.read_text() if p.exists() else ""


def meshy_ledger() -> dict:
    by = {}
    for f in glob.glob(str(LIB / "animals" / "jobs" / "*" / "*" / "job.json")):
        d = json.loads(Path(f).read_text())
        sp = Path(f).parent.parent.name
        c = d.get("credits_charged") or 0
        by.setdefault(sp, {"jobs": 0, "credits": 0})
        by[sp]["jobs"] += 1
        by[sp]["credits"] += c
    return {"spent": sum(v["credits"] for v in by.values()), "budget": MESHY_BUDGET, "by_species": by}


def animal_entry(rec: dict, ledger: dict, texts: dict, behaviour: dict) -> dict:
    sid = rec["id"]
    tiers = rec.get("tiers") or {}
    src = rec.get("source") or {}
    glb = REPO_ROOT / tiers["file"] if tiers.get("file") else None
    have_mesh = bool(glb and glb.exists())
    gj = _glb_json(glb) if have_mesh else None
    skin = ((gj or {}).get("extras") or {}).get("skin") or {}
    rig = rec.get("rig") or ""
    rig_s = rig if isinstance(rig, str) else json.dumps(rig)
    gltf_anim = bool((gj or {}).get("skins") and (gj or {}).get("animations"))   # a glTF skin with its own clips (the player raven)
    procedural = not have_mesh and "procedural" in rig_s.lower()                # drawn and posed by client code (the woodpecker)
    animated = (have_mesh and (gltf_anim or (bool(rig) and not rig_s.lower().startswith(("planned", "none", "to wire"))))) or procedural
    clips = rec.get("clips") or None
    legs = bool(skin.get("legs"))
    code_re = re.compile(r"(^|[\s{,])" + re.escape(sid) + r"\s*:", re.M)
    sound = bool(code_re.search(texts["sound"]))
    playable = bool(code_re.search(texts["ground"]) or code_re.search(texts["flier"]) or code_re.search(texts["playable"]))
    beh = behaviour.get(sid) or {}
    shared = [o for o, f in texts["files"].items() if o != sid and f and f == tiers.get("file")]
    why = []
    if procedural:
        lvl = 2
        why.append("own procedural model drawn by the client (no adopted mesh yet)")
    elif not have_mesh:
        lvl = 0
        why.append("no adopted mesh on disk")
    elif shared:
        lvl = 1
        why.append(f"drawn with {shared[0]}'s mesh")
    else:
        lvl = 2
        why.append(f"own mesh ({src.get('kind') or 'procedural'}; {tiers.get('lod0') or '?'} triangles)")
    if lvl == 2 and animated:
        lvl = 3
        why.append("rigged and animated: " + ("skinned clips" if clips or skin or gltf_anim else ("posed by client code" if procedural else "part rig"))
                   + (", the leg engine" if legs else ""))
    full = beh.get("senses") and (beh.get("diet") or sid in behaviour.get("_eats_plants", ())) and beh.get("calendar") and sound
    if lvl == 3 and full:
        lvl = 4
        why.append("behaviour (senses, diet, calendar) and a voice")
    elif lvl == 3:
        miss = [k for k in ("senses", "calendar") if not beh.get(k)] + ([] if beh.get("diet") or sid in behaviour.get("_eats_plants", ()) else ["diet"]) + ([] if sound else ["voice"])
        why.append("for 4: " + ", ".join(miss))
    tax = rec.get("taxonomy") or {}
    kind = {"Mammalia": "mammal", "Aves": "bird", "Reptilia": "reptile", "Amphibia": "amphibian"}.get(tax.get("class"), rec.get("body_plan"))
    led = ledger["by_species"].get(sid)
    return {"id": sid, "scientific": rec.get("scientific"), "common": rec.get("common"), "kind": kind, "fidelity": lvl, "why": why,
            "assets": {
                "mesh": {"fidelity": 2 if have_mesh and not shared else (1 if shared else 0), "file": tiers.get("file"),
                         "source": src.get("kind"), "job_id": src.get("job_id"), "triangles": {k: tiers.get(k) for k in ("lod0", "lod1", "lod2") if tiers.get(k)}},
                "rig": {"animated": animated, "kind": "skin" if skin or gltf_anim else ("client code" if procedural else ("part rig" if animated else None)),
                        "clips": (clips or {}).get("file") if isinstance(clips, dict) else None, "leg_engine": legs},
                "sound": {"voice": sound, "where": "client/src/sound.js" if sound else None},
                "behaviour": {k: bool(beh.get(k)) for k in ("senses", "diet", "needs", "calendar", "range")},
                "locomotion": behaviour.get("_locomotion", {}).get(sid),
                "playable": playable},
            "meshy": led, "license": rec.get("license"),
            "provenance": {"status": rec.get("status"), "source": src.get("author") or src.get("kind"), "url": src.get("url")},
            "tiles": []}


def _behaviour() -> dict:
    from . import species_data as sd
    out = {}
    for sp in sd.SPECIES:
        c = sp["code"]
        out[c] = {"senses": bool(sp.get("senses")), "diet": c in getattr(sd, "DIET", {}), "needs": c in getattr(sd, "NEEDS", {}),
                  "calendar": c in getattr(sd, "CALENDAR", {}), "range": c in getattr(sd, "RANGE", {})}
    eats = set()   # a herbivore's diet is in the plants' records (relations.eaten_by), which games.py reads as forage
    for p in (LIB / "species").glob("*.json"):
        try:
            for r in (json.loads(p.read_text()).get("relations") or {}).get("eaten_by") or []:
                eats.add(r.get("animal"))
        except Exception:  # noqa: BLE001
            pass
    out["_eats_plants"] = eats
    try:
        loc = json.loads((LIB / "animals" / "locomotion.json").read_text())
        out["_locomotion"] = {k: True for k in (loc.get("species") or {})}
    except Exception:  # noqa: BLE001
        out["_locomotion"] = {}
    return out


# --------------------------------------------------------------------------------------------- the registry

def scan() -> dict:
    species: dict[str, dict] = {}
    for p in sorted((LIB / "species").glob("*.json")):
        if p.name == "index.json" or p.stem.startswith("_"):
            continue
        rec = json.loads(p.read_text())
        e = plant_entry(rec, p)
        species[_sci_key(rec.get("scientific") or rec["id"])] = e
    for p in sorted((LIB / "plant_cards").glob("*.json")) if (LIB / "plant_cards").exists() else []:
        card = json.loads(p.read_text())
        k = _sci_key(card.get("scientific") or card["id"])
        if k not in species:
            species[k] = plant_card_entry(card)
    ledger = meshy_ledger()
    beh = _behaviour()
    files = {}
    recs = []
    for p in sorted((LIB / "animals").glob("*.json")):
        if p.name in ("index.json", "locomotion.json"):
            continue
        rec = json.loads(p.read_text())
        if "id" not in rec:
            continue
        recs.append(rec)
        files[rec["id"]] = (rec.get("tiers") or {}).get("file")
    texts = {"sound": _client_text("sound.js"), "ground": _client_text("groundControl.js"), "flier": _client_text("flierControl.js"),
             "playable": _client_text("playable.js"), "files": files}
    for rec in recs:
        species[_sci_key(rec.get("scientific") or rec["id"])] = animal_entry(rec, ledger, texts, beh)
    # animals in the behaviour tables with no library entry
    from .species_data import SPECIES as SD
    for sp in SD:
        k = _sci_key(sp["scientific"])
        if k not in species:
            species[k] = {"id": sp["code"], "scientific": sp["scientific"], "common": sp["common"], "kind": "animal", "fidelity": 0,
                          "why": ["behaviour tables only, no mesh"], "assets": {}, "tiles": []}
    by_id = {e["id"]: k for k, e in species.items()}
    # tiles
    for mp in sorted(TILES_DIR.glob("utm*/manifest.json")):
        t = mp.parent
        mix_p = t / "client" / "species_mix.json"
        if mix_p.exists():
            mix = read_json(mix_p)
            fr = mix.get("fractions") or {}
            short = {}
            from .species_mix import SHORT
            inv = {v: k for k, v in SHORT.items()}
            for layer in ("tree_share", "shrub_share", "ground_share"):
                for name, share in (fr.get(layer) or {}).items():
                    sid = inv.get(name, name)
                    if share and sid in by_id:
                        species[by_id[sid]]["tiles"].append({"tile": t.name, "share": share, "as": layer.split("_")[0]})
        sp_p = t / "species" / "species.json"
        if sp_p.exists():
            for s in read_json(sp_p):
                if s.get("present", True) and s["code"] in by_id:   # no `present`: built before 2026-10-27, every species is
                    species[by_id[s["code"]]]["tiles"].append({"tile": t.name, "present": s.get("rule")})
    # needs and queues from the tile reports
    queue_cards, queue_meshy = {}, {}
    for rp in sorted(TILES_DIR.glob("utm*/species/registry.json")):
        rep = read_json(rp)
        for q in rep.get("queue", {}).get("cards", []):
            queue_cards.setdefault(q["id"], {**q, "tiles": []})["tiles"].append(rep["tile"])
        for q in rep.get("queue", {}).get("meshy", []):
            e = queue_meshy.setdefault(q["scientific"], {**q, "tiles": [], "records": 0})
            e["tiles"].append(rep["tile"])
            e["records"] += q.get("records", 0)
    meshy = sorted(queue_meshy.values(), key=lambda q: -q["records"])
    left = MESHY_BUDGET - ledger["spent"]
    acc = 0
    for q in meshy:
        acc += q["estimate_credits"]
        q["within_budget"] = acc <= left
    summary = summarize(species)
    return {"generated_at": now_iso(), "about": __doc__.split("\n\n")[0], "levels": LEVELS,
            "summary": summary, "meshy": {**{k: ledger[k] for k in ("spent", "budget")}, "left": left,
                                          "estimate_note": MESHY_ESTIMATE_NOTE, "queued": meshy,
                                          "queued_credits": sum(q["estimate_credits"] for q in meshy),
                                          "rule": "queued, never run: generation past the 1,000-credit budget needs Aaron's go-ahead"},
            "cards_queued": sorted(queue_cards.values(), key=lambda q: q["id"]),
            "species": dict(sorted(species.items()))}


def summarize(species: dict) -> dict:
    by_kind = {}
    for e in species.values():
        k = e.get("kind") or "?"
        by_kind.setdefault(k, {str(i): 0 for i in range(5)})
        by_kind[k][str(e["fidelity"])] += 1
    by_level = {str(i): sum(1 for e in species.values() if e["fidelity"] == i) for i in range(5)}
    return {"species": len(species), "by_level": by_level, "by_kind": by_kind}


# --------------------------------------------------------------------------------------------- per tile

def tile_report(tile: Tile) -> dict:
    """species/registry.json: the tile's species at their fidelity, and what is queued for it."""
    reg = scan()
    by_id = {e["id"]: e for e in reg["species"].values()}
    from .communities import stand_in
    plants, animals, cards = [], [], []
    mix = read_json(tile.path("client/species_mix.json")) if tile.path("client/species_mix.json").exists() else {}
    fr = mix.get("fractions") or {}
    from .species_mix import SHORT
    inv = {v: k for k, v in SHORT.items()}
    drawn = {}
    for layer in ("tree_share", "shrub_share", "ground_share"):
        for name, share in (fr.get(layer) or {}).items():
            if share:
                drawn[inv.get(name, name)] = (layer.split("_")[0], share)
    needs_p = tile.path("species/plant_needs.json")
    needs = read_json(needs_p)["needs"] if needs_p.exists() else []
    seen = set()
    for n in needs:
        e = by_id.get(n["id"])
        lvl = e["fidelity"] if e and n.get("record") else 0
        sub = (mix.get("substitutions") or {}).get(n["id"])
        row = {"id": n["id"], "kind": n["kind"], "fidelity": lvl, "common": (e or {}).get("common"),
               "drawn_as": n["id"] if n.get("record") else (sub or stand_in(n["id"])),
               "share": drawn.get(n["id"], (None, 0))[1], "why_needed": n["why"][:3]}
        if lvl == 0:
            row["stand_in"] = row["drawn_as"]
            if not n.get("card"):
                cards.append({"id": n["id"], "kind": n["kind"], "stand_in": row["drawn_as"], "why": n["why"][:2]})
        plants.append(row)
        seen.add(n["id"])
    for sid, (layer, share) in drawn.items():
        if sid in seen:
            continue
        e = by_id.get(sid)
        plants.append({"id": sid, "kind": (e or {}).get("kind") or layer, "fidelity": (e or {}).get("fidelity", 0),
                       "common": (e or {}).get("common"), "drawn_as": sid, "share": share,
                       "why_needed": ["drawn by the species mix (a habitat-class or rule default, not named by the tile's communities)"]})
    sp_p = tile.path("species/species.json")
    present = {s["code"]: s for s in read_json(sp_p)} if sp_p.exists() else {}
    for code, s in present.items():
        if not s.get("present", True):   # no `present` (built before 2026-10-27): every species is
            continue
        e = by_id.get(code)
        animals.append({"id": code, "scientific": s.get("scientific"), "common": s.get("common"), "kind": (e or {}).get("kind"),
                        "fidelity": (e or {}).get("fidelity", 0), "present": s.get("rule"), "evidence": s.get("evidence")})
    known = {_sci_key(e.get("scientific") or "") for e in reg["species"].values()}
    meshy = []
    inv_p = tile.path("species/inventory.json")
    for row in (read_json(inv_p) if inv_p.exists() else []):
        if row.get("group") not in ("bird", "mammal") or not row.get("scientific"):
            continue
        k = _sci_key(row["scientific"])
        if k in known or k in DOMESTIC:
            continue
        plan = "bird" if row["group"] == "bird" else "quadruped"
        meshy.append({"scientific": k, "id": _id_of(k), "common": row.get("common"), "group": row["group"], "family": row.get("family"),
                      "records": row["occurrences"], "estimate_credits": MESHY_ESTIMATE[plan],
                      "status": "queued (not run): needs a brief in library/animals/drafts/ and Aaron's go-ahead past the budget"})
    meshy.sort(key=lambda q: -q["records"])
    by_level = {str(i): {"plants": sum(1 for p in plants if p["fidelity"] == i), "animals": sum(1 for a in animals if a["fidelity"] == i)}
                for i in range(5)}
    doc = {"tile": tile.tile_id, "at": now_iso(), "levels": LEVELS, "summary": {"by_level": by_level,
           "plants": len(plants), "animals_present": len(animals), "animals_queued": len(meshy),
           "meshy_credits_queued": sum(q["estimate_credits"] for q in meshy), "cards_queued": len(cards),
           "stand_ins": {p["id"]: p["drawn_as"] for p in plants if p["fidelity"] == 0}},
           "plants": sorted(plants, key=lambda p: (-p["share"], p["id"])), "animals": animals,
           "queue": {"cards": cards, "meshy": meshy}}
    write_json(tile.path("species/registry.json"), doc)
    return {"path": "species/registry.json", "kind": "table", **{k: doc["summary"][k] for k in ("plants", "animals_present", "animals_queued", "cards_queued")}}


def write_registry() -> dict:
    reg = scan()
    write_json(OUT, reg)
    return reg


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Rebuild the species registry (library/registry.json).")
    ap.add_argument("--tile", action="append")
    a = ap.parse_args(argv)
    for t in a.tile or []:
        print(json.dumps(tile_report(Tile.from_id(t))))
    reg = write_registry()
    s = reg["summary"]
    print(f"{s['species']} species; by level {s['by_level']}")
    for k, v in sorted(s["by_kind"].items()):
        print(f"  {k:<10} {v}")
    print(f"meshy: {reg['meshy']['spent']} of {reg['meshy']['budget']} spent; {len(reg['meshy']['queued'])} queued "
          f"({reg['meshy']['queued_credits']} credits est.)")


if __name__ == "__main__":
    main()
