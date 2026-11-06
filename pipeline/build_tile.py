"""Build a tile package: one command for the whole graph of steps (pipeline/steps.py, docs/pipeline.md).

    python -m pipeline.build_tile --tile utm10n_735_4235 --all            # every step in order; current ones skipped
    python -m pipeline.build_tile --tile utm10n_735_4235 --stage base     # one stage: base | flora | fauna | games | all
    python -m pipeline.build_tile --tile utm10n_735_4235 --cost           # what the tile cost: time, downloads, disk, client
    python -m pipeline.build_tile --anchor -120.31 38.27 --all            # the tile holding a point
    python -m pipeline.build_tile --tile utm10n_735_4235 --plan           # what --all would run, and why
    python -m pipeline.build_tile --tile utm10n_735_4235 --all --force derive,registry   # these whatever their state
    python -m pipeline.build_tile --tile utm11n_270_4180 --status         # ran / missing / stale per step
    python -m pipeline.build_tile --tile utm11n_270_4180 --adopt          # take a tile built before the graph as its baseline
    python -m pipeline.build_tile --tile utm11n_270_4180 --all --out /tmp/rebuild   # build into another tiles folder

    python -m pipeline.build_tile --tile utm10n_690_4280 --steps species,derive    # named steps, run whatever their state
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps lidar,ground      # 1 m DEM, point cloud, crowns (pipeline/lidar.py)
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps seasons           # Sentinel-2 monthly colour (pipeline/fetch_sentinel.py)
    python -m pipeline.build_tile --tile utm10n_680_4280 --steps water             # banks, beds and riparian zones (pipeline/water.py)

--steps keeps its old meaning (run these, in graph order, as if forced; their fetch modules reuse their caches unless
--force is also given) for the dev server and old notes; --all is the repeatable build. A failed step stops the build
and the command exits 1.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from .config import Tile
# Re-exported: server.py, fetch_territories and older scripts import these from here.
from .manifest import (add_layer, add_species_prior, load_manifest, merge_edits_from_disk as _merge_edits_from_disk,  # noqa: F401
                       record_source, update_index)
from .steps import ALIASES, EXTRA, ORDER, STAGES, STEPS, adopt, build, status

ALL_STEPS = list(ORDER)


def run(tile: Tile, steps: list[str], force=False) -> dict:
    """Run the named steps whatever their state (the server's build API, one step per call). `force` also makes their
    fetch modules re-ask their sources."""
    return build(tile, steps=steps, force=set(steps), keep_going=True, refetch=force)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Build a Wild Earth tile package (docs/pipeline.md).")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--anchor", nargs=2, type=float, metavar=("LON", "LAT"))
    g.add_argument("--tile")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="the whole graph; current steps are skipped")
    mode.add_argument("--stage", help="one or more stages, comma-separated: base, flora, fauna, games, or all")
    mode.add_argument("--cost", action="store_true", help="print the summary of tiles/<id>/cost.json")
    mode.add_argument("--steps", help="comma-separated steps to run whatever their state")
    mode.add_argument("--plan", action="store_true", help="print what --all would run and why")
    mode.add_argument("--status", action="store_true", help="per step: ran, missing layers, stale hashes, code changed since")
    mode.add_argument("--adopt", action="store_true", help="record a tile built before the step graph as its baseline")
    ap.add_argument("--force", nargs="?", const="*", default="",
                    help="with --all: comma-separated steps to run whatever their state (and re-fetch); with --steps: re-fetch")
    ap.add_argument("--keep-going", action="store_true", help="run the steps that do not depend on a failed one")
    ap.add_argument("--out", help="the tiles folder to build into (default tiles/; WILD_EARTH_TILES)")
    ap.add_argument("--dem-res", type=float, default=5.0)
    ap.add_argument("--imagery-res", type=float, default=2.5)
    a = ap.parse_args(argv)
    if a.out and os.path.realpath(a.out) != os.path.realpath(os.environ.get("WILD_EARTH_TILES", "")):
        os.makedirs(a.out, exist_ok=True)
        env = {**os.environ, "WILD_EARTH_TILES": os.path.realpath(a.out)}
        args = [x for i, x in enumerate(sys.argv) if x != "--out" and (i == 0 or sys.argv[i - 1] != "--out")]
        os.execve(sys.executable, [sys.executable, "-m", "pipeline.build_tile", *args[1:]], env)
    kw = {"dem_res_m": a.dem_res, "imagery_res_m": a.imagery_res}
    tile = Tile.from_anchor(*a.anchor, **kw) if a.anchor else Tile.from_id(a.tile, **kw)
    print(f"tile {tile.tile_id} {tile.crs} bounds={tile.bounds} wgs84={tuple(round(v, 5) for v in tile.bounds_wgs84)} dir={tile.dir}")
    if a.cost:
        from .cost import summary
        print(summary(tile))
        return
    if a.status:
        rows = status(tile)
        for r in rows:
            flags = []
            if r.get("problem"):
                flags.append(r["problem"].split(":", 1)[0].upper() + ":" + r["problem"].split(":", 1)[1][:160])
            if r["not_applicable"]:
                flags.append("n/a: " + r["not_applicable"][:70])
            if r["missing_layers"]:
                flags.append("missing " + ",".join(r["missing_layers"]))
            if r["hash_mismatch"]:
                flags.append("stale hash " + ",".join(r["hash_mismatch"]))
            if r["code_since"]:
                flags.append(f"code changed since ({len(r['code_since'])}): {r['code_since'][0]}")
            print(f"  {r['step']:<13} {(r['ran'] or 'never')[:16]:<16} {'; '.join(flags)}")
        print(json.dumps(rows), file=open(os.devnull, "w"))
        bad = [r["step"] for r in rows if (r.get("problem") or "").startswith(("refused", "failed"))]
        if bad:
            print(f"refused or failed: {', '.join(bad)}", file=sys.stderr)
            sys.exit(1)
        return
    if a.adopt:
        m = adopt(tile)
        for n in ORDER:
            r = m["steps"][n]
            print(f"  {n:<13} {r['status']:<15} {'; '.join(r.get('stale') or []) or r.get('reason') or ''}"[:200])
        return
    if a.plan:
        build(tile, plan_only=True, force=set(ORDER if a.force == "*" else [s for s in a.force.split(",") if s]))
        return
    if a.stage:
        stages = [x.strip() for x in a.stage.split(",") if x.strip()]
        stages = None if "all" in stages else stages
        force = set(ORDER) if a.force == "*" else {x.strip() for x in a.force.split(",") if x.strip()}
        m = build(tile, stages=stages, force=force, keep_going=a.keep_going, refetch=bool(force))
        failed = m.pop("_failed", [])
        refused = m.pop("_refused", [])
        print("layers:", len(m["layers"]))
        if refused:
            print("refused steps:", refused, file=sys.stderr)
        if failed:
            print("failed or blocked steps:", failed, file=sys.stderr)
        if failed or refused:
            sys.exit(1)
        return
    if a.steps:
        steps = [s.strip() for s in a.steps.split(",") if s.strip()]
        m = build(tile, steps=steps, force=set(steps), keep_going=a.keep_going, refetch=bool(a.force))
    else:
        if not a.all:
            ap.error("give --all, --stage, --steps, --plan, --status, --adopt or --cost")
        force = set(ORDER) if a.force == "*" else {s.strip() for s in a.force.split(",") if s.strip()}
        force = {ALIASES.get(x, x) for x in force}
        bad = force - set(ORDER) - set(EXTRA)
        if bad:
            ap.error(f"unknown step(s) to force: {sorted(bad)}")
        m = build(tile, force=force, keep_going=a.keep_going, refetch=bool(force))
    failed = m.pop("_failed", [])
    refused = m.pop("_refused", [])
    print("layers:", len(m["layers"]))
    if refused:   # the build went on without them, but the tile is not right (runlog.Refused)
        print("refused steps:", refused, file=sys.stderr)
    if failed:
        print("failed steps:", failed, file=sys.stderr)
    if failed or refused:
        sys.exit(1)


if __name__ == "__main__":
    main()
