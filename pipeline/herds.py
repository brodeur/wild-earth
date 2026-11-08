"""Herds: where a tile's herding animals gather, season by season, and in herds of what size (client/herds.json).

The cast's herd species (a fauna slot of the 'grazing or browsing herd' archetype, and the client's own elk and mule deer)
spawned as one small group per lucky 30 m cell, sized by PanTHERIA's species-mean social group and spread by its
species-mean density. Real grazers do not spread evenly: the same animals gather on the open, low, watered ground of
their seasonal ranges, and the denser they stand there the larger the groups they form. Lamar's bison in July are a few
herds of hundreds on the valley floor, not a few dozen groups of twenty over the whole tile.

The rule, per herd species and season:
  N        the animals on the tile: density x land area. Density is the slot's (PanTHERIA species mean) unless
           library/herds/tiles.json records a count for this tile (a per-tile fine-tune, with its source).
  range    the seasonal range on the 30 m grid: suitability S = forage x open^2 x water x gentle x low^w, where
             forage  the season's grass and forbs or browse score (client/res_grass_forbs.png, res_browse.png),
             open    1 - tree cover (client/canopy.png),
             water   0.4 + 0.6 x the season's water score (client/res_water.png: 100 at water, 0 at 500 m),
             gentle  1 - slope / 30 deg on the 30 m heights,
             low     1 - the cell's height within its 1.5 km neighbourhood (valley floors high), weighted w by season
                     (winter 2: the snow drives them down; spring 1.5; fall 1; summer 0.7);
           a species whose fine-tune says terrain 'steep' (library/herds/species.json: bighorn, goats) takes the
           slopes instead (25-50 deg high, no valley floor term). The range is the cells holding the best 80 % of S.
  group    the typical herd: G = g0 x sqrt(D_r / D0), where g0 and D0 are PanTHERIA's social group size and density
           (the group seen at that density) and D_r = N / range area is the density where they actually stand.
           Group size rising with local density, about as its square root, is the fission-fusion result seen in
           ungulates (bison: Fortin et al. 2009, Ecology 90: 2480-2490; chamois: Pepin and Gerard 2008, Animal
           Behaviour 75: 361-369; red deer: Clutton-Brock et al. 1982).
  herds    sizes drawn lognormal about G (sigma 0.7, the spread of ungulate group sizes) until N is used; the
           largest goes to the best spot of the range, each next one to the best spot clear of the others
           (2 radii + 150 m). A herd's radius is sqrt(n x a / pi), a = (4 body lengths)^2 x 1.3, the body length
           0.32 x mass^(1/3) m (a bison's 2.6 m, an elk's 2.0 m).
  emitted  only when the typical herd G is larger than the client's own group for that species (the kin machine's
           n, or the slot's `group`) and PanTHERIA's group is at least 3: below it, the client's cell spawns already
           draw the groups this rule would, so a mule deer on a foothill tile or a moose stays exactly as it was.
           One herd is at most HERD_MAX (400), the frame budget's ceiling, not biology's (rut aggregations run past
           a thousand).

Seeds come from the tile id, the code and the season, so a rebuild places the same herds.
"""
from __future__ import annotations

import hashlib
import json
import math

import numpy as np
from PIL import Image

from .config import REPO_ROOT, Tile, write_json

LIB = REPO_ROOT / "library" / "herds"
ARCHETYPE = "grazing or browsing herd"
SEASONS = ["winter", "spring", "summer", "fall"]       # the resource rasters' channel order (pipeline/habitat.py)
LOW_W = {"winter": 2.0, "spring": 1.5, "summer": 0.7, "fall": 1.0}
SIGMA = 0.7
HERD_MAX = 400                                          # the ceiling on one herd: the frame budget's (animals.js HERD_MAX)
SOCIAL_MIN = 3                                          # PanTHERIA group under this: solitary or paired, never planned
# the client's own herd species (static slots) and their kin machine's largest group (animals.js spawnCell: elk 5-16,
# deer 3-6), and the scientific name PanTHERIA knows them by
STATIC = {"cervus_canadensis": {"scientific": "Cervus canadensis", "n": 16, "mass_kg": 300.0},
          "odocoileus_hemionus": {"scientific": "Odocoileus hemionus", "n": 6, "mass_kg": 75.0}}
FORMAT = 1


def _png(tile: Tile, rel: str) -> np.ndarray | None:
    p = tile.path(rel)
    if not p.exists():
        return None
    return np.asarray(Image.open(p).convert("RGBA" if rel.startswith("client/res_") else "RGB"))


def _heights(tile: Tile, n: int) -> np.ndarray:
    """The drawn heights (client/heights.png, Mapbox terrain-RGB) box-averaged onto the n x n habitat grid."""
    rgb = np.asarray(Image.open(tile.path("client/heights.png")).convert("RGB")).astype("float64")
    h = -10000 + (rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]) * 0.1
    return np.asarray(Image.fromarray(h.astype("float32"), "F").resize((n, n), Image.BOX), "float64")


def _window_min_max(h: np.ndarray, r: int) -> tuple[np.ndarray, np.ndarray]:
    """Each cell's neighbourhood (2r+1 square) min and max, by separable running passes."""
    def run(a, fn, axis):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode="edge")
        out = a.copy()
        for k in range(2 * r + 1):
            sl = [slice(None), slice(None)]
            sl[axis] = slice(k, k + a.shape[axis])
            out = fn(out, p[tuple(sl)])
        return out
    lo = run(run(h, np.minimum, 0), np.minimum, 1)
    hi = run(run(h, np.maximum, 0), np.maximum, 1)
    return lo, hi


def _blur(a: np.ndarray, r: int) -> np.ndarray:
    """A box mean over (2r+1)^2 by cumulative sums (the suitability as a herd of that radius feels it)."""
    if r <= 0:
        return a
    p = np.pad(a, r, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def body_length_m(mass_kg: float) -> float:
    return 0.32 * max(mass_kg, 1.0) ** (1 / 3)


def herd_radius_m(n: int, mass_kg: float) -> float:
    a = (4 * body_length_m(mass_kg)) ** 2 * 1.3
    return math.sqrt(max(n, 1) * a / math.pi)


def _rng(*parts) -> np.random.Generator:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def herd_sizes(N: int, G: float, rng: np.random.Generator) -> list[int]:
    """Herd sizes lognormal about G (mean G) summing to N, largest first."""
    out, left = [], int(N)
    while left > 0:
        g = int(round(G * math.exp(SIGMA * rng.standard_normal() - SIGMA * SIGMA / 2)))
        g = max(1, min(HERD_MAX, g, left))
        out.append(g)
        left -= g
    return sorted(out, reverse=True)


def suitability(grids: dict, season: str, guild: str = "herd") -> np.ndarray:
    """The seasonal range's suitability per 30 m cell for a guild: 'herd' (grazing ungulates), 'steep' (escape-terrain
    sheep and goats), and the flocking birds' 'grazer' (geese, cranes: open grass and wet meadow near water, low),
    'water' (ducks, coots, pelicans: on open water) and 'field' (blackbirds, starlings: open fields and grass)."""
    si = SEASONS.index(season)
    hab, tree = grids["habitat"], grids["tree"]
    forage = np.maximum(grids["grass"][..., si], grids["browse"][..., si]) / 100.0
    open_ = 1.0 - tree / 100.0
    wscore = grids["water"][..., si] / 100.0
    water = 0.4 + 0.6 * wscore
    slope = grids["slope"]
    gentle = np.clip(1 - slope / 30.0, 0, 1)
    if guild == "steep":
        terrain = np.clip((slope - 15) / 10, 0, 1) * np.clip((55 - slope) / 10, 0, 1)
        S = (0.3 + forage) * (0.3 + 0.7 * open_) * terrain
    elif guild == "grazer":
        S = (grids["grass"][..., si] / 100.0) * open_ ** 2 * (0.15 + 0.85 * wscore ** 1.5) * gentle * grids["low"] ** LOW_W[season]
    elif guild == "water":
        wet = (hab == 7) | (wscore >= 0.97)
        return np.where(wet & (hab != 0), 0.5 + 0.5 * open_, 0.0)
    elif guild == "field":
        S = (grids["grass"][..., si] / 100.0) * open_ * gentle * (0.5 + 0.5 * wscore)
    else:
        S = forage * open_ ** 2 * water * gentle * grids["low"] ** LOW_W[season]
    S[(hab == 0) | (hab == 7) | (hab == 9)] = 0       # off the tile, open water, the human footprint's leftovers
    return S


def plan_species(grids: dict, *, tile_id: str, code: str, season: str, density: float, g0: float, d0: float,
                 mass_kg: float, client_n: int, steep: bool = False, res: float, size_m: float, guild: str | None = None,
                 G_fixed: float | None = None, N_max: int | None = None) -> dict | None:
    land = float(((grids["habitat"] != 0) & (grids["habitat"] != 7)).sum()) * res * res / 1e6
    N = int(round(density * land))
    if N_max:
        N = min(N, N_max)
    if N < 2 or g0 <= 0 or d0 <= 0:
        return None
    S = suitability(grids, season, guild or ("steep" if steep else "herd"))
    tot = float(S.sum())
    if tot <= 0:
        return None
    flat = np.sort(S.ravel())[::-1]
    cut = flat[np.searchsorted(np.cumsum(flat), 0.8 * tot)]
    range_km2 = max(float((S >= cut).sum()) * res * res / 1e6, 0.5)
    d_r = N / range_km2
    G = G_fixed if G_fixed else g0 * math.sqrt(max(d_r, d0) / d0)
    G = min(G, HERD_MAX)
    sizes = herd_sizes(N, G, _rng(tile_id, code, season))
    if g0 < SOCIAL_MIN:
        return {"emitted": False, "N": N, "G": round(G, 1), "why": f"PanTHERIA's group {g0:g}: a solitary or paired species does not herd"}
    if G <= client_n:
        return {"emitted": False, "N": N, "G": round(G, 1), "client_n": client_n,
                "why": f"typical herd {G:.1f} within the client's own group ({client_n}): the cell spawns stand"}
    nrow = S.shape[0]
    herds, taken = [], np.zeros_like(S, bool)
    yy, xx = np.mgrid[0:nrow, 0:nrow]
    for k, n in enumerate(sizes):
        r = herd_radius_m(n, mass_kg)
        B = _blur(S, max(1, int(r / res)))
        B[taken] = -1
        j, i = np.unravel_index(int(np.argmax(B)), B.shape)
        if B[j, i] <= 0:
            break
        herds.append({"x": round((i + 0.5) * res, 1), "n": round(size_m - (j + 0.5) * res, 1), "count": int(n),
                      "r": round(r, 1), "s": round(float(B[j, i]), 3)})
        clear = (2 * r + 150) / res
        taken |= (xx - i) ** 2 + (yy - j) ** 2 <= clear * clear
    placed = sum(h["count"] for h in herds)
    return {"emitted": True, "N": N, "placed": placed, "G": round(G, 1), "range_km2": round(range_km2, 2),
            "density_on_range_km2": round(d_r, 2), "largest": herds[0]["count"] if herds else 0, "herds": herds}


def load_grids(tile: Tile) -> dict:
    hab = _png(tile, "client/habitat.png")[..., 0].astype("int32")
    can = _png(tile, "client/canopy.png").astype("float64")
    n = hab.shape[0]
    res = (tile.bounds[2] - tile.bounds[0]) / n
    h = _heights(tile, n)
    gy, gx = np.gradient(h, res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    r = max(1, int(round(750 / res)))
    lo, hi = _window_min_max(h, r)
    low = 1.0 - (h - lo) / (hi - lo + 50.0)
    def res4(name):
        a = _png(tile, f"client/res_{name}.png")
        return a.astype("float64") if a is not None else np.zeros((n, n, 4))
    return {"habitat": hab, "tree": can[..., 0], "grass": res4("grass_forbs"), "browse": res4("browse"),
            "water": res4("water"), "slope": slope, "low": np.clip(low, 0, 1), "h": h, "res": res, "n": n}


# ---- flocks (2026-11-07, Aaron: "Make sure big herds is also applying to big flocks - it would be amazing to see some
# large flocks grazing, or many goose V's flying north or south") ------------------------------------------------------
# The same rule for the flocking birds (library/herds/flocks.json: geese, cranes, ducks, coots, pelicans, blackbirds,
# starlings, matched by genus then family). Per season:
#   N   density x land x the season's share of the bird's open-licence GBIF records (CC0 and CC BY only:
#       fetch_species.monthly_counts_open; the share over a quarter of the year, 0-3, 1 with under 8 records), at most
#       FLOCK_N (the budget's): a migrant away that season has none
#   G   the group's recorded typical flock for the season x sqrt(the share): more birds, bigger flocks
#   the range by the group's guild (suitability: grazer, water or field), herd sizes and placement as for herds, and
#   emitted when G exceeds the client's own group for the slot and is at least FLOCK_MIN (15): pairs and family parties
#   (cranes and ducks in summer) stay with the cell spawns.
# Skeins: a V-flying group (`v`) whose AVONET Migration is 2 or 3 crosses the tile in spring and fall, skeins per hour
# base x migration (3: 1, 2: 0.4) x the season's passage share (0.3-3), each of `skein` birds, heading along the tile's
# valley axis toward north in spring and south in fall, half pulled to true north-south.
FLOCK_N = 1500
FLOCK_MIN = 15          # a typical flock under this is a family party: the cell spawns draw those
SEASON_MONTHS = {"winter": (12, 1, 2), "spring": (3, 4, 5), "summer": (6, 7, 8), "fall": (9, 10, 11)}
SOUTH_SEASON = {"winter": "summer", "summer": "winter", "spring": "fall", "fall": "spring"}
STATIC_BIRDS = {"anas_platyrhynchos": {"scientific": "Anas platyrhynchos", "n": 5, "mass_kg": 1.1},
                "sturnus_vulgaris": {"scientific": "Sturnus vulgaris", "n": 4, "mass_kg": 0.078}}


def flock_group(groups: dict, genus: str | None, family: str | None) -> tuple[str, dict] | tuple[None, None]:
    for name, g in groups.items():
        if genus and genus in (g.get("genus") or []):
            return name, g
    for name, g in groups.items():
        if family and family in (g.get("family") or []) and not g.get("genus"):
            return name, g
    return None, None


def season_shares(months: list[int]) -> dict:
    """The season's share of the year's records over a quarter (1 = an average season); 1 everywhere with under 8."""
    tot = sum(months or [])
    if tot < 8:
        return {s: 1.0 for s in SEASONS}
    return {s: round(min(3.0, sum(months[m - 1] for m in SEASON_MONTHS[s]) / (tot / 4)), 3) for s in SEASONS}


def valley_axis(grids: dict) -> tuple[float, float]:
    """The tile's valley axis as a unit (east, north) vector, north-pointing: the main direction of its lowest fifth."""
    h = grids["h"]; n = h.shape[0]
    jj, ii = np.nonzero(h <= np.percentile(h, 20))
    if len(ii) < 10:
        return (0.0, 1.0)
    X = np.stack([ii.astype(float), -jj.astype(float)])
    X -= X.mean(1, keepdims=True)
    w, v = np.linalg.eigh(X @ X.T)
    e, nn = v[:, int(np.argmax(w))]
    if nn < 0:
        e, nn = -e, -nn
    return (float(e), float(nn))


def skein_plan(axis: tuple[float, float], shares: dict, migration: float, skein: list, cfg: dict) -> dict:
    mig = 1.0 if migration >= 3 else 0.4 if migration >= 2 else 0.0
    if not mig:
        return {}
    out = {}
    for season, sign in (("spring", 1), ("fall", -1)):
        e, n = axis[0] * 0.5, axis[1] * 0.5 + 0.5
        L = math.hypot(e, n) or 1
        e, n = sign * e / L, sign * n / L
        rate = cfg["base_per_hour"] * mig * min(3.0, max(0.3, shares.get(season, 1.0)))
        out[season] = {"per_hour": round(rate, 2), "size": list(skein), "heading_deg": round(math.degrees(math.atan2(e, n)) % 360, 1),
                       "agl_m": cfg["agl_m"], "speed_mps": cfg["speed_mps"]}
    return out


def tile_flocks(tile: Tile, grids: dict, fauna: dict) -> tuple[dict, dict, dict, dict]:
    """(herds by code and season, plan, flock meta by code, skeins by code) for the tile's flocking birds."""
    from . import avonet
    from .fauna_slots import density_km2
    from .fetch_species import match_key, monthly_counts_open
    lib = json.loads((LIB / "flocks.json").read_text())
    groups, skcfg = lib["groups"], lib["skeins"]
    animals = {}
    ap = tile.path("species/animals.json")
    if ap.exists():
        animals = {a["id"]: a for a in json.loads(ap.read_text()).get("animals", [])}
    cands = []
    for s in fauna.get("slots", []):
        if not s.get("bird"):
            continue
        sci = s.get("scientific") or s["code"].replace("_", " ").capitalize()
        name, g = flock_group(groups, sci.split()[0], s.get("family"))
        if g:
            cands.append((s["code"], sci, float(s.get("mass_kg") or 1), int(max(s.get("group") or [1])), s.get("density_km2"), name, g))
    for code, st in STATIC_BIRDS.items():
        if code in (fauna.get("allow") or []):
            av = avonet.lookup(st["scientific"])
            name, g = flock_group(groups, st["scientific"].split()[0], av.get("family"))
            if g:
                cands.append((code, st["scientific"], st["mass_kg"], st["n"], None, name, g))
    res, size_m = grids["res"], tile.bounds[2] - tile.bounds[0]
    south = not tile.north
    axis = valley_axis(grids)
    herds, plan, meta, skeins = {}, {}, {}, {}
    for code, sci, mass, client_n, dens, gname, g in cands:
        key = (animals.get(code) or {}).get("gbif_key") or match_key(sci)
        months = monthly_counts_open(tile, key) if key else []
        shares = season_shares(months)
        density = float(dens or density_km2({"mass_kg": mass, "taxonomy": {"class": "Aves"}, "role": []}, "", ""))
        meta[code] = {"guild": g["guild"], "group": gname, "months_open": months, "shares": shares}
        plan[code] = {}
        for season in SEASONS:
            share = shares[SOUTH_SEASON[season]] if south else shares[season]
            fl = g["flock"][SOUTH_SEASON[season] if south else season]
            if share < 0.1:
                plan[code][season] = {"emitted": False, "why": f"share of the year's records {share}: away this season"}
                continue
            G = min(HERD_MAX, fl * math.sqrt(share))
            if G < FLOCK_MIN:
                plan[code][season] = {"emitted": False, "G": round(G, 1), "why": f"typical flock {G:.1f} under {FLOCK_MIN}: family parties, the cell spawns stand"}
                continue
            p = plan_species(grids, tile_id=tile.tile_id, code=code, season=season, density=density * share, g0=fl, d0=density,
                             mass_kg=mass, client_n=client_n, res=res, size_m=size_m, guild=g["guild"], G_fixed=G, N_max=FLOCK_N)
            if p is None:
                plan[code][season] = {"emitted": False, "why": "too few birds or no range"}
                continue
            p["density_km2"] = round(density * share, 3); p["share"] = share
            if p.pop("emitted"):
                herds.setdefault(code, {})[season] = p.pop("herds")
            plan[code][season] = p
        mig = avonet.lookup(sci).get("migration")
        if g.get("v") and g.get("skein") and mig:
            sk = skein_plan(axis, {SOUTH_SEASON[k] if south else k: v for k, v in shares.items()}, mig, g["skein"], skcfg)
            if sk:
                skeins[code] = sk
                meta[code]["migration"] = mig
    return herds, plan, meta, skeins


def tile_herds(tile: Tile) -> dict:
    """client/herds.json: {format, herds: {code: {season: [{x, n, count, r, s}]}}, plan: per code and season the rule's
    numbers (emitted or why not), fine_tunes used, sources}."""
    from . import pantheria
    fauna = json.loads(tile.path("client/fauna.json").read_text())
    sp_tunes = json.loads((LIB / "species.json").read_text())["species"]
    tile_tunes = json.loads((LIB / "tiles.json").read_text())["tiles"].get(tile.tile_id, {})
    cands = []
    for s in fauna.get("slots", []):
        if s.get("archetype") == ARCHETYPE and not s.get("bird"):
            g = s.get("group") or [1, 1]
            cands.append((s["code"], s.get("scientific") or s["code"].replace("_", " ").capitalize(),
                          float(s.get("mass_kg") or 100), int(max(g)), s.get("density_km2")))
    for code, st in STATIC.items():
        if code in (fauna.get("allow") or []):
            cands.append((code, st["scientific"], st["mass_kg"], st["n"], None))
    grids = load_grids(tile)
    res, size_m = grids["res"], tile.bounds[2] - tile.bounds[0]
    out_herds, plan, used = {}, {}, {}
    for code, sci, mass, client_n, dens in cands:
        P = pantheria.lookup(sci) or {}
        g0, d0 = P.get("group"), P.get("density_km2")
        if not g0 or not d0:
            plan[code] = {"emitted": False, "why": "no PanTHERIA social group size and density"}
            continue
        tt = tile_tunes.get(code) or {}
        steep = (sp_tunes.get(code) or {}).get("terrain") == "steep"
        plan[code] = {}
        for season in SEASONS:
            density = (tt.get("density_km2") or {}).get(season) or dens or d0
            p = plan_species(grids, tile_id=tile.tile_id, code=code, season=season, density=float(density), g0=float(g0),
                             d0=float(d0), mass_kg=mass, client_n=client_n, steep=steep, res=res, size_m=size_m)
            if p is None:
                plan[code][season] = {"emitted": False, "why": "too few animals or no range"}
                continue
            p["density_km2"] = density
            p["density_from"] = "library/herds/tiles.json" if (tt.get("density_km2") or {}).get(season) else \
                ("fauna.json density_km2" if dens else "pantheria")
            if p.pop("emitted"):
                out_herds.setdefault(code, {})[season] = p.pop("herds")
            plan[code][season] = p
        if tt:
            used[code] = {"tile": tile.tile_id, "source": tt.get("source"), "reduction": tt.get("reduction")}
        if code in sp_tunes:
            used.setdefault(code, {})["species"] = {k: v for k, v in sp_tunes[code].items()}
    f_herds, f_plan, f_meta, f_skeins = tile_flocks(tile, grids, fauna)
    for code, d in f_herds.items():
        out_herds[code] = d
    plan.update(f_plan)
    doc = {"format": FORMAT, "rule": "pipeline/herds.py", "grid_m": round(res, 3), "herds": out_herds, "plan": plan,
           "flocks": {c: {"guild": m["guild"], "group": m["group"]} for c, m in f_meta.items() if c in f_herds},
           "flock_data": f_meta, "skeins": f_skeins, "valley_axis": [round(v, 3) for v in valley_axis(grids)],
           "rut": {c: v["rut"] for c, v in sp_tunes.items() if "rut" in v}, "fine_tunes": used,
           "sources": ["pantheria", "library/herds/tiles.json", "library/herds/species.json", "library/herds/flocks.json",
                       "avonet", "gbif (CC0 and CC BY records only)"]}
    write_json(tile.path("client/herds.json"), doc)
    return {"path": "client/herds.json", "kind": "table", "derived_from": ["client.fauna", "client.habitat", "client.canopy",
            "client.heights", "resources"], "herds": {c: {s: len(v) for s, v in d.items()} for c, d in out_herds.items()},
            "largest": {c: {s: max(h["count"] for h in v) for s, v in d.items()} for c, d in out_herds.items()},
            "skeins": {c: {s: v["per_hour"] for s, v in d.items()} for c, d in f_skeins.items()}}


if __name__ == "__main__":
    import sys
    for tid in sys.argv[1:]:
        t = Tile.from_id(tid)
        info = tile_herds(t)
        print(tid, json.dumps({k: info[k] for k in ("herds", "largest", "skeins")}))
