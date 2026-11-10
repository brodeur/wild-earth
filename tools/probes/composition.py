"""Held-out check 2, composition: the plants a tile draws, by layer, against an independent measure of the same
ground (tools/probes/held_out.py; docs/held-out-judge.md).

Drawn    the share of each species among the plants the client draws, per layer (canopy = species.trees, shrub =
         species.shrubs, ground = species.ground), from client/species_mix.json alone: sum over the mix rows of
         cells x density x weight (the same numbers as its fractions.tree_share, shrub_share and ground_share).
Reference, one of two kinds, named in the result:
  plots             the NPS Vegetation Mapping Inventory's classification plots that lie inside the tile: percent cover
                    of every species by stratum, measured in the field (400 m2 plots). Tree strata (T1-T3) are the
                    canopy, shrub strata (S1-S3) the shrubs, the herbaceous stratum (H) the ground; non-vascular, vine,
                    aquatic and epiphyte strata are left out. The reference share of a genus in a layer is its mean
                    cover over the plots divided by the layer's. Fewer than MIN_PLOTS plots inside the tile: the search
                    widens 1 km at a time to MAX_BUFFER_M and the result says how far. A tree species' cover in the
                    shrub and herb strata (saplings and seedlings; a tree species is one whose cover over the whole
                    package lies mostly in the tree strata) is left out of those layers and reported as
                    tree_regeneration_cover_pct: the pipeline draws young trees as trees. Observation points (a quicker
                    record) do not enter the shares; they and the plots within PRESENCE_BUFFER_M make the list of
                    genera known on this ground.
  mapped_dominants  where a park has no plot package: maps whose polygons name their dominant species. Yellowstone:
                    the canopy from the cover-type map (the area of each forest type inside the tile, a type's code
                    naming its tree: COVER_TREES) and the shrubs and ground from the habitat-type map (each polygon's
                    area goes to the understory species its name gives, split evenly: HABITAT_LAYER says which layer a
                    genus is in, OLD_NAMES brings 1990 names to today's). A coarser reference: names, not cover, and
                    no record of everything that grows there, so no foreign share is scored against it.
Score    per layer, on genus shares that sum to 1: Bray-Curtis dissimilarity (0 = the same shares, 1 = no genus in
         common); foreign share = the share of what is drawn that belongs to a genus the reference does not know on this
         ground at all (any layer); missed share = the reference's share in genera the tile does not draw in that layer.
         A layer the tile leaves empty where the reference has cover scores 1 and is named.
Limits   Plots were placed in stands chosen as typical of a vegetation type, not at random, and a 10 km tile holds
         few (rare types such as river banks are over-counted). Drawn shares are counts of plants, the reference is
         cover (or, for mapped dominants, area named). The pipeline moves dwarf shrubs to its ground layer; the plots
         record them as short shrubs. Genus names drift between sources (GENUS_SYNONYMS). The numbers are therefore
         a ranking of what is most wrong, not a measurement to two decimals.

None of these sources is read by the pipeline (it takes communities from LANDFIRE and species from GBIF and the
library), so the check is held out. Reserved as pipeline inputs and so NOT used here: TreeMap, FIA BIGMAP, RCMAP, the
National Wetlands Inventory (docs/pipeline-review-2026-11-10.md, recommendation 5).
"""
from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import judge_common as jc

LAYERS = (("canopy", "trees", "tree_bytes", 0), ("shrub", "shrubs", "shrub_bytes", 1), ("ground", "ground", "ground_bytes", None))
MIN_PLOTS = 10
MAX_BUFFER_M = 5000
PRESENCE_BUFFER_M = 5000
STRATUM_LAYER = {"T": "canopy", "S": "shrub", "H": "ground"}
NOT_TAXA = {"unknown", "moss", "lichen", "cryptogam", "cryptogamic", "bare", "litter", "algae", "liverwort", "fungus",
            "forb", "grass", "graminoid", "shrub", "tree", "annual", "perennial", "dead", "unidentified", "biological"}
# A genus under two names, or a group of genera split and merged between the sources' dates (the wheatgrasses, the
# needlegrasses, Haplopappus, Machaeranthera, Mimulus, Aster): both sides are read through this before they are
# compared, so a difference of naming is never scored as a difference of plants. Fixed before any tile was scored;
# add a pair only for a naming difference, never to make a tile pass.
GENUS_SYNONYMS = {
    "pleuraphis": "hilaria", "sitanion": "elymus", "oryzopsis": "achnatherum", "agropyron": "elymus",
    "stipa": "achnatherum", "hesperostipa": "achnatherum", "nassella": "achnatherum", "eriocoma": "achnatherum",
    "pseudoroegneria": "elymus", "leymus": "elymus", "pascopyrum": "elymus",
    "chrysothamnus": "ericameria", "haplopappus": "ericameria", "isocoma": "ericameria",
    "mahonia": "berberis", "rhamnus": "frangula", "lithocarpus": "notholithocarpus", "sabina": "juniperus",
    "dasiphora": "potentilla", "pentaphylloides": "potentilla", "vulpia": "festuca", "bromopsis": "bromus",
    "anisantha": "bromus", "ceratochloa": "bromus", "machaeranthera": "dieteria", "xylorhiza": "dieteria",
    "castanopsis": "chrysolepis", "libocedrus": "calocedrus",
    "mimulus": "diplacus", "erythranthe": "diplacus", "symphyotrichum": "aster", "eurybia": "aster",
    "cylindropuntia": "opuntia", "dipterostemon": "dichelostemma",
}
# Yellowstone cover types (Despain 1990; the CATEGORY code's letters name the tree; the digit is the successional stage).
COVER_TREES = {"lp": {"pinus": 1.0}, "lpp": {"pinus": 1.0}, "df": {"pseudotsuga": 1.0}, "wb": {"pinus": 1.0},
               "sf": {"picea": 0.5, "abies": 0.5}, "asp": {"populus": 1.0},
               "kh": {"pinus": 1 / 3, "picea": 1 / 3, "abies": 1 / 3}}
COVER_SPECIES = {"lp": "Pinus contorta", "lpp": "Pinus contorta", "df": "Pseudotsuga menziesii", "wb": "Pinus albicaulis",
                 "sf": "Picea engelmannii and Abies lasiocarpa", "asp": "Populus tremuloides",
                 "kh": "krummholz (whitebark pine, Engelmann spruce, subalpine fir)"}
# The layer of each genus the Yellowstone habitat types name (trees in a habitat type's name are the climax tree: the
# canopy comes from the cover types, so they are skipped here).
HABITAT_LAYER = {"abies": None, "pinus": None, "pseudotsuga": None, "picea": None, "populus": None,
                 "vaccinium": "shrub", "symphoricarpos": "shrub", "artemisia": "shrub", "purshia": "shrub",
                 "linnaea": "shrub", "spiraea": "shrub", "physocarpus": "shrub", "potentilla": "shrub",
                 "salix": "shrub", "willow": "shrub",
                 "festuca": "ground", "elymus": "ground", "geranium": "ground", "deschampsia": "ground",
                 "carex": "ground", "sedge": "ground", "thalictrum": "ground", "calamagrostis": "ground",
                 "achnatherum": "ground", "poa": "ground"}
OLD_NAMES = {"calamagrosits": "calamagrostis", "willow": "salix", "sedge": "carex"}


def canon(g: str | None) -> str | None:
    if not g:
        return None
    g = OLD_NAMES.get(g, g)
    return GENUS_SYNONYMS.get(g, g)


# --- what the tile draws ----------------------------------------------------------------------------------------------

def drawn_shares(mix: dict) -> dict:
    """{layer: {species id: share of the layer's drawn plants}} from a species_mix.json; shares sum to 1 per layer
    (an empty dict for a layer nothing is drawn in)."""
    out = {}
    for layer, _col, key, di in LAYERS:
        acc: dict = {}
        for r in mix.get("mixes", []):
            d = (r.get("density_bytes") or [100, 100])[di] / 100 if di is not None else 1.0
            for sid, b in r.get(key) or []:
                acc[sid] = acc.get(sid, 0.0) + r.get("cells", 0) * d * b / 255
        tot = sum(acc.values())
        out[layer] = {k: v / tot for k, v in sorted(acc.items(), key=lambda kv: -kv[1]) if v > 0} if tot else {}
    return out


def genus_shares(species_shares: dict) -> dict:
    out: dict = {}
    for sid, s in species_shares.items():
        g = canon(jc.genus(sid))
        if g:
            out[g] = out.get(g, 0.0) + s
    tot = sum(out.values())
    return {g: s / tot for g, s in sorted(out.items(), key=lambda kv: -kv[1])} if tot else {}


# --- the scores -------------------------------------------------------------------------------------------------------

def bray_curtis(p: dict, q: dict):
    """Bray-Curtis dissimilarity of two share tables (each normalised to sum 1): 1 - sum of the shared minimum.
    None when both are empty; 1.0 when exactly one is."""
    sp, sq = sum(p.values()), sum(q.values())
    if not sp and not sq:
        return None
    if not sp or not sq:
        return 1.0
    return round(1.0 - sum(min(p.get(k, 0.0) / sp, q.get(k, 0.0) / sq) for k in set(p) | set(q)), 4)


def score_layer(drawn_species: dict, ref_genera: dict, known: set | None, top=8) -> dict:
    """One layer: the drawn species shares against the reference's genus shares; `known` is every genus the reference
    records on this ground in any layer."""
    dg = genus_shares(drawn_species)
    known = {canon(g) for g in known} if known is not None else None
    rg: dict = {}
    for g, s in ref_genera.items():
        rg[canon(g)] = rg.get(canon(g), 0.0) + s
    tot = sum(rg.values())
    rg = {g: s / tot for g, s in sorted(rg.items(), key=lambda kv: -kv[1])} if tot else {}
    by_genus: dict = {}
    for sid in drawn_species:
        by_genus.setdefault(canon(jc.genus(sid)), []).append(sid)
    foreign = {g: s for g, s in dg.items() if g not in known} if known is not None else {}
    missed = {g: s for g, s in rg.items() if g not in dg}
    out = {"bray_curtis": bray_curtis(dg, rg),
           "foreign_share": round(sum(foreign.values()), 4) if dg and known is not None else None,
           "missed_share": round(sum(missed.values()), 4) if rg else None,
           "drawn": {g: round(s, 4) for g, s in list(dg.items())[:top]},
           "reference": {g: round(s, 4) for g, s in list(rg.items())[:top]},
           "errors": []}
    if rg and not dg:
        out["errors"].append({"kind": "empty_layer", "what": "nothing drawn where the reference has plants",
                              "reference_top": list(rg)[:5]})
    for g, s in sorted(foreign.items(), key=lambda kv: -kv[1]):
        if s >= 0.005:
            out["errors"].append({"kind": "foreign_genus", "genus": g, "species": by_genus.get(g, []),
                                  "drawn_share": round(s, 4)})
    for g, s in sorted(missed.items(), key=lambda kv: -kv[1]):
        if s >= 0.02 and dg:
            out["errors"].append({"kind": "missing_genus", "genus": g, "reference_share": round(s, 4)})
    return out


def score(drawn: dict, reference: dict) -> dict:
    """drawn: drawn_shares(); reference: {'layers': {layer: {genus: share or cover}}, 'known': [genera], ...}."""
    known = None
    if reference.get("kind") != "mapped_dominants":     # names of dominants are no record of everything that grows there
        known = {canon(g) for g in reference.get("known", [])}
        for lay in reference["layers"].values():
            known |= {canon(g) for g in lay}
    layers = {layer: score_layer(drawn.get(layer, {}), reference["layers"].get(layer, {}), known) for layer, *_ in LAYERS}
    bcs = [v["bray_curtis"] for v in layers.values() if v["bray_curtis"] is not None]
    fs = [v["foreign_share"] for v in layers.values() if v["foreign_share"] is not None]
    errors = [dict(e, layer=layer) for layer, v in layers.items() for e in v.pop("errors")]
    return {"scores": {"bray_curtis_mean": round(sum(bcs) / len(bcs), 4) if bcs else None,
                       "bray_curtis": {k: v["bray_curtis"] for k, v in layers.items()},
                       "foreign_share": {k: v["foreign_share"] for k, v in layers.items()},
                       "foreign_share_max": max(fs) if fs else None,
                       "missed_share": {k: v["missed_share"] for k, v in layers.items()}},
            "layers": layers, "errors": errors}


# --- reference kind 1: Vegetation Mapping Inventory plots -----------------------------------------------------------------

def plots_reference(plots: list, events: list, cover: list, species: dict, bounds: tuple,
                    min_plots=MIN_PLOTS, max_buffer=MAX_BUFFER_M, presence_buffer=PRESENCE_BUFFER_M) -> dict:
    """The plots' genus cover by layer inside `bounds` (x0, y0, x1, y1, the plots' own CRS).
    plots: [{'Plot_Code', 'Public_X', 'Public_Y'}]; events: [{'Plot_Event', 'Plot_Code', 'Observation_pt',
    'Provisional_Community'}]; cover: [{'Plot_Event', 'Stratum', 'Spp_Code', 'Real_Cover'}]; species: {code: name}."""
    xy = {p["Plot_Code"]: (float(p["Public_X"]), float(p["Public_Y"])) for p in plots
          if _num(p.get("Public_X")) and _num(p.get("Public_Y"))}

    def inside(code, buf):
        if code not in xy:
            return False
        x, y = xy[code]
        return bounds[0] - buf <= x < bounds[2] + buf and bounds[1] - buf <= y < bounds[3] + buf

    full = [e for e in events if not _truthy(e.get("Observation_pt"))]
    buf = 0
    chosen = [e for e in full if inside(e["Plot_Code"], 0)]
    while len(chosen) < min_plots and buf < max_buffer:
        buf += 1000
        chosen = [e for e in full if inside(e["Plot_Code"], buf)]
    ids = {e["Plot_Event"] for e in chosen}
    near = {e["Plot_Event"] for e in events if inside(e["Plot_Code"], max(buf, presence_buffer))}
    layers: dict = {"canopy": {}, "shrub": {}, "ground": {}}
    known: set = set()
    # a tree species: one whose cover, over every plot of the package, lies mostly in the tree strata. Its cover in
    # the shrub and herb strata is regeneration (saplings, seedlings), which the pipeline draws as small trees, not
    # as shrubs: left out of the shrub and ground reference and reported beside it
    in_tree, in_all = {}, {}
    for c in cover:
        if _num(c.get("Real_Cover")):
            v = float(c["Real_Cover"])
            in_all[c["Spp_Code"]] = in_all.get(c["Spp_Code"], 0.0) + v
            if str(c.get("Stratum") or "")[:1].upper() == "T":
                in_tree[c["Spp_Code"]] = in_tree.get(c["Spp_Code"], 0.0) + v
    trees = {k for k, v in in_all.items() if v > 0 and in_tree.get(k, 0.0) / v >= 0.5}
    regen = {"shrub": 0.0, "ground": 0.0}
    for c in cover:
        g = _taxon_genus(species.get(c["Spp_Code"]))
        if not g:
            continue
        if c["Plot_Event"] in near:
            known.add(g)
        layer = STRATUM_LAYER.get(str(c.get("Stratum") or "")[:1].upper())
        if c["Plot_Event"] in ids and layer and _num(c.get("Real_Cover")):
            if layer != "canopy" and c["Spp_Code"] in trees:
                regen[layer] += float(c["Real_Cover"])
                continue
            layers[layer][g] = layers[layer].get(g, 0.0) + float(c["Real_Cover"])
    n = max(len(chosen), 1)
    comm: dict = {}
    for e in chosen:
        k = str(e.get("Provisional_Community") or "unnamed").strip()
        comm[k] = comm.get(k, 0) + 1
    return {"kind": "plots", "plots": len(chosen), "buffer_m": buf, "presence_records": len(near),
            "layers": {k: {g: round(v / n, 4) for g, v in sorted(lay.items(), key=lambda kv: -kv[1])}
                       for k, lay in layers.items()},
            "layer_cover_pct": {k: round(sum(lay.values()) / n, 2) for k, lay in layers.items()},
            "tree_regeneration_cover_pct": {k: round(v / n, 2) for k, v in regen.items()},
            "known": sorted(known), "communities": dict(sorted(comm.items(), key=lambda kv: -kv[1]))}


def _num(v) -> bool:
    try:
        return v is not None and v == v and str(v).strip() != "" and float(v) == float(v)
    except (TypeError, ValueError):
        return False


def _truthy(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "-1", "1.0")


def _taxon_genus(name) -> str | None:
    if not isinstance(name, str):
        return None
    g = jc.genus(name)
    if not g or g in NOT_TAXA or len(g) < 3:
        return None
    return g


def load_vmi(cfg: dict, refresh=False) -> dict:
    """The four plot tables of an open-format VMI data package (NPS DataStore), fetched once, each file into its own
    directory under pipeline/_cache/judge/vmi/<reference>/."""
    import pandas as pd
    base = jc.PARK_CACHE / "vmi" / str(cfg["reference"])
    listing = jc.fetch(f"https://irmaservices.nps.gov/datastore/v7/rest/Reference/{cfg['reference']}/DigitalFiles",
                       base / "listing" / "files.json", refresh=refresh)
    files = {f["fileName"]: f["downloadLink"] for f in json.loads(listing.read_text())}
    out = {}
    for t in ("tPlots", "tPlotEvents", "tPlotEventSpecies", "tSpecies"):
        fn = f"{cfg['prefix']}{t}.csv"
        p = jc.fetch(files[fn], base / t / fn, refresh=refresh)
        out[t] = pd.read_csv(p, sep=None, engine="python", encoding="latin-1")
    return {"plots": out["tPlots"].to_dict("records"), "events": out["tPlotEvents"].to_dict("records"),
            "cover": out["tPlotEventSpecies"].to_dict("records"),
            "species": dict(zip(out["tSpecies"]["Spp_Code"], out["tSpecies"]["Field_Name"])),
            "fetched": _mtime(base / "tPlots" / f"{cfg['prefix']}tPlots.csv")}


def _mtime(p: Path) -> str:
    import datetime as dt
    return dt.date.fromtimestamp(p.stat().st_mtime).isoformat()


# --- reference kind 2: Yellowstone's cover-type and habitat-type maps --------------------------------------------------

def habitat_taxa(sci_name: str) -> dict:
    """{'shrub': [genus, ...], 'ground': [...]} named by a habitat type's scientific name. 'A/B-C' names the climax
    tree or dominant A and the understory B (and the phase C); a later 'V. scoparium' takes its genus from the
    earlier taxon with that initial; several types joined by ', ' (a mosaic) are read in turn."""
    out: dict = {"shrub": [], "ground": []}
    seen: dict = {}
    for part in re.split(r"[/,]|(?<=[a-z.])-(?=[A-Z])", sci_name or ""):
        w = part.strip().split()
        if not w:
            continue
        g = w[0].lower().rstrip(".")
        if len(g) == 1 and g in seen:
            g = seen[g]
        g = canon(re.sub(r"[^a-z]", "", g))
        if len(w) >= 2 and w[0][0].isupper():
            sp = canon_species(f"{w[0]} {w[1]}")
            g = sp or g
        if not g:
            continue
        seen.setdefault(g[0], g)
        layer = HABITAT_LAYER.get(g)
        if layer and g not in out[layer]:
            out[layer].append(g)
    return out


_SPECIES_TODAY = {"agropyron spicatum": "elymus", "agropyron caninum": "elymus", "stipa richardsonii": "achnatherum",
                  "stipa comata": "achnatherum", "poa sandbergii": "poa", "potentilla fruticosa": "potentilla"}


def canon_species(name: str) -> str | None:
    """Today's (canonical) genus of an old binomial the Yellowstone names use; None when the genus stands."""
    b = jc.binomial(name)
    return _SPECIES_TODAY.get(b) if b else None


def cover_code_trees(category: str) -> dict:
    """{genus: weight} of a cover-type code ('lp2', 'df/nf', 'wb/sf'): the parts share the polygon evenly and a
    non-forest part ('nf', 'water') takes its share with no tree."""
    parts = [p for p in (category or "").lower().split("/") if p]
    out: dict = {}
    for p in parts:
        key = re.sub(r"\d+$", "", p)
        for g, w in COVER_TREES.get(key, {}).items():
            out[g] = out.get(g, 0.0) + w / len(parts)
    return out


def maps_reference(cover_areas: list, habitat_areas: list, known_extra=()) -> dict:
    """cover_areas: [(CATEGORY code, m2 inside the tile)]; habitat_areas: [(SCI_NAME, m2 inside the tile)]."""
    layers: dict = {"canopy": {}, "shrub": {}, "ground": {}}
    forest = 0.0
    types: dict = {}
    for code, a in cover_areas:
        types[code] = types.get(code, 0.0) + a
        for g, w in cover_code_trees(code).items():
            layers["canopy"][g] = layers["canopy"].get(g, 0.0) + a * w
            forest += a * w
    named = 0.0
    for name, a in habitat_areas:
        taxa = habitat_taxa(name)
        named += a if taxa["shrub"] or taxa["ground"] else 0.0
        for layer in ("shrub", "ground"):
            for g in taxa[layer]:
                layers[layer][g] = layers[layer].get(g, 0.0) + a / len(taxa[layer])
    tot_c = sum(a for _, a in cover_areas) or 1.0
    tot_h = sum(a for _, a in habitat_areas) or 1.0
    known = set(known_extra)
    for lay in layers.values():
        known |= set(lay)
    return {"kind": "mapped_dominants",
            "layers": {k: {g: round(v / (tot_c if k == "canopy" else tot_h), 4)
                           for g, v in sorted(lay.items(), key=lambda kv: -kv[1])} for k, lay in layers.items()},
            "forest_share_of_tile": round(forest / tot_c, 4), "habitat_named_share_of_tile": round(named / tot_h, 4),
            "cover_types": {k: round(v / tot_c, 4) for k, v in sorted(types.items(), key=lambda kv: -kv[1])},
            "known": sorted(known)}


def load_yell_maps(cfg: dict, bounds: tuple, refresh=False) -> dict:
    import e00
    out = {}
    for key, fid, ref in (("cover", cfg["cover_file"], cfg["cover_reference"]),
                          ("habitat", cfg["habitat_file"], cfg["habitat_reference"])):
        base = jc.PARK_CACHE / "yell_maps" / str(ref)
        z = jc.fetch(f"https://irma.nps.gov/DataStore/DownloadFile/{fid}", base / "zip" / "coverage.zip", refresh=refresh)
        e = base / "e00" / "coverage.e00"
        if not e.exists() or refresh:
            e.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(z) as zf:
                member = next(m for m in zf.namelist() if m.lower().endswith(".e00"))
                e.write_bytes(zf.read(member))
        cov = e00.read(e)
        field = "CATEGORY" if key == "cover" else "SCI_NAME"
        out[key] = [(r[field], a) for r, a in e00.areas_in_box(cov, bounds)]
        if key == "habitat":
            wide = (bounds[0] - PRESENCE_BUFFER_M, bounds[1] - PRESENCE_BUFFER_M,
                    bounds[2] + PRESENCE_BUFFER_M, bounds[3] + PRESENCE_BUFFER_M)
            near = set()
            for r, _a in e00.areas_in_box(cov, wide):
                t = habitat_taxa(r["SCI_NAME"])
                near |= set(t["shrub"]) | set(t["ground"])
            out["known"] = sorted(near)
        out["fetched"] = _mtime(z)
    return out


# --- one tile ---------------------------------------------------------------------------------------------------------

LIMITS = {
    "plots": "Classification plots were placed in stands chosen as typical of a vegetation type, not at random, and a "
             "10 km tile holds few of them (rare types such as river banks are over-counted). The reference is "
             "percent cover; the drawn shares are counts of plants. The pipeline moves dwarf shrubs to its ground "
             "layer; the plots record them as short shrubs. Read the scores as a ranking of what is most wrong.",
    "mapped_dominants": "The reference is the area on which a map names a species as a dominant or an indicator, "
                        "not its cover: a genus the names leave out may still grow there, so no foreign share is "
                        "scored and the species-list check answers 'does this grow here'. The "
                        "maps date from 1990-1999. Coordinates are NAD83 UTM, read as the tile's WGS84 UTM (under 2 m).",
}


def run(tile: str, refresh=False) -> dict:
    cfg = (jc.parks().get(tile) or {}).get("composition")
    mix_p = jc.tile_dir(tile) / "client" / "species_mix.json"
    if not cfg:
        return {"held_out": True, "status": "no reference",
                "why": "no independent plot or map source is recorded for this tile in tools/probes/parks.json"}
    if not mix_p.exists():
        return {"held_out": True, "status": "no species mix", "why": "client/species_mix.json is missing"}
    man = jc.manifest(tile)
    bounds = tuple(man["bounds"])
    drawn = drawn_shares(json.loads(mix_p.read_text()))
    if cfg["kind"] == "vmi_plots":
        zone = re.search(r"326(\d\d)$", man["crs"])
        if not zone or f"{int(zone.group(1))}N" != cfg["zone"]:
            return {"held_out": True, "status": "no reference", "why": f"plots are in UTM {cfg['zone']}, tile in {man['crs']}"}
        t = load_vmi(cfg, refresh)
        ref = plots_reference(t["plots"], t["events"], t["cover"], t["species"], bounds)
        fetched = t["fetched"]
        api = f"https://irma.nps.gov/DataStore/Reference/Profile/{cfg['reference']}"
    else:
        m = load_yell_maps(cfg, bounds, refresh)
        ref = maps_reference(m["cover"], m["habitat"], m["known"])
        fetched = m["fetched"]
        api = (f"https://irma.nps.gov/DataStore/Reference/Profile/{cfg['cover_reference']} and "
               f".../{cfg['habitat_reference']}")
    res = score(drawn, ref)
    reference = {k: v for k, v in ref.items() if k not in ("layers", "known")}
    reference["genera_known"] = len(ref["known"])
    return {"held_out": True, "status": "scored", "source": cfg["citation"], "url": api, "licence": cfg["licence"],
            "fetched": fetched, "reference_kind": ref["kind"], "reference": reference,
            "drawn_from": "client/species_mix.json: plants drawn per species (cells x density x weight), by layer",
            "measure": "per layer, on genus shares: Bray-Curtis dissimilarity (0 same, 1 nothing in common); foreign "
                       "share = drawn share in genera the reference does not record on this ground; missed share = "
                       "reference share in genera not drawn in that layer",
            **res, "limits": LIMITS[ref["kind"]]}
