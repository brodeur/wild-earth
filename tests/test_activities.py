"""One vocabulary for what an animal is doing (client/src/activities.js; docs/decisions.md 2026-11-07).

    .venv/bin/python -m unittest tests.test_activities

Every archetype the pipeline can write (pipeline/fauna_slots.py) has a family, every species the client draws has an
archetype, every 'act:how' a machine names in animals.js (DOING, doingOf) is a known act, and every family says a
non-empty, fully filled line for every act and manner in every habitat. Runs activities.js under node; skipped without it.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANIMALS = ROOT / "client" / "src" / "animals.js"
ACTIVITIES = ROOT / "client" / "src" / "activities.js"
FAUNA_SLOTS = ROOT / "pipeline" / "fauna_slots.py"


def pipeline_archetypes() -> set[str]:
    src = FAUNA_SLOTS.read_text()
    found = set(re.findall(r'return (?!None)[^\n]*?, "([^"]+)", (?:known|\[)', src))   # kin_for's (kin, archetype, known) returns (not a no-kin reason)
    import pipeline.fauna_slots as fs
    found |= set(fs.REPTILE_ARCHETYPE.values()) | set(fs.GROUP)
    return found


def doing_strings() -> set[str]:
    src = ANIMALS.read_text()
    block = src[src.index("const DOING = {"):src.index("};", src.index("const DOING = {"))]
    body = src[src.index("  doingOf(a) {"):src.index("  doing(a) {")]
    return set(re.findall(r"'([a-z]+(?::[a-z]+)?)'", block)) | set(re.findall(r"d = [^;]*?'([a-z]+:[a-z]+|[a-z]+)'", body)) | \
        set(re.findall(r"\? '([a-z]+(?::[a-z]+)?)'", body)) | set(re.findall(r": '([a-z]+(?::[a-z]+)?)'", body))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ActivitiesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        codes = re.findall(r"^  \{ code: '([a-z_]+)'", ANIMALS.read_text(), flags=re.M)
        doing = sorted(s for s in doing_strings() if s not in ("sq", "wp", "rv", "dr", "mm", "rb", "jk", "vo", "tk", "gs", "lz", "rp", "sn", "sl", "qu", "sj", "hk", "tv"))
        script = f"""
import {{ ACTS, FAMILY, MACHINE_FAMILY, STATIC_ARCHETYPE, PHRASES, say, parseDoing }} from {json.dumps(ACTIVITIES.as_uri())};
const codes = {json.dumps(codes)}, doing = {json.dumps(doing)}, out = {{ acts: ACTS, families: FAMILY, missingCodes: codes.filter(c => !STATIC_ARCHETYPE[c]),
  badDoing: doing.filter(s => !ACTS.includes(s.split(':')[0])), bad: [] }};
const archetypes = [...new Set([...Object.keys(FAMILY), 'unknown archetype'])], hows = [...new Set(doing.map(s => s))];
for (const arch of archetypes) for (const m of [...Object.keys(MACHINE_FAMILY)]) for (const s of [...ACTS, ...hows]) for (const habitat of [0, 1, 2, 4, 5, 6, 7, 8, 9])
  for (const [groupN, young, prey] of [[1, '', ''], [6, '', 'elk'], [3, 'mother', ''], [2, 'cub', 'vole']]) {{
    const {{ act, how }} = parseDoing(s), t = say(act, how, {{ archetype: arch, machine: m, habitat, groupN, young, prey }});
    if (!t || /[{{}}]|undefined|null|NaN|  /.test(t) || t !== t.trim()) out.bad.push([arch, m, s, habitat, t]);
  }}
for (const code of Object.keys(PHRASES)) for (const s of [...ACTS, ...hows]) {{
  const {{ act, how }} = parseDoing(s), t = say(act, how, {{ code, archetype: STATIC_ARCHETYPE[code], habitat: 5, groupN: 4 }});
  if (!t || /[{{}}]|undefined/.test(t)) out.bad.push([code, s, t]);
}}
out.samples = {{
  bisonGraze: say('forage', 'graze', {{ code: 'bison_bison', archetype: 'grazing or browsing herd', machine: 'dr', habitat: 5, groupN: 12 }}),
  bisonBed: say('rest', 'bed', {{ code: 'bison_bison', archetype: 'grazing or browsing herd', machine: 'dr', habitat: 5, groupN: 1 }}),
  elkHoh: say('forage', 'graze', {{ code: 'cervus_canadensis', archetype: 'grazing or browsing herd', machine: 'dr', habitat: 6, groupN: 5 }}),
  turkeyRoost: say('rest', 'roost', {{ code: 'meleagris_gallopavo', archetype: 'ground bird', machine: 'tk' }}),
  owlDay: say('rest', 'roost', {{ code: 'strix_varia', archetype: 'night perching bird', machine: 'sj' }}),
  lionStalk: say('hunt', 'stalk', {{ code: 'puma_concolor', archetype: 'ambush predator', machine: 'mm', prey: 'elk' }}),
  wolfTrot: say('travel', '', {{ code: 'canis_lupus', archetype: 'coursing predator', machine: 'mm', groupN: 4, mass: 40 }}),
  foxTrot: say('travel', '', {{ code: 'vulpes_vulpes', archetype: 'coursing predator', machine: 'mm', groupN: 3, mass: 5 }}),
  bisonSage: say('forage', 'graze', {{ code: 'bison_bison', archetype: 'grazing or browsing herd', machine: 'dr', habitat: 4, groupN: 9 }}),
  ravenSoar: say('fly', 'soar', {{ code: 'corvus_corax', archetype: 'corvid', machine: 'rv' }}),
  magpieSoar: say('fly', 'soar', {{ code: 'pica_hudsonia', archetype: 'walking corvid', machine: 'rv' }}),
  crowWalk: say('forage', 'walk', {{ code: 'corvus_brachyrhynchos', archetype: STATIC_ARCHETYPE.corvus_brachyrhynchos, machine: 'rv' }}),
  sandpiperStalk: say('hunt', 'stalk', {{ code: 'actitis_macularius', archetype: 'shorebird', machine: 'qu', habitat: 7 }}),
  sandpiperFlush: say('fly', 'flush', {{ code: 'actitis_macularius', archetype: 'shorebird', machine: 'qu' }}),
  heronStalk: say('hunt', 'stalk', {{ code: 'ardea_herodias', archetype: 'wading bird', machine: 'qu' }}),
}};
console.log(JSON.stringify(out));
"""
        r = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, cwd=ROOT, timeout=120)
        if r.returncode:
            raise AssertionError(r.stderr)
        cls.out = json.loads(r.stdout)

    def test_every_pipeline_archetype_has_a_family(self):
        missing = sorted(a for a in pipeline_archetypes() if a not in self.out["families"])
        self.assertEqual(missing, [], "archetypes pipeline/fauna_slots.py writes that activities.js FAMILY does not name")

    def test_every_drawn_species_has_an_archetype(self):
        self.assertEqual(self.out["missingCodes"], [])

    def test_every_machine_state_is_a_known_act(self):
        self.assertEqual(self.out["badDoing"], [])

    def test_every_line_is_filled(self):
        self.assertEqual(self.out["bad"][:10], [])

    def test_lines_read_by_rule(self):
        s = self.out["samples"]
        self.assertEqual(s["bisonGraze"], "grazing on the open grass with its herd")
        self.assertEqual(s["bisonBed"], "bedded down in the long grass")
        self.assertEqual(s["elkHoh"], "grazing on the river flat")   # the Hoh's hand-written line, now by its habitat
        self.assertEqual(s["turkeyRoost"], "roosting for the night")
        self.assertEqual(s["owlDay"], "roosting through the day")
        self.assertEqual(s["lionStalk"], "stalking an elk")
        self.assertEqual(s["wolfTrot"], "trotting along with its pack")
        self.assertEqual(s["foxTrot"], "trotting along with its family")
        self.assertEqual(s["bisonSage"], "feeding between the shrubs with its herd")
        # the raven alone tumbles; a walking corvid flaps; a shorebird works the edge, apart from the heron (2026-11-07)
        self.assertEqual(s["ravenSoar"], "soaring and tumbling on the wind")
        self.assertEqual(s["magpieSoar"], "flying over on steady wingbeats")
        self.assertEqual(s["crowWalk"], "walking about on the ground, looking for food")
        self.assertEqual(s["sandpiperStalk"], "running along the water's edge, picking at food")
        self.assertEqual(s["sandpiperFlush"], "flushed, flying off low over the water")
        self.assertEqual(s["heronStalk"], "stalking slowly through the shallows")


if __name__ == "__main__":
    unittest.main()
