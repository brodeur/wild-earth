"""Small HTTP helpers with retries and a cache for raw downloads."""
from __future__ import annotations

import time
from pathlib import Path

import requests

from .config import USER_AGENT

HEADERS = {"User-Agent": USER_AGENT, "Accept": "*/*"}


def get(url: str, params=None, *, timeout=300, retries=3, stream=False) -> requests.Response:
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=timeout, stream=stream)
            if r.status_code < 500:
                r.raise_for_status()
                return r
            last = RuntimeError(f"{r.status_code} from {url}")
        except requests.RequestException as e:  # noqa: PERF203
            last = e
        time.sleep(2 * (attempt + 1))
    raise last  # type: ignore[misc]


def post(url: str, data=None, *, timeout=300, retries=3) -> requests.Response:
    last = None
    for attempt in range(retries):
        try:
            r = requests.post(url, data=data, headers=HEADERS, timeout=timeout)
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r
            last = RuntimeError(f"{r.status_code} from {url}: {r.text[:200]}")
        except requests.RequestException as e:  # noqa: PERF203
            last = e
        time.sleep(5 * (attempt + 1))
    raise last  # type: ignore[misc]


def download(url: str, params, dest: Path, *, force=False) -> Path:
    """Stream a large response to disk; reuse it if already present."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = get(url, params, stream=True, timeout=900)
    ctype = r.headers.get("content-type", "")
    if "json" in ctype or "html" in ctype:
        raise RuntimeError(f"expected binary from {url}, got {ctype}: {r.text[:300]}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    head = b""
    with open(tmp, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            if not head:
                head = chunk[:64]
            f.write(chunk)
    # An ArcGIS ImageServer answers a failed exportImage with a JSON error under an image content-type
    # (2026-10-27: LANDFIRE's "General function failure", 130 bytes of {"error":...} as image/tiff), which must
    # not be cached as the raster: sniff the body.
    if tmp.stat().st_size < 4096 and head.lstrip()[:1] in (b"{", b"<"):
        body = tmp.read_bytes()[:300]
        tmp.unlink()
        raise RuntimeError(f"expected binary from {url}, got an error body: {body!r}")
    tmp.rename(dest)
    return dest
