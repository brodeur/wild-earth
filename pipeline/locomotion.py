"""How each animal moves, resolved from its taxon and its body (docs/movement.md).

    .venv/bin/python -m pipeline.locomotion                      # the table for every species in the library
    .venv/bin/python -m pipeline.locomotion --tile utm10n_680_4280   # write tiles/<id>/locomotion.json for the tile's species

The library's animal records (library/animals/<code>.json) carry a taxonomy (kingdom to genus), a mass and a size;
library/animals/locomotion.json carries, per taxon, what is true of every animal in it (a principle set once at the
widest rank where it holds: a chordate's head leads a turn, a mammal's legs swing under it and its gaits change by
the Froude number, a lizard sprawls and turns by a C-bend, a bird is a biped whose head bobs), and a species block
for what no rank above says. resolve(code) merges the chain kingdom -> phylum -> class -> order -> family -> genus
-> species (deeper wins, dicts merge key by key) and then derives from the body the numbers nobody wrote:

  hip height      h      shoulder height of a walker (size.shoulder_or_wingspan_m), a bird's body length / 2
  walk top        v_w    sqrt(0.5 g h)   the walk-trot change at Froude 0.5 (Alexander & Jayes 1983)
  trot top        v_t    sqrt(2.5 g h)   the trot-gallop change at Froude 2.5
  top speed       v_max  Garland 1983 on mass: log10 km/h = 1.478 + 0.259 log10 M - 0.0623 (log10 M)^2, M in kg
                         (a 60 kg deer 15 m/s, a 4 kg fox 11, a 50 g vole 3: the small end is high, so a family or
                         a species caps it; a species' top_mps wins outright)
  cruise          v_c    cruise_of_top x v_max (a taxon's share: a canid holds 0.65, a cat 0.45)
  stride rate     f_t    4.19 M^-0.15 Hz at the trot-gallop change (Heglund & Taylor 1988): the walk's cadence is
                         about half of it, the gallop's up to 1.3x
  stride length   L_t    v_t / f_t
  sprint          s      s_at_50kg x (M / 50)^mass_exp (seconds of the top speed; recover the same way)
  turn            w      the on-the-spot turn rate: 2.2 rad/s x (1.3 m / body length)^0.5, capped at 8;
                         the step rate and amplitude from the taxon's turn block; the lag from the taxon's lag block
                         scaled by sqrt(body length / 1.3 m)
  catch                  the family's catch move, passed through as the tree gives it (a cat's leap and neck bite, a
                         canid's mousing pounce, a hawk's talon strike and mantle, a corvid's bill stab; a species block
                         may override its reach): the client's hunters catch by it (docs/movement.md "The catch")
Everything a species' record or the species block gives wins over the derivation. The output is a plain table per
species the client reads (client/src/locomotion.js) to fill the fields its hand-tuned tables (groundControl.js GROUND,
flierControl.js FLIERS) do not give, and for a species that has no hand-tuned entry at all: a new species on a new
tile moves from its taxon and its body alone.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

LIB = Path(__file__).resolve().parent.parent / "library" / "animals"
G = 9.81
RANKS = ["kingdom", "phylum", "class", "order", "family", "genus"]


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        if k == "note":
            continue
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_tree() -> dict:
    return json.loads((LIB / "locomotion.json").read_text())


def load_record(code: str) -> dict | None:
    p = LIB / f"{code}.json"
    return json.loads(p.read_text()) if p.exists() else None


def chain(rec: dict, tree: dict) -> list[str]:
    tax = rec.get("taxonomy") or {}
    return [tax[r] for r in RANKS if tax.get(r) in tree["taxa"]]


def vmax_garland(mass_kg: float) -> float:
    """Garland 1983: the maximal running speed of mammals by mass, in m/s (fitted on 106 species)."""
    lm = math.log10(max(mass_kg, 0.005))
    return 10 ** (1.478 + 0.259 * lm - 0.0623 * lm * lm) / 3.6


def resolve(code: str, tree: dict | None = None) -> dict | None:
    tree = tree or load_tree()
    rec = load_record(code)
    if not rec:
        return None
    merged: dict = {}
    for taxon in chain(rec, tree):
        merged = _merge(merged, tree["taxa"][taxon])
    merged = _merge(merged, tree.get("species", {}).get(code, {}))
    size = rec.get("size") or {}
    mass = float(rec.get("mass_kg") or 1.0)
    length = float(size.get("length_m") or 0.5)
    plan = rec.get("body_plan", "quadruped")
    cls = (rec.get("taxonomy") or {}).get("class", "")
    flier = cls == "Aves" and plan == "bird" and merged.get("gaits", {}).get("flight") not in (None, "flush")
    h = float(size.get("shoulder_or_wingspan_m") or 0) if cls != "Aves" else length * 0.5
    if h <= 0.02: h = length * 0.3   # no shoulder height in the record (the squirrel): a leggy third of the body
    h = max(h, 0.02)
    v_w, v_t = math.sqrt(0.5 * G * h), math.sqrt(2.5 * G * h)
    v_max = merged.get("top_mps") or (vmax_garland(mass) if cls == "Mammalia" else min(vmax_garland(mass), 4 * math.sqrt(G * h)))
    v_c = merged.get("cruise_mps") or merged.get("cruise_of_top", 0.6) * v_max
    f_t = 4.19 * mass ** -0.15
    sp = merged.get("sprint", {})
    s_sprint = merged.get("sprint_s") or sp.get("s_at_50kg", 10) * (mass / 50) ** sp.get("mass_exp", 0.25)
    s_recover = merged.get("recover_s") or sp.get("recover_s_at_50kg", 35) * (mass / 50) ** sp.get("mass_exp", 0.25)
    w = min(8.0, 2.2 * math.sqrt(1.3 / max(length, 0.05)))
    lag = dict(merged.get("lag", {"s": 0.15, "max_rad": 0.44, "v": [0.3, 1.2]}))
    k = math.sqrt(max(length, 0.05) / 1.3)
    lag_out = {"s": round(lag.get("s", 0.15) * k, 3), "max_rad": round(lag.get("max_rad", 0.44), 3), "v": lag.get("v", [0.3, 1.2])}
    out = {
        "code": code, "class": cls, "order": (rec.get("taxonomy") or {}).get("order"), "family": (rec.get("taxonomy") or {}).get("family"),
        "body_plan": plan, "mass_kg": mass, "length_m": length, "hip_m": round(h, 3),
        "posture": merged.get("posture"), "gaits": merged.get("gaits", {}),
        "walk_mps": round(min(v_w, v_c), 2), "trot_mps": round(min(v_t, v_max), 2), "cruise_mps": round(min(v_c, v_max), 2), "top_mps": round(v_max, 2),
        "stride_hz": round(f_t, 2), "stride_m": round(min(v_t, v_max) / f_t, 2),
        "sprint_s": round(max(1.0, s_sprint), 1), "recover_s": round(max(5.0, s_recover), 1),
        "turn_rad_s": round(w, 2), "turn": merged.get("turn", {}), "lag": lag_out, "bend": merged.get("bend"),
        "flags": {k: True for k in ("stot", "stalk", "sit_up", "tail_flag", "turn_bend", "head_lead", "cling") if merged.get(k)},
        "flier": flier,
    }
    if merged.get("stalk_mps"):
        out["stalk_mps"] = merged["stalk_mps"]
    if merged.get("catch"):   # the family's catch move (docs/movement.md "The catch"): the client picks a hunter's catch by it
        out["catch"] = merged["catch"]
    return out


def table(codes: list[str] | None = None) -> list[dict]:
    tree = load_tree()
    codes = codes or [c for c in json.loads((LIB / "index.json").read_text())["species"]]
    rows = [r for r in (resolve(c, tree) for c in codes) if r]
    return rows


def write_tile(tile_id: str, tiles_dir: Path) -> Path:
    tile = tiles_dir / tile_id
    sp = json.loads((tile / "species" / "species.json").read_text())
    codes = [s["code"] for s in sp if (LIB / f"{s['code']}.json").exists()]
    rows = {r["code"]: r for r in table(codes)}
    out = tile / "locomotion.json"
    out.write_text(json.dumps({"about": "how each animal moves, from its taxon and its body (pipeline/locomotion.py; docs/movement.md)", "species": rows}, indent=1))
    return out


def main(argv: list[str]) -> int:
    if "--tile" in argv:
        from .config import TILES_DIR
        p = write_tile(argv[argv.index("--tile") + 1], TILES_DIR)
        print(f"wrote {p}")
        return 0
    rows = table()
    print(f"{'species':26} {'class':9} {'family':16} {'kg':>6} {'hip':>5} {'walk':>5} {'trot':>5} {'cruise':>6} {'top':>5} {'hz':>4} {'sprint':>6} {'recov':>5} {'turn':>4} flags")
    for r in rows:
        print(f"{r['code']:26} {r['class']:9} {r['family'] or '':16} {r['mass_kg']:6.2f} {r['hip_m']:5.2f} {r['walk_mps']:5.1f} {r['trot_mps']:5.1f} {r['cruise_mps']:6.1f} {r['top_mps']:5.1f} {r['stride_hz']:4.1f} {r['sprint_s']:6.1f} {r['recover_s']:5.0f} {r['turn_rad_s']:4.1f} {' '.join(r['flags'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
