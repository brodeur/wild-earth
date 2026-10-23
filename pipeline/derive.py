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

from .config import Tile

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


def client_rasters(tile: Tile) -> dict:
    from .habitat import COLORS
    z, res, _ = _dem(tile)
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
    tex = (color * (0.35 + 0.75 * shade[..., None]) * (canopy_dark * (1 + noise))[..., None]).clip(0, 255).astype("uint8")
    Image.fromarray(tex, "RGB").save(tile.path("client/texture.png"), optimize=True)
    out["client.texture"] = {"path": "client/texture.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                             "pixels": n, "resolution_m": res, "derived_from": ["terrain.dem", "vegetation.habitat", "vegetation.evc"]}

    # masks.png: soft per-class weights for season recolouring in the client shader
    # (R grassland, G oak woodland, B chaparral), blurred across cell edges like the colour.
    masks = np.dstack([(hab == 5), (hab == 1), (hab == 4)]).astype("uint8") * 255
    masks = np.asarray(Image.fromarray(masks, "RGB").resize((n, n), Image.BILINEAR))
    Image.fromarray(masks, "RGB").save(tile.path("client/masks.png"), optimize=True)
    out["client.masks"] = {"path": "client/masks.png", "kind": "raster", "crs": tile.crs, "bounds": list(tile.bounds),
                           "pixels": n, "resolution_m": res, "encoding": "R grassland, G oak woodland, B chaparral weights"}
    return out
