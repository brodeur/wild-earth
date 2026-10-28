"""Games: what each species on a tile has to do, found and classified from the data already in the package.

A game is a calendar activity (species_data.CALENDAR: a verb, the resources it needs, a goal) turned into a loop the
player can play: an actor, a need, a resource (a seasonal resource raster, or another species), an opposition, and a
place. This step reads the tile's species list, the calendar, the perception matrix and the nine seasonal resource
rasters (resources.py) and writes `games.json`: per species, its games by season, each classified by archetype, unit
(solitary or collective, and which collective: herd, covey, flock, family, colony, pair, mother and young), where it is
played (hotspots: the best-scoring cells of its resource that season, as tile metres), how tight it is (scarcity: the
share of the tile where the resource scores under 50), and who stands in the way (predators, from the other species'
hunt lists; competitors, the species after the same resource the same season) or helps (scavengers following a predator
to kills; watchers, species that perceive a predator this one cannot). The relations among species (predation,
competition, scavenging, alarm) are written once for the tile too. Nothing here is hand-listed per tile: a species that
is not in the tile's list has no games there, a resource the tile lacks makes no hotspots, and a new species in the
calendar gets its games the same way. docs/games.md has the design and the archetypes.
"""
from __future__ import annotations
import numpy as np
import rasterio
from .config import Tile, now_iso, read_json, write_json
from .habitat import RESOURCE_BASE
from .species_data import CALENDAR, DIET, NEEDS, PERCEPTION, SEASONS

# verb -> archetype: the loop the client plays it as (docs/games.md)
ARCHETYPE = {"forage": "gather", "graze": "gather", "hunt": "hunt", "cache": "cache", "shelter": "shelter", "den": "shelter",
             "nest": "shelter", "roost": "shelter", "court": "court", "rear": "rear", "disperse": "disperse"}
# how each species moves as a unit (animals.js groups); anything else is solitary
UNIT = {"odocoileus_hemionus": "herd", "callipepla_californica": "covey", "meleagris_gallopavo": "flock",
        "melanerpes_formicivorus": "family", "aphelocoma_californica": "family", "cyanocitta_stelleri": "family",
        "otospermophilus_beecheyi": "colony", "corvus_corax": "pair", "puma_concolor": "mother_and_young"}
ARCHETYPES = {
    "gather": "find the resource's hotspots, feed, keep an eye out: the predators listed hunt here; the competitors eat the same cells",
    "drink": "reach water on a rhythm; in summer the few sources draw every species, and the ambush predators, together",
    "hunt": "find the prey (perception), close unseen, strike; the prey's game is its dual: evade",
    "evade": "notice the predator before it is close (perception, the watchers' alarms), reach cover, keep the group together",
    "cache": "store the resource in its season, recover it later; the competitors pilfer; a family's granary is defended together",
    "shelter": "be in cover, a cavity, a burrow or a roost before dusk, a storm or a predator; the weather sets the pressure",
    "court": "find and win a mate in the season: display, call, chase",
    "rear": "keep the young fed and alive through the season: an escort game, collective where the young travel with the group",
    "disperse": "leave the natal range and find an empty territory: a map-scale game",
    "watch": "the collective's sentinel: someone looks up while the rest feed; an alarm sends everyone to cover",
}
HOT_FLOOR, HOT_PCT, HOT_N, HOT_SEP_M = 40, 97, 12, 150   # a hotspot cell is in the resource's top (100 - HOT_PCT)% that season and scores at least HOT_FLOOR; at most HOT_N per game, HOT_SEP_M apart


def _hotspots(arr: np.ndarray, transform, res: float) -> list[list[float]]:
    """The best cells, as [x, north, score] in tile metres, the first the best, none nearer HOT_SEP_M to a better one."""
    ys, xs = np.nonzero(arr >= max(HOT_FLOOR, float(np.percentile(arr, HOT_PCT))))
    if not len(ys):
        return []
    order = np.argsort(-arr[ys, xs], kind="stable")
    out: list[list[float]] = []
    for k in order:
        x = transform.c + (xs[k] + 0.5) * res; north = transform.f - (ys[k] + 0.5) * res
        if any((x - o[0]) ** 2 + (north - o[1]) ** 2 < HOT_SEP_M ** 2 for o in out):
            continue
        out.append([round(x, 1), round(north, 1), int(arr[ys[k], xs[k]])])
        if len(out) >= HOT_N:
            break
    return out


def derive_games(tile: Tile) -> dict:
    present = [s["code"] for s in read_json(tile.path("species/species.json"))]
    codes = [c for c in present if c in CALENDAR]
    perceives = read_json(tile.path("perception.json")).get("perceives", {}) if tile.path("perception.json").exists() else PERCEPTION
    # the resource rasters: per resource and season, the hotspots and the scarcity
    rasters: dict[str, dict[str, dict]] = {}
    for r in RESOURCE_BASE:
        p = tile.path(f"resources/{r}.tif")
        if not p.exists():
            continue
        with rasterio.open(p) as src:
            rasters[r] = {}
            for b, season in enumerate(SEASONS):
                a = src.read(b + 1).astype("float32")
                rasters[r][season] = {"hotspots": _hotspots(a, src.transform, src.res[0]),
                                      "scarcity": round(float((a < 50).mean()), 3), "mean": round(float(a.mean()), 1)}
    # relations: who hunts whom (DIET's prey, plus a species named as a resource of a hunt or fed to the young in the
    # calendar), who eats what when, who follows a predator to kills (DIET's carrion, plus a hunter named as a resource
    # of a forage in the calendar)
    hunters = {c for c in codes if any(a["activity"] == "hunt" for acts in CALENDAR[c].values() for a in acts)} | {c for c in codes if DIET.get(c, {}).get("prey")}
    predation = [[c, q] for c in codes for q in DIET.get(c, {}).get("prey", []) if q in codes]
    scavenge = [[c, q] for c in codes for q in DIET.get(c, {}).get("carrion", []) if q in codes]
    competition: dict[str, dict[str, list[str]]] = {}
    for c in codes:
        for season, acts in CALENDAR[c].items():
            for a in acts:
                for r in a["resources"]:
                    if r in RESOURCE_BASE:
                        competition.setdefault(r, {}).setdefault(season, [])
                        if c not in competition[r][season]:
                            competition[r][season].append(c)
                    elif r in codes:
                        pair = [c, r]
                        if r in hunters and a["activity"] == "forage":
                            if pair not in scavenge:
                                scavenge.append(pair)
                        elif pair not in predation:
                            predation.append(pair)
    predators_of = {c: sorted({p for p, q in predation if q == c}) for c in codes}
    prey_of = {c: sorted({q for p, q in predation if p == c}) for c in codes}
    # alarm: a watcher perceives a predator of this species that it cannot perceive itself (perception.json)
    alarm: list[list[str]] = []
    for c in codes:
        seen = set(perceives.get(c, []))
        for pred in predators_of[c]:
            if pred in seen:
                continue
            for w in codes:
                if w != c and w != pred and pred in perceives.get(w, []) and c in perceives.get(w, []):
                    alarm.append([w, c, pred])
    species: dict[str, dict] = {}
    for c in codes:
        unit = UNIT.get(c, "solitary"); games = []
        for season, acts in CALENDAR[c].items():
            for a in acts:
                verb = a["activity"]; arch = ARCHETYPE.get(verb, verb)
                res_r = [r for r in a["resources"] if r in RESOURCE_BASE]
                prey = [r for r in a["resources"] if r in codes]
                for r in res_r or [None]:
                    g = {"id": f"{c}:{season}:{verb}" + (f":{r}" if r else ""), "archetype": arch, "verb": verb, "season": season,
                         "unit": unit, "collective": unit != "solitary"}
                    if a.get("goal"):
                        g["goal"] = a["goal"]
                    if not r and arch == "court" and NEEDS.get(c, {}).get("court"):   # the courting ground (NEEDS)
                        r = NEEDS[c]["court"]
                    if r:
                        g["resource"] = r
                        rr = rasters.get(r, {}).get(season)
                        if rr:
                            g["hotspots"] = rr["hotspots"]; g["scarcity"] = rr["scarcity"]
                        g["competitors"] = [o for o in competition.get(r, {}).get(season, []) if o != c]
                    if prey:
                        g["prey"] = [q for q in prey if q in prey_of[c]] or prey
                    if arch in ("gather", "cache", "shelter", "rear", "court") and predators_of[c]:
                        g["predators"] = predators_of[c]
                    games.append(g)
        # the needs (NEEDS): drink, for a species that uses open water, every season; shelter, in the seasons the
        # calendar gives it none
        need = NEEDS.get(c, {})
        for season in SEASONS:
            have = {g["archetype"] for g in games if g["season"] == season}
            if need.get("water") in ("daily", "often", "rare") and "drink" not in have:
                rr = rasters.get("water", {}).get(season, {})
                g = {"id": f"{c}:{season}:drink", "archetype": "drink", "verb": "drink", "season": season, "unit": unit,
                     "collective": unit != "solitary", "resource": "water", "rhythm": need["water"],
                     "hotspots": rr.get("hotspots", []), "scarcity": rr.get("scarcity"),
                     "competitors": [o for o in codes if o != c and NEEDS.get(o, {}).get("water") in ("daily", "often")]}
                if predators_of[c]:
                    g["predators"] = predators_of[c]
                games.append(g)
            if need.get("shelter") and "shelter" not in have:
                r = need["shelter"]; rr = rasters.get(r, {}).get(season, {})
                g = {"id": f"{c}:{season}:shelter:{r}", "archetype": "shelter", "verb": "shelter", "season": season, "unit": unit,
                     "collective": unit != "solitary", "resource": r, "hotspots": rr.get("hotspots", []), "scarcity": rr.get("scarcity"),
                     "competitors": [o for o in codes if o != c and NEEDS.get(o, {}).get("shelter") == r]}
                if predators_of[c]:
                    g["predators"] = predators_of[c]
                games.append(g)
        # the duals and the collective's own games
        for pred in predators_of[c]:
            games.append({"id": f"{c}:{pred}:evade", "archetype": "evade", "verb": "evade", "season": "all", "unit": unit,
                          "collective": unit != "solitary", "predator": pred,
                          "watchers": sorted({w for w, b, p in alarm if b == c and p == pred})})
        if unit != "solitary" and predators_of[c]:
            games.append({"id": f"{c}:watch", "archetype": "watch", "verb": "watch", "season": "all", "unit": unit, "collective": True,
                          "predators": predators_of[c]})
        species[c] = {"unit": unit, "predators": predators_of[c], "prey": prey_of[c], "games": games}
    out = {"generated": now_iso(), "tile_id": tile.tile_id, "archetypes": ARCHETYPES,
           "relations": {"predation": predation, "competition": competition, "scavenge": scavenge, "alarm": alarm},
           "resources": {r: {s: {"scarcity": v["scarcity"], "mean": v["mean"], "hotspots": len(v["hotspots"])} for s, v in d.items()} for r, d in rasters.items()},
           "species": species}
    write_json(tile.path("games.json"), out)
    n = sum(len(s["games"]) for s in species.values())
    return {"path": "games.json", "kind": "json", "species": len(species), "games": n,
            "collective": sum(1 for s in species.values() for g in s["games"] if g["collective"]),
            "predation_pairs": len(predation), "alarm_links": len(alarm)}
