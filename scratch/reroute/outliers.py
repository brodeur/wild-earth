import json, sys
import numpy as np
from shapely.geometry import shape
from pipeline.config import Tile
from pipeline.rewild_hydro import _Ctx
t = Tile.from_id(sys.argv[1]); ctx = _Ctx(t)
new = json.load(open(t.path("hydro/channels.geojson")))["features"]
old = json.load(open(t.path("hydro/channels_5m.geojson")))["features"]
tot_o = tot_n = 0
rows = []
for a, b in zip(old, new):
    lo, ln = ctx.local(shape(a["geometry"])), ctx.local(shape(b["geometry"]))
    tot_o += lo.length; tot_n += ln.length
    pr = b["properties"]
    rows.append((pr.get("snap_shift_max_m") or 0, ln.length / max(lo.length, 1), lo.length, ln.length, pr.get("order"), pr.get("name"), pr.get("rerouted"), np.round(lo.coords[0]).tolist(), np.round(lo.coords[-1]).tolist(), pr.get("in_waterbody")))
print("length old", round(tot_o), "new", round(tot_n))
for r in sorted(rows, key=lambda r: -r[0])[:12]: print("shift", r)
for r in sorted(rows, key=lambda r: -r[1])[:8]: print("ratio", r)
r = np.array([x[1] for x in rows if x[2] > 50]); print("ratio pcts", np.percentile(r, [10, 50, 90, 99]).round(2))
