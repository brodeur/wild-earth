"""Chipped exportImage downloads from ArcGIS ImageServers.

The USGS services time out on large requests, so a tile is fetched as a grid of small
chips (a few concurrent) and mosaicked in memory.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio

from .config import Tile
from .http import download


def fetch_chipped(service_url: str, tile: Tile, res_m: float, cache_prefix: str, *,
                  chip_px=500, bands=1, pixel_type="F32", band_ids: str | None = None,
                  nodata=None, dtype="float32", workers=3, force=False) -> tuple[np.ndarray, int]:
    x0, y0, x1, y1 = tile.bounds
    n = int(round((x1 - x0) / res_m))
    chips = max(1, -(-n // chip_px))
    px = n // chips
    n = px * chips
    step = (x1 - x0) / chips
    mosaic = np.zeros((bands, n, n), dtype)

    def one(rc):
        row, col = rc
        cx0, cx1 = x0 + col * step, x0 + (col + 1) * step
        cy1, cy0 = y1 - row * step, y1 - (row + 1) * step
        raw = tile.path(f"_cache/{cache_prefix}_r{row:02d}c{col:02d}.tif")
        params = {"bbox": f"{cx0},{cy0},{cx1},{cy1}", "bboxSR": tile.epsg, "imageSR": tile.epsg,
                  "size": f"{px},{px}", "format": "tiff", "pixelType": pixel_type,
                  "interpolation": "RSP_BilinearInterpolation", "f": "image"}
        if band_ids:
            params["bandIds"] = band_ids
        if nodata is not None:
            params["noData"] = nodata
        download(service_url + "/exportImage", params, raw, force=force)
        with rasterio.open(raw) as src:
            data = src.read()[:bands]
            if src.nodata is not None and nodata is not None:
                data = np.where(data == src.nodata, nodata, data)
        return row, col, data

    jobs = [(r, c) for r in range(chips) for c in range(chips)]
    with ThreadPoolExecutor(workers) as ex:
        for row, col, data in ex.map(one, jobs):
            mosaic[:, row * px:(row + 1) * px, col * px:(col + 1) * px] = data
    return mosaic, n
