"""A tile's own animals, modelled (world pipeline phase 1; docs/world-pipeline.md "Animals").

Every slot in client/fauna.json (pipeline/fauna_slots.py) starts as a stand-in: a static kin's rules and body, scaled. This
step gives the slots that matter most a body of their own, generated with Meshy and built by one generic path, so nothing
in it is per species:

  choose    which slots: the four-legged mammals that carry the most of the tile's mammal biomass (density x mass), and
            every large predator (a predator over 15 kg), the largest first; then the birds (2026-11-06): the scavengers
            and raptors first (a soaring archetype, or a scavenger over 1 kg), the heaviest first, then the rest by mass
            (the bigger, the more visible), the first pass taking one bird per build archetype (so every bird template
            gets a body of its own before any gets a second), then the rest in the same order; then the reptiles
            (2026-11-06), the most visible first (records x sqrt(mass)), one per build archetype (a sprawler, a
            tortoise) first; then the snakes (2026-11-06), the most visible first (records x sqrt(mass)); until the credit
            budget; the rest stay on the stand-in ladder (a model already in the library is reused at no cost by every
            tile). --kind mammals, birds, reptiles or snakes limits a run to one;
  prompt    the mesh and texture prompts from the trait card alone (common and scientific name, the place, a fixed pose
            and framing that the generic build needs: a quadruped side-on, all four feet flat, nothing else touching
            the ground; a bird by its archetype (BIRD_BUILD): a soarer in flight with the wings spread flat, any other
            standing side-on with the wings folded and the legs apart; a reptile by its archetype (REPTILE_BUILD): a
            sprawler side-on with the belly just clear of the ground, the legs splayed beyond the flanks and the tail
            straight behind, a tortoise with its legs straight down under the shell's rim; a snake lying stretched out
            on the ground in one gentle S, no coils, nothing of the body touching or crossing another part);
            The texture prompt leads with the species' described appearance (pipeline/appearance.py: colours and markings
            by body region, researched from Wikipedia and Animal Diversity Web, stored in library/animals/appearance/),
            2026-11-06: a generic "natural colours" prompt gave the leopard tortoise a brown and orange shell;
  generate  tools/meshy_generate.py: a text-to-3D preview (latest, 20 credits) and its refine (2K texture, 10 credits);
  build     a quadruped: tools/build_quadruped.py (parts from the geometry, colour from the texture, size from the trait
            card), tools/rig_quadruped.py (skin), tools/bake_gait.mjs (gait clips); a bird: tools/build_bird.py (the
            part rig of its archetype's template, its flight cards); a reptile: tools/build_reptile.py (the reptile
            part rig); a snake: tools/build_snake.py (the body traced as a tube and straightened, the snake template);
            a build that cannot find its legs (or a bird's wing root or neck, or a snake's body) is a failed attempt, and
            the slot gets one more preview (a fresh seed) before it is left a stand-in. A snake's build runs on the
            untextured preview first (the gate), so a mesh it cannot use costs no refine; a paid preview no refine was
            made from is tried before a new one;
  check     the built model's colours against the described appearance (pipeline/appearance.py check): a mismatch is
            re-refined once from the same preview (10 credits, the mesh kept) and the better of the two is kept;
            --recolour does the same for the library's models (--codes to name them, else every one that fails);
  record    library/animals/models.json: per species the GLB, the jobs, credits spent, attempts; and the run's ledger
            (credits by species, retries, modelled vs stand-in) in the tile's fauna/models_run.json.

Credits are spent only from this command, never from a tile build:

  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --budget 800 [--reserve 300] [--max 12] [--kind birds] [--dry-run]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --check [--codes a,b]           # the colour check, no credits
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --recolour --budget 60 [--codes a,b] [--reserve 1450]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --rebuild [--codes a,b]

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
# A reptile slot's archetype (pipeline/fauna_slots.py kin_for, reptile_group) -> tools/build_reptile.py --archetype: a
# sprawler (the crocodilians and lizards: belly low, four legs splayed beyond the flanks, the tail on the ground) or a
# tortoise (a rigid shell over legs standing under its rim). Both draw on the reptile part rig (animalModels.js RIG_REPTILE).
# The snakes (archetype 'snake') have a build of their own (tools/build_snake.py, the snake template; is_snake).
REPTILE_BUILD = {"crocodilian": "sprawl", "monitor lizard": "sprawl", "basking lizard": "sprawl", "chameleon": "sprawl",
                 "tortoise": "tortoise", "turtle": "tortoise"}


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
    # the judge's verdict (library/animals/models.json `judge`): a model that fails a species' defining feature (a
    # mountain goat with an ibex's horns, a badger with a raccoon's ringed tail) is not drawn; the slot keeps its stand-in
    # and the paid job stays for a retry from a reference image
    if e and (e.get("judge") or {}).get("verdict") == "rejected":
        return None
    if not e or not (ASSETS / f"{code}.glb").exists():
        return None
    if e.get("kind") == "bird":   # the part rig (tools/build_bird.py): no skin, no clips
        return {"path": f"fauna/{code}.glb", "kind": "bird", "archetype": e.get("archetype"), "skin": False}
    if e.get("kind") == "reptile":   # the reptile part rig (tools/build_reptile.py): no skin, no clips
        return {"path": f"fauna/{code}.glb", "kind": "reptile", "archetype": e.get("archetype"), "skin": False}
    if e.get("kind") == "snake":   # the snake template (tools/build_snake.py): the body straight, bent by the client
        return {"path": f"fauna/{code}.glb", "kind": "snake", "archetype": "snake", "skin": False}
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


def reptile_build(slot: dict) -> str | None:
    """The build archetype of a reptile slot (REPTILE_BUILD), or None (not a reptile, or a snake)."""
    return REPTILE_BUILD.get(slot.get("archetype") or "") if slot.get("reptile") else None


def is_snake(slot: dict) -> bool:
    """A snake slot (pipeline/fauna_slots.py: archetype 'snake', the lizard machine's way 'snake')."""
    return bool(slot.get("reptile")) and (slot.get("archetype") == "snake" or slot.get("reptile") == "snake")


def bird_build(slot: dict) -> str | None:
    """The build archetype of a bird slot (BIRD_BUILD), or None (not a bird, or a kin no fauna model replaces)."""
    return BIRD_BUILD.get(slot.get("archetype") or "") if slot.get("bird") else None


def choose(fauna: dict, budget: int, max_n: int = 12, kind: str = "all") -> tuple[list[dict], list[dict]]:
    """(to model, left as stand-ins), each slot with the reason. Ranked: the quadrupeds, large predators first (largest
    first), then the rest by biomass (density x mass); then the birds, scavengers and raptors first (heaviest first),
    then the rest by mass, one per build archetype before any second; then the reptiles, the most visible first (records x
    sqrt(mass): a crocodile's 151 records at 94 kg before an agama's 63 at 0.1 kg), one per build archetype (a sprawler, a
    tortoise) before any second; then the snakes by records x sqrt(mass); a slot whose model the library already has
    costs nothing and is always taken."""
    cand, birds, reps, snakes, rest = [], [], [], [], []
    for s in fauna.get("slots", []):
        t = _traits(s["code"])
        mass, dens = float(s.get("mass_kg") or 0), float(s.get("density_km2") or 0)
        if quadruped(s, t) and kind in ("all", "mammals"):
            pred = "predator" in (s.get("role") or []) and mass >= PREDATOR_KG
            cand.append({**s, "biomass": dens * mass, "pred": pred})
        elif is_snake(s) and kind in ("all", "snakes"):
            snakes.append({**s, "pred": False, "build_archetype": "snake", "visible": float(s.get("records") or 0) * mass ** 0.5})
        elif reptile_build(s) and kind in ("all", "reptiles"):
            reps.append({**s, "pred": False, "build_archetype": reptile_build(s), "visible": float(s.get("records") or 0) * mass ** 0.5})
        elif bird_build(s) and kind in ("all", "birds"):
            arch = s.get("archetype") or ""
            raptor = arch.startswith("soaring") or ("scavenger" in (s.get("role") or []) and mass >= SCAVENGER_KG)
            birds.append({**s, "pred": raptor, "build_archetype": bird_build(s)})
        else:
            rest.append({**s, "why": "not a four-legged mammal, a bird, a reptile or a snake with a template (the generic builds)" if kind == "all"
                         else f"not in this run (--kind {kind})"})
    cand.sort(key=lambda s: (not s["pred"], -(s["mass_kg"] if s["pred"] else s["biomass"])))
    birds.sort(key=lambda s: (not s["pred"], -float(s.get("mass_kg") or 0)))
    first, seen = [], set()
    for s in birds:   # one per build archetype first
        if s["build_archetype"] not in seen:
            seen.add(s["build_archetype"]); first.append(s)
    birds = first + [s for s in birds if s not in first]
    reps.sort(key=lambda s: -s["visible"])
    first, seen = [], set()
    for s in reps:
        if s["build_archetype"] not in seen:
            seen.add(s["build_archetype"]); first.append(s)
    reps = first + [s for s in reps if s not in first]
    snakes.sort(key=lambda s: -s["visible"])
    pick, spend = [], 0
    for s in cand + birds + reps + snakes:
        have = model_for(s["code"]) is not None
        cost = 0 if have else COST["preview"] + COST["refine"]
        if have or (len(pick) < max_n and spend + cost <= budget):
            why = "in the library" if have else ("snake by records x sqrt(mass)" if is_snake(s) else
                                                 "reptile by records x sqrt(mass), one per archetype first" if s.get("reptile") else
                                                 ("scavenger or raptor" if s["pred"] else "bird by mass, one per archetype first")
                                                 if s.get("build_archetype") else ("large predator" if s["pred"] else "biomass rank"))
            pick.append({**s, "why": why})
            spend += cost
        else:
            rest.append({**s, "why": "over the budget or the count"})
    return pick, rest


def appearance(code: str, t: dict | None = None) -> dict | None:
    """The species' described appearance (pipeline/appearance.py), researched once and stored; None offline."""
    from . import appearance as ap
    t = t if t is not None else _traits(code)
    sci = t.get("scientific") or code.replace("_", " ").capitalize()
    try:
        return ap.research(code, sci, t.get("common"), log=lambda *_: None)
    except Exception as e:   # no network: the generic prompt
        sys.stderr.write(f"{code}: no appearance research ({e})\n")
        return None


def _with_lead(tex: str, lead: str) -> str:
    """The texture prompt with the described appearance after its first sentence, trimmed region by region to 800."""
    if not lead:
        return tex[:800]
    head, _, tail = tex.partition("; ")
    while lead and len(f"{head}. {lead} {tail[:1].upper()}{tail[1:]}") > 800:
        cut = lead.rstrip(".").rsplit("; ", 1)
        lead = cut[0] + "." if len(cut) > 1 else ""
    return f"{head}. {lead} {tail[:1].upper()}{tail[1:]}"[:800] if lead else tex[:800]


def _lead(code: str, arch: str | None = None) -> str:
    from .appearance import texture_lead
    return texture_lead(appearance(code), "tortoise" if arch == "tortoise" else None)


def prompts(slot: dict, place: str) -> tuple[str, str]:
    mesh, tex = _prompts(slot, place)
    return mesh, _with_lead(tex, _lead(slot["code"], reptile_build(slot)))


def _prompts(slot: dict, place: str) -> tuple[str, str]:
    t = _traits(slot["code"])
    common = (slot.get("common") or t.get("common") or slot["code"]).strip()
    sci = slot.get("scientific") or t.get("scientific") or slot["code"].replace("_", " ").capitalize()
    if is_snake(slot):
        # the pose the snake build needs: the whole body on the ground, stretched out in one gentle S (the build traces it
        # as a tube and straightens it; the client bends it), no coil or loop (a body lying on itself fuses in the remesh),
        # the head at one end and the tail tapering at the other. No sizes (the build sizes by mass).
        mesh = (f"A wild {common} ({sci}) of {place}, one adult snake, realistic anatomy and proportions. Lying flat on the "
                "ground, the whole body stretched out long in one gentle S-curve, no coils, no loops, no part of the body "
                "touching or crossing another, the head resting on the ground at one end looking forward along the body, "
                "mouth closed, no tongue, the tail tapering to a thin tip at the other end. No base, no ground plane, no "
                "rocks, no branches, no props. Game-ready.")
        tex = (f"Natural scale colours and markings of a wild adult {common} ({sci}) as seen in {place}; realistic, evenly "
               "lit albedo with no baked shadows or highlights; the back, flanks, belly, head and tail in their true "
               "colours, the stripes or blotches along the body as they run, eyes in their true colours.")
        return mesh[:800], tex[:800]
    rarch = reptile_build(slot)
    if rarch:
        # the pose the reptile build needs: a sprawler with its belly just clear of the ground (the bask lowers it in the
        # client), its four legs splayed out beyond the flanks so each is a piece of its own, the tail straight behind on
        # the ground; a tortoise with its legs straight down under the shell's rim. No sizes (the build sizes by mass).
        if rarch == "tortoise":
            mesh = (f"A wild {common} ({sci}) of {place}, one adult, realistic anatomy and proportions. Standing still on flat "
                    "ground in a side-on neutral pose: the shell level, all four legs straight down under the rim of the shell "
                    "with clear gaps between them, all four feet flat on the ground, the head and neck stretched out in front "
                    "looking forward, the short tail behind; nothing but the four feet touches the ground. No base, no ground "
                    "plane, no rocks, no props. Game-ready.")
            tex = (f"Natural colours and markings of a wild adult {common} ({sci}) as seen in {place}: the shell's scutes, "
                   "the skin of the head and legs, in their true colours; realistic, evenly lit albedo with no baked shadows "
                   "or highlights; eyes, beak and claws in their true colours.")
        else:
            mesh = (f"A wild {common} ({sci}) of {place}, one adult, realistic anatomy and proportions. Standing still on flat "
                    "ground in a side-on neutral pose, the body straight and low, the belly just clear of the ground, all four "
                    "legs splayed out to the sides with bent elbows and knees and all four feet flat on the ground well "
                    "out from the body, the head straight forward in line with the body, mouth closed, the tail straight out "
                    "behind in line with the body, resting on the ground. No base, no ground plane, no water, no rocks, no "
                    "props. Game-ready.")
            tex = (f"Natural skin and scale colours and markings of a wild adult {common} ({sci}) as seen in {place}; "
                   "realistic, evenly lit albedo with no baked shadows or highlights; the back, flanks, belly, legs and tail "
                   "in their true colours, eyes and claws in their true colours.")
        return mesh[:800], tex[:800]
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


def build(code: str, job: Path, tile: str, bird: str | None = None, reptile: str | None = None, snake: bool = False,
          out: Path | None = None) -> tuple[bool, str]:
    out = out or ASSETS / f"{code}.glb"
    ASSETS.mkdir(parents=True, exist_ok=True)
    steps = [
        [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / "build_snake.py"), "--", str(job), str(out), "--species", code],
    ] if snake else [
        [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / "build_reptile.py"), "--", str(job), str(out), "--species", code,
         "--archetype", reptile],
    ] if reptile else [
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


def colour_check(code: str) -> dict:
    """The built model's colours against its described appearance (pipeline/appearance.py check)."""
    from .appearance import check
    app = appearance(code)
    glb = ASSETS / f"{code}.glb"
    if not app or not glb.exists():
        return {"ok": True, "score": None, "why": "no described appearance" if glb.exists() else "no model"}
    return check(glb, app)


def _model_files(code: str) -> list[Path]:
    return [p for p in (ASSETS / f"{code}.glb", ASSETS / f"{code}_clips.json") if p.exists()]


def recolour(code: str, tile_id: str, refine_job: Path, tex: str, kind: str | None, arch: str | None, before: dict) -> dict:
    """One re-refine of a model's preview with the appearance-led texture prompt (10 credits, the mesh kept), rebuilt and
    checked; the better of the two builds is kept (the new one if it passes or scores higher). Returns the record."""
    import shutil
    import tempfile
    pj = json.loads((refine_job / "job.json").read_text()).get("preview_job")
    pv = ROOT / pj if pj else None
    rec = {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "before": {k: before.get(k) for k in ("ok", "score", "fails")},
           "texture_prompt": tex, "credits": 0}
    if not pv or not (pv / "job.json").exists():
        rec["error"] = "no preview job to re-refine"; return rec
    rf = _meshy("generate", "--species", code, "--mode", "refine", "--preview-job", str(pv), "--texture-prompt", tex,
                "--maintainer", "agent (Claude) for Aaron Brodeur, world pipeline")
    rec["credits"] = COST["refine"]
    if not rf:
        rec["error"] = "refine failed"; return rec
    rec["job"] = str(rf.relative_to(ROOT))
    keep = Path(tempfile.mkdtemp(prefix=f"recolour_{code}_"))
    for f in _model_files(code):
        shutil.copy2(f, keep / f.name)
    ok, log = build(code, rf, tile_id, arch if kind == "bird" else None, arch if kind == "reptile" else None, kind == "snake")
    after = colour_check(code) if ok else {"ok": False, "score": None, "fails": ["build failed"]}
    from .appearance import offs
    rec["after"] = {k: after.get(k) for k in ("ok", "score", "fails")}
    rec["after"]["off"] = offs(after)
    nf = lambda c: len(c.get("fails") or [])
    better = ok and (after.get("ok") or nf(after) < nf(before) or
                     (nf(after) == nf(before) and (after.get("score") or 0) > (before.get("score") or 0)))
    rec["kept"] = "new" if better else "old"
    if not better:   # the old build back
        for f in keep.iterdir():
            shutil.copy2(f, ASSETS / f.name)
    shutil.rmtree(keep, ignore_errors=True)
    return rec


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


def paid_previews(code: str) -> list[Path]:
    """The species' paid preview jobs that no refine was made from (a snake's preview whose build failed the gate, or
    one stopped before its refine), newest first."""
    jobs = ROOT / "library" / "animals" / "jobs" / code
    used, out = set(), []
    for j in jobs.glob("*/job.json"):
        try:
            d = json.loads(j.read_text())
        except (OSError, ValueError):
            continue
        if d.get("mode") == "refine" and d.get("preview_job"):
            used.add(Path(d["preview_job"]).name)
        elif d.get("mode") == "preview" and d.get("status") == "SUCCEEDED" and (j.parent / "model.glb").exists():
            out.append(j.parent)
    return sorted((p for p in out if p.name not in used), key=lambda d: d.stat().st_mtime, reverse=True)


def gate(code: str, preview: Path, tile_id: str) -> tuple[bool, str]:
    """A snake's build on its untextured preview (the colours neutral), to a scratch file: whether the refine is worth paying."""
    import tempfile
    with tempfile.TemporaryDirectory(prefix=f"gate_{code}_") as d:
        return build(code, preview, tile_id, snake=True, out=Path(d) / f"{code}.glb")


def register(reg: dict, code: str, jobs: list[str], credits: int, attempts: int, tile_id: str, bird: str | None = None,
             reptile: str | None = None, snake: bool = False) -> None:
    fresh = registry()   # another run may have registered species since this one read the registry: merge, never overwrite
    e = fresh.setdefault("species", {}).get(code) or reg.setdefault("species", {}).get(code, {})
    kind = "snake" if snake else "reptile" if reptile else "bird" if bird else "quadruped"
    arch = "snake" if snake else bird or reptile
    fresh["species"][code] = {"kind": kind, "glb": f"client/assets/fauna/{code}.glb", "jobs": jobs or e.get("jobs", []),
                              "credits": e.get("credits", 0) + credits, "attempts": e.get("attempts", 0) + attempts,
                              "built": dt.date.today().isoformat(),
                              "build": {"snake": "tools/build_snake.py", "reptile": "tools/build_reptile.py", "bird": "tools/build_bird.py"}.get(kind, "tools/build_quadruped.py"),
                              "tile": e.get("tile", tile_id), **({"archetype": arch} if arch else {})}
    REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
    reg.setdefault("species", {}).update(fresh["species"])


def rebuild(tile_id: str, codes: list[str] | None = None) -> dict:
    """Every library model (or those named) rebuilt from the refine job it was built from, with today's build (no credits)."""
    out = {}
    for code, e in registry().get("species", {}).items():
        if codes and code not in codes:
            continue
        jobs = [ROOT / j for j in e.get("jobs", []) if (ROOT / j / "job.json").exists() and json.loads((ROOT / j / "job.json").read_text()).get("mode") == "refine"]
        ok, log = build(code, jobs[-1], tile_id, e.get("archetype") if e.get("kind") == "bird" else None,
                        e.get("archetype") if e.get("kind") == "reptile" else None, e.get("kind") == "snake") if jobs else (False, "no refine job")
        out[code] = ok
        print(f"{code}: {'rebuilt' if ok else 'FAILED: ' + log.splitlines()[-1] if log else 'FAILED'}", flush=True)
    return out


def recolour_library(tile_id: str, budget: int, reserve: int, codes: list[str] | None = None, dry: bool = False) -> dict:
    """The library's models checked against their described appearance; those that fail (or those named) re-refined once
    each within the budget and above the reserve, the better build kept, the registry and the tile's ledger updated."""
    reg = registry()
    place = place_name(tile_id)
    fauna = {}
    try:
        fauna = {s["code"]: s for s in json.loads((ROOT / "tiles" / tile_id / "client" / "fauna.json").read_text()).get("slots", [])}
    except (OSError, ValueError):
        pass
    led = {"tile": tile_id, "kind": "recolour", "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "budget": budget, "reserve": reserve, "species": []}
    spent = 0
    for code, e in reg.get("species", {}).items():
        if codes and code not in codes:
            continue
        c = colour_check(code)
        row = {"code": code, "check": {k: c.get(k) for k in ("ok", "score", "fails")}}
        led["species"].append(row)
        print(f"{code}: {'ok' if c.get('ok') else 'MISMATCH'} {c.get('score')} {'; '.join(c.get('fails') or [])}", flush=True)
        if c.get("ok") and not codes:
            continue
        jobs = [ROOT / j for j in e.get("jobs", []) if (ROOT / j / "job.json").exists()
                and json.loads((ROOT / j / "job.json").read_text()).get("mode") == "refine"]
        if not jobs:
            row["skipped"] = "no refine job"; continue
        kind, arch = e.get("kind"), e.get("archetype")
        slot = {**fauna.get(code, {}), "code": code}
        if kind == "bird":
            slot.setdefault("bird", True); slot["archetype"] = next((k for k, v in BIRD_BUILD.items() if v == arch), slot.get("archetype"))
        if kind == "reptile":
            slot.setdefault("reptile", True); slot["archetype"] = next((k for k, v in REPTILE_BUILD.items() if v == arch), slot.get("archetype"))
        if kind == "snake":
            slot.setdefault("reptile", "snake"); slot["archetype"] = "snake"
        _, tex = prompts(slot, place)
        if not c.get("ok"):   # what the check found wrong, named, ahead of the generic tail
            from .appearance import correction
            fix = correction(c, appearance(code) or {}, "tortoise" if arch == "tortoise" else None,
                             [(h.get("after") or {}).get("off") for h in e.get("recolour", []) if h.get("kept") == "old"])
            if fix:
                tex = _with_lead(_prompts(slot, place)[1], (_lead(code, arch) + " " + fix).strip())
        row["texture_prompt"] = tex
        if dry:
            print(f"[dry] {code}: re-refine {jobs[-1].name} with: {tex}"); continue
        bal = balance()
        if bal is None or bal - COST["refine"] < reserve or spent + COST["refine"] > budget:
            row["stopped"] = f"balance {bal}, spent {spent}: a re-refine would cross the reserve or the budget"; print(row["stopped"]); continue
        rec = recolour(code, tile_id, jobs[-1], tex, kind, arch, c)
        spent += rec["credits"]
        row["recolour"] = rec
        e = registry()["species"][code]   # re-read: the build may have run long
        hist = e.get("recolour", []) + [{k: rec.get(k) for k in ("at", "job", "credits", "before", "after", "kept", "error", "texture_prompt")}]
        reg2 = registry()
        reg2["species"][code] = {**e, "credits": e.get("credits", 0) + rec["credits"], "recolour": hist,
                                 "jobs": e.get("jobs", []) + ([rec["job"]] if rec.get("kept") == "new" else []),
                                 **({"built": dt.date.today().isoformat()} if rec.get("kept") == "new" else {}),
                                 "colour_check": rec.get("after") if rec.get("kept") == "new" else rec.get("before")}
        REGISTRY.write_text(json.dumps(reg2, indent=1) + "\n")
        print(f"{code}: re-refined ({rec.get('error') or 'kept the ' + rec['kept'] + ' build'}), "
              f"score {(rec.get('before') or {}).get('score')} -> {(rec.get('after') or {}).get('score')}", flush=True)
    led["spent"] = spent
    led["balance_after"] = None if dry else balance()
    if not dry:
        lp = ROOT / "tiles" / tile_id / "fauna" / "models_run.json"
        try:
            prev = json.loads(lp.read_text())
        except (OSError, ValueError):
            prev = None
        if prev:
            led["earlier"] = prev.pop("earlier", []) + [prev]
        lp.parent.mkdir(exist_ok=True)
        lp.write_text(json.dumps(led, indent=1) + "\n")
    return led


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
        snk = is_snake(s)
        bird = None if s.get("reptile") else s.get("build_archetype")
        rept = s.get("build_archetype") if s.get("reptile") and not snk else None
        row = {"code": code, "why": s["why"], "attempts": 0, "credits": 0, "jobs": [], "ok": model_for(code) is not None,
               **({"archetype": bird or rept or ("snake" if snk else None)} if bird or rept or snk else {})}
        ledger["species"].append(row)
        if row["ok"]:
            continue
        # the jobs already paid for, newest first: a build rule fixed since may make one of them pass at no cost
        for job in sorted(paid_refines(code), key=lambda d: d.stat().st_mtime, reverse=True):
            ok, log = build(code, job, tile_id, bird, rept, snk)
            if ok:
                row["ok"], row["build_log"], row["reused"] = True, log, str(job.relative_to(ROOT))
                register(reg, code, [str(job.relative_to(ROOT))], 0, 0, tile_id, bird, rept, snk)
                break
        if row["ok"]:
            print(f"{code}: modelled from a paid job, 0 credits", flush=True)
            continue
        mesh, tex = prompts(s, place)
        row["prompt"], row["texture_prompt"] = mesh, tex
        if dry:
            print(f"[dry] {code} ({s['why']}{', ' + (bird or rept or 'snake') if bird or rept or snk else ''}, {s.get('mass_kg')} kg): {mesh}\n      texture: {tex}")
            continue
        # a snake: the paid previews no refine was made from, newest first, ahead of new ones (each through the gate)
        unrefined = paid_previews(code) if snk else []
        for attempt in range(1, attempts + 1 + len(unrefined)):
            pv = unrefined.pop(0) if unrefined else None
            bal = balance()
            need = (0 if pv else COST["preview"]) + COST["refine"]
            if bal is None or bal - need < reserve or spent + need > budget:
                row["stopped"] = f"balance {bal}, spent {spent}: the next job would cross the reserve or the budget"
                break
            row["attempts"] = attempt
            if pv:
                row["jobs"].append({"mode": "preview", "dir": str(pv.relative_to(ROOT)), "reused": True})
            else:
                pv = _meshy("generate", "--species", code, "--mode", "preview", "--prompt", mesh, "--ai-model", "latest",
                            "--topology", "triangle", "--target-polycount", "30000", "--should-remesh", "true",
                            "--maintainer", "agent (Claude) for Aaron Brodeur, world pipeline")
                spent += COST["preview"]; row["credits"] += COST["preview"]
                if not pv:
                    row["jobs"].append({"mode": "preview", "ok": False}); continue
                row["jobs"].append({"mode": "preview", "dir": str(pv.relative_to(ROOT))})
            if snk:   # the gate: the build on the untextured preview, before the refine is paid
                ok, log = gate(code, pv, tile_id)
                row.setdefault("gate", []).append({"preview": str(pv.relative_to(ROOT)), "ok": ok, "log": log.splitlines()[-3:]})
                print(f"{code}: preview {pv.name} {'passes' if ok else 'fails'} the build's gate" + ("" if ok else f": {log.splitlines()[-1] if log else ''}"), flush=True)
                if not ok:
                    continue
            rf = _meshy("generate", "--species", code, "--mode", "refine", "--preview-job", str(pv), "--texture-prompt", tex,
                        "--maintainer", "agent (Claude) for Aaron Brodeur, world pipeline")
            spent += COST["refine"]; row["credits"] += COST["refine"]
            row["jobs"].append({"mode": "refine", "dir": str(rf.relative_to(ROOT)) if rf else None})
            if not rf:
                continue
            ok, log = build(code, rf, tile_id, bird, rept, snk)
            row["build_log"] = log
            if ok:
                row["ok"] = True
                c = colour_check(code)
                row["colour_check"] = {k: c.get(k) for k in ("ok", "score", "fails")}
                bal = balance()
                if not c.get("ok") and bal is not None and bal - COST["refine"] >= reserve and spent + COST["refine"] <= budget:
                    from .appearance import correction
                    fix = correction(c, appearance(code) or {}, "tortoise" if rept == "tortoise" else None)
                    tex2 = _with_lead(_prompts(s, place)[1], (_lead(code, rept) + " " + fix).strip()) if fix else tex
                    rec = recolour(code, tile_id, rf, tex2, "bird" if bird else "reptile" if rept else "snake" if snk else None,
                                   bird or rept or ("snake" if snk else None), c)
                    spent += rec["credits"]; row["credits"] += rec["credits"]; row["recolour"] = rec
                    if rec.get("kept") == "new":
                        row["jobs"].append({"mode": "refine", "dir": rec["job"]})
                        row["colour_check"] = rec["after"]
                register(reg, code, [j["dir"] for j in row["jobs"] if j.get("dir")], row["credits"], attempt, tile_id, bird, rept, snk)
                fresh = registry()   # (merged into a fresh read, as register)
                fresh["species"][code]["colour_check"] = reg["species"][code]["colour_check"] = row["colour_check"]
                REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
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
    ap.add_argument("--kind", choices=("all", "mammals", "birds", "reptiles", "snakes"), default="all", help="model only the mammals, birds, reptiles or snakes")
    ap.add_argument("--rebuild", action="store_true", help="rebuild every library model from its job (no credits), then stop")
    ap.add_argument("--check", action="store_true", help="check the library models' colours against their described appearance, then stop")
    ap.add_argument("--recolour", action="store_true", help="re-refine (10 credits each) the library models whose colours fail the check, then stop")
    ap.add_argument("--codes", default="", help="comma-separated species codes for --rebuild, --check or --recolour (--recolour re-refines these even if they pass)")
    a = ap.parse_args()
    codes = [c.strip() for c in a.codes.split(",") if c.strip()] or None
    if a.rebuild:
        rebuild(a.tile, codes); return
    if a.check:
        for code in (codes or list(registry().get("species", {}))):
            c = colour_check(code)
            print(f"{code}: {'ok' if c.get('ok') else 'MISMATCH'} score {c.get('score')} {'; '.join(c.get('fails') or [])}")
        return
    if a.recolour:
        led = recolour_library(a.tile, a.budget, a.reserve, codes, a.dry_run)
        print(json.dumps({k: led[k] for k in ("spent", "balance_after")})); return
    led = run(a.tile, a.budget, a.reserve, a.max, a.dry_run, a.kind, a.attempts)
    print(json.dumps({k: led[k] for k in ("spent", "balance_after", "modelled")}))


if __name__ == "__main__":
    main()
