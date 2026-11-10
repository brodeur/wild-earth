"""The held-out judge: checks of a built tile against sources the pipeline never reads (docs/held-out-judge.md;
docs/pipeline-review-2026-11-10.md, recommendation 3).

    arch -arm64 .venv/bin/python tools/probes/held_out.py <tile> [<tile> ...] [--checks species,composition,eye]
                                                   [--baseline] [--offline] [--refresh] [--colour <satellite_stats.json>]
    arch -arm64 .venv/bin/python tools/probes/held_out.py --table [<tile> ...]      # the scores, baseline beside now

Checks (each a key of `checks` in tiles/<tile>/judge/held_out.json, with source, licence, fetched, scores, errors):
  species_lists      the tile's plants and animals against the park's NPSpecies checklist (tools/probes/checklist.py)
  composition        drawn genus shares by layer against field plots or mapped dominants (tools/probes/composition.py)
  eye_level          eye-height renders against openly licensed geotagged photos (tools/probes/eye_level.py; needs the
                     photos from eye_photos.py and the captures from eye_capture.mjs: without them it reports what is
                     missing and the other checks still run)
  structure          canopy height and cover against GEDI: deferred, with what it needs
  colour_from_above  the old judge (tools/probes/run.sh), kept and labelled: NOT held out, since it compares the render
                     with the imagery the ground is made from. Copied in from a satellite_stats.json when --colour names
                     one, else carried over from the last file.
Checks 1 and 2 need no browser. --baseline also writes judge/held_out_baseline.json (kept, so a later run shows before
and after); an existing baseline is never overwritten without --rebaseline. Nothing here is tuned to make a tile pass:
the rules are in the modules' docstrings and were fixed before the first tile was scored.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import judge_common as jc  # noqa: E402

FORMAT = 1
PROBE_OF = {"utm12n_396_3988": "gcanyon", "utm12n_557_4964": "lamar", "utm12n_514_4838": "teton",
            "utm36s_698_9724": "serengeti", "utm33n_412_7531": "lofoten", "utm50n_582_543": "danum",
            "utm17n_210_932": "corcovado", "utm19s_233_8679": "manu"}
STRUCTURE = {
    "held_out": True, "status": "deferred",
    "why": "GEDI needs a NASA Earthdata login, which only the owner can create",
    "needs": [
        "a free Earthdata account (urs.earthdata.nasa.gov) made by Aaron, and its token in the git-ignored .env as "
        "EARTHDATA_TOKEN (never printed or logged)",
        "GEDI L2A (footprint canopy height, rh98) and L2B (canopy cover, plant area index, vertical profile) version 2 "
        "granules over the tile, found through NASA's CMR search by bounding box and subset to the tile through "
        "Harmony or read from the cloud-optimised HDF5 with h5py (h5py is not in the venv yet); NASA data are open "
        "(no licence restriction), attribution to the GEDI mission (Dubayah et al.)",
        "per 25 m footprint with quality_flag 1 and sensitivity >= 0.95, leaf-on shots only: the tile's own canopy "
        "height (the height the client draws: client/canopy.png and the canopy_top step) sampled at the footprint, "
        "then bias, RMSE and rank correlation of height, and the same for cover",
        "held out only where the tile's canopy does not come from GEDI: the ETH and Meta canopy-height maps used on "
        "the six tiles without lidar were trained on GEDI, so on those tiles GEDI is not independent; on the eight "
        "lidar tiles it is. GEDI covers 51.6 N to 51.6 S: not Lofoten",
        "the alternative with no account: hold out part of the 3DEP lidar point cloud on US tiles (build from the "
        "DEM-only path, judge against the point cloud's canopy height model)",
    ],
}


def colour_check(tile: str, stats_path: str | None, previous: dict | None) -> dict:
    out = {"held_out": False, "status": "not run",
           "what": "colour from straight above (the d_topdown probe pose) against the Sentinel-2 composite of the "
                   "capture's month, through the viewer's light (tools/probes/run.sh, sheet.py overlap_fair)",
           "why_not_held_out": "the ground texture is made from the same family of imagery, so this score is "
                               "satisfied by construction where the ground shows; it cannot see a wrong species, a "
                               "missing understory or an empty river",
           "source": "Copernicus Sentinel-2 L2A (the seasons step's monthly composite)", "licence": "Copernicus open"}
    probe = PROBE_OF.get(tile)
    if stats_path and probe:
        st = json.loads(Path(stats_path).read_text()).get(probe)
        if st:
            out.update({"status": "scored", "probe": probe, "fetched": dt.date.fromtimestamp(
                Path(stats_path).stat().st_mtime).isoformat(),
                "scores": {"overlap": st.get("overlap_fair", st.get("overlap")), "overlap_plain": st.get("overlap"),
                           "L_render": st.get("L_render"), "L_reference": st.get("L_fair", st.get("L_sat"))}})
            return out
    if previous and previous.get("status") == "scored":
        return previous
    if not probe:
        out["why"] = "the tile has no probe in tools/probes/probes.json"
    return out


def run_tile(tile: str, checks: list, args) -> dict:
    jdir = jc.tile_dir(tile) / "judge"
    jdir.mkdir(exist_ok=True)
    path = jdir / "held_out.json"
    prev = json.loads(path.read_text()) if path.exists() else {}
    res = {"format": FORMAT, "tile": tile, "name": (jc.parks().get(tile) or {}).get("name"),
           "at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "doc": "docs/held-out-judge.md", "checks": dict(prev.get("checks") or {})}
    if "species" in checks:
        import checklist
        res["checks"]["species_lists"] = checklist.run(tile, args.refresh, args.offline)
    if "composition" in checks:
        import composition
        res["checks"]["composition"] = composition.run(tile, args.refresh)
    if "eye" in checks:
        import eye_level
        res["checks"]["eye_level"] = eye_level.run(tile)
    res["checks"]["structure"] = STRUCTURE
    res["checks"]["colour_from_above"] = colour_check(tile, args.colour, (prev.get("checks") or {}).get("colour_from_above"))
    res["summary"] = summary(res)
    path.write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n")
    base = jdir / "held_out_baseline.json"
    if args.rebaseline or (args.baseline and not base.exists()):
        base.write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n")
    return res


def summary(res: dict) -> dict:
    """The headline numbers, one flat table per tile (what tools/probes/held_out.py --table prints)."""
    c = res["checks"]

    def sc(k):
        return (c.get(k) or {}).get("scores") or {}
    sp, co, ey = sc("species_lists"), sc("composition"), sc("eye_level")
    return {
        "animal_precision": sp.get("animal_precision"), "animal_recall_common": sp.get("animal_recall_common"),
        "plant_precision": sp.get("plant_precision"), "groups_absent": sp.get("groups_absent"),
        "introduced_drawn": sp.get("introduced_drawn"), "restorable_absent": sp.get("restorable_absent"),
        "restored_drawn": sp.get("restored_drawn"),
        "plant_precision_by_share": sp.get("plant_precision_by_share"),
        "composition_bray_curtis": co.get("bray_curtis"), "composition_foreign_share": co.get("foreign_share"),
        "eye_level_distance": ey.get("distance_mean"), "eye_level_pairs": ey.get("pairs"),
        "colour_from_above_overlap": sc("colour_from_above").get("overlap"),
        "named_errors": sum(len((c.get(k) or {}).get("errors") or []) for k in ("species_lists", "composition")),
    }


def table(tiles: list) -> str:
    rows = []
    head = ["tile", "when", "animal precision", "animal recall (common)", "introduced drawn", "natives to restore, lacking",
            "plant precision", "plants by share c/s/g",
            "Bray-Curtis c/s/g", "foreign share c/s/g", "eye-level distance", "colour from above (not held out)"]

    def f(v):
        return "-" if v is None else f"{v:.2f}" if isinstance(v, float) else str(v)

    def tri(d):
        return "/".join(f((d or {}).get(k)) for k in ("canopy", "shrub", "ground"))
    for t in tiles:
        for label, fn in (("baseline", "held_out_baseline.json"), ("now", "held_out.json")):
            p = jc.tile_dir(t) / "judge" / fn
            if not p.exists():
                continue
            r = json.loads(p.read_text())
            s = r.get("summary") or summary(r)
            rows.append([f"{r.get('name') or t}", f"{label} {r['at'][:10]}", f(s["animal_precision"]),
                         f(s["animal_recall_common"]), f(s.get("introduced_drawn")),
                         f(sum((s.get("restorable_absent") or {}).values()) if s.get("restorable_absent") is not None else None),
                         f(s["plant_precision"]), tri(s["plant_precision_by_share"]),
                         tri(s["composition_bray_curtis"]), tri(s["composition_foreign_share"]),
                         f(s["eye_level_distance"]), f(s["colour_from_above_overlap"])])
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--checks", default="species,composition,eye")
    ap.add_argument("--baseline", action="store_true", help="also keep this run as judge/held_out_baseline.json if none exists")
    ap.add_argument("--rebaseline", action="store_true", help="overwrite the kept baseline with this run")
    ap.add_argument("--offline", action="store_true", help="no GBIF synonym lookups or boundary query (cached lists only)")
    ap.add_argument("--refresh", action="store_true", help="fetch the references again")
    ap.add_argument("--colour", help="a satellite_stats.json written by tools/probes/run.sh")
    ap.add_argument("--table", action="store_true")
    a = ap.parse_args(argv)
    tiles = a.tiles or [t for t in jc.parks() if not t.startswith("_")]
    if a.table:
        print(table(tiles))
        return
    for t in tiles:
        r = run_tile(t, [c.strip() for c in a.checks.split(",")], a)
        print(t, json.dumps(r["summary"]))


if __name__ == "__main__":
    main()
