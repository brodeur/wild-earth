"""A tile's manifest.json: loading it, recording a layer and its sources, the tile index.

Moved out of build_tile.py (2026-11-04) so the step runner (steps.py) and the command line share them; build_tile
re-exports every name, so `from pipeline.build_tile import add_layer, record_source, update_index` still works.
"""
from __future__ import annotations

from .config import (ATTRIBUTION_FIELDS, GENERATOR, SPEC_VERSION, TILES_DIR, Tile, all_sources, now_iso, read_json,
                     sha256, today, write_json)
from . import runlog


def load_manifest(tile: Tile) -> dict:
    p = tile.dir / "manifest.json"
    if p.exists():
        m = read_json(p)
        m.setdefault("steps", {})
        return m
    w, s, e, n = tile.bounds_wgs84
    return {
        "spec_version": SPEC_VERSION, "tile_id": tile.tile_id, "crs": tile.crs,
        "bounds": list(tile.bounds), "bounds_wgs84": [w, s, e, n], "size_m": 10000,
        "generated_at": now_iso(), "generator": GENERATOR,
        "status": {"human_landforms_removed": False, "hydrology_rewilded": False, "projection_years": 0},
        "layers": {}, "sources": {}, "edits": [], "log": [], "steps": {},
    }


def add_layer(m: dict, tile: Tile, name: str, info: dict, fetched: bool = True) -> None:
    """`fetched=False` for a layer derived from data already in the package: its sources keep the
    date they were retrieved on."""
    p = tile.dir / info["path"]
    if p.exists():
        info["sha256"] = sha256(p)
        info["bytes"] = p.stat().st_size
    m["layers"][name] = info
    runlog.note_layer(name)
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


def merge_edits_from_disk(tile: Tile, m: dict) -> None:
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


def save(tile: Tile, m: dict) -> None:
    m["generated_at"] = now_iso()
    merge_edits_from_disk(tile, m)   # never drop edits saved by the viewer while a step ran
    write_json(tile.dir / "manifest.json", m)
    update_index()


def update_index() -> None:
    tiles = []
    for p in sorted(TILES_DIR.glob("*/manifest.json")):
        m = read_json(p)
        tiles.append({"tile_id": m["tile_id"], "bounds_wgs84": m["bounds_wgs84"],
                      "generated_at": m["generated_at"], "layers": sorted(m["layers"])})
    write_json(TILES_DIR / "index.json", {"spec_version": SPEC_VERSION, "tiles": tiles})
