"""Build a tile package.

    python -m pipeline.build_tile --anchor -120.7985 38.7296
    python -m pipeline.build_tile --tile utm10n_690_4280 --steps species,derive
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback

from .config import (GENERATOR, SOURCES, SPEC_VERSION, TILES_DIR, Tile, now_iso, read_json,
                     sha256, today, write_json)
from .species_data import CALENDAR, PERCEPTION, SEASONS

ALL_STEPS = ["dem", "naip", "osm", "hydro", "veg", "species", "derive", "erase", "unreal"]


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


def add_layer(m: dict, tile: Tile, name: str, info: dict) -> None:
    p = tile.dir / info["path"]
    if p.exists():
        info["sha256"] = sha256(p)
        info["bytes"] = p.stat().st_size
    m["layers"][name] = info
    src = info.get("source")
    if src and src in SOURCES:
        m["sources"][src] = {**SOURCES[src], "retrieved": today()}


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
            elif step == "veg":
                from .fetch_vegetation import fetch_vegetation
                for k, v in fetch_vegetation(tile, force).items():
                    add_layer(m, tile, k, v)
                m["status"]["vegetation_backfilled"] = True
            elif step == "species":
                from .fetch_species import fetch_species
                for k, v in fetch_species(tile, force).items():
                    add_layer(m, tile, k, v)
                write_json(tile.path("perception.json"), {"perceives": PERCEPTION})
                write_json(tile.path("calendar.json"), {"seasons": SEASONS, "activities": CALENDAR})
                add_layer(m, tile, "perception", {"path": "perception.json", "kind": "table"})
                add_layer(m, tile, "calendar", {"path": "calendar.json", "kind": "table"})
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
                    if "hydro.flowlines" in m["layers"] and "terrain.dem" in m["layers"]:
                        from .resources import derive_resources
                        add_layer(m, tile, "resources", derive_resources(tile))
            elif step == "erase":
                from .erase_imagery import erase_imagery
                add_layer(m, tile, "client.texture_imagery", erase_imagery(tile))
                m["status"]["imagery_erased"] = True
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
        write_json(tile.dir / "manifest.json", m)
        update_index()
    return m


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
