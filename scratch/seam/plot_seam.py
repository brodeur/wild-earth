import json, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
from shapely.geometry import shape
from pipeline.config import Tile
from pipeline.rewild_hydro import _Ctx
cx, cy, R, px, out = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
tiles = sys.argv[6:]
im = Image.new('RGB', (px, px), (40, 40, 40)); sx = px / (2 * R)
def P(x, y): return ((x - cx + R) * sx, (cy + R - y) * sx)
for tid in tiles:
    t = Tile.from_id(tid); x0, y0 = t.bounds[:2]
    hs = np.asarray(Image.open(t.path('terrain/hillshade.png')).convert('L')); r = 10000 / hs.shape[0]
    for j in range(px):
        pass
    # paste the hillshade window
    a0, a1 = max(cx - R, t.bounds[0]), min(cx + R, t.bounds[2]); b0, b1 = max(cy - R, t.bounds[1]), min(cy + R, t.bounds[3])
    if a1 <= a0 or b1 <= b0: continue
    c0, c1 = int((a0 - x0) / r), int((a1 - x0) / r); r0, r1 = int((t.bounds[3] - b1) / r), int((t.bounds[3] - b0) / r)
    win = Image.fromarray(hs[r0:r1, c0:c1]).convert('RGB').resize((max(1, int((a1 - a0) * sx)), max(1, int((b1 - b0) * sx))))
    im.paste(win, (int((a0 - cx + R) * sx), int((cy + R - b1) * sx)))
d = ImageDraw.Draw(im)
cols = {tiles[0]: (30, 90, 255), tiles[-1]: (255, 120, 0)}
for tid in tiles:
    t = Tile.from_id(tid); ctx = _Ctx(t); x0, y0 = t.bounds[:2]
    for f in json.load(open(t.path('hydro/channels.geojson')))['features']:
        pr = f['properties']
        if pr.get('on_ice') or pr.get('in_waterbody'): continue
        g = ctx.local(shape(f['geometry']))
        for ln in getattr(g, 'geoms', [g]):
            w = max(1, int(float(pr.get('width') or 1) * sx))
            d.line([P(x + x0, y + y0) for x, y, *_ in ln.coords], fill=cols[tid], width=w)
    if t.path('hydro/edges.json').exists():
        for rr in json.load(open(t.path('hydro/edges.json')))['crossings']:
            x, y = P(rr['x'], rr['y']); d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 255, 0), width=2)
im.save(out); print(out)
