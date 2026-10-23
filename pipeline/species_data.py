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
    # ambient
    {"code": "callipepla_californica", "common": "California quail", "scientific": "Callipepla californica",
     "group": "bird", "role": "ambient", "scale": "bird",
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"},
                "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    {"code": "sylvilagus_bachmani", "common": "brush rabbit", "scientific": "Sylvilagus bachmani",
     "group": "mammal", "role": "ambient", "scale": "squirrel",
     "senses": {"vision": {"range_m": 200, "color": "dichromat"},
                "hearing": {"range_m": 400}, "smell": {"range_m": 200}}},
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
]

ALL = [s["code"] for s in SPECIES]

# Who exists for whom. A species absent from a player's list is not rendered for them.
PERCEPTION = {
    "corvus_corax": ALL,
    "buteo_jamaicensis": [c for c in ALL if c != "puma_concolor"],
    "odocoileus_hemionus": ["odocoileus_hemionus", "puma_concolor", "canis_latrans",
                            "urocyon_cinereoargenteus", "corvus_corax", "buteo_jamaicensis",
                            "sciurus_griseus", "callipepla_californica"],
    "urocyon_cinereoargenteus": ALL,
    "sciurus_griseus": ["sciurus_griseus", "buteo_jamaicensis", "urocyon_cinereoargenteus",
                        "canis_latrans", "corvus_corax", "odocoileus_hemionus",
                        "sylvilagus_bachmani", "callipepla_californica"],
    "callipepla_californica": ["callipepla_californica", "buteo_jamaicensis",
                               "urocyon_cinereoargenteus", "canis_latrans", "corvus_corax",
                               "sylvilagus_bachmani", "odocoileus_hemionus"],
    "sylvilagus_bachmani": ["sylvilagus_bachmani", "urocyon_cinereoargenteus", "canis_latrans",
                            "buteo_jamaicensis", "corvus_corax", "callipepla_californica",
                            "odocoileus_hemionus"],
    "microtus_californicus": ["microtus_californicus", "urocyon_cinereoargenteus",
                              "canis_latrans", "buteo_jamaicensis", "corvus_corax"],
    "canis_latrans": ALL,
    "puma_concolor": ["puma_concolor", "odocoileus_hemionus", "canis_latrans",
                      "urocyon_cinereoargenteus", "sylvilagus_bachmani", "sciurus_griseus",
                      "callipepla_californica", "corvus_corax"],
}

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
        "winter": [act("hunt", "microtus_californicus", "sylvilagus_bachmani", goal="hunt from perches")],
        "spring": [act("court", goal="sky dance"), act("nest", "cliff_or_snag", goal="large tree or cliff")],
        "summer": [act("rear", "sciurus_griseus", "sylvilagus_bachmani", "microtus_californicus",
                       goal="feed chicks")],
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
    "microtus_californicus": {
        "winter": [act("forage", "grass_forbs"), act("shelter", "burrow")],
        "spring": [act("rear", "burrow"), act("forage", "grass_forbs")],
        "summer": [act("shelter", "burrow", goal="aestivate in dry grass")],
        "fall": [act("forage", "grass_forbs"), act("rear", "burrow")],
    },
    "canis_latrans": {
        "winter": [act("court"), act("hunt", "sylvilagus_bachmani", "microtus_californicus", "odocoileus_hemionus")],
        "spring": [act("den", "burrow"), act("rear", "small_mammals")],
        "summer": [act("hunt", "small_mammals", "insects"), act("forage", "carrion")],
        "fall": [act("disperse"), act("forage", "acorn_mast", "carrion")],
    },
    "puma_concolor": {
        "winter": [act("hunt", "odocoileus_hemionus", goal="ambush on deer trails")],
        "spring": [act("hunt", "odocoileus_hemionus"), act("rear", "cover")],
        "summer": [act("hunt", "odocoileus_hemionus", "sylvilagus_bachmani")],
        "fall": [act("hunt", "odocoileus_hemionus", goal="deer gather at mast")],
    },
}
