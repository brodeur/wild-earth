"""A tile's own animals, modelled (world pipeline phase 1; docs/world-pipeline.md "Animals").

Every slot in client/fauna.json (pipeline/fauna_slots.py) starts as a stand-in: a static kin's rules and body, scaled. This
step gives the slots that matter most a body of their own, generated with Meshy and built by one generic path, so nothing
in it is per species:

  choose    which slots: the four-legged mammals that carry the most of the tile's mammal biomass (density x mass), and
            every large predator (a predator over 15 kg), the largest first; then the birds (2026-11-06): the scavengers
            and raptors first (a soaring archetype, or a scavenger over 1 kg), the heaviest first, then the rest by mass
            (the bigger, the more visible), the first pass taking one bird per build archetype (so every bird template
            gets a body of its own before any gets a second), then the rest in the same order; until the credit
            budget; the rest stay on the stand-in ladder (a model already in the library is reused at no cost by every
            tile). --kind birds or mammals limits a run to one;
  prompt    the mesh and texture prompts from the trait card alone (common and scientific name, the place, a fixed pose
            and framing that the generic build needs: a quadruped side-on, all four feet flat, nothing else touching
            the ground; a bird by its archetype (BIRD_BUILD): a soarer in flight with the wings spread flat, any other
            standing side-on with the wings folded and the legs apart);
  generate  tools/meshy_generate.py: a text-to-3D preview (latest, 20 credits) and its refine (2K texture, 10 credits);
  build     a quadruped: tools/build_quadruped.py (parts from the geometry, colour from the texture, size from the trait
            card), tools/rig_quadruped.py (skin), tools/bake_gait.mjs (gait clips); a bird: tools/build_bird.py (the
            part rig of its archetype's template, its flight cards); a build that cannot find its legs (or a bird's
            wing root or neck) is a failed attempt, and the slot gets one more preview (a fresh seed) before it is left
            a stand-in;
  record    library/animals/models.json: per species the GLB, the jobs, credits spent, attempts; and the run's ledger
            (credits by species, retries, modelled vs stand-in) in the tile's fauna/models_run.json.

Credits are spent only from this command, never from a tile build:

  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --budget 800 [--reserve 300] [--max 12] [--kind birds] [--dry-run]

The balance is read before every job; nothing is submitted that would take it under the reserve.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "client" / "assets" / "fauna"
REGISTRY = ROOT / "library" / "animals" / "models.json"
TRAITS = ROOT / "library" / "animals" / "traits"
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
NODE = os.environ.get("NODE", str(Path.home() / ".nvm/versions/node/v24.13.0/bin/node"))
PY = [sys.executable]
COST = {"preview": 20, "refine": 10}
PREDATOR_KG = 15.0
# A bird slot's archetype (pipeline/fauna_slots.py kin_for) -> the build's (tools/build_bird.py --archetype): the client
# template its kin is drawn with. The corvids' kin (the raven) is drawn by two models, a standing one and a procedural
# flier (animals.js DRAWN hybrid), which a fauna model does not replace: none.
BIRD_BUILD = {"soaring scavenger": "soar", "soaring raptor": "soar", "gull": "soar", "wading bird": "wade", "waterbird": "water",
              "ground bird": "ground", "perching bird": "perch", "night perching bird": "perch", "kingfisher": "perch",
              "woodpecker": "perch"}
SCAVENGER_KG = 1.0


def _traits(code: str) -> dict:
    for p in (TRAITS / f"{code}.json", ROOT / "library" / "animals" / f"{code}.json"):
        try:
            return json.loads(p.read_text())
        except (OSError, ValueError):
            continue
    return {}


def registry() -> dict:
    try:
        return json.loads(REGISTRY.read_text())
    except (OSError, ValueError):
        return {"format": 1, "species": {}}


def model_for(code: str) -> dict | None:
    """The client model of a species if the library has one (registered in library/animals/models.json, its GLB and
    clips in client/assets/fauna/): the fauna slot's `model` field (pipeline/fauna_slots.py)."""
    e = registry().get("species", {}).get(code)
    if not e or not (ASSETS / f"{code}.glb").exists():
        return None
    if e.get("kind") == "bird":   # the part rig (tools/build_bird.py): no skin, no clips
        return {"path": f"fauna/{code}.glb", "kind": "bird", "archetype": e.get("archetype"), "skin": False}
    if not (ASSETS / f"{code}_clips.json").exists():
        return None
    return {"path": f"fauna/{code}.glb", "kind": e.get("kind", "quadruped"), "skin": True}


def place_name(tile_id: str) -> str:
    """The tile's place in words, for the prompts: OpenStreetMap's reverse geocoder (Nominatim, ODbL) at the tile's centre,
    district level, cached in tiles/<id>/place/name.json."""
    tdir = ROOT / "tiles" / tile_id
    cache = tdir / "place" / "name.json"
    try:
        return json.loads(cache.read_text())["name"]
    except (OSError, ValueError, KeyError):
        pass
    b = json.loads((tdir / "manifest.json").read_text())["bounds_wgs84"]
    lat, lon = (b[1] + b[3]) / 2, (b[0] + b[2]) / 2
    import urllib.request
    url = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat:.4f}&lon={lon:.4f}&zoom=8&accept-language=en"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wild-earth-pipeline/1"}), timeout=30) as r:
            a = json.loads(r.read()).get("address", {})
    except Exception:
        return f"the wild at {lat:.2f}, {lon:.2f}"
    parts = [a.get(k) for k in ("state_district", "county", "state", "country") if a.get(k)]
    name = ", ".join(dict.fromkeys(parts)) or f"the wild at {lat:.2f}, {lon:.2f}"
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(json.dumps({"name": name, "source": "OpenStreetMap Nominatim reverse geocoding (ODbL)", "lat": lat, "lon": lon}, indent=1) + "\n")
    return name


def quadruped(slot: dict, t: dict) -> bool:
    plan = (t.get("body_plan") or (t.get("locomotion") or {}).get("body_plan") or "").lower()
    cls = ((t.get("taxonomy") or {}).get("class") or "").lower()
    return not slot.get("bird") and plan == "quadruped" and cls == "mammalia"


def bird_build(slot: dict) -> str | None:
    """The build archetype of a bird slot (BIRD_BUILD), or None (not a bird, or a kin no fauna model replaces)."""
    return BIRD_BUILD.get(slot.get("archetype") or "") if slot.get("bird") else None


def choose(fauna: dict, budget: int, max_n: int = 12, kind: str = "all") -> tuple[list[dict], list[dict]]:
    """(to model, left as stand-ins), each slot with the reason. Ranked: the quadrupeds, large predators first (largest
    first), then the rest by biomass (density x mass); then the birds, scavengers and raptors first (heaviest first),
    then the rest by mass, one per build archetype before any second; a slot whose model the library already has costs
    nothing and is always taken."""
    cand, birds, rest = [], [], []
    for s in fauna.get("slots", []):
        t = _traits(s["code"])
        mass, dens = float(s.get("mass_kg") or 0), float(s.get("density_km2") or 0)
        if quadruped(s, t) and kind in ("all", "mammals"):
            pred = "predator" in (s.get("role") or []) and mass >= PREDATOR_KG
            cand.append({**s, "biomass": dens * mass, "pred": pred})
        elif bird_build(s) and kind in ("all", "birds"):
            arch = s.get("archetype") or ""
            raptor = arch.startswith("soaring") or ("scavenger" in (s.get("role") or []) and mass >= SCAVENGER_KG)
            birds.append({**s, "pred": raptor, "build_archetype": bird_build(s)})
        else:
            rest.append({**s, "why": "not a four-legged mammal or a bird with a template (the generic builds)" if kind == "all"
                         else f"not in this run (--kind {kind})"})
    cand.sort(key=lambda s: (not s["pred"], -(s["mass_kg"] if s["pred"] else s["biomass"])))
    birds.sort(key=lambda s: (not s["pred"], -float(s.get("mass_kg") or 0)))
    first, seen = [], set()
    for s in birds:   # one per build archetype first
        if s["build_archetype"] not in seen:
            seen.add(s["build_archetype"]); first.append(s)
    birds = first + [s for s in birds if s not in first]
    pick, spend = [], 0
    for s in cand + birds:
        have = model_for(s["code"]) is not None
        cost = 0 if have else COST["preview"] + COST["refine"]
        if have or (len(pick) < max_n and spend + cost <= budget):
            why = "in the library" if have else (("scavenger or raptor" if s["pred"] else "bird by mass, one per archetype first")
                                                 if s.get("build_archetype") else ("large predator" if s["pred"] else "biomass rank"))
            pick.append({**s, "why": why})
            spend += cost
        else:
            rest.append({**s, "why": "over the budget or the count"})
    return pick, rest


def prompts(slot: dict, place: str) -> tuple[str, str]:
    t = _traits(slot["code"])
    common = (slot.get("common") or t.get("common") or slot["code"]).strip()
    sci = slot.get("scientific") or t.get("scientific") or slot["code"].replace("_", " ").capitalize()
    arch = bird_build(slot)
    if arch:
        # the pose the build needs for the archetype's template: a soarer's flight mesh (the wings are the mesh, spread for
        # good), any other bird standing with its wings folded (the build adds the flight cards); no sizes (the cards'
        # lengths and spans are allometric guesses; the build sizes by mass)
        if arch == "soar":
            mesh = (f"A wild {common} ({sci}) of {place}, one adult bird soaring in mid-air, realistic anatomy and proportions. "
                    "Seen level, the body horizontal like an airplane: both wings fully spread flat and straight out to the "
                    "sides, wingtips level with the body, the flight feathers spread, the tail spread, the head forward, the "
                    "legs and feet tucked up under the body, nothing hanging below. Single bird, no base, no perch, no ground. "
                    "Game-ready.")
            tex = (f"Natural plumage colours and markings of a wild adult {common} ({sci}) as seen in {place}, both the upper "
                   "side and the underside of the wings and tail in their true colours; realistic, evenly lit albedo with no "
                   "baked shadows or highlights; bill, eyes, bare skin and feet in their true colours.")
        else:
            mesh = (f"A wild {common} ({sci}) of {place}, one adult bird, realistic anatomy and proportions. Standing still on "
                    "the ground in a side-on neutral pose: the wings folded tight against the body, both legs straight and "
                    "apart with a clear gap between them, both feet flat on the ground, the head up and looking forward, the "
                    "bill closed, the tail held clear of the ground; nothing but the feet touches the ground. No base, no "
                    "ground plane, no perch, no water, no props. Game-ready.")
            tex = (f"Natural plumage colours and markings of a wild adult {common} ({sci}) as seen in {place}; realistic, evenly "
                   "lit albedo with no baked shadows or highlights; bill, eyes, bare skin, legs and feet in their true colours.")
        return mesh[:800], tex[:800]
    # no dimensions: the cards' shoulder heights are allometric guesses (a hippo 2.5 m); the build sizes by mass
    mesh = (f"A wild {common} ({sci}) of {place}, one adult, realistic anatomy and proportions. Standing still in a "
            "side-on neutral pose, all four legs straight with clear gaps between them, all four feet flat on the ground, "
            "head level looking forward, mouth closed, tail hanging free clear of the legs; nothing but the four feet "
            "touches the ground. No base, no ground plane, no props, no rider. Game-ready.")
    tex = (f"Natural coat colours and markings of a wild adult {common} ({sci}) as seen in {place}; realistic, evenly lit "
           "albedo with no baked shadows or highlights, eyes and nose and hooves or paws in their true colours.")
    return mesh[:800], tex[:800]


def _meshy(*args: str) -> Path | None:
    r = subprocess.run(PY + ["-I", str(ROOT / "tools" / "meshy_generate.py"), *args, "--yes"], cwd=ROOT,
                       capture_output=True, text=True)
    sys.stderr.write("\n".join(l for l in r.stderr.splitlines() if "key" not in l.lower()) + "\n")
    lines = [l for l in r.stdout.strip().splitlines() if l.strip()]
    if r.returncode or not lines:
        return None
    d = Path(lines[-1]) if Path(lines[-1]).is_absolute() else ROOT / lines[-1]
    try:
        j = json.loads((d / "job.json").read_text())
    except (OSError, ValueError):
        return None
    return d if j.get("status") == "SUCCEEDED" else None


def balance() -> int | None:
    r = subprocess.run(PY + ["-I", str(ROOT / "tools" / "meshy_generate.py"), "balance"], cwd=ROOT, capture_output=True, text=True)
    try:
        return int(json.loads(r.stdout)["balance"])
    except (ValueError, KeyError, TypeError):
        return None


def build(code: str, job: Path, tile: str, bird: str | None = None) -> tuple[bool, str]:
    out = ASSETS / f"{code}.glb"
    ASSETS.mkdir(parents=True, exist_ok=True)
    steps = [
        [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / "build_bird.py"), "--", str(job), str(out), "--species", code,
         "--archetype", bird],
    ] if bird else [
        [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / "build_quadruped.py"), "--", str(job), str(out), "--species", code],
        ["arch", "-arm64", str(ROOT / ".venv" / "bin" / "python"), str(ROOT / "tools" / "rig_quadruped.py"), str(out)],
        [NODE, str(ROOT / "tools" / "bake_gait.mjs"), str(out), "--tile", tile],
    ]
    log = []
    for cmd in steps:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        tail = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith(("INFO", "LANDMARKS", "WROTE", "WARN", "TIER", "CLIP")) or "rror" in l or code + ":" in l]
        log += tail[-12:]
        if r.returncode or not out.exists() or ("WROTE" not in r.stdout and "WROTE" not in r.stderr):
            return False, "\n".join(log)
    return True, "\n".join(log)


def paid_refines(code: str) -> list[Path]:
    out = []
    for j in (ROOT / "library" / "animals" / "jobs" / code).glob("*/job.json"):
        try:
            d = json.loads(j.read_text())
        except (OSError, ValueError):
            continue
        if d.get("mode") == "refine" and d.get("status") == "SUCCEEDED" and (j.parent / "model.glb").exists():
            out.append(j.parent)
    return out


def register(reg: dict, code: str, jobs: list[str], credits: int, attempts: int, tile_id: str, bird: str | None = None) -> None:
    e = reg.setdefault("species", {}).get(code, {})
    reg["species"][code] = {"kind": "bird" if bird else "quadruped", "glb": f"client/assets/fauna/{code}.glb", "jobs": jobs or e.get("jobs", []),
                            "credits": e.get("credits", 0) + credits, "attempts": e.get("attempts", 0) + attempts,
                            "built": dt.date.today().isoformat(), "build": "tools/build_bird.py" if bird else "tools/build_quadruped.py",
                            "tile": e.get("tile", tile_id), **({"archetype": bird} if bird else {})}
    REGISTRY.write_text(json.dumps(reg, indent=1) + "\n")


def rebuild(tile_id: str) -> dict:
    """Every library model rebuilt from the refine job it was built from, with today's build (no credits)."""
    out = {}
    for code, e in registry().get("species", {}).items():
        jobs = [ROOT / j for j in e.get("jobs", []) if (ROOT / j / "job.json").exists() and json.loads((ROOT / j / "job.json").read_text()).get("mode") == "refine"]
        ok, log = build(code, jobs[-1], tile_id, e.get("archetype") if e.get("kind") == "bird" else None) if jobs else (False, "no refine job")
        out[code] = ok
        print(f"{code}: {'rebuilt' if ok else 'FAILED: ' + log.splitlines()[-1] if log else 'FAILED'}", flush=True)
    return out


def run(tile_id: str, budget: int, reserve: int, max_n: int, dry: bool, kind: str = "all", attempts: int = 2) -> dict:
    tdir = ROOT / "tiles" / tile_id
    fauna = json.loads((tdir / "client" / "fauna.json").read_text())
    place = place_name(tile_id)
    pick, rest = choose(fauna, budget, max_n, kind)
    reg = registry()
    ledger = {"tile": tile_id, "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "budget": budget,
              "reserve": reserve, "species": [], "stand_ins": [{"code": s["code"], "why": s["why"]} for s in rest]}
    spent = 0
    for s in pick:
        code = s["code"]
        bird = s.get("build_archetype")
        row = {"code": code, "why": s["why"], "attempts": 0, "credits": 0, "jobs": [], "ok": model_for(code) is not None,
               **({"archetype": bird} if bird else {})}
        ledger["species"].append(row)
        if row["ok"]:
            continue
        # the jobs already paid for, newest first: a build rule fixed since may make one of them pass at no cost
        for job in sorted(paid_refines(code), key=lambda d: d.stat().st_mtime, reverse=True):
            ok, log = build(code, job, tile_id, bird)
            if ok:
                row["ok"], row["build_log"], row["reused"] = True, log, str(job.relative_to(ROOT))
                register(reg, code, [str(job.relative_to(ROOT))], 0, 0, tile_id, bird)
                break
        if row["ok"]:
            print(f"{code}: modelled from a paid job, 0 credits", flush=True)
            continue
        mesh, tex = prompts(s, place)
        row["prompt"], row["texture_prompt"] = mesh, tex
        if dry:
            print(f"[dry] {code} ({s['why']}{', ' + bird if bird else ''}, {s.get('mass_kg')} kg): {mesh}\n      texture: {tex}")
            continue
        for attempt in range(1, attempts + 1):
            bal = balance()
            need = COST["preview"] + COST["refine"]
            if bal is None or bal - need < reserve or spent + need > budget:
                row["stopped"] = f"balance {bal}, spent {spent}: the next job would cross the reserve or the budget"
                break
            row["attempts"] = attempt
            pv = _meshy("generate", "--species", code, "--mode", "preview", "--prompt", mesh, "--ai-model", "latest",
                        "--topology", "triangle", "--target-polycount", "30000", "--should-remesh", "true",
                        "--maintainer", "agent (Claude) for Aaron Brodeur, world pipeline")
            spent += COST["preview"]; row["credits"] += COST["preview"]
            if not pv:
                row["jobs"].append({"mode": "preview", "ok": False}); continue
            rf = _meshy("generate", "--species", code, "--mode", "refine", "--preview-job", str(pv), "--texture-prompt", tex,
                        "--maintainer", "agent (Claude) for Aaron Brodeur, world pipeline")
            spent += COST["refine"]; row["credits"] += COST["refine"]
            row["jobs"] += [{"mode": "preview", "dir": str(pv.relative_to(ROOT))}, {"mode": "refine", "dir": str(rf.relative_to(ROOT)) if rf else None}]
            if not rf:
                continue
            ok, log = build(code, rf, tile_id, bird)
            row["build_log"] = log
            if ok:
                row["ok"] = True
                register(reg, code, [j["dir"] for j in row["jobs"] if j.get("dir")], row["credits"], attempt, tile_id, bird)
                break
        print(f"{code}: {'modelled' if row['ok'] else 'stand-in'} after {row['attempts']} attempt(s), {row['credits']} credits", flush=True)
    ledger["spent"] = spent
    ledger["balance_after"] = None if dry else balance()
    ledger["modelled"] = sum(1 for r in ledger["species"] if r["ok"])
    if not dry:
        (tdir / "fauna").mkdir(exist_ok=True)
        # the latest run on top, the earlier runs kept under "earlier" (a birds run must not erase the mammals' ledger)
        lp = tdir / "fauna" / "models_run.json"
        try:
            prev = json.loads(lp.read_text())
        except (OSError, ValueError):
            prev = None
        if prev:
            ledger["earlier"] = prev.pop("earlier", []) + [prev]
        lp.write_text(json.dumps(ledger, indent=1) + "\n")
    return ledger


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tile"); ap.add_argument("--budget", type=int, default=0)
    ap.add_argument("--reserve", type=int, default=300); ap.add_argument("--max", type=int, default=12)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--attempts", type=int, default=2, help="previews per species before it is left a stand-in")
    ap.add_argument("--kind", choices=("all", "mammals", "birds"), default="all", help="model only the mammals or only the birds")
    ap.add_argument("--rebuild", action="store_true", help="rebuild every library model from its job (no credits), then stop")
    a = ap.parse_args()
    if a.rebuild:
        rebuild(a.tile); return
    led = run(a.tile, a.budget, a.reserve, a.max, a.dry_run, a.kind, a.attempts)
    print(json.dumps({k: led[k] for k in ("spent", "balance_after", "modelled")}))


if __name__ == "__main__":
    main()
