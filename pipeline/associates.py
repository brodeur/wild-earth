"""The shrubs a community's name and description leave out, read from the records on the community's own ground
(docs/decisions.md, 2026-11-10 "the shrubs a community's name leaves out").

LANDFIRE names a community for its dominants and its description lists up to four indicator species per succession
class. The rest of the layer is in neither: the Grand Canyon's vegetation plots record prickly pear, hedgehog cactus,
yucca, seepwillow and sweetbush, and no description of the tile's communities lists one of them; the pinyon-juniper
woodland's description lists no shrub the tile has, so it was drawn with none; the bedrock canyon (38 % of the tile)
names nothing and was drawn bare.

The evidence is where people recorded each plant. GBIF's observation records with open licences (CC0 and CC BY: the
mix built on them ships to clients, as needs.write_localized's) and a stated position within MAX_UNCERTAINTY_M, in the
tile and LOCAL_RECORDS_BUFFER_M around it (the distance at which a species counts as local), are laid on LANDFIRE's
existing-vegetation map of the same square. A record on a cell LANDFIRE maps as a community counts for that community,
by its name, wherever in the square the cell is, provided the community holds most of the 3 x 3 cells around the record
(the positions are good to 100 m, the cells are 30 m). Records on developed and farmed cells count for nothing (gardens and
plantings). Herbarium specimens are left out: their positions are mostly place names georeferenced afterwards.

A species is a recorded associate of a community when
  - it is a native shrub: USDA PLANTS calls it a shrub and native to the lower 48 states (a plant PLANTS calls only
    a subshrub, or also a forb, is the ground layer's; a mistletoe grows on the trees; a species the library already
    has is what its record's form says);
  - MIN_RECORDS or more of its records lie on the community's cells; and
  - that is more than the visits explain. With p the community's share of all plant records, a species with n records
    spread as the visits are would have n p of them there, give or take sqrt(n p (1 - p)). It is a member where it has
    MIN_EXCESS_SD such standard errors more than n p (excess). The test takes out how often people visit the
    community (a trail through the pinyon-juniper puts every roadside plant on it), it asks more of a species with
    few records than of one with many, and no species can pass it everywhere: its records over and under what the
    visits explain sum to nothing, so a species spread evenly is a member nowhere, and one found everywhere is a
    member only where it is found most. Before the test was the plain ratio (affinity 1 or more), 9 of the 25
    snowbrush records near the Teton tile, where 7.7 were to be expected, made snowbrush 18 % of the shrubs of
    Jackson Hole's sagebrush steppe.

How much (species_mix._layer_weights): the associates follow the species LANDFIRE lists, in order of their records on
the community, by reciprocal rank (the reading succession.py gives an order without magnitudes), and all of them
together never weigh more than the listed species: what a description lists are its dominants. The counts give an
order only: people photograph a cactus in flower far more often than a blackbrush. A community that lists no shrub
(the bedrock canyon, a spruce-fir forest) takes the whole layer from its records, and the layer is then only as dense
as the records on its own cells support (species_mix.recorded_support, 2026-11-11): each member weighs min(1, its
records there / 30) over its rank, the class's density is multiplied by their sum (at most 1), and the rest is left
empty. Three records are a thin scatter, not an understory.

Only communities whose LANDFIRE life form carries shrubs (SHRUB_PHYS: not a grassland, not open water); only a tile
that reads its names by its own records (no regional table); only the shrub layer. Nothing here reads a park's maps,
plots or lists: those are the held-out judge's (tools/probes).
"""
from __future__ import annotations

import json
import time
from datetime import date

import numpy as np

from .config import Tile

MIN_RECORDS = 3            # records on the community's own cells (species_mix.MIN_LOCAL_RECORDS, asked of one community)
MIN_EXCESS_SD = 1.0        # standard errors by which its records on the community exceed what the visits explain
MAX_UNCERTAINTY_M = 100    # a record's stated position error; LANDFIRE's cells are 30 m, its patches mostly wider
MAX_ASSOCIATES = 8         # per community: the list a row can carry and the bytes can still tell apart
OPEN_LICENSES = ["CC0_1_0", "CC_BY_4_0"]   # fetch_species.OPEN_LICENSES: never CC BY-NC
# LANDFIRE life forms (EVT_PHYS) with a shrub layer to add to: a grassland's shrubs are the name's or the description's
# to give (succession.LAYERS_OF_TYPE), open water and ice have none
SHRUB_PHYS = ("Conifer", "Hardwood", "Conifer-Hardwood", "Shrubland", "Riparian", "Sparsely Vegetated")
PARASITES = {"Viscaceae", "Santalaceae", "Loranthaceae"}   # mistletoes: PLANTS calls them shrubs; they grow on the trees

EVIDENCE = None   # tests: a callable (tile) -> evidence, in place of GBIF and LANDFIRE
PROFILE = None    # tests: a callable (scientific name) -> a USDA PLANTS profile or None, in place of the service
_EVIDENCE: dict = {}
_SHRUB: dict = {}


# ---------------------------------------------------------------------------------------------------- the records

def _buffer_m() -> int:
    from .species_mix import LOCAL_RECORDS_BUFFER_M
    return LOCAL_RECORDS_BUFFER_M


def open_points(tile: Tile, force=False) -> dict:
    """The tile's open plant observations with a position: {"records": [[species, family, lon, lat, dataset key], ...],
    "licences": {licence: n}, "params", "fetched"}. Vascular plants, human observations, CC0 or CC BY, a stated
    coordinate uncertainty of MAX_UNCERTAINTY_M or less, within the buffer of the tile. Cached per tile."""
    from .fetch_species import GBIF, POLITE_S, _buffer_bbox
    from .http import get
    from .species_mix import TRACHEOPHYTA_KEY
    cache = tile.path(f"_cache/gbif/open_plant_points_{_buffer_m() // 1000}km.json")
    if cache.exists() and not force:
        return json.loads(cache.read_text())
    w, s, e, n = _buffer_bbox(tile, _buffer_m())
    params = {"decimalLatitude": f"{s},{n}", "decimalLongitude": f"{w},{e}", "hasCoordinate": "true",
              "hasGeospatialIssue": "false", "phylumKey": TRACHEOPHYTA_KEY, "basisOfRecord": "HUMAN_OBSERVATION",
              "license": OPEN_LICENSES, "coordinateUncertaintyInMeters": f"0,{MAX_UNCERTAINTY_M}"}
    rows, lic, offset = [], {}, 0
    while offset < 100_000:   # GBIF's search reaches no further; a square with more needs a download, not a search
        r = get(f"{GBIF}/occurrence/search", {**params, "limit": 300, "offset": offset}).json()
        for o in r.get("results", []):
            if o.get("species") and o.get("decimalLongitude") is not None:
                rows.append([o["species"], o.get("family"), round(o["decimalLongitude"], 6), round(o["decimalLatitude"], 6),
                             o.get("datasetKey")])
                lic[o.get("license") or "unknown"] = lic.get(o.get("license") or "unknown", 0) + 1
        offset += 300
        if r.get("endOfRecords") or not r.get("results"):
            break
        time.sleep(POLITE_S)
    doc = {"records": rows, "licences": lic, "params": params, "fetched": date.today().isoformat(),
           "note": "CC0 and CC BY observation records only (the species mix built on them ships to clients)"}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(doc))
    return doc


def evt_window(tile: Tile, force=False):
    """(codes, transform) of LANDFIRE's existing vegetation type over the tile and the buffer around it, 30 m, in the
    tile's projection: one export of the same service the tile's own vegetation came from. Cached per tile."""
    import rasterio
    from .fetch_vegetation import EXPORT_TRIES, EXPORT_WAIT_S, NODATA, PRODUCTS, RES_M
    from .http import download
    raw = tile.path(f"_cache/landfire_evt_{_buffer_m() // 1000}km.tif")
    x0, y0, x1, y1 = tile.bounds
    b = _buffer_m()
    n = int(round((x1 - x0 + 2 * b) / RES_M))
    last = None
    for attempt in range(EXPORT_TRIES):
        try:
            download(PRODUCTS["evt"][0] + "/exportImage", {
                "bbox": f"{x0 - b},{y0 - b},{x1 + b},{y1 + b}", "bboxSR": tile.epsg, "imageSR": tile.epsg,
                "size": f"{n},{n}", "format": "tiff", "pixelType": "S16", "noData": NODATA,
                "interpolation": "RSP_NearestNeighbor", "f": "image"}, raw, force=force and attempt == 0)
            with rasterio.open(raw) as src:
                return src.read(1), src.transform
        except Exception as e:  # noqa: BLE001 (the service fails in runs: fetch_vegetation._export)
            last = e
            if raw.exists():
                raw.unlink()
            if attempt + 1 < EXPORT_TRIES:
                time.sleep(EXPORT_WAIT_S)
    raise RuntimeError(f"LANDFIRE EVT export for the records' square failed after {EXPORT_TRIES} tries: {last}")


def join(records: list, codes: np.ndarray, transform, to_xy, names: dict) -> dict:
    """The records laid on the map: {"total": n, "effort": {community name: n}, "species": {scientific name: {"family",
    "records": n, "by": {community name: n}}}, "skipped": {"off the map": n, "developed or farmed": n}}. records:
    [[species, family, lon, lat, ...]]; codes and transform: the vegetation raster; to_xy(lon, lat): into its
    projection; names: {code: community name} of the cells that count (the natural ones). A record counts where its
    community holds most of the 3 x 3 cells around it."""
    out = {"total": 0, "effort": {}, "species": {}, "skipped": {"off the map": 0, "developed or farmed": 0, "mixed ground": 0}}
    inv = ~transform
    for rec in records:
        sci, fam, lon, lat = rec[:4]
        x, y = to_xy(lon, lat)
        c, r = inv.a * x + inv.b * y + inv.c, inv.d * x + inv.e * y + inv.f
        r, c = int(np.floor(r)), int(np.floor(c))
        if not (0 <= r < codes.shape[0] and 0 <= c < codes.shape[1]):
            out["skipped"]["off the map"] += 1
            continue
        name = names.get(int(codes[r, c]))
        if not name:
            out["skipped"]["developed or farmed"] += 1
            continue
        # the position is good to MAX_UNCERTAINTY_M and the cells are 30 m: the record counts only where its community
        # holds most of the 3 x 3 cells around it (a maple at a forest's edge is not the sagebrush steppe's)
        near = codes[max(0, r - 1):r + 2, max(0, c - 1):c + 2].ravel().tolist()
        if 2 * sum(1 for v in near if names.get(int(v)) == name) <= len(near):
            out["skipped"]["mixed ground"] += 1
            continue
        out["total"] += 1
        out["effort"][name] = out["effort"].get(name, 0) + 1
        sp = out["species"].setdefault(sci, {"family": fam, "records": 0, "by": {}})
        sp["records"] += 1
        sp["by"][name] = sp["by"].get(name, 0) + 1
    return out


def natural_names() -> tuple[dict, dict]:
    """({EVT code: community name}, {community name: life form}) of LANDFIRE's natural vegetation types: not the
    developed, farmed and other human classes (species_mix._is_human), which the tile back-fills."""
    from .fetch_vegetation import _table
    from .species_mix import _is_human
    names, phys = {}, {}
    for code, row in _table("evt").items():
        e = {"phys": row.get("EVT_PHYS")}
        if _is_human(e) or not row.get("EVT_NAME"):
            continue
        names[int(code)] = row["EVT_NAME"]
        phys[row["EVT_NAME"]] = row.get("EVT_PHYS")
    return names, phys


def evidence(tile) -> dict | None:
    """The tile's records by community (join), with "phys": {community name: life form} and "sources"; None where the
    records cannot be asked (no tile, offline, a square LANDFIRE does not map)."""
    if EVIDENCE is not None:
        return EVIDENCE(tile)
    if tile is None or not hasattr(tile, "path"):
        return None
    k = tile.tile_id
    if k not in _EVIDENCE:
        ev = None
        try:
            from pyproj import Transformer
            from .regions import covers
            if not covers("landfire", tile):   # no LANDFIRE map to lay the records on: nothing to ask
                _EVIDENCE[k] = None
                return None
            pts = open_points(tile)
            codes, transform = evt_window(tile)
            names, phys = natural_names()
            fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
            ev = join(pts["records"], codes, transform, fwd.transform, names)
            ev["phys"] = phys
            ev["sources"] = {"records": len(pts["records"]), "licences": pts["licences"], "fetched": pts["fetched"],
                             "datasets": _datasets(pts["records"]), "buffer_km": _buffer_m() // 1000,
                             "max_uncertainty_m": MAX_UNCERTAINTY_M}
        except Exception as e:  # noqa: BLE001 (offline, or the service down: no evidence, nothing added)
            from . import runlog
            runlog.fallback(f"recorded associates: the records could not be read ({str(e)[:160]}); no community gains a shrub from them")
        _EVIDENCE[k] = ev
    return _EVIDENCE[k]


def _datasets(records: list, top=12) -> list[dict]:
    """The GBIF datasets the records came from, most records first: key, title, publisher, licence, records (the
    attribution of the open records the mix is built on)."""
    from .fetch_species import _q
    n: dict = {}
    for rec in records:
        if len(rec) > 4 and rec[4]:
            n[rec[4]] = n.get(rec[4], 0) + 1
    out = []
    for key, c in sorted(n.items(), key=lambda kv: (-kv[1], kv[0]))[:top]:
        row = {"key": key, "records": c}
        try:
            d = _q(None, f"dataset/{key}", {})
            row.update({"title": d.get("title"), "doi": d.get("doi"), "licence": d.get("license")})
            row["publisher"] = _q(None, f"organization/{d['publishingOrganizationKey']}", {}).get("title")
        except Exception:  # noqa: BLE001
            pass
        out.append(row)
    return out


# ------------------------------------------------------------------------------------------------- which are shrubs

def _profile(scientific: str) -> dict | None:
    if PROFILE is not None:
        return PROFILE(scientific)
    try:
        from .ground_cards import plants_lookup
        return plants_lookup(scientific)
    except Exception:  # noqa: BLE001 (offline: nothing known, nothing added)
        return None


def native_shrub(scientific: str, family: str | None = None) -> tuple[str | None, str]:
    """(library id, why) of a recorded species when it is a native shrub; (None, why not) otherwise. Native: USDA
    PLANTS' status for the lower 48 states (unknown is not native). A shrub: the library's record of it has a shrub
    form; without a record, PLANTS calls it a shrub (a plant it calls only a subshrub is a dwarf shrub, "usually under
    0.5 m": the ground layer's) and not also a forb, a grass or a vine (banana yucca, sulphur buckwheat: the ground
    layer's), it is not a tree of a family of trees (succession.species_id), and it is no mistletoe. A card written for it later has the last word on its form (communities.fits_layer)."""
    k = (scientific, family)
    if k in _SHRUB:
        return _SHRUB[k]
    from .communities import FORMS_OF_LAYER, LIBRARY, has_record
    from .ground_cards import _strip, native_l48
    from .succession import _sid

    def out(sid, why):
        _SHRUB[k] = (sid, why)
        return _SHRUB[k]

    prof = _profile(scientific)
    if not prof:
        return out(None, "USDA PLANTS does not know the name")
    if native_l48(prof) is not True:
        return out(None, "not native to the lower 48 states (USDA PLANTS)")
    acc = _strip(prof.get("ScientificName")).split()[:2]
    sid = _sid(" ".join(acc)) if len(acc) == 2 and acc[1][:1].islower() else _sid(scientific)
    if not has_record(sid) and has_record(_sid(scientific)):
        sid = _sid(scientific)
    if has_record(sid):
        form = json.loads((LIBRARY / f"{sid}.json").read_text()).get("form")
        return out(sid, "a library shrub") if form in FORMS_OF_LAYER["shrub"] else out(None, f"the library's record is a {form}")
    if (family or "") in PARASITES:
        return out(None, "a mistletoe")
    from .ground_cards import family_of
    from .needs import TREE_FAMILIES
    habits = set(prof.get("GrowthHabits") or [])
    if "Shrub" not in habits:
        return out(None, "a subshrub: the ground layer's (USDA PLANTS growth habit)" if "Subshrub" in habits
                   else "not a shrub (USDA PLANTS growth habit)")
    if "Tree" in habits and ((family_of(prof) or family) in TREE_FAMILIES):
        return out(None, "a tree (USDA PLANTS growth habit, a family of trees)")
    if habits & {"Forb/herb", "Graminoid", "Vine"}:
        return out(None, "PLANTS also calls it a forb, a grass or a vine: not the shrub layer's")
    return out(sid, "USDA PLANTS: a native shrub")


# --------------------------------------------------------------------------------------------------- the associates

def affinity(n_sc: int, n_s: int, effort_c: int, total: int) -> float:
    """How much more of a species' records lie on a community than of all plant records: 1 = as visits alone put it."""
    if not n_s or not effort_c or not total:
        return 0.0
    return (n_sc / n_s) / (effort_c / total)


def excess(n_sc: int, n_s: int, effort_c: int, total: int) -> float:
    """By how many standard errors a species' records on a community exceed what the visits explain: n_s records
    spread as all plant records are would put n_s p there (p = the community's share of all records), with a standard
    error of sqrt(n_s p (1 - p)). 0 where nothing can be said (a community holding every record)."""
    if not n_s or not effort_c or not total:
        return 0.0
    p = min(1.0, effort_c / total)
    sd = (n_s * p * (1.0 - p)) ** 0.5
    return (n_sc - n_s * p) / sd if sd > 0 else 0.0


def members(tile, name: str | None) -> list[dict]:
    """The recorded associates of a community, most recorded first (then by affinity, then by name): [{"id",
    "scientific", "records" (on the community's cells), "of" (the species' records on natural cells), "affinity" (its
    share of records here over all plants' share here, for people; the test is excess)}], MAX_ASSOCIATES at most. Empty where the records cannot say, the community has no shrub layer to add to
    (SHRUB_PHYS) or nothing passes."""
    ev = evidence(tile)
    if not ev or not name or (ev.get("phys") or {}).get(name) not in SHRUB_PHYS:
        return []
    effort = ev["effort"].get(name, 0)
    found: dict = {}
    for sci, sp in ev["species"].items():
        n = sp["by"].get(name, 0)
        if n < MIN_RECORDS:
            continue
        sid, _ = native_shrub(sci, sp.get("family"))
        if not sid:
            continue
        r = found.setdefault(sid, {"id": sid, "scientific": sci, "records": 0, "of": 0, "affinity": 0.0})
        r["records"] += n      # two names of one accepted species: one associate
        r["of"] += sp["records"]
        r["affinity"] = round(affinity(r["records"], r["of"], effort, ev["total"]), 2)
    found = {sid: r for sid, r in found.items() if excess(r["records"], r["of"], effort, ev["total"]) >= MIN_EXCESS_SD}
    return sorted(found.values(), key=lambda r: (-r["records"], -r["affinity"], r["id"]))[:MAX_ASSOCIATES]


def main(argv=None) -> None:
    """python -m pipeline.associates --tile <id>: the records by community and each community's recorded associates."""
    import argparse
    from . import species_mix as sm
    from .needs import communities
    from .regions import natural_regions
    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument("--tile", required=True)
    ap.add_argument("--all", action="store_true", help="also the species that did not pass, and why")
    a = ap.parse_args(argv)
    tile = Tile.from_id(a.tile)
    sm.CONTEXT["regions"], sm.CONTEXT["tile"] = natural_regions(tile), tile
    ev = evidence(tile)
    if not ev:
        print("no evidence")
        return
    print(json.dumps({k: ev[k] for k in ("total", "skipped", "sources")}, indent=1))
    for c in communities(tile):
        ms = members(tile, c["name"])
        print(f"{c['source']} {c['code']} {c['name'][:64]:64s} cells {c['cells']:6d}  records {ev['effort'].get(c['name'], 0):5d}  "
              f"{(ev.get('phys') or {}).get(c['name'])}")
        for m in ms:
            print(f"    {m['id']:34s} {m['records']:4d} of {m['of']:4d}  x{m['affinity']}  "
                  f"{excess(m['records'], m['of'], ev['effort'].get(c['name'], 0), ev['total']):+.1f} sd")
        if a.all:
            for sci, sp in sorted(ev["species"].items(), key=lambda kv: -kv[1]["by"].get(c["name"], 0)):
                n = sp["by"].get(c["name"], 0)
                if n >= MIN_RECORDS and not any(m["scientific"] == sci for m in ms):
                    print(f"      not {sci:32s} {n:4d} of {sp['records']:4d}  x{affinity(n, sp['records'], ev['effort'].get(c['name'], 0), ev['total']):.2f}  "
                          f"{excess(n, sp['records'], ev['effort'].get(c['name'], 0), ev['total']):+.1f} sd  {native_shrub(sci, sp.get('family'))[1]}")


if __name__ == "__main__":
    main()
