"""The tile's own animals for the client: client/fauna.json (world pipeline phase 1, 2026-11-06).

The probes showed the client drawing a fixed North American cast by habitat everywhere (about 190 of them in Borneo) and
none of a tile's own researched species. This turns the research (species/animals.json) into what the client draws:

  allow   the curated client species (animals.js SPECIES codes) the tile's own research or records list: only these of
          the static cast spawn on the tile (`gate`)
  slots   up to MAX_SLOTS new species, each a STAND-IN: an existing species' body and behaviour (its `kin`) scaled to the
          species' mass, chosen by RULES from taxonomy, diet, mass and habits; a density from body mass (Damuth 1981 for
          herbivores; an inverse-mass rule for carnivores; a softer one for birds); group size by guild; active hours
          from the traits (EltonTraits activity); water from the family

Every choice is a rule over the traits, so a new tile needs no edit; a species with its own model later replaces its
stand-in through the registry, not here. The rules' known errors are listed in `known` per slot (a giraffe on a deer).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .config import REPO_ROOT, Tile, write_json

MAX_SLOTS = 40
TRAITS = REPO_ROOT / "library" / "animals" / "traits"
ANIMALS_JS = REPO_ROOT / "client" / "src" / "animals.js"

# The kin slots (static client species) and their adult mass (kg), for the scale (mass ratio to the third power)
KIN_MASS = {
    "odocoileus_hemionus": 60, "cervus_canadensis": 300, "puma_concolor": 55, "lynx_rufus": 10, "canis_latrans": 13,
    "urocyon_cinereoargenteus": 4, "ursus_americanus": 100, "lontra_canadensis": 9, "sylvilagus_bachmani": 0.7,
    "lepus_californicus": 2.5, "sciurus_griseus": 0.6, "otospermophilus_beecheyi": 0.6, "microtus_californicus": 0.04,
    "peromyscus_maniculatus": 0.02, "corvus_corax": 1.2, "buteo_jamaicensis": 1.1, "cathartes_aura": 1.6,
    "callipepla_californica": 0.18, "meleagris_gallopavo": 6, "cyanocitta_stelleri": 0.12, "strix_varia": 0.7,
    "leuconotopicus_villosus": 0.07, "ardea_herodias": 2.2, "mergus_merganser": 1.5, "larus_glaucescens": 1.1,
    "megaceryle_alcyon": 0.15, "sceloporus_occidentalis": 0.015, "plethodon_vehiculum": 0.003,
}

WATER_FAMILIES = {"Anatidae", "Ardeidae", "Alcedinidae", "Laridae", "Phalacrocoracidae", "Anhingidae", "Ciconiidae",
                  "Threskiornithidae", "Podicipedidae", "Rallidae", "Jacanidae", "Hippopotamidae", "Crocodylidae",
                  "Alligatoridae", "Lutrinae", "Pandionidae"}
SKIP_ORDERS = {"Chiroptera", "Cetacea", "Sirenia", "Squamata_serpentes"}   # no rig yet: bats, whales, sea cows, snakes
SNAKE_FAMILIES = {"Colubridae", "Viperidae", "Elapidae", "Boidae", "Pythonidae", "Natricidae", "Lamprophiidae",
                  "Typhlopidae", "Leptotyphlopidae", "Dipsadidae"}


from .fauna_models import model_for   # noqa: E402


def static_codes() -> list[str]:
    """The curated client species: the `code:` of each entry in animals.js SPECIES."""
    src = ANIMALS_JS.read_text()
    block = src[src.index("const SPECIES = ["):src.index("];", src.index("const SPECIES = ["))]
    return sorted(set(re.findall(r"code: '([a-z_]+)'", block)))


def _traits(sid: str) -> dict:
    p = TRAITS / f"{sid}.json"
    return json.loads(p.read_text()) if p.exists() else {}


def kin_for(a: dict, t: dict) -> tuple[str | None, str, list[str]]:
    """(kin code, archetype name, known errors) for an animal, or (None, why, []) when no stand-in fits."""
    tax = a.get("taxonomy") or t.get("taxonomy") or {}
    cls, order, fam = tax.get("class"), tax.get("order"), tax.get("family")
    m = float(a.get("mass_kg") or t.get("mass_kg") or 0) or None
    role = set(a.get("role") or (t.get("diet") or {}).get("role") or [])
    known: list[str] = []
    if cls == "Aves":
        if "scavenger" in role and (m or 0) > 1.0 and fam in ("Accipitridae", "Cathartidae"):
            return "cathartes_aura", "soaring scavenger", known
        if order in ("Accipitriformes", "Falconiformes") or fam in ("Accipitridae", "Falconidae", "Pandionidae", "Sagittariidae"):
            return "buteo_jamaicensis", "soaring raptor", known
        if order == "Strigiformes":
            return "strix_varia", "night perching bird", known
        if fam == "Corvidae":
            return "corvus_corax", "corvid", known
        if fam in ("Ardeidae", "Ciconiidae", "Threskiornithidae", "Gruidae", "Phoenicopteridae", "Scopidae"):
            return "ardea_herodias", "wading bird", known
        if fam in ("Anatidae", "Podicipedidae", "Rallidae", "Phalacrocoracidae", "Anhingidae", "Jacanidae"):
            return "mergus_merganser", "waterbird", known
        if fam == "Laridae":
            return "larus_glaucescens", "gull", known
        if fam == "Alcedinidae":
            return "megaceryle_alcyon", "kingfisher", known
        if order in ("Galliformes", "Tinamiformes", "Otidiformes", "Struthioniformes", "Rheiformes", "Casuariiformes") \
                or fam in ("Numididae", "Phasianidae", "Cracidae", "Tinamidae", "Otididae"):
            if (m or 0) > 20:
                known.append("a giant flightless bird on the turkey's body")
            return ("meleagris_gallopavo" if (m or 0) > 1.5 else "callipepla_californica"), "ground bird", known
        if fam == "Picidae":
            return "leuconotopicus_villosus", "woodpecker", known
        if order in ("Psittaciformes", "Bucerotiformes", "Piciformes") and fam != "Picidae":
            known.append("a parrot, toucan or hornbill on a jay's body")
        return "cyanocitta_stelleri", "perching bird", known
    if cls == "Mammalia":
        if order in SKIP_ORDERS:
            return None, f"no rig for {order}", []
        if order == "Primates":
            if (m or 0) > 15:
                return "ursus_americanus", "large ground primate (stand-in walker)", ["a primate on a bear's body"]
            return "sciurus_griseus", "arboreal climber", ["a monkey on a squirrel's body"]
        if order == "Carnivora":
            if fam == "Felidae":
                return ("puma_concolor" if (m or 0) > 30 else "lynx_rufus"), "ambush predator", known
            if fam in ("Canidae", "Hyaenidae"):
                return ("canis_latrans" if (m or 0) > 6 else "urocyon_cinereoargenteus"), "coursing predator", known
            if fam == "Ursidae":
                return "ursus_americanus", "large omnivore", known
            if fam == "Mustelidae" and (a.get("id", "").startswith(("lontra", "aonyx", "pteronura", "lutra", "hydrictis"))):
                return "lontra_canadensis", "swimmer (otter)", known
            return "urocyon_cinereoargenteus", "small carnivore", known
        if order in ("Artiodactyla", "Perissodactyla", "Proboscidea", "Cetartiodactyla"):
            if fam in ("Giraffidae",):
                known.append("a giraffe on a deer's proportions")
            if order == "Proboscidea" or fam in ("Rhinocerotidae", "Hippopotamidae"):
                known.append("a pachyderm on a deer's body")
            return ("cervus_canadensis" if (m or 0) > 150 else "odocoileus_hemionus"), "grazing or browsing herd", known
        if order == "Lagomorpha":
            return ("lepus_californicus" if (m or 0) > 1.5 else "sylvilagus_bachmani"), "hopper", known
        if order == "Hyracoidea":
            return "otospermophilus_beecheyi", "rock colony", known
        if order == "Rodentia":
            if fam == "Sciuridae":
                tree = not any(k in (a.get("id") or "") for k in ("spermophil", "marmota", "xerus", "cynomys"))
                return ("sciurus_griseus" if tree else "otospermophilus_beecheyi"), ("tree squirrel" if tree else "ground colony"), known
            if (m or 0) > 3:
                return "otospermophilus_beecheyi", "large rodent", ["a large rodent on a ground squirrel's body"]
            return ("peromyscus_maniculatus" if "nocturnal" in ((t.get("diet") or {}).get("activity") or []) else "microtus_californicus"), "small rodent", known
        if order in ("Pilosa", "Cingulata", "Tubulidentata", "Pholidota", "Didelphimorphia", "Eulipotyphla", "Afrosoricida",
                     "Macroscelidea", "Erinaceomorpha", "Soricomorpha"):
            return ("urocyon_cinereoargenteus" if (m or 0) > 1 else "microtus_californicus"), "small ground mammal", \
                ["an anteater, armadillo or shrew on a fox's or vole's body"]
        return "urocyon_cinereoargenteus", "mammal (unplaced)", [f"order {order} has no archetype rule"]
    if cls in ("Reptilia", "Squamata", "Testudines", "Crocodylia"):
        if fam in SNAKE_FAMILIES:
            return None, "no snake rig", []
        k = ["a crocodilian or tortoise on a lizard's body"] if order in ("Crocodylia", "Testudines") else []
        return "sceloporus_occidentalis", "reptile", k
    if cls == "Amphibia":
        return "plethodon_vehiculum", "amphibian", known
    return None, f"no archetype for class {cls}", []


# Herbivore biomass by ecosystem (iteration 1, 2026-11-06): Damuth's law is a global mean with an order of scatter; the
# grazer-rich systems sit far above it (African savanna large-herbivore biomass rises with rainfall and soil nutrients:
# Fritz and Duncan 1994; Serengeti wildebeest are hundreds per km2 on the move). The tile's dominant ecosystem group sets a
# multiplier on the large herbivores (over 20 kg).
HERBIVORE_PRODUCTIVITY = {"T4.1": 5.0, "T4.2": 2.0, "T4.5": 2.0, "T5.1": 1.5, "T4.4": 1.5}


def density_km2(a: dict, kin: str, archetype: str, efg: str | None = None) -> float:
    m = max(float(a.get("mass_kg") or KIN_MASS.get(kin, 1)), 0.002)
    role = set(a.get("role") or [])
    cls = (a.get("taxonomy") or {}).get("class")
    if cls == "Aves":
        # one species of bird: tens per km2 for the small ones, a pair or two for the raptors (iteration 1: the first law,
        # 60 m^-0.6 capped at 400, put 2,000 birds round a Bornean player)
        d = (0.5 * m ** -0.75) if ("predator" in role and m > 0.3) else min(70.0, 15.0 * m ** -0.4)
    elif cls == "Mammalia":
        if "predator" in role:
            d = 30.0 / m
        else:
            d = 10 ** 4.23 * (m * 1000) ** -0.75      # Damuth 1981 (g -> per km2)
            if m > 20:
                d *= HERBIVORE_PRODUCTIVITY.get(efg or "", 1.0)
    else:
        d = 50.0
    return round(min(max(d, 0.005), 2000.0), 4)


GROUP = {"grazing or browsing herd": [5, 30], "arboreal climber": [3, 15], "large ground primate (stand-in walker)": [5, 30],
         "coursing predator": [1, 6], "ambush predator": [1, 4], "waterbird": [2, 10], "wading bird": [1, 3],
         "ground bird": [3, 12], "soaring scavenger": [1, 8], "perching bird": [1, 6], "rock colony": [3, 12],
         "ground colony": [3, 12], "gull": [1, 6]}


def fauna_slots(tile: Tile) -> dict:
    research = json.loads(tile.path("species/animals.json").read_text())
    codes = static_codes()
    listed = [a for a in research.get("animals", []) if a.get("listed", True)]
    present = set()
    sp = tile.path("species/species.json")
    if sp.exists():
        sj = json.loads(sp.read_text())
        present = {e.get("code") for e in (sj if isinstance(sj, list) else sj.get("species", [])) if e.get("present")}
    tile_ids = {a["id"] for a in listed} | present
    allow = sorted(c for c in codes if c in tile_ids)
    # mammals first, the most visible first: records x sqrt(mass) (an elephant with 46 records before a mongoose with 83);
    # then birds by records; then the rest
    def visible(a):
        m = float(a.get("mass_kg") or _traits(a["id"]).get("mass_kg") or 1)
        return (a.get("records") or 0) * (m ** 0.5 if a.get("kind") == "mammal" else 1)
    order = sorted((a for a in listed if a["id"] not in codes),
                   key=lambda a: ({"mammal": 0, "bird": 1}.get(a.get("kind"), 2), -visible(a)))
    eco = tile.path("vegetation/ecosystem.json")
    efg = (json.loads(eco.read_text()).get("groups") or [{}])[0].get("code") if eco.exists() else None
    slots, skipped = [], []
    for a in order:
        if len(slots) >= MAX_SLOTS:
            skipped.append({"id": a["id"], "why": f"over the {MAX_SLOTS}-slot cap"})
            continue
        t = _traits(a["id"])
        kin, archetype, known = kin_for(a, t)
        if not kin:
            skipped.append({"id": a["id"], "why": archetype})
            continue
        m = float(a.get("mass_kg") or t.get("mass_kg") or KIN_MASS[kin])
        scale = round(min(max((m / KIN_MASS[kin]) ** (1 / 3), 0.25), 4.0), 3)
        act = set((t.get("diet") or {}).get("activity") or [])
        fam = (a.get("taxonomy") or {}).get("family")
        name = (a.get("common") or a["scientific"]).strip()
        slots.append({
            "code": a["id"], "scientific": a["scientific"], "common": name[:1].upper() + name[1:], "one": name.lower(),
            "many": name.lower() + ("" if name.endswith("s") else "s"), "kin": kin, "archetype": archetype,
            "scale": scale, "tint": None, "mass_kg": round(m, 3), "density_km2": density_km2(a, kin, archetype),
            "group": GROUP.get(archetype, [1, 3]), "bird": a.get("kind") == "bird",
            "night": "nocturnal" in act and "diurnal" not in act, "water": fam in WATER_FAMILIES or kin == "lontra_canadensis",
            "role": a.get("role") or [], "known": known})
        mdl = model_for(a["id"])   # a body of its own from the library (pipeline/fauna_models.py), drawn at its real size
        if mdl:
            slots[-1]["model"] = mdl
        slots[-1]["density_km2"] = density_km2(a, kin, archetype, efg)
    out = {"format": 1, "gate": True, "allow": allow, "slots": slots, "skipped": skipped,
           "rules": "pipeline/fauna_slots.py: kin by taxonomy, diet and mass; scale = (mass / kin mass)^(1/3), 0.25-4; density "
                    "Damuth 1981 (herbivores; large ones times HERBIVORE_PRODUCTIVITY of the tile's ecosystem), 30 / mass kg "
                    "(carnivores), birds 15 m^-0.4 (cap 70) or 0.5 m^-0.75 (raptors)", "ecosystem": efg}
    write_json(tile.path("client/fauna.json"), out)
    return {"path": "client/fauna.json", "kind": "table", "derived_from": ["species.animals", "species.presence"],
            "allow": len(allow), "slots": len(slots), "skipped": len(skipped),
            "stand_ins": {s["code"]: s["kin"] for s in slots[:12]}}
