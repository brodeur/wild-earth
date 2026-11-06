"""The fauna stage's research (step `animals`, docs/pipeline.md "Species"): every animal recorded on the tile, ranked
within its class; every predator and scavenger; traits for those the game has no entry for; the Meshy queue.

  list     the GBIF records per class (research.animal_records), domestic animals left out; an animal is listed when it
           is a predator or scavenger with MIN_RECORDS or more records, or among the most recorded of its class up to
           CLASS_QUOTA (which fills research.TARGET's 22 animals), or one of the curated species present on the tile
           (species/species.json)
  traits   a listed animal with neither a library entry (library/animals/<id>.json) nor a species_data entry gets a
           generated one, library/animals/traits/<id>.json: taxonomy (GBIF), body plan (by class and order), mass
           (EltonTraits, else the class's typical), size from the mass, diet and trophic role (EltonTraits: species,
           genus or family), activity, senses (the class's ranges scaled by size), and locomotion resolved from the
           taxon tree and the body (pipeline/locomotion.py). Marked generated: the registry holds it as behaviour data
           without a model until a mesh is adopted
  queue    every listed animal without an adopted mesh, with its body plan's rig template and a Meshy estimate, and the
           library animal nearest it by taxonomy (genus, family, order, class) as the stand-in recorded meanwhile
           (nothing is drawn for it yet)

Writes species/animals.json.
"""
from __future__ import annotations

import json
import math

from .config import REPO_ROOT, Tile, now_iso, read_json, write_json
from .research import ANIMAL_CLASSES, TARGET, animal_records, id_of, trophic

LIB = REPO_ROOT / "library" / "animals"
TRAITS = LIB / "traits"
MIN_RECORDS = 3
# 2026-11-06 (world pipeline phase 1): raised from bird 10, mammal 8, reptile 2, amphibian 2, fish 1, invertebrate 1. The
# Serengeti probe listed hyraxes and mongooses and left out the wildebeest, zebra, giraffe, elephant and buffalo, which
# ranked 11th-22nd among its mammals by records. A species needs MIN_RECORDS records to take a quota place.
CLASS_QUOTA = {"bird": 25, "mammal": 25, "reptile": 5, "amphibian": 4, "fish": 2, "invertebrate": 2}
DOMESTIC = {"Homo sapiens", "Felis catus", "Canis familiaris", "Canis lupus", "Bos taurus", "Equus caballus", "Ovis aries",
            "Capra hircus", "Gallus gallus", "Columba livia", "Anser anser", "Mus musculus", "Rattus rattus",
            "Rattus norvegicus", "Passer domesticus", "Sus scrofa", "Oncorhynchus mykiss"}
SYNONYMS = {"Cervus canadensis": "Cervus elaphus"}   # GBIF's name -> EltonTraits' (MSW3 lumps elk with red deer)
# GBIF files some American animals under an Old World species it lumps them with: on a tile in the Americas (UTM zones
# 1-24 north or south) the record is the American species, named as the library names it (2026-11-05: the Hoh's
# "red deer" are Roosevelt elk, Cervus canadensis roosevelti; the tule elk of the SF cells likewise)
AMERICAS = {"Cervus elaphus": "Cervus canadensis"}


def _in_americas(tile: Tile) -> bool:
    try:
        return int(tile.tile_id.split("_")[0][3:-1]) <= 24
    except (ValueError, IndexError):
        return False
# the rig template and the Meshy estimate per body plan (credits: a 'latest' preview 20 + a refine 10)
PLANS = {"quadruped": ("tools/rig_quadruped.py skeleton, gait.js / legs.js", 30),
         "rodent": ("rodent part rig R (animalModels.js), the hop gait for lagomorphs", 30),
         "lagomorph": ("tools/rig_quadruped.py lagomorph path, gait.js hopStep", 30),
         "bird": ("bird part rig (animalModels.js RIG.bird), flierControl", 30),
         "reptile": ("reptile part rig template", 25), "snake": ("none yet: a spine-wave rig", 25),
         "amphibian": ("none yet: the reptile template, hopping", 25),
         "gastropod": ("none: procedural (a body of rings and a foot wave); no Meshy needed", 0),
         "fish": ("none yet: a body-wave swim rig", 25)}
SENSES = {  # the class's ranges in m for a 1 kg animal; scaled by mass^0.2
    "Mammalia": {"sight": 250, "sound": 350, "scent": 500}, "Aves": {"sight": 500, "sound": 250, "scent": 20},
    "Reptilia": {"sight": 60, "sound": 20, "scent": 30}, "Amphibia": {"sight": 20, "sound": 30, "scent": 10},
    "Gastropoda": {"sight": 0.5, "sound": 0, "scent": 5}, "Actinopterygii": {"sight": 15, "sound": 30, "scent": 20},
}
TYPICAL_MASS = {"Mammalia": 1.0, "Aves": 0.05, "Reptilia": 0.05, "Amphibia": 0.02, "Gastropoda": 0.05, "Actinopterygii": 0.5}


def body_plan(tax: dict) -> str:
    c, o, f = tax.get("class"), tax.get("order"), tax.get("family")
    if c == "Aves":
        return "bird"
    if c == "Mammalia":
        if o == "Lagomorpha":
            return "lagomorph"
        if o in ("Rodentia", "Eulipotyphla", "Soricomorpha"):
            return "rodent"
        return "quadruped"
    if c in ("Reptilia", "Squamata") or o == "Squamata":
        return "snake" if f in ("Colubridae", "Viperidae", "Boidae", "Natricidae", "Dipsadidae") else "reptile"
    if c == "Amphibia":
        return "amphibian"
    if c == "Gastropoda":
        return "gastropod"
    if c in ("Actinopterygii", "Teleostei"):
        return "fish"
    return "quadruped"


def known_animals() -> dict:
    """{id: what the game has}: library entries (mesh), species_data entries (behaviour), generated traits."""
    out = {}
    idx = json.loads((LIB / "index.json").read_text()).get("species", [])
    for sid in idx:
        rec = json.loads((LIB / f"{sid}.json").read_text())
        out[sid] = {"library": True, "mesh": bool((rec.get("tiers") or {}).get("file")) or "procedural" in str(rec.get("rig") or ""),
                    "taxonomy": rec.get("taxonomy") or {}, "common": rec.get("common")}
        for a in rec.get("aliases") or []:
            out.setdefault(a, out[sid])
    from .species_data import SPECIES
    for sp in SPECIES:
        out.setdefault(sp["code"], {"library": False, "mesh": False, "taxonomy": {}})["species_data"] = True
    for p in TRAITS.glob("*.json") if TRAITS.exists() else []:
        out.setdefault(p.stem, {"library": False, "mesh": False, "taxonomy": {}})["traits"] = True
    return out


def nearest(tax: dict, known: dict) -> str | None:
    """The library animal with a mesh sharing the deepest rank with this one."""
    for rank in ("genus", "family", "order"):   # a class-level match (an owl drawn as a jay) is no stand-in
        v = tax.get(rank)
        if not v:
            continue
        for sid, k in known.items():
            if k.get("mesh") and (k.get("taxonomy") or {}).get(rank) == v:
                return sid
    return None


def make_traits(row: dict) -> dict:
    """A generated behaviour entry: what the taxon, the body and EltonTraits say. Written once; a hand edit (drop the
    `generated` block) is never overwritten."""
    from .locomotion import resolve
    tax = row["taxonomy"]
    sci = SYNONYMS.get(" ".join(row["scientific"].split()[:2]), row["scientific"])
    t = trophic(sci, tax.get("family"))
    cls = tax.get("class") or ""
    mass = (t or {}).get("mass_kg") or TYPICAL_MASS.get(cls, 0.5)
    plan = body_plan(tax)
    length = round(0.36 * mass ** (1 / 3) * (1.6 if plan in ("snake", "fish") else 1.0), 3)   # nose to tail base, m
    shoulder = round(length * {"quadruped": 0.62, "rodent": 0.3, "lagomorph": 0.45, "reptile": 0.12, "snake": 0.03,
                               "amphibian": 0.2, "gastropod": 0.06, "fish": 0.0, "bird": 0.0}.get(plan, 0.4), 3)
    k = max(mass, 0.001) ** 0.2
    senses = {s: {"range_m": round(r * k, 1)} for s, r in SENSES.get(cls, SENSES["Mammalia"]).items()}
    rec = {"id": id_of(row["scientific"]), "scientific": row["scientific"], "common": row.get("common"), "kind": row["kind"],
           "taxonomy": {"kingdom": tax.get("kingdom"), "phylum": tax.get("phylum"), "class": cls, "order": tax.get("order"),
                        "family": tax.get("family"), "genus": tax.get("genus")},
           "body_plan": plan, "mass_kg": round(mass, 4), "size": {"length_m": length, "shoulder_or_wingspan_m": shoulder or round(length * 1.6, 3)},
           "diet": t, "senses": senses, "rig": PLANS.get(plan, ("?", 30))[0]}
    loco = resolve(rec["id"], rec=rec)
    if plan == "gastropod" and loco:   # a slug's foot wave: millimetres a second, whatever the walkers' laws say
        loco.update(walk_mps=0.001, trot_mps=0.002, cruise_mps=0.0015, top_mps=0.003, sprint_s=1.0)
    rec["locomotion"] = loco
    rec["generated"] = {"by": "pipeline/fauna.py", "at": now_iso(), "from": ["gbif taxonomy", (t or {}).get("source") or "class defaults",
                                                                         "pipeline/locomotion.py"],
                        "note": "behaviour data without a model; review the diet, senses and size before a mesh is made"}
    rec["license"] = "CC BY-SA 4.0 (the entry); diet and mass from EltonTraits 1.0 (CC BY 4.0, credited in the tile's sources)"
    return rec


def animal_research(tile: Tile) -> dict:
    rows = [r for r in animal_records(tile) if " ".join(r["scientific"].split()[:2]) not in DOMESTIC]
    if _in_americas(tile):   # GBIF's lumped names (AMERICAS): the record as the American species
        for r in rows:
            b = " ".join(r["scientific"].split()[:2])
            if b in AMERICAS:
                r["gbif_scientific"] = r["scientific"]; r["scientific"] = AMERICAS[b]; r["common"] = None
    known = known_animals()
    present = {}
    sp_p = tile.path("species/species.json")
    if sp_p.exists():
        present = {s["code"]: s for s in read_json(sp_p) if s.get("present", True)}
    quota = dict(CLASS_QUOTA)
    listed = []
    for r in rows:
        sid = id_of(r["scientific"])
        t = trophic(SYNONYMS.get(" ".join(r["scientific"].split()[:2]), r["scientific"]), (r["taxonomy"] or {}).get("family")) \
            if r["kind"] in ("bird", "mammal") else None
        role = (t or {}).get("role") or []
        why = []
        if any(x in role for x in ("predator", "scavenger")) and r["records"] >= MIN_RECORDS:
            why.append(" and ".join(x for x in role if x in ("predator", "scavenger")))
        if quota.get(r["kind"], 0) > 0 and r["records"] >= MIN_RECORDS:
            why.append(f"most recorded: {r['rank_in_class']} of its class ({r['share_of_class']:.0%} of the class's records)")
            quota[r["kind"]] -= 1
        if sid in present:
            why.append("curated and present")
        r.update(id=sid, role=role, mass_kg=(t or {}).get("mass_kg"), why=why, listed=bool(why))
        if (known.get(sid) or {}).get("common"):   # the library's own name for an animal it has (GBIF's vernacular otherwise)
            r["common"] = known[sid]["common"]
        if why:
            listed.append(r)
    for code, s in present.items():   # the curated animals present, even if GBIF ranks them low
        if not any(r["id"] == code for r in listed):
            listed.append({"id": code, "scientific": s.get("scientific"), "common": s.get("common"), "kind": s.get("group"),
                           "records": s.get("records_buffer"), "why": ["curated and present"], "taxonomy": {}, "role": []})
    generated, queue = [], []
    TRAITS.mkdir(parents=True, exist_ok=True)
    for r in listed:
        k = known.get(r["id"], {})
        has = k.get("library") or k.get("species_data") or k.get("traits")
        if not has and r.get("taxonomy"):
            p = TRAITS / f"{r['id']}.json"
            if not p.exists():
                write_json(p, make_traits(r))
                generated.append(r["id"])
            r["traits"] = f"library/animals/traits/{r['id']}.json"
        if not k.get("mesh"):
            plan = body_plan(r.get("taxonomy") or {}) if r.get("taxonomy") else "quadruped"
            rig, est = PLANS.get(plan, ("?", 30))
            queue.append({"id": r["id"], "scientific": r.get("scientific"), "common": r.get("common"), "kind": r.get("kind"),
                          "records": r.get("records"), "why": r["why"], "body_plan": plan, "rig": rig, "estimate_credits": est,
                          "stand_in": nearest(r.get("taxonomy") or {}, known),
                          "status": "queued (not run): Meshy needs Aaron's go-ahead past the 1,000-credit budget"})
    by_kind = {}
    for r in listed:
        by_kind[r.get("kind") or "?"] = by_kind.get(r.get("kind") or "?", 0) + 1
    n_animals = len(listed)
    doc = {"tile": tile.tile_id, "at": now_iso(), "target": TARGET["animal"], "listed": n_animals, "by_kind": by_kind,
           "meets_target": n_animals >= TARGET["animal"],
           "predators": sorted(r["id"] for r in listed if "predator" in (r.get("role") or [])),
           "scavengers": sorted(r["id"] for r in listed if "scavenger" in (r.get("role") or [])),
           "generated_traits": generated, "queue": queue, "queued_credits": sum(q["estimate_credits"] for q in queue),
           "animals": listed, "all_records": [{k: r.get(k) for k in ("id", "scientific", "common", "kind", "records", "rank_in_class",
                                                                     "share_of_class", "role", "listed")} for r in rows],
           "sources": ["gbif (facet counts)", "eltontraits"], "classes": {v[0]: v[1] for v in ANIMAL_CLASSES.values()}}
    write_json(tile.path("species/animals.json"), doc)
    return {"path": "species/animals.json", "kind": "table", "sources_used": ["gbif", "eltontraits"], "listed": n_animals,
            "predators": len(doc["predators"]), "scavengers": len(doc["scavengers"]), "generated_traits": len(generated),
            "queued": len(queue), "queued_credits": doc["queued_credits"]}
