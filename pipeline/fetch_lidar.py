"""Lidar sources: the USGS 3DEP 1 m bare-earth DEM and the 3DEP point cloud as Entwine Point Tiles.

Both come from AWS public buckets over plain HTTPS (no credentials, no requester-pays):

  1 m DEM     https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/<project>/TIFF/
              USGS_1M_<zone>_x<E/10 km>y<N top/10 km>_<project>.tif, one 10 km UTM cell per file
              (NAD83 UTM, NAVD88 metres, a 6 m apron), so a Wild Earth tile is exactly one file.
  point cloud https://usgs-lidar-public.s3.amazonaws.com/<ept project>/ept.json, Entwine Point Tiles:
              an octree of LAZ chunks in EPSG:3857 with the source's classification and returns.

Projects covering the tile come from the TNM Access API (one bbox query); when that service fails,
from a listing of the bucket's projects and one HEAD per project for the tile's file name. The
newest collection (metadata end date) wins. The EPT project is matched by name stem (the 1 m
project `CA_SierraNevada_B22` was published as EPT `CA_SierraNevada_<n>_2022`), then by overlap.

Nothing downloaded is executed: the DEM is read by rasterio, LAZ chunks are decoded in memory by
laspy/lazrs (requirements-lidar.txt) and never written to disk.
"""
from __future__ import annotations

import io
import json
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from pyproj import Transformer

from .config import SOURCES, USGS_CREDITS, Tile, write_json
from .http import HEADERS, get

TNM_BUCKET = "https://prd-tnm.s3.amazonaws.com"
DEM_PREFIX = "StagedProducts/Elevation/1m/Projects/"
EPT_BUCKET = "https://usgs-lidar-public.s3.amazonaws.com"
TNM_API = "https://tnmaccess.nationalmap.gov/api/v1/products"
DEM_DATASET = "Digital Elevation Model (DEM) 1 meter"
EPT_NOISE = (7, 18)            # ASPRS low and high noise

SOURCES["usgs_3dep_1m"] = {
    "name": "USGS 3DEP 1 m bare-earth DEM (standard 1-meter DEM tiles) via the AWS public bucket prd-tnm",
    "url": f"{TNM_BUCKET}/{DEM_PREFIX}",
    "license": "public domain", "license_url": USGS_CREDITS,
    "attribution": "Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP) 1 m DEM",
    "attribution_url": "https://www.usgs.gov/3d-elevation-program",
    "attribution_required": False,
}
SOURCES["usgs_3dep_lpc"] = {
    "name": "USGS 3DEP lidar point cloud as Entwine Point Tiles via the AWS public bucket usgs-lidar-public",
    "url": f"{EPT_BUCKET}/",
    "license": "public domain", "license_url": USGS_CREDITS,
    "attribution": "Lidar: U.S. Geological Survey, 3D Elevation Program (3DEP) point cloud, "
                   "Entwine Point Tiles by Hobu, Inc. on AWS Open Data",
    "attribution_url": "https://registry.opendata.aws/usgs-lidar/",
    "attribution_required": False,
}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    a = requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32, max_retries=3)
    s.mount("https://", a)
    return s


def dem_tile_name(tile: Tile) -> str:
    """The 1 m product's cell key: x = west edge, y = north edge, in 10 km units."""
    x0, y0, x1, y1 = tile.bounds
    return f"x{int(x0 // 10000)}y{int(y1 // 10000)}"


def _s3_list(bucket: str, prefix: str, delimiter: str | None = "/") -> tuple[list[str], list[dict]]:
    """(common prefixes, objects) under prefix, all pages."""
    prefixes, objects, token = [], [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if delimiter:
            params["delimiter"] = delimiter
        if token:
            params["continuation-token"] = token
        r = get(bucket + "/", params, timeout=120)
        root = ET.fromstring(r.content)
        ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
        prefixes += [p.findtext(f"{ns}Prefix") for p in root.findall(f"{ns}CommonPrefixes")]
        objects += [{"key": c.findtext(f"{ns}Key"), "size": int(c.findtext(f"{ns}Size") or 0)}
                    for c in root.findall(f"{ns}Contents")]
        if root.findtext(f"{ns}IsTruncated") != "true":
            return prefixes, objects
        token = root.findtext(f"{ns}NextContinuationToken")


def _projects_from_tnm(tile: Tile) -> list[str]:
    w, s, e, n = tile.bounds_wgs84
    cx, cy = (w + e) / 2, (s + n) / 2
    r = get(TNM_API, {"datasets": DEM_DATASET, "bbox": f"{cx - 0.005},{cy - 0.005},{cx + 0.005},{cy + 0.005}",
                      "outputFormat": "JSON", "max": 100}, timeout=120, retries=2)
    key = dem_tile_name(tile)
    out = []
    for it in r.json().get("items", []):
        url = it.get("downloadURL") or ""
        m = re.search(r"/Projects/([^/]+)/TIFF/USGS_1M_(\d+)_(x\d+y\d+)_", url)
        if m and m.group(2) == str(tile.zone) and m.group(3) == key:
            out.append(m.group(1))
    return sorted(set(out))


def _projects_from_bucket(tile: Tile) -> list[str]:
    projects, _ = _s3_list(TNM_BUCKET, DEM_PREFIX)
    names = [p[len(DEM_PREFIX):].strip("/") for p in projects]
    key = dem_tile_name(tile)
    s = _session()

    def has(p):
        url = f"{TNM_BUCKET}/{DEM_PREFIX}{p}/TIFF/USGS_1M_{tile.zone}_{key}_{p}.tif"
        try:
            return p if s.head(url, timeout=60).status_code == 200 else None
        except requests.RequestException:
            return None
    with ThreadPoolExecutor(32) as ex:
        return sorted(p for p in ex.map(has, names) if p)


def _dem_meta(tile: Tile, project: str) -> dict:
    """Collection dates from the tile's FGDC metadata (cached as parsed JSON, not as the XML)."""
    key = dem_tile_name(tile)
    url = f"{TNM_BUCKET}/{DEM_PREFIX}{project}/metadata/USGS_1M_{tile.zone}_{key}_{project}.xml"
    root = ET.fromstring(get(url, timeout=120).content)
    beg = root.findtext(".//timeinfo//begdate") or root.findtext(".//begdate")
    end = root.findtext(".//timeinfo//enddate") or root.findtext(".//enddate")
    return {"project": project, "collection_begin": beg, "collection_end": end, "metadata_url": url,
            "url": f"{TNM_BUCKET}/{DEM_PREFIX}{project}/TIFF/USGS_1M_{tile.zone}_{key}_{project}.tif"}


def find_dem_project(tile: Tile, cache: Path) -> dict:
    """Every 1 m project with this tile's cell, newest collection first; cached in cache/projects.json."""
    p = cache / "projects.json"
    if p.exists():
        return json.loads(p.read_text())
    try:
        projects, via = _projects_from_tnm(tile), "tnm_access_api"
    except Exception as e:  # noqa: BLE001
        print(f"TNM Access API failed ({e}); listing the bucket")
        projects, via = [], None
    if not projects:
        projects, via = _projects_from_bucket(tile), "bucket_listing"
    if not projects:
        raise RuntimeError(f"no 3DEP 1 m DEM project covers {tile.tile_id}")
    metas = sorted((_dem_meta(tile, pr) for pr in projects),
                   key=lambda m: m.get("collection_end") or "", reverse=True)
    out = {"found_via": via, "chosen": metas[0], "candidates": metas}
    write_json(p, out)
    return out


class NoPointCloud(RuntimeError):
    """The 1 m collection has no Entwine point cloud in the public bucket (lidar.py then builds DEM-only products)."""


def _stem(project: str) -> str:
    """CA_SierraNevada_B22 -> ca_sierranevada; CA_UpperSouthAmerican_Eldorado_2019_B19 -> ..._eldorado."""
    parts = [x for x in project.split("_") if not re.fullmatch(r"([A-Z]\d{2}|\d{4}|\d{1,2}|QL\d|B\d+[a-z]?)", x)]
    return "_".join(parts).lower()


def _tile_3857(tile: Tile) -> tuple[float, float, float, float]:
    t = Transformer.from_crs(tile.crs, "EPSG:3857", always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    xs, ys = t.transform(np.array([x0, x1, x0, x1, (x0 + x1) / 2]), np.array([y0, y0, y1, y1, y0]))
    return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())


def find_ept(tile: Tile, dem_project: str, cache: Path) -> dict:
    """The EPT project for the chosen 1 m collection (name stem, then overlap with the tile)."""
    p = cache / "ept.json"
    if p.exists():
        return json.loads(p.read_text())
    prefixes, _ = _s3_list(EPT_BUCKET, "")
    names = [x.strip("/") for x in prefixes]
    stem = _stem(dem_project)
    cands = [n for n in names if _stem(n) == stem] or [n for n in names if n.lower().startswith(stem)]
    tb = _tile_3857(tile)
    s = _session()
    hits = []
    for n in cands:
        try:
            e = s.get(f"{EPT_BUCKET}/{n}/ept.json", timeout=60).json()
        except Exception:  # noqa: BLE001
            continue
        b = e.get("boundsConforming") or e["bounds"]
        if b[3] < tb[0] or b[0] > tb[2] or b[4] < tb[1] or b[1] > tb[3]:
            continue
        hits.append({"project": n, "points": e["points"], "bounds": e["bounds"], "span": e["span"],
                     "data_type": e["dataType"], "srs": e.get("srs", {}).get("horizontal"),
                     "schema": [d["name"] for d in e["schema"]], "url": f"{EPT_BUCKET}/{n}/ept.json"})
    if not hits:
        raise NoPointCloud(f"no EPT project matching {dem_project} (stem {stem}) overlaps {tile.tile_id}")
    out = {"dem_project": dem_project, "stem": stem, "candidates": cands, "chosen": hits[0], "overlapping": hits}
    write_json(p, out)
    return out


def ept_nodes(tile: Tile, ept: dict, max_depth: int | None = None, margin_m: float = 0.0) -> list[tuple[str, int]]:
    """Every octree node with points whose footprint overlaps the tile (tested in the tile CRS)."""
    base = ept["url"].rsplit("/", 1)[0]
    B = ept["bounds"]
    width = B[3] - B[0]
    to_utm = Transformer.from_crs("EPSG:3857", tile.crs, always_xy=True)
    x0, y0, x1, y1 = tile.bounds
    x0, y0, x1, y1 = x0 - margin_m, y0 - margin_m, x1 + margin_m, y1 + margin_m
    s = _session()

    def overlaps(d, x, y):
        w = width / 2 ** d
        cx = np.array([B[0] + x * w, B[0] + (x + 1) * w] * 2)
        cy = np.array([B[1] + y * w] * 2 + [B[1] + (y + 1) * w] * 2)
        ux, uy = to_utm.transform(cx, cy)
        return not (ux.max() < x0 or ux.min() > x1 or uy.max() < y0 or uy.min() > y1)

    out = []
    stack = ["0-0-0-0"]
    while stack:
        key = stack.pop()
        h = s.get(f"{base}/ept-hierarchy/{key}.json", timeout=120).json()
        for k, v in h.items():
            d, x, y, _z = map(int, k.split("-"))
            if (max_depth is not None and d > max_depth) or not overlaps(d, x, y):
                continue
            if v == -1:
                if k != key:
                    stack.append(k)
            elif v > 0:
                out.append((k, int(v)))
    return sorted(out, key=lambda kv: tuple(map(int, kv[0].split("-"))))


def read_node(base: str, key: str, session: requests.Session | None = None):
    """One EPT chunk decoded in memory: x, y (EPSG:3857), z, classification, return number, number of
    returns, as numpy arrays. Noise and withheld points are dropped."""
    import laspy
    s = session or _session()
    last = None
    for attempt in range(5):
        try:
            r = s.get(f"{base}/ept-data/{key}.laz", timeout=180)
            if r.status_code == 200:
                las = laspy.read(io.BytesIO(r.content))
                break
            last = RuntimeError(f"{r.status_code} for {key}")
        except Exception as e:  # noqa: BLE001
            last = e
        import time
        time.sleep(2 * (attempt + 1))
    else:
        raise last  # type: ignore[misc]
    cls = np.asarray(las.classification, dtype=np.uint8)
    keep = ~np.isin(cls, EPT_NOISE)
    try:
        keep &= ~np.asarray(las.withheld, dtype=bool)
    except Exception:  # noqa: BLE001
        pass
    return (np.asarray(las.x)[keep], np.asarray(las.y)[keep], np.asarray(las.z, dtype=np.float32)[keep], cls[keep],
            np.asarray(las.return_number, dtype=np.uint8)[keep], np.asarray(las.number_of_returns, dtype=np.uint8)[keep])
