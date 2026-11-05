import json, sys
for p in sys.argv[1:]:
    r = json.load(open(p))
    print(p.split('/')[-1], {k: v for k, v in r.items() if k not in ('worst_gap', 'worst_clip', 'tile', 'channels')})
