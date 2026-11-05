import json, sys
import numpy as np, rasterio
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
from shapely.geometry import shape
from pipeline.config import Tile
from pipeline.rewild_hydro import _Ctx
tid, out = sys.argv[1], sys.argv[2]
win = [float(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [0, 0, 10000, 10000]   # x0,y0,x1,y1 local
px = int(sys.argv[4]) if len(sys.argv) > 4 else 1400
t = Tile.from_id(tid); ctx = _Ctx(t)
hs = np.asarray(Image.open(t.path('terrain/hillshade.png')).convert('L')).astype(float)
n = hs.shape[0]; r = 10000 / n
c0, c1 = int(win[0] / r), int(win[2] / r); r0, r1 = int((10000 - win[3]) / r), int((10000 - win[1]) / r)
bg = hs[r0:r1, c0:c1]
img = np.stack([bg] * 3, -1) * 0.8 + 30
if t.path('terrain/ice.tif').exists():
    with rasterio.open(t.path('terrain/ice.tif')) as s: ice = s.read(1) > 0
    k = ice.shape[0] / n
    ic = ice[(np.arange(r0, r1) * k).astype(int)][:, (np.arange(c0, c1) * k).astype(int)]
    img[ic] = img[ic] * 0.5 + np.array([200, 230, 255]) * 0.5
im = Image.fromarray(img.clip(0, 255).astype('uint8')).resize((px, int(px * (r1 - r0) / (c1 - c0))))
sx = px / (win[2] - win[0]); d = ImageDraw.Draw(im)
def P(x, y): return ((x - win[0]) * sx, (win[3] - y) * sx)
for f in json.load(open(t.path('hydro/channels.geojson')))['features']:
    pr = f['properties']; g = ctx.local(shape(f['geometry']))
    for ln in getattr(g, 'geoms', [g]):
        pts = [P(x, y) for x, y, *_ in ln.coords]
        if pr.get('on_ice'): col, w = (120, 120, 120), 1
        elif pr.get('rerouted') == 'meltwater': col, w = (255, 60, 200), 2
        elif pr.get('meltwater'): col, w = (0, 200, 255), 2
        elif pr.get('in_waterbody'): col, w = (0, 120, 0), 1
        else: col, w = (20, 60, 255), 1 + int((pr.get('order') or 1) >= 3)
        d.line(pts, fill=col, width=w)
if t.path('hydro/edges.json').exists():
    for rr in json.load(open(t.path('hydro/edges.json')))['crossings']:
        x, y = P(rr['x'] - t.bounds[0], rr['y'] - t.bounds[1]); d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 140, 0), width=2)
im.save(out); print(out, im.size)
