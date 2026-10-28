"""Curated demo species, perception matrix and seasonal activity calendar.

Senses are rough order-of-magnitude detection ranges for a first pass; they are
meant to be tuned in the viewer, not trusted.
"""

SPECIES = [
    # playable
    {"code": "corvus_corax", "common": "common raven", "scientific": "Corvus corax",
     "group": "bird", "role": "playable", "scale": "bird",
     "senses": {"vision": {"range_m": 1500, "color": "tetrachromat"},
                "hearing": {"range_m": 500}, "smell": {"range_m": 50}}},
    {"code": "buteo_jamaicensis", "common": "red-tailed hawk", "scientific": "Buteo jamaicensis",
     "group": "bird", "role": "playable", "scale": "bird",
     "senses": {"vision": {"range_m": 2000, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    {"code": "odocoileus_hemionus", "common": "black-tailed deer", "scientific": "Odocoileus hemionus",
     "group": "mammal", "role": "playable", "scale": "deer",
     "senses": {"vision": {"range_m": 400, "color": "dichromat"},
                "hearing": {"range_m": 600}, "smell": {"range_m": 800}}},
    {"code": "urocyon_cinereoargenteus", "common": "gray fox", "scientific": "Urocyon cinereoargenteus",
     "group": "mammal", "role": "playable", "scale": "fox",
     "senses": {"vision": {"range_m": 300, "color": "dichromat"},
                "hearing": {"range_m": 400}, "smell": {"range_m": 600}}},
    {"code": "sciurus_griseus", "common": "western gray squirrel", "scientific": "Sciurus griseus",
     "group": "mammal", "role": "playable", "scale": "squirrel",
     "senses": {"vision": {"range_m": 150, "color": "dichromat"},
                "hearing": {"range_m": 200}, "smell": {"range_m": 100}}},
    {"code": "melanerpes_formicivorus", "common": "acorn woodpecker", "scientific": "Melanerpes formicivorus",
     "group": "bird", "role": "playable", "scale": "bird",
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"},
                "hearing": {"range_m": 400}, "smell": {"range_m": 20}}},
    # ambient
    {"code": "callipepla_californica", "common": "California quail", "scientific": "Callipepla californica",
     "group": "bird", "role": "ambient", "scale": "bird",
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    # the Sierra's own quail, above the California quail's foothills: mountain chaparral, brushy forest edges and the
    # shrubby understory of mixed and conifer forest, 600-3,000 m; coveys of 6-12 that walk downslope below the snow in
    # fall and back up in spring; heard far more than seen (the male's "quee-ark" in spring)
    {"code": "oreortyx_pictus", "common": "mountain quail", "scientific": "Oreortyx pictus",
     "group": "bird", "role": "ambient", "scale": "bird",
     "habitat": {"chaparral": 1.0, "mixed": 0.8, "conifer": 0.5, "riparian": 0.55, "oak_woodland": 0.35},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    {"code": "aphelocoma_californica", "common": "California scrub-jay", "scientific": "Aphelocoma californica",
     "group": "bird", "role": "ambient", "scale": "bird",
     "senses": {"vision": {"range_m": 400, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    # conifer and mixed forest; the scrub-jay's counterpart above the oak belt
    {"code": "cyanocitta_stelleri", "common": "Steller's jay", "scientific": "Cyanocitta stelleri",
     "group": "bird", "role": "ambient", "scale": "bird",
     "senses": {"vision": {"range_m": 400, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    # smell is real here: turkey vultures find carrion under canopy by scent
    {"code": "cathartes_aura", "common": "turkey vulture", "scientific": "Cathartes aura",
     "group": "bird", "role": "ambient", "scale": "bird",
     "senses": {"vision": {"range_m": 2500, "color": "tetrachromat"},
                "hearing": {"range_m": 200}, "smell": {"range_m": 1500}}},
    {"code": "sylvilagus_bachmani", "common": "brush rabbit", "scientific": "Sylvilagus bachmani",
     "group": "mammal", "role": "ambient", "scale": "squirrel",
     "senses": {"vision": {"range_m": 200, "color": "dichromat"},
                "hearing": {"range_m": 400}, "smell": {"range_m": 200}}},
    # open grassland, savanna and pasture; far more records in the tiles than the brush rabbit (14-17 against 1).
    # gbif_key pins the taxon (fetch_species otherwise matches the name); habitat: suitability by habitat class
    # (pipeline/habitat.py codes), as the client's animals.js SUIT, times openness there
    {"code": "lepus_californicus", "common": "black-tailed jackrabbit", "scientific": "Lepus californicus",
     "group": "mammal", "role": "ambient", "scale": "squirrel", "gbif_key": 2436801,
     "habitat": {"oak_woodland": 0.45, "mixed": 0.05, "chaparral": 0.25, "grassland": 1.0, "riparian": 0.15,
                 "barren": 0.3, "human": 0.9},
     "senses": {"vision": {"range_m": 300, "color": "dichromat"},
                "hearing": {"range_m": 500}, "smell": {"range_m": 200}}},
    {"code": "microtus_californicus", "common": "California vole", "scientific": "Microtus californicus",
     "group": "mammal", "role": "ambient", "scale": "vole",
     "senses": {"vision": {"range_m": 30, "color": "dichromat"},
                "hearing": {"range_m": 100}, "smell": {"range_m": 50}}},
    {"code": "canis_latrans", "common": "coyote", "scientific": "Canis latrans",
     "group": "mammal", "role": "ambient", "scale": "fox",
     "senses": {"vision": {"range_m": 400, "color": "dichromat"},
                "hearing": {"range_m": 800}, "smell": {"range_m": 1500}}},
    {"code": "puma_concolor", "common": "mountain lion", "scientific": "Puma concolor",
     "group": "mammal", "role": "ambient", "scale": "deer",
     "senses": {"vision": {"range_m": 500, "color": "dichromat"},
                "hearing": {"range_m": 600}, "smell": {"range_m": 500}}},
    # the Sierra's only bear: conifer and mixed forest, riparian woodland and chaparral, down to the foothill oaks for
    # acorns in fall; dens December-March; an omnivore that hunts nothing here but comes to carrion from far off. Its nose
    # is its sense (kilometres downwind); eyes and ears middling.
    {"code": "ursus_americanus", "common": "American black bear", "scientific": "Ursus americanus",
     "group": "mammal", "role": "ambient", "scale": "deer", "gbif_key": 2433407,
     "habitat": {"oak_woodland": 0.6, "conifer": 1.0, "mixed": 1.0, "chaparral": 0.8, "riparian": 0.8},
     "senses": {"vision": {"range_m": 200, "color": "dichromat"},
                "hearing": {"range_m": 500}, "smell": {"range_m": 2000}}},
    # oak woodland and savanna in flocks of 6-15 (larger in winter), roosting in tall oaks and pines at night;
    # active all year. The Sierra foothill birds are introduced stock (Rio Grande and Merriam's, 1950s-80s).
    {"code": "meleagris_gallopavo", "common": "wild turkey", "scientific": "Meleagris gallopavo",
     "group": "bird", "role": "ambient", "scale": "deer", "gbif_key": 9606290,
     "habitat": {"oak_woodland": 1.0, "conifer": 0.2, "mixed": 0.6, "chaparral": 0.2, "grassland": 0.55,
                 "riparian": 0.7, "human": 0.5},
     "senses": {"vision": {"range_m": 400, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    # colonial burrows in grassland and savanna with low shrub cover; diurnal, above ground March-November
    # (adults hibernate or stay below through the coldest weeks), a sentinel upright at the burrow mouth
    {"code": "otospermophilus_beecheyi", "common": "California ground squirrel", "scientific": "Otospermophilus beecheyi",
     "group": "mammal", "role": "ambient", "scale": "squirrel", "gbif_key": 8080937,
     "habitat": {"oak_woodland": 0.6, "chaparral": 0.25, "grassland": 1.0, "riparian": 0.3, "barren": 0.3,
                 "human": 0.9},
     "senses": {"vision": {"range_m": 300, "color": "dichromat"},
                "hearing": {"range_m": 150}, "smell": {"range_m": 50}}},
    # the commonest lizard of the foothills: rock outcrops, trunk bases, fences and sunny open ground; diurnal,
    # March-October, basks, hides under ~15 C air. No reptile class in the inventory (CLASS_KEYS) yet.
    {"code": "sceloporus_occidentalis", "common": "western fence lizard", "scientific": "Sceloporus occidentalis",
     "group": "reptile", "role": "ambient", "scale": "vole", "gbif_key": 2451234,
     "habitat": {"oak_woodland": 1.0, "conifer": 0.5, "mixed": 0.8, "chaparral": 0.9, "grassland": 0.5,
                 "riparian": 0.4, "barren": 0.8, "human": 0.8},
     "senses": {"vision": {"range_m": 30, "color": "tetrachromat"},
                "hearing": {"range_m": 10}, "smell": {"range_m": 2}}},
]

ALL = [s["code"] for s in SPECIES]

# Where each species can live, for the presence rule (fetch_species.presence): an elevation band (m) and the habitat
# classes (habitat.py CLASSES) it uses there. The bands are the central Sierra Nevada west slope's, from Grinnell and
# Storer, Animal Life in the Yosemite (1924), which walked a transect from the San Joaquin valley over Yosemite to Mono
# Lake and gave each species its life zones: Lower Sonoran below ~300 m, Upper Sonoran (foothill woodland and
# chaparral) to ~1200 m, Transition (the yellow pine belt; Yosemite Valley's floor, 1200 m) to ~2000 m, Canadian to
# ~2500 m, Hudsonian to ~3200 m. Where the book gives a limit it is used: the brush rabbit "to altitude of 4000 feet"
# north of El Portal (1220 m); the California vole east to El Portal and Cascades (3600 ft, 1100 m); the
# black-tailed jackrabbit Lower and Upper Sonoran on the west slope; the gray fox Upper Sonoran and Transition, east
# to the floor of Yosemite Valley, chiefly in chaparral; the mountain lion Sonoran, Transition and Canadian; the
# ground squirrel's highest record 8200 ft (2500 m). The others are coarse (whole slope for the wide-ranging ones). The
# black bear's band (800-3000 m: the conifer belt, with the oak woodland it comes down to in fall) is this project's
# estimate, not the book's; it keeps the bear off the foothill tiles and on the Yosemite one. The mountain quail (the
# book's "plumed quail", Transition and Canadian zones, coming down into the upper chaparral in winter): 600-3000 m on
# chaparral and the mixed and conifer forest (whose brushy edges and understory it keeps to), so the foothill tiles
# have it only where their records put it.
# A band says where the species can be, not that it is: the records decide first, the band only keeps a species the
# records miss (a cryptic or nocturnal one, on a tile few people watch). Other regions need their own bands.
_ALL_HAB = ["oak_woodland", "conifer_forest", "mixed_forest", "chaparral", "grassland", "riparian", "barren"]
RANGE = {
    "corvus_corax":             {"elev_m": [0, 4000], "habitats": _ALL_HAB},
    "buteo_jamaicensis":        {"elev_m": [0, 3500], "habitats": _ALL_HAB},
    "odocoileus_hemionus":      {"elev_m": [0, 3500], "habitats": _ALL_HAB},
    "urocyon_cinereoargenteus": {"elev_m": [0, 2000], "habitats": ["chaparral", "oak_woodland", "mixed_forest", "conifer_forest", "riparian"]},
    "sciurus_griseus":          {"elev_m": [0, 2000], "habitats": ["oak_woodland", "mixed_forest", "conifer_forest", "riparian"]},
    "melanerpes_formicivorus":  {"elev_m": [0, 2000], "habitats": ["oak_woodland", "mixed_forest", "riparian"]},
    "callipepla_californica":   {"elev_m": [0, 1500], "habitats": ["grassland", "chaparral", "oak_woodland", "riparian"]},
    "aphelocoma_californica":   {"elev_m": [0, 1500], "habitats": ["oak_woodland", "chaparral", "riparian", "mixed_forest"]},
    "cyanocitta_stelleri":      {"elev_m": [300, 3000], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "cathartes_aura":           {"elev_m": [0, 3000], "habitats": _ALL_HAB},
    "sylvilagus_bachmani":      {"elev_m": [0, 1220], "habitats": ["chaparral", "oak_woodland", "riparian"]},
    "lepus_californicus":       {"elev_m": [0, 1200], "habitats": ["grassland", "oak_woodland", "chaparral"]},
    "microtus_californicus":    {"elev_m": [0, 1100], "habitats": ["grassland", "riparian", "oak_woodland"]},
    "canis_latrans":            {"elev_m": [0, 3500], "habitats": _ALL_HAB},
    "puma_concolor":            {"elev_m": [0, 2500], "habitats": ["oak_woodland", "conifer_forest", "mixed_forest", "chaparral", "riparian", "barren"]},
    "meleagris_gallopavo":      {"elev_m": [0, 1500], "habitats": ["oak_woodland", "mixed_forest", "grassland", "riparian"]},
    "otospermophilus_beecheyi": {"elev_m": [0, 2500], "habitats": ["grassland", "oak_woodland", "chaparral", "riparian", "barren"]},
    "sceloporus_occidentalis":  {"elev_m": [0, 2700], "habitats": ["oak_woodland", "conifer_forest", "mixed_forest", "chaparral", "grassland", "riparian", "barren"]},
    "ursus_americanus":         {"elev_m": [800, 3000], "habitats": ["conifer_forest", "mixed_forest", "chaparral", "riparian", "oak_woodland"]},
    "oreortyx_pictus":          {"elev_m": [600, 3000], "habitats": ["chaparral", "mixed_forest", "conifer_forest"]},
}

# Who exists for whom, wherever both live. A species absent from a player's list is not rendered for them; on a tile the
# species step keeps only the species present there (fetch_species.presence, perceives_on).
PERCEPTION = {
    "corvus_corax": ALL,
    "buteo_jamaicensis": [c for c in ALL if c != "puma_concolor"],
    "odocoileus_hemionus": ["odocoileus_hemionus", "puma_concolor", "canis_latrans",
                            "urocyon_cinereoargenteus", "corvus_corax", "buteo_jamaicensis",
                            "sciurus_griseus", "callipepla_californica", "cathartes_aura",
                            "meleagris_gallopavo", "otospermophilus_beecheyi"],
    "urocyon_cinereoargenteus": ALL,
    "sciurus_griseus": ["sciurus_griseus", "buteo_jamaicensis", "urocyon_cinereoargenteus",
                        "canis_latrans", "corvus_corax", "odocoileus_hemionus",
                        "sylvilagus_bachmani", "lepus_californicus", "callipepla_californica",
                        "melanerpes_formicivorus", "aphelocoma_californica", "cyanocitta_stelleri",
                        "cathartes_aura", "meleagris_gallopavo", "otospermophilus_beecheyi",
                        "sceloporus_occidentalis"],
    "melanerpes_formicivorus": ["melanerpes_formicivorus", "buteo_jamaicensis", "corvus_corax",
                                "sciurus_griseus", "aphelocoma_californica", "urocyon_cinereoargenteus",
                                "canis_latrans", "callipepla_californica", "odocoileus_hemionus",
                                "lepus_californicus", "cyanocitta_stelleri", "cathartes_aura",
                                "meleagris_gallopavo", "otospermophilus_beecheyi", "sceloporus_occidentalis"],
    "aphelocoma_californica": ["aphelocoma_californica", "buteo_jamaicensis", "corvus_corax",
                               "sciurus_griseus", "melanerpes_formicivorus", "urocyon_cinereoargenteus",
                               "canis_latrans", "callipepla_californica", "cyanocitta_stelleri",
                               "cathartes_aura", "meleagris_gallopavo", "otospermophilus_beecheyi",
                               "sceloporus_occidentalis", "oreortyx_pictus"],
    "cyanocitta_stelleri": ["cyanocitta_stelleri", "buteo_jamaicensis", "corvus_corax",
                            "sciurus_griseus", "melanerpes_formicivorus", "aphelocoma_californica",
                            "urocyon_cinereoargenteus", "canis_latrans", "cathartes_aura", "oreortyx_pictus"],
    "cathartes_aura": ["cathartes_aura", "corvus_corax", "buteo_jamaicensis", "odocoileus_hemionus",
                       "canis_latrans", "puma_concolor", "urocyon_cinereoargenteus"],
    "callipepla_californica": ["callipepla_californica", "buteo_jamaicensis",
                               "urocyon_cinereoargenteus", "canis_latrans", "corvus_corax",
                               "sylvilagus_bachmani", "odocoileus_hemionus"],
    "sylvilagus_bachmani": ["sylvilagus_bachmani", "urocyon_cinereoargenteus", "canis_latrans",
                            "buteo_jamaicensis", "corvus_corax", "callipepla_californica",
                            "odocoileus_hemionus", "lepus_californicus"],
    "lepus_californicus": ["lepus_californicus", "sylvilagus_bachmani", "urocyon_cinereoargenteus",
                           "canis_latrans", "puma_concolor", "buteo_jamaicensis", "corvus_corax",
                           "callipepla_californica", "odocoileus_hemionus"],
    "microtus_californicus": ["microtus_californicus", "urocyon_cinereoargenteus",
                              "canis_latrans", "buteo_jamaicensis", "corvus_corax"],
    "canis_latrans": ALL,
    "puma_concolor": ["puma_concolor", "odocoileus_hemionus", "canis_latrans",
                      "urocyon_cinereoargenteus", "sylvilagus_bachmani", "lepus_californicus", "sciurus_griseus",
                      "callipepla_californica", "corvus_corax", "meleagris_gallopavo",
                      "otospermophilus_beecheyi", "oreortyx_pictus"],
    "meleagris_gallopavo": ["meleagris_gallopavo", "odocoileus_hemionus", "canis_latrans",
                            "urocyon_cinereoargenteus", "puma_concolor", "buteo_jamaicensis",
                            "corvus_corax", "callipepla_californica", "sciurus_griseus",
                            "otospermophilus_beecheyi"],
    "otospermophilus_beecheyi": ["otospermophilus_beecheyi", "buteo_jamaicensis", "corvus_corax",
                                 "canis_latrans", "urocyon_cinereoargenteus", "puma_concolor",
                                 "odocoileus_hemionus", "meleagris_gallopavo", "callipepla_californica",
                                 "lepus_californicus", "sceloporus_occidentalis"],
    "sceloporus_occidentalis": ["sceloporus_occidentalis", "buteo_jamaicensis", "corvus_corax",
                                "aphelocoma_californica", "urocyon_cinereoargenteus", "canis_latrans",
                                "otospermophilus_beecheyi", "meleagris_gallopavo", "sciurus_griseus"],
    "ursus_americanus": ["ursus_americanus", "odocoileus_hemionus", "canis_latrans", "puma_concolor", "corvus_corax",
                         "sciurus_griseus"],
    # the mountain quail sees its hunters (the hawk, the raven, the fox, the coyote, the lion), the jays whose alarms it
    # heeds, and the big animals about it; the raven, fox and coyote (ALL), the hawk, the lion and the jays see it
    "oreortyx_pictus": ["oreortyx_pictus", "buteo_jamaicensis", "corvus_corax", "urocyon_cinereoargenteus",
                        "canis_latrans", "puma_concolor", "aphelocoma_californica", "cyanocitta_stelleri",
                        "odocoileus_hemionus", "sciurus_griseus", "callipepla_californica"],
}
# Everyone sees the bear (a big animal that goes where it likes): added to every row that does not list it already.
for _row in PERCEPTION.values():
    if "ursus_americanus" not in _row:
        _row.append("ursus_americanus")


def perceives_on(present) -> dict[str, list[str]]:
    """PERCEPTION on a tile: rows only for the species present there (an absent one cannot be played), each row
    filtered to the present species."""
    present = set(present)
    return {o: [c for c in row if c in present] for o, row in PERCEPTION.items() if o in present}


SEASONS = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "fall": [9, 10, 11]}


def act(activity, *resources, goal=None):
    d = {"activity": activity, "resources": list(resources)}
    if goal:
        d["goal"] = goal
    return d


CALENDAR = {
    "corvus_corax": {
        "winter": [act("forage", "carrion", "puma_concolor", goal="follow predators to kills"),
                   act("court", "cliff_or_snag", goal="pair up before nesting")],
        "spring": [act("nest", "cliff_or_snag", goal="build a stick nest"),
                   act("rear", "insects", "small_mammals", goal="feed nestlings")],
        "summer": [act("forage", "insects", "carrion"), act("rear", "cover", goal="fledglings")],
        "fall": [act("forage", "acorn_mast"), act("cache", "acorn_mast", goal="hide food from other ravens")],
    },
    "buteo_jamaicensis": {
        "winter": [act("hunt", "microtus_californicus", "sylvilagus_bachmani", "lepus_californicus",
                       goal="hunt from perches")],
        "spring": [act("court", goal="sky dance"), act("nest", "cliff_or_snag", goal="large tree or cliff")],
        "summer": [act("rear", "sciurus_griseus", "otospermophilus_beecheyi", "sylvilagus_bachmani",
                       "microtus_californicus", "sceloporus_occidentalis", goal="feed chicks")],
        "fall": [act("disperse", goal="juveniles leave the territory"),
                 act("hunt", "microtus_californicus", "sciurus_griseus")],
    },
    "odocoileus_hemionus": {
        "winter": [act("forage", "browse"), act("shelter", "cover", goal="avoid storms and lions")],
        "spring": [act("forage", "grass_forbs"), act("rear", "cover", "water", goal="fawn in dense cover")],
        "summer": [act("forage", "browse", "water"), act("shelter", "cover", goal="rest in shade midday")],
        "fall": [act("court", goal="rut"), act("forage", "acorn_mast", goal="fatten before winter")],
    },
    "urocyon_cinereoargenteus": {
        "winter": [act("court", goal="breeding season"), act("hunt", "microtus_californicus", "sylvilagus_bachmani")],
        "spring": [act("den", "burrow", "cover", goal="den in a hollow or rock pile"),
                   act("rear", "small_mammals")],
        "summer": [act("hunt", "small_mammals", "insects"), act("rear", goal="teach kits to hunt")],
        "fall": [act("forage", "acorn_mast", goal="fruit and acorns"), act("disperse", goal="kits leave")],
    },
    "sciurus_griseus": {
        "winter": [act("forage", "acorn_mast", goal="recover caches"), act("shelter", "cavity")],
        "spring": [act("court", goal="mating chases"), act("nest", "cavity", goal="dray or cavity")],
        "summer": [act("forage", "insects", "browse"), act("rear")],
        "fall": [act("cache", "acorn_mast", goal="scatter-hoard acorns before rain")],
    },
    "melanerpes_formicivorus": {
        "winter": [act("forage", "acorn_mast", goal="eat acorns cached in the granary"),
                   act("shelter", "cavity", goal="roost in tree cavities")],
        "spring": [act("nest", "cavity", goal="excavate or reuse a cavity, nest cooperatively"),
                   act("court", goal="drumming and wakka calls")],
        "summer": [act("forage", "insects", goal="flycatch from snags"), act("rear", "insects", goal="feed nestlings")],
        "fall": [act("forage", "acorn_mast"),
                 act("cache", "acorn_mast", "cliff_or_snag", goal="store acorns in granary holes in a snag or oak")],
    },
    "aphelocoma_californica": {
        "winter": [act("forage", "acorn_mast", goal="recover buried acorns"), act("shelter", "cover")],
        "spring": [act("court"), act("nest", "cover", goal="cup nest in a shrub or small oak")],
        "summer": [act("rear", "insects", "cover"), act("forage", "insects")],
        "fall": [act("forage", "acorn_mast"),
                 act("cache", "acorn_mast", goal="scatter-hoard acorns in the ground, one at a time")],
    },
    "cyanocitta_stelleri": {
        "winter": [act("forage", "acorn_mast", goal="recover cached acorns in conifer and mixed forest")],
        "spring": [act("nest", "cover", goal="bulky nest in a young conifer"), act("court")],
        "summer": [act("rear", "insects", goal="feed nestlings")],
        "fall": [act("forage", "acorn_mast"),
                 act("cache", "acorn_mast", goal="carry acorns up from the oaks and hoard them under the conifers")],
    },
    "cathartes_aura": {
        "winter": [act("forage", "carrion", goal="soar and sniff out carcasses")],
        "spring": [act("forage", "carrion"), act("court", goal="ground display, wings spread")],
        "summer": [act("forage", "carrion"),
                   act("rear", "cliff_or_snag", "cavity", goal="raise chicks in a cliff or snag cavity, no nest built")],
        "fall": [act("forage", "carrion", goal="roost communally on snags")],
    },
    "callipepla_californica": {
        "winter": [act("forage", "grass_forbs", goal="coveys")],
        "spring": [act("court"), act("nest", "cover")],
        "summer": [act("rear", "insects", "cover")],
        "fall": [act("forage", "acorn_mast", "grass_forbs")],
    },
    "sylvilagus_bachmani": {
        "winter": [act("forage", "grass_forbs", "browse"), act("shelter", "cover")],
        "spring": [act("court"), act("rear", "cover")],
        "summer": [act("forage", "grass_forbs"), act("shelter", "cover")],
        "fall": [act("forage", "browse")],
    },
    # in a form by day, out to feed at dusk, night and dawn; leverets from late winter to summer
    "lepus_californicus": {
        "winter": [act("forage", "grass_forbs", "browse"), act("shelter", "cover", goal="form under a shrub")],
        "spring": [act("court", goal="chases and boxing"), act("rear", "grass_forbs", goal="leverets in a form")],
        "summer": [act("forage", "grass_forbs"), act("shelter", "cover", goal="rest in shade midday")],
        "fall": [act("forage", "grass_forbs", "browse")],
    },
    "microtus_californicus": {
        "winter": [act("forage", "grass_forbs"), act("shelter", "burrow")],
        "spring": [act("rear", "burrow"), act("forage", "grass_forbs")],
        "summer": [act("shelter", "burrow", goal="aestivate in dry grass")],
        "fall": [act("forage", "grass_forbs"), act("rear", "burrow")],
    },
    "canis_latrans": {
        "winter": [act("court"), act("hunt", "sylvilagus_bachmani", "lepus_californicus", "microtus_californicus",
                                     "odocoileus_hemionus")],
        "spring": [act("den", "burrow"), act("rear", "small_mammals")],
        "summer": [act("hunt", "small_mammals", "insects"), act("forage", "carrion")],
        "fall": [act("disperse"), act("forage", "acorn_mast", "carrion")],
    },
    # flocks all year; gobbling and strutting in spring; hens nest on the ground, poults through the summer
    "meleagris_gallopavo": {
        "winter": [act("forage", "acorn_mast", "grass_forbs", goal="large flocks scratch in the oak litter"),
                   act("shelter", "cliff_or_snag", goal="roost high in oaks and pines at night")],
        "spring": [act("court", goal="toms gobble and strut"), act("nest", "cover", goal="ground nest under brush")],
        "summer": [act("rear", "insects", "grass_forbs", goal="hens with poults"), act("forage", "insects")],
        "fall": [act("forage", "acorn_mast", goal="flocks gather under the oaks")],
    },
    # above ground March-November; colonies share burrow systems; one sits up as sentinel and calls
    "otospermophilus_beecheyi": {
        "winter": [act("shelter", "burrow", goal="hibernate or stay below through the cold weeks")],
        "spring": [act("court", "burrow"), act("rear", "burrow", "grass_forbs", goal="young above ground by May")],
        "summer": [act("forage", "grass_forbs", "acorn_mast", goal="seeds of the dry grass"),
                   act("shelter", "burrow", goal="adults aestivate in the hottest weeks")],
        "fall": [act("forage", "acorn_mast", goal="cache seeds and acorns"), act("shelter", "burrow")],
    },
    # March-October by day; basks on rocks, trunks and fences; males push up from a perch
    "sceloporus_occidentalis": {
        "winter": [act("shelter", "cover", goal="under bark, logs and rocks; out on warm days")],
        "spring": [act("court", "cliff_or_snag", goal="males push up and flash their blue bellies"),
                   act("forage", "insects")],
        "summer": [act("rear", "cover", goal="eggs under loose soil"), act("forage", "insects"),
                   act("shelter", "cover", goal="shade at midday")],
        "fall": [act("forage", "insects"), act("shelter", "cover", goal="retreat as the nights cool")],
    },
    "puma_concolor": {
        "winter": [act("hunt", "odocoileus_hemionus", goal="ambush on deer trails")],
        "spring": [act("hunt", "odocoileus_hemionus"), act("rear", "cover")],
        "summer": [act("hunt", "odocoileus_hemionus", "sylvilagus_bachmani")],
        "fall": [act("hunt", "odocoileus_hemionus", goal="deer gather at mast")],
    },
    # dens December-March; new grass and winter-killed carcasses in spring; berries, ants and grubs in summer, bedded in
    # shade at midday; in fall hyperphagia, feeding nearly all day on acorns and manzanita berries
    "ursus_americanus": {
        "winter": [act("den", "cover", goal="den under a fallen tree, in a rock cave or a hollow; out on a warm day")],
        "spring": [act("forage", "grass_forbs", "carrion", goal="new grass and sedge, winter-killed carcasses"),
                   act("rear", "cover", goal="sows lead cubs out of the den")],
        "summer": [act("forage", "browse", "insects", goal="berries, ants and grubs under logs"),
                   act("court", "cover", goal="mating in June and July"), act("shelter", "cover", goal="bed in shade at midday")],
        "fall": [act("forage", "acorn_mast", "browse", "carrion", goal="fatten for the den: acorns and berries up to 20 hours a day")],
    },
    # coveys from late summer to late winter, walking downslope below the snow in fall and back up in spring; pairs from
    # March, the male calling "quee-ark"; a ground nest under brush, chicks from June with both parents; drinks daily in
    # summer at springs and seeps
    "oreortyx_pictus": {
        "winter": [act("forage", "acorn_mast", "browse", goal="coveys below the snow line: acorns, seeds and berries in the brush"),
                   act("shelter", "cover", goal="roost in dense brush or a low conifer")],
        "spring": [act("court", "cover", goal="pairs; the male calls quee-ark from a rock or a shrub top"),
                   act("nest", "cover", goal="a ground nest under brush or a log"), act("forage", "grass_forbs", "insects")],
        "summer": [act("rear", "insects", "cover", goal="both parents with the brood"), act("forage", "grass_forbs", "browse", "water")],
        "fall": [act("forage", "acorn_mast", "browse", goal="family coveys walk downslope in single file")],
    },
}


# How far each species gives itself away, in the open, by each sense (m): sight (its size, exposure and movement as it
# goes about: a soaring hawk is seen a kilometre off, a stalking lion not until it is close), sound (its everyday calls
# and footfall; a coyote hunts quiet, its howls are not counted) and scent (how far its scent carries downwind). With
# the species' own senses (SPECIES[...]["senses"], the sensor's reach) this gives how far one species notices another:
# detect_m(p, q) = the best sense's min(p's reach, q's signature). The games step uses it for who notices a predator
# first (the alarm links) and how close a hunter gets before it is noticed. ALARM_CALL: the species whose alarm calls
# others heed, and how far the call carries.
SIGNATURE = {
    "corvus_corax":             {"sight": 800, "sound": 700, "scent": 5},
    "buteo_jamaicensis":        {"sight": 1200, "sound": 400, "scent": 5},
    "odocoileus_hemionus":      {"sight": 300, "sound": 60, "scent": 150},
    "urocyon_cinereoargenteus": {"sight": 120, "sound": 40, "scent": 250},
    "sciurus_griseus":          {"sight": 80, "sound": 150, "scent": 30},
    "melanerpes_formicivorus":  {"sight": 150, "sound": 400, "scent": 5},
    "callipepla_californica":   {"sight": 60, "sound": 250, "scent": 20},
    "aphelocoma_californica":   {"sight": 150, "sound": 400, "scent": 5},
    "cyanocitta_stelleri":      {"sight": 150, "sound": 400, "scent": 5},
    "cathartes_aura":           {"sight": 1500, "sound": 20, "scent": 10},
    "sylvilagus_bachmani":      {"sight": 40, "sound": 10, "scent": 80},
    "lepus_californicus":       {"sight": 120, "sound": 10, "scent": 80},
    "microtus_californicus":    {"sight": 10, "sound": 5, "scent": 40},
    "canis_latrans":            {"sight": 300, "sound": 150, "scent": 400},
    "puma_concolor":            {"sight": 60, "sound": 15, "scent": 300},
    "meleagris_gallopavo":      {"sight": 250, "sound": 300, "scent": 20},
    "otospermophilus_beecheyi": {"sight": 60, "sound": 200, "scent": 30},
    "sceloporus_occidentalis":  {"sight": 8, "sound": 2, "scent": 5},
    "ursus_americanus":         {"sight": 150, "sound": 60, "scent": 400},
    "oreortyx_pictus":          {"sight": 60, "sound": 250, "scent": 30},   # hidden in brush; its loud "quee-ark" carries
}
# (the black bear gives no alarm call others heed: not in ALARM_CALL)
ALARM_CALL = {"aphelocoma_californica": 400, "cyanocitta_stelleri": 400, "melanerpes_formicivorus": 400, "corvus_corax": 700,
              "meleagris_gallopavo": 300, "callipepla_californica": 250, "otospermophilus_beecheyi": 200, "sciurus_griseus": 150,
              "odocoileus_hemionus": 60, "oreortyx_pictus": 150}
_SENSE = {"sight": "vision", "sound": "hearing", "scent": "smell"}
_SENSES = {s["code"]: s["senses"] for s in SPECIES}


def detect_m(p: str, q: str) -> int:
    """How far species p notices species q in the open, m: the best of its senses against q's signature."""
    sp, sg = _SENSES.get(p), SIGNATURE.get(q)
    if not sp or not sg:
        return 0
    return int(max(min(sp[_SENSE[k]]["range_m"], sg[k]) for k in sg))


def detection_matrix(codes=None) -> dict[str, dict[str, int]]:
    codes = list(codes or ALL)
    return {p: {q: detect_m(p, q) for q in codes if q != p} for p in codes}


# What each species needs whatever the season (the games step, pipeline/games.py, reads these beside CALENDAR; docs/games.md):
#   water: how it drinks: "daily" (open water every day, dawn and dusk), "often" (open water when near it), "rare"
#          (mostly metabolic water or dew; drinks in drought), "none" (never needs open water: moisture from food);
#   shelter: the resource raster it hides, dens or roosts in (cover, cavity, burrow, cliff_or_snag for a tall roost);
#   court: the resource raster where it courts (the rut's open ground, the strutting ground, a granary, a cliff).
NEEDS = {
    "corvus_corax":             {"water": "often", "shelter": "cliff_or_snag", "court": "cliff_or_snag"},
    "buteo_jamaicensis":        {"water": "often", "shelter": "cliff_or_snag", "court": "cliff_or_snag"},
    "odocoileus_hemionus":      {"water": "daily", "shelter": "cover", "court": "grass_forbs"},
    "urocyon_cinereoargenteus": {"water": "often", "shelter": "burrow", "court": "cover"},
    "sciurus_griseus":          {"water": "often", "shelter": "cavity", "court": "cavity"},
    "melanerpes_formicivorus":  {"water": "often", "shelter": "cavity", "court": "cavity"},
    "aphelocoma_californica":   {"water": "often", "shelter": "cover", "court": "cover"},
    "cyanocitta_stelleri":      {"water": "often", "shelter": "cover", "court": "cover"},
    "cathartes_aura":           {"water": "often", "shelter": "cliff_or_snag", "court": "cliff_or_snag"},
    "callipepla_californica":   {"water": "daily", "shelter": "cover", "court": "cover"},
    "sylvilagus_bachmani":      {"water": "none", "shelter": "cover", "court": "cover"},
    "lepus_californicus":       {"water": "none", "shelter": "cover", "court": "grass_forbs"},
    "microtus_californicus":    {"water": "none", "shelter": "burrow", "court": "burrow"},
    "canis_latrans":            {"water": "daily", "shelter": "burrow", "court": "cover"},
    "meleagris_gallopavo":      {"water": "daily", "shelter": "cliff_or_snag", "court": "grass_forbs"},
    "otospermophilus_beecheyi": {"water": "rare", "shelter": "burrow", "court": "burrow"},
    "sceloporus_occidentalis":  {"water": "none", "shelter": "burrow", "court": "cliff_or_snag"},
    "puma_concolor":            {"water": "daily", "shelter": "cover", "court": "cover"},
    "ursus_americanus":         {"water": "daily", "shelter": "cover", "court": "cover"},
    "oreortyx_pictus":          {"water": "daily", "shelter": "cover", "court": "cover"},
}

# What each predator eats among the species here (the prey's side of the calendar's hunt lists, which were written for
# the hunter's story), and whose kills a scavenger follows. Prey not in the tile's list are simply absent there. plants:
# the resource rasters an omnivore eats (for reference; the games step reads them from the calendar's forage acts).
DIET = {
    "buteo_jamaicensis":        {"prey": ["microtus_californicus", "otospermophilus_beecheyi", "sylvilagus_bachmani", "lepus_californicus",
                                          "sciurus_griseus", "sceloporus_occidentalis", "callipepla_californica", "oreortyx_pictus"]},
    "canis_latrans":            {"prey": ["lepus_californicus", "sylvilagus_bachmani", "microtus_californicus", "otospermophilus_beecheyi",
                                          "odocoileus_hemionus", "callipepla_californica", "meleagris_gallopavo", "oreortyx_pictus"],
                                 "carrion": ["puma_concolor"]},
    "urocyon_cinereoargenteus": {"prey": ["microtus_californicus", "sylvilagus_bachmani", "otospermophilus_beecheyi", "callipepla_californica",
                                          "sceloporus_occidentalis", "oreortyx_pictus"]},
    "puma_concolor":            {"prey": ["odocoileus_hemionus", "lepus_californicus", "sylvilagus_bachmani", "otospermophilus_beecheyi",
                                          "meleagris_gallopavo", "canis_latrans"]},
    "corvus_corax":             {"prey": ["sceloporus_occidentalis", "microtus_californicus", "callipepla_californica",
                                          "oreortyx_pictus"],   # the quails: eggs and chicks
                                 "carrion": ["puma_concolor", "canis_latrans"]},
    "aphelocoma_californica":   {"prey": ["sceloporus_occidentalis"]},
    "cathartes_aura":           {"carrion": ["puma_concolor", "canis_latrans"]},
    # acorns, berries (browse), grass, insects and grubs; hunts nothing here; comes to the lion's and the coyote's kills
    "ursus_americanus":         {"plants": ["acorn_mast", "browse", "grass_forbs", "insects"],
                                 "carrion": ["puma_concolor", "canis_latrans"]},
    # seeds (grass and forbs), acorns, berries (browse), and insects in spring and for the chicks; hunts nothing
    "oreortyx_pictus":          {"plants": ["grass_forbs", "acorn_mast", "browse", "insects"]},
}
