"""The tile's own animals for the client: client/fauna.json (world pipeline phase 1, 2026-11-06).

The probes showed the client drawing a fixed North American cast by habitat everywhere (about 190 of them in Borneo) and
none of a tile's own researched species. This turns the research (species/animals.json) into what the client draws:

  allow   the curated client species (animals.js SPECIES codes) the tile's own research or records list: only these of
          the static cast spawn on the tile (`gate`)
  slots   up to MAX_SLOTS new species, each a STAND-IN: an existing species' body and behaviour (its `kin`) scaled to the
          species' mass, chosen by RULES from taxonomy, diet, mass and habits (a bird's by its way of life, AVONET's
          lifestyle and flightlessness: bird_life; a ground bird's gait from its locomotion row); a density from body mass (Damuth 1981 for
          herbivores; an inverse-mass rule for carnivores; a softer one for birds); group size by guild; active hours
          from the traits (EltonTraits activity); water from the family

Every choice is a rule over the traits, so a new tile needs no edit; a species with its own model later replaces its
stand-in through the registry, not here. The rules' known errors are listed in `known` per slot (a giraffe on a deer).
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

from .config import REPO_ROOT, Tile, write_json

MAX_SLOTS = 40
# the reptiles and amphibians come after the mammals and birds and found the 40 taken (the Serengeti's crocodile, 151
# records, behind its fortieth bird): up to MAX_OTHER more slots are theirs, after the cap (animals.js STAND_IN_MAX 48)
MAX_OTHER = 6
# The classes of body the caps would leave out (2026-11-06, the snake lane: Corcovado's only snake, the terciopelo, was
# behind six lizards and frogs, so no snake could be played there): above both caps a tile keeps one slot more for each
# class of body that has a model or a buildable template and no slot yet (body_class: a snake, a sprawling lizard or
# crocodilian, a tortoise, each bird template, a quadruped; a species with a model of its own counts by its model's kind),
# the first of each by the caps' own ranking, up to RESERVE_MAX (animals.js STAND_IN_MAX 48 = 40 + 6 + 2).
RESERVE_MAX = 2
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
                  "Alligatoridae", "Gavialidae", "Lutrinae", "Pandionidae"}
SKIP_ORDERS = {"Chiroptera", "Cetacea", "Sirenia"}   # no rig yet: bats, whales, sea cows
SNAKE_FAMILIES = {"Colubridae", "Viperidae", "Elapidae", "Boidae", "Pythonidae", "Natricidae", "Lamprophiidae",
                  "Typhlopidae", "Leptotyphlopidae", "Dipsadidae", "Atractaspididae", "Psammophiidae", "Pseudoxyrhophiidae",
                  "Prosymnidae", "Homalopsidae", "Xenodermidae", "Uropeltidae", "Anomalepididae", "Gerrhopilidae", "Aniliidae",
                  "Tropidophiidae", "Acrochordidae", "Pareidae", "Pareatidae", "Calamariidae", "Cylindrophiidae",
                  "Xenopeltidae", "Loxocemidae", "Sibynophiidae", "Grayiidae", "Colubrinae", "Amphisbaenidae", "Trogonophidae",
                  "Bipedidae", "Blanidae", "Rhineuridae", "Cadeidae"}   # (and the legless amphisbaenians)

# ---- reptiles (2026-11-06) ---------------------------------------------------------------------------------------------
# GBIF's backbone has no class Reptilia: its reptile classes are Squamata, Testudines and Crocodylia (pipeline/research.py),
# so a record's `class` is one of those and its order is empty. The group is read from the class, order and family:
#   crocodilian  Crocodylia (Crocodylidae, Alligatoridae, Gavialidae): kept to water (the slot's `water`), way 'water'
#   tortoise     Testudinidae: a slow walker on the ground, way 'walk'
#   turtle       the other Testudines (terrapins, river and sea turtles): at the water, way 'water'
#   chameleon    Chamaeleonidae: a lizard of the branches, way 'bask' (the fence lizard's trunk sites)
#   monitor      Varanidae: the large lizards, way 'bask'
#   snake        the snake and amphisbaenian families (SNAKE_FAMILIES): way 'snake' (2026-11-06), a legless body on the
#                snake template (tools/build_snake.py; animals.js snUpdate): crawls on the ground, basks stretched out or
#                coiled, flees into cover. Its kin is the fence lizard (the machine's cells and sites), whose body a
#                snake never wears: a snake slot without a model of its own is not drawn (animals.js installFauna)
#   lizard       the other squamates, way 'bask' (rocks, trunks, the open ground beside them)
REPTILE_CLASSES = {"Reptilia", "Squamata", "Testudines", "Crocodylia", "Crocodilia", "Sauria"}
CROCODILIANS = {"Crocodylidae", "Alligatoridae", "Gavialidae"}
REPTILE_ARCHETYPE = {"crocodilian": "crocodilian", "tortoise": "tortoise", "turtle": "turtle", "chameleon": "chameleon",
                     "monitor": "monitor lizard", "lizard": "basking lizard", "snake": "snake"}
REPTILE_WAY = {"crocodilian": "water", "turtle": "water", "tortoise": "walk", "snake": "snake"}
# the lizards whose males bob and push up to display (the iguanians but the chameleons): the fence lizard's push-up bouts
# (animals.js PUSHUP); a skink or a monitor never does
PUSHUP_FAMILIES = {"Agamidae", "Iguanidae", "Phrynosomatidae", "Dactyloidae", "Tropiduridae", "Liolaemidae", "Crotaphytidae",
                   "Corytophanidae", "Leiocephalidae", "Opluridae", "Polychrotidae", "Hoplocercidae", "Leiosauridae"}


def reptile_group(tax: dict) -> str:
    cls, order, fam = tax.get("class"), tax.get("order"), tax.get("family")
    if cls in ("Crocodylia", "Crocodilia") or order in ("Crocodylia", "Crocodilia") or fam in CROCODILIANS:
        return "crocodilian"
    if cls == "Testudines" or order == "Testudines":
        return "tortoise" if fam == "Testudinidae" else "turtle"
    if fam in SNAKE_FAMILIES or order == "Serpentes":
        return "snake"
    if fam == "Chamaeleonidae":
        return "chameleon"
    if fam == "Varanidae":
        return "monitor"
    return "lizard"


def reptile_way(archetype: str) -> str:
    """The way the fence lizard's machine runs for a reptile slot (animals.js REPT): 'bask', 'water', 'walk' or 'snake'."""
    g = next((k for k, v in REPTILE_ARCHETYPE.items() if v == archetype), "lizard")
    return REPTILE_WAY.get(g, "bask")


from .fauna_models import model_for   # noqa: E402


def body_class(code: str, archetype: str | None, reptile, bird, t: dict | None = None) -> str | None:
    """The class of body a slot is drawn with when it has a model of its own or a template to build one (RESERVE_MAX):
    'snake', 'reptile:sprawl' or 'reptile:tortoise' (pipeline/fauna_models.py REPTILE_BUILD), 'bird:<build>' (BIRD_BUILD),
    'quadruped' (a mammal on four legs); a species whose model the library has, by its model's kind; else None."""
    from .fauna_models import REPTILE_BUILD, BIRD_BUILD
    mdl = model_for(code)
    if archetype == "snake":
        return "snake"
    if reptile and archetype in REPTILE_BUILD:
        return f"reptile:{REPTILE_BUILD[archetype]}"
    if bird and archetype in BIRD_BUILD:
        return f"bird:{BIRD_BUILD[archetype]}"
    t = t if t is not None else _traits(code)
    plan = (t.get("body_plan") or (t.get("locomotion") or {}).get("body_plan") or "").lower()
    if not bird and not reptile and plan == "quadruped":
        return "quadruped"
    return f"model:{mdl.get('kind')}" if mdl else None


# Where a snake lives on this tile (2026-11-06, the snake lane: the snakes ran the fence lizard's sites, open ground with
# rocks, so a forest-floor viper never spawned under Corcovado's canopy): its own records on the tile (GBIF, CC0 and CC BY
# only, as the density prior: derive.py) over the habitat raster (client/habitat.png), each class weighted by its share
# of the records against its share of the tile's land (the selection ratio), with HAB_PRIOR records' worth spread by area
# so a class with none keeps a little, the best class 1. Under HAB_MIN usable records, none: the client keeps its kin's
# table. The slot's `habitat_affinity` {class: weight}; animals.js reads it for the cells and the cell's spot.
HAB_MIN, HAB_PRIOR = 5, 2.0


def habitat_affinity(tile: Tile, scientific: str) -> dict | None:
    from PIL import Image
    from pyproj import Transformer
    from .fetch_species import match_key, occurrences
    from .derive import record_license_class, CLIENT_LICENSES
    png = tile.path("client/habitat.png")
    if not png.exists():
        return None
    try:
        key = match_key(scientific)
        recs = occurrences(tile, key) if key else []
    except Exception:
        return None
    im = Image.open(png).convert("L"); W, H = im.size; px = im.load()
    land = {}
    for j in range(H):
        for i in range(W):
            c = px[i, j]
            if c and c != 7:   # (7: open water)
                land[c] = land.get(c, 0) + 1
    if not land:
        return None
    x0, y0, x1, y1 = tile.bounds
    to = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    hits = {}
    for r in recs:
        if record_license_class(r.get("license")) not in CLIENT_LICENSES or r.get("decimalLongitude") is None:
            continue
        x, y = to.transform(r["decimalLongitude"], r["decimalLatitude"])
        i, j = int((x - x0) / (x1 - x0) * W), int((y1 - y) / (y1 - y0) * H)
        if 0 <= i < W and 0 <= j < H and px[i, j] in land:
            hits[px[i, j]] = hits.get(px[i, j], 0) + 1
    n = sum(hits.values())
    if n < HAB_MIN:
        return None
    area = sum(land.values())
    ratio = {c: ((hits.get(c, 0) + HAB_PRIOR * a / area) / (n + HAB_PRIOR)) / (a / area) for c, a in land.items()}
    top = max(ratio.values())
    return {"classes": {str(c): round(v / top, 3) for c, v in sorted(ratio.items())}, "records": n,
            "basis": "the species' CC0 and CC BY records on the tile over client/habitat.png: share of records / share of land"}


def static_codes() -> list[str]:
    """The curated client species: the `code:` of each entry in animals.js SPECIES."""
    src = ANIMALS_JS.read_text()
    block = src[src.index("const SPECIES = ["):src.index("];", src.index("const SPECIES = ["))]
    return sorted(set(re.findall(r"code: '([a-z_]+)'", block)))


def _traits(sid: str) -> dict:
    p = TRAITS / f"{sid}.json"
    return json.loads(p.read_text()) if p.exists() else {}


# ---- birds by way of life (2026-11-06) ---------------------------------------------------------------------------------
# By taxonomy alone a lapwing (a plover of open short grass) fell through to the Steller's jay and perched in trees, and the
# ostrich ran the turkey's machine and flushed into flight. A bird's kin is now chosen by what it does, from AVONET (Tobias
# et al. 2022, CC BY 4.0; pipeline/avonet.py):
#   flightless   a ratite or penguin family (FLIGHTLESS_FAMILIES), or a Hand-Wing Index under FLIGHTLESS_HWI (the
#                ratites' 0.1; a flying bird's is 5 or more but for a few rails): a ground kin (an aquatic one: the
#                waterbird's) whose escape is a run, never flight (the slot's `flightless`; animals.js)
#   guild        the families whose kin is their guild's own machine come next, whatever the lifestyle: the soaring
#                scavengers and raptors, owls, corvids, waders, waterbirds, gulls, kingfishers, woodpeckers
#   lifestyle    then AVONET's Primary.Lifestyle: Terrestrial a ground bird (quail or turkey machinery by mass: walks,
#                runs, flushes); Aquatic a waterbird; Aerial over the open sea (Habitat Marine) a gull, the
#                seabird on the wing; Insessorial, Generalist and the other Aerial a perching bird
#   taxonomy     a bird AVONET does not know falls back to the orders and families of the ground birds, else a perching bird
# Known misses: the flightless rails, the kakapo and the steamer ducks fly by these rules (their Hand-Wing Index is a
# flier's); a list of flightless species (Sayol et al. 2020) would catch them.
FLIGHTLESS_FAMILIES = {"Struthionidae", "Rheidae", "Casuariidae", "Dromaiidae", "Apterygidae", "Spheniscidae"}
FLIGHTLESS_HWI = 1.0
GROUND_ORDERS = {"Galliformes", "Tinamiformes", "Otidiformes", "Struthioniformes", "Rheiformes", "Casuariiformes",
                 "Apterygiformes"}
GROUND_FAMILIES = {"Numididae", "Phasianidae", "Cracidae", "Tinamidae", "Otididae", "Odontophoridae", "Megapodiidae"}
SEA_HABITATS = {"Marine"}


def bird_life(a: dict, t: dict) -> dict:
    """AVONET's lifestyle, Hand-Wing Index and habitat for a bird, and whether it flies: {lifestyle, hwi, habitat,
    flightless, source}."""
    from . import avonet
    tax = a.get("taxonomy") or t.get("taxonomy") or {}
    try:
        A = avonet.lookup(a.get("scientific") or t.get("scientific") or "")
    except Exception as e:   # noqa: BLE001 (no AVONET: the taxonomy alone)
        A = {"error": str(e)}
    fam = tax.get("family") or A.get("family")
    hwi = A.get("hwi")
    flightless = fam in FLIGHTLESS_FAMILIES or (hwi is not None and hwi < FLIGHTLESS_HWI)
    src = f"avonet ({A['level']})" if A.get("level") else "taxonomy"
    return {"lifestyle": A.get("lifestyle"), "hwi": hwi, "habitat": A.get("habitat"), "habitat_density": A.get("habitat_density"),
            "flightless": bool(flightless), "source": src}


def kin_for(a: dict, t: dict) -> tuple[str | None, str, list[str]]:
    """(kin code, archetype name, known errors) for an animal, or (None, why, []) when no stand-in fits."""
    tax = a.get("taxonomy") or t.get("taxonomy") or {}
    cls, order, fam = tax.get("class"), tax.get("order"), tax.get("family")
    m = float(a.get("mass_kg") or t.get("mass_kg") or 0) or None
    role = set(a.get("role") or (t.get("diet") or {}).get("role") or [])
    known: list[str] = []
    if cls == "Aves":
        life = bird_life(a, t)
        ls = life["lifestyle"]
        ground = "meleagris_gallopavo" if (m or 0) > 1.5 else "callipepla_californica"
        if life["flightless"]:
            if ls == "Aquatic" or fam == "Spheniscidae":
                return "mergus_merganser", "waterbird", ["a flightless swimmer on the merganser's machine"]
            if (m or 0) > 20:
                known.append("a giant flightless bird on the turkey's flock machine")
            return ground, "ground bird", known
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
        if fam == "Picidae":
            return "leuconotopicus_villosus", "woodpecker", known
        if ls == "Terrestrial":
            return ground, "ground bird", known
        if ls == "Aquatic":
            return "mergus_merganser", "waterbird", known
        if ls == "Aerial" and life["habitat"] in SEA_HABITATS:
            return "larus_glaucescens", "gull", ["a seabird on the gull's machine"]
        if not ls and (order in GROUND_ORDERS or fam in GROUND_FAMILIES):
            return ground, "ground bird", known
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
    if cls in REPTILE_CLASSES:
        group = reptile_group(tax)
        if group == "snake":   # the snake template (tools/build_snake.py), drawn only with its own model
            return "sceloporus_occidentalis", "snake", ["a snake on the fence lizard's cells, the snake machine (way 'snake'); "
                                                        "not drawn without a model of its own (no stand-in body)"]
        # every reptile runs the fence lizard's machine (its cells, sites and dash) on the reptile part rig; the slot's
        # `reptile` way (reptile_way) turns that machine into a basker, a water-bound crocodilian or a slow walker
        k = {"crocodilian": ["a crocodilian on the fence lizard's machine: at the water's edge and in the water (way 'water')"],
             "tortoise": ["a tortoise on the fence lizard's machine: a slow walker on the ground (way 'walk')"],
             "turtle": ["a turtle on the fence lizard's machine: at the water (way 'water')"]}.get(group, [])
        return "sceloporus_occidentalis", REPTILE_ARCHETYPE[group], k
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
    elif cls in REPTILE_CLASSES:
        # an allometric guess, inverse with mass as the carnivores' (a skink some 700 per km2, an agama 170, a monitor 14,
        # a leopard tortoise 3, a Nile crocodile 1, kept to its water by the slot's `water`)
        d = 30.0 * m ** -0.75
    else:
        d = 50.0
    return round(min(max(d, 0.005), 2000.0), 4)


# A ground bird's gait (2026-11-06): the kin's machine walks and runs at the kin's speeds and strides (a turkey's 0.55 m
# step under a 2.8 m ostrich); the slot carries its own from its trait card's locomotion row (pipeline/locomotion.py:
# the walk at Froude 0.5 of the hip height, the top speed by Garland 1983 capped by the hip, the stride at the trot-
# gallop change) over the kin's own, and the client scales the kin's speeds and strides by them (animals.js BGAIT).
GAIT_KINS = {"meleagris_gallopavo", "callipepla_californica"}


def gait(t: dict, kin: str) -> dict | None:
    from . import locomotion
    L = t.get("locomotion") or {}
    K = locomotion.resolve(kin) or {}
    if not (L.get("walk_mps") and L.get("stride_m") and K.get("walk_mps") and K.get("stride_m")):
        return None
    out = {k: L[k] for k in ("walk_mps", "cruise_mps", "top_mps", "stride_m", "sprint_s") if L.get(k)}
    out["speed_k"] = round(L["walk_mps"] / K["walk_mps"], 3)
    out["stride_k"] = round(L["stride_m"] / K["stride_m"], 3)
    out["source"] = f"trait card locomotion over {kin}'s (pipeline/locomotion.py)"
    return out


GROUP = {"grazing or browsing herd": [5, 30], "arboreal climber": [3, 15], "large ground primate (stand-in walker)": [5, 30],
         "coursing predator": [1, 6], "ambush predator": [1, 4], "waterbird": [2, 10], "wading bird": [1, 3],
         "ground bird": [3, 12], "soaring scavenger": [1, 8], "perching bird": [1, 6], "rock colony": [3, 12],
         "ground colony": [3, 12], "gull": [1, 6], "crocodilian": [1, 5], "tortoise": [1, 2], "turtle": [1, 4],
         "basking lizard": [1, 3], "monitor lizard": [1, 1], "chameleon": [1, 1], "snake": [1, 1]}


# ---- behaviour from traits (phase 1, iteration 3) ----------------------------------------------------------------------
# The stand-ins ran their kin's clock: every grazer bedded 9:30-16:30 like a mule deer, every big cat like a cougar. Now
# a slot carries its own day (24 hours, 1 = about), its rest posture and its group, from the traits:
#   diel weight per hour from EltonTraits' activity flags and PanTHERIA's activity cycle (1 nocturnal, 2 both, 3
#   diurnal); none known: a herbivore diurnal and crepuscular, a carnivore nocturnal and crepuscular;
#   the share of the day about from diet and mass: a herbivore feeds longer the larger it is (Owen-Smith 1988: about half
#   the day for a 50 kg antelope, three quarters for an elephant), 0.35 + 0.1 log10(kg), 0.4-0.75; a carnivore rests
#   most of the day, 0.45 - 0.07 log10(kg), 0.15-0.45 (a lion about 0.3: lions rest 18-20 h); a bird or other 0.5;
#   the hours about: the highest-weighted hours of the day up to that share (the midday heat weighs a little less);
#   rest posture: lying, except the very large on land (over 800 kg: elephants, giraffes and rhinos sleep standing most
#   nights; a hippo lies in the water);
#   group: Prox and Farine 2020's average group size (a fission-fusion society seen in subgroups), else PanTHERIA's social
#   group size g (species, else genus median) as [sqrt(g), g] up to 30, else the archetype's.
DIURNAL = [0.0] * 5 + [0.5, 1, 1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1, 0.5] + [0.0] * 5
CREPUSCULAR = [0, 0, 0, 0, 0.3, 1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0.3, 0, 0, 0]
NOCTURNAL = [1, 1, 1, 1, 1, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 1, 1, 1, 1]
REST_STANDING_KG = 800


def behaviour(a: dict, t: dict, mass_kg: float, archetype: str) -> dict:
    from . import pantheria
    flags = set((t.get("diet") or {}).get("activity") or [])
    role = set(a.get("role") or [])
    carn = "predator" in role or "scavenger" in role
    P = pantheria.lookup(a.get("scientific") or "") if a.get("kind") == "mammal" else {}
    cyc = P.get("activity")
    if not flags and cyc:
        flags = {1: {"nocturnal"}, 2: {"crepuscular", "nocturnal", "diurnal"}, 3: {"diurnal"}}.get(int(round(cyc)), set())
    if not flags:
        flags = {"nocturnal", "crepuscular"} if carn else {"diurnal", "crepuscular"}
    w = [0.0] * 24
    for f, row in (("diurnal", DIURNAL), ("crepuscular", CREPUSCULAR), ("nocturnal", NOCTURNAL)):
        if f in flags:
            w = [x + y for x, y in zip(w, row)]
    lm = math.log10(max(mass_kg, 0.01))
    share = (min(0.45, max(0.15, 0.45 - 0.07 * lm)) if carn else min(0.75, max(0.4, 0.35 + 0.1 * lm))) \
        if a.get("kind") == "mammal" else 0.5
    n = max(3, round(24 * share))
    # ties: nearer dawn (6) or dusk (18.5) first, so a short day keeps the twilights
    order = sorted(range(24), key=lambda h: (-w[h], min(abs(h - 6), abs(h - 18.5))))
    hours = [0] * 24
    for h in order[:n]:
        hours[h] = 1
    water = (a.get("taxonomy") or {}).get("family") in WATER_FAMILIES
    out = {"active_hours": hours, "rest": "stand" if mass_kg >= REST_STANDING_KG and a.get("kind") == "mammal" and not water else "lie",
           "behaviour_sources": ["eltontraits (activity)"] + (["pantheria"] if P else [])}
    from . import sociality
    soc = sociality.lookup(a.get("scientific") or "") if a.get("kind") == "mammal" else None
    g = P.get("group")
    if soc and soc.get("group"):
        # Prox and Farine 2020 (CC BY): the society's average group size; a fission-fusion society (a pride, a clan, an
        # elephant family) is seen in its subgroups, [g^0.5, g^0.75]; a cohesive one (a pack, a coalition) whole, [g/2, g]
        gs = soc["group"]
        lo, hi = (gs ** 0.5, gs ** 0.75) if soc.get("fission_fusion") else (gs / 2, gs)
        hi = max(1, min(30, round(hi)))
        out["group"] = [max(1, min(hi, round(lo))), hi]
        out["group_source"] = f"prox2020 average group size {gs:g}" + (" (fission-fusion)" if soc.get("fission_fusion") else "")
    elif g:
        out["group"] = [max(1, round(g ** 0.5)), max(1, min(30, round(g)))]
        out["group_source"] = f"pantheria social group size ({P.get('group_level')})"
    elif P.get("population_group") == 1 and P.get("population_group_level") == "species":   # (not a genus median: the lion)
        out["group"], out["group_source"] = [1, 1], "pantheria: solitary"
    if P.get("density_km2") and P.get("density_km2_level") == "species":
        out["density_km2"], out["density_source"] = round(P["density_km2"], 3), "pantheria population density (species)"
    return out


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
    # then birds, two rankings taken in turn: by records x sqrt(mass), as the mammals (the big birds seen from afar: a
    # vulture, an ostrich, a stork; by records alone the Serengeti's eleven bird slots were all starlings, weavers and a
    # barbet, and no vulture), and by records (the common small birds seen near); then the rest
    def mass(a):
        return float(a.get("mass_kg") or _traits(a["id"]).get("mass_kg") or 1)
    def visible(a):
        return (a.get("records") or 0) * (mass(a) ** 0.5 if a.get("kind") in ("mammal", "bird") else 1)
    rest_ = [a for a in listed if a["id"] not in codes]
    birds_big = sorted((a for a in rest_ if a.get("kind") == "bird"), key=lambda a: -visible(a))
    birds_common = sorted((a for a in rest_ if a.get("kind") == "bird"), key=lambda a: -(a.get("records") or 0))
    birds, seen_ = [], set()
    for pair in zip(birds_big, birds_common):
        for a in pair:
            if a["id"] not in seen_: seen_.add(a["id"]); birds.append(a)
    order = sorted((a for a in rest_ if a.get("kind") == "mammal"), key=lambda a: -visible(a)) + birds + \
        sorted((a for a in rest_ if a.get("kind") not in ("mammal", "bird")), key=lambda a: -visible(a))
    eco = tile.path("vegetation/ecosystem.json")
    efg = (json.loads(eco.read_text()).get("groups") or [{}])[0].get("code") if eco.exists() else None
    def make(a, t, kin, archetype, known):
        m = float(a.get("mass_kg") or t.get("mass_kg") or KIN_MASS[kin])
        # (to 20: a Nile crocodile is 18 fence lizards long; the client clamps at 20 too)
        scale = round(min(max((m / KIN_MASS[kin]) ** (1 / 3), 0.25), 20.0), 3)
        act = set((t.get("diet") or {}).get("activity") or [])
        fam = (a.get("taxonomy") or {}).get("family")
        name = (a.get("common") or a["scientific"]).strip()
        slots.append({
            "code": a["id"], "scientific": a["scientific"], "common": name[:1].upper() + name[1:], "one": name.lower(),
            "many": name.lower() + ("" if name.endswith("s") else "s"), "kin": kin, "archetype": archetype,
            "scale": scale, "tint": None, "mass_kg": round(m, 3), "density_km2": density_km2({**a, "mass_kg": m}, kin, archetype),
            "group": GROUP.get(archetype, [1, 3]), "bird": a.get("kind") == "bird",
            "night": "nocturnal" in act and "diurnal" not in act, "water": fam in WATER_FAMILIES or kin == "lontra_canadensis",
            "role": a.get("role") or [], "known": known, **({"family": fam} if fam else {})})   # (family: a snake's strike, venomous or not: strikes.js)
        if (a.get("taxonomy") or {}).get("class") in REPTILE_CLASSES:
            slots[-1]["reptile"] = reptile_way(archetype)   # the lizard machine's way: bask, water or walk (animals.js REPT)
            if slots[-1]["reptile"] == "snake":   # where on the tile it lives, from its own records (habitat_affinity)
                aff = habitat_affinity(tile, a["scientific"])
                if aff:
                    slots[-1]["habitat_affinity"] = aff
            slots[-1]["records"] = a.get("records") or 0   # (pipeline/fauna_models.py ranks the reptiles by records x sqrt(mass))
            if fam in PUSHUP_FAMILIES:
                slots[-1]["pushup"] = True
            if (t.get("generated") or {}).get("from") and len(t["generated"]["from"]) > 1:
                slots[-1]["mass_source"] = t["generated"]["from"][1]
        if a.get("kind") == "bird" or (a.get("taxonomy") or {}).get("class") == "Aves":
            life = bird_life(a, t)
            slots[-1].update({"flightless": life["flightless"], "lifestyle": life["lifestyle"], "kin_source": life["source"]})
            if life["hwi"] is not None:
                slots[-1]["hand_wing_index"] = life["hwi"]
            if life["habitat"]:   # AVONET's habitat and its density (1 dense, 2 semi-open, 3 open): where a ground bird forages
                slots[-1]["habitat"] = life["habitat"]
            if life["habitat_density"]:
                slots[-1]["habitat_density"] = int(life["habitat_density"])
            g = gait(t, kin) if kin in GAIT_KINS else None
            if g:
                slots[-1]["gait"] = g
        mdl = model_for(a["id"])   # a body of its own from the library (pipeline/fauna_models.py), drawn at its real size
        if mdl:
            slots[-1]["model"] = mdl
        slots[-1]["density_km2"] = density_km2({**a, "mass_kg": m}, kin, archetype, efg)
        slots[-1].update(behaviour(a, t, m, archetype))   # its own day, rest, group and (measured) density
        return slots[-1]

    slots, skipped, capped = [], [], []
    n_main = n_other = 0
    for a in order:
        other = a.get("kind") not in ("mammal", "bird")
        if (n_other >= MAX_OTHER) if other else (n_main >= MAX_SLOTS):
            capped.append((a, other))
            continue
        t = _traits(a["id"])
        kin, archetype, known = kin_for(a, t)
        if not kin:
            skipped.append({"id": a["id"], "why": archetype})
            continue
        if other:
            n_other += 1
        else:
            n_main += 1
        make(a, t, kin, archetype, known)
    # the classes of body the caps left out (RESERVE_MAX above them): the first of each, by the same ranking
    covered = {body_class(s["code"], s.get("archetype"), s.get("reptile"), s.get("bird")) for s in slots} - {None}
    for a, other in capped:
        t = _traits(a["id"])
        kin, archetype, known = kin_for(a, t)
        cls = body_class(a["id"], archetype, (a.get("taxonomy") or {}).get("class") in REPTILE_CLASSES, a.get("kind") == "bird", t) if kin else None
        if cls and cls not in covered and sum(1 for s in slots if s.get("reserved")) < RESERVE_MAX:
            covered.add(cls)
            make(a, t, kin, archetype, known)["reserved"] = f"the first {cls} over the cap (RESERVE_MAX)"
            continue
        skipped.append({"id": a["id"], "why": f"over the {MAX_OTHER if other else MAX_SLOTS}-slot cap"})
    out = {"format": 1, "gate": True, "allow": allow, "slots": slots, "skipped": skipped,
           "rules": "pipeline/fauna_slots.py: kin by taxonomy, diet and mass (a bird's by AVONET's lifestyle and flightlessness); scale = (mass / kin mass)^(1/3), 0.25-4; density "
                    "Damuth 1981 (herbivores; large ones times HERBIVORE_PRODUCTIVITY of the tile's ecosystem), 30 / mass kg "
                    "(carnivores), birds 15 m^-0.4 (cap 70) or 0.5 m^-0.75 (raptors), or PanTHERIA's measured density; behaviour() for "
                    "the hours about, rest posture and group", "ecosystem": efg}
    write_json(tile.path("client/fauna.json"), out)
    return {"path": "client/fauna.json", "kind": "table", "derived_from": ["species.animals", "species.presence"],
            "allow": len(allow), "slots": len(slots), "skipped": len(skipped),
            "stand_ins": {s["code"]: s["kin"] for s in slots[:12]}}
