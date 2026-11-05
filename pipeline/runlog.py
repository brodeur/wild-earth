"""What a running step took on the way: the fallbacks, the sources it fetched, and its notes.

The step runner (pipeline/steps.py) opens a record before each step and copies it into the manifest's `steps`
entry afterwards, so a fallback taken deep in a fetch module (the Planetary Computer DEM after a USGS gateway timeout,
the DEM-only lidar products, a LANDFIRE export retried after a JSON error) is written down next to the step that
took it instead of only scrolling past in the console:

    from . import runlog
    runlog.fallback("usgs_3dep timed out; Planetary Computer 3dep-seamless 10 m used", source="pc_3dep_seamless")

Outside a run (a module called on its own) the calls only print.
"""
from __future__ import annotations

# One record per process (a run holds one step at a time); module-level, not thread-local, so a fallback taken in a
# worker thread (the chipped downloads, the lidar node readers) lands in the step's record too.
class _State:
    rec = None


_local = _State()


def begin(step: str) -> None:
    _local.rec = {"step": step, "fallbacks": [], "notes": [], "fetched": [], "layers": []}


def end() -> dict:
    rec = getattr(_local, "rec", None) or {"fallbacks": [], "notes": [], "fetched": []}
    _local.rec = None
    return rec


def _rec():
    return getattr(_local, "rec", None)


def fallback(text: str, **kw) -> None:
    """A step took its second choice: a fallback source, a reduced product, a retry that succeeded."""
    print(f"  fallback: {text}", flush=True)
    r = _rec()
    if r is not None:
        r["fallbacks"].append({"what": text, **kw})


def note(text: str, **kw) -> None:
    r = _rec()
    if r is not None:
        r["notes"].append({"what": text, **kw})


def fetched(source: str, cache: str | None = None, cached: bool = False) -> None:
    """A network read: from its cache (cached=True) or from the source."""
    r = _rec()
    if r is not None:
        r["fetched"].append({"source": source, "cache": cache, "cached": cached})


def note_layer(name: str) -> None:
    """A manifest layer the step recorded (manifest.add_layer): the step's outputs, for its fingerprint."""
    r = _rec()
    if r is not None:
        r.setdefault("layers", []).append(name)
