#!/bin/bash
# before check (the 5 m routing, 5 m levels), reroute + water, after check
t=$1
cd /Users/aaronbrodeur/Sites/wild-earth/.claude/worktrees/water-reroute
if [ ! -f tiles/$t/hydro/channels_5m.geojson ]; then
  arch -arm64 .venv/bin/python -m pipeline.water_check --tile $t --levels 5m --out scratch/reroute/before_$t.json > /dev/null 2>&1
else
  arch -arm64 .venv/bin/python -m pipeline.water_check --tile $t --channels hydro/channels_5m.geojson --levels 5m --out scratch/reroute/before_$t.json > /dev/null 2>&1
fi
arch -arm64 .venv/bin/python -m pipeline.build_tile --tile $t --steps reroute,water > scratch/reroute/build_$t.log 2>&1
arch -arm64 .venv/bin/python -m pipeline.water_check --tile $t --out scratch/reroute/after_$t.json > /dev/null 2>&1
arch -arm64 .venv/bin/python scratch/reroute/summ.py scratch/reroute/before_$t.json scratch/reroute/after_$t.json
grep "^reroute:" scratch/reroute/build_$t.log | cut -c1-700
grep -i "error\|Traceback\|failed" scratch/reroute/build_$t.log | head -5
