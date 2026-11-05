# plot.py tile cx cy half out.png [scale]: hillshade of the 1 m DEM with NHD (yellow), the 5 m routed lines (red), the rerouted (cyan)
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import shape, box
from pipeline.config import Tile
from pipeline.rewild_hydro import _Ctx
from pipeline.reroute import FineDEM
t = Tile.from_id(sys.argv[1]); cx, cy, h = map(float, sys.argv[2:5]); out = sys.argv[5]
S = float(sys.argv[6]) if len(sys.argv) > 6 else max(1.0, 450 / h)
ctx = _Ctx(t); dem = FineDEM(t, ctx.z)
c0, r0 = int(cx - h), int(1e4 - cy - h); N = int(2 * h)
z = dem.z[max(r0, 0):r0 + N, max(c0, 0):c0 + N].astype("float64")
gy, gx = np.gradient(z)
slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
hs = np.sin(np.radians(45)) * np.cos(slope) + np.cos(np.radians(45)) * np.sin(slope) * np.cos(np.radians(315) - aspect)
zn = (z - z.min()) / max(np.ptp(z), 1e-6)
rgb = np.dstack([0.55 + 0.45 * zn, 0.75 - 0.2 * zn, 0.55 + 0.1 * zn]) * np.clip(hs, 0, 1)[..., None]
img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype("uint8")).resize((int(z.shape[1] * S), int(z.shape[0] * S)), Image.BILINEAR)
d = ImageDraw.Draw(img)
X0, Y1 = max(c0, 0), 1e4 - max(r0, 0)
win = box(cx - h, cy - h, cx + h, cy + h)
def draw(path, color, w):
    p = t.path(path)
    if not p.exists(): return
    for f in json.load(open(p))["features"]:
        g = ctx.local(shape(f["geometry"]))
        for ln in getattr(g, "geoms", [g]):
            if ln.geom_type == "LineString" and ln.intersects(win):
                d.line([((x - X0) * S, (Y1 - y) * S) for x, y in ln.coords], fill=color, width=w)
draw("hydro/flowlines.geojson", (255, 230, 0), 2)
draw("hydro/channels_5m.geojson", (230, 30, 30), 2)
draw("hydro/channels.geojson", (0, 230, 255), 2)
d.text((6, 6), f"{t.tile_id} ({cx:.0f},{cy:.0f}) +-{h:.0f} m  yellow NHD | red 5 m routed | cyan rerouted on 1 m", fill=(255, 255, 255))
img.save(out)
