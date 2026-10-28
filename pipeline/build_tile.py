"""Build a tile package.

    python -m pipeline.build_tile --anchor -120.7985 38.7296
    python -m pipeline.build_tile --tile utm10n_690_4280 --steps species,derive
    python -m pipeline.build_tile --tile utm10n_690_4280 --steps species_prior   # client prior only, no fetch
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps lidar,ground    # 1 m DEM, point cloud, crowns (pipeline/lidar.py)
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps seasons         # Sentinel-2 monthly colour (pipeline/fetch_sentinel.py)
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps weather         # last year's hourly weather (pipeline/fetch_weather.py)
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps inpaint         # ground-only base texture (pipeline/inpaint_crowns.py)
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback

from .config import (ATTRIBUTION_FIELDS, GENERATOR, SPEC_VERSION, TILES_DIR, Tile, all_sources, now_iso,
                     read_json, sha256, today, write_json)
from .species_data import CALENDAR, PERCEPTION, SEASONS

ALL_STEPS = ["dem", "lidar", "naip", "osm", "hydro", "channels", "rewild_hydro", "veg", "ground", "species", "derive", "crowns", "erase", "inpaint", "seasons", "weather", "unreal"]


def load_manifest(tile: Tile) -> dict:
    p = tile.dir / "manifest.json"
    if p.exists():
        return read_json(p)
    w, s, e, n = tile.bounds_wgs84
    return {
        "spec_version": SPEC_VERSION, "tile_id": tile.tile_id, "crs": tile.crs,
        "bounds": list(tile.bounds), "bounds_wgs84": [w, s, e, n], "size_m": 10000,
        "generated_at": now_iso(), "generator": GENERATOR,
        "status": {"human_landforms_removed": False, "hydrology_rewilded": False, "projection_years": 0},
        "layers": {}, "sources": {}, "edits": [], "log": [],
    }


def add_layer(m: dict, tile: Tile, name: str, info: dict, fetched: bool = True) -> None:
    """`fetched=False` for a layer derived from data already in the package: its sources keep the
    date they were retrieved on."""
    p = tile.dir / info["path"]
    if p.exists():
        info["sha256"] = sha256(p)
        info["bytes"] = p.stat().st_size
    m["layers"][name] = info
    record_source(m, info.get("source"), fetched)
    for src in info.get("sources_used", []):
        record_source(m, src, fetched)


def record_source(m: dict, src: str | None, fetched: bool = True) -> None:
    """Copy a source's registry entry (licence and attribution included) into the manifest."""
    sources = all_sources()
    if not src or src not in sources:
        return
    missing = [f for f in ATTRIBUTION_FIELDS if f not in sources[src]]
    if missing:
        raise ValueError(f"source {src} has no {', '.join(missing)}; see tile-spec.md, Sources")
    prev = m["sources"].get(src, {}).get("retrieved")
    m["sources"][src] = {**sources[src], "retrieved": today() if fetched or not prev else prev}


def add_species_prior(m: dict, tile: Tile) -> None:
    """The client's animal density prior from CC0 / CC BY records (derive.species_prior); the
    records themselves are marked pipeline-only (tile-spec.md, `for_clients`)."""
    from .derive import species_prior
    occ = m["layers"].get("species.occurrences")
    if not occ:
        raise RuntimeError("no species.occurrences layer; run the species step")
    occ["for_clients"] = False
    occ["for_clients_note"] = ("per-record licences include CC BY-NC; clients read client.species_prior, "
                               "built from CC0 and CC BY records only")
    if "species.seasonal" in m["layers"]:     # monthly counts over every record, CC BY-NC included
        m["layers"]["species.seasonal"]["for_clients"] = False
    add_layer(m, tile, "client.species_prior", species_prior(tile), fetched=False)


def run(tile: Tile, steps: list[str], force=False) -> dict:
    m = load_manifest(tile)
    m["spec_version"], m["generator"] = SPEC_VERSION, GENERATOR
    for step in steps:
        t0 = time.time()
        print(f"[{tile.tile_id}] {step} ...", flush=True)
        try:
            if step == "dem":
                from .fetch_dem import fetch_dem
                add_layer(m, tile, "terrain.dem", fetch_dem(tile, force))
            elif step == "lidar":
                # Long (the point cloud streams for the better part of an hour); `python -m pipeline.lidar`
                # runs the same stages without holding the manifest, and this step then only records them.
                from .lidar import build_lidar
                out = build_lidar(tile, force)
                for k, v in out.items():
                    add_layer(m, tile, k, v)
                # "dem_only": the 1 m DEM products alone, no point cloud in the public Entwine bucket (lidar.py)
                m["status"]["lidar"] = True if "vegetation.chm_1m" in out else "dem_only"
            elif step == "naip":
                from .fetch_naip import fetch_naip
                add_layer(m, tile, "imagery.naip", fetch_naip(tile, force))
            elif step == "osm":
                from .fetch_osm import fetch_osm
                add_layer(m, tile, "footprint.mask", fetch_osm(tile, force))
            elif step == "hydro":
                from .fetch_hydro import fetch_hydro
                for k, v in fetch_hydro(tile, force).items():
                    add_layer(m, tile, k, v)
            elif step == "channels":
                from .channels import build_channels
                for k, v in build_channels(tile).items():
                    add_layer(m, tile, k, v)
            elif step == "rewild_hydro":
                from .rewild_hydro import rewild_hydro
                for k, v in rewild_hydro(tile, force).items():
                    add_layer(m, tile, k, v)
                m["status"]["hydrology_rewilded"] = True
            elif step == "veg":
                from .fetch_vegetation import fetch_vegetation
                for k, v in fetch_vegetation(tile, force).items():
                    add_layer(m, tile, k, v)
                m["status"]["vegetation_backfilled"] = True
            elif step == "ground":
                from .ground import build_ground
                layers, errors = build_ground(tile, force)
                for k, v in layers.items():
                    add_layer(m, tile, k, v)
                if errors:
                    raise RuntimeError("; ".join(errors))
            elif step == "species":
                from .fetch_species import fetch_species
                for k, v in fetch_species(tile, force).items():
                    add_layer(m, tile, k, v)
                write_json(tile.path("perception.json"), {"perceives": PERCEPTION})
                write_json(tile.path("calendar.json"), {"seasons": SEASONS, "activities": CALENDAR})
                add_layer(m, tile, "perception", {"path": "perception.json", "kind": "table"})
                add_layer(m, tile, "calendar", {"path": "calendar.json", "kind": "table"})
                add_species_prior(m, tile)
            elif step == "species_prior":
                add_species_prior(m, tile)
            elif step == "derive":
                from . import derive
                if "terrain.dem" in m["layers"]:
                    add_layer(m, tile, "terrain.hillshade", derive.hillshade(tile))
                    add_layer(m, tile, "terrain.terrain_rgb", derive.terrain_rgb(tile))
                    if "footprint.mask" in m["layers"]:
                        add_layer(m, tile, "footprint.mask_raster", derive.mask_raster(tile))
                if "imagery.naip" in m["layers"]:
                    add_layer(m, tile, "imagery.naip_png", derive.naip_png(tile))
                if "vegetation.habitat" in m["layers"]:
                    for k, v in derive.habitat_png(tile).items():
                        add_layer(m, tile, k, v)
                    if "terrain.hillshade" in m["layers"]:
                        add_layer(m, tile, "terrain.rewilded", derive.rewilded_texture(tile))
                    if "terrain.dem" in m["layers"]:
                        for k, v in derive.client_rasters(tile).items():
                            add_layer(m, tile, k, v)
                    if "vegetation.evt" in m["layers"] and "vegetation.bps" in m["layers"]:
                        from .species_mix import species_mix
                        add_layer(m, tile, "client.species_mix", species_mix(tile))
                    if "hydro.flowlines" in m["layers"] and "terrain.dem" in m["layers"]:
                        from .resources import derive_resources
                        add_layer(m, tile, "resources", derive_resources(tile))
                    if "resources" in m["layers"]:   # the species' games, classified from the calendar, perception and the resources (pipeline/games.py)
                        from .games import derive_games
                        add_layer(m, tile, "games", derive_games(tile), fetched=False)
            elif step == "crowns":
                # The crown finder again, now that osm (buildings, bridges), veg (the rewilded classes) and derive (the
                # dense-urban mask) exist: the lidar step runs before them and its first crown list knows none of them.
                # Needs vegetation/multi_1m.tif (the lidar step writes it) or the kept point-cloud grids.
                if "vegetation.chm_1m" in m["layers"]:
                    from .lidar import build_crowns, build_dem_1m, layers as lidar_layers
                    build_crowns(tile)
                    stats = read_json(tile.path("terrain/lidar_stats.json"))
                    add_layer(m, tile, "client.trees_lidar", lidar_layers(tile, build_dem_1m(tile), stats)["client.trees_lidar"])
                else:
                    print(f"[{tile.tile_id}] crowns: no lidar on this tile, skipped")
            elif step == "erase":
                from .erase_imagery import erase_imagery
                add_layer(m, tile, "client.texture_imagery", erase_imagery(tile))
                m["status"]["imagery_erased"] = True
            elif step == "inpaint":
                # The ground-only base texture: tree crowns (lidar CHM 3 m and taller) and their shadows synthesized
                # from clean ground of the same class (pipeline/inpaint_crowns.py); needs erase and lidar.
                if "vegetation.chm_1m" in m["layers"]:
                    from .inpaint_crowns import inpaint_crowns
                    info = inpaint_crowns(tile)
                    for k in ("client.texture_ground", "client.texture_ground_mask"):
                        add_layer(m, tile, k, info[k])
                    m["status"]["crowns_inpainted"] = True
                else:
                    print(f"[{tile.tile_id}] inpaint: no lidar canopy on this tile, skipped (the client draws the imagery)")
            elif step == "seasons":
                # Sentinel-2 L2A per calendar month (requirements-sentinel.txt); dates already read
                # are cached under pipeline/_cache/sentinel/<tile>/looks/.
                from .fetch_sentinel import build_seasons
                for k, v in build_seasons(tile, force).items():
                    add_layer(m, tile, k, v)
                src = m["layers"]["seasons.s2_monthly"]["source"]
                m["sources"][src]["years_used"] = m["layers"]["seasons.s2_monthly"]["years"]
            elif step == "weather":
                # Last year's hourly weather at the tile centre from Open-Meteo's archive (pipeline/fetch_weather.py);
                # the raw answer is cached under pipeline/_cache/weather/<tile>/ per period end date.
                from .fetch_weather import fetch_weather
                add_layer(m, tile, "client.weather", fetch_weather(tile, force))
            elif step == "unreal":
                from .export_unreal import export_unreal
                add_layer(m, tile, "unreal", export_unreal(tile))
            else:
                raise ValueError(f"unknown step {step}")
            m["log"].append({"step": step, "at": now_iso(), "seconds": round(time.time() - t0, 1), "ok": True})
            print(f"[{tile.tile_id}] {step} done in {time.time() - t0:.1f}s", flush=True)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            m["log"].append({"step": step, "at": now_iso(), "seconds": round(time.time() - t0, 1),
                             "ok": False, "error": str(e)[:500]})
            print(f"[{tile.tile_id}] {step} FAILED: {e}", file=sys.stderr, flush=True)
        m["generated_at"] = now_iso()
        _merge_edits_from_disk(tile, m)   # never drop edits saved by the viewer while this step ran
        write_json(tile.dir / "manifest.json", m)
        update_index()
    return m


def _merge_edits_from_disk(tile: Tile, m: dict) -> None:
    """The manifest's `edits` log is append-only and may grow (via server.py) while a build
    step holds the manifest in memory. Re-read it and union by id before writing."""
    p = tile.dir / "manifest.json"
    if not p.exists():
        return
    try:
        on_disk = read_json(p).get("edits", [])
    except Exception:  # noqa: BLE001
        return
    seen = {e.get("id") for e in m.get("edits", []) if e.get("id")}
    for e in on_disk:
        if not e.get("id") or e["id"] not in seen:
            m.setdefault("edits", []).append(e)
            if e.get("id"):
                seen.add(e["id"])


def update_index() -> None:
    tiles = []
    for p in sorted(TILES_DIR.glob("*/manifest.json")):
        m = read_json(p)
        tiles.append({"tile_id": m["tile_id"], "bounds_wgs84": m["bounds_wgs84"],
                      "generated_at": m["generated_at"], "layers": sorted(m["layers"])})
    write_json(TILES_DIR / "index.json", {"spec_version": SPEC_VERSION, "tiles": tiles})


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--anchor", nargs=2, type=float, metavar=("LON", "LAT"))
    g.add_argument("--tile")
    ap.add_argument("--steps", default=",".join(ALL_STEPS))
    ap.add_argument("--dem-res", type=float, default=5.0)
    ap.add_argument("--imagery-res", type=float, default=2.5)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    kw = {"dem_res_m": a.dem_res, "imagery_res_m": a.imagery_res}
    tile = Tile.from_anchor(*a.anchor, **kw) if a.anchor else Tile.from_id(a.tile, **kw)
    print(f"tile {tile.tile_id} {tile.crs} bounds={tile.bounds} wgs84={tile.bounds_wgs84}")
    steps = [s.strip() for s in a.steps.split(",") if s.strip()]
    m = run(tile, steps, a.force)
    failed = [l["step"] for l in m["log"][-len(steps):] if not l["ok"]]
    print("layers:", ", ".join(sorted(m["layers"])))
    if failed:
        print("failed steps:", failed, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
