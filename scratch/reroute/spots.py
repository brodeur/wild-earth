# worst runs of the 5 m routing (before) off the roads, for before/after captures
import json, sys
import numpy as np
from pipeline.config import Tile
from pipeline.rewild_hydro import _Ctx
from pipeline.reroute import FineDEM, road_zone
from pipeline.water import kept_ponds, stream_samples, BANK
t = Tile.from_id(sys.argv[1]); ctx = _Ctx(t); dem = FineDEM(t, ctx.z)
ch = "hydro/channels_5m.geojson"
ponds = kept_ponds(ctx); pm = ctx.rasterize([p["geom"] for p in ponds]).astype(bool) if ponds else np.zeros((ctx.n, ctx.n), bool)
S = stream_samples(ctx, pm, None, channels=ch)
x, y, L, wh, tx, ty = S["x"], S["y"], S["L"], S["wh"], S["tx"], S["ty"]
order = np.clip(S["order"].astype(int), 1, 7); cls = S["cls"]
m = np.array([BANK[o]["margin"] for o in range(1, 8)])[order - 1]
nx, ny = -ty, tx; e = wh + m
side = np.minimum(dem.at(x + nx * e, y + ny * e), dem.at(x - nx * e, y - ny * e))
above = L - side
g0 = dem.at(x, y)
offs = np.linspace(-1, 1, 41); R = np.maximum(3, wh + m + np.array([BANK[o]["bank"] for o in range(1, 8)])[order - 1])
gap = np.array([g0[i] - dem.at(x[i] + nx[i] * R[i] * offs, y[i] + ny[i] * R[i] * offs).min() for i in range(len(x))])
z5 = road_zone(t); on = z5[np.clip(((1e4 - y) // 5).astype(int), 0, 1999), np.clip((x // 5).astype(int), 0, 1999)]
bad = ((above > 0.4) | (gap > 0.6)) & ~on & (order >= 2) & (cls >= 1)
# runs of >= 12 consecutive bad samples on one reach
reach = S["reach"].astype(int); out = []
i = 0
while i < len(x):
    if not bad[i]: i += 1; continue
    j = i
    while j + 1 < len(x) and bad[j + 1] and reach[j + 1] == reach[i]: j += 1
    if j - i >= 12:
        k = (i + j) // 2
        out.append((j - i + 1, round(float(x[k])), round(float(y[k])), int(order[k]), int(cls[k]), round(float(above[i:j+1].max()), 2), round(float(gap[i:j+1].max()), 2), S["reaches"][[r["id"] for r in S["reaches"]].index(reach[k])]["name"]))
    i = j + 1
out.sort(key=lambda r: -r[0])
for r in out[:15]: print(r)
