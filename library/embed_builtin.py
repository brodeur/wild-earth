"""Copy library/species/*.json into the BUILTIN block of client/src/treegen.js.

The client fetches the species files at startup and falls back to this embedded copy when the
library is not reachable (offline, or a static host without library/). Run after editing a species:

    python3 library/embed_builtin.py

`notes` and `sources` are left out of the embedded copy (they are for people, not the generator).
Every species in index.json is embedded, however many; ids starting with `_` (the generator's _test_
files) and ids without a file are skipped with a note.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPECIES = ROOT / "library" / "species"
TARGET = ROOT / "client" / "src" / "treegen.js"

index = json.loads((SPECIES / "index.json").read_text())
lines = []
for sid in index["species"]:
    f = SPECIES / f"{sid}.json"
    if sid.startswith("_") or not f.exists():
        print(f"skipped {sid}: {'test file' if sid.startswith('_') else 'no file'}")
        continue
    d = json.loads(f.read_text())
    for k in ("notes", "sources", "authors"):
        d.pop(k, None)
    lines.append(f"  {json.dumps(sid)}: {json.dumps(d, separators=(',', ':'))},")
block = "// BEGIN BUILTIN\nexport const BUILTIN = {\n" + "\n".join(lines) + "\n};\n// END BUILTIN"
src = TARGET.read_text()
new, n = re.subn(r"// BEGIN BUILTIN.*?// END BUILTIN", lambda m: block, src, flags=re.S)
assert n == 1, "markers not found in treegen.js"
TARGET.write_text(new)
print(f"embedded {len(lines)} species into {TARGET.relative_to(ROOT)}")
