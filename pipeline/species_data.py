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
    # ---- the Hoh rain forest batch (2026-11-05; docs/animal-library.md "The Hoh rain forest batch"): the Olympic
    # Peninsula's commonest and most conspicuous animals with a drawn model, each on a curated species' behaviour in the
    # client (animals.js KIN). gbif_key pins the taxon GBIF files the tile's records under (the elk's: Cervus elaphus,
    # which GBIF and EltonTraits lump the North American elk with; pipeline/fauna.py renames it on American tiles).
    {"code": "cervus_canadensis", "common": "Roosevelt elk", "scientific": "Cervus canadensis",
     "group": "mammal", "role": "ambient", "scale": "deer", "gbif_key": 2440958,
     "habitat": {"riparian": 1.0, "grassland": 1.0, "mixed": 0.6, "conifer": 0.35, "oak_woodland": 0.5, "chaparral": 0.3},
     "senses": {"vision": {"range_m": 500, "color": "dichromat"}, "hearing": {"range_m": 800}, "smell": {"range_m": 1000}}},
    {"code": "tamiasciurus_douglasii", "common": "Douglas squirrel", "scientific": "Tamiasciurus douglasii",
     "group": "mammal", "role": "ambient", "scale": "squirrel", "gbif_key": 2437281,
     "habitat": {"conifer": 1.0, "mixed": 0.85, "riparian": 0.45},
     "senses": {"vision": {"range_m": 150, "color": "dichromat"}, "hearing": {"range_m": 200}, "smell": {"range_m": 80}}},
    {"code": "troglodytes_pacificus", "common": "Pacific wren", "scientific": "Troglodytes pacificus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9533566,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 1.0, "chaparral": 0.3},
     "senses": {"vision": {"range_m": 60, "color": "tetrachromat"}, "hearing": {"range_m": 150}, "smell": {"range_m": 5}}},
    {"code": "perisoreus_canadensis", "common": "Canada jay", "scientific": "Perisoreus canadensis",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2482436,
     "habitat": {"conifer": 1.0, "mixed": 0.6, "riparian": 0.3},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 250}, "smell": {"range_m": 20}}},
    {"code": "poecile_rufescens", "common": "chestnut-backed chickadee", "scientific": "Poecile rufescens",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2487783,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.7},
     "senses": {"vision": {"range_m": 80, "color": "tetrachromat"}, "hearing": {"range_m": 150}, "smell": {"range_m": 5}}},
    {"code": "strix_varia", "common": "barred owl", "scientific": "Strix varia",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2497541,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.9},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 400}, "smell": {"range_m": 5}}},
    {"code": "megaceryle_alcyon", "common": "belted kingfisher", "scientific": "Megaceryle alcyon",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2475472,
     "habitat": {"riparian": 1.0, "water": 1.0},
     "senses": {"vision": {"range_m": 200, "color": "tetrachromat"}, "hearing": {"range_m": 150}, "smell": {"range_m": 5}}},
    {"code": "haliaeetus_leucocephalus", "common": "bald eagle", "scientific": "Haliaeetus leucocephalus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2480446,
     "habitat": {"riparian": 1.0, "water": 1.0, "conifer": 0.5, "mixed": 0.5},
     "senses": {"vision": {"range_m": 2500, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    {"code": "corvus_brachyrhynchos", "common": "American crow", "scientific": "Corvus brachyrhynchos",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2482507,
     "habitat": {"grassland": 1.0, "riparian": 1.0, "barren": 0.6, "mixed": 0.4, "conifer": 0.15, "human": 1.0},
     "senses": {"vision": {"range_m": 800, "color": "tetrachromat"}, "hearing": {"range_m": 400}, "smell": {"range_m": 30}}},
    {"code": "lynx_rufus", "common": "bobcat", "scientific": "Lynx rufus",
     "group": "mammal", "role": "ambient", "scale": "fox", "gbif_key": 2435246,
     "habitat": {"mixed": 0.9, "conifer": 0.6, "riparian": 0.9, "chaparral": 0.9, "grassland": 0.6, "oak_woodland": 0.8},
     "senses": {"vision": {"range_m": 400, "color": "dichromat"}, "hearing": {"range_m": 500}, "smell": {"range_m": 300}}},
    {"code": "lontra_canadensis", "common": "North American river otter", "scientific": "Lontra canadensis",
     "group": "mammal", "role": "ambient", "scale": "fox", "gbif_key": 2433727,
     "habitat": {"riparian": 1.0, "water": 1.0},
     "senses": {"vision": {"range_m": 150, "color": "dichromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 400}}},
    {"code": "lepus_americanus", "common": "snowshoe hare", "scientific": "Lepus americanus",
     "group": "mammal", "role": "ambient", "scale": "squirrel", "gbif_key": 2436794,
     "habitat": {"mixed": 1.0, "riparian": 1.0, "conifer": 0.7, "chaparral": 0.8},
     "senses": {"vision": {"range_m": 200, "color": "dichromat"}, "hearing": {"range_m": 400}, "smell": {"range_m": 150}}},
    {"code": "tamias_townsendii", "common": "Townsend's chipmunk", "scientific": "Tamias townsendii",
     "group": "mammal", "role": "ambient", "scale": "vole", "gbif_key": 2437449,
     "habitat": {"mixed": 1.0, "conifer": 0.8, "riparian": 0.8, "chaparral": 0.6},
     "senses": {"vision": {"range_m": 80, "color": "dichromat"}, "hearing": {"range_m": 100}, "smell": {"range_m": 40}}},
    {"code": "peromyscus_maniculatus", "common": "deer mouse", "scientific": "Peromyscus maniculatus",
     "group": "mammal", "role": "ambient", "scale": "vole", "gbif_key": 2437967,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 1.0, "chaparral": 0.8, "grassland": 0.6, "barren": 0.3},
     "senses": {"vision": {"range_m": 20, "color": "dichromat"}, "hearing": {"range_m": 80}, "smell": {"range_m": 40}}},
    {"code": "plethodon_vehiculum", "common": "western red-backed salamander", "scientific": "Plethodon vehiculum",
     "group": "amphibian", "role": "ambient", "scale": "vole", "gbif_key": 2431514,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.8},
     "senses": {"vision": {"range_m": 2, "color": "tetrachromat"}, "hearing": {"range_m": 1}, "smell": {"range_m": 2}}},
    {"code": "ensatina_eschscholtzii", "common": "ensatina", "scientific": "Ensatina eschscholtzii",
     "group": "amphibian", "role": "ambient", "scale": "vole", "gbif_key": 2431643,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.6, "chaparral": 0.4},
     "senses": {"vision": {"range_m": 2, "color": "tetrachromat"}, "hearing": {"range_m": 1}, "smell": {"range_m": 2}}},
    {"code": "ariolimax_columbianus", "common": "Pacific banana slug", "scientific": "Ariolimax columbianus",
     "group": "invertebrate", "role": "ambient", "scale": "vole", "gbif_key": 2294090,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 1.0},
     "senses": {"vision": {"range_m": 0.5, "color": "monochromat"}, "hearing": {"range_m": 0}, "smell": {"range_m": 5}}},
    {"code": "ardea_herodias", "common": "great blue heron", "scientific": "Ardea herodias",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9630752,
     "habitat": {"riparian": 1.0, "water": 1.0, "grassland": 0.3},
     "senses": {"vision": {"range_m": 400, "color": "tetrachromat"}, "hearing": {"range_m": 200}, "smell": {"range_m": 5}}},
    {"code": "mergus_merganser", "common": "common merganser", "scientific": "Mergus merganser",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9537647,
     "habitat": {"water": 1.0, "riparian": 1.0},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 200}, "smell": {"range_m": 5}}},
    # ---- the second Hoh batch (2026-11-06): the rest of the Hoh and Mount Olympus lists ----
    {"code": "turdus_migratorius", "common": "American robin", "scientific": "Turdus migratorius",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9510564,
     "habitat": {"mixed": 1.0, "grassland": 1.0, "riparian": 1.0, "conifer": 0.6},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 250}, "smell": {"range_m": 10}}},
    {"code": "sturnus_vulgaris", "common": "European starling", "scientific": "Sturnus vulgaris",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9809229,
     "habitat": {"grassland": 1.0, "human": 1.0, "riparian": 0.5},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 250}, "smell": {"range_m": 10}}},
    {"code": "ixoreus_naevius", "common": "varied thrush", "scientific": "Ixoreus naevius",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2490926,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.9},
     "senses": {"vision": {"range_m": 200, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 10}}},
    {"code": "junco_hyemalis", "common": "dark-eyed junco", "scientific": "Junco hyemalis",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9362842,
     "habitat": {"mixed": 1.0, "conifer": 0.8, "grassland": 0.8, "riparian": 0.9, "chaparral": 0.8},
     "senses": {"vision": {"range_m": 150, "color": "tetrachromat"}, "hearing": {"range_m": 200}, "smell": {"range_m": 5}}},
    {"code": "regulus_satrapa", "common": "golden-crowned kinglet", "scientific": "Regulus satrapa",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2484591,
     "habitat": {"conifer": 1.0, "mixed": 0.8},
     "senses": {"vision": {"range_m": 60, "color": "tetrachromat"}, "hearing": {"range_m": 150}, "smell": {"range_m": 5}}},
    {"code": "empidonax_difficilis", "common": "Pacific-slope flycatcher", "scientific": "Empidonax difficilis",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9568685,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 1.0},
     "senses": {"vision": {"range_m": 100, "color": "tetrachromat"}, "hearing": {"range_m": 150}, "smell": {"range_m": 5}}},
    {"code": "megascops_kennicottii", "common": "western screech-owl", "scientific": "Megascops kennicottii",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2497341,
     "habitat": {"mixed": 1.0, "riparian": 1.0, "conifer": 0.6},
     "senses": {"vision": {"range_m": 200, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "aegolius_acadicus", "common": "northern saw-whet owl", "scientific": "Aegolius acadicus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 5232207,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.7},
     "senses": {"vision": {"range_m": 200, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "leuconotopicus_villosus", "common": "hairy woodpecker", "scientific": "Leuconotopicus villosus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9192501,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.9},
     "senses": {"vision": {"range_m": 200, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "pandion_haliaetus", "common": "osprey", "scientific": "Pandion haliaetus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2480726,
     "habitat": {"riparian": 1.0, "water": 1.0},
     "senses": {"vision": {"range_m": 1500, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "accipiter_striatus", "common": "sharp-shinned hawk", "scientific": "Accipiter striatus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9740253,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 0.8},
     "senses": {"vision": {"range_m": 800, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "falco_columbarius", "common": "merlin", "scientific": "Falco columbarius",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9813242,
     "habitat": {"grassland": 1.0, "riparian": 1.0, "mixed": 0.6},
     "senses": {"vision": {"range_m": 1000, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 5}}},
    {"code": "larus_glaucescens", "common": "glaucous-winged gull", "scientific": "Larus glaucescens",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2481196,
     "habitat": {"water": 1.0, "riparian": 1.0, "barren": 0.5},
     "senses": {"vision": {"range_m": 800, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 50}}},
    {"code": "larus_californicus", "common": "California gull", "scientific": "Larus californicus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 2481146,
     "habitat": {"water": 1.0, "riparian": 1.0, "barren": 0.5},
     "senses": {"vision": {"range_m": 800, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 50}}},
    {"code": "larus_occidentalis", "common": "western gull", "scientific": "Larus occidentalis",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9656686,
     "habitat": {"water": 1.0, "riparian": 1.0, "barren": 0.5},
     "senses": {"vision": {"range_m": 800, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 50}}},
    {"code": "anas_platyrhynchos", "common": "mallard", "scientific": "Anas platyrhynchos",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 9761484,
     "habitat": {"water": 1.0, "riparian": 1.0},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 200}, "smell": {"range_m": 10}}},
    {"code": "dendragapus_fuliginosus", "common": "sooty grouse", "scientific": "Dendragapus fuliginosus",
     "group": "bird", "role": "ambient", "scale": "bird", "gbif_key": 7340146,
     "habitat": {"conifer": 1.0, "mixed": 0.8, "chaparral": 0.6, "grassland": 0.5},
     "senses": {"vision": {"range_m": 300, "color": "tetrachromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 20}}},
    {"code": "marmota_olympus", "common": "Olympic marmot", "scientific": "Marmota olympus",
     "group": "mammal", "role": "ambient", "scale": "squirrel", "gbif_key": 2437374,
     "habitat": {"grassland": 1.0, "barren": 0.8, "chaparral": 0.4},
     "senses": {"vision": {"range_m": 400, "color": "dichromat"}, "hearing": {"range_m": 300}, "smell": {"range_m": 150}}},
    {"code": "tamias_amoenus", "common": "yellow-pine chipmunk", "scientific": "Tamias amoenus",
     "group": "mammal", "role": "ambient", "scale": "vole", "gbif_key": 2437430,
     "habitat": {"chaparral": 1.0, "conifer": 0.8, "grassland": 0.6, "barren": 0.6},
     "senses": {"vision": {"range_m": 80, "color": "dichromat"}, "hearing": {"range_m": 100}, "smell": {"range_m": 40}}},
    {"code": "sorex_monticolus", "common": "montane shrew", "scientific": "Sorex monticolus",
     "group": "mammal", "role": "ambient", "scale": "vole", "gbif_key": 2436019,
     "habitat": {"conifer": 1.0, "mixed": 1.0, "riparian": 1.0, "grassland": 0.7},
     "senses": {"vision": {"range_m": 5, "color": "dichromat"}, "hearing": {"range_m": 60}, "smell": {"range_m": 30}}},
    {"code": "anaxyrus_boreas", "common": "western toad", "scientific": "Anaxyrus boreas",
     "group": "amphibian", "role": "ambient", "scale": "vole", "gbif_key": 2422924,
     "habitat": {"grassland": 1.0, "riparian": 1.0, "mixed": 0.8, "conifer": 0.6},
     "senses": {"vision": {"range_m": 3, "color": "dichromat"}, "hearing": {"range_m": 5}, "smell": {"range_m": 2}}},
    {"code": "rana_cascadae", "common": "Cascades frog", "scientific": "Rana cascadae",
     "group": "amphibian", "role": "ambient", "scale": "vole", "gbif_key": 2426771,
     "habitat": {"riparian": 1.0, "grassland": 1.0, "water": 0.6},
     "senses": {"vision": {"range_m": 3, "color": "dichromat"}, "hearing": {"range_m": 5}, "smell": {"range_m": 2}}},
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
    # the Hoh batch: bands for the Olympic west slope (lowland rain forest to the subalpine; the outside-California rule
    # is records first, so these only matter where a range test runs)
    "cervus_canadensis":        {"elev_m": [0, 1800], "habitats": ["riparian", "grassland", "mixed_forest", "conifer_forest"]},
    "tamiasciurus_douglasii":   {"elev_m": [0, 2000], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "troglodytes_pacificus":    {"elev_m": [0, 1600], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "perisoreus_canadensis":    {"elev_m": [300, 2000], "habitats": ["conifer_forest", "mixed_forest"]},
    "poecile_rufescens":        {"elev_m": [0, 1500], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "strix_varia":              {"elev_m": [0, 1200], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "megaceryle_alcyon":        {"elev_m": [0, 1200], "habitats": ["riparian"]},
    "haliaeetus_leucocephalus": {"elev_m": [0, 1500], "habitats": ["riparian", "conifer_forest", "mixed_forest"]},
    "corvus_brachyrhynchos":    {"elev_m": [0, 1000], "habitats": ["grassland", "riparian", "barren", "mixed_forest"]},
    "lynx_rufus":               {"elev_m": [0, 1800], "habitats": ["mixed_forest", "conifer_forest", "riparian", "chaparral", "grassland"]},
    "lontra_canadensis":        {"elev_m": [0, 1200], "habitats": ["riparian"]},
    "lepus_americanus":         {"elev_m": [0, 2000], "habitats": ["mixed_forest", "conifer_forest", "riparian", "chaparral"]},
    "tamias_townsendii":        {"elev_m": [0, 1800], "habitats": ["mixed_forest", "conifer_forest", "riparian"]},
    "peromyscus_maniculatus":   {"elev_m": [0, 2500], "habitats": ["conifer_forest", "mixed_forest", "riparian", "chaparral", "grassland"]},
    "plethodon_vehiculum":      {"elev_m": [0, 1200], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "ensatina_eschscholtzii":   {"elev_m": [0, 1600], "habitats": ["conifer_forest", "mixed_forest", "riparian", "chaparral"]},
    "ariolimax_columbianus":    {"elev_m": [0, 1200], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "ardea_herodias":           {"elev_m": [0, 1200], "habitats": ["riparian", "grassland"]},
    "mergus_merganser":         {"elev_m": [0, 1200], "habitats": ["riparian"]},
    # the second Hoh batch
    "turdus_migratorius": {"elev_m": [0, 2000], "habitats": ["mixed_forest", "conifer_forest", "grassland", "riparian"]},
    "sturnus_vulgaris": {"elev_m": [0, 800], "habitats": ["grassland", "riparian"]},
    "ixoreus_naevius": {"elev_m": [0, 1800], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "junco_hyemalis": {"elev_m": [0, 2200], "habitats": ["mixed_forest", "conifer_forest", "grassland", "riparian", "chaparral"]},
    "regulus_satrapa": {"elev_m": [0, 2000], "habitats": ["conifer_forest", "mixed_forest"]},
    "empidonax_difficilis": {"elev_m": [0, 1500], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "megascops_kennicottii": {"elev_m": [0, 1200], "habitats": ["mixed_forest", "riparian", "conifer_forest"]},
    "aegolius_acadicus": {"elev_m": [0, 2000], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "leuconotopicus_villosus": {"elev_m": [0, 2000], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "pandion_haliaetus": {"elev_m": [0, 1200], "habitats": ["riparian"]},
    "accipiter_striatus": {"elev_m": [0, 2000], "habitats": ["conifer_forest", "mixed_forest", "riparian"]},
    "falco_columbarius": {"elev_m": [0, 1500], "habitats": ["grassland", "riparian", "mixed_forest"]},
    "larus_glaucescens": {"elev_m": [0, 600], "habitats": ["riparian", "barren"]},
    "larus_californicus": {"elev_m": [0, 600], "habitats": ["riparian", "barren"]},
    "larus_occidentalis": {"elev_m": [0, 600], "habitats": ["riparian", "barren"]},
    "anas_platyrhynchos": {"elev_m": [0, 1200], "habitats": ["riparian"]},
    "dendragapus_fuliginosus": {"elev_m": [300, 2000], "habitats": ["conifer_forest", "mixed_forest", "grassland"]},
    "marmota_olympus": {"elev_m": [1200, 2200], "habitats": ["grassland", "barren"]},
    "tamias_amoenus": {"elev_m": [800, 2400], "habitats": ["chaparral", "conifer_forest", "grassland", "barren"]},
    "sorex_monticolus": {"elev_m": [0, 2400], "habitats": ["conifer_forest", "mixed_forest", "riparian", "grassland"]},
    "anaxyrus_boreas": {"elev_m": [0, 2200], "habitats": ["grassland", "riparian", "mixed_forest", "conifer_forest"]},
    "rana_cascadae": {"elev_m": [700, 2400], "habitats": ["riparian", "grassland"]},
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
# The Hoh batch (2026-11-05): each sees every species (perceives_on keeps those present on a tile), and every curated
# observer sees the batch's conspicuous animals (the elk, the bobcat, the otter, the eagle, the crow, the heron, the
# mergansers, the owl, the jays and the squirrel); its own kin and prey see the small ones (the rows below)
HOH = ["cervus_canadensis", "tamiasciurus_douglasii", "troglodytes_pacificus", "perisoreus_canadensis", "poecile_rufescens",
       "strix_varia", "megaceryle_alcyon", "haliaeetus_leucocephalus", "corvus_brachyrhynchos", "lynx_rufus", "lontra_canadensis",
       "lepus_americanus", "tamias_townsendii", "peromyscus_maniculatus", "plethodon_vehiculum", "ensatina_eschscholtzii",
       "ariolimax_columbianus", "ardea_herodias", "mergus_merganser"]
HOH2 = ["turdus_migratorius", "sturnus_vulgaris", "ixoreus_naevius", "junco_hyemalis", "regulus_satrapa", "empidonax_difficilis", "megascops_kennicottii", "aegolius_acadicus", "leuconotopicus_villosus", "pandion_haliaetus", "accipiter_striatus", "falco_columbarius", "larus_glaucescens", "larus_californicus", "larus_occidentalis", "anas_platyrhynchos", "dendragapus_fuliginosus", "marmota_olympus", "tamias_amoenus", "sorex_monticolus", "anaxyrus_boreas", "rana_cascadae"]
HOH += HOH2
_HOH_BIG = ["cervus_canadensis", "tamiasciurus_douglasii", "perisoreus_canadensis", "strix_varia", "megaceryle_alcyon",
            "haliaeetus_leucocephalus", "corvus_brachyrhynchos", "lynx_rufus", "lontra_canadensis", "ardea_herodias", "mergus_merganser"]
for _o, _row in PERCEPTION.items():
    for _c in (HOH if _row is ALL else _HOH_BIG):
        if _c not in _row:
            _row.append(_c)
for _c in HOH:
    PERCEPTION[_c] = ALL


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
    # ---- the Hoh batch (2026-11-05) ----
    # the elk: the river flats in winter, up to the subalpine meadows in summer; the rut in September-October, the bulls
    # bugling and holding harems; calves in late May and June hidden in the ferns
    "cervus_canadensis": {
        "winter": [act("forage", "browse", "grass_forbs", goal="herds on the river flats, browsing vine maple and huckleberry"),
                   act("shelter", "cover", goal="under the big spruce and hemlock in storms")],
        "spring": [act("forage", "grass_forbs", goal="new grass and sedge on the flats"), act("rear", "cover", goal="cows calve alone in the ferns")],
        "summer": [act("forage", "grass_forbs", "browse", "water", goal="up to the meadows; cows with calves in nursery herds")],
        "fall": [act("court", "grass_forbs", goal="the rut: bulls bugle and gather cows"), act("forage", "browse")],
    },
    "tamiasciurus_douglasii": {
        "winter": [act("forage", "cover", goal="eats from its cone middens"), act("shelter", "cavity")],
        "spring": [act("court", goal="mating chases"), act("nest", "cavity", goal="a nest in a hollow or a ball of moss and twigs")],
        "summer": [act("forage", "insects", "browse", goal="berries, mushrooms, buds"), act("rear", "cavity")],
        "fall": [act("cache", "cover", goal="cuts green cones and stores them in middens")],
    },
    "troglodytes_pacificus": {
        "winter": [act("forage", "insects", goal="creeps over logs and roots for spiders and insects")],
        "spring": [act("court", "cover", goal="the male's long tumbling song from a stump"), act("nest", "cover", goal="a moss nest in a root wad")],
        "summer": [act("rear", "insects", "cover")],
        "fall": [act("forage", "insects")],
    },
    "perisoreus_canadensis": {
        "winter": [act("forage", "cover", goal="lives on food it cached in bark and lichen")],
        "spring": [act("nest", "cover", goal="nests in late winter in a conifer")],
        "summer": [act("rear", "insects"), act("cache", "cover", goal="sticky food balls hidden in bark")],
        "fall": [act("cache", "cover"), act("forage", "carrion", "insects")],
    },
    "poecile_rufescens": {
        "winter": [act("forage", "insects", goal="mixed flocks gleaning the conifer crowns")],
        "spring": [act("nest", "cavity", goal="a cavity in a snag")],
        "summer": [act("rear", "insects", "cavity")],
        "fall": [act("forage", "insects"), act("cache", "cover", goal="seeds tucked in bark")],
    },
    "strix_varia": {
        "winter": [act("hunt", "peromyscus_maniculatus", "tamiasciurus_douglasii", goal="from a perch by night")],
        "spring": [act("nest", "cavity", goal="a broken-top snag"), act("court", goal="the pair's duet: who cooks for you")],
        "summer": [act("rear", "peromyscus_maniculatus", "tamias_townsendii", "plethodon_vehiculum")],
        "fall": [act("hunt", "peromyscus_maniculatus", "lepus_americanus")],
    },
    "megaceryle_alcyon": {
        "winter": [act("hunt", "water", goal="dives for fish from a perch over the river")],
        "spring": [act("nest", "burrow", goal="digs a tunnel in a cut bank"), act("court", goal="rattling chases along the river")],
        "summer": [act("rear", "water", goal="feeds fish to the nestlings")],
        "fall": [act("hunt", "water")],
    },
    "haliaeetus_leucocephalus": {
        "winter": [act("forage", "carrion", "water", goal="salmon carcasses along the river"), act("shelter", "cliff_or_snag", goal="roost in tall old trees")],
        "spring": [act("nest", "cliff_or_snag", goal="a huge stick nest in an old spruce"), act("court", goal="cartwheeling display flights")],
        "summer": [act("rear", "water", "carrion")],
        "fall": [act("forage", "carrion", "water", goal="the salmon runs")],
    },
    "corvus_brachyrhynchos": {
        "winter": [act("forage", "carrion", "insects", goal="family groups on the river bars"), act("shelter", "cover", goal="communal roosts")],
        "spring": [act("nest", "cover", goal="a stick nest in a conifer; last year's young help")],
        "summer": [act("rear", "insects", "carrion")],
        "fall": [act("forage", "carrion", "browse", goal="berries and carrion")],
    },
    "lynx_rufus": {
        "winter": [act("hunt", "lepus_americanus", "tamiasciurus_douglasii", goal="stalks hares at the forest edge")],
        "spring": [act("den", "cover", goal="a den under a root wad or log pile"), act("court")],
        "summer": [act("rear", "peromyscus_maniculatus", "tamias_townsendii"), act("hunt", "peromyscus_maniculatus")],
        "fall": [act("hunt", "lepus_americanus", "peromyscus_maniculatus"), act("disperse", goal="kittens leave")],
    },
    "lontra_canadensis": {
        "winter": [act("hunt", "water", goal="fish and crayfish in the river"), act("shelter", "burrow", goal="a den in the bank under roots")],
        "spring": [act("den", "burrow", goal="pups born in a bank den"), act("hunt", "water")],
        "summer": [act("rear", "water", goal="the mother teaches the pups to swim"), act("forage", "water")],
        "fall": [act("hunt", "water", goal="the salmon runs")],
    },
    "lepus_americanus": {
        "winter": [act("forage", "browse", goal="twigs and bark of young conifers and alder"), act("shelter", "cover")],
        "spring": [act("court", goal="chases at night"), act("rear", "cover", goal="leverets in a form")],
        "summer": [act("forage", "grass_forbs", "browse"), act("shelter", "cover")],
        "fall": [act("forage", "browse")],
    },
    "tamias_townsendii": {
        "winter": [act("shelter", "burrow", goal="torpid in its burrow through the cold weeks")],
        "spring": [act("court", "burrow"), act("rear", "burrow")],
        "summer": [act("forage", "browse", "insects", goal="seeds, berries and fungi along logs")],
        "fall": [act("cache", "burrow", goal="carries seeds in its cheeks to its larder")],
    },
    "peromyscus_maniculatus": {
        "winter": [act("forage", "grass_forbs", "insects", goal="seeds under the snow and litter"), act("shelter", "burrow")],
        "spring": [act("rear", "burrow", goal="nests in logs and stumps")],
        "summer": [act("forage", "insects", "browse")],
        "fall": [act("cache", "burrow", goal="caches conifer seed")],
    },
    "plethodon_vehiculum": {
        "winter": [act("shelter", "cover", goal="under logs and moss; out on mild wet nights")],
        "spring": [act("forage", "insects", goal="springtails, mites and small insects on wet nights"), act("court", "cover")],
        "summer": [act("shelter", "cover", goal="deep in rotting logs when it is dry"), act("rear", "cover", goal="eggs in a log, the female guarding")],
        "fall": [act("forage", "insects", goal="the first rains bring them out")],
    },
    "ensatina_eschscholtzii": {
        "winter": [act("shelter", "cover", goal="under logs and bark")],
        "spring": [act("forage", "insects"), act("court", "cover")],
        "summer": [act("shelter", "cover", goal="underground in the dry months"), act("rear", "cover", goal="eggs underground, guarded")],
        "fall": [act("forage", "insects", goal="out with the rains")],
    },
    "ariolimax_columbianus": {
        "winter": [act("shelter", "cover", goal="under logs in the cold")],
        "spring": [act("forage", "grass_forbs", goal="leaves, fungi and dead plants"), act("court", goal="mating in a coil of slime")],
        "summer": [act("forage", "grass_forbs"), act("shelter", "cover", goal="estivates in dry spells")],
        "fall": [act("forage", "grass_forbs", goal="mushrooms after the rains"), act("rear", "cover", goal="eggs laid in the duff")],
    },
    "ardea_herodias": {
        "winter": [act("hunt", "water", goal="stands motionless in the shallows for fish")],
        "spring": [act("nest", "cliff_or_snag", goal="a colony of stick nests in tall trees")],
        "summer": [act("rear", "water", goal="feeds fish and frogs to the young"), act("hunt", "peromyscus_maniculatus")],
        "fall": [act("hunt", "water")],
    },
    "mergus_merganser": {
        "winter": [act("hunt", "water", goal="flocks diving for fish in the river")],
        "spring": [act("nest", "cavity", goal="a tree cavity near the river")],
        "summer": [act("rear", "water", goal="the hen leads her brood downriver")],
        "fall": [act("hunt", "water")],
    },
    # ---- the second Hoh batch (2026-11-06) ----
    "turdus_migratorius": {
        "winter": [act("forage", "insects", goal="worms and berries on the meadows and bars")],
        "spring": [act("nest", "cover", goal="a mud cup in a young conifer")],
        "summer": [act("forage", "insects", "browse")],
        "fall": [act("forage", "insects")],
    },
    "sturnus_vulgaris": {
        "winter": [act("forage", "insects", goal="probing the grass in flocks")],
        "spring": [act("nest", "cavity", goal="an old woodpecker hole")],
        "summer": [act("forage", "insects", "grass_forbs")],
        "fall": [act("forage", "insects")],
    },
    "ixoreus_naevius": {
        "winter": [act("forage", "insects", goal="turning the litter on the dark forest floor")],
        "spring": [act("nest", "cover", goal="a cup in a small conifer")],
        "summer": [act("forage", "insects", "browse")],
        "fall": [act("forage", "insects")],
    },
    "junco_hyemalis": {
        "winter": [act("forage", "grass_forbs", goal="seeds on the ground in flocks")],
        "spring": [act("nest", "cover", goal="a ground nest under a bank or root")],
        "summer": [act("forage", "grass_forbs", "insects")],
        "fall": [act("forage", "grass_forbs")],
    },
    "regulus_satrapa": {
        "winter": [act("forage", "insects", goal="gleaning the conifer needles high up")],
        "spring": [act("nest", "cover", goal="a hanging moss nest high in a conifer")],
        "summer": [act("forage", "insects", "insects")],
        "fall": [act("forage", "insects")],
    },
    "empidonax_difficilis": {
        "winter": [act("hunt", "insects", goal="sallies from a shaded perch after flying insects")],
        "spring": [act("nest", "cover", goal="a moss cup on a stump or root wad")],
        "summer": [act("hunt", "insects", "insects")],
        "fall": [act("hunt", "insects")],
    },
    "megascops_kennicottii": {
        "winter": [act("hunt", "peromyscus_maniculatus", goal="mice and big insects from a low perch at night")],
        "spring": [act("nest", "cavity", goal="a hole in a broadleaf tree")],
        "summer": [act("hunt", "peromyscus_maniculatus", "insects")],
        "fall": [act("hunt", "peromyscus_maniculatus")],
    },
    "aegolius_acadicus": {
        "winter": [act("hunt", "peromyscus_maniculatus", goal="mice and shrews at night")],
        "spring": [act("nest", "cavity", goal="an old woodpecker hole")],
        "summer": [act("hunt", "peromyscus_maniculatus", "sorex_monticolus")],
        "fall": [act("hunt", "peromyscus_maniculatus")],
    },
    "leuconotopicus_villosus": {
        "winter": [act("forage", "insects", goal="chisels beetle larvae from the bark")],
        "spring": [act("nest", "cavity", goal="excavates a cavity in a snag")],
        "summer": [act("forage", "insects", "cavity")],
        "fall": [act("forage", "insects")],
    },
    "pandion_haliaetus": {
        "winter": [act("hunt", "water", goal="plunges feet first for fish")],
        "spring": [act("nest", "cliff_or_snag", goal="a stick nest on a broken-top snag")],
        "summer": [act("hunt", "water", "water")],
        "fall": [act("hunt", "water")],
    },
    "accipiter_striatus": {
        "winter": [act("hunt", "troglodytes_pacificus", goal="ambushes small birds in the forest")],
        "spring": [act("nest", "cover", goal="a nest in a dense young conifer")],
        "summer": [act("hunt", "troglodytes_pacificus", "junco_hyemalis")],
        "fall": [act("hunt", "troglodytes_pacificus")],
    },
    "falco_columbarius": {
        "winter": [act("hunt", "junco_hyemalis", goal="chases small birds in fast low flight")],
        "spring": [act("nest", "cliff_or_snag", goal="an old crow nest")],
        "summer": [act("hunt", "junco_hyemalis", "sturnus_vulgaris")],
        "fall": [act("hunt", "junco_hyemalis")],
    },
    "larus_glaucescens": {
        "winter": [act("forage", "carrion", goal="salmon carcasses on the river bars")],
        "spring": [act("shelter", "cliff_or_snag", goal="roosts on the gravel bars")],
        "summer": [act("forage", "carrion", "water")],
        "fall": [act("forage", "carrion")],
    },
    "larus_californicus": {
        "winter": [act("forage", "carrion", goal="along the river in fall and winter")],
        "spring": [act("shelter", "cliff_or_snag", goal="roosts on the gravel bars")],
        "summer": [act("forage", "carrion", "insects")],
        "fall": [act("forage", "carrion")],
    },
    "larus_occidentalis": {
        "winter": [act("forage", "carrion", goal="up the river from the coast")],
        "spring": [act("shelter", "cliff_or_snag", goal="roosts on the gravel bars")],
        "summer": [act("forage", "carrion", "water")],
        "fall": [act("forage", "carrion")],
    },
    "anas_platyrhynchos": {
        "winter": [act("forage", "grass_forbs", goal="dabbling in quiet water")],
        "spring": [act("nest", "cover", goal="a ground nest in tall grass near water")],
        "summer": [act("forage", "grass_forbs", "water")],
        "fall": [act("forage", "grass_forbs")],
    },
    "dendragapus_fuliginosus": {
        "winter": [act("forage", "browse", goal="conifer needles in winter, berries and leaves in summer")],
        "spring": [act("court", "cover", goal="the male hoots from a tall conifer")],
        "summer": [act("forage", "browse", "grass_forbs")],
        "fall": [act("forage", "browse")],
    },
    "marmota_olympus": {
        "winter": [act("forage", "grass_forbs", goal="grazes the subalpine meadow flowers")],
        "spring": [act("shelter", "burrow", goal="hibernates in the colony burrow October to May")],
        "summer": [act("forage", "grass_forbs", "grass_forbs")],
        "fall": [act("forage", "grass_forbs")],
    },
    "tamias_amoenus": {
        "winter": [act("forage", "grass_forbs", goal="seeds, berries and fungi in the open subalpine forest")],
        "spring": [act("cache", "burrow", goal="a larder of seeds in its burrow")],
        "summer": [act("forage", "grass_forbs", "browse")],
        "fall": [act("forage", "grass_forbs")],
    },
    "sorex_monticolus": {
        "winter": [act("hunt", "insects", goal="insects and spiders in the litter, day and night")],
        "spring": [act("shelter", "burrow", goal="runways under the litter and snow")],
        "summer": [act("hunt", "insects", "insects")],
        "fall": [act("hunt", "insects")],
    },
    "anaxyrus_boreas": {
        "winter": [act("forage", "insects", goal="walks the meadows at dusk eating insects")],
        "spring": [act("rear", "water", goal="eggs in strings in shallow ponds")],
        "summer": [act("forage", "insects", "insects")],
        "fall": [act("forage", "insects")],
    },
    "rana_cascadae": {
        "winter": [act("forage", "insects", goal="at the edges of the subalpine ponds")],
        "spring": [act("rear", "water", goal="eggs in the ponds as the snow melts")],
        "summer": [act("forage", "insects", "insects")],
        "fall": [act("forage", "insects")],
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
    "cervus_canadensis":        {"sight": 400, "sound": 300, "scent": 300},  # a bull's bugle carries a kilometre in the rut (not counted)
    "tamiasciurus_douglasii":   {"sight": 60, "sound": 300, "scent": 30},    # its scolding chatter
    "troglodytes_pacificus":    {"sight": 10, "sound": 300, "scent": 5},     # tiny and hidden; the song carries far
    "perisoreus_canadensis":    {"sight": 150, "sound": 200, "scent": 5},
    "poecile_rufescens":        {"sight": 30, "sound": 120, "scent": 5},
    "strix_varia":              {"sight": 80, "sound": 800, "scent": 5},     # the call at night
    "megaceryle_alcyon":        {"sight": 200, "sound": 400, "scent": 5},    # the rattle along the river
    "haliaeetus_leucocephalus": {"sight": 1500, "sound": 200, "scent": 5},
    "corvus_brachyrhynchos":    {"sight": 400, "sound": 600, "scent": 5},
    "lynx_rufus":               {"sight": 50, "sound": 15, "scent": 250},
    "lontra_canadensis":        {"sight": 100, "sound": 60, "scent": 300},
    "lepus_americanus":         {"sight": 40, "sound": 10, "scent": 80},
    "tamias_townsendii":        {"sight": 20, "sound": 60, "scent": 30},
    "peromyscus_maniculatus":   {"sight": 5, "sound": 5, "scent": 40},
    "plethodon_vehiculum":      {"sight": 1, "sound": 0, "scent": 3},
    "ensatina_eschscholtzii":   {"sight": 1, "sound": 0, "scent": 3},
    "ariolimax_columbianus":    {"sight": 2, "sound": 0, "scent": 5},
    "ardea_herodias":           {"sight": 400, "sound": 150, "scent": 5},
    "mergus_merganser":         {"sight": 300, "sound": 50, "scent": 5},
    "turdus_migratorius": {"sight": 150, "sound": 400, "scent": 5},
    "sturnus_vulgaris": {"sight": 60, "sound": 150, "scent": 5},
    "ixoreus_naevius": {"sight": 60, "sound": 500, "scent": 5},
    "junco_hyemalis": {"sight": 60, "sound": 150, "scent": 5},
    "regulus_satrapa": {"sight": 60, "sound": 150, "scent": 5},
    "empidonax_difficilis": {"sight": 60, "sound": 150, "scent": 5},
    "megascops_kennicottii": {"sight": 30, "sound": 400, "scent": 5},
    "aegolius_acadicus": {"sight": 30, "sound": 400, "scent": 5},
    "leuconotopicus_villosus": {"sight": 100, "sound": 300, "scent": 5},
    "pandion_haliaetus": {"sight": 1200, "sound": 300, "scent": 5},
    "accipiter_striatus": {"sight": 200, "sound": 100, "scent": 5},
    "falco_columbarius": {"sight": 300, "sound": 150, "scent": 5},
    "larus_glaucescens": {"sight": 1000, "sound": 500, "scent": 10},
    "larus_californicus": {"sight": 1000, "sound": 500, "scent": 10},
    "larus_occidentalis": {"sight": 1000, "sound": 500, "scent": 10},
    "anas_platyrhynchos": {"sight": 300, "sound": 300, "scent": 10},
    "dendragapus_fuliginosus": {"sight": 60, "sound": 600, "scent": 20},
    "marmota_olympus": {"sight": 200, "sound": 600, "scent": 100},
    "tamias_amoenus": {"sight": 60, "sound": 150, "scent": 5},
    "sorex_monticolus": {"sight": 3, "sound": 5, "scent": 30},
    "anaxyrus_boreas": {"sight": 3, "sound": 100, "scent": 3},
    "rana_cascadae": {"sight": 3, "sound": 100, "scent": 3},
}
# (the black bear gives no alarm call others heed: not in ALARM_CALL)
ALARM_CALL = {"aphelocoma_californica": 400, "cyanocitta_stelleri": 400, "melanerpes_formicivorus": 400, "corvus_corax": 700,
              "meleagris_gallopavo": 300, "callipepla_californica": 250, "otospermophilus_beecheyi": 200, "sciurus_griseus": 150,
              "odocoileus_hemionus": 60, "oreortyx_pictus": 150,
              # the Hoh batch: the crows' and the jays' mobbing, the chickadees' and the squirrel's scolding, the elk's bark
              "corvus_brachyrhynchos": 500, "perisoreus_canadensis": 250, "poecile_rufescens": 100, "tamiasciurus_douglasii": 150,
              "cervus_canadensis": 200}
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
    "cervus_canadensis":        {"water": "daily", "shelter": "cover", "court": "grass_forbs"},
    "tamiasciurus_douglasii":   {"water": "often", "shelter": "cavity", "court": "cavity"},
    "troglodytes_pacificus":    {"water": "often", "shelter": "cover", "court": "cover"},
    "perisoreus_canadensis":    {"water": "often", "shelter": "cover", "court": "cover"},
    "poecile_rufescens":        {"water": "often", "shelter": "cavity", "court": "cavity"},
    "strix_varia":              {"water": "rare", "shelter": "cliff_or_snag", "court": "cavity"},
    "megaceryle_alcyon":        {"water": "daily", "shelter": "burrow", "court": "water"},
    "haliaeetus_leucocephalus": {"water": "often", "shelter": "cliff_or_snag", "court": "cliff_or_snag"},
    "corvus_brachyrhynchos":    {"water": "daily", "shelter": "cover", "court": "cover"},
    "lynx_rufus":               {"water": "often", "shelter": "cover", "court": "cover"},
    "lontra_canadensis":        {"water": "daily", "shelter": "burrow", "court": "water"},
    "lepus_americanus":         {"water": "rare", "shelter": "cover", "court": "cover"},
    "tamias_townsendii":        {"water": "often", "shelter": "burrow", "court": "burrow"},
    "peromyscus_maniculatus":   {"water": "rare", "shelter": "burrow", "court": "burrow"},
    "plethodon_vehiculum":      {"water": "none", "shelter": "cover", "court": "cover"},
    "ensatina_eschscholtzii":   {"water": "none", "shelter": "cover", "court": "cover"},
    "ariolimax_columbianus":    {"water": "none", "shelter": "cover", "court": "cover"},
    "ardea_herodias":           {"water": "daily", "shelter": "cliff_or_snag", "court": "cliff_or_snag"},
    "mergus_merganser":         {"water": "daily", "shelter": "cavity", "court": "water"},
    "turdus_migratorius": {"water": "often", "shelter": "cover", "court": "cover"},
    "sturnus_vulgaris": {"water": "often", "shelter": "cavity", "court": "cover"},
    "ixoreus_naevius": {"water": "often", "shelter": "cover", "court": "cover"},
    "junco_hyemalis": {"water": "often", "shelter": "cover", "court": "cover"},
    "regulus_satrapa": {"water": "often", "shelter": "cover", "court": "cover"},
    "empidonax_difficilis": {"water": "often", "shelter": "cover", "court": "cover"},
    "megascops_kennicottii": {"water": "often", "shelter": "cavity", "court": "cover"},
    "aegolius_acadicus": {"water": "often", "shelter": "cavity", "court": "cover"},
    "leuconotopicus_villosus": {"water": "often", "shelter": "cavity", "court": "cover"},
    "pandion_haliaetus": {"water": "daily", "shelter": "cliff_or_snag", "court": "cover"},
    "accipiter_striatus": {"water": "often", "shelter": "cover", "court": "cover"},
    "falco_columbarius": {"water": "often", "shelter": "cliff_or_snag", "court": "cover"},
    "larus_glaucescens": {"water": "often", "shelter": "cliff_or_snag", "court": "cover"},
    "larus_californicus": {"water": "often", "shelter": "cliff_or_snag", "court": "cover"},
    "larus_occidentalis": {"water": "often", "shelter": "cliff_or_snag", "court": "cover"},
    "anas_platyrhynchos": {"water": "daily", "shelter": "cover", "court": "cover"},
    "dendragapus_fuliginosus": {"water": "often", "shelter": "cover", "court": "cover"},
    "marmota_olympus": {"water": "often", "shelter": "burrow", "court": "cover"},
    "tamias_amoenus": {"water": "often", "shelter": "cover", "court": "cover"},
    "sorex_monticolus": {"water": "none", "shelter": "burrow", "court": "cover"},
    "anaxyrus_boreas": {"water": "daily", "shelter": "cover", "court": "cover"},
    "rana_cascadae": {"water": "daily", "shelter": "cover", "court": "cover"},
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
    # the Hoh batch (2026-11-05): the hunters of the small ones here; the fish of the river are not in the world yet
    # (the otter's, the kingfisher's, the mergansers' and much of the heron's and the eagle's food)
    "lynx_rufus":               {"prey": ["lepus_americanus", "peromyscus_maniculatus", "tamias_townsendii", "tamiasciurus_douglasii",
                                          "microtus_californicus", "sylvilagus_bachmani"]},
    "strix_varia":              {"prey": ["peromyscus_maniculatus", "tamias_townsendii", "tamiasciurus_douglasii", "plethodon_vehiculum",
                                          "ensatina_eschscholtzii", "troglodytes_pacificus", "lepus_americanus"]},
    "haliaeetus_leucocephalus": {"prey": ["mergus_merganser"], "carrion": ["cervus_canadensis", "odocoileus_hemionus"]},
    "corvus_brachyrhynchos":    {"prey": ["plethodon_vehiculum", "peromyscus_maniculatus"], "carrion": ["cervus_canadensis", "lynx_rufus"]},
    "ardea_herodias":           {"prey": ["peromyscus_maniculatus", "plethodon_vehiculum"]},
    "perisoreus_canadensis":    {"carrion": ["cervus_canadensis", "odocoileus_hemionus"], "plants": ["insects", "browse"]},
    "megascops_kennicottii":    {"prey": ["peromyscus_maniculatus", "sorex_monticolus", "plethodon_vehiculum"]},
    "aegolius_acadicus":        {"prey": ["peromyscus_maniculatus", "sorex_monticolus", "tamias_townsendii"]},
    "accipiter_striatus":       {"prey": ["troglodytes_pacificus", "junco_hyemalis", "poecile_rufescens", "regulus_satrapa", "turdus_migratorius"]},
    "falco_columbarius":        {"prey": ["junco_hyemalis", "sturnus_vulgaris", "turdus_migratorius", "poecile_rufescens"]},
    "larus_glaucescens":        {"carrion": ["cervus_canadensis"]},
    "larus_occidentalis":       {"carrion": ["cervus_canadensis"]},
    "larus_californicus":       {"carrion": ["cervus_canadensis"]},
}
