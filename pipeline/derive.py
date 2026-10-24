"""Derived products for viewers: hillshade, Terrain-RGB, rasterised mask, imagery PNG.

Analysis happens on the metric UTM grid (gradients, buffers); the PNGs are then warped
to a WGS84 grid covering `bounds_wgs84` so web viewers can drape them on a plain
lon/lat bounding box with no residual rotation.
"""
from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from .config import TILE_SIZE_M, Tile

Image.MAX_IMAGE_PIXELS = None


def _dem(tile: Tile):
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        data = src.read(1)
        nodata = src.nodata
        res = src.res[0]
        transform = src.transform
    mask = data == nodata
    if mask.any():
        data = data.copy()
        data[mask] = data[~mask].mean()
    return data.astype("float64"), res, transform


def _to_wgs84(arr: np.ndarray, src_transform, tile: Tile, resampling, fill=0, size=None):
    """Warp a tile-CRS array (2D or bands-first 3D) onto a WGS84 grid over bounds_wgs84."""
    w, s, e, n = tile.bounds_wgs84
    bands = arr if arr.ndim == 3 else arr[None]
    size = size or bands.shape[-1]
    dst = np.full((bands.shape[0], size, size), fill, dtype=bands.dtype)
    dst_transform = from_bounds(w, s, e, n, size, size)
    for i in range(bands.shape[0]):
        reproject(bands[i], dst[i], src_transform=src_transform, src_crs=tile.crs,
                  dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=resampling,
                  src_nodata=None, dst_nodata=fill)
    return dst if arr.ndim == 3 else dst[0]


def _coverage(tile: Tile, shape_, src_transform) -> np.ndarray:
    """Alpha mask: which WGS84 pixels fall inside the rotated UTM square."""
    ones = np.full(shape_, 255, "uint8")
    return _to_wgs84(ones, src_transform, tile, Resampling.nearest, fill=0)


def _meta(path, tile: Tile, size, extra) -> dict:
    return {"path": path, "kind": "raster", "crs": "EPSG:4326", "bounds": list(tile.bounds_wgs84),
            "pixels": size, **extra}


def hillshade(tile: Tile, azimuth=315.0, altitude=45.0) -> dict:
    z, res, tr = _dem(tile)
    dy, dx = np.gradient(z, res)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = np.radians(azimuth), np.radians(altitude)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    img = (np.clip(shade, 0, 1) * 255).astype("uint8")
    warped = _to_wgs84(img, tr, tile, Resampling.bilinear, fill=0)
    alpha = _coverage(tile, img.shape, tr)
    Image.fromarray(np.dstack([warped, warped, warped, alpha]), "RGBA").save(
        tile.path("terrain/hillshade.png"), optimize=True)
    return _meta("terrain/hillshade.png", tile, warped.shape[0],
                 {"derived_from": "terrain.dem", "params": {"azimuth": azimuth, "altitude": altitude}})


def terrain_rgb(tile: Tile) -> dict:
    """Mapbox Terrain-RGB: height = -10000 + (R*65536 + G*256 + B) * 0.1."""
    z, res, tr = _dem(tile)
    zw = _to_wgs84(z.astype("float32"), tr, tile, Resampling.bilinear, fill=np.nan)
    cover = _coverage(tile, z.shape, tr) > 0
    # Outside the rotated square there is no data; hold the edge value so the mesh stays flat.
    zw = np.where(cover & np.isfinite(zw), zw, float(np.nanmin(zw[cover])) if cover.any() else 0)
    v = np.round((zw + 10000) / 0.1).astype("int64")
    rgb = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype("uint8")
    Image.fromarray(rgb, "RGB").save(tile.path("terrain/terrain_rgb.png"), optimize=True)
    return _meta("terrain/terrain_rgb.png", tile, rgb.shape[0],
                 {"derived_from": "terrain.dem", "encoding": "mapbox-terrain-rgb",
                  "elevation_range_m": [float(zw.min()), float(zw.max())]})


def mask_raster(tile: Tile) -> dict:
    z, res, tr = _dem(tile)
    with open(tile.path("footprint/mask.geojson")) as f:
        fc = json.load(f)
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    shapes = []
    for feat in fc["features"]:
        g = shp_transform(to_tile, shape(feat["geometry"]))
        buf = feat["properties"].get("buffer_m") or 0
        if g.geom_type in ("LineString", "MultiLineString") or buf:
            g = g.buffer(max(buf, res / 2))
        if not g.is_empty:
            shapes.append((g, 255))
    arr = (rasterize(shapes, out_shape=z.shape, transform=tr, fill=0, dtype="uint8")
           if shapes else np.zeros(z.shape, "uint8"))
    warped = _to_wgs84(arr, tr, tile, Resampling.nearest, fill=0)
    Image.fromarray(warped).save(tile.path("footprint/mask.png"), optimize=True)
    return _meta("footprint/mask.png", tile, warped.shape[0],
                 {"derived_from": "footprint.mask", "masked_fraction": float((arr > 0).mean())})


def naip_png(tile: Tile, max_px=2500) -> dict:
    with rasterio.open(tile.path("imagery/naip.tif")) as src:
        data = src.read()
        tr = src.transform
    size = min(max_px, data.shape[-1])
    warped = _to_wgs84(data, tr, tile, Resampling.bilinear, fill=0, size=size)
    alpha = _to_wgs84(np.full(data.shape[1:], 255, "uint8"), tr, tile, Resampling.nearest, 0, size)
    img = np.dstack([np.moveaxis(warped, 0, -1), alpha])
    Image.fromarray(img, "RGBA").save(tile.path("imagery/naip.png"), optimize=True)
    return _meta("imagery/naip.png", tile, size, {"derived_from": "imagery.naip"})


def _habitat_rgba(tile: Tile, rel: str, size: int) -> np.ndarray:
    from .habitat import COLORS
    with rasterio.open(tile.path(rel)) as src:
        hab = src.read(1)
        tr = src.transform
    warped = _to_wgs84(hab, tr, tile, Resampling.nearest, fill=0, size=size)
    rgba = np.zeros((size, size, 4), "uint8")
    for code, rgb in COLORS.items():
        m = warped == code
        rgba[m, :3] = rgb
        rgba[m, 3] = 255
    return rgba


def habitat_png(tile: Tile, size=668) -> dict:
    out = {}
    for name, rel in (("habitat", "vegetation/habitat.tif"), ("habitat_present", "vegetation/habitat_present.tif")):
        rgba = _habitat_rgba(tile, rel, size)
        Image.fromarray(rgba, "RGBA").save(tile.path(f"vegetation/{name}.png"), optimize=True)
        out[f"vegetation.{name}_png"] = _meta(f"vegetation/{name}.png", tile, size, {"derived_from": f"vegetation.{name}"})
    return out


def rewilded_texture(tile: Tile) -> dict:
    """Hillshade modulated by rewilded habitat color: the 'no humans' map."""
    hs = np.asarray(Image.open(tile.path("terrain/hillshade.png")).convert("RGBA"))
    size = hs.shape[0]
    hab = _habitat_rgba(tile, "vegetation/habitat.tif", size).astype("float32")
    shade = hs[..., 0:1].astype("float32") / 255.0
    rgb = (hab[..., :3] * (0.35 + 0.75 * shade)).clip(0, 255).astype("uint8")
    alpha = np.minimum(hs[..., 3], hab[..., 3].astype("uint8"))
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(tile.path("terrain/rewilded.png"), optimize=True)
    return _meta("terrain/rewilded.png", tile, size, {"derived_from": ["terrain.hillshade", "vegetation.habitat"]})


# ---------------------------------------------------------------------------
# Client rasters: the same products on the metric tile grid (no WGS84 warp), so a
# game client can work in tile-local meters. Written under <tile>/client/.
# ---------------------------------------------------------------------------

def _hillshade_array(z: np.ndarray, res: float, azimuth=315.0, altitude=45.0) -> np.ndarray:
    dy, dx = np.gradient(z, res)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = np.radians(azimuth), np.radians(altitude)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


# Roads are decayed, not erased: ten years on, a paved road is a linear clearing of cracked
# pavement with grass in the seams and shrubs creeping in from the verge.
ROAD_SKIP = ("path", "footway", "steps", "cycleway", "bridleway")
ROAD_RINGS = 6     # verge falloff steps beyond the pavement edge
# Half-widths (m) per OSM way for the decayed pavement. OSM's mapping widths in fetch_osm are
# generous (they size the erase mask); a decayed road only keeps its actual paved width.
DECAY_HALF_WIDTH = {"motorway": 8, "motorway_link": 4, "trunk": 7, "trunk_link": 4, "primary": 6, "primary_link": 3.5,
                    "secondary": 5, "secondary_link": 3, "tertiary": 4.5, "residential": 3.5, "unclassified": 3.5,
                    "living_street": 3, "service": 2.5, "track": 2}
ROAD_VERGE = 136   # weight at the verge's inner edge, just below the client's pavement threshold


def _road_weights(tile: Tile, z_shape, res: float, tr):
    """(weight 0..255, major mask) on the DEM grid, or None without a footprint mask.

    Pavement (buffer_m) is 255; the verge beyond it (another 2x buffer_m) starts just under the
    client's pavement threshold (140) and falls linearly to 0, so "> 140" means pavement exactly.
    Tracks count at half weight. Major = motorway..secondary and their links, for the pavement tone."""
    import shapely
    p = tile.dir / "footprint/mask.geojson"
    if not p.exists():
        return None
    with open(p) as f:
        fc = json.load(f)
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True).transform
    geoms, bufs, scale, major = [], [], [], []
    for feat in fc["features"]:
        pr = feat.get("properties") or {}
        hw = pr.get("highway")
        if pr.get("class") != "road" or hw in ROAD_SKIP:
            continue
        g = shp_transform(to_tile, shape(feat["geometry"]))
        if g.is_empty:
            continue
        geoms.append(g)
        bufs.append(max(DECAY_HALF_WIDTH.get(hw, pr.get("buffer_m") or 0), res / 2))
        scale.append(0.5 if hw == "track" else 1.0)
        major.append((hw or "").removesuffix("_link") in MAJOR_ROADS)
    if not geoms:
        return np.zeros(z_shape, "uint8"), np.zeros(z_shape, bool)
    geoms, bufs, scale = np.array(geoms, dtype=object), np.array(bufs), np.array(scale)
    shapes = []
    for k in range(ROAD_RINGS, -1, -1):          # outermost ring first; later (higher) values overwrite
        frac = k / ROAD_RINGS
        rings = shapely.buffer(geoms, bufs * (1 + 2 * frac))
        vals = np.round((255 if k == 0 else ROAD_VERGE * (1 - (k - 1) / ROAD_RINGS)) * scale).astype(int)
        shapes += [(g, int(v)) for g, v in zip(rings, vals) if v > 0]
    shapes.sort(key=lambda gv: gv[1])            # rasterize draws in order: the highest weight wins
    w = rasterize(shapes, out_shape=z_shape, transform=tr, fill=0, dtype="uint8")
    mj = np.array(major)
    maj = (rasterize([(g, 1) for g in shapely.buffer(geoms[mj], bufs[mj] * 3)], out_shape=z_shape,
                     transform=tr, fill=0, dtype="uint8").astype(bool) if mj.any() else np.zeros(z_shape, bool))
    return w, maj


def client_rasters(tile: Tile) -> dict:
    from .habitat import COLORS
    z, res, tr = _dem(tile)
    n = z.shape[0]
    out = {}

    # heights.png: Mapbox Terrain-RGB on the tile grid
    v = np.round((z + 10000) / 0.1).astype("int64")
    rgb = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype("uint8")
    Image.fromarray(rgb, "RGB").save(tile.path("client/heights.png"), optimize=True)
    out["client.heights"] = {"path": "client/heights.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                             "pixels": n, "resolution_m": res, "encoding": "mapbox-terrain-rgb",
                             "elevation_range_m": [float(z.min()), float(z.max())]}

    # habitat.png (R = class code) and canopy.png (R tree %, G shrub %, B herb %) on the 30 m grid
    with rasterio.open(tile.path("vegetation/habitat.tif")) as src:
        hab = src.read(1)
        hres = src.res[0]
    with rasterio.open(tile.path("vegetation/evc.tif")) as src:
        evc = src.read(1)
    tree = np.where((evc >= 101) & (evc <= 199), evc - 100, 0)
    shrub = np.where((evc >= 201) & (evc <= 299), evc - 200, 0)
    herb = np.where((evc >= 301) & (evc <= 399), evc - 300, 0)
    Image.fromarray(hab.astype("uint8"), "L").save(tile.path("client/habitat.png"), optimize=True)
    Image.fromarray(np.dstack([tree, shrub, herb]).astype("uint8"), "RGB").save(tile.path("client/canopy.png"), optimize=True)
    m = hab.shape[0]
    out["client.habitat"] = {"path": "client/habitat.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                             "pixels": m, "resolution_m": hres, "encoding": "R = habitat class code"}
    out["client.canopy"] = {"path": "client/canopy.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                            "pixels": m, "resolution_m": hres, "encoding": "R tree %, G shrub %, B herb %"}

    # mast.png: fall acorn_mast score (0..100) in R on the resource's own metric 30 m grid, for the acorn game.
    mast_tif = tile.path("resources/acorn_mast.tif")
    if mast_tif.exists():
        with rasterio.open(mast_tif) as src:
            fall = list(src.descriptions).index("fall") + 1 if "fall" in (src.descriptions or ()) else 4
            mast = src.read(fall)
            mres = src.res[0]
        Image.fromarray(np.clip(mast, 0, 100).astype("uint8"), "L").save(tile.path("client/mast.png"), optimize=True)
        out["client.mast"] = {"path": "client/mast.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                              "pixels": mast.shape[0], "resolution_m": mres, "derived_from": "resources.acorn_mast",
                              "encoding": "R = fall acorn_mast score 0..100"}

    # texture.png: hillshade modulated by habitat color, on the DEM grid.
    # Habitat colour is upsampled bilinearly (soft edges across 30 m cells), darkened by
    # canopy cover, and broken up with low-frequency value noise so a class is not one flat tone.
    shade = _hillshade_array(z, res)
    color_small = np.zeros((m, m, 3), "float32")
    for code, c in COLORS.items():
        color_small[hab == code] = c
    color = np.asarray(Image.fromarray(color_small.clip(0, 255).astype("uint8"), "RGB").resize((n, n), Image.BILINEAR)).astype("float32")
    cover = np.asarray(Image.fromarray(np.clip(tree + shrub * 0.6, 0, 100).astype("uint8"), "L").resize((n, n), Image.BILINEAR)).astype("float32") / 100
    rng = np.random.default_rng(int.from_bytes(tile.tile_id.encode(), "little") % (2**32))
    noise = np.zeros((n, n), "float32")
    for cells, amp in ((12, 0.10), (40, 0.07), (160, 0.05)):
        small = rng.random((cells, cells)).astype("float32")
        noise += (np.asarray(Image.fromarray((small * 255).astype("uint8"), "L").resize((n, n), Image.BICUBIC)).astype("float32") / 255 - 0.5) * 2 * amp
    canopy_dark = 1.0 - 0.35 * cover
    tex = color * (0.35 + 0.75 * shade[..., None]) * (canopy_dark * (1 + noise))[..., None]

    # roads.png: decayed-road weight (255 pavement, falling to 0 across the verge), and the
    # same roads baked into the texture as worn grey pavement with darker seams and grass in the cracks.
    roads = _road_weights(tile, z.shape, res, tr)
    if roads is not None:
        rw, major = roads
        Image.fromarray(rw, "L").save(tile.path("client/roads.png"), optimize=True)
        out["client.roads"] = {"path": "client/roads.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                               "pixels": n, "resolution_m": res, "derived_from": "footprint.mask",
                               "encoding": "road weight 0..255 (255 pavement, verge 136 falling to 0; tracks half weight)",
                               "road_fraction": float((rw > 140).mean())}
        wt = rw.astype("float32") / 255
        lit = (0.35 + 0.75 * shade)[..., None] * (1 + 0.5 * noise)[..., None]
        pave = np.where(major[..., None], np.float32([170, 164, 154]), np.float32([158, 148, 130])) * lit   # weathered, sun-bleached
        seam = rng.random((n, n)).astype("float32")
        on = wt > 0.55
        pave *= np.where(on & (seam < 0.25), 0.86, 1.0)[..., None]                      # cracks: 25% of pixels a shade darker
        grassy = (on & (seam > 0.96))[..., None]                                         # 4%: grass up through the seams
        pave = np.where(grassy, pave * 0.55 + np.float32([128, 138, 84]) * lit * 0.45, pave)
        t = (wt ** 2)[..., None]   # squared: the verge stays mostly vegetation, the pavement reads crisp
        tex = tex * (1 - t) + pave * t
    tex = tex.clip(0, 255).astype("uint8")
    Image.fromarray(tex, "RGB").save(tile.path("client/texture.png"), optimize=True)
    out["client.texture"] = {"path": "client/texture.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                             "pixels": n, "resolution_m": res, "derived_from": ["terrain.dem", "vegetation.habitat", "vegetation.evc", "footprint.mask"]}

    # masks.png: soft per-class weights for season recolouring in the client shader
    # (R grassland, G oak woodland, B chaparral), blurred across cell edges like the colour.
    masks = np.dstack([(hab == 5), (hab == 1), (hab == 4)]).astype("uint8") * 255
    masks = np.asarray(Image.fromarray(masks, "RGB").resize((n, n), Image.BILINEAR))
    Image.fromarray(masks, "RGB").save(tile.path("client/masks.png"), optimize=True)
    out["client.masks"] = {"path": "client/masks.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                           "pixels": n, "resolution_m": res, "encoding": "R grassland, G oak woodland, B chaparral weights"}

    # Mini-map products: present-day imagery and features, deliberately the real world, not the rewilded one.
    imagery = client_imagery(tile)
    if imagery:
        out["client.imagery"] = imagery
    present = client_texture_present(tile)
    if present:
        out["client.texture_present"] = present
    features = client_features(tile)
    if features:
        out["client.features"] = features
    return out


def client_imagery(tile: Tile, size=1024) -> dict | None:
    """NAIP RGB downsampled onto the metric tile grid for the client mini-map."""
    src_path = tile.dir / "imagery/naip.tif"
    if not src_path.exists():
        return None
    with rasterio.open(src_path) as src:
        data = src.read(indexes=[1, 2, 3])
    img = Image.fromarray(np.moveaxis(data, 0, -1).astype("uint8"), "RGB").resize((size, size), Image.LANCZOS)
    img.save(tile.path("client/imagery.png"), optimize=True)
    return {"path": "client/imagery.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": size, "resolution_m": TILE_SIZE_M / size, "derived_from": "imagery.naip"}


def client_texture_present(tile: Tile, size=4000) -> dict | None:
    """Present-day NAIP, untouched, on the metric tile grid: the "present day peek" texture.

    Same grid and shape as client/texture_imagery.jpg (the erased imagery), so the client can swap
    or cross-fade the two with one set of UVs."""
    src_path = tile.dir / "imagery/naip.tif"
    if not src_path.exists():
        return None
    with rasterio.open(src_path) as src:
        data = src.read(indexes=[1, 2, 3])
        tags = src.tags()
    img = Image.fromarray(np.moveaxis(data, 0, -1).astype("uint8"), "RGB")
    if img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    img.save(tile.path("client/texture_present.jpg"), quality=88)
    year = tags.get("WE_NAIP_YEAR")
    return {"path": "client/texture_present.jpg", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
            "pixels": size, "resolution_m": TILE_SIZE_M / size, "source": tags.get("WE_SOURCE", "pc_naip"),
            "derived_from": ["imagery.naip"],
            "encoding": f"NAIP {year + ' ' if year else ''}RGB as captured (present day, human footprint kept); JPEG q88"}


MINIMAP_ROADS = ("motorway", "motorway_link", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified")
MAJOR_ROADS = ("motorway", "trunk", "primary", "secondary")


def _lines(geom: dict) -> list:
    t, c = geom.get("type"), geom.get("coordinates")
    return [c] if t == "LineString" else list(c) if t == "MultiLineString" else []


def _rings(geom: dict) -> list:
    t, c = geom.get("type"), geom.get("coordinates")
    return [c[0]] if t == "Polygon" and c else [p[0] for p in c if p] if t == "MultiPolygon" else []


def client_features(tile: Tile) -> dict | None:
    """Present-day roads, streams and waterbodies in tile-local metres (x east, north from the south edge)."""
    to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    x0, y0 = tile.bounds[0], tile.bounds[1]

    def local(coords):
        lon, lat = zip(*[(c[0], c[1]) for c in coords])
        xs, ys = to_tile.transform(lon, lat)
        return [[round(x - x0, 1), round(y - y0, 1)] for x, y in zip(xs, ys)]

    def load(rel):
        p = tile.dir / rel
        if not p.exists():
            return None
        with open(p) as f:
            return json.load(f)["features"]

    roads, streams, waterbodies, found = [], [], [], False
    feats = load("footprint/mask.geojson")
    if feats is not None:
        found = True
        for ft in feats:
            pr = ft.get("properties") or {}
            kind = pr.get("highway")
            if pr.get("class") != "road" or kind not in MINIMAP_ROADS:
                continue
            for line in _lines(ft.get("geometry") or {}):
                if len(line) >= 2:
                    roads.append({"name": pr.get("name"), "kind": kind, "major": kind in MAJOR_ROADS, "path": local(line)})
    feats = load("hydro/flowlines.geojson")
    if feats is not None:
        found = True
        for ft in feats:
            pr = ft.get("properties") or {}
            for line in _lines(ft.get("geometry") or {}):
                if len(line) >= 2:
                    streams.append({"name": pr.get("gnis_name") or pr.get("name"), "path": local(line)})
    feats = load("hydro/waterbodies.geojson")
    if feats is not None:
        found = True
        for ft in feats:
            pr = ft.get("properties") or {}
            for ring in _rings(ft.get("geometry") or {}):
                if len(ring) >= 3:
                    waterbodies.append({"name": pr.get("gnis_name") or pr.get("name"), "ring": local(ring)})
    if not found:
        return None
    path = tile.path("client/features.json")
    with open(path, "w") as f:
        json.dump({"roads": roads, "streams": streams, "waterbodies": waterbodies, "size_m": TILE_SIZE_M},
                  f, separators=(",", ":"))
    return {"path": "client/features.json", "kind": "vector", "crs": tile.crs, "bounds": list(tile.bounds),
            "encoding": "tile-local metres [x east, north from south edge]",
            "counts": {"roads": len(roads), "streams": len(streams), "waterbodies": len(waterbodies)},
            "derived_from": ["footprint.mask", "hydro.flowlines", "hydro.waterbodies"]}
