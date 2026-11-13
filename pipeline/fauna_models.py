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
  pose      a four-legged animal's preview is measured before its refine is paid (pipeline/pose_gate.py, 2026-11-12:
            the head's turn, the spine's bend, each foot pair's stagger, four feet down): a preview that does not stand
            square is a failed attempt (20 credits, not 30, and no turned head built into a model), and so is one
            the build cannot use or whose shape is not the described one (shape_gate: the build run on the untextured
            preview, the tail and the horns measured against the description); a model whose shape fails after the
            refine is not given another texture. A turned head
            alone is not one: it is set straight in the mesh the model is built from (pipeline/straighten.py: the neck
            and head's centreline seen from above unbent onto the trunk's line; the job's model.glb is kept and
            model_straight.glb written beside it), and the gate measures that mesh;
  check     the built model's colours against the described appearance (pipeline/appearance.py check): a mismatch is
            re-refined once from the same preview (10 credits, the mesh kept) and the better of the two is kept;
            --recolour does the same for the library's models (--codes to name them, else every one that fails);
  likeness  a four-legged model against photographs of its species (pipeline/likeness.py, 2026-11-12): recognised when
            its own species' photos are the nearest of every species' in the reference store, as a learned eye sees
            them, and it is as near them as nine in ten of them are to each other. A coat can wear every described
            colour and still be another animal's (the generated coyote read as a black-backed jackal); a model that
            fails is re-refined once with the species' most typical photo as the texture reference (10 credits) and
            the better of the two kept;
  photo     the second rung (2026-11-06, iteration 7): a species whose text model fails (the judge's verdict in
            models.json, the feature check's geometry: horns, tail length; or the build's leg gate after its two previews)
            is tried once from its reference photo (pipeline/reference_photos.py): Meshy's image-to-3D from the photo cropped
            to the animal (30 credits; the quadruped build turns it side-on by its feet and body), rebuilt and checked;
            a texture failure (colours, a ringed tail, a pale patch) is first re-refined from the text with the check's
            correction (as before), then once with the photo as the refine's texture reference (10). A snake's second rung
            is always the texture reference (its pose comes from the prompt). The photo and its attribution (licence,
            author, page) go into the job's folder (reference.jpg / reference.json) and into models.json. --redo runs it
            for the species named; the judge records its verdict on the new model with --judge;
  accept    the acceptance rule (iteration 10; acceptance(), the section "model acceptance as a rule"): built, the build's
            gate, the appearance check with the thresholds fitted to the recorded verdicts, and the likeness; a recorded verdict (an
            override, the judge's) overrides it as an explicit stage, the rule's decision kept beside it; model_for
            serves by it; recorded in models.json `acceptance` on every register, rebuild, re-texture and verdict;
  record    library/animals/models.json: per species the GLB, the jobs, credits spent, attempts; and the run's ledger
            (credits by species, retries, modelled vs stand-in) in the tile's fauna/models_run.json.

Credits are spent only from this command, never from a tile build:

  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --budget 800 [--reserve 300] [--max 12] [--kind birds] [--dry-run]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --budget 50 --codes a,b [--dry-run]   # only the species named (a slot, or a four-legged species' trait card)
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --check [--codes a,b]           # the colour check, no credits
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --recolour --budget 60 [--codes a,b] [--reserve 1450]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --rebuild [--codes a,b]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --redo --codes a,b --budget 120 [--reserve 737] [--dry-run]
  arch -arm64 .venv/bin/python -m pipeline.fauna_models <tile> --judge <code> --verdict accepted|rejected --why "..."
  arch -arm64 .venv/bin/python -m pipeline.fauna_models --accept [--codes a,b] [--regate]   # the rule on every model, no credits
  arch -arm64 .venv/bin/python -m pipeline.fauna_models --fit-accept                       # the rule against the recorded verdicts

The balance is read before every job; nothing is submitted that would take it under the reserve.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
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
COST = {"preview": 20, "refine": 10, "image": 30}
PREDATOR_KG = 15.0
# A bird slot's archetype (pipeline/fauna_slots.py kin_for) -> the build's (tools/build_bird.py --archetype): the client
# template its kin is drawn with. The corvids' kin (the raven) is drawn by two models, a standing one and a procedural
# flier (animals.js DRAWN hybrid), which a fauna model does not replace: none (the corvid and the walking corvid). A
# shorebird stands on the heron's template (its kin).
BIRD_BUILD = {"soaring scavenger": "soar", "soaring raptor": "soar", "gull": "soar", "wading bird": "wade", "shorebird": "wade", "waterbird": "water",
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
    if not e or not (ASSETS / f"{code}.glb").exists():
        return None
    # the acceptance rule (iteration 10, acceptance below): a model is drawn when the rule accepts it (built, the build's
    # gate, the fitted appearance check), unless a recorded verdict overrides the rule (an `override`, the judge's verdict
    # on this model, a `verdicts` entry): a model that fails its species (a mountain goat with an ibex's horns, a badger
    # with a raccoon's ringed tail) is not drawn; the slot keeps its stand-in and the paid job stays for the next rung
    if not served_by_rule(code, e):
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
    if quadruped(slot, _traits(slot["code"])):   # the described horns and tail in the mesh prompt (iteration 7)
        from .appearance import feature_lead
        lead = feature_lead(appearance(slot["code"]))
        if lead and len(mesh) + len(lead) + 1 <= 800:
            mesh = mesh.replace(" No base,", f" {lead} No base,", 1)
            # a tail described short is not asked to hang (2026-11-12: the bobcat's prompt said "tail hanging free" and
            # then "Tail short, about 15 cm", and its preview came with a long hanging tail)
            if "Tail short" in lead:
                mesh = mesh.replace("tail hanging free clear of the legs", "the short tail a stub, held clear of the legs", 1)
    return mesh, _with_lead(tex, _lead(slot["code"], reptile_build(slot)))


def _prompts(slot: dict, place: str) -> tuple[str, str]:
    t = _traits(slot["code"])
    common = (slot.get("common") or t.get("common") or slot["code"]).strip()
    sci = slot.get("scientific") or t.get("scientific") or slot["code"].replace("_", " ").capitalize()
    if is_snake(slot):
        # the pose the snake build needs: the whole body on the ground, stretched out in one gentle S (the build traces it
        # as a tube and straightens it; the client bends it), no coil or loop (a body lying on itself fuses in the remesh),
        # the head at one end and the tail tapering at the other. No sizes (the build sizes by mass).
        # (2026-11-06: a terciopelo's preview came back short and thick in tight bends, 9.9 diameters long, under the build's
        # slender gate of 10; every snake is asked for a long slender body, 15 diameters or more, loosely curved)
        mesh = (f"A wild {common} ({sci}) of {place}, one adult snake, realistic anatomy and proportions. A long, slender "
                "body, at least fifteen times as long as it is thick. Lying flat on the ground, the whole body stretched "
                "out long in one loose, open S-curve with wide bends, no tight bends, no coils, no loops, no part of the "
                "body touching or crossing another, the head resting on the ground at one end looking forward along the "
                "body, mouth closed, no tongue, the tail tapering to a thin tip at the other end. No base, no ground plane, "
                "no rocks, no branches, no props. Game-ready.")
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
        # a four-legged animal is built from its job's mesh with a turned head set straight (pipeline/straighten.py)
        [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / "build_quadruped.py"), "--", str(straight_source(job)), str(out), "--species", code],
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


def straight_source(job: Path) -> Path:
    """The mesh a four-legged model is built from: the job's model.glb, or the copy beside it with a turned head set
    straight (pipeline/straighten.py source; made once, recorded in the job's straighten.json). A model.glb given by
    path is taken as it is when it is not a job's."""
    from . import straighten
    job = Path(job)
    if job.is_file() and job.name != "model.glb":
        return job
    return straighten.source(job)


def pose_check(job: Path) -> dict:
    """The pose gate (pipeline/pose_gate.py) on the mesh a job's model would be built from, a turned head set straight
    first (straight_source): {ok, why, head_turn, spine_bend, stagger_fore, stagger_hind, feet, straightened: the turn
    found and taken out, or None}; a mesh that cannot be read fails."""
    from . import pose_gate, straighten
    try:
        src = straight_source(job)
        g = pose_gate.gate(src)
        rec = straighten.record(job) or {}
    except Exception as ex:   # an unreadable mesh is no animal standing square
        return {"ok": False, "why": [f"the mesh could not be measured ({type(ex).__name__}: {str(ex)[:80]})"]}
    out = {k: g.get(k) for k in ("ok", "why", "head_turn", "spine_bend", "stagger_fore", "stagger_hind", "feet")}
    out["straightened"] = (rec.get("before") or {}).get("head_turn") if rec.get("out") else None
    if not rec.get("ok", True) and not g["ok"]:
        out["why"] = list(out["why"]) + [w for w in rec.get("why", []) if w not in out["why"]]
    return out


def likeness_check(code: str, tile_id: str | None = None, fetch: bool = False) -> dict:
    """A four-legged model's likeness to photographs of its species (pipeline/likeness.py likeness): {ok, why, seen,
    recognition, coat}; ok None when it cannot be judged (not four-legged, no reference photos, the embedding network
    not on disk). fetch: find the species' photos and fetch the network when they are missing (a paid run does; the
    acceptance rule, run offline and in the tests, does not)."""
    from . import likeness as lk
    from . import reference_photos as rp
    e = registry().get("species", {}).get(code) or {}
    if e.get("kind", "quadruped") != "quadruped":
        return {"ok": None, "why": ["not a four-legged model"]}
    try:
        if fetch and not (rp.STORE / f"{code}.json").exists():
            rp.find(code, tile=tile_id, log=lambda *_: None)
        if not (rp.STORE / f"{code}.json").exists():
            return {"ok": None, "why": ["no reference photos of the species in the store"]}
        if not fetch and not lk.ready():
            return {"ok": None, "why": ["the embedding network is not on disk (a paid run fetches it)"]}
        return lk.likeness(code)
    except Exception as ex:   # a store without its cached photos, an unreadable source: not judged, never a crash in the rule
        return {"ok": None, "why": [f"not judged ({type(ex).__name__}: {str(ex)[:80]})"]}


def _likeness_brief(r: dict) -> dict:
    rec = r.get("recognition") or {}
    return {"ok": r.get("ok"), "why": r.get("why") or [], **{k: rec.get(k) for k in ("own", "floor", "rival", "rival_nearness", "margin", "photos", "of") if k in rec},
            **({"coat": [o["words"] for o in ((r.get("coat") or {}).get("off") or [])[:4]]} if (r.get("coat") or {}).get("off") else {}),
            **({"seen": r["seen"]} if r.get("seen") else {})}


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
    """The species' paid textured jobs (text-to-3D refines and textured image-to-3D jobs) with a model."""
    out = []
    for j in (ROOT / "library" / "animals" / "jobs" / code).glob("*/job.json"):
        try:
            d = json.loads(j.read_text())
        except (OSError, ValueError):
            continue
        if d.get("mode") in ("refine", "image") and d.get("status") == "SUCCEEDED" and (j.parent / "model.glb").exists():
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


def shape_gate(code: str, preview: Path, tile_id: str) -> dict:
    """A four-legged animal's preview, built untextured to a scratch file, and the described shape measured on it
    (pipeline/appearance.py feature_check's geometry: the tail against the head and body, the horns against the withers):
    {ok, why}. Before the refine is paid (2026-11-12: the bobcat's preview had a long tail, 0.43 of the head and body
    where 0.17 is described; the refine, a re-refine for its markings and one from a photo, 30 credits, could not
    shorten it). Over the library's 30 text previews it refuses three, the bobcat's and the mountain goat's two with an
    ibex's horns, none of them behind a model that is served, and finds one the build cannot use."""
    import tempfile
    from .appearance import feature_check
    with tempfile.TemporaryDirectory(prefix=f"gate_{code}_") as d:
        out = Path(d) / f"{code}.glb"
        ok, log = build(code, preview, tile_id, out=out)
        if not ok:
            return {"ok": False, "why": ["the build cannot use the mesh" + (": " + log.splitlines()[-1][:160] if log.strip() else "")]}
        app = appearance(code)
        geo = list(feature_check(out, app).get("geometry") or []) if app else []
    return {"ok": not geo, "why": geo}


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
                              "tile": e.get("tile", tile_id), **({"archetype": arch} if arch else {}),
                              # the recorded verdicts and overrides name their models: they stay with the species
                              **{k: e[k] for k in ("verdicts", "override") if e.get(k)}}
    REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
    reg.setdefault("species", {}).update(fresh["species"])
    record_acceptance(code)
    reg["species"][code] = registry()["species"][code]


# The procedural snake (2026-11-07, the snake lane; docs/animal-library.md "Snakes built procedurally"): every snake is
# first built with no source mesh and no credits (tools/build_snake_proc.py: its size from its mass, its shape from its
# family, its pattern unrolled from its texture photo) and judged by the acceptance rule's check as any model. It is
# served when it passes and the species has no model that passes, or one that scores no better; else the model the
# species has stays and the procedural one is recorded beside it (`procedural`: its check, whether it was served and why).
PROC_DIR = ROOT / "library" / "animals" / "procedural"
# a model that replaces a served one must keep its pattern: the spread of lightness over its back and flanks (pattern
# contrast, below) at least this share of the served model's (2026-11-07: a garter snake unrolled from a pale photo matched
# the described colours better than the Meshy model and lost the stripes that make it a garter snake)
PATTERN_KEEP = 0.8


def pattern_contrast(glb: Path) -> float:
    """The area-weighted spread (standard deviation) of CIELAB lightness over a model's upperparts and flanks faces."""
    import numpy as np
    from .appearance import model_regions
    reg = model_regions(glb)
    L = np.concatenate([reg[r][0][:, 0] for r in ("upperparts", "flanks") if r in reg] or [np.zeros(1)])
    A = np.concatenate([reg[r][1] for r in ("upperparts", "flanks") if r in reg] or [np.ones(1)])
    m = float((L * A).sum() / max(A.sum(), 1e-12))
    return round(float(np.sqrt(((L - m) ** 2 * A).sum() / max(A.sum(), 1e-12))), 2)


def procedural_snake(code: str, tile_id: str | None = None) -> dict:
    from .appearance import check
    PROC_DIR.mkdir(parents=True, exist_ok=True)
    out = PROC_DIR / f"{code}.glb"
    r = subprocess.run(PY + [str(ROOT / "tools" / "build_snake_proc.py"), code, str(out)], cwd=ROOT, capture_output=True, text=True)
    rec = {"at": dt.date.today().isoformat(), "build": "tools/build_snake_proc.py", "glb": _rel(out) if out.exists() else None}
    if r.returncode or not out.exists():
        rec.update({"ok": False, "served": False, "why": "the build failed: " + ((r.stderr or r.stdout).strip().splitlines() or ["?"])[-1][:300]})
        return _record_procedural(code, rec, tile_id)
    app = appearance(code) or {}
    params = fitted_params()
    c = check(out, app, params) if app.get("regions") else {"ok": True, "score": None, "fails": []}
    rec["check"] = {k: c.get(k) for k in ("ok", "score", "fails")}
    rec["pattern_contrast"] = pattern_contrast(out)
    e = registry().get("species", {}).get(code) or {}
    cur = ASSETS / f"{code}.glb"
    cur_proc = e.get("build") == "tools/build_snake_proc.py"
    cur_ok, cur_score, cur_pat = False, None, None
    if cur.exists() and e and not cur_proc:
        a = acceptance(code, e, params)
        cur_ok = a["rule"]["decision"] == "accepted"
        cur_score = ((a["rule"]["stages"].get("check") or {}).get("score"))
        cur_pat = pattern_contrast(cur); rec["served_pattern_contrast"] = cur_pat
    if not c.get("ok"):
        rec.update({"served": False, "why": "the procedural model fails the check: " + "; ".join(c.get("fails") or [])
                    + (f"; the model served (check {cur_score}) stays" if cur_ok else "")})
    elif cur_ok and cur_score is not None and (c.get("score") or 0) < cur_score:
        rec.update({"served": False, "why": f"both pass the check; the model served scores {cur_score}, the procedural one {c.get('score')}: the served one stays"})
    elif cur_ok and cur_pat and rec["pattern_contrast"] < PATTERN_KEEP * cur_pat:
        rec.update({"served": False, "why": f"both pass the check (procedural {c.get('score')}, served {cur_score}), but the procedural model keeps "
                    f"{rec['pattern_contrast']} of lightness spread over its back and flanks against the served model's {cur_pat} (under {PATTERN_KEEP:g} of it): "
                    "its pattern reads weaker, the served one stays"})
    else:
        rec.update({"served": True, "why": "the procedural model passes the check" + (f" and scores {c.get('score')} against the served model's {cur_score}, its pattern contrast {rec['pattern_contrast']} against {cur_pat}" if cur_ok
                    else "; the species had no model that passes" if not cur_proc else "; it replaces the earlier procedural build")})
        if cur.exists() and not cur_proc:   # the replaced model kept beside its job (rebuildable from it too)
            shutil.copy2(cur, PROC_DIR / f"{code}.replaced.glb")
        shutil.copy2(out, cur)
        x = json.loads(out.read_bytes()[20:20 + int.from_bytes(out.read_bytes()[12:16], "little")]).get("extras", {})
        fresh = registry()
        old = fresh.setdefault("species", {}).get(code) or {}
        fresh["species"][code] = {**{k: old[k] for k in ("verdicts", "override", "jobs", "credits", "attempts", "photo") if old.get(k)},
                                  "kind": "snake", "archetype": "snake", "glb": f"client/assets/fauna/{code}.glb", "build": "tools/build_snake_proc.py",
                                  "served_by": "rule",   # (no one's verdict: appearance.known_verdicts leaves it out of the rule's fit)
                                  "built": rec["at"], "tile": old.get("tile", tile_id), "reference": x.get("reference"),
                                  "colour_check": rec["check"]}
        REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
    return _record_procedural(code, rec, tile_id)


def _record_procedural(code: str, rec: dict, tile_id: str | None) -> dict:
    fresh = registry()
    e = fresh.setdefault("species", {}).get(code)
    if e is None:
        fresh["species"][code] = e = {"kind": "snake", "archetype": "snake", "tile": tile_id}
    e["procedural"] = rec
    REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
    if rec.get("served"):
        record_acceptance(code)
    print(f"{code}: procedural snake {'served' if rec.get('served') else 'not served'}: {rec.get('why')}", flush=True)
    return rec


def rebuild(tile_id: str, codes: list[str] | None = None) -> dict:
    """Every library model (or those named) rebuilt from the refine job it was built from, with today's build (no credits)."""
    out = {}
    for code, e in registry().get("species", {}).items():
        if codes and code not in codes:
            continue
        jobs = [ROOT / j for j in e.get("jobs", []) if (ROOT / j / "job.json").exists() and json.loads((ROOT / j / "job.json").read_text()).get("mode") in ("refine", "image")]
        ok, log = build(code, jobs[-1], tile_id, e.get("archetype") if e.get("kind") == "bird" else None,
                        e.get("archetype") if e.get("kind") == "reptile" else None, e.get("kind") == "snake") if jobs else (False, "no refine job")
        out[code] = ok
        if ok:
            record_acceptance(code)
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
        record_acceptance(code)
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


def _kind_arch(code: str, slot: dict | None = None) -> tuple[str, str | None]:
    """(kind, build archetype) of a species: its registry entry, else its tile slot."""
    e = registry().get("species", {}).get(code) or {}
    if e.get("kind"):
        return e["kind"], e.get("archetype")
    s = slot or {}
    if is_snake(s):
        return "snake", "snake"
    if reptile_build(s):
        return "reptile", reptile_build(s)
    if bird_build(s):
        return "bird", bird_build(s)
    return "quadruped", None


def _preview_of(job: Path) -> Path | None:
    try:
        pj = json.loads((job / "job.json").read_text()).get("preview_job")
    except (OSError, ValueError):
        return None
    return ROOT / pj if pj and (ROOT / pj / "job.json").exists() else None


def photo_rung(code: str, tile_id: str, mode: str, slot: dict | None = None) -> dict:
    """The second rung (module docstring): mode 'image' (image-to-3D from the reference photo, 30 credits) or 'texture'
    (the latest preview re-refined with the photo as the texture reference, 10). Builds and checks the result; keeps it
    when the species had no drawable model, or it fails fewer checks than the model it replaces (then a better score).
    Returns the record (credits, job, check before and after, kept, reference)."""
    import shutil
    import tempfile
    from . import reference_photos as rp
    kind, arch = _kind_arch(code, slot)
    rec = {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "rung": "photo", "mode": mode, "credits": 0}
    used = {(h.get("reference") or {}).get("id") for h in (registry().get("species", {}).get(code) or {}).get("photo", [])}
    prefer = None
    if mode == "texture" and kind == "quadruped":   # the coat to copy is the species' most usual one (likeness.typical)
        try:
            from . import likeness as lk
            prefer = lk.typical(code) if lk.ready() else None
        except Exception:
            prefer = None
    refs = rp.ranked(code, skip=used, n=1, use="image" if mode == "image" else "texture", prefer=prefer)
    ref = refs[0] if refs else None
    if not ref or not ref.get("file_crop"):
        rec["error"] = "no reference photo left"; return rec
    rec["reference"] = rp.attribution(ref)
    img = ROOT / ref["file_crop"]
    have = (ASSETS / f"{code}.glb").exists()
    before = colour_check(code) if have else {"ok": False, "score": None, "fails": ["no model"]}
    rec["before"] = {k: before.get(k) for k in ("ok", "score", "fails")}
    like_before = likeness_check(code) if have and kind == "quadruped" else {"ok": None}
    maint = "agent (Claude) for Aaron Brodeur, world pipeline"
    if mode == "image":
        job = _meshy("generate", "--species", code, "--mode", "image", "--image", str(img), "--ai-model", "latest",
                     "--topology", "triangle", "--target-polycount", "30000", "--should-remesh", "true", "--maintainer", maint)
        rec["credits"] = COST["image"]
    else:
        refines = sorted(paid_refines(code), key=lambda d: d.stat().st_mtime, reverse=True)
        pv = next((p for p in (_preview_of(r) for r in refines) if p), None) or next(iter(paid_previews(code)), None)
        if not pv:
            rec["error"] = "no preview to re-texture"; return rec
        job = _meshy("generate", "--species", code, "--mode", "refine", "--preview-job", str(pv), "--texture-image", str(img),
                     "--maintainer", maint)
        rec["credits"] = COST["refine"]
    if not job:
        rec["error"] = "Meshy job failed"; return rec
    rec["job"] = str(job.relative_to(ROOT))
    # the photo and its attribution beside the job's record (the photo's licence binds the model made from it)
    shutil.copy2(img, job / "reference.png")
    (job / "reference.json").write_text(json.dumps({**rec["reference"], "file": "reference.png",
                                                    "cropped_from": ref.get("file_large"), "used_as": "image-to-3D input" if mode == "image" else "refine texture reference",
                                                    "rule": "pipeline/reference_photos.py", "score": ref.get("score")}, indent=1) + "\n")
    keep = Path(tempfile.mkdtemp(prefix=f"photo_{code}_"))
    for f in _model_files(code):
        shutil.copy2(f, keep / f.name)
    ok, log = build(code, job, tile_id, arch if kind == "bird" else None, arch if kind == "reptile" else None, kind == "snake")
    rec["build_log"] = log.splitlines()[-4:]
    after = colour_check(code) if ok else {"ok": False, "score": None, "fails": ["build failed: " + (log.splitlines()[-1] if log else "")]}
    rec["after"] = {k: after.get(k) for k in ("ok", "score", "fails")}
    rec["after"]["features"] = (after.get("features") or {}).get("measured")
    nf = lambda c: len(c.get("fails") or [])
    judged_out = ((registry().get("species", {}).get(code) or {}).get("judge") or {}).get("verdict") == "rejected"
    better = ok and (not have or judged_out or after.get("ok") or nf(after) < nf(before) or
                     (nf(after) == nf(before) and (after.get("score") or 0) > (before.get("score") or 0)))
    # the likeness decides first where it was judged on both: a model its species' photos do not recognise is replaced
    # by one they do, and one they recognise is never replaced by one they do not
    like_after = likeness_check(code) if ok and kind == "quadruped" else {"ok": None}
    if like_before.get("ok") is not None and like_after.get("ok") is not None:
        rec["likeness"] = {"before": _likeness_brief(like_before), "after": _likeness_brief(like_after)}
        if like_after["ok"] != like_before["ok"]:
            better = bool(like_after["ok"])
        elif not like_after["ok"]:   # neither recognised: the nearer its own species against its rival
            better = ((like_after.get("recognition") or {}).get("margin") or -9) > ((like_before.get("recognition") or {}).get("margin") or -9)
    rec["kept"] = "new" if better else "old"
    if not better:
        for f in _model_files(code):
            f.unlink()
        for f in keep.iterdir():
            shutil.copy2(f, ASSETS / f.name)
    shutil.rmtree(keep, ignore_errors=True)
    # the registry: the new jobs, the credits, the reference; the judge's verdict stays until the judge looks again
    reg = registry()
    e = reg.setdefault("species", {}).get(code) or {}
    build_by = {"snake": "tools/build_snake.py", "reptile": "tools/build_reptile.py", "bird": "tools/build_bird.py"}.get(kind, "tools/build_quadruped.py")
    e = {**e, "kind": kind, "glb": f"client/assets/fauna/{code}.glb", "build": build_by, "tile": e.get("tile", tile_id),
         **({"archetype": arch} if arch else {}),
         "credits": e.get("credits", 0) + rec["credits"], "attempts": e.get("attempts", 0) + 1,
         "photo": e.get("photo", []) + [{k: rec.get(k) for k in ("at", "mode", "job", "credits", "before", "after", "kept", "reference", "error")}]}
    if better:
        e["jobs"] = e.get("jobs", []) + [rec["job"]]
        e["built"] = dt.date.today().isoformat()
        e["colour_check"] = {k: after.get(k) for k in ("ok", "score", "fails")}
        e["reference"] = rec["reference"]
        if e.get("judge"):
            e["judge"] = {**e["judge"], "stale": f"the model was rebuilt from {rec['job']} on {e['built']}; the judge has not looked again"}
    reg["species"][code] = e
    REGISTRY.write_text(json.dumps(reg, indent=1) + "\n")
    record_acceptance(code)
    return rec


def diagnose(code: str) -> tuple[str | None, str]:
    """What a species' model needs (the --redo rule): the acceptance rule's `due` (iteration 10): ('image', why) for a
    geometry failure (the gate, horns, tail length) or a mesh to remake from the rule's photo, ('texture', why) for
    colours and coat features; a recorded rejection the rule does not see (an override) asks for a new mesh (a snake's,
    a new texture); (None, 'passes') otherwise."""
    e = registry().get("species", {}).get(code) or {}
    have = (ASSETS / f"{code}.glb").exists() and e
    if not have:
        return "image", "no model (the build's gate refused the text previews)"
    a = acceptance(code, e)
    d = a.get("due")
    if d:
        return ("texture" if d["job"].startswith("refine") else "image"), d["why"]
    ov = a.get("override")
    if ov and not ov["serve"]:
        return ("texture" if e.get("kind") == "snake" else "image"), f"the {ov['source']}: " + (ov.get("why") or "")
    return None, "passes"


def redo(tile_id: str, codes: list[str], budget: int, reserve: int, dry: bool = False) -> dict:
    """The second rung for the species named, in order, within the budget and above the reserve (module docstring)."""
    place = place_name(tile_id)
    fauna = {}
    try:
        fauna = {s["code"]: s for s in json.loads((ROOT / "tiles" / tile_id / "client" / "fauna.json").read_text()).get("slots", [])}
    except (OSError, ValueError):
        pass
    led = {"tile": tile_id, "kind": "redo", "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "budget": budget, "reserve": reserve, "species": []}
    spent = 0
    for code in codes:
        need, why = diagnose(code)
        e = registry().get("species", {}).get(code) or {}
        row = {"code": code, "need": need, "why": why, "steps": []}
        led["species"].append(row)
        print(f"{code}: {need or 'nothing'} ({why})", flush=True)
        if not need:
            continue
        kind, arch = _kind_arch(code, fauna.get(code))
        steps = []
        if need == "texture":
            # the text re-refine with the check's correction first, unless one was made with this very prompt
            slot = {**fauna.get(code, {}), "code": code}
            if kind == "snake":
                slot.setdefault("reptile", "snake"); slot["archetype"] = "snake"
            c = colour_check(code)
            from .appearance import correction
            fix = correction(c, appearance(code) or {}, "tortoise" if arch == "tortoise" else None)
            tex = _with_lead(_prompts(slot, place)[1], (_lead(code, arch) + " " + fix).strip())
            tried = {h.get("texture_prompt") for h in e.get("recolour", [])} | {
                json.loads((ROOT / j / "job.json").read_text()).get("prompt") for j in e.get("jobs", []) if (ROOT / j / "job.json").exists()}
            if tex not in tried:
                steps.append(("text", tex))
            steps.append(("photo", "texture"))
        else:
            steps.append(("photo", "image"))
            # a mesh from a photo that the build's gate refuses (a stride copied from the photo) earns one more photo, as a
            # text preview does; the photo rung is otherwise tried once
            steps.append(("photo", "image-retry"))
        tries = [h for h in e.get("photo", []) if h.get("credits")]
        if any(h.get("kept") == "new" or not str((h.get("after") or {}).get("fails") or "").count("build failed") for h in tries) or len(tries) >= 2:
            steps = [s for s in steps if s[0] != "photo"]
        elif tries:
            steps = [s for s in steps if s[1] != "image"]
        for kind_step, arg in steps:
            cost = COST["refine"] if (kind_step == "text" or arg == "texture") else COST["image"]
            if dry:
                row["steps"].append({"step": kind_step, "arg": arg[:200], "cost": cost}); print(f"  [dry] {kind_step} {arg[:160]} ({cost})"); continue
            bal = balance()
            if bal is None or bal - cost < reserve or spent + cost > budget:
                row["stopped"] = f"balance {bal}, spent {spent}: the next job ({cost}) would cross the reserve or the budget"
                print("  " + row["stopped"]); break
            if kind_step == "text":
                refines = sorted((r for r in paid_refines(code) if _preview_of(r)), key=lambda d: d.stat().st_mtime, reverse=True)
                rec = recolour(code, tile_id, refines[0], arg, kind, arch, colour_check(code))
                hist = registry()["species"][code]
                reg2 = registry()
                reg2["species"][code] = {**hist, "credits": hist.get("credits", 0) + rec["credits"],
                                         "recolour": hist.get("recolour", []) + [{k: rec.get(k) for k in ("at", "job", "credits", "before", "after", "kept", "error", "texture_prompt")}],
                                         "jobs": hist.get("jobs", []) + ([rec["job"]] if rec.get("kept") == "new" else []),
                                         **({"built": dt.date.today().isoformat(), "colour_check": rec["after"]} if rec.get("kept") == "new" else {})}
                if rec.get("kept") == "new" and reg2["species"][code].get("judge"):
                    reg2["species"][code]["judge"] = {**reg2["species"][code]["judge"], "stale": f"re-textured from {rec['job']}; the judge has not looked again"}
                REGISTRY.write_text(json.dumps(reg2, indent=1) + "\n")
                record_acceptance(code)
            else:
                if arg == "image-retry" and not any("build failed" in str(f) for f in (row["steps"][-1].get("after") or {}).get("fails") or []) \
                        if row["steps"] else False:
                    break   # the first photo's mesh was built: no second
                rec = photo_rung(code, tile_id, "image" if arg.startswith("image") else arg, fauna.get(code))
            spent += rec.get("credits", 0)
            row["steps"].append({"step": kind_step, **{k: rec.get(k) for k in ("mode", "job", "credits", "before", "after", "kept", "error")}})
            print(f"  {kind_step}: {rec.get('error') or 'kept the ' + str(rec.get('kept')) + ' model'}; after {(rec.get('after') or {}).get('fails')}", flush=True)
            if (rec.get("after") or {}).get("ok") and rec.get("kept") == "new":
                break
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


def judge(code: str, verdict: str, why: str) -> None:
    """The judge's verdict on a species' current model (rendered and compared with its description): 'rejected' keeps
    it off every tile (model_for), 'accepted' lets it be drawn."""
    reg = registry()
    e = reg["species"][code]
    prev = e.get("judge")
    e["judge"] = {"verdict": verdict, "why": why, "by": "the judge (Claude, from the model's render against the species' description)",
                  "date": dt.date.today().isoformat(), "model": (e.get("jobs") or [None])[-1]}
    if prev and prev.get("verdict") != verdict:
        e.setdefault("judge_history", []).append(prev)
    REGISTRY.write_text(json.dumps(reg, indent=1) + "\n")
    record_acceptance(code)


# ---- model acceptance as a rule (iteration 10) ----
# Every model goes through one decision, written down here and recorded in models.json `acceptance` when the model is
# registered, rebuilt, re-textured or judged, and re-run with --accept:
#   model       the GLB is in the library (and a skinned quadruped's gait clips), built from a job of the species
#               (extras.meshy_task);
#   gate        the build's gate passes on that job: the GLB exists only if the build's gate passed when it was built;
#               --accept --regate builds the job again with today's build tool to a scratch file (no credits) and records
#               the result in `gate`, which then decides;
#   check       the appearance check (pipeline/appearance.py check: the described colours by region, the defining
#               features: horns, tail, rings, a pale patch) with the thresholds fitted to the recorded verdicts
#               (library/animals/check_fit.json params);
#   likeness    a four-legged model whose species has reference photos in the store (2026-11-12, pipeline/likeness.py):
#               its own species' photos are the nearest of every species' and it reaches their own floor; not judged
#               (and so passing) where there are no photos or the embedding network is not on disk;
#   provenance  recorded, not deciding: the rung the model came from (text, or a photo used as image-to-3D input or as a
#               refine's texture reference) and whether today's photo rule (reference_photos.usable_for) still takes
#               that photo for that use. Measured on the 39 recorded verdicts (fit_acceptance) it decides nothing for a
#               reason: the one rejected model it would catch (the near-black grizzly) was made from a photo refused for
#               its stance, which cannot bind a texture, and it would refuse the accepted pronghorn, whose image-to-3D
#               mesh passed the gate and the check from a photo refused because grass hides the legs. The gate and the
#               check judge the product; the photo rule judges which photo to try next (`due`).
# The rule's decision is accepted when model, gate, check and likeness pass. A recorded verdict stays as an explicit override
# stage with its reason, the rule's own decision kept beside it (`agrees`): first an `override` entry (a recorded serve
# decision, e.g. iteration 5's "kept because no better came"), then the judge's verdict when it is not stale and names
# this model (or none), then a `verdicts` entry naming this model or "current". model_for serves by the override when
# there is one, else by the rule. `due` names the next job the rule would pay for (none is run from here): a rejected
# model's geometry from a usable photo (image-to-3D, 30) or text (preview and refine, 30), its texture from a photo
# (a texture reference, 10) or the text with the check's correction (10); an accepted model whose image-to-3D photo
# today's rule refuses, when the rule has a usable photo no mesh was made from (30).
ACCEPT_FORMAT = 2   # 2: the likeness stage (2026-11-12)
CHECK_FIT = ROOT / "library" / "animals" / "check_fit.json"
BUILD_TOOL = {"snake": "build_snake.py", "reptile": "build_reptile.py", "bird": "build_bird.py", "quadruped": "build_quadruped.py"}


def fitted_params() -> dict:
    """The appearance check's thresholds fitted to the recorded verdicts (check_fit.json), else the module's defaults."""
    from .appearance import CHECK_PARAMS
    try:
        return {**CHECK_PARAMS, **json.loads(CHECK_FIT.read_text())["params"]}
    except (OSError, ValueError, KeyError):
        return dict(CHECK_PARAMS)


def _sha1(p: Path) -> str | None:
    import hashlib
    try:
        return hashlib.sha1(p.read_bytes()).hexdigest()
    except OSError:
        return None


def job_of(code: str, glb: Path) -> Path | None:
    """The Meshy job a built GLB came from (its extras.meshy_task), when that job's folder is in the library."""
    from .appearance import glb_extras
    try:
        task = glb_extras(glb).get("meshy_task")
    except (OSError, ValueError, IndexError):
        return None
    p = ROOT / "library" / "animals" / "jobs" / code / str(task)
    return p if task and p.is_dir() else None


def _rel(p: Path | None) -> str | None:
    return str(p.relative_to(ROOT)) if p else None


def _same_model(named: str | None, job: Path | None) -> bool:
    return bool(named) and job is not None and Path(named).name == job.name


def provenance(code: str, job: Path | None) -> dict:
    """Where a model came from: the rung (text or photo), the job's mode, the photo and its use, and whether today's photo
    rule takes that photo for that use (reference_photos.usable_for); the rule's own photo and whether a mesh was made
    from it."""
    from . import reference_photos as rp
    out = {"rung": "text", "mode": None}
    if job is None:
        return {**out, "rung": None, "why": "no job recorded in the GLB"}
    try:
        out["mode"] = json.loads((job / "job.json").read_text()).get("mode")
    except (OSError, ValueError):
        pass
    try:
        ref = json.loads((job / "reference.json").read_text())
    except (OSError, ValueError):
        ref = None
    store = None
    try:
        store = json.loads((rp.STORE / f"{code}.json").read_text())
    except (OSError, ValueError):
        pass
    if store:
        out["rule_photo"] = store.get("chosen")
    if ref:
        use = "image" if out["mode"] == "image" else "texture"
        out.update({"rung": "photo", "photo": ref.get("id"), "use": use})
        cand = next((c for c in (store or {}).get("candidates", []) if c["id"] == ref.get("id")), None)
        if cand and cand.get("score"):
            why = rp.usable_for(cand["score"], store.get("plan", "quadruped"), use)
            out["photo_usable"] = not why
            if why:
                out["photo_why_not"] = why
    return out


def _gate_stage(e: dict, job: Path | None, glb: Path) -> dict:
    g = e.get("gate") or {}
    if g and job is not None and _same_model(g.get("job"), job):
        return {"ok": bool(g.get("ok")), "by": f"rebuilt with today's {g.get('build')} on {g.get('at')}",
                **({"why": g.get("log")} if not g.get("ok") else {})}
    return {"ok": glb.exists(), "by": "built: the GLB exists only if the build's gate passed when it was built"}


def regate(code: str) -> dict:
    """The build's gate run again on the job the served GLB came from, with today's build tool, to a scratch file (no
    rig, no clips, no credits): {ok, job, build, at, log}, recorded in the species' `gate`."""
    import tempfile
    e = registry().get("species", {}).get(code) or {}
    glb = ROOT / e.get("glb", f"client/assets/fauna/{code}.glb")
    job = job_of(code, glb)
    kind = e.get("kind", "quadruped")
    if e.get("build") == "tools/build_snake_proc.py":   # a procedural snake: built again from its traits and photo (no job)
        with tempfile.TemporaryDirectory(prefix=f"regate_{code}_") as d:
            out = Path(d) / f"{code}.glb"
            r = subprocess.run(PY + [str(ROOT / "tools" / "build_snake_proc.py"), code, str(out)], cwd=ROOT, capture_output=True, text=True)
            return {"job": None, "build": "tools/build_snake_proc.py", "at": dt.date.today().isoformat(), "ok": out.exists() and r.returncode == 0,
                    "log": ((r.stdout + r.stderr).strip().splitlines() or [""])[-1][:300]}
    tool = BUILD_TOOL.get(kind, "build_quadruped.py")
    rec = {"job": _rel(job), "build": f"tools/{tool}", "at": dt.date.today().isoformat()}
    if job is None:
        return {**rec, "ok": False, "log": "no job recorded in the GLB"}
    with tempfile.TemporaryDirectory(prefix=f"regate_{code}_") as d:
        out = Path(d) / f"{code}.glb"
        cmd = [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / tool), "--", str(job), str(out), "--species", code]
        if kind in ("bird", "reptile") and e.get("archetype"):
            cmd += ["--archetype", e["archetype"]]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        ok = out.exists() and r.returncode == 0
        lines = [l for l in (r.stdout + r.stderr).splitlines() if code + ":" in l or "WROTE" in l or "rror" in l]
    return {**rec, "ok": ok, "log": (lines[-1] if lines else "")[:300]}


def override_of(e: dict, job: Path | None) -> dict | None:
    """The recorded verdict that overrides the rule for this model, if any: {verdict, serve, by, why, date, source}."""
    o = e.get("override")
    if o and (not o.get("model") or o.get("model") == "current" or _same_model(o.get("model"), job)):
        return {"verdict": o.get("verdict"), "serve": bool(o.get("serve")), "by": o.get("by"), "why": o.get("why"),
                "date": o.get("date"), "source": "override"}
    j = e.get("judge")
    if j and not j.get("stale") and (not j.get("model") or _same_model(j.get("model"), job)):
        return {"verdict": j["verdict"], "serve": j["verdict"] == "accepted", "by": j.get("by"), "why": j.get("why"),
                "date": j.get("date"), "source": "judge"}
    for v in e.get("verdicts") or []:
        if v.get("model") == "current" or _same_model(v.get("model"), job):
            return {"verdict": v["verdict"], "serve": v["verdict"] == "accepted", "by": v.get("by"), "why": v.get("why"),
                    "source": "verdicts"}
    return None


def _used_photos(e: dict) -> set:
    return {(h.get("reference") or {}).get("id") for h in e.get("photo", [])} | {(e.get("reference") or {}).get("id")}


def due(code: str, e: dict, rule: dict, prov: dict) -> dict | None:
    """The next job the rule would pay for (see the section's comment), or None; nothing is run from here."""
    from . import reference_photos as rp
    try:
        store = json.loads((rp.STORE / f"{code}.json").read_text())
    except (OSError, ValueError):
        store = None
    used = _used_photos(e) | {prov.get("photo")}
    plan = (store or {}).get("plan", "snake" if e.get("kind") == "snake" else "quadruped" if e.get("kind", "quadruped") == "quadruped" else "other")
    cands = sorted((store or {}).get("candidates", []), key=lambda c: c["id"] != (store or {}).get("chosen"))
    free = lambda use: [c["id"] for c in cands if c.get("score") and c["id"] not in used and not rp.usable_for(c["score"], plan, use)
                        and (use == "texture" or c["score"].get("usable"))]
    st = rule["stages"]
    if rule["decision"] == "rejected":
        if not st["model"]["ok"]:
            return None
        geo = (not st["gate"]["ok"]) or bool(st["check"].get("geometry"))
        if geo:
            img = free("image") if e.get("kind") != "snake" else []
            if img:
                return {"job": "image-to-3D", "photo": img[0], "credits": COST["image"], "why": "geometry: " + "; ".join(st["check"].get("geometry") or [st["gate"].get("why") or "the gate"])}
            return {"job": "text preview + refine", "credits": COST["preview"] + COST["refine"],
                    "why": "geometry, and no usable photo left: " + "; ".join(st["check"].get("geometry") or [st["gate"].get("why") or "the gate"])}
        tex = free("texture")
        fails = "; ".join((st["check"].get("fails") or []) + ["likeness: " + f for f in ((st.get("likeness") or {}).get("fails") or [])])
        if tex:
            return {"job": "refine with the photo as texture reference", "photo": tex[0], "credits": COST["refine"], "why": "texture: " + fails}
        return {"job": "refine with the check's correction" + ("" if store else " (or find reference photos first: no credits)"),
                "credits": COST["refine"], "why": "texture: " + fails}
    if prov.get("use") == "image" and prov.get("photo_usable") is False:
        img = free("image")
        if img:
            return {"job": "image-to-3D", "photo": img[0], "credits": COST["image"],
                    "why": f"the mesh came from {prov.get('photo')}, which today's photo rule refuses ({', '.join(prov.get('photo_why_not') or [])}); "
                           f"the rule's photo {img[0]} has no mesh (the model itself passes)"}
    return None


def acceptance(code: str, e: dict | None = None, params: dict | None = None) -> dict:
    """The acceptance rule's decision on a species' current model, the override that applies, what is served and what is
    due (the section's comment)."""
    e = e if e is not None else (registry().get("species", {}).get(code) or {})
    glb = ROOT / e.get("glb", f"client/assets/fauna/{code}.glb")
    job = job_of(code, glb) if glb.exists() else None
    stages = {}
    have = glb.exists() and (e.get("kind", "quadruped") != "quadruped" or (ASSETS / f"{code}_clips.json").exists())
    stages["model"] = {"ok": bool(e) and have, **({} if have else {"why": "no GLB" if not glb.exists() else "no gait clips"})}
    stages["gate"] = _gate_stage(e, job, glb) if have else {"ok": False, "why": "no model"}
    if have:
        from .appearance import check
        app = appearance(code) or {}
        if app.get("regions"):
            c = check(glb, app, params or fitted_params())
            f = c.get("features") or {}
            stages["check"] = {"ok": bool(c.get("ok")), "score": c.get("score"), "fails": c.get("fails") or [],
                               "geometry": f.get("geometry") or [], "texture": (c.get("colour_fails") or []) + (f.get("texture") or []),
                               "params": "library/animals/check_fit.json"}
        else:
            stages["check"] = {"ok": True, "why": "no described appearance"}
    else:
        stages["check"] = {"ok": False, "why": "no model"}
    if have and e.get("kind", "quadruped") == "quadruped":
        lk = likeness_check(code)
        if lk.get("ok") is None:
            stages["likeness"] = {"ok": True, "judged": False, "why": "; ".join(lk.get("why") or [])}
        else:
            b = _likeness_brief(lk)
            stages["likeness"] = {"ok": bool(lk["ok"]), "judged": True, "fails": b.pop("why"), **{k: v for k, v in b.items() if k != "ok"},
                                  "by": lk.get("by")}
    prov = provenance(code, job)
    stages["provenance"] = {**prov, "decides": False}
    fails = [f"{k}: {'; '.join(v.get('fails') or []) or v.get('why') or 'fails'}" for k, v in stages.items() if k != "provenance" and not v["ok"]]
    rule = {"decision": "rejected" if fails else "accepted", "why": fails, "stages": stages}
    ov = override_of(e, job)
    served = ov["serve"] if ov else rule["decision"] == "accepted"
    return {"format": ACCEPT_FORMAT, "at": dt.date.today().isoformat(), "model": _rel(job), "glb_sha1": _sha1(glb), "rule": rule,
            "override": ov, "agrees": None if not ov else ov["verdict"] == rule["decision"], "served": bool(served and have),
            "served_by": "override" if ov else "rule", "due": due(code, e, rule, prov)}


def record_acceptance(code: str, regate_too: bool = False) -> dict | None:
    """The rule run on the species' current model and recorded in models.json `acceptance` (merged into a fresh read)."""
    reg = registry()
    e = reg.get("species", {}).get(code)
    if not e:
        return None
    if regate_too:
        e["gate"] = regate(code)
    a = acceptance(code, e)
    fresh = registry()
    fresh["species"][code] = {**fresh["species"].get(code, e), **({"gate": e["gate"]} if regate_too else {}), "acceptance": a}
    REGISTRY.write_text(json.dumps(fresh, indent=1) + "\n")
    return a


def served_by_rule(code: str, e: dict) -> bool:
    """model_for's decision: the recorded override when one applies (read live), else the rule's recorded decision when it
    was taken on this very GLB, else the rule run now."""
    glb = ROOT / e.get("glb", f"client/assets/fauna/{code}.glb")
    job = job_of(code, glb)
    ov = override_of(e, job)
    if ov:
        return ov["serve"]
    a = e.get("acceptance") or {}
    if a.get("format") == ACCEPT_FORMAT and a.get("glb_sha1") and a.get("glb_sha1") == _sha1(glb):
        return a["rule"]["decision"] == "accepted"
    return acceptance(code, e)["rule"]["decision"] == "accepted"


def _judged_likeness(k: dict, job: Path | None) -> dict | None:
    """The likeness of a model with a recorded verdict, from its job's generated source (None when it cannot be judged
    offline: not four-legged, no source on disk, no photos, no embedding network)."""
    from . import likeness as lk
    from . import reference_photos as rp
    if k["entry"].get("kind", "quadruped") != "quadruped" or not lk.ready() or not (rp.STORE / f"{k['code']}.json").exists():
        return None
    try:
        src = lk.source_at(job)
        return lk.likeness(k["code"], source=src) if src else None
    except Exception:
        return None


def fit_acceptance(log=print) -> dict:
    """The rule measured against the recorded verdicts (appearance.known_verdicts: 39 models at iteration 8, 41 on
    2026-11-12): its confusion in sample and leave-one-out (the check's thresholds refitted without the model:
    check_fit.json flagged_loo; the other stages fit nothing; the likeness stage, 2026-11-12, is run on each judged
    job's generated source where it can be), and the provenance stage's variants that were not adopted."""
    from . import appearance as ap
    from . import reference_photos as rp
    loo_of = {}
    try:
        for r in json.loads(CHECK_FIT.read_text())["per_model"]:
            loo_of[(r["code"], r["model"])] = r["flagged_loo"]
    except (OSError, ValueError, KeyError):
        pass
    p = fitted_params()
    rows = []
    for k in ap.known_verdicts():
        if not ap._build_judged(k, log):
            continue
        glb = k["glb"]
        job = job_of(k["code"], glb) or (k.get("job") if k.get("job") and Path(k["job"]).is_dir() else None)
        app = appearance(k["code"]) or {}
        c = ap.check(glb, app, p) if app.get("regions") else {"ok": True}
        prov = provenance(k["code"], job)
        refused = prov.get("rung") == "photo" and prov.get("photo_usable") is False
        try:   # the variant that asks every USABLE score of a photo whatever its use
            store = json.loads((rp.STORE / f"{k['code']}.json").read_text())
            cand = next((x for x in store["candidates"] if x["id"] == prov.get("photo")), None)
            refused_any = bool(cand and rp.usable(cand["score"], store.get("plan", "quadruped")))
        except (OSError, ValueError, KeyError, TypeError):
            refused_any = False
        like = _judged_likeness(k, job)   # the likeness stage fits nothing to the verdicts: the same in and out of sample
        unlike = like is not None and like.get("ok") is False
        flag = (not c.get("ok")) or unlike
        rows.append({"code": k["code"], "model": k["model"], "verdict": k["verdict"], "by": k["by"],
                     "rule": "rejected" if flag else "accepted", "check_fails": c.get("fails") or [],
                     **({"likeness": _likeness_brief(like)} if like is not None and like.get("ok") is not None else {}),
                     "rule_loo": "rejected" if (loo_of.get((k["code"], k["model"]), not c.get("ok")) or unlike) else "accepted",
                     "provenance": {x: prov.get(x) for x in ("rung", "mode", "photo", "use", "photo_usable", "photo_why_not") if x in prov},
                     "_v_use": flag or refused, "_v_any": flag or refused_any})
    import numpy as np
    y = np.array([r["verdict"] == "rejected" for r in rows])
    conf = lambda flags: ap._confusion(y, np.array(flags, bool))
    ba = lambda cf: round(0.5 * (cf["rejected_flagged"] / max(1, y.sum()) + cf["accepted_passed"] / max(1, (~y).sum())), 3)
    rule, loo = conf([r["rule"] == "rejected" for r in rows]), conf([r["rule_loo"] == "rejected" for r in rows])
    v_use, v_any = conf([r["_v_use"] for r in rows]), conf([r["_v_any"] for r in rows])
    for r in rows:
        r.pop("_v_use"); r.pop("_v_any")
    return {"date": dt.date.today().isoformat(), "by": "pipeline/fauna_models.py fit_acceptance", "models": len(rows),
            "likeness_judged": sum(1 for r in rows if "likeness" in r),
            "rejected": int(y.sum()), "accepted": int((~y).sum()),
            "rule": {**rule, "balanced_accuracy": ba(rule)}, "loo": {**loo, "balanced_accuracy": ba(loo)},
            "not_adopted": {"provenance by use (image-to-3D photo must pass USABLE, a texture reference whole, size, clear, body)": {**v_use, "balanced_accuracy": ba(v_use)},
                            "provenance, every USABLE score whatever the use": {**v_any, "balanced_accuracy": ba(v_any)}},
            "disagreements": [{k: r[k] for k in ("code", "model", "verdict", "by", "rule", "check_fails", "likeness") if k in r} for r in rows if r["rule"] != r["verdict"]],
            "per_model": rows}



def _served_before(code: str, e: dict) -> bool:
    """What was served before this run: the recorded acceptance, else the rule before iteration 10 (drawn unless the
    judge rejected it)."""
    if "served" in (e.get("acceptance") or {}):   # (whatever its format: what was drawn is what the record says)
        return bool(e["acceptance"].get("served"))
    have = (ASSETS / f"{code}.glb").exists() and (e.get("kind", "quadruped") != "quadruped" or (ASSETS / f"{code}_clips.json").exists())
    return have and (e.get("judge") or {}).get("verdict") != "rejected"


def accept_library(codes: list[str] | None = None, regate_too: bool = False) -> dict:
    """The acceptance rule re-run over every library model (or those named) and recorded; prints each change in what is
    served (before -> after, why) and what is due. Returns {code: {before, after, why, due}}."""
    out = {}
    for code, e in registry().get("species", {}).items():
        if codes and code not in codes:
            continue
        before = _served_before(code, e)
        a = record_acceptance(code, regate_too)
        after = model_for(code) is not None
        r = a["rule"]
        ov = a.get("override")
        why = (f"override ({ov['source']}: {ov['verdict']}, {'drawn' if ov['serve'] else 'not drawn'})" if ov else "the rule") + \
              f"; rule {r['decision']}" + (f" ({'; '.join(r['why'])})" if r["why"] else "")
        out[code] = {"before": before, "after": after, "why": why, "agrees": a.get("agrees"), "due": a.get("due")}
        flag = "CHANGED " if before != after else ""
        print(f"{flag}{code}: {'drawn' if before else 'stand-in'} -> {'drawn' if after else 'stand-in'}; {why}"
              + (f"; due: {a['due']['job']} ({a['due']['credits']})" if a.get("due") else ""), flush=True)
    return out


def named_slots(fauna: dict, codes: list[str], log=print) -> list[dict]:
    """The species named with --codes for a paid run, in the order named: the tile's own slot, or, for a four-legged
    species the tile draws by hand and so has no slot for (the home tile's bobcat, 2026-11-12), one made from its trait
    card. Anything else is left out and said."""
    slots = {s["code"]: s for s in fauna.get("slots", [])}
    out = []
    for code in codes:
        s = slots.get(code)
        if not s:
            t = _traits(code)
            s = {"code": code, "common": t.get("common"), "scientific": t.get("scientific"), "mass_kg": t.get("mass_kg")}
            if not quadruped(s, t):
                log(f"{code}: no slot on the tile and no four-legged trait card: left out"); continue
        out.append({**s, "why": "named"})
    return out


def run(tile_id: str, budget: int, reserve: int, max_n: int, dry: bool, kind: str = "all", attempts: int = 2,
        codes: list[str] | None = None) -> dict:
    tdir = ROOT / "tiles" / tile_id
    fauna = json.loads((tdir / "client" / "fauna.json").read_text())
    place = place_name(tile_id)
    pick, rest = (named_slots(fauna, codes), []) if codes else choose(fauna, budget, max_n, kind)
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
        # (not in a dry run: 2026-11-12, a dry run rebuilt the refused bobcat from its newest refine and registered it)
        for job in ([] if dry else sorted(paid_refines(code), key=lambda d: d.stat().st_mtime, reverse=True)):
            ok, log = build(code, job, tile_id, bird, rept, snk)
            if ok:
                row["ok"], row["build_log"], row["reused"] = True, log, str(job.relative_to(ROOT))
                register(reg, code, [str(job.relative_to(ROOT))], 0, 0, tile_id, bird, rept, snk)
                break
        if row["ok"]:
            print(f"{code}: modelled from a paid job, 0 credits", flush=True)
            continue
        if snk and not dry:   # a snake: the procedural build first, no credits (procedural_snake)
            pr = procedural_snake(code, tile_id)
            row["procedural"] = {k: pr.get(k) for k in ("served", "why", "check")}
            if pr.get("served"):
                row["ok"] = True
                print(f"{code}: built procedurally, 0 credits", flush=True)
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
            if not (snk or bird or rept):   # a four-legged animal: the pose gate, before the refine is paid
                pg = pose_check(pv)
                row.setdefault("pose", []).append({"preview": str(pv.relative_to(ROOT)), **pg})
                print(f"{code}: preview {pv.name} {'stands square' if pg['ok'] else 'fails the pose gate: ' + '; '.join(pg.get('why') or [])}"
                      + (f" (its head, turned {pg['straightened']:.0f} degrees, set straight)" if pg.get("straightened") else ""), flush=True)
                if not pg["ok"]:
                    continue
                sg = shape_gate(code, pv, tile_id)   # the build and the described shape, before the refine is paid
                row.setdefault("shape", []).append({"preview": str(pv.relative_to(ROOT)), **sg})
                print(f"{code}: preview {pv.name} {'has the described shape' if sg['ok'] else 'fails the shape gate: ' + '; '.join(sg['why'])}", flush=True)
                if not sg["ok"]:
                    continue
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
                texture_bad = bool(c.get("colour_fails") or (c.get("features") or {}).get("texture"))
                # a mesh of the wrong shape is not worth another texture (2026-11-12: the long-tailed bobcat was re-refined
                # for its markings and again from a photo, 20 credits, and stayed refused for its tail)
                shape_bad = bool((c.get("features") or {}).get("geometry"))
                if texture_bad and not shape_bad and bal is not None and bal - COST["refine"] >= reserve and spent + COST["refine"] <= budget:
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
                if not (snk or bird or rept):   # the likeness: photographs of the species, found now if the store has none
                    lk = likeness_check(code, tile_id, fetch=True)
                    row["likeness"] = _likeness_brief(lk)
                    print(f"{code}: likeness {'not judged' if lk.get('ok') is None else 'passes' if lk['ok'] else 'fails'}: {'; '.join(lk.get('why') or [])}", flush=True)
                    bal = balance()
                    if lk.get("ok") is False and not shape_bad and bal is not None and bal - COST["refine"] >= reserve and spent + COST["refine"] <= budget:
                        rec = photo_rung(code, tile_id, "texture", s)   # the species' most typical photo as the texture reference
                        spent += rec.get("credits", 0); row["credits"] += rec.get("credits", 0)
                        row["likeness_refine"] = {k: rec.get(k) for k in ("job", "kept", "likeness", "error", "reference")}
                row["acceptance"] = (record_acceptance(code) or {}).get("rule", {}).get("decision")
                break
        # the second rung (iteration 7): no model after the gate, or a model whose geometry fails the feature check, is
        # tried once from its reference photo (image-to-3D)
        need = None
        if not row.get("stopped") and row["attempts"]:
            if not row["ok"]:
                need = "image"
            elif ((row.get("colour_check") or {}).get("fails") or []) and (colour_check(code).get("features") or {}).get("geometry"):
                need = "image"
        if need:   # (2026-11-06: snakes too: a terciopelo's text previews came back thick, then coiled; the photo of one laid out is the better input)
            bal = balance()
            if bal is not None and bal - COST["image"] >= reserve and spent + COST["image"] <= budget:
                rec = photo_rung(code, tile_id, need, s)
                spent += rec.get("credits", 0); row["credits"] += rec.get("credits", 0); row["photo"] = {k: rec.get(k) for k in ("job", "kept", "after", "error")}
                row["ok"] = row["ok"] or (rec.get("kept") == "new")
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
    ap.add_argument("tile", nargs="?"); ap.add_argument("--budget", type=int, default=0)
    ap.add_argument("--reserve", type=int, default=300); ap.add_argument("--max", type=int, default=12)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--attempts", type=int, default=2, help="previews per species before it is left a stand-in")
    ap.add_argument("--kind", choices=("all", "mammals", "birds", "reptiles", "snakes"), default="all", help="model only the mammals, birds, reptiles or snakes")
    ap.add_argument("--rebuild", action="store_true", help="rebuild every library model from its job (no credits), then stop")
    ap.add_argument("--check", action="store_true", help="check the library models' colours against their described appearance, then stop")
    ap.add_argument("--recolour", action="store_true", help="re-refine (10 credits each) the library models whose colours fail the check, then stop")
    ap.add_argument("--redo", action="store_true", help="the second rung (the reference photo) for the species named with --codes, then stop")
    ap.add_argument("--judge", metavar="CODE", help="record the judge's verdict on CODE's current model (--verdict, --why), then stop")
    ap.add_argument("--accept", action="store_true", help="run the acceptance rule on every library model (or --codes), record it, print what is served and due; no credits")
    ap.add_argument("--regate", action="store_true", help="with --accept: build each model's job again with today's build tool (the gate)")
    ap.add_argument("--fit-accept", action="store_true", help="measure the acceptance rule against the recorded verdicts; writes models.json acceptance_rule")
    ap.add_argument("--verdict", choices=("accepted", "rejected"))
    ap.add_argument("--why", default="")
    ap.add_argument("--procedural", action="store_true", help="build the snakes named with --codes procedurally (tools/build_snake_proc.py, no credits), judge and serve by the rule, then stop")
    ap.add_argument("--codes", default="", help="comma-separated species codes for --rebuild, --check or --recolour (--recolour re-refines these even if they pass)")
    a = ap.parse_args()
    codes = [c.strip() for c in a.codes.split(",") if c.strip()] or None
    if a.judge:
        judge(a.judge, a.verdict, a.why); return
    if a.accept:
        accept_library(codes, a.regate); return
    if a.procedural:
        for code in codes or []:
            procedural_snake(code, a.tile)
        return
    if a.fit_accept:
        r = fit_acceptance()
        reg = registry()
        reg["acceptance_rule"] = {"doc": "pipeline/fauna_models.py, the section 'model acceptance as a rule'", "fit": {k: v for k, v in r.items() if k != "per_model"}}
        REGISTRY.write_text(json.dumps(reg, indent=1) + "\n")
        print(json.dumps({k: r[k] for k in ("models", "rule", "loo", "not_adopted", "disagreements")}, indent=1)); return
    if not a.tile:
        ap.error("a tile is needed")
    if a.redo:
        led = redo(a.tile, codes or [], a.budget, a.reserve, a.dry_run)
        print(json.dumps({k: led[k] for k in ("spent", "balance_after")})); return
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
    led = run(a.tile, a.budget, a.reserve, a.max, a.dry_run, a.kind, a.attempts, codes)
    print(json.dumps({k: led[k] for k in ("spent", "balance_after", "modelled")}))


if __name__ == "__main__":
    main()
