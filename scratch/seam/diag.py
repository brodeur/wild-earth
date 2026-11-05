import json,sys
from shapely.geometry import shape, Point
from pyproj import Transformer
sys.path.insert(0,'.')
from pipeline.config import Tile
EDGE=439000
for tid in ["utm10n_429_5293","utm10n_439_5293"]:
    t=Tile.from_id(tid); tr=Transformer.from_crs("EPSG:4326",t.crs,always_xy=True)
    print("==",tid,t.bounds)
    for fn in ["hydro/channels.geojson","hydro/channels_5m.geojson","hydro/flowlines.geojson"]:
        fs=json.load(open(t.path(fn)))["features"]
        print(" ",fn,len(fs))
        for f in fs:
            g=f["geometry"]
            if not g: continue
            cs=g["coordinates"] if g["type"]=="LineString" else [c for p in g["coordinates"] for c in p]
            xy=[tr.transform(*c[:2]) for c in cs]
            d=min(abs(x-EDGE) for x,y in xy)
            p=f["properties"]
            if d<300 and ((p.get("order") or p.get("streamorde") or 0)>=3 or p.get("gnis_name") or p.get("name")):
                xs=[(round(x),round(y)) for x,y in xy]
                print("   ",round(d),{k:p.get(k) for k in ["name","gnis_name","order","streamorde","source","area_km2","totdasqkm","rerouted","fcode","in_waterbody"] if p.get(k) is not None}, xs[0], xs[-1], len(xs))
