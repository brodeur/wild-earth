"""Permanent snow and ice: the base layer's glacier surface (step `ice`, docs/pipeline.md).

Two sources, unioned: LANDFIRE's Snow-Ice physiognomy (EVT 7735 "North American Glacier and Ice Field", from the tile's
vegetation/evt.tif and classes.json, 30 m) and OpenStreetMap's natural=glacier ways and multipolygons (Overpass, cached
in _cache/overpass_glacier.json; ODbL, a source already credited), burnt at the DEM's 5 m. Writes

  terrain/ice.tif     uint8 at the DEM grid: 1 ice, 0 not (the flora stage keeps these cells bare: species_mix's
                      snow_ice rule and ice override; the water lane can seed meltwater from its lower edge)
  client/ice.png      L, 30 m, 255 on ice (for a client glacier material; nothing reads it yet)
  terrain/ice.json    area, the share from each source, the lowest ice elevation, and the toes (ice cells on the lower
                      edge, where meltwater leaves the ice) as [x, north] tile metres for the water lane

A tile with no ice gets an empty mask and area 0: the step is cheap and its absence is a fact, not a gap.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_bounds

from .config import Tile, write_json

GLACIER_QUERY = """[out:json][timeout:120];
(way["natural"="glacier"]({s},{w},{n},{e});relation["natural"="glacier"]({s},{w},{n},{e}););
out geom;"""


def _osm_glaciers(tile: Tile) -> list:
    from pyproj import Transformer
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, transform as shp_transform, unary_union
    from .fetch_osm import overpass
    w, s, e, n = tile.bounds_wgs84
    data = overpass(GLACIER_QUERY.format(s=s, w=w, n=n, e=e), tile.path("_cache/overpass_glacier.json"), label="ice")
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    polys = []
    for el in data.get("elements", []):
        if el.get("type") == "way" and el.get("geometry"):
            pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                polys.append(Polygon(pts))
        elif el.get("type") == "relation":
            outer = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in el.get("members", [])
                     if m.get("role") == "outer" and m.get("geometry")]
            inner = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]]) for m in el.get("members", [])
                     if m.get("role") == "inner" and m.get("geometry")]
            o = unary_union(list(polygonize(unary_union(outer)))) if outer else None
            if o is not None and not o.is_empty:
                if inner:
                    o = o.difference(unary_union(list(polygonize(unary_union(inner)))))
                polys.append(o)
    return [shp_transform(to_tile, p) for p in polys if p.is_valid and not p.is_empty]


def build_ice(tile: Tile) -> dict:
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        z = src.read(1).astype("float64")
        nodata = src.nodata
        h, w = z.shape
    x0, y0, x1, y1 = tile.bounds
    transform = from_bounds(x0, y0, x1, y1, w, h)
    classes = json.loads(tile.path("vegetation/classes.json").read_text())
    evt_tab = classes.get("evt", {})
    ice_codes = [int(c) for c, e in evt_tab.items() if (e.get("phys") or "").lower() == "snow-ice"]
    with rasterio.open(tile.path("vegetation/evt.tif")) as src:
        evt = src.read(1, out_shape=(h, w), resampling=Resampling.nearest)
    lf = np.isin(evt, ice_codes) if ice_codes else np.zeros((h, w), bool)
    try:
        polys = _osm_glaciers(tile)
    except Exception as ex:  # noqa: BLE001
        from . import runlog
        runlog.fallback(f"OSM glaciers unavailable ({str(ex)[:120]}): LANDFIRE Snow-Ice alone", source="osm")
        polys = []
    osm = (rasterize([(p, 1) for p in polys], out_shape=(h, w), transform=transform, fill=0, dtype="uint8").astype(bool)
           if polys else np.zeros((h, w), bool))
    ice = lf | osm
    prof = {"driver": "GTiff", "dtype": "uint8", "count": 1, "width": w, "height": h, "crs": tile.crs,
            "transform": transform, "compress": "deflate"}
    with rasterio.open(tile.path("terrain/ice.tif"), "w", **prof) as dst:
        dst.write(ice.astype("uint8"), 1)
    k = max(1, round(30 / ((x1 - x0) / w)))
    small = ice[: h - h % k, : w - w % k].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
    Image.fromarray((small * 255).astype("uint8"), "L").save(tile.path("client/ice.png"), optimize=True)
    # the toes: ice cells with a non-ice neighbour lower than themselves, where meltwater leaves the ice
    toes = []
    if ice.any():
        zz = np.where((z == nodata) | ~np.isfinite(z), np.nan, z)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb_ice = np.roll(np.roll(ice, dy, 0), dx, 1)
            nb_z = np.roll(np.roll(zz, dy, 0), dx, 1)
            edge = ice & ~nb_ice & (nb_z < zz)
            ys, xs = np.nonzero(edge)
            for yy, xx in zip(ys[:: max(1, len(ys) // 400)], xs[:: max(1, len(xs) // 400)]):
                toes.append([round((xx + 0.5) * (x1 - x0) / w, 1), round((y1 - y0) - (yy + 0.5) * (y1 - y0) / h, 1)])
    res = (x1 - x0) / w
    info = {"area_ha": round(float(ice.sum()) * res * res / 1e4, 1),
            "from_landfire_ha": round(float(lf.sum()) * res * res / 1e4, 1), "from_osm_ha": round(float(osm.sum()) * res * res / 1e4, 1),
            "lowest_m": round(float(np.nanmin(np.where(ice, z, np.nan))), 1) if ice.any() else None,
            "landfire_codes": ice_codes, "osm_polygons": len(polys), "toes": toes[:800]}
    write_json(tile.path("terrain/ice.json"), info)
    return {"path": "terrain/ice.tif", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds), "resolution_m": res,
            "files": {"client/ice.png": {}, "terrain/ice.json": {}}, "sources_used": ["landfire", "osm"],
            "encoding": "uint8 1 = permanent snow or ice; client/ice.png 255 = ice at 30 m",
            **{k: v for k, v in info.items() if k != "toes"}, "toes": len(info["toes"])}
