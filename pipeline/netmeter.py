"""Bytes downloaded per source while a step runs, across the step's worker processes (the cost meter, docs/pipeline.md).

Every HTTP read the pipeline makes through `requests` (http.get/post/download, the Overpass mirrors, the lidar node
reader, the GBIF client) passes Session.send, which is wrapped here once per process: the answer's bytes (the body as
it is read, streamed or not) are added to its source, named from the host (HOSTS). When WE_NETMETER_DIR is set (the
step runner sets it before a step, and the lidar and Sentinel worker processes inherit it), each process writes its
tally to <dir>/<pid>.json every few seconds and at exit; the runner sums the folder after the step.

Not metered: reads GDAL makes itself (rasterio opening a Planetary Computer COG: the NAIP and DEM fallbacks, the
Sentinel-2 looks). Those steps' caches (the Sentinel looks under pipeline/_cache/sentinel) say whether they were read.
"""
from __future__ import annotations

import atexit
import json
import os
import threading
import time
from urllib.parse import urlparse

HOSTS = {  # host suffix -> source key (config.SOURCES / regions.COVERAGE)
    "elevation.nationalmap.gov": "usgs_3dep", "imagery.nationalmap.gov": "usgs_naip", "hydro.nationalmap.gov": "nhdplus_hr",
    "tnmaccess.nationalmap.gov": "usgs_3dep_1m", "prd-tnm.s3.amazonaws.com": "usgs_3dep_1m",
    "usgs-lidar-public.s3.amazonaws.com": "usgs_3dep_lidar", "planetarycomputer.microsoft.com": "planetary_computer",
    "lfps.usgs.gov": "landfire", "landfire.gov": "landfire", "api.gbif.org": "gbif", "overpass-api.de": "osm",
    "overpass.kumi.systems": "osm", "overpass.private.coffee": "osm", "macrostrat.org": "macrostrat",
    "services.arcgis.com": "usgs_sgmc", "sdmdataaccess.sc.egov.usda.gov": "usda_sda", "open-meteo.com": "open_meteo",
    "native-land.ca": "native_land", "earth-search.aws.element84.com": "sentinel2_l2a", "esapubs.org": "eltontraits",
}

_lock = threading.Lock()
_counts: dict = {}
_installed = False
_last_flush = 0.0


def source_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    for h, s in HOSTS.items():
        if host == h or host.endswith("." + h):
            return s
    return host or "unknown"


def _add(src: str, n: int, req: int = 0) -> None:
    global _last_flush
    with _lock:
        c = _counts.setdefault(src, {"bytes": 0, "requests": 0})
        c["bytes"] += n
        c["requests"] += req
    if os.environ.get("WE_NETMETER_DIR") and time.time() - _last_flush > 3:
        flush()


def flush() -> None:
    global _last_flush
    d = os.environ.get("WE_NETMETER_DIR")
    if not d:
        return
    _last_flush = time.time()
    try:
        os.makedirs(d, exist_ok=True)
        with _lock:
            data = json.dumps(_counts)
        tmp = os.path.join(d, f"{os.getpid()}.json.part")
        with open(tmp, "w") as f:
            f.write(data)
        os.replace(tmp, os.path.join(d, f"{os.getpid()}.json"))
    except OSError:
        pass


def reset() -> None:
    with _lock:
        _counts.clear()


def install() -> None:
    """Wrap requests' Session.send once in this process."""
    global _installed
    if _installed:
        return
    try:
        import requests
    except ImportError:
        return
    orig = requests.Session.send

    def send(self, request, **kw):
        resp = orig(self, request, **kw)
        src = source_of(request.url)
        if kw.get("stream"):
            _add(src, 0, 1)
            it = resp.iter_content

            def counted(chunk_size=1, decode_unicode=False):
                for chunk in it(chunk_size=chunk_size, decode_unicode=decode_unicode):
                    _add(src, len(chunk) if chunk else 0)
                    yield chunk
            resp.iter_content = counted
        else:
            _add(src, len(resp.content or b""), 1)
        return resp

    requests.Session.send = send
    atexit.register(flush)
    _installed = True


def collect(d: str) -> dict:
    """Sum the per-process tallies in folder d."""
    out: dict = {}
    if not d or not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        if not f.endswith(".json"):
            continue
        try:
            data = json.loads(open(os.path.join(d, f)).read())
        except (OSError, ValueError):
            continue
        for src, c in data.items():
            o = out.setdefault(src, {"bytes": 0, "requests": 0})
            o["bytes"] += c.get("bytes", 0)
            o["requests"] += c.get("requests", 0)
    return out


if os.environ.get("WE_NETMETER_DIR"):   # a worker process of a metered step
    install()
