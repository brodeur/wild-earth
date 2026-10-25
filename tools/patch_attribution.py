"""Add licence and attribution fields to the `sources` of existing tile manifests, in place,
without re-fetching anything.

    .venv/bin/python tools/patch_attribution.py [--dry-run] [--refresh] [tile_id ...]

For every entry in a manifest's `sources`, the fields `license_url`, `attribution`,
`attribution_url` and `attribution_required` are taken from the pipeline's source registry
(pipeline.config.all_sources) and inserted after `license`. Nothing else changes: every other
field, the `edits` log and the `log` stay byte-for-byte. Fields already present are left alone
unless --refresh is given, which rewrites them from the registry (never `name`, `url`,
`license` or `retrieved`). The write is an atomic replace in the manifest's own format, the
same as server.py, so a running server's edits are not interleaved with a half-written file.
A source missing from the registry is an error and that manifest is not written.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
import uuid
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

from pipeline.config import TILES_DIR, all_sources  # noqa: E402

ADDED = ("license_url", "attribution", "attribution_url", "attribution_required")


def dump(m: dict) -> str:
    return json.dumps(m, indent=1) + "\n"


def patch_sources(sources: dict, registry: dict, refresh: bool) -> tuple[dict, list[str]]:
    out, notes = {}, []
    for key, s in sources.items():
        if key not in registry:
            raise KeyError(f"source {key} is not in the pipeline registry")
        reg = registry[key]
        add = {f: reg[f] for f in ADDED if f not in s}
        changed = {f: reg[f] for f in ADDED if f in s and refresh and s[f] != reg[f]}
        entry = {}
        for k, v in s.items():
            entry[k] = changed.get(k, v)
            if k == "license":
                entry.update(add)
        if "license" not in s:              # no licence field to sit beside: append
            entry.update(add)
        out[key] = entry
        if add:
            notes.append(f"{key}: +{', '.join(add)}")
        if changed:
            notes.append(f"{key}: refreshed {', '.join(changed)}")
    return out, notes


def strip_added(m: dict) -> dict:
    c = json.loads(json.dumps(m))
    for s in c.get("sources", {}).values():
        for f in ADDED:
            s.pop(f, None)
    return c


def patch(tile_id: str, registry: dict, dry_run=False, refresh=False) -> bool:
    p = TILES_DIR / tile_id / "manifest.json"
    raw = p.read_text()
    m = json.loads(raw)
    if dump(m) != raw:
        print(f"{tile_id}: manifest is not in the pipeline's JSON format; not patched (would reformat it)")
        return False
    try:
        new_sources, notes = patch_sources(m.get("sources", {}), registry, refresh)
    except KeyError as e:
        print(f"{tile_id}: {e.args[0]}; not patched")
        return False
    m2 = {k: (new_sources if k == "sources" else v) for k, v in m.items()}
    text = dump(m2)
    if text == raw:
        print(f"{tile_id}: already complete")
        return True
    diff = list(difflib.unified_diff(raw.splitlines(), text.splitlines(), lineterm="", n=0))
    removed = [l for l in diff if l.startswith("-") and not l.startswith("---")]
    if removed and not refresh:
        print(f"{tile_id}: patch would remove lines, refusing:\n  " + "\n  ".join(removed))
        return False
    if not refresh and strip_added(m2) != strip_added(m):
        print(f"{tile_id}: patch would change fields other than the attribution fields; refusing")
        return False
    print(f"{tile_id}: {'would add' if dry_run else 'added'} {sum(1 for l in diff if l.startswith('+') and not l.startswith('+++'))} lines")
    for n in notes:
        print(f"   {n}")
    if dry_run:
        return True
    tmp = p.with_name(f".manifest.{uuid.uuid4().hex[:8]}.tmp")
    if p.read_text() != raw:                # changed under us (server edit): redo from the new text
        print(f"{tile_id}: manifest changed while patching; retrying")
        return patch(tile_id, registry, dry_run, refresh)
    tmp.write_text(text)
    os.replace(tmp, p)
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="rewrite attribution fields that differ from the registry")
    a = ap.parse_args(argv)
    ids = a.tiles or [d.name for d in sorted(TILES_DIR.glob("utm*")) if (d / "manifest.json").exists()]
    registry = all_sources()
    ok = [patch(t, registry, a.dry_run, a.refresh) for t in ids]
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(main())
