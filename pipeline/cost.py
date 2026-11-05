"""What a tile costs to build and to enter: tiles/<id>/cost.json (docs/pipeline.md, "Reading cost.json").

Written by the step runner after every step it runs (pipeline/steps.py run_step) and at the end of a build:

  steps.<name>   the step's last run: stage, started_at / ended_at (UTC ISO), wall_s, cpu_self_s and cpu_children_s
                 (resource.getrusage, user + system, over the step), downloads {source: {bytes, requests}} (every HTTP
                 read through `requests` in the step and its worker processes; GDAL's own COG reads are not counted),
                 cache {source: {hits, misses}} (reads answered from a cache against those that went to the source),
                 disk_bytes (the step's output files), meshy {spent, queued, queued_credits_est}, status
  stages.<name>  the stage's started_at / ended_at of its last run (the first step it ran to the last), and its sums
  runs           every build invocation: its stages with their start and end, the steps run and skipped
  client         bytes a player downloads to enter the tile (every file under client/ and the JSON tables the viewer
                 fetches: manifest, perception, calendar, locomotion, games, species/species.json), reported apart
  totals         the sums over the steps' last runs

A rebuild from the caches shows near-zero downloads and its cache hits. Claude's own work is not here: the stage
timestamps are what tools/token_meter.py (on main) joins to the session transcripts to price it.

    python -m pipeline.build_tile --tile <id> --cost      # the summary
"""
from __future__ import annotations

import json
import resource

from .config import Tile, now_iso, read_json, write_json

CLIENT_ROOT = ("manifest.json", "perception.json", "calendar.json", "locomotion.json", "games.json", "species/species.json")


def rusage() -> tuple[float, float]:
    s, c = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    return s.ru_utime + s.ru_stime, c.ru_utime + c.ru_stime


def load(tile: Tile) -> dict:
    p = tile.dir / "cost.json"
    if p.exists():
        try:
            return read_json(p)
        except Exception:  # noqa: BLE001
            pass
    return {"tile": tile.tile_id, "steps": {}, "stages": {}, "runs": []}


def client_bytes(tile: Tile) -> dict:
    files = {}
    d = tile.dir / "client"
    for p in sorted(d.rglob("*")) if d.exists() else []:
        if p.is_file():
            files[str(p.relative_to(tile.dir))] = p.stat().st_size
    for rel in CLIENT_ROOT:
        p = tile.dir / rel
        if p.exists():
            files[rel] = p.stat().st_size
    return {"bytes": sum(files.values()), "files": len(files),
            "largest": dict(sorted(files.items(), key=lambda kv: -kv[1])[:12]),
            "note": "every file under client/ and the tables the viewer fetches; an upper bound (the present-day texture "
                    "is fetched only on request)"}


def record_step(tile: Tile, name: str, stage: str, rec: dict) -> None:
    c = load(tile)
    c["steps"][name] = {"stage": stage, **rec}
    _sum(c)
    write_json(tile.dir / "cost.json", c)


def record_run(tile: Tile, run: dict) -> None:
    c = load(tile)
    c.setdefault("runs", []).append(run)
    c["runs"] = c["runs"][-50:]
    for st in run.get("stages", []):
        if st.get("steps_run"):
            c.setdefault("stages", {}).setdefault(st["stage"], {}).update(started_at=st["started_at"], ended_at=st["ended_at"])
    c["client"] = client_bytes(tile)
    _sum(c)
    write_json(tile.dir / "cost.json", c)


def _sum(c: dict) -> None:
    def add(acc, r):
        acc["wall_s"] = round(acc.get("wall_s", 0) + (r.get("wall_s") or 0), 1)
        acc["cpu_s"] = round(acc.get("cpu_s", 0) + (r.get("cpu_self_s") or 0) + (r.get("cpu_children_s") or 0), 1)
        acc["download_bytes"] = acc.get("download_bytes", 0) + sum(v.get("bytes", 0) for v in (r.get("downloads") or {}).values())
        acc["cache_hits"] = acc.get("cache_hits", 0) + sum(v.get("hits", 0) for v in (r.get("cache") or {}).values())
        acc["cache_misses"] = acc.get("cache_misses", 0) + sum(v.get("misses", 0) for v in (r.get("cache") or {}).values())
        acc["disk_bytes"] = acc.get("disk_bytes", 0) + (r.get("disk_bytes") or 0)
        m = r.get("meshy") or {}
        acc["meshy_spent"] = acc.get("meshy_spent", 0) + (m.get("spent") or 0)
        acc["meshy_queued_credits_est"] = acc.get("meshy_queued_credits_est", 0) + (m.get("queued_credits_est") or 0)
    tot = {}
    for name, r in c["steps"].items():
        add(tot, r)
        st = c.setdefault("stages", {}).setdefault(r.get("stage", "?"), {})
        st.setdefault("_acc", {})
    for st in c["stages"].values():
        st.pop("_acc", None)
        for k in ("wall_s", "cpu_s", "download_bytes", "cache_hits", "cache_misses", "disk_bytes", "meshy_spent",
                  "meshy_queued_credits_est"):
            st.pop(k, None)
    for name, r in c["steps"].items():
        add(c["stages"].setdefault(r.get("stage", "?"), {}), r)
    c["totals"] = tot
    c["updated_at"] = now_iso()


def _mb(n) -> str:
    return f"{(n or 0) / 1e6:,.1f} MB"


def summary(tile: Tile) -> str:
    c = load(tile)
    if not c["steps"]:
        return f"{tile.tile_id}: no cost.json yet (built before the cost meter)"
    lines = [f"{tile.tile_id}: cost of the last run of each step"]
    lines.append(f"  {'step':<13}{'stage':<7}{'wall':>9}{'cpu':>9}{'down':>12}{'hit/miss':>10}{'disk':>11}")
    for name, r in c["steps"].items():
        down = sum(v.get("bytes", 0) for v in (r.get("downloads") or {}).values())
        hits = sum(v.get("hits", 0) for v in (r.get("cache") or {}).values())
        miss = sum(v.get("misses", 0) for v in (r.get("cache") or {}).values())
        cpu = (r.get("cpu_self_s") or 0) + (r.get("cpu_children_s") or 0)
        lines.append(f"  {name:<13}{r.get('stage', ''):<7}{r.get('wall_s', 0):>8.0f}s{cpu:>8.0f}s{_mb(down):>12}"
                     f"{f'{hits}/{miss}':>10}{_mb(r.get('disk_bytes')):>11}")
    for st, s in c.get("stages", {}).items():
        lines.append(f"  stage {st:<6} {s.get('started_at', '?')} -> {s.get('ended_at', '?')}: wall {s.get('wall_s', 0):.0f} s, "
                     f"cpu {s.get('cpu_s', 0):.0f} s, down {_mb(s.get('download_bytes'))}, disk {_mb(s.get('disk_bytes'))}")
    t = c.get("totals", {})
    lines.append(f"  total: wall {t.get('wall_s', 0):.0f} s, cpu {t.get('cpu_s', 0):.0f} s, downloads {_mb(t.get('download_bytes'))} "
                 f"({t.get('cache_hits', 0)} cache hits, {t.get('cache_misses', 0)} misses), disk {_mb(t.get('disk_bytes'))}, "
                 f"Meshy spent {t.get('meshy_spent', 0)}, queued ~{t.get('meshy_queued_credits_est', 0)} credits")
    cl = c.get("client") or {}
    lines.append(f"  client: {_mb(cl.get('bytes'))} in {cl.get('files', 0)} files a player downloads to enter the tile")
    return "\n".join(lines)
