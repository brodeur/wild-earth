"""How good is a tile: a scorecard per layer, written by every build (recommendation 1 of docs/pipeline-review-2026-11-10.md).

    python -m pipeline.scorecard --tile utm12n_396_3988     # one tile: tiles/<tile>/scorecard.json
    python -m pipeline.scorecard --all                      # every built tile, a table, and docs/tile-scorecards.md

The step graph runs it as the `scorecard` step (pipeline/steps.py), after every other step but the licence audit.

For each layer the tile shows, four shares that sum to 1:

    measured   from data of this place at the layer's resolution
    ruled      a hand or named rule applied to a measured class, or a coarser measurement of this place resampled by rule
    guessed    stand-ins, back-fills, records x niche, borrowed pools, generated traits, inpainted fills
    blank      nothing known, or nothing drawn

What each share means on each layer is stated in DEFINITIONS and copied into the JSON, so a reader can check a number
against the documents it was read from (`inputs`). Nothing here is estimated: where a build does not record what a
layer needs, the layer (or the part of it) says "not scored" with the reason, and that is a finding for the pipeline.

The scorecard reads only documents the build already writes (tracked tile JSON and the manifest); it fetches nothing
and opens no raster. It is deterministic: no timestamp, so its hash changes only when what it reads changes.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .config import REPO_ROOT, TILES_DIR, write_json

VERSION = "1"
SHARES = ("measured", "ruled", "guessed", "blank")
LAYERS = ("terrain", "canopy_structure", "plant_communities", "plant_species", "ground_texture", "water", "animals",
          "animal_bodies")
# Findings below this share of their layer are kept in the layer but not in the tile's ranked list.
FINDING_MIN = 0.02
TOP_FINDINGS = 6

# The tiles' everyday names, for the summary table only (nothing in the tile records a name).
NAMES = {
    "utm10n_429_5293": "Hoh rain forest", "utm10n_439_5293": "Mount Olympus", "utm10n_540_4170": "San Francisco (south)",
    "utm10n_540_4180": "San Francisco (north)", "utm10n_680_4270": "Cosumnes", "utm10n_680_4280": "El Dorado (home)",
    "utm10n_690_4280": "Placerville", "utm10n_731_4235": "Calaveras Big Trees", "utm11n_267_4175": "Yosemite (re-centred)",
    "utm11n_270_4180": "Yosemite", "utm12n_396_3988": "Grand Canyon", "utm12n_514_4838": "Teton",
    "utm12n_557_4964": "Lamar Valley", "utm17n_210_932": "Corcovado", "utm19s_233_8679": "Manu",
    "utm33n_412_7531": "Lofoten", "utm36s_698_9724": "Serengeti", "utm50n_582_543": "Danum Valley",
}

DEFINITIONS = {
    "terrain": {
        "unit": "share of the tile's area",
        "resolution": "1 m (the ground detail the client draws and the 1 m channels are routed on)",
        "measured": "ground from a 1 m bare-earth lidar DEM product (terrain.dem_1m coverage.share_1m) or from a lidar point "
                    "cloud's ground returns where no product exists (terrain/lidar_stats.json ground_from_points.share), "
                    "less the road corridors re-graded by rule",
        "ruled": "a coarser measurement of this place resampled to the drawn grid (3DEP seamless 5-10 m, Copernicus 30 m), "
                 "plus the road corridors whose cut and fill were removed by rule (unroad corridor_share)",
        "guessed": "none on any tile today (no ground is invented)",
        "blank": "no ground value (1 - terrain.dem stats.valid_fraction)",
    },
    "canopy_structure": {
        "unit": "share of the tile's area",
        "resolution": "one tree (crown position and height)",
        "measured": "covered by a lidar point cloud: crowns and heights found in the returns (manifest "
                    "status.lidar_coverage.point_cloud)",
        "ruled": "crowns placed by rule to match a canopy map: a satellite canopy-height model (Meta, ETH, 10 m) or "
                 "LANDFIRE cover and height classes (30 m)",
        "guessed": "none recorded",
        "blank": "none recorded",
        "not_scored": "the understory under the canopy: only the top surface is kept on every tile (vegetation."
                      "canopy_height_10m band 3 is shrub cover where the top surface is 0.5-4 m)",
    },
    "plant_communities": {
        "unit": "share of the tile's 30 m cells (species_mix.json communities[].cells)",
        "resolution": "30 m cell",
        "measured": "a cell whose species composition is mapped (plot-based maps such as TreeMap): no tile uses one today",
        "ruled": "a hand rule (pipeline/species_mix.py RULES) or a named_from_* rule (the species the community's name "
                 "names) applied to a measured existing-vegetation class (source evt); open water and permanent ice "
                 "(rules that draw no plants); a tile_pool_* community with no woody donor that draws only the grasses "
                 "and forbs of its own description or the region's ground table (ground_only)",
        "guessed": "the tile pool (tile_pool_*: another community's species of the same habitat class), research_* (the "
                   "tile's recorded species weighted by records x niche), habitat_default_* (California's foothill "
                   "default), and every cell whose class is a back-fill rather than today's vegetation (source bps: "
                   "pre-settlement LANDFIRE BpS under human land; rewild: former reservoir beds; habitat: no class)",
        "blank": "a tile_pool_* community with no donor and no ground plants: drawn bare, nothing known",
    },
    "plant_species": {
        "unit": "share of the tile's drawn woody plant weight (trees and shrubs): each community's cells x its tree or "
                "shrub density x a species' share of the weights its rule wrote (species_mix.json communities[])",
        "resolution": "the species drawn in each 30 m cell",
        "measured": "a species share taken from a per-cell composition measurement: none on any tile today",
        "ruled": "drawn as the species the community's rule asked for (it has a library record of its own)",
        "guessed": "drawn as a stand-in for the species the rule asked for: the mix's `stand_ins` key when the build records "
                   "it, else `substitutions` (named species -> record drawn), and research_* rows whose note names "
                   "functional stand-ins of the climate group",
        "blank": "asked for but drawn as nothing: the mix's `missing` key when recorded, else a substitution to null",
    },
    "ground_texture": {
        "unit": "share of the tile's area",
        "resolution": "2.5 m (client/texture_ground.jpg)",
        "measured": "the air photo kept where its native resolution is 2.5 m or finer (NAIP 0.6 m)",
        "ruled": "the photo kept where it is coarser than the texture (Sentinel-2 10 m, resampled)",
        "guessed": "ground painted in where the photo was replaced: under the 3D crowns, erased roads and buildings "
                   "(client.texture_ground filled_fraction; on a tile without it, client.texture_imagery mask_fraction)",
        "blank": "none recorded",
    },
    "water": {
        "unit": "share of stream length (km): the drawn channels plus the mapped flowlines left undrawn",
        "resolution": "the 1 m thalweg (channel position)",
        "measured": "a drawn channel a mapped flowline confirms (NHDPlus HR in the US, OSM abroad): nhd_matched, or a "
                    "mapped reach kept where the DEM found none (source nhd)",
        "ruled": "a channel placed by the flow-accumulation threshold on the DEM with no mapped line to confirm it",
        "guessed": "none recorded",
        "blank": "mapped flowline length no drawn channel covers (hydro.channels stats nhd_length_km - "
                 "nhd_covered_length_km - nhd_kept_length_km; includes the tips dropped by rule)",
        "not_scored": "stream width, depth and discharge: width is the drainage-area rule (params.width) on every reach "
                      "of every tile, so it is reported, not scored; lakes and ponds are not scored",
    },
    "animals": {
        "unit": "share of the listed species (species/animals.json animals[])",
        "resolution": "the tile (10 km): is the species here",
        "measured": "listed with GBIF records on the tile and traits from a published table or a curated card",
        "ruled": "listed by a range or life-zone rule without records on the tile",
        "guessed": "listed with generated traits (generated_traits)",
        "blank": "none by species; kinds with no species at all (fish, ...) are findings instead",
        "not_scored": "native, introduced or restored: read from a status field on animals[] (STATUS_FIELDS) once the "
                      "list carries one; none does yet",
    },
    "animal_bodies": {
        "unit": "share of the listed species (client/fauna.json)",
        "resolution": "one animal",
        "measured": "drawn with a body of its own: a curated client species (fauna.json allow) or a slot with its own "
                    "model file",
        "ruled": "none (no rule makes a body from a measurement)",
        "guessed": "drawn with a kin's body, scaled and tinted (fauna.json slots[].kin, no model of its own)",
        "blank": "listed but not drawn (fauna.json skipped[], or absent from allow and slots)",
    },
}

# What a finding never varies on (the same on every tile by construction): kept out of the ranked tile list and shown
# once in the summary.
PIPELINE_WIDE = [
    "plant composition is never measured: no tile reads a per-cell species map (plant communities and species: "
    "measured 0 everywhere)",
    "stream width comes from drainage area (1.6 x A^0.45) on every reach; no discharge, depth or seasonal flow from data",
    "the understory under the canopy is not measured on any tile; only the top surface is kept",
    "native or introduced status is not recorded for any animal, so introduced species cannot be counted (the baseline "
    "decided 2026-11-10 removes them; the scorecard counts them once animals[] carries a status field)",
]


# ---------------------------------------------------------------------------------------------------------------
# helpers

def _read(p: Path):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def shares(measured=0.0, ruled=0.0, guessed=0.0, blank=0.0) -> dict:
    """Raw weights -> four shares rounded to 4 places, summing to exactly 1 (the rounding error goes to the largest).
    All zero: None (nothing to share)."""
    raw = {"measured": max(0.0, float(measured)), "ruled": max(0.0, float(ruled)), "guessed": max(0.0, float(guessed)),
           "blank": max(0.0, float(blank))}
    tot = sum(raw.values())
    if tot <= 0:
        return None
    out = {k: round(v / tot, 4) for k, v in raw.items()}
    err = round(1.0 - sum(out.values()), 4)
    if err:
        big = max(out, key=lambda k: out[k])
        out[big] = round(out[big] + err, 4)
    return out


def _pct(x) -> str:
    return f"{100 * x:.0f}%"


def _finding(layer: str, text: str, share: float | None, of: str, kind: str | None = None) -> dict:
    """A plain-words finding: `share` of `of` affected (None: a whole kind or layer, not a share), `kind` the share it
    reports (blank, guessed or ruled; ties rank blank first)."""
    return {"layer": layer, "text": text, "share": None if share is None else round(float(share), 4), "of": of,
            "kind": kind}


def not_scored(reason: str) -> dict:
    return {"scored": False, "reason": reason}


# ---------------------------------------------------------------------------------------------------------------
# layers

def score_terrain(manifest: dict, lidar_stats: dict | None, dem_only: dict | None) -> dict:
    L = (manifest or {}).get("layers") or {}
    dem = L.get("terrain.dem")
    if not dem:
        return not_scored("no terrain.dem layer in the manifest")
    d1 = L.get("terrain.dem_1m") or {}
    share_1m = 0.0
    if d1:
        cov = d1.get("coverage")
        if cov is not None:
            share_1m = float(cov.get("share_1m") or 0.0)
        else:   # a 1 m layer recorded before coverage was: the product covers it all
            share_1m = 1.0 if d1.get("source") == "usgs_3dep_1m" else 0.0
    gfp = float(((lidar_stats or {}).get("ground_from_points") or {}).get("share") or 0.0)
    valid = float((dem.get("stats") or {}).get("valid_fraction", 1.0))
    unroad = (d1.get("unroad") if d1 else None) or dem.get("unroad") or {}
    corridor = float(unroad.get("corridor_share") or 0.0)
    m1 = min(valid, share_1m + gfp)
    measured = max(0.0, m1 - corridor)
    ruled = (valid - m1) + min(corridor, m1)
    status = (manifest.get("status") or {})
    pc = float((status.get("lidar_coverage") or {}).get("point_cloud") or 0.0)
    if pc > 0:
        lidar = "point cloud" + ("" if pc >= 0.95 else f" on {_pct(pc)} of the tile")
    elif share_1m > 0:
        lidar = "1 m DEM only" + ("" if share_1m >= 0.95 else f" on {_pct(share_1m)} of the tile")
    else:
        lidar = "none"
    src, res = dem.get("source"), dem.get("source_resolution_m")
    detail = {"source": src, "source_resolution_m": res, "drawn_resolution_m": dem.get("resolution_m"),
              "share_1m_product": round(share_1m, 4), "share_ground_from_points": round(gfp, 4),
              "lidar": lidar, "point_cloud_share": round(pc, 4), "dem_only_record": dem_only is not None,
              "road_corridor_share": round(corridor, 5), "surface_model": bool(dem.get("surface_model"))}
    findings, ns = [], []
    no1 = valid - m1
    if no1 > FINDING_MIN:
        coarse = f"the {res:g} m {src}" if res else str(src)
        if res is not None and float(res) <= 1.0 and share_1m == 0 and src == "usgs_3dep":
            coarse = "the 3DEP seamless service (resolution not recorded)"
        text = f"{_pct(no1)} of the ground has no 1 m measurement (drawn from {coarse})"
        if dem.get("surface_model"):
            text += ", a surface model with the forest canopy in it"
        findings.append(_finding("terrain", text, no1, "tile area", "ruled"))
    if src == "usgs_3dep" and res is not None and float(res) <= 1.0 and share_1m < 0.5:
        ns.append("source_resolution_m 1.0 is recorded for the 3DEP seamless service whatever it serves "
                  "(pipeline/fetch_dem.py _from_usgs writes a constant); the native resolution of the ground outside the "
                  "1 m products is not recorded")
    out = {"scored": True, "shares": shares(measured, ruled, 0.0, 1.0 - valid), "detail": detail, "findings": findings}
    if ns:
        out["not_scored"] = ns
    return out


def score_canopy(manifest: dict) -> dict:
    L = (manifest or {}).get("layers") or {}
    status = (manifest or {}).get("status") or {}
    pc = float((status.get("lidar_coverage") or {}).get("point_cloud") or 0.0)
    ch = L.get("vegetation.canopy_height_10m") or {}
    sat = [k for k in ("vegetation.canopy_height_10m", "vegetation.canopy_height_v2_10m", "vegetation.canopy_height_eth_10m")
           if (L.get(k) or {}).get("source") and not str(L[k]["source"]).startswith("usgs_3dep")]
    if sat:
        rest = "satellite canopy height (" + ", ".join(sorted({L[k]["source"] for k in sat})) + ")"
    elif "vegetation.evc" in L or "vegetation.evh" in L:
        rest = "LANDFIRE cover and height classes (30 m)"
    else:
        rest = "the habitat class's canopy cover"
    detail = {"point_cloud_share": round(pc, 4), "elsewhere": rest if pc < 1 else None,
              "lidar_status": status.get("lidar")}
    if pc > 0 and ch.get("stats", {}).get("filled_from_landfire_share") is not None:
        detail["filled_from_landfire_share"] = ch["stats"]["filled_from_landfire_share"]
    findings = []
    if 1 - pc > FINDING_MIN:
        findings.append(_finding("canopy_structure", f"{_pct(1 - pc)} of the tile has no measured crowns (placed by rule "
                                 f"from {rest})", 1 - pc, "tile area", "ruled"))
    return {"scored": True, "shares": shares(pc, 1 - pc, 0, 0), "detail": detail, "findings": findings}


def rule_kind(rule: str, source: str | None, has_species: bool, has_ground: bool = False) -> str:
    """How a community's mix was decided: hand, named, water_ice, pool, ground_only, bare, research, class_default,
    backfill. has_species: the community draws trees or shrubs; has_ground: it draws grasses or forbs."""
    rule = rule or ""
    if source == "ice" or rule in ("open_water", "snow_ice"):
        return "water_ice"
    if rule.startswith("tile_pool_"):
        kind = "pool" if has_species else ("ground_only" if has_ground else "bare")
    elif rule.startswith("named_from_"):
        kind = "named"
    elif rule.startswith("research_"):
        kind = "research"
    elif rule.startswith("habitat_default_"):
        kind = "class_default"
    else:
        kind = "hand"
    if source not in (None, "evt") and kind not in ("bare",):
        return "backfill"
    return kind


KIND_SHARE = {"hand": "ruled", "named": "ruled", "water_ice": "ruled", "ground_only": "ruled", "pool": "guessed",
              "research": "guessed",
              "class_default": "guessed", "backfill": "guessed", "bare": "blank"}
KIND_WORDS = {"hand": "a hand rule", "named": "species read from the community's name", "water_ice": "open water or ice",
              "ground_only": "no rule for its woody plants and no donor: only the grasses and forbs its own "
                             "description (or the region's ground table) names",
              "pool": "another community's species (tile pool)", "research": "recorded species x niche",
              "class_default": "California's foothill default", "backfill": "a back-filled class (not today's vegetation)",
              "bare": "no community: nothing known"}


def _communities(mix: dict) -> list[dict]:
    comms = mix.get("communities")
    if comms:
        return comms
    out: dict = {}   # older documents: rebuild from the rows
    for m in mix.get("mixes") or []:
        c = out.setdefault(m.get("community", m.get("index")), {"rule": m.get("rule"), "source": m.get("source"),
                                                              "name": m.get("name"), "cells": 0, "trees": {}, "shrubs": {}})
        c["cells"] += int(m.get("cells") or 0)
        for k, b in m.get("tree_bytes") or []:
            c["trees"][k] = c["trees"].get(k, 0) + b
        for k, b in m.get("shrub_bytes") or []:
            c["shrubs"][k] = c["shrubs"].get(k, 0) + b
    return list(out.values())


def _has_ground(c: dict, mix: dict) -> bool:
    if c.get("ground"):
        return True
    cid = c.get("community")
    return any(m.get("ground_bytes") for m in mix.get("mixes") or [] if cid is not None and m.get("community") == cid)


def score_communities(mix: dict | None) -> dict:
    if not mix:
        return not_scored("no client/species_mix.json")
    comms = _communities(mix)
    total = sum(int(c.get("cells") or 0) for c in comms)
    if not total:
        return not_scored("species_mix.json records no cells per community")
    by_kind: dict = {}
    w = {k: 0.0 for k in SHARES}
    bare_names = []
    for c in comms:
        n = int(c.get("cells") or 0)
        has = bool(c.get("trees") or c.get("shrubs"))
        k = rule_kind(c.get("rule"), c.get("source"), has, _has_ground(c, mix))
        by_kind[k] = by_kind.get(k, 0) + n
        w[KIND_SHARE[k]] += n
        if k == "bare" and n:
            bare_names.append((n, c.get("name") or c.get("rule")))
    # the review's columns (section 3): every cell by its rule, whatever its source
    by_rule_kind = {}
    for c in comms:
        n = int(c.get("cells") or 0)
        k = rule_kind(c.get("rule"), None, bool(c.get("trees") or c.get("shrubs")), _has_ground(c, mix))
        by_rule_kind[k] = by_rule_kind.get(k, 0) + n
    fr = mix.get("fractions") or {}
    detail = {
        "cells": total,
        "by_kind": {k: round(v / total, 4) for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1])},
        "by_rule_ignoring_source": {k: round(v / total, 4) for k, v in sorted(by_rule_kind.items(), key=lambda kv: -kv[1])},
        "from_bps_backfill": fr.get("from_bps_backfill"),
        "unmatched": len(mix.get("unmatched") or []),
        "unmatched_drawn": _count([u.get("drawn") for u in mix.get("unmatched") or []]),
        "natural_regions": mix.get("natural_regions"),
    }
    findings = []
    for k in ("bare", "pool", "research", "backfill", "class_default"):
        s = by_kind.get(k, 0) / total
        if s > 0:
            text = {"bare": f"{_pct(s)} of cells have no community (nothing known)",
                    "pool": f"{_pct(s)} of cells borrow another community's species (tile pool)",
                    "research": f"{_pct(s)} of cells draw recorded species weighted by niche, not a community rule",
                    "backfill": f"{_pct(s)} of cells are a back-filled class (pre-settlement under developed or farmed "
                                "land, by the baseline rule), not today's vegetation",
                    "class_default": f"{_pct(s)} of cells take California's foothill default"}[k]
            if k == "bare" and bare_names:
                text += " (" + "; ".join(nm for _, nm in sorted(bare_names, reverse=True)[:2]) + ")"
            findings.append(_finding("plant_communities", text, s, "30 m cells", KIND_SHARE[k]))
    return {"scored": True, "shares": shares(**w), "detail": detail, "findings": findings}


_STAND_IN_NOTE = re.compile(r"functional stand-ins of its climate group \(([^)]*)\)")


def _drawn_species(mix: dict) -> dict:
    """{trees|shrubs|ground: sorted ids} drawn on at least one cell or riparian row."""
    out = {"trees": set(), "shrubs": set(), "ground": set()}
    for m in mix.get("mixes") or []:
        if int(m.get("cells") or 0) <= 0:
            continue
        for layer, key in (("trees", "tree_bytes"), ("shrubs", "shrub_bytes"), ("ground", "ground_bytes")):
            out[layer] |= {k for k, b in m.get(key) or [] if b}
    for r in ((mix.get("riparian") or {}).get("rows") or {}).values():
        for layer in out:
            for e in r.get(layer) or []:
                sid, b = (e[0], e[1]) if isinstance(e, (list, tuple)) else (e, 1)
                if b:
                    out[layer].add(sid)
    return {k: sorted(v) for k, v in out.items()}


def score_plant_species(mix: dict | None, plant_needs: dict | None) -> dict:
    if not mix:
        return not_scored("no client/species_mix.json")
    stand_ins_rec = "stand_ins" in mix
    missing_rec = "missing" in mix
    subst = dict(mix.get("substitutions") or {})
    stand = {e.get("species"): e.get("drawn") for e in (mix.get("stand_ins") or []) if e.get("species")}
    miss = {e.get("species") for e in (mix.get("missing") or []) if e.get("species")}
    for k, v in subst.items():   # the older record: named species -> record drawn (None: dropped)
        if v is None:
            miss.add(k)
        else:
            stand.setdefault(k, v)
    records = {n.get("id"): n.get("records") for n in ((plant_needs or {}).get("needs") or [])}
    records.update({g.get("id"): g.get("records") for g in ((plant_needs or {}).get("gbif_plants") or []) if g.get("id")})
    w = {k: 0.0 for k in SHARES}
    per_layer = {"trees": {k: 0.0 for k in SHARES}, "shrubs": {k: 0.0 for k in SHARES}}
    by_species: dict = {}
    no_record = 0.0
    for c in _communities(mix):
        n = int(c.get("cells") or 0)
        if not n or rule_kind(c.get("rule"), None, True) == "water_ice":
            continue
        functional = set()
        mt = _STAND_IN_NOTE.search(c.get("note") or "")
        if mt:
            functional = {s.strip() for s in mt.group(1).split(",") if s.strip()}
        for layer, dens_key in (("trees", "tree_density"), ("shrubs", "shrub_density")):
            weights = {k: float(v) for k, v in (c.get(layer) or {}).items() if v}
            tot = sum(weights.values())
            dens = float(c.get(dens_key) or 0.0)
            if not tot or dens <= 0:
                continue
            for sid, ws in weights.items():
                x = n * dens * ws / tot
                if sid in miss:
                    cat, drawn = "blank", None
                elif sid in stand or sid in functional:
                    cat, drawn = "guessed", stand.get(sid, sid)
                else:
                    cat, drawn = "ruled", sid
                w[cat] += x
                per_layer[layer][cat] += x
                e = by_species.setdefault(sid, {"layer": layer, "weight": 0.0, "share": cat, "drawn_as": drawn})
                e["weight"] += x
                if drawn and records and not records.get(drawn):
                    no_record += x
    drawn = _drawn_species(mix)
    total = sum(w.values())
    detail = {
        "counts": {"canopy": len(drawn["trees"]), "shrub": len(drawn["shrubs"]), "ground": len(drawn["ground"])},
        "drawn": drawn,
        "stand_ins": {"recorded": stand_ins_rec, "entries": mix.get("stand_ins") if stand_ins_rec else [],
                      **({} if stand_ins_rec else {"note": "not recorded by this build (no `stand_ins` key in "
                                                            "species_mix.json); `substitutions` read instead"})},
        "missing": {"recorded": missing_rec, "entries": mix.get("missing") if missing_rec else [],
                    **({} if missing_rec else {"note": "not recorded by this build (no `missing` key in species_mix.json)"})},
        "substitutions": subst,
        "local_records_skipped": len(mix.get("local_records_skipped") or []),
    }
    findings = []
    if total:
        top = sorted(((v["weight"], k, v) for k, v in by_species.items()), reverse=True)
        detail["top"] = [{"species": k, "layer": v["layer"], "share_of_weight": round(wt / total, 4), "share": v["share"],
                          "drawn_as": v["drawn_as"]} for wt, k, v in top[:12]]
        if records:
            detail["no_local_record_share"] = round(no_record / total, 4)
            detail["no_local_record_note"] = ("share of the drawn woody weight whose drawn species is not among the tile's "
                                              "most-recorded GBIF plants (species/plant_needs.json, research.PLANT_LIMIT): "
                                              "common trees can miss that list, so this is a lead, not a finding")
        for layer, word in (("trees", "canopy"), ("shrubs", "shrub")):
            lw = per_layer[layer]
            lt = sum(lw.values())
            if lt and lw["guessed"] / lt > FINDING_MIN:
                findings.append(_finding("plant_species", f"{_pct(lw['guessed'] / lt)} of the {word} weight is drawn as a "
                                         "stand-in", lw["guessed"] / total, "woody plant weight", "guessed"))
            if lt and lw["blank"] / lt > FINDING_MIN:
                findings.append(_finding("plant_species", f"{_pct(lw['blank'] / lt)} of the {word} weight is a named "
                                         "species with no record, drawn as nothing", lw["blank"] / total, "woody plant weight", "blank"))
    for layer, word in (("ground", "ground"), ("shrubs", "shrub"), ("trees", "canopy")):
        if not drawn[layer]:
            findings.append(_finding("plant_species", f"no {word} species at all", 1.0, f"{word} layer", "blank"))
        elif layer != "trees" and len(drawn[layer]) == 1:
            findings.append(_finding("plant_species", f"one {word} species only ({drawn[layer][0]})", None, f"{word} layer"))
    sh = shares(**w)
    if sh is None:
        return {"scored": False, "reason": "no community on the tile asks for a tree or shrub", "detail": detail,
                "findings": findings}
    return {"scored": True, "shares": sh, "detail": detail, "findings": findings}


NATIVE_RES_M = {"pc_naip": 0.6, "usgs_naip": 0.6, "naip": 0.6, "sentinel2_l2a": 10.0, "copernicus_sentinel2_l2a": 10.0}


def score_ground_texture(manifest: dict) -> dict:
    L = (manifest or {}).get("layers") or {}
    tg, ti = L.get("client.texture_ground"), L.get("client.texture_imagery") or {}
    if not tg and not ti:
        return not_scored("no client.texture_ground or client.texture_imagery layer in the manifest")
    src = (tg or {}).get("source") or ti.get("source") or (L.get("imagery.naip") or {}).get("source")
    native = NATIVE_RES_M.get(src)
    if tg:   # crowns inpainted: what the inpaint step painted in
        drawn = float(tg.get("resolution_m") or 2.5)
        filled = float(tg.get("filled_fraction") or 0.0)
    else:    # no crowns to paint under (no lidar): the human footprint the erase step filled
        drawn = float(ti.get("resolution_m") or 2.5)
        filled = float(ti.get("mask_fraction") or 0.0)
    if native is None:
        return not_scored(f"the native resolution of the imagery source {src!r} is not known to the scorecard")
    photo = 1.0 - filled
    m, r = (photo, 0.0) if native <= drawn else (0.0, photo)
    detail = {"source": src, "native_resolution_m": native, "drawn_resolution_m": drawn, "filled_fraction": filled,
              "filled_from": "client.texture_ground" if tg else "client.texture_imagery mask",
              "roads_erased_fraction": (ti.get("roads") or {}).get("erased_fraction"),
              "urban_erased_fraction": (ti.get("urban") or {}).get("erased_fraction")}
    findings = []
    if native > drawn:
        findings.append(_finding("ground_texture", f"the ground's colour is a {native:g} m photo drawn at {drawn:g} m", photo,
                                 "tile area", "ruled"))
    if filled > 0.25:
        findings.append(_finding("ground_texture", f"{_pct(filled)} of the ground texture is painted in, not photographed",
                                 filled, "tile area", "guessed"))
    return {"scored": True, "shares": shares(m, r, filled, 0.0), "detail": detail, "findings": findings}


def score_water(channels: dict | None, manifest: dict) -> dict:
    L = (manifest or {}).get("layers") or {}
    hc = L.get("hydro.channels") or {}
    if not channels or not channels.get("features"):
        return not_scored("no hydro/channels.geojson features")
    measured = ruled = 0.0
    for f in channels["features"]:
        p = f.get("properties") or {}
        km = float(p.get("length_m") or 0.0) / 1000
        if p.get("source") == "nhd" or p.get("nhd_matched"):
            measured += km
        else:
            ruled += km
    st = hc.get("stats") or {}
    undrawn = None
    if "nhd_length_km" in st:
        undrawn = max(0.0, float(st.get("nhd_length_km") or 0) - float(st.get("nhd_covered_length_km") or 0)
                      - float(st.get("nhd_kept_length_km") or 0))
    wi = hc.get("water_imagery") or {}
    detail = {"drawn_km": round(measured + ruled, 2), "confirmed_km": round(measured, 2), "dem_only_km": round(ruled, 2),
              "mapped_undrawn_km": None if undrawn is None else round(undrawn, 2),
              "mapped_km": st.get("nhd_length_km"), "median_offset_m": st.get("median_offset_m"),
              "width_rule": (hc.get("params") or {}).get("width"),
              "imagery_check": wi.get("verdicts_after") or wi.get("verdicts_before")}
    ns = []
    if undrawn is None:
        ns.append("mapped flowline length not recorded (hydro.channels stats.nhd_length_km): blank not scored")
    tot = measured + ruled + (undrawn or 0.0)
    findings = []
    if tot:
        if ruled / tot > 0.25:
            findings.append(_finding("water", f"{_pct(ruled / tot)} of stream length is placed by the DEM alone, "
                                     "no mapped stream confirms it", ruled / tot, "stream length", "ruled"))
        if undrawn and undrawn / tot > 0.05:
            findings.append(_finding("water", f"{_pct(undrawn / tot)} of mapped stream length is not drawn",
                                     undrawn / tot, "stream length", "blank"))
    out = {"scored": True, "shares": shares(measured, ruled, 0.0, undrawn or 0.0), "detail": detail, "findings": findings}
    if ns:
        out["not_scored"] = ns
    return out


def _count(xs) -> dict:
    out: dict = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


# The baseline decided 2026-11-10 (docs/decisions.md): introduced species out, removed natives restored and marked. No
# list carries a status yet; when one does, any of these fields on an animals[] entry is read.
STATUS_FIELDS = ("native_status", "establishment", "status", "introduced", "native", "restored")
INTRODUCED_WORDS = {"introduced", "invasive", "naturalised", "naturalized", "alien", "non-native", "nonnative"}


def native_status(a: dict) -> str | None:
    """'introduced', 'restored', 'native' or None (no field says) for one animals[] entry."""
    if a.get("restored") is True or str(a.get("status") or "").lower() == "restored":
        return "restored"
    if a.get("introduced") is True or a.get("native") is False:
        return "introduced"
    for k in ("native_status", "establishment", "status"):
        v = str(a.get(k) or "").lower()
        if v in INTRODUCED_WORDS:
            return "introduced"
        if v in ("native", "endemic"):
            return "native"
    if a.get("introduced") is False or a.get("native") is True:
        return "native"
    return None


def score_animals(animals: dict | None, library_registry: dict | None, tile_registry: dict | None) -> dict:
    if not animals or not animals.get("animals"):
        return not_scored("no species/animals.json animals")
    listed = [a for a in animals["animals"] if a.get("listed", True) is not False]
    gen = set(animals.get("generated_traits") or [])
    tr = {a.get("id"): a for a in ((tile_registry or {}).get("animals") or [])}
    w = {k: 0.0 for k in SHARES}
    for a in listed:
        if a["id"] in gen:
            w["guessed"] += 1
        elif (a.get("records") or 0) > 0 and (tr.get(a["id"], {}).get("present") in (None, "records")):
            w["measured"] += 1
        else:
            w["ruled"] += 1
    by_kind = _count(a.get("kind") for a in listed)
    kinds = list((animals.get("classes") or {}).keys()) or ["bird", "mammal", "reptile", "amphibian", "fish", "invertebrate"]
    in_records = _count(a.get("kind") for a in animals.get("all_records") or [])
    lib = {v.get("id"): v for v in ((library_registry or {}).get("species") or {}).values()}
    levels, unknown = {}, []
    for a in listed:
        lv = (lib.get(a["id"]) or {}).get("fidelity")
        if lv is None:
            lv = (tr.get(a["id"]) or {}).get("fidelity")
        if lv is None:
            unknown.append(a["id"])
            lv = "not known"
        levels[str(lv)] = levels.get(str(lv), 0) + 1
    detail = {"listed": len(listed), "by_kind": by_kind,
              "kinds_with_none": [k for k in kinds if not by_kind.get(k)],
              "records_by_kind": in_records, "generated_traits": sorted(gen),
              "registry_levels": dict(sorted(levels.items())),
              "registry_level_not_known": sorted(unknown),
              }
    st = [native_status(a) for a in listed]
    if any(x is not None for x in st):
        detail["introduced"] = {"scored": True, "introduced": sorted(a["id"] for a, x in zip(listed, st) if x == "introduced"),
                                "restored": sorted(a["id"] for a, x in zip(listed, st) if x == "restored"),
                                "status_not_known": sum(1 for x in st if x is None)}
    else:
        detail["introduced"] = {"scored": False, "value": "not known",
                                "reason": "no native or introduced field in species/animals.json (" +
                                          ", ".join(STATUS_FIELDS) + ")"}
    findings = []
    intro = (detail["introduced"].get("introduced") or []) if detail["introduced"]["scored"] else []
    if intro:
        findings.append(_finding("animals", f"{len(intro)} of {len(listed)} listed animals are introduced "
                                 f"({', '.join(intro[:3])}{', ...' if len(intro) > 3 else ''})", len(intro) / len(listed),
                                 "listed species", "guessed"))
    for k in detail["kinds_with_none"]:
        why = "none in the tile's GBIF records" if not in_records.get(k) else f"{in_records[k]} in the records, none listed"
        findings.append(_finding("animals", f"no {k} species listed ({why})", None, f"the {k} kind"))
    if gen:
        findings.append(_finding("animals", f"{len(gen)} of {len(listed)} listed animals have generated traits",
                                 len(gen) / len(listed), "listed species", "guessed"))
    if unknown and len(unknown) / len(listed) > 0.05:
        findings.append(_finding("animals", f"{len(unknown)} listed animals are missing from the registry (level not known)",
                                 len(unknown) / len(listed), "listed species"))
    return {"scored": True, "shares": shares(**w), "detail": detail, "findings": findings}


def score_animal_bodies(animals: dict | None, fauna: dict | None) -> dict:
    if not animals or not animals.get("animals"):
        return not_scored("no species/animals.json animals")
    if not fauna:
        return not_scored("no client/fauna.json")
    listed = {a["id"] for a in animals["animals"] if a.get("listed", True) is not False}
    allow = set(fauna.get("allow") or [])
    slots = {s.get("code"): s for s in fauna.get("slots") or []}
    own_slot = {c for c, s in slots.items() if Path(str((s.get("model") or {}).get("path") or "")).stem == c}
    measured = len(listed & (allow | own_slot))
    guessed = len((listed & set(slots)) - own_slot - allow)
    blank = len(listed) - measured - guessed
    skipped = _count((s.get("why") or "").split(":")[0].split(" (")[0] for s in fauna.get("skipped") or [] if s.get("id") in listed)
    detail = {"listed": len(listed), "own_body": measured, "kin_body": guessed, "not_drawn": blank,
              "not_drawn_why": skipped}
    findings = []
    if listed and guessed / len(listed) > FINDING_MIN:
        findings.append(_finding("animal_bodies", f"{guessed} of {len(listed)} listed animals wear a kin's body",
                                 guessed / len(listed), "listed species", "guessed"))
    if listed and blank / len(listed) > FINDING_MIN:
        findings.append(_finding("animal_bodies", f"{blank} of {len(listed)} listed animals are not drawn",
                                 blank / len(listed), "listed species", "blank"))
    return {"scored": True, "shares": shares(measured, 0.0, guessed, blank), "detail": detail, "findings": findings}


# ---------------------------------------------------------------------------------------------------------------
# the card

INPUTS = {
    "manifest": "manifest.json",
    "lidar_stats": "terrain/lidar_stats.json",
    "lidar_dem_only": "terrain/lidar_dem_only.json",
    "species_mix": "client/species_mix.json",
    "plant_needs": "species/plant_needs.json",
    "channels": "hydro/channels.geojson",
    "animals": "species/animals.json",
    "fauna": "client/fauna.json",
    "tile_registry": "species/registry.json",
    "judge": "judge/held_out.json",
}


SEVERITY = {"blank": 0, "guessed": 1, "ruled": 2, None: 3}
# A ruled share (a coarser measurement, a rule on a measured class) is half as bad as a guessed or blank one of the same
# size; a finding with no share (a whole kind missing, one species only) ranks as half the layer.
RANK_WEIGHT = {"blank": 1.0, "guessed": 1.0, "ruled": 0.5, None: 1.0}
NO_SHARE_RANK = 0.5


def rank_score(f: dict) -> float:
    s = f.get("share")
    return NO_SHARE_RANK if s is None else s * RANK_WEIGHT.get(f.get("kind"), 1.0)


def rank_findings(layers: dict, top: int = TOP_FINDINGS) -> list[dict]:
    """The tile's worst findings: by the share of their layer they affect (rank_score: ruled shares count half), largest
    first; at equal scores blank before guessed before ruled, then in layer order."""
    out = []
    for i, name in enumerate(LAYERS):
        for f in (layers.get(name) or {}).get("findings") or []:
            s = f.get("share")
            if s is not None and s < FINDING_MIN:
                continue
            out.append(((-rank_score(f), SEVERITY.get(f.get("kind"), 3), i), f))
    out.sort(key=lambda kv: kv[0])
    return [f for _, f in out[:top]]


def scorecard(tile_dir: Path, library_registry: dict | None = None, manifest: dict | None = None) -> dict:
    """The card for a built tile folder. `manifest`: the build's manifest in memory (the step), else manifest.json."""
    tile_dir = Path(tile_dir)
    docs = {k: _read(tile_dir / rel) for k, rel in INPUTS.items() if not (k == "manifest" and manifest is not None)}
    if manifest is not None:
        docs["manifest"] = manifest
    if library_registry is None:
        library_registry = _read(REPO_ROOT / "library" / "registry.json")
    m = docs["manifest"] or {}
    layers = {
        "terrain": score_terrain(m, docs["lidar_stats"], docs["lidar_dem_only"]) if m else not_scored("no manifest.json"),
        "canopy_structure": score_canopy(m) if m else not_scored("no manifest.json"),
        "plant_communities": score_communities(docs["species_mix"]),
        "plant_species": score_plant_species(docs["species_mix"], docs["plant_needs"]),
        "ground_texture": score_ground_texture(m) if m else not_scored("no manifest.json"),
        "water": score_water(docs["channels"], m),
        "animals": score_animals(docs["animals"], library_registry, docs["tile_registry"]),
        "animal_bodies": score_animal_bodies(docs["animals"], docs["fauna"]),
    }
    for name, layer in layers.items():
        layer["definition"] = DEFINITIONS[name]
    not_scored_layers = {
        "sea": "no layer: the coast has no sea floor, tides or surf on any tile",
        "weather_and_seasons": "one ERA5 series per tile (client/weather.json); no per-cell share to score",
        "sound": "synthesised in the client; the build writes no sound document",
    }
    card = {
        "tile": tile_dir.name,
        "name": NAMES.get(tile_dir.name),
        "scorecard_version": VERSION,
        "about": "How much of what this tile shows is measured, ruled, guessed or blank, per layer (pipeline/scorecard.py; "
                 "docs/tile-scorecards.md). Each layer states its definitions.",
        "shares_meaning": {"measured": "from data of this place at the layer's resolution",
                           "ruled": "a hand or named rule applied to a measured class, or a coarser measurement resampled",
                           "guessed": "stand-ins, back-fills, records x niche, generated traits, painted fills",
                           "blank": "nothing known or nothing drawn"},
        "built_from": {k: rel for k, rel in INPUTS.items() if docs[k] is not None},
        "built_at": {"manifest": m.get("generated_at"), "animals": (docs["animals"] or {}).get("at"),
                     "tile_registry": (docs["tile_registry"] or {}).get("at")},
        "layers": layers,
        "findings": rank_findings(layers),
        "not_scored": not_scored_layers,
        "judge": ({"held_out": docs["judge"], "source": INPUTS["judge"]} if docs["judge"] is not None else
                  {"held_out": None, "note": f"no {INPUTS['judge']} on this tile (the held-out judge writes it)"}),
    }
    card["built_at"] = {k: v for k, v in card["built_at"].items() if v}
    return card


def write(tile_dir: Path, library_registry: dict | None = None, manifest: dict | None = None) -> dict:
    card = scorecard(tile_dir, library_registry, manifest)
    write_json(Path(tile_dir) / "scorecard.json", card)
    return card


# ---------------------------------------------------------------------------------------------------------------
# across tiles

COLUMNS = [("terrain", "Terrain"), ("canopy_structure", "Canopy"), ("plant_communities", "Communities"),
           ("plant_species", "Plant species"), ("ground_texture", "Ground"), ("water", "Streams"),
           ("animals", "Animals"), ("animal_bodies", "Bodies")]


def _cell(layer: dict) -> str:
    if not layer or not layer.get("scored") or not layer.get("shares"):
        return "not scored"
    s = layer["shares"]
    return "/".join(f"{round(100 * s[k])}" for k in SHARES)


def built_tiles(root: Path = TILES_DIR) -> list[Path]:
    return sorted(p for p in Path(root).iterdir() if p.is_dir() and (p / "manifest.json").exists())


def summary_markdown(cards: list[dict]) -> str:
    lines = ["# Tile scorecards", "",
             "Written by `python -m pipeline.scorecard --all` from each tile's `scorecard.json` (the build's `scorecard` "
             "step). Do not edit by hand.", "",
             "Each cell is **measured / ruled / guessed / blank**, in percent of the layer's unit:", "",
             "- **measured**: from data of this place at the layer's resolution",
             "- **ruled**: a hand or named rule applied to a measured class, or a coarser measurement resampled by rule",
             "- **guessed**: stand-ins, back-fills, records x niche, borrowed pools, generated traits, painted fills",
             "- **blank**: nothing known, or nothing drawn", "",
             "Worst finding: the tile's finding that affects the largest share of its layer, a ruled share counting half "
             "(a coarse measurement is less unknown than a guess) and a whole missing kind counting as half a layer "
             "(`rank_findings`).", "",
             "| Tile | " + " | ".join(h for _, h in COLUMNS) + " | Worst finding |",
             "|---|" + "---|" * len(COLUMNS) + "---|"]
    for c in cards:
        worst = c["findings"][0]["text"] if c.get("findings") else ""
        lines.append(f"| {c.get('name') or c['tile']} (`{c['tile']}`) | " +
                     " | ".join(_cell(c["layers"].get(k)) for k, _ in COLUMNS) + f" | {worst} |")
    lines += ["", "## Per layer: what each share means", ""]
    for k, h in COLUMNS:
        d = DEFINITIONS[k]
        lines.append(f"**{h}** ({d['unit']}; resolution: {d['resolution']}).")
        for s in SHARES:
            lines.append(f"- {s}: {d[s]}")
        if d.get("not_scored"):
            lines.append(f"- not scored: {d['not_scored']}")
        lines.append("")
    lines += ["## The same on every tile", "", "Kept out of the per-tile findings because no tile differs:", ""]
    lines += [f"- {x}" for x in PIPELINE_WIDE]
    lines += ["", "## Worst findings per tile", ""]
    for c in cards:
        lines.append(f"**{c.get('name') or c['tile']}** (`{c['tile']}`)")
        for f in c.get("findings") or []:
            lines.append(f"- {f['text']}")
        lines.append("")
    lines += ["## Plant species counts", "", "| Tile | Canopy | Shrub | Ground | Stand-ins recorded | Missing recorded |",
              "|---|---|---|---|---|---|"]
    for c in cards:
        ps = c["layers"].get("plant_species") or {}
        d = ps.get("detail") or {}
        n = d.get("counts") or {}
        si, mi = d.get("stand_ins") or {}, d.get("missing") or {}
        lines.append(f"| {c.get('name') or c['tile']} | {n.get('canopy', '')} | {n.get('shrub', '')} | {n.get('ground', '')} | "
                     f"{len(si.get('entries') or []) if si.get('recorded') else 'not recorded'} | "
                     f"{len(mi.get('entries') or []) if mi.get('recorded') else 'not recorded'} |")
    lines += ["", "## What a layer could not be scored on", ""]
    seen = set()
    for c in cards:
        for k, layer in c["layers"].items():
            for x in ([layer["reason"]] if not layer.get("scored") and layer.get("reason") else []) + list(layer.get("not_scored") or []):
                key = (k, x)
                if key in seen:
                    continue
                seen.add(key)
                tiles = [cc["tile"] for cc in cards if x in (list((cc["layers"].get(k) or {}).get("not_scored") or []) +
                                                            [(cc["layers"].get(k) or {}).get("reason")])]
                lines.append(f"- {k}: {x} ({len(tiles)} tile{'s' if len(tiles) != 1 else ''})")
    for k, d in DEFINITIONS.items():
        if d.get("not_scored"):
            lines.append(f"- {k}: {d['not_scored']} (every tile)")
    for k, why in (cards[0].get("not_scored") or {}).items() if cards else []:
        lines.append(f"- {k}: {why}")
    lines.append("")
    return "\n".join(lines)


def print_table(cards: list[dict]) -> None:
    head = ["tile"] + [h for _, h in COLUMNS]
    rows = [[c["tile"]] + [_cell(c["layers"].get(k)) for k, _ in COLUMNS] for c in cards]
    widths = [max(len(str(r[i])) for r in [head] + rows) for i in range(len(head))]
    print("  ".join(h.ljust(w) for h, w in zip(head, widths)))
    for r in rows:
        print("  ".join(str(x).ljust(w) for x, w in zip(r, widths)))
    print("\ncells: measured/ruled/guessed/blank, percent")
    for c in cards:
        if c.get("findings"):
            print(f"{c['tile']}: {c['findings'][0]['text']}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="the tile scorecard: measured / ruled / guessed / blank per layer")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--tile")
    g.add_argument("--all", action="store_true", help="every built tile; prints a table and writes docs/tile-scorecards.md")
    ap.add_argument("--no-doc", action="store_true", help="with --all: do not write docs/tile-scorecards.md")
    a = ap.parse_args(argv)
    reg = _read(REPO_ROOT / "library" / "registry.json")
    if a.tile:
        card = write(TILES_DIR / a.tile, reg)
        print_table([card])
        return 0
    cards = [write(p, reg) for p in built_tiles()]
    print_table(cards)
    if not a.no_doc:
        (REPO_ROOT / "docs" / "tile-scorecards.md").write_text(summary_markdown(cards))
        print("\nwrote docs/tile-scorecards.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
