#!/bin/bash
# Re-capture the probe regression set: every probe in probes.json (or those named), four poses each, a sheet and the
# colour statistics against the tile's imagery from above. Needs: the dev server on 8784 (preview_start), a headless
# Chrome with --remote-debugging-port=9333, and receiver.py listening on 8811 writing into "$1/probe-captures".
# Usage: tools/probes/run.sh <notes dir> [name ...]
set -e
NOTES="$1"; shift
D="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$D/../.." && pwd)"
NODE="${NODE:-node}"
names="$*"; [ -z "$names" ] && names=$(python3 -c "import json;print(' '.join(k for k in json.load(open('$D/probes.json')) if not k.startswith('_')))")
for n in $names; do
  read tile date hour cx cy poses < <(python3 -c "import json;p=json.load(open('$D/probes.json'))['$n'];print(p['tile'],p['date'],p['hour'],p['topdown'][0],p['topdown'][1],json.dumps(p['poses']).replace(' ',''))")
  "$NODE" "$D/capture.mjs" 9333 "http://localhost:8784/client/?tile=$tile&skip=1&date=$date" "$n" "$hour" "$poses" || { echo "$n: capture failed"; continue; }
  keys=$(python3 -c "import json;print(','.join(json.load(open('$D/probes.json'))['$n']['poses']))")
  (cd "$ROOT" && arch -arm64 .venv/bin/python "$D/sheet.py" "$NOTES" "$n" "$tile" "$keys" "$cx" "$cy" "${date%%-*}")
done
