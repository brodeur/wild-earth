"""Licence audit per tile: every source carries the credit a client must show, and species
occurrence records are counted by licence so the data-licensing question has numbers (how many
records are CC BY-NC, unusable in a commercial product, versus CC0 / CC BY).

    python -m pipeline.audit_licenses [tile_id ...]

Exits 1 when any tile has a source without its licence and attribution fields, a source whose
licence requires attribution but has no credit line, or a layer naming a source the manifest
does not list (tile-spec.md, Sources). Warns when a manifest's credit differs from the pipeline's
registry (fix with `python -m tools.patch_attribution`).
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict

from .config import ATTRIBUTION_FIELDS, TILES_DIR, read_json

# Licences whose terms make the credit a condition of use.
ATTRIBUTION_LICENCES = ("odbl", "cc by", "cc-by")


def licence_needs_attribution(licence: str) -> bool:
    lic = (licence or "").lower()
    return any(k in lic for k in ATTRIBUTION_LICENCES)


def audit_attribution(manifest: dict, registry: dict | None = None) -> tuple[list[str], list[str]]:
    """(problems, warnings) for a manifest's `sources` and the sources its layers name."""
    problems, warnings = [], []
    sources = manifest.get("sources", {})
    for key, s in sources.items():
        missing = [f for f in ATTRIBUTION_FIELDS if f not in s]
        if missing:
            problems.append(f"source {key}: missing {', '.join(missing)}")
            continue
        if not isinstance(s["attribution_required"], bool):
            problems.append(f"source {key}: attribution_required must be true or false")
        if licence_needs_attribution(s["license"]) and s["attribution_required"] is not True:
            problems.append(f"source {key}: licence '{s['license']}' requires attribution but attribution_required is not true")
        if s["attribution_required"] and not (s["attribution"] or "").strip():
            problems.append(f"source {key}: attribution required but the attribution line is empty")
        if s["attribution_required"] and not (s["attribution_url"] or "").strip():
            problems.append(f"source {key}: attribution required but attribution_url is empty")
        if registry and key in registry:
            stale = [f for f in ATTRIBUTION_FIELDS if registry[key].get(f) != s.get(f)]
            if stale:
                warnings.append(f"source {key}: {', '.join(stale)} differ from the pipeline registry")
    for name, layer in manifest.get("layers", {}).items():
        for src in [layer.get("source")] + list(layer.get("sources_used", [])):
            if src and src not in sources:
                problems.append(f"layer {name}: source {src} is not listed in manifest sources")
    return problems, warnings


def audit(tile_id: str) -> dict:
    p = TILES_DIR / tile_id / "species" / "occurrences.geojson"
    occ = read_json(p)["features"] if p.exists() else []
    by_license, by_species = Counter(), defaultdict(Counter)
    for f in occ:
        lic = (f["properties"].get("license") or "unknown").replace("http://creativecommons.org/", "cc:").replace("https://creativecommons.org/", "cc:")
        by_license[lic] += 1
        by_species[f["properties"]["species_code"]][lic] += 1
    total = sum(by_license.values())
    nc = sum(v for k, v in by_license.items() if "nc" in k.lower())
    return {"tile": tile_id, "records": total, "by_license": dict(by_license),
            "non_commercial": nc, "non_commercial_fraction": round(nc / total, 3) if total else 0,
            "by_species": {s: dict(c) for s, c in by_species.items()}}


def _registry() -> dict | None:
    try:
        from .config import all_sources
        return all_sources()
    except ImportError as e:  # a fetch module's dependency missing: skip the staleness check only
        print(f"(registry unavailable, staleness not checked: {e})")
        return None


def main(argv) -> int:
    ids = argv or [p.name for p in sorted(TILES_DIR.glob("utm*")) if (p / "manifest.json").exists()]
    registry = _registry()
    failed = []
    for tid in ids:
        m = read_json(TILES_DIR / tid / "manifest.json")
        problems, warnings = audit_attribution(m, registry)
        print(f"{tid}: {len(m.get('sources', {}))} sources, "
              f"{sum(1 for s in m.get('sources', {}).values() if s.get('attribution_required'))} require attribution"
              f"{'' if not problems else f', {len(problems)} PROBLEM(S)'}")
        for key, s in m.get("sources", {}).items():
            flag = {True: "required", False: "courtesy"}.get(s.get("attribution_required"), "missing")
            print(f"   [{flag:8s}] {key}: {s.get('attribution', '(no attribution)')}  <{s.get('attribution_url', '')}>")
        for w in warnings:
            print(f"   warning: {w}")
        for pr in problems:
            print(f"   PROBLEM: {pr}")
        if problems:
            failed.append(tid)

        a = audit(tid)
        print(f"   occurrences: {a['records']} records, {a['non_commercial']} non-commercial ({a['non_commercial_fraction']:.0%})")
        for lic, n in sorted(a["by_license"].items(), key=lambda kv: -kv[1]):
            print(f"   {n:6d}  {lic}")
        worst = sorted(a["by_species"].items(), key=lambda kv: -sum(v for k, v in kv[1].items() if "nc" in k.lower()))[:3]
        for s, c in worst:
            ncs = sum(v for k, v in c.items() if "nc" in k.lower())
            print(f"   species most affected: {s} {ncs}/{sum(c.values())} NC")
    if failed:
        print(f"FAIL: attribution problems in {', '.join(failed)}")
        return 1
    print(f"OK: every source in {len(ids)} tile(s) carries its licence and attribution")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
