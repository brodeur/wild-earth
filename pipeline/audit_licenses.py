"""Count species occurrence records by license per tile, so the data-licensing question
has numbers: how many records are CC BY-NC (unusable in a commercial product) versus
CC0 / CC BY.

    python -m pipeline.audit_licenses [tile_id ...]
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict

from .config import TILES_DIR, read_json


def audit(tile_id: str) -> dict:
    occ = read_json(TILES_DIR / tile_id / "species" / "occurrences.geojson")["features"]
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


def main(argv):
    ids = argv or [p.name for p in sorted(TILES_DIR.glob("utm*")) if (p / "manifest.json").exists()]
    for tid in ids:
        a = audit(tid)
        print(f"{a['tile']}: {a['records']} records, {a['non_commercial']} non-commercial ({a['non_commercial_fraction']:.0%})")
        for lic, n in sorted(a["by_license"].items(), key=lambda kv: -kv[1]):
            print(f"   {n:6d}  {lic}")
        worst = sorted(a["by_species"].items(), key=lambda kv: -sum(v for k, v in kv[1].items() if "nc" in k.lower()))[:3]
        for s, c in worst:
            ncs = sum(v for k, v in c.items() if "nc" in k.lower())
            print(f"   species most affected: {s} {ncs}/{sum(c.values())} NC")


if __name__ == "__main__":
    main(sys.argv[1:])
