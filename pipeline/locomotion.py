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
  vary                   the taxon's variation block (the spread of stride intervals by gait and its memory, an
                         individual's tempo and lead, the walk's and the gallop's lags, the slope's answer, the
                         soft parts), as what differs from Mammalia's (the client's default): the client's gait
                         engine makes every stride and every individual its own from it (docs/movement.md
                         "Strides that vary")
  catch                  the family's catch move, passed through as the tree gives it (a cat's leap and neck bite, a
                         canid's mousing pounce, a hawk's talon strike and mantle, a corvid's bill stab; a species block
                         may override its reach): the client's hunters catch by it (docs/movement.md "The catch")
  dive                   a bird's fall with the wings closed (the tree's `dive` block: the body's drag coefficient and the
                         steepest angle, set at the class and overridden where a group's own is measured): the frontal
                         area S_b = 0.00813 M^0.666 m^2 (Pennycuick 1989, the allometry the measured drag coefficients
                         were worked out with), the terminal speed sqrt(2 M g / (rho cd S_b)) in sea-level air (rho
                         1.23), so it rises with M^(1/6); the top at the steepest angle is terminal x sqrt(sin angle).
                         The client's dive gains speed as that falling body does (client/src/dive.js)
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
RHO = 1.23                      # kg/m^3: sea-level air (the dive's drag)
FRONTAL = (0.00813, 0.666)      # a bird's body frontal area, m^2 = a M^b (Pennycuick 1989)
RANKS = ["kingdom", "phylum", "class", "order", "family", "genus"]


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        if k == "note":
            continue
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _no_notes(d: dict) -> dict:
    return {k: (_no_notes(v) if isinstance(v, dict) else v) for k, v in d.items() if k != "note"}


def _differs(a: dict, base: dict) -> dict:
    """What a says that base does not (dicts compared key by key)."""
    out = {}
    for k, v in a.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            d = _differs(v, base[k])
            if d:
                out[k] = d
        elif base.get(k) != v:
            out[k] = v
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


def dive_of(d: dict, mass_kg: float) -> dict:
    """A bird's dive from the tree's block (cd, angle_deg, pull_g_at_half_top) and its mass: the terminal speed of the
    tucked body in a vertical fall, the steepest angle, the top speed at that angle (m/s, degrees)."""
    sb = FRONTAL[0] * mass_kg ** FRONTAL[1]
    vt = math.sqrt(2 * mass_kg * G / (RHO * d["cd"] * sb))
    ang = float(d.get("angle_deg", 64))
    out = {"terminal_mps": round(vt, 1), "angle_deg": ang, "top_mps": round(vt * math.sqrt(math.sin(math.radians(ang))), 1), "cd": d["cd"]}
    if d.get("pull_g_at_half_top"):
        out["pull_g_at_half_top"] = d["pull_g_at_half_top"]
    return out


def resolve(code: str, tree: dict | None = None, rec: dict | None = None) -> dict | None:
    """rec: a record not in the library (a generated trait entry, pipeline/fauna.py) with taxonomy, mass_kg, size and
    body_plan; else the library's record for code."""
    tree = tree or load_tree()
    rec = rec or load_record(code)
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
    if merged.get("hop"):   # the lagomorphs' gait set (client/src/gait.js hopStep: the shuffle, the half-bound, the hares' observation hop)
        out["hop"] = {k: v for k, v in merged["hop"].items() if k != "note"}
    if cls == "Aves" and (merged.get("dive") or {}).get("cd"):   # a bird's fall with the wings closed (the class's rule, a group's own drag and angle)
        out["dive"] = dive_of(merged["dive"], mass)
    if merged.get("vary"):   # strides that are never the same (client/src/gait.js: the individual, the stride's drift, the gait's continuum, the soft parts)
        # a row carries only what differs from the class's block (Mammalia's is the client's own default, gait.js VARY,
        # held equal to the tree by tests/test_locomotion_vary.py), so thirty rows do not repeat it; the notes stay in the tree
        d = _differs(_no_notes(merged["vary"]), _no_notes(tree["taxa"].get("Mammalia", {}).get("vary", {})))
        if d:
            out["vary"] = d
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
