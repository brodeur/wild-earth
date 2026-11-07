"""The tile build as a graph of steps: one command builds a tile from nothing, and builds it again the same way.

    python -m pipeline.build_tile --tile utm10n_735_4235 --all          # every step, in order; skips what is current
    python -m pipeline.build_tile --tile utm10n_735_4235 --all --force derive,registry
    python -m pipeline.build_tile --tile utm10n_735_4235 --plan         # what --all would run, and why
    python -m pipeline.build_tile --tile utm11n_270_4180 --status       # which steps ran, which are missing or stale
    python -m pipeline.build_tile --tile utm11n_270_4180 --adopt        # record a tile built before the graph
    python -m pipeline.build_tile --anchor -120.31 38.27 --all          # a new tile from a point

Each step (STEPS) declares what it is (version, the modules whose code it runs), what it needs (the steps whose
outputs it reads: `after`), what it fetches (`sources`, with each source's region in pipeline/regions.py) and when it
does not apply (`applies`: a DEM-only tile has no crowns to find; that is recorded as not_applicable with its reason,
never skipped in silence). Before a step runs, its fingerprint is computed:

    sha256(version, the hash of its modules' code, its parameters, every upstream step's output hash,
           the library files it reads)

and the step is skipped when its last run in the manifest has the same fingerprint and every output it recorded is
still on disk with the hash it had. A step whose outputs come out the same as before leaves its dependents' fingerprints
unchanged, so they are skipped too: a code change re-runs exactly the part of the graph it reaches. `--force <step>`
runs a step whatever its fingerprint (and its fetch modules re-ask their sources); dependents re-run if its outputs
changed.

The manifest's `steps` holds, per step: version, code hash, parameters, the fingerprint and the upstream hashes it was
made of, the output layers and files with their hashes, the sources it used (with the date they were retrieved), the
fallbacks it took (runlog.fallback: a Planetary Computer DEM after a USGS timeout, DEM-only lidar, a LANDFIRE export
answered on its third try), the network reads and whether they came from the cache, its status (ok, not_applicable,
refused, failed), when it ran and for how long. The old `log` list is kept and appended to as before.

A step that fails stops the build (its dependents cannot be right), and the command exits 1; --keep-going runs the
steps that do not depend on it. A step that refuses (runlog.Refused: the reroute on a tile whose drawn DEM is not the
1 m ground) does not stop the build, since its dependents run on what it would have replaced. It is recorded `refused`
with its reason and is never current, so every build tries it again. --status flags it, the build and --status exit 1,
and the audit step fails on it (refusals).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import regions, runlog
from .config import REPO_ROOT, TILES_DIR, Tile, now_iso, read_json, sha256, write_json
from .manifest import add_layer, add_species_prior, load_manifest, record_source, save

PIPE = REPO_ROOT / "pipeline"


@dataclass
class Step:
    name: str
    version: str
    modules: list[str]                     # pipeline modules (without .py) whose code the step runs
    after: list[str]                       # steps whose outputs it reads
    run: Callable                          # run(tile, m, force) -> None; records layers with add_layer
    layers: list[str] = field(default_factory=list)   # the manifest layers it owns (prefixes ending in '.' match a family)
    sources: list[str] = field(default_factory=list)  # network sources it may read (regions.COVERAGE keys)
    library: list[str] = field(default_factory=list)  # repo folders it reads (their files' hashes join the fingerprint)
    applies: Callable | None = None        # applies(tile, m) -> None, or the reason the step does not apply here
    owner: str | None = None               # the lane that owns the step's code, when it is not this one
    doc: str = ""
    stage: str = "base"                    # base | flora | fauna | games (STAGES): --stage runs one
    optional: list[str] = field(default_factory=list)  # layers it writes only where the data allows (--status does not
                                                         # count them missing: a column only where one exists, a map only
                                                         # where no lidar measured the canopy)


# ---------------------------------------------------------------------------------------------------------------
# The steps' bodies (moved from build_tile.run, 2026-11-04). Each records its layers with add_layer.

def _dem(tile, m, force):
    # The drawn DEM (terrain/dem.tif, what the client's ground is made of): the fetched 5 m, or, where the 3DEP 1 m
    # products cover >= 95 % of the tile, the 1 m ground averaged with the fetched DEM filling the gaps
    # (fetch_dem.drawn_dem, 2026-11-06: Lamar's reroute refused on the 3DEP seamless 10 m the flaky ImageServer left it).
    from .fetch_dem import drawn_dem, fetch_dem
    info = drawn_dem(tile, fetch_dem(tile, force), force)
    fetched = info.pop("_fetched", None)
    if fetched:
        add_layer(m, tile, "terrain.dem_5m", fetched)
    else:
        m["layers"].pop("terrain.dem_5m", None)
    add_layer(m, tile, "terrain.dem", info)


def _lidar(tile, m, force):
    # Long (the point cloud streams for the better part of an hour); `python -m pipeline.lidar` runs the same stages
    # without holding the manifest, and this step then only records them.
    from .lidar import build_lidar
    out = build_lidar(tile, force)
    for k, v in out.items():
        add_layer(m, tile, k, v)
    # "dem_only": the 1 m DEM products alone, no point cloud in the public Entwine bucket (lidar.py)
    m["status"]["lidar"] = True if "vegetation.chm_1m" in out else "dem_only"
    # how much of the tile each part reaches (2026-11-04): the 1 m DEM products, and the point cloud (crowns real there)
    cov = (out.get("terrain.dem_1m") or {}).get("coverage") or {}
    pc = ((out.get("client.lidar_cover") or {}).get("stats") or {}).get("covered_share")
    m["status"]["lidar_coverage"] = {"dem_1m": cov.get("share_1m", 1.0), "point_cloud": pc if pc is not None else (1.0 if m["status"]["lidar"] is True else 0.0)}
    if m["status"]["lidar"] is True and pc is not None and pc < 0.98:
        m["status"]["lidar"] = "partial"


def _lidar_applies(tile, m):
    if not regions.covers("usgs_3dep_lidar", tile):
        return f"outside 3DEP ({', '.join(regions.region_of(tile))}): no public lidar; the 5 m base DEM carries the terrain"
    return None


def _naip(tile, m, force):
    from .fetch_naip import fetch_naip
    add_layer(m, tile, "imagery.naip", fetch_naip(tile, force))


def _osm(tile, m, force):
    from .fetch_osm import fetch_osm
    add_layer(m, tile, "footprint.mask", fetch_osm(tile, force))


def _hydro(tile, m, force):
    from .fetch_hydro import fetch_hydro
    out = fetch_hydro(tile, force)
    for k, v in out.items():
        add_layer(m, tile, k, v)
    if any(v.get("source") == "osm" for v in out.values()):   # fetch_hydro's own OSM fallback (no fcodes, no names)
        runlog.fallback("NHDPlus HR unavailable: streams and waterbodies from OSM (no permanence codes)", source="osm")


def _channels(tile, m, force):
    from .channels import build_channels
    for k, v in build_channels(tile).items():
        add_layer(m, tile, k, v)


def _rewild_hydro(tile, m, force):
    from .rewild_hydro import rewild_hydro
    for k, v in rewild_hydro(tile, force).items():
        add_layer(m, tile, k, v)
    m["status"]["hydrology_rewilded"] = True


def _reroute(tile, m, force):
    # Every reach moved onto the lowest ground of the 1 m lidar terrain (pipeline/reroute.py, the water lane's, merged
    # 2026-11-04), keeping the 5 m network's topology and attributes; the depth profile, incision and client features
    # re-derived. A tile whose 5 m heights disagree with its 1 m ground (utm11n_267_4175) is refused by reroute.py: the
    # client draws the 5 m heights, so the step records the refusal and the water keeps the 5 m lines (loud, not fatal).
    # 2026-11-06: the refusal is the step's status (runlog.Refused: `refused`, shown by --status and failed by the
    # audit), not an `ok` with no outputs; the dem step now draws such a tile's DEM from the 1 m ground.
    from .reroute import reroute
    try:
        out, stats = reroute(tile)
    except RuntimeError as e:
        if not str(e).startswith("terrain/dem.tif is not the 1 m ground"):
            raise
        m["status"]["reroute"] = "refused: " + str(e)
        raise runlog.Refused(str(e)) from None
    m["status"]["reroute"] = "rerouted"
    for k, v in out.items():
        add_layer(m, tile, k, v, fetched=False)
    ch = m["layers"].get("hydro.channels")
    if ch:
        add_layer(m, tile, "hydro.channels", {**ch, "rerouted": True, "reroute": stats,
                                              "derived_from": sorted(set(ch.get("derived_from", []) + ["terrain.dem_1m"]))}, fetched=False)
    prof = m["layers"].get("client.channel_profile")
    if prof:
        add_layer(m, tile, "client.channel_profile", {**prof, "stats": stats["profile"],
                                                      "long_profile": "the 1 m ground along the rerouted lines, its non-increasing least-squares trend"},
                  fetched=False)


def _reroute_applies(tile, m):
    return None if "terrain.dem_1m" in m["layers"] else "no 1 m ground (terrain.dem_1m): the streams keep the 5 m lines"


def _water(tile, m, force):
    # The water system (pipeline/water.py, the water lane's): every channel and pond carved to a graded bank profile
    # into terrain/dem_banked.tif, the bed material, the water levels and the riparian zones (client/water.png), and
    # the zone species mixes. It rewrites client/species_mix.json's riparian rows in place, so the layer is re-recorded
    # here (its sha256 went stale on utm11n_267_4175 when the step ran alone).
    from .water import build_water
    for k, v in build_water(tile, force).items():
        add_layer(m, tile, k, v, fetched=False)
    if "client.species_mix" in m["layers"] and tile.path("client/species_mix.json").exists():
        # water.py writes every record's riparian rows (it has no tile's regions): keep only the species of the tile's
        # natural regions (species_mix.riparian_rows), as the flora stage writes them
        import json as _json
        from .regions import natural_regions
        from .species_mix import riparian_rows
        p = tile.path("client/species_mix.json")
        doc = _json.loads(p.read_text())
        if "riparian" in doc:
            # the top-level key (a line at the document's one-space indent): the first '"riparian":' in the text can be
            # a community's share inside `context` (the home tile's, 2026-11-06: the splice ate the rest of the file)
            text = p.read_text()
            rows = riparian_rows(natural_regions(tile))
            new = _json.dumps(rows, separators=(",", ":"))
            key = '\n "riparian":'
            k = text.rfind(key)
            out = None
            if k >= 0:
                start = k + len(key)
                while start < len(text) and text[start] in " \t":
                    start += 1
                depth, i = 0, start
                while i < len(text) and text[start] == "{":
                    ch = text[i]
                    depth += ch == "{"
                    depth -= ch == "}"
                    i += 1
                    if depth == 0:
                        break
                if depth == 0 and i > start:
                    out = text[:start] + new + text[i:]
                    try:
                        if _json.loads(out).get("riparian") != rows:
                            out = None
                    except ValueError:
                        out = None
            if out is None:     # not the layout water.py writes: re-serialise (loses the one-row-per-line layout)
                doc["riparian"] = rows
                out = _json.dumps(doc, indent=1)
            p.write_text(out)
        add_layer(m, tile, "client.species_mix", m["layers"]["client.species_mix"], fetched=False)
    if "hydro.edges" in m["layers"] and tile.path("hydro/edges.json").exists():
        # water.py writes the level, depth and half width at each crossing into the reroute step's hydro/edges.json
        add_layer(m, tile, "hydro.edges", m["layers"]["hydro.edges"], fetched=False)
    m["status"]["water_banked"] = True


def _veg(tile, m, force):
    from .fetch_vegetation import fetch_vegetation
    for k, v in fetch_vegetation(tile, force).items():
        add_layer(m, tile, k, v)
    m["status"]["vegetation_backfilled"] = True


def _ground(tile, m, force):
    from .ground import build_ground
    layers, errors = build_ground(tile, force)
    for k, v in layers.items():
        add_layer(m, tile, k, v)
    if "client.strata" not in layers:   # no column on this tile (pipeline/strata.py): none left from an earlier build
        m["layers"].pop("client.strata", None)
    if errors:
        raise RuntimeError("; ".join(errors))


def _substrate(tile, m, force):
    # lithology by geology unit, how each rock breaks, and the exposed rock (pipeline/substrate.py); reads what ground,
    # lidar, naip, veg, water, erase and derive wrote, so it runs after all of them (it ran before erase and derive in
    # the old step list and read raw NAIP, where roofs and roads look like rock)
    from .substrate import build_substrate
    for k, v in build_substrate(tile).items():
        add_layer(m, tile, k, v, fetched=False)


def _species(tile, m, force):
    from .fetch_species import fetch_species
    for k, v in fetch_species(tile, force).items():
        add_layer(m, tile, k, v)
    from .config import TILES_DIR as TD
    from .species_data import ALARM_CALL, CALENDAR, SEASONS, SIGNATURE, SPECIES as SPECIES_DATA, detection_matrix, perceives_on
    # perceives: only the species present on the tile (species.json `present`, fetch_species.presence), so an absent one
    # is neither met nor played here; detects, signatures and alarm_calls stay species-level tables
    present = [s["code"] for s in read_json(tile.path("species/species.json")) if s.get("present", True)]
    # senses (2026-10-29): each species' own ranges, so the client can split a notice into what is seen and heard and
    # what is smelled
    senses = {sp["code"]: {k: v["range_m"] for k, v in sp["senses"].items()} for sp in SPECIES_DATA}
    write_json(tile.path("perception.json"), {"perceives": perceives_on(present), "detects": detection_matrix(), "signatures": SIGNATURE,
                                             "senses": senses, "alarm_calls": ALARM_CALL})
    write_json(tile.path("calendar.json"), {"seasons": SEASONS, "activities": CALENDAR})
    add_layer(m, tile, "perception", {"path": "perception.json", "kind": "table"}, fetched=False)
    add_layer(m, tile, "calendar", {"path": "calendar.json", "kind": "table"}, fetched=False)
    # locomotion (2026-10-29): how each present species moves, from its taxon and its body (locomotion.py)
    from .locomotion import write_tile as write_locomotion
    write_locomotion(tile.tile_id, TD)
    add_layer(m, tile, "locomotion", {"path": "locomotion.json", "kind": "table"}, fetched=False)
    add_species_prior(m, tile)


def _plants(tile, m, force):
    # The tile's plant needs (pipeline/needs.py): every species its LANDFIRE communities and its GBIF records name;
    # those with a trait card and no library record are grown now (pipeline/plantgen.py), the rest queued with the
    # stand-in the species mix draws for them.
    # First the tile's canopy (pipeline/tree_cards.py, 2026-11-06): its dominant trees by open plots, place descriptions
    # and records, and a trait card for each that has a research record, so a tile draws its own trees.
    from .needs import plant_needs
    from .tree_cards import run as canopy
    from .ground_cards import run as ground_cards
    add_layer(m, tile, "species.canopy", canopy(tile), fetched=False)
    # Outside the regional tables (2026-11-06, iteration 7): the tile's own grasses and forbs (pipeline/ground_cards.py)
    g = ground_cards(tile)
    if not g.get("skipped"):
        add_layer(m, tile, "species.ground", g, fetched=False)
    add_layer(m, tile, "species.plant_needs", plant_needs(tile, generate=True), fetched=False)


def _water_seasons(tile, m, force):
    # Every mapped waterbody tested against the tile's monthly Sentinel-2 composites (pipeline/water_seasons.py): the
    # polygons open water in no month are dropped as water (their bed recorded), those wet in some months are seasonal.
    from .water_seasons import classify
    for k, v in classify(tile).items():
        add_layer(m, tile, k, v, fetched=False)


def _water_imagery(tile, m, force):
    # The reverse of water_seasons (pipeline/water_imagery.py): every drawn reach against the imagery's water, the
    # undrawn water listed, and the large rivers whose drawn line misses the imagery's channel moved onto it (the Lamar
    # River on the 5 m DEM's thalweg 20-200 m from its 2022 channel); the profile, incision and features re-derived.
    from .water_imagery import water_imagery
    layers, stats = water_imagery(tile)
    for k, v in layers.items():
        add_layer(m, tile, k, v, fetched=False)
    ch = m["layers"].get("hydro.channels")
    moved = bool(stats.get("reaches_moved") or stats.get("reaches_bent") or stats.get("side_channels") or stats.get("nhd_dropped"))
    if ch:
        add_layer(m, tile, "hydro.channels", {**ch, "imagery_moved": moved, "water_imagery": stats,
                                              "derived_from": sorted(set(ch.get("derived_from", []) + ["seasons.s2_monthly"]))},
                  fetched=False)
    for k in ("client.channel_profile", "client.channel_depth"):   # rewritten in place when a line moved
        if k in m["layers"]:
            add_layer(m, tile, k, m["layers"][k], fetched=False)


def _terrain(tile, m, force):
    # The base layer's client rasters (was the first half of `derive`): hillshade, terrain RGB, footprint raster, NAIP png,
    # habitat png, the rewilded texture, heights, habitat, canopy, roads, the textures, masks and features (places,
    # territories). Reads the banked DEM when the water step made one.
    from . import derive
    need = [k for k in ("terrain.dem", "imagery.naip", "vegetation.habitat", "vegetation.evt", "vegetation.bps",
                        "hydro.flowlines") if k not in m["layers"]]
    if need:   # the old derive logged ok and wrote nothing without these (Yosemite, 2026-10-28)
        raise RuntimeError(f"terrain needs {', '.join(need)}; run their steps first")
    add_layer(m, tile, "terrain.hillshade", derive.hillshade(tile))
    add_layer(m, tile, "terrain.terrain_rgb", derive.terrain_rgb(tile))
    if "footprint.mask" in m["layers"]:
        add_layer(m, tile, "footprint.mask_raster", derive.mask_raster(tile))
    add_layer(m, tile, "imagery.naip_png", derive.naip_png(tile))
    for k, v in derive.habitat_png(tile).items():
        add_layer(m, tile, k, v)
    add_layer(m, tile, "terrain.rewilded", derive.rewilded_texture(tile))
    for k, v in derive.client_rasters(tile).items():
        if k != "client.mast":          # the acorn mast is the fauna stage's (resources)
            add_layer(m, tile, k, v)


def _species_mix(tile, m, force):
    # The flora stage's mix per 30 m cell: trees, shrubs and the ground layer from the communities, the elevation zones,
    # the groves and the stand-ins (pipeline/species_mix.py).
    from .species_mix import species_mix
    add_layer(m, tile, "client.species_mix", species_mix(tile))


def _canopy_top(tile, m, force):
    # The measured stand height per 30 m cell (pipeline/canopy_top.py) from the 10 m canopy height map, for the client's
    # tree heights (client/src/stature.js: measured stature wins over a species' modelled curve). A lidar tile reads its
    # point cloud's CHM; a global tile also fetches Meta's CHM v2 and ETH's GEDI-calibrated map (pipeline/canopy_maps.py)
    # and takes its height by the rule in canopy_top.py (2026-11-06, iteration 6).
    from .canopy_top import canopy_top
    src = (m.get("layers", {}).get("vegetation.canopy_height_10m") or {}).get("source")
    if not src and (m.get("status", {}).get("lidar") is True or tile.path("vegetation/chm_1m.tif").exists()):
        src = "usgs_3dep_lpc"   # a fresh build's lidar CHM before its layer is recorded (Lamar, 2026-11-06)
    if not (src or "").startswith("usgs_3dep"):
        from .canopy_maps import fetch
        for k, v in fetch(tile, force).items():
            add_layer(m, tile, k, v)
    add_layer(m, tile, "client.canopy_top", canopy_top(tile, src), fetched=False)


def _has_canopy_map(tile, m):
    if tile.path("vegetation/canopy_height_10m.tif").exists():
        return None
    return "no canopy height map on this tile (LANDFIRE's EVH is a modelled class, not a measurement): the modelled heights stand"


def _resources(tile, m, force):
    # The fauna stage's resources (pipeline/resources.py): what an animal eats, drinks and hides in, by season; and the
    # acorn mast raster for the acorn game (client/mast.png, written by derive.client_rasters once acorn_mast exists).
    from . import derive
    from .resources import derive_resources
    add_layer(m, tile, "resources", derive_resources(tile))
    mast = derive.client_rasters(tile).get("client.mast")
    if mast:
        add_layer(m, tile, "client.mast", mast)


def _games(tile, m, force):
    # the species' games, classified from the calendar, perception and the resources (pipeline/games.py)
    from .games import derive_games
    add_layer(m, tile, "games", derive_games(tile), fetched=False)


def _ice(tile, m, force):
    # Permanent snow and ice (pipeline/ice.py): LANDFIRE's Snow-Ice cells and OSM's natural=glacier, as a base-layer mask
    # the flora stage keeps bare and the water lane can seed meltwater from.
    from .ice import build_ice
    add_layer(m, tile, "terrain.ice", build_ice(tile), fetched=False)


def _seams(tile, m, force):
    # Where this tile borders a built tile (pipeline/seams.py): the DEM and the streams must agree along the shared edge.
    from .seams import check_seams
    rep = check_seams(tile)
    m["seams"] = rep
    bad = [f"{e['side']} with {e['neighbour']}: {e['problem']}" for e in rep.get("edges", []) if e.get("problem")]
    if bad:
        raise RuntimeError("seams: " + "; ".join(bad))


def _animals(tile, m, force):
    # The fauna stage's research (pipeline/fauna.py): every animal the tile's records name, ranked; each predator and
    # scavenger; traits for those with no species_data entry (EltonTraits diet and mass, taxon defaults, locomotion);
    # the Meshy queue with its estimate and the stand-in drawn meanwhile.
    from .fauna import animal_research
    from .fauna_slots import fauna_slots
    add_layer(m, tile, "species.animals", animal_research(tile), fetched=False)
    # the tile's own animals for the client (world pipeline phase 1): which curated species may spawn here, and a stand-in
    # slot per researched species (pipeline/fauna_slots.py)
    add_layer(m, tile, "client.fauna", fauna_slots(tile), fetched=False)


def _stills(tile, m, force):
    # A still for every slot of client/fauna.json (pipeline/stills.py): a modelled animal's model rendered headless in the
    # stills' framing, a stand-in's its kin's still; shared assets (client/assets/opening/, index.json), the tile's report
    # its layer (which file each chip shows and how it was made).
    from .stills import tile_stills
    add_layer(m, tile, "fauna.stills", tile_stills(tile, force), fetched=False)


def _game_seeds(tile, m, force):
    # Each game's world seed (pipeline/games.py game_seeds, game_seeds.json): the acorn, dig and carrion worlds' seed number, players and
    # hotspots, so a world started anywhere on the tile is the same for every node.
    from .games import game_seeds
    add_layer(m, tile, "games.seeds", game_seeds(tile), fetched=False)


def _has_canopy(tile, m):
    """inpaint applies with the lidar CHM, or (no point cloud) with the global canopy map of the world pipeline's landcover."""
    if tile.path("vegetation/chm_1m.tif").exists():
        return None
    from . import regions
    if not regions.covers("usgs_3dep_lidar", tile) and tile.path("vegetation/canopy_height_10m.tif").exists():
        return None
    return _has_chm(tile, m)


def _has_chm(tile, m):
    if not tile.path("vegetation/chm_1m.tif").exists():
        return "no point cloud on this tile (DEM-only lidar or none): no canopy height model, so no crowns to find or inpaint"
    return None


def _crowns(tile, m, force):
    # The crown finder again, now that osm (buildings, bridges), veg (the rewilded classes) and derive (the dense-urban
    # mask) exist. Needs vegetation/multi_1m.tif (the lidar step writes it) or the kept point-cloud grids.
    from .lidar import build_crowns, build_dem_1m, layers as lidar_layers
    build_crowns(tile)
    stats = read_json(tile.path("terrain/lidar_stats.json"))
    add_layer(m, tile, "client.trees_lidar", lidar_layers(tile, build_dem_1m(tile), stats)["client.trees_lidar"], fetched=False)


def _erase(tile, m, force):
    from .erase_imagery import erase_imagery
    add_layer(m, tile, "client.texture_imagery", erase_imagery(tile), fetched=False)
    m["status"]["imagery_erased"] = True


def _inpaint(tile, m, force):
    # The ground-only base texture: tree crowns (lidar CHM 3 m and taller) and their shadows synthesized from clean
    # ground of the same class (pipeline/inpaint_crowns.py); needs erase and lidar. Without a point cloud but with the
    # global canopy map (world pipeline): the imagery blended toward leaf litter under the canopy.
    from .inpaint_crowns import inpaint_crowns, litter_under_canopy
    if tile.path("vegetation/chm_1m.tif").exists():
        info = inpaint_crowns(tile)
    else:
        runlog.fallback("no point cloud: the floor under the canopy map's tree cover blended toward leaf litter", product="litter_blend")
        info = litter_under_canopy(tile)
    for k in ("client.texture_ground", "client.texture_ground_mask"):
        add_layer(m, tile, k, info[k], fetched=False)
    m["status"]["crowns_inpainted"] = True


def _seasons(tile, m, force):
    # Sentinel-2 L2A per calendar month (requirements-sentinel.txt); dates already read are cached under
    # pipeline/_cache/sentinel/<tile>/looks/.
    from .fetch_sentinel import build_seasons
    for k, v in build_seasons(tile, force).items():
        add_layer(m, tile, k, v)
    src = m["layers"]["seasons.s2_monthly"]["source"]
    m["sources"][src]["years_used"] = m["layers"]["seasons.s2_monthly"]["years"]


def _ground_albedo(tile, m, force):
    # The factor from the ground texture's display colour to surface reflectance, fitted against the reference month's
    # Sentinel-2 L2A composite over open ground (pipeline/ground_albedo.py); the client scales the ground and the herb
    # layer by it.
    from .ground_albedo import ground_albedo
    add_layer(m, tile, "client.ground_albedo", ground_albedo(tile, m), fetched=False)


def _weather(tile, m, force):
    # Last year's hourly weather at the tile centre from Open-Meteo's archive (pipeline/fetch_weather.py); the raw
    # answer is cached under pipeline/_cache/weather/<tile>/ per period end date.
    from .fetch_weather import fetch_weather
    add_layer(m, tile, "client.weather", fetch_weather(tile, force))


def _unreal(tile, m, force):
    from .export_unreal import export_unreal
    add_layer(m, tile, "unreal", export_unreal(tile), fetched=False)


def _registry(tile, m, force):
    # The tile's species at their fidelity (pipeline/registry.py): every species the tile needs, plants and animals, the
    # asset each has and its level, the stand-in drawn for the missing ones, the Meshy jobs queued for the animals
    from .registry import tile_report
    add_layer(m, tile, "species.registry", tile_report(tile), fetched=False)


def _audit(tile, m, force):
    # The licence audit (pipeline/audit_licenses.py), part of the build since 2026-11-04: every source carries its
    # credit, every layer's source is listed, and the client-facing layers carry no CC BY-NC data.
    from .audit_licenses import audit_attribution, audit
    from .config import all_sources
    problems, warnings = audit_attribution(m, all_sources())
    for k, v in m["layers"].items():
        if k.startswith("client.") and v.get("for_clients") is False:
            problems.append(f"layer {k} is client-facing but marked for_clients false")
    for w in warnings:
        runlog.note(w)
    a = audit(tile.tile_id)
    m["licence_audit"] = {"at": now_iso(), "problems": problems, "warnings": warnings,
                          "occurrence_records": a["records"], "non_commercial_fraction": a["non_commercial_fraction"]}
    # the build's own audit (2026-11-06): a step that refused or failed is a problem of the tile, not a pass
    build_problems = refusals(m)
    m["build_audit"] = {"at": now_iso(), "problems": build_problems}
    if problems or build_problems:
        raise RuntimeError("; ".join((["licence audit: " + "; ".join(problems[:6])] if problems else []) +
                                     (["build audit: " + "; ".join(build_problems[:6])] if build_problems else [])))


def _species_prior(tile, m, force):
    add_species_prior(m, tile)


# ---------------------------------------------------------------------------------------------------------------
# The graph. Order is a valid topological order; `after` is what the fingerprint and the dependency check use.

# The four stages (Aaron, 2026-11-04): each runnable on its own (--stage), in this order; a step reads only its own and
# earlier stages' outputs (_check_graph). base: the ground, the water and the light; flora: what grows; fauna: what
# lives there; games: what the animals do. registry and audit close the games stage (they read every stage).
STAGES = ("base", "flora", "fauna", "games")
B, F, A, G = STAGES

STEPS: dict[str, Step] = {s.name: s for s in [
    # ---------------------------------------------------------------- base
    Step("dem", "2", ["fetch_dem", "arcgis", "fetch_global", "lidar", "fetch_lidar"], [], _dem, ["terrain.dem", "terrain.dem_5m"],
         ["usgs_3dep", "pc_3dep_seamless", "nasadem", "copernicus_dem_glo30", "usgs_3dep_lidar"],
         doc="the drawn 5 m bare-earth DEM: the 1 m ground averaged where its products cover >= 95 % of the tile, "
             "else the fetched 5 m", stage=B),
    Step("naip", "1", ["fetch_naip", "arcgis", "fetch_global"], [], _naip, ["imagery.naip"], ["pc_naip", "usgs_naip", "sentinel2_l2a"],
         doc="present-day imagery at 2.5 m", stage=B),
    Step("osm", "1", ["fetch_osm"], [], _osm, ["footprint.mask"], ["osm"], doc="the human footprint: buildings, roads, dams", stage=B),
    Step("hydro", "1", ["fetch_hydro"], [], _hydro, ["hydro.flowlines", "hydro.waterbodies"], ["nhdplus_hr", "osm"],
         owner="water lane", doc="NHD streams and waterbodies (OSM fallback)", stage=B),
    Step("channels", "1", ["channels", "fetch_global"], ["dem", "hydro"], _channels, ["hydro.channels", "client.channel_depth"],
         owner="water lane", doc="every stream routed by gravity on the DEM; NHD gives names and permanence", stage=B),
    Step("rewild_hydro", "1", ["rewild_hydro", "channels"], ["dem", "channels", "hydro", "osm"], _rewild_hydro,
         ["hydro.human_water", "terrain.dem_rewilded", "client.channel_profile"], ["osm", "native_land"],
         owner="water lane", doc="dams breached, reservoirs drained, channels re-routed, pool-riffle profile", stage=B),
    Step("landcover", "2", ["fetch_vegetation", "habitat", "landcover_global", "ecosystem", "fetch_global"], ["rewild_hydro"], _veg,
         ["vegetation.", "climate."], ["landfire", "esa_worldcover", "meta_canopy_height", "open_meteo", "soilgrids", "iucn_get"],
         doc="LANDFIRE EVT/EVC/EVH/BpS and the habitat classes, human cells backfilled from BpS: what covers the ground, "
             "which the base layer's erasure, substrate and textures need; the flora stage reads it for its species", stage=B),
    Step("ice", "1", ["ice"], ["dem", "landcover"], _ice, ["terrain.ice"], ["osm"],
         doc="permanent snow and ice: LANDFIRE Snow-Ice and OSM glaciers", stage=B),
    Step("lidar", "1", ["lidar", "fetch_lidar", "urban"], ["dem", "osm", "landcover"], _lidar,
         ["terrain.dem_1m", "terrain.dsm_1m", "vegetation.chm_1m", "vegetation.multi_1m", "terrain.lidar_dtm_check",
          "vegetation.canopy_height_10m", "client.canopy_height", "client.terrain_detail",
          "terrain.roughness", "client.lidar_micro", "client.lidar_cover"], ["usgs_3dep_lidar"], applies=_lidar_applies,
         doc="1 m ground, canopy height from the 3DEP point cloud; DEM-only from the 1 m products without one", stage=B),
    Step("reroute", "1", ["reroute", "rewild_hydro", "water_seams"], ["dem", "channels", "rewild_hydro", "hydro", "lidar", "ice"],
         _reroute, ["hydro.channels_5m", "hydro.edges"], applies=_reroute_applies, owner="water lane",
         doc="every stream onto the 1 m lidar thalweg; meltwater from the ice's toes; streams continued across the seams", stage=B),
    Step("seasons", "1", ["fetch_sentinel"], ["landcover", "lidar", "naip"], _seasons,
         ["seasons.s2_monthly", "client.season_rgb", "client.season_ndvi"], ["sentinel2_l2a"],
         doc="Sentinel-2 monthly ground colour", stage=B),
    Step("water_seasons", "1", ["water_seasons"], ["hydro", "seasons"], _water_seasons, ["hydro.waterbody_seasons"], [],
         owner="water lane", doc="every mapped waterbody against the monthly Sentinel-2: permanent, seasonal or dry", stage=B),
    Step("water_imagery", "1", ["water_imagery", "water_seasons", "reroute", "rewild_hydro", "channels"],
         ["dem", "channels", "rewild_hydro", "reroute", "seasons", "water_seasons", "hydro"], _water_imagery,
         ["hydro.water_imagery", "hydro.channels_dem"], [], owner="water lane",
         doc="the reverse test: drawn reaches against the imagery's water; large rivers moved onto it", stage=B),
    Step("water", "2", ["water", "water_seams", "water_seasons"], ["dem", "rewild_hydro", "reroute", "hydro", "lidar", "water_seasons", "water_imagery"], _water,
         ["terrain.dem_banked", "client.heights", "client.water", "hydro.water_reaches"], [], owner="water lane",
         doc="banks, beds, levels and riparian zones", stage=B),
    Step("ground", "2", ["ground", "fetch_soils", "fetch_geology", "soils_global", "fetch_global", "strata", "substrate"], ["dem", "landcover", "lidar"], _ground,
         ["geology.", "soils.", "client.geology", "client.soils", "client.outcrop", "client.ground_classes", "client.strata"],
         ["macrostrat", "usda_sda", "soilgrids"], doc="geology and soils, outcrop likelihood, ground classes, the stratigraphic column", stage=B,
         optional=["client.strata"]),
    Step("terrain", "2", ["derive", "urban", "habitat", "fetch_places", "fetch_territories", "water_seasons"],
         ["dem", "naip", "osm", "hydro", "channels", "rewild_hydro", "water", "water_seasons", "landcover", "ice"], _terrain,
         ["terrain.hillshade", "terrain.terrain_rgb", "footprint.mask_raster", "imagery.naip_png", "vegetation.habitat_png",
          "vegetation.habitat_present_png", "terrain.rewilded", "client.habitat", "client.canopy", "footprint.urban",
          "client.roads", "client.texture", "client.masks", "client.imagery", "client.texture_present", "client.features"],
         ["osm", "native_land"], doc="the base layer's client rasters, textures and place names", stage=B),
    Step("erase", "1", ["erase_imagery", "urban"], ["naip", "osm", "landcover", "terrain", "rewild_hydro"], _erase,
         ["client.texture_imagery"], doc="the imagery with the human footprint removed", stage=B),
    Step("substrate", "1", ["substrate"], ["ground", "water", "dem", "lidar", "naip", "landcover", "erase", "terrain", "ice"],
         _substrate, ["client.substrate", "client.substrate_classes"], doc="lithology, cliff morphology, exposed rock", stage=B),
    Step("ground_albedo", "1", ["ground_albedo"], ["seasons", "erase", "terrain"], _ground_albedo, ["client.ground_albedo"], [],
         doc="the ground texture's factor to surface reflectance, fitted against the Sentinel-2 composite", stage=B),
    Step("weather", "1", ["fetch_weather"], [], _weather, ["client.weather"], ["open_meteo"],
         doc="last year's hourly weather at the tile centre", stage=B),
    Step("unreal", "1", ["export_unreal"], ["dem", "landcover"], _unreal, ["unreal"], doc="the Unreal landscape export", stage=B),
    Step("seams", "1", ["seams"], ["dem", "channels", "water"], _seams, [],
         doc="the DEM and streams agree with every built neighbour along the shared edge", stage=B),
    # ---------------------------------------------------------------- flora
    Step("plants", "4", ["needs", "plantgen", "communities", "research", "tree_cards", "ground_cards"], ["landcover", "ice"], _plants,
         ["species.canopy", "species.plant_needs", "species.ground"], ["gbif", "wcvp", "canopy_plots", "landfire_bps", "usda_plants"],
         library=["library/plant_cards", "library/plant_cards/_research"],
         doc="the tile's canopy trees and their cards; outside the regional tables its own grasses and forbs and their cards "
             "(ground_cards); the plants the tile needs, ranked; missing ones grown from their trait cards", stage=F),
    Step("species_mix", "5", ["species_mix", "communities", "regions", "ground_cards"], ["dem", "landcover", "water", "ice", "plants"],
         _species_mix, ["client.species_mix"], library=["library/species"],
         doc="trees, shrubs and ground layer per 30 m cell, with the unmatched communities read from their names", stage=F),
    Step("canopy_top", "2", ["canopy_top", "canopy_maps"], ["landcover", "lidar", "terrain"], _canopy_top,
         ["client.canopy_top", "vegetation.canopy_height_v2_10m", "vegetation.canopy_height_eth_10m"],
         ["meta_canopy_height_v2", "eth_canopy_height"], applies=_has_canopy_map,
         doc="the measured stand height per 30 m cell: the lidar CHM, else Meta's CHM v2 lifted to ETH's GEDI-calibrated "
             "level where v2 sees tall closed forest", stage=F,
         optional=["vegetation.canopy_height_v2_10m", "vegetation.canopy_height_eth_10m"]),
    Step("crowns", "1", ["lidar", "urban"], ["lidar", "osm", "landcover", "terrain", "species_mix"], _crowns,
         ["client.trees_lidar"], applies=_has_chm, doc="the lidar crowns, with the buildings, the rewilded classes and the urban mask",
         stage=F),
    Step("inpaint", "1", ["inpaint_crowns"], ["erase", "lidar", "crowns", "terrain"], _inpaint,
         ["client.texture_ground", "client.texture_ground_mask"], applies=_has_canopy,
         doc="the ground-only base texture with the crowns inpainted", stage=F),
    # ---------------------------------------------------------------- fauna
    Step("species", "1", ["fetch_species", "species_data", "locomotion", "regions"], ["dem", "landcover"], _species,
         ["species.list", "species.occurrences", "species.seasonal", "species.inventory", "perception", "calendar",
          "locomotion", "client.species_prior"], ["gbif"], library=["library/animals"],
         doc="GBIF presence, perception, calendar, locomotion, the client's density prior", stage=A),
    Step("animals", "5", ["fauna", "fauna_slots", "fauna_models", "pantheria", "sociality", "avonet", "amniote", "research", "locomotion"], ["species", "plants"], _animals, ["species.animals", "client.fauna"], ["gbif"],
         library=["library/animals", "data/eltontraits"],
         doc="every animal recorded on the tile, ranked; predators and scavengers; traits for those without; the Meshy queue",
         stage=A),
    Step("stills", "1", ["stills"], ["animals"], _stills, ["fauna.stills"], library=["library/animals", "client/assets/opening"],
         doc="a still for every animal's species chip: a model rendered, a stand-in's kin's (client/assets/opening)", stage=A),
    Step("resources", "2", ["resources", "derive", "water_seasons"], ["dem", "hydro", "water_seasons", "landcover", "terrain", "species_mix", "species"], _resources,
         ["resources", "client.mast"], doc="food, water and cover per season; the acorn mast", stage=A),
    # ---------------------------------------------------------------- games
    Step("games", "1", ["games"], ["species", "resources", "animals"], _games, ["games"],
         doc="every species' games: archetype, hotspots, scarcity, predators, competitors", stage=G),
    Step("game_seeds", "1", ["games"], ["games", "resources", "species"], _game_seeds, ["games.seeds"],
         doc="the acorn, dig and carrion worlds' seeds, players and hotspots", stage=G),
    Step("registry", "1", ["registry", "needs", "fauna"], ["plants", "species_mix", "species", "animals"], _registry,
         ["species.registry"], library=["library/species", "library/animals", "library/plant_cards"],
         doc="every species the tile needs at its fidelity, the stand-ins, the queues and the hand edits left", stage=G),
    Step("audit", "1", ["audit_licenses"], [], _audit, [], doc="the licence audit: every source credited, no CC BY-NC data in "
                                                            "a client layer", stage=G),
]}
STEPS["audit"].after = [n for n in STEPS if n != "audit"]
ALIASES = {"veg": "landcover", "derive": "terrain"}   # old step names (--steps veg / derive keep working)
ORDER = list(STEPS)
# Run on request only (not part of --all): the species prior alone, as the old --steps species_prior did.
EXTRA = {"species_prior": Step("species_prior", "1", ["derive"], ["species"], _species_prior, ["client.species_prior"], stage=A),
         # the old derive: terrain, species_mix, resources and games in one call
         }


def _check_graph() -> None:
    seen = set()
    for n in ORDER:
        st = STAGES.index(STEPS[n].stage)
        for d in STEPS[n].after:
            if d not in seen:
                raise AssertionError(f"step {n} runs before its input {d}")
            if STAGES.index(STEPS[d].stage) > st:
                raise AssertionError(f"step {n} ({STEPS[n].stage}) reads {d} of the later stage {STEPS[d].stage}")
        seen.add(n)
    order = [STAGES.index(STEPS[n].stage) for n in ORDER]
    assert order == sorted(order), "ORDER must run the stages in order"


_check_graph()


# ---------------------------------------------------------------------------------------------------------------
# Hashing: files by content, with a per-tile cache keyed by size and mtime so a 400 MB raster is read once.

class Hashes:
    def __init__(self, tile: Tile):
        self.p = tile.dir / "_cache" / "hashes.json"
        try:
            self.d = json.loads(self.p.read_text())
        except Exception:  # noqa: BLE001
            self.d = {}
        self.dirty = False

    def of(self, path: Path) -> str | None:
        if not path.exists():
            return None
        st = path.stat()
        key = str(path)
        hit = self.d.get(key)
        if hit and hit[0] == st.st_size and hit[1] == st.st_mtime_ns:
            return hit[2]
        h = sha256(path)
        self.d[key] = [st.st_size, st.st_mtime_ns, h]
        self.dirty = True
        return h

    def save(self):
        if self.dirty:
            self.p.parent.mkdir(parents=True, exist_ok=True)
            self.p.write_text(json.dumps(self.d))
            self.dirty = False


def _h(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


_CODE: dict[str, str] = {}


def code_hash(step: Step) -> str:
    if step.name not in _CODE:
        h = hashlib.sha256()
        for mod in sorted(step.modules):
            p = PIPE / f"{mod}.py"
            h.update(mod.encode())
            h.update(p.read_bytes() if p.exists() else b"(missing)")
        _CODE[step.name] = h.hexdigest()[:16]
    return _CODE[step.name]


def library_hash(step: Step) -> dict:
    out = {}
    for rel in step.library:
        d = REPO_ROOT / rel
        h = hashlib.sha256()
        for p in sorted(d.glob("*.json")) if d.exists() else []:
            h.update(p.name.encode())
            h.update(hashlib.sha256(p.read_bytes()).digest())
        out[rel] = h.hexdigest()[:16]
    return out


def params(tile: Tile, step: Step) -> dict:
    p = {"tile": tile.tile_id}
    if step.name in ("dem", "derive"):
        p["dem_res_m"] = tile.dem_res_m
    if step.name in ("naip", "derive", "erase"):
        p["imagery_res_m"] = tile.imagery_res_m
    return p


def owned_layers(step: Step, m: dict) -> list[str]:
    """The manifest layers a step owns: its exact names, and the names under its prefixes ('vegetation.') that no
    other step names exactly (lidar's vegetation.chm_1m is lidar's, not veg's)."""
    claimed = {l for s in list(STEPS.values()) + list(EXTRA.values()) if s is not step for l in s.layers if not l.endswith(".")}
    out = []
    for name in m.get("layers", {}):
        for pat in step.layers:
            if name == pat or (pat.endswith(".") and name.startswith(pat) and name not in claimed):
                out.append(name)
                break
    return out


def last_writers(m: dict) -> dict:
    """{file: the last step in graph order that recorded it}. Some files have two writers (client/heights.png: water,
    then derive; client/terrain_detail.png: lidar, then water); only the last writer checks the file is unchanged."""
    out = {}
    for n in ORDER:
        for rel in ((m.get("steps", {}).get(n) or {}).get("outputs") or {}):
            out[rel] = n
    return out


def outputs_of(tile: Tile, m: dict, layer_names: list[str], hashes: Hashes) -> dict:
    """{tile-relative path: sha256[:16]} of the layers' files (their `path` and any `files`)."""
    out = {}
    for name in sorted(set(layer_names)):
        info = m["layers"].get(name) or {}
        files = info.get("files") or {}
        # `files` is {path: {sha256, bytes}} on most layers and a list of paths (or of {path}) on a few (seasons, unreal)
        rels = [info.get("path")] + (list(files.keys()) if isinstance(files, dict) else
                                     [f.get("path") if isinstance(f, dict) else f for f in files])
        for rel in rels:
            if rel:
                h = hashes.of(tile.dir / rel)
                out[rel] = h[:16] if h else None
    return out


def fingerprint(tile: Tile, step: Step, m: dict) -> tuple[str, dict]:
    deps = {d: (m["steps"].get(d) or {}).get("out_hash") for d in step.after}
    parts = {"version": step.version, "code": code_hash(step), "params": params(tile, step), "deps": deps,
             "library": library_hash(step)}
    return _h(parts), parts


def current(tile: Tile, step: Step, m: dict, hashes: Hashes) -> tuple[bool, str]:
    """(is the step's last run current, why not)."""
    rec = m.get("steps", {}).get(step.name)
    if not rec:
        return False, "never run by the step graph"
    if rec.get("status") not in ("ok", "not_applicable", "adopted"):
        return False, f"last run {rec.get('status')}"
    fp, parts = fingerprint(tile, step, m)
    if rec.get("fingerprint") != fp:
        old = rec.get("parts") or {}
        why = [k for k in ("version", "code", "params", "library") if old.get(k) != parts[k]]
        why += [f"input {d}" for d, h in parts["deps"].items() if (old.get("deps") or {}).get(d) != h]
        return False, "changed: " + ", ".join(why or ["fingerprint"])
    lw = last_writers(m)
    for rel, h in (rec.get("outputs") or {}).items():
        if lw.get(rel, step.name) != step.name:
            continue   # a later step rewrites it (last_writers)
        now = hashes.of(tile.dir / rel)
        if now is None:
            return False, f"output missing: {rel}"
        if h and now[:16] != h:
            return False, f"output changed on disk: {rel}"
    return True, "current"


# ---------------------------------------------------------------------------------------------------------------
# Running

def _sources_of(m: dict, layer_names: list[str]) -> dict:
    out = {}
    for name in layer_names:
        info = m["layers"].get(name) or {}
        for s in [info.get("source")] + list(info.get("sources_used") or []):
            if s and s in m.get("sources", {}):
                out[s] = m["sources"][s].get("retrieved")
    return out


def run_step(tile: Tile, step: Step, m: dict, force: bool, hashes: Hashes) -> dict:
    from . import cost, netmeter
    t0 = time.time()
    started = now_iso()
    cpu0 = cost.rusage()
    meter_dir = tile.dir / "_cache" / "netmeter" / f"{step.name}-{int(t0)}"
    os.environ["WE_NETMETER_DIR"] = str(meter_dir)   # the step's worker processes write their tallies there
    netmeter.install()
    netmeter.reset()
    print(f"[{tile.tile_id}] {step.name} ...", flush=True)
    fp, parts = fingerprint(tile, step, m)
    reason = step.applies(tile, m) if step.applies else None
    runlog.begin(step.name)
    rec = {"version": step.version, "code": parts["code"], "params": parts["params"], "fingerprint": fp, "parts": parts,
           "ran_at": now_iso(), "owner": step.owner}
    try:
        cov = regions.plan(tile, step.sources)
        gaps = {s: c for s, c in cov.items() if not c["covered"]}
        if gaps:
            rec["coverage"] = gaps
        if reason:
            rec.update(status="not_applicable", reason=reason, outputs={}, out_hash=_h(["not_applicable", reason]))
            print(f"[{tile.tile_id}] {step.name}: not applicable: {reason}", flush=True)
        else:
            step.run(tile, m, force)
            r = runlog.end()
            runlog.begin(step.name)
            names = sorted(set(r.get("layers") or []) | set(owned_layers(step, m)) if step.name != "audit" else [])
            outs = outputs_of(tile, m, names, hashes)
            rec.update(status="ok", layers=names, outputs=outs, out_hash=_h(outs), sources=_sources_of(m, names),
                       fallbacks=r["fallbacks"], notes=r["notes"],
                       fetched={"network": sum(1 for f in r["fetched"] if not f["cached"]),
                                "cache": sum(1 for f in r["fetched"] if f["cached"])})
            rec["_fetched"] = r["fetched"]
            if step.name == "audit":
                rec["out_hash"] = _h([m.get("licence_audit", {}).get("problems"), m.get("build_audit", {}).get("problems")])
        ok = True
    except runlog.Refused as e:
        # not fatal to the build (the dependents run on what the step would have replaced) but never `ok`: --status, the
        # audit step and the exit code report it (2026-11-06)
        r = runlog.end()
        reason = str(e)[:800]
        rec.update(status="refused", reason=reason, outputs={}, out_hash=_h(["refused", reason]), fallbacks=r["fallbacks"],
                   notes=r["notes"])
        print(f"[{tile.tile_id}] {step.name} REFUSED: {reason[:300]}", file=sys.stderr, flush=True)
        ok = True
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        r = runlog.end()
        rec.update(status="failed", error=str(e)[:800], fallbacks=r["fallbacks"], out_hash=None)
        ok = False
    runlog.end()
    rec["seconds"] = round(time.time() - t0, 1)
    # the cost meter (pipeline/cost.py)
    netmeter.flush()
    os.environ.pop("WE_NETMETER_DIR", None)
    cpu1 = cost.rusage()
    cache: dict = {}
    for f in rec.pop("_fetched", []) or []:
        c = cache.setdefault(f["source"], {"hits": 0, "misses": 0})
        c["hits" if f["cached"] else "misses"] += 1
    disk = 0
    for rel in (rec.get("outputs") or {}):
        p = tile.dir / rel
        disk += p.stat().st_size if p.is_file() else 0
    meshy = {"spent": 0, "queued": 0, "queued_credits_est": 0}
    if step.name == "registry":
        rp = tile.path("species/registry.json")
        if rp.exists():
            sm = read_json(rp).get("summary", {})
            meshy.update(queued=sm.get("animals_queued", 0), queued_credits_est=sm.get("meshy_credits_queued", 0))
    cost.record_step(tile, step.name, step.stage, {
        "started_at": started, "ended_at": now_iso(), "wall_s": rec["seconds"],
        "cpu_self_s": round(cpu1[0] - cpu0[0], 1), "cpu_children_s": round(cpu1[1] - cpu0[1], 1),
        "downloads": netmeter.collect(str(meter_dir)), "cache": cache, "disk_bytes": disk, "meshy": meshy,
        "status": rec["status"]})
    import shutil
    shutil.rmtree(meter_dir, ignore_errors=True)
    m.setdefault("steps", {})[step.name] = rec
    m.setdefault("log", []).append({"step": step.name, "at": now_iso(), "seconds": rec["seconds"],
                                    "ok": ok and rec["status"] != "refused",
                                    **({"error": rec["error"][:500]} if not ok else {}),
                                    **({"refused": rec["reason"][:500]} if rec["status"] == "refused" else {}),
                                    **({"not_applicable": rec["reason"]} if rec.get("status") == "not_applicable" else {})})
    hashes.save()
    save(tile, m)
    state = (rec["status"] if rec["status"] != "refused" else "REFUSED: " + rec["reason"][:300]) if ok else "FAILED: " + rec.get("error", "")[:300]
    fb = f", {len(rec.get('fallbacks') or [])} fallback(s)" if rec.get("fallbacks") else ""
    print(f"[{tile.tile_id}] {step.name} {state} in {rec['seconds']:.1f}s{fb}", flush=True)
    return rec


def resolve_names(names) -> list[str]:
    return [ALIASES.get(n, n) for n in names]


def build(tile: Tile, *, steps: list[str] | None = None, force: set[str] = frozenset(), keep_going=False,
          plan_only=False, refetch=False, stages: list[str] | None = None) -> dict:
    """Run the graph (or the named steps, or the named stages, in graph order), skipping the current ones. A step whose
    input belongs to a step not run here and never run before is blocked, naming it (run its stage first)."""
    tile.dir.mkdir(parents=True, exist_ok=True)
    m = load_manifest(tile)
    for old, new in ALIASES.items():   # records kept under a step's old name, and fingerprints made with it
        if old in m.get("steps", {}) and new not in m["steps"] and new in STEPS:
            m["steps"][new] = m["steps"].pop(old)
    for rec in m.get("steps", {}).values():
        deps = (rec.get("parts") or {}).get("deps")
        if deps and "veg" in deps and "landcover" not in deps:
            deps["landcover"] = deps.pop("veg")
            rec["fingerprint"] = _h(rec["parts"])
    from .config import GENERATOR, SPEC_VERSION
    m["spec_version"], m["generator"] = SPEC_VERSION, GENERATOR
    hashes = Hashes(tile)
    steps = resolve_names(steps) if steps else None
    force = set(resolve_names(force))
    if stages:
        bad = [st for st in stages if st not in STAGES]
        if bad:
            raise ValueError(f"unknown stage(s) {bad}; stages are {list(STAGES)} or all")
    names = [n for n in ORDER if (steps is None or n in steps) and (not stages or STEPS[n].stage in stages)]
    names += [n for n in (steps or []) if n in EXTRA]
    unknown = [n for n in (steps or []) if n not in STEPS and n not in EXTRA]
    if unknown:
        raise ValueError(f"unknown step(s) {unknown}; steps are {ORDER + list(EXTRA)}")
    failed: set[str] = set()
    refused: set[str] = set()
    plan = []
    run = {"started_at": now_iso(), "stages": []}
    cur_stage = None
    for n in names:
        step = STEPS.get(n) or EXTRA[n]
        if step.stage != cur_stage:
            if cur_stage is not None and run["stages"]:
                run["stages"][-1]["ended_at"] = now_iso()
            cur_stage = step.stage
            run["stages"].append({"stage": cur_stage, "started_at": now_iso(), "steps_run": [], "steps_skipped": []})
        blocked = [d for d in step.after if d in failed]
        missing = [d for d in step.after if d not in names and
                   (m["steps"].get(d) or {}).get("status") not in ("ok", "not_applicable", "adopted", "stale", "refused")]
        if blocked or missing:
            failed.add(n)
            why = (f"blocked by {', '.join(blocked)}" if blocked else
                   f"needs {', '.join(missing)} ({', '.join(sorted({STEPS[d].stage for d in missing if d in STEPS}))} stage), never run")
            plan.append((n, why))
            if not plan_only:
                m["steps"].setdefault(n, {}).update(status="blocked", reason=why)
                print(f"[{tile.tile_id}] {n} blocked: {why}", file=sys.stderr, flush=True)
                if not keep_going and missing:
                    break
            continue
        is_cur, why = current(tile, step, m, hashes)
        if n in force:
            why = "forced"
        elif is_cur:
            plan.append((n, "current, skipped"))
            run["stages"][-1]["steps_skipped"].append(n)
            continue
        plan.append((n, why))
        if plan_only:
            continue
        rec = run_step(tile, step, m, refetch and n in force, hashes)
        run["stages"][-1]["steps_run"].append(n)
        if rec["status"] == "refused":
            refused.add(n)
        if rec["status"] == "failed":
            failed.add(n)
            if not keep_going:
                print(f"[{tile.tile_id}] stopped at {n}: {rec.get('error', '')[:300]}", file=sys.stderr, flush=True)
                break
    hashes.save()
    if run["stages"]:
        run["stages"][-1]["ended_at"] = now_iso()
    run["ended_at"] = now_iso()
    run["failed"] = sorted(failed)
    run["refused"] = sorted(refused)
    if plan_only:
        w = max(len(n) for n, _ in plan) if plan else 4
        for n, why in plan:
            print(f"  {STEPS[n].stage if n in STEPS else '':<6} {n:<{w}}  {why}")
    else:
        save(tile, m)
        from . import cost
        cost.record_run(tile, run)
    m["_failed"] = sorted(failed)
    # every step whose last run refused, run here or before (a skipped one is re-run: `current` is never true for it)
    m["_refused"] = sorted(n for n in ORDER if (m.get("steps", {}).get(n) or {}).get("status") == "refused")
    return m


def refusals(m: dict) -> list[str]:
    """The steps whose last run refused or failed, with the reason, and any status entry saying so: what the audit step
    fails on and --status prints (2026-11-06: a refused reroute had read `ok`)."""
    out = []
    for n in ORDER:
        if n == "audit":
            continue
        rec = (m.get("steps", {}) or {}).get(n) or {}
        if rec.get("status") in ("refused", "failed"):
            out.append(f"{n} {rec['status']}: {(rec.get('reason') or rec.get('error') or '')[:300]}")
    for k, v in (m.get("status") or {}).items():
        if isinstance(v, str) and v.startswith("refused") and not any(o.startswith(k + " ") for o in out):
            out.append(f"status.{k}: {v[:300]}")
    return out


# ---------------------------------------------------------------------------------------------------------------
# Status of a tile built before the graph, and adoption

# Commits known not to change any step's outputs (they changed how a step records, or caches): adoption does not count
# them as code changed since a step ran. Add one only after checking it.
NO_OUTPUT_CHANGE = {
    "646bf2e": "the step graph: runlog.fallback calls, GBIF caching and retries in the fetch modules; the outputs are the same",
}


def _git_changed_after(paths: list[str], when: str, margin_h=12) -> list[str]:
    """Commits touching `paths` more than margin_h after `when` (a run is usually committed within hours of it)."""
    from datetime import datetime, timedelta
    try:
        t = datetime.fromisoformat(when.replace("Z", "+00:00")) + timedelta(hours=margin_h)
        out = subprocess.run(["git", "-C", str(REPO_ROOT), "log", f"--after={t.isoformat()}", "--format=%h %cs %s", "--", *paths],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        return [l[:110] for l in out.splitlines() if l.split(" ", 1)[0] not in NO_OUTPUT_CHANGE]
    except Exception:  # noqa: BLE001
        return []


def last_ok(m: dict, name: str) -> str | None:
    at = None
    for l in m.get("log", []):
        if l.get("ok") and (l["step"] == name or l["step"].startswith(name + " ") or
                            (name == "derive" and l["step"].startswith("species_mix"))):
            at = max(at or "", l["at"])
    return at


def status(tile: Tile) -> list[dict]:
    """Per step: ran (when), the layers it owns present or missing, manifest hashes that no longer match the files,
    code changed since it ran (git), and whether the graph would run it."""
    m = load_manifest(tile)
    hashes = Hashes(tile)
    rows = []
    for n in ORDER:
        step = STEPS[n]
        at = (m.get("steps", {}).get(n) or {}).get("ran_at") or last_ok(m, n)
        have = owned_layers(step, m)
        expect = step.layers
        if n == "lidar" and m.get("status", {}).get("lidar") == "dem_only":
            expect = ["terrain.dem_1m", "client.terrain_detail", "terrain.roughness"]
        if n == "dem" and not (m["layers"].get("terrain.dem") or {}).get("fetched_source"):
            expect = ["terrain.dem"]    # the fetched DEM is a layer of its own only when the 1 m rule drew terrain.dem
        missing = [l for l in expect if not l.endswith(".") and l not in m["layers"] and l not in step.optional]
        mism = []
        for l in have:
            info = m["layers"][l]
            p = tile.dir / (info.get("path") or "")
            if info.get("sha256") and p.is_file():
                h = hashes.of(p)
                if h != info["sha256"]:
                    mism.append(l)
            elif info.get("path") and not p.exists():
                mism.append(l + " (file missing)")
        changed = _git_changed_after([f"pipeline/{x}.py" for x in step.modules] + step.library, at) if at else []
        na = step.applies(tile, m) if step.applies else None
        rec = m.get("steps", {}).get(n) or {}
        rows.append({"step": n, "ran": at, "layers": len(have), "missing_layers": missing if not na else [],
                     "hash_mismatch": mism, "code_since": changed, "not_applicable": na,
                     "graph": rec.get("status"),
                     "problem": (f"{rec['status']}: {(rec.get('reason') or rec.get('error') or '')[:300]}"
                                 if rec.get("status") in ("refused", "failed", "blocked") else
                                 # a refusal recorded before the runner knew the status (Lamar's reroute: `ok`, no outputs)
                                 f"refused: {sv[len('refused: '):][:300]}" if isinstance(sv := (m.get("status") or {}).get(n), str)
                                 and sv.startswith("refused") else None)})
    hashes.save()
    return rows


def adopt(tile: Tile, refresh_stale=True) -> dict:
    """Record a tile built before the graph as the graph's baseline: each step that ran (by the old log) and whose
    layers are on disk gets a fingerprint from the current code, so --all re-runs only what changes from here. A step
    whose code changed after it last ran (git, 12 h margin) or whose files no longer match their manifest hashes is
    recorded `stale` (no fingerprint), so the next --all runs it, and then its dependents if its outputs change."""
    m = load_manifest(tile)
    hashes = Hashes(tile)
    st = {r["step"]: r for r in status(tile)}
    for n in ORDER:
        step = STEPS[n]
        r = st[n]
        if (m.get("steps", {}).get(n) or {}).get("status") == "ok":
            continue
        names = owned_layers(step, m)
        reason = step.applies(tile, m) if step.applies else None
        stale = []
        if r["code_since"]:
            stale.append(f"code changed since it ran: {r['code_since'][0]}" + (f" (+{len(r['code_since']) - 1})" if len(r['code_since']) > 1 else ""))
        if r["hash_mismatch"]:
            stale.append("files differ from the manifest: " + ", ".join(r["hash_mismatch"][:4]))
        if r["missing_layers"]:
            stale.append("layers missing: " + ", ".join(r["missing_layers"][:4]))
        if not r["ran"] and not reason:
            stale.append("never ran")
        fp, parts = fingerprint(tile, step, m)
        rec = {"version": step.version, "code": parts["code"], "params": parts["params"], "parts": parts,
               "ran_at": r["ran"], "adopted_at": now_iso(), "layers": names}
        if reason:
            rec.update(status="not_applicable", reason=reason, outputs={}, out_hash=_h(["not_applicable", reason]), fingerprint=fp)
        elif stale and refresh_stale:
            outs = outputs_of(tile, m, names, hashes)
            rec.update(status="stale", stale=stale, outputs=outs, out_hash=_h(outs), fingerprint=None)
        else:
            outs = outputs_of(tile, m, names, hashes)
            rec.update(status="adopted", outputs=outs, out_hash=_h(outs), fingerprint=fp, stale=stale or None)
        m.setdefault("steps", {})[n] = rec
    hashes.save()
    save(tile, m)
    return m
