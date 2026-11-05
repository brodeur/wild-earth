#!/bin/bash
# water-only convergence: 439, 429, 439, then seams on both; $1 = tiles folder (empty: the worktree's)
cd /Users/aaronbrodeur/Sites/wild-earth/.claude/worktrees/water-reroute
[ -n "$1" ] && export WILD_EARTH_TILES=$1
tag=${2:-fwd}
for t in utm10n_439_5293 utm10n_429_5293 utm10n_439_5293; do
  arch -arm64 .venv/bin/python -m pipeline.build_tile --tile $t --steps water >> scratch/seam/converge_$tag.log 2>&1 || echo "FAIL water $t"
done
for t in utm10n_429_5293 utm10n_439_5293; do
  arch -arm64 .venv/bin/python -m pipeline.seams $t > scratch/seam/seams_conv_${tag}_$t.json 2>/dev/null
  python3 -c "
import json;d=json.load(open('scratch/seam/seams_conv_${tag}_$t.json'))
for e in d['edges']:
  s=e['streams']; print('$tag $t', e['side'], 'problem:', e['problem'], 'max_offset', s.get('max_offset_m'), 'max_level_diff', s.get('max_level_diff_m'), 'own_step', s.get('max_own_level_step_m'), 'matched', len(s.get('matched',[])), 'unmatched', len(s.get('unmatched',[])))"
done
echo "converge $tag done"
