"""Shared helpers of the held-out judge (tools/probes/held_out.py; docs/held-out-judge.md).

Paths, the tile's facts, a polite cached fetch, and the scientific-name handling every check uses. Nothing here reads
the network at import time. Everything fetched for judging stays on the pipeline side, in git-ignored caches:
per park under pipeline/_cache/judge/, per tile under tiles/<tile>/_cache/judge/; each download in its own directory,
read as data (json, csv, PIL), never executed.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
USER_AGENT = "wild-earth-judge/0.1 (open-source tile builder; held-out checks)"
POLITE_S = 1.0
PARK_CACHE = ROOT / "pipeline" / "_cache" / "judge"
_last = [0.0]


def today() -> str:
    return dt.date.today().isoformat()


def tile_dir(tile: str) -> Path:
    return ROOT / "tiles" / tile


def tile_cache(tile: str) -> Path:
    return tile_dir(tile) / "_cache" / "judge"


def manifest(tile: str) -> dict:
    return json.loads((tile_dir(tile) / "manifest.json").read_text())


def parks() -> dict:
    return json.loads((Path(__file__).parent / "parks.json").read_text())


def fetch(url: str, dest: Path, params: dict | None = None, *, refresh=False, timeout=300) -> Path:
    """GET url into dest (its directory made new for it), once: a cached file is never asked again. One request a
    second at most. curl does the transfer (the venv's Python is built on LibreSSL, which some hosts refuse)."""
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    wait = POLITE_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    argv = ["curl", "-sS", "-L", "--fail", "-m", str(timeout), "-A", USER_AGENT, "-o", str(dest) + ".part", "-G", url]
    for k, v in (params or {}).items():
        argv += ["--data-urlencode", f"{k}={v}"]
    r = subprocess.run(argv, capture_output=True, text=True)
    _last[0] = time.time()
    if r.returncode != 0:
        Path(str(dest) + ".part").unlink(missing_ok=True)
        raise RuntimeError(f"fetch failed ({r.returncode}) {url}: {r.stderr.strip()[:200]}")
    Path(str(dest) + ".part").replace(dest)
    return dest


# --- scientific names -------------------------------------------------------------------------------------------------

_RANKS = {"var.", "subsp.", "ssp.", "f.", "x", "×", "cf.", "aff.", "sp.", "spp."}


def binomial(name: str | None) -> str | None:
    """'Juniperus osteosperma (Torr.) Little' -> 'juniperus osteosperma'; a bare genus or nothing -> None."""
    if not name:
        return None
    w = [x for x in re.sub(r"[^A-Za-z×.\- ]", " ", name).split() if x.lower() not in _RANKS]
    if len(w) < 2 or not w[1][0].islower():
        return None
    return f"{w[0].lower()} {w[1].lower()}"


def genus(name: str | None) -> str | None:
    """The genus of a scientific name or of a library id ('juniperus_grandis'), lower case."""
    if not name:
        return None
    w = re.split(r"[ _]", name.strip())
    g = re.sub(r"[^A-Za-z]", "", w[0]).lower()
    return g or None


def id_to_name(code: str) -> str:
    """A library id ('sambucus_nigra_caerulea') as a scientific name ('Sambucus nigra caerulea')."""
    w = code.split("_")
    return " ".join([w[0].capitalize()] + w[1:])


def epithet_stem(binom: str) -> str:
    """The species epithet without its gendered ending, so a genus transfer that changed it still matches
    (villosus / villosa, americanus / americana)."""
    e = binom.split()[1].replace("ii", "i")   # and a spelling variant: vacciniifolia / vaccinifolia
    return re.sub(r"(us|a|um|is|e|i|ae)$", "", e) or e
