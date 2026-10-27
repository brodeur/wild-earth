"""Weather: last year's hourly weather at the tile centre, so every day of play has the weather it had.

The game picks a day in the chosen season and plays it with the weather from that date a year
before; today's own weather comes live from the dev server (server.py, GET /api/weather/<tile_id>),
which answers in the same `days` format through `days_from_open_meteo` below.

Source: Open-Meteo's historical weather API (archive-api.open-meteo.com, no key; free for
non-commercial use, data CC BY 4.0), `models` left at best_match (ERA5 / ERA5-Land reanalysis,
with recent days filled from the forecast models until the reanalysis catches up). One point is
asked for, the tile centre, never anything a player supplied. Open-Meteo snaps it to its own grid
cell and downscales temperature to its 90 m elevation for that point (`elevation_m`).

The period is the full previous calendar year plus the current year to date, so "that day last
year" exists for every date and today's fallback exists. Hours are fetched in UTC (`timezone=UTC`)
and placed on the local wall clock here with zoneinfo, in the zone Open-Meteo names for the point
(one small `timezone=auto` call, cached): rows are grouped by local date, the hour skipped on the
spring-forward day is filled by repeating the row before it, and on the fall-back day the first of
the repeated hour is kept, so every day has exactly 24 rows, index 0 = 00:00 local. Sunrise and
sunset are UTC instants put on the same clock; tmax, tmin and precip_mm are the local day's hours.

Product (docs/tile-spec.md, Weather):
  client/weather.json   compact JSON: per local date, sunrise / sunset "HH:MM", tmax, tmin,
                        precip_mm and 24 hourly rows of FIELDS (null where the API has none)

The raw answers are cached under pipeline/_cache/weather/<tile>/ (the zone, and one UTC archive
answer per period end date).
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from pyproj import Transformer

from .config import REPO_ROOT, SOURCES, USER_AGENT, Tile, _finite, today

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
CACHE = REPO_ROOT / "pipeline" / "_cache" / "weather"
CREDIT = SOURCES["open_meteo"]["attribution"]
MAX_BYTES = 600_000          # past this the file drops gust_kmh
CLOCK = ("local wall-clock time from UTC via zoneinfo; DST days padded/trimmed to 24 rows (the skipped "
         "spring-forward hour repeats the row before it, the repeated fall-back hour keeps its first)")

HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation", "rain", "snowfall", "snow_depth",
          "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
          "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code"]
DAILY = ["sunrise", "sunset"]   # in UTC; tmax, tmin and precip_mm come from the local day's hours
# Our field name and decimals for each Open-Meteo variable, in HOURLY order (0 = integer).
FIELDS = ["temp_c", "humidity", "precip_mm", "rain_mm", "snow_cm", "snow_depth_m", "cloud", "cloud_low",
          "cloud_mid", "cloud_high", "wind_kmh", "wind_dir", "gust_kmh", "code"]
# Snow depth in cm steps (0.1 m would hide a dusting); wind and gust in whole km/h (the tenths cost 60 KB a year
# and no animal feels them).
DECIMALS = [1, 0, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0]
WET_DAY_MM = 1.0             # stats: a precipitation day has at least this much
SNOW_DAY_CM = 0.5            # stats: a snow day has at least this much snowfall (ERA5 drizzles 0.1 cm of "snow" at 6 C)


def centre_wgs84(tile: Tile) -> tuple[float, float]:
    """(lon, lat) of the tile's centre, rounded to 4 decimals (~10 m; Open-Meteo's cells are km)."""
    x0, y0, x1, y1 = tile.bounds
    lon, lat = Transformer.from_crs(tile.crs, "EPSG:4326", always_xy=True).transform((x0 + x1) / 2, (y0 + y1) / 2)
    return round(lon, 4), round(lat, 4)


def get_json(url: str, params: dict, *, timeout: float = 120, retries: int = 4) -> dict:
    """GET an Open-Meteo answer; waits and tries again on 429 (honouring Retry-After) and 5xx."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                last = RuntimeError(f"{r.status_code} from {url}")
                wait = r.headers.get("Retry-After")
                time.sleep(min(float(wait), 60) if wait and wait.isdigit() else 3 * 2 ** attempt)
                continue
            if r.status_code >= 400:   # Open-Meteo says why in {"error": true, "reason": ...}
                raise RuntimeError(f"{r.status_code} from {url}: {r.text[:300]}")
            d = r.json()
            if d.get("error"):
                raise RuntimeError(f"Open-Meteo: {d.get('reason')}")
            return d
        except requests.RequestException as e:
            last = e
            if attempt < retries - 1:
                time.sleep(3 * 2 ** attempt)
    raise last  # type: ignore[misc]


def _num(v, dec: int):
    """Round, and write a whole number as an integer (0.0 -> 0: most hours have no rain or snow)."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    r = round(float(v), dec)
    return int(r) if dec == 0 or r == int(r) else r


def zone_of(lon: float, lat: float, cache_dir=None) -> str:
    """The IANA zone Open-Meteo names for the point (a one-day `timezone=auto` answer), cached."""
    p = cache_dir / "zone.json" if cache_dir else None
    if p and p.exists():
        return json.loads(p.read_text())["timezone"]
    d = get_json(FORECAST_URL, {"latitude": lat, "longitude": lon, "daily": "sunrise", "forecast_days": 1,
                                "timezone": "auto"}, timeout=30, retries=3)
    if p:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"timezone": d["timezone"], "latitude": d.get("latitude"),
                                 "longitude": d.get("longitude")}))
    return d["timezone"]


def standard_offset_seconds(zone: str, year: int) -> int:
    """The zone's standard-time UTC offset (its offset minus any DST), e.g. -28800 for Pacific."""
    dt = datetime(year, 1, 15, 12, tzinfo=ZoneInfo(zone))
    return int((dt.utcoffset() - dt.dst()).total_seconds())


def _utc(t: str) -> datetime:
    return datetime.fromisoformat(t).replace(tzinfo=timezone.utc)


def days_from_open_meteo(d: dict, zone: str, fields: list[str] = FIELDS) -> dict:
    """An Open-Meteo answer fetched with timezone=UTC (hourly HOURLY, daily sunrise and sunset) as
    {local date: {sunrise, sunset, tmax, tmin, precip_mm, hourly: 24 rows of `fields`}} on the
    zone's wall clock (CLOCK). A row the answer does not reach is a row of nulls. Shared with server.py."""
    if d.get("utc_offset_seconds"):
        raise ValueError("expected an answer in UTC")
    tz = ZoneInfo(zone)
    idx = [FIELDS.index(f) for f in fields]
    h, dl = d.get("hourly") or {}, d.get("daily") or {}
    temp, precip = h.get("temperature_2m") or [], h.get("precipitation") or []
    rows: dict[str, list] = {}          # local date -> 24 slots of (row, raw temp, raw precip) or None
    for n, t in enumerate(h.get("time", [])):
        loc = _utc(t).astimezone(tz)
        slots = rows.setdefault(loc.date().isoformat(), [None] * 24)
        if slots[loc.hour] is not None:   # fall-back: the repeated hour keeps its first
            continue
        row = [_num(h[HOURLY[i]][n], DECIMALS[i]) if HOURLY[i] in h and n < len(h[HOURLY[i]]) else None for i in idx]
        slots[loc.hour] = (row, temp[n] if n < len(temp) else None, precip[n] if n < len(precip) else None)
    sun: dict[str, dict] = {}
    for var in ("sunrise", "sunset"):
        for v in dl.get(var) or []:
            if isinstance(v, str) and len(v) >= 16:
                loc = _utc(v[:16]).astimezone(tz)
                sun.setdefault(loc.date().isoformat(), {})[var] = loc.strftime("%H:%M")
    days: dict[str, dict] = {}
    for day, slots in sorted(rows.items()):
        y, m, dd = map(int, day.split("-"))
        for hr in range(1, 24):   # spring-forward: a wall-clock hour that does not exist repeats the one before
            if slots[hr] is None and slots[hr - 1] is not None:
                wall = datetime(y, m, dd, hr, tzinfo=tz)
                if wall.astimezone(timezone.utc).astimezone(tz).hour != hr:
                    slots[hr] = (slots[hr - 1][0], None, None)   # no raw values: not counted twice in the day
        ts = [s[1] for s in slots if s and s[1] is not None]
        ps = [s[2] for s in slots if s and s[2] is not None]
        days[day] = {"sunrise": sun.get(day, {}).get("sunrise"), "sunset": sun.get(day, {}).get("sunset"),
                     "tmax": _num(max(ts), 1) if ts else None, "tmin": _num(min(ts), 1) if ts else None,
                     "precip_mm": _num(sum(ps), 1) if ps else None,
                     "hourly": [list(s[0]) if s else [None] * len(idx) for s in slots]}
    return days


def _empty(day: dict) -> bool:
    return all(v is None for row in day["hourly"] for v in row)


def _dump(obj) -> str:
    return json.dumps(_finite(obj), separators=(",", ":"), allow_nan=False)


def fetch_weather(tile: Tile, force: bool = False) -> dict:
    lon, lat = centre_wgs84(tile)
    now = datetime.now(timezone.utc).date()
    start, end = date(now.year - 1, 1, 1), now        # UTC today: the archive's last date
    zone = zone_of(lon, lat, CACHE / tile.tile_id)
    cache = CACHE / tile.tile_id / f"archive_utc_{start.isoformat()}_{end.isoformat()}.json"
    if cache.exists() and not force:
        raw = json.loads(cache.read_text())
    else:
        # a day early: east of UTC the local start date begins the UTC day before
        params = {"latitude": lat, "longitude": lon, "start_date": (start - timedelta(days=1)).isoformat(),
                  "end_date": end.isoformat(), "hourly": ",".join(HOURLY), "daily": ",".join(DAILY), "timezone": "UTC",
                  "wind_speed_unit": "kmh", "temperature_unit": "celsius", "precipitation_unit": "mm"}
        raw = get_json(ARCHIVE_URL, params, timeout=300)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(raw))

    def build(fields):
        days = days_from_open_meteo(raw, zone, fields)
        local_today = datetime.now(ZoneInfo(zone)).date().isoformat()
        for k in [k for k in days if k > local_today or k < start.isoformat()]:   # the eve fetched early; no forecasts
            days.pop(k)
        while days and _empty(days[max(days)]):     # days the archive has not reached yet
            days.pop(max(days))
        return days, {
            "source": "open_meteo", "latitude": raw.get("latitude"), "longitude": raw.get("longitude"),
            "elevation_m": raw.get("elevation"), "timezone": zone, "clock": CLOCK,
            "utc_offset_seconds": standard_offset_seconds(zone, start.year),
            "dst": "utc_offset_seconds is standard time; hours, sunrise and sunset are wall-clock, DST applied",
            "fetched": today(),
            "requested_point": [lon, lat], "credit": CREDIT,
            "fields": fields, "days": days}

    fields = list(FIELDS)
    days, out = build(fields)
    text = _dump(out)
    if len(text.encode()) > MAX_BYTES:
        fields.remove("gust_kmh")
        days, out = build(fields)
        text = _dump(out)
    path = tile.path("client/weather.json")
    path.write_text(text + "\n")

    hours = sum(1 for d in days.values() for row in d["hourly"] if any(v is not None for v in row))
    si = fields.index("snow_cm")
    snow = {k: sum(r[si] or 0 for r in d["hourly"]) for k, d in days.items()}
    stats = {"days": len(days), "hours": hours,
             "first_day": min(days) if days else None, "last_day": max(days) if days else None,
             "precip_days": sum(1 for d in days.values() if (d["precip_mm"] or 0) >= WET_DAY_MM),
             "snow_days": sum(1 for v in snow.values() if v >= SNOW_DAY_CM),
             "precip_mm_total": round(sum(d["precip_mm"] or 0 for d in days.values()), 1),
             "tmax_c": max((d["tmax"] for d in days.values() if d["tmax"] is not None), default=None),
             "tmin_c": min((d["tmin"] for d in days.values() if d["tmin"] is not None), default=None)}
    print(f"[{tile.tile_id}] weather: {stats['days']} days {stats['first_day']}..{stats['last_day']}, "
          f"{len(text) / 1000:.0f} KB, {stats['precip_days']} wet, {stats['snow_days']} snow", flush=True)
    return {
        "path": "client/weather.json", "kind": "json", "source": "open_meteo", "credit": CREDIT,
        "point": [lon, lat], "period": [stats["first_day"], stats["last_day"]],
        "timezone": out["timezone"], "clock": CLOCK, "utc_offset_seconds": out["utc_offset_seconds"],
        "elevation_m": out["elevation_m"], "fields": fields, "stats": stats,
        "encoding": ("compact JSON; days keyed by local date YYYY-MM-DD; per day sunrise / sunset 'HH:MM', tmax / tmin "
                     "deg C, precip_mm (the local day's hours), and hourly: 24 rows (index = local wall-clock hour) of "
                     "`fields`; null = no value. Clock: see `clock`; utc_offset_seconds is standard time. Units: temp_c deg C, humidity %, "
                     "precip_mm / rain_mm mm in the hour, snow_cm cm fallen in the hour, snow_depth_m m on the ground, "
                     "cloud* % cover, wind_kmh / gust_kmh km/h at 10 m, wind_dir deg the wind comes from, code WMO "
                     "weather code"),
        "stats_rules": {"precip_days": f"precip_mm >= {WET_DAY_MM}", "snow_days": f"snowfall summed over the day >= {SNOW_DAY_CM} cm"},
    }


def today_weather(tile: Tile, zone: str | None = None, timeout: float = 20) -> dict:
    """Yesterday, today and tomorrow (local dates) from Open-Meteo's forecast API at the tile centre,
    fetched in UTC and put on the wall clock as weather.json, plus `current`. `zone` is the tile's
    (weather.json's `timezone`); without it one small call asks. Raises on failure (server.py answers 503)."""
    lon, lat = centre_wgs84(tile)
    zone = zone or zone_of(lon, lat)
    tz = ZoneInfo(zone)
    params = {"latitude": lat, "longitude": lon, "hourly": ",".join(HOURLY), "daily": ",".join(DAILY),
              "current": "temperature_2m,weather_code,wind_speed_10m,cloud_cover",
              "past_days": 2, "forecast_days": 3, "timezone": "UTC", "wind_speed_unit": "kmh"}
    raw = get_json(FORECAST_URL, params, timeout=timeout, retries=2)
    cur = raw.get("current") or {}
    now = datetime.now(tz).date()
    keep = {(now + timedelta(days=k)).isoformat() for k in (-1, 0, 1)}
    days = {k: v for k, v in days_from_open_meteo(raw, zone).items() if k in keep}
    t = cur.get("time")
    return _finite({
        "source": "open_meteo", "latitude": raw.get("latitude"), "longitude": raw.get("longitude"),
        "elevation_m": raw.get("elevation"), "timezone": zone, "clock": CLOCK,
        "utc_offset_seconds": standard_offset_seconds(zone, now.year),
        "dst": "utc_offset_seconds is standard time; hours, sunrise, sunset and current.time are wall-clock, DST applied",
        "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "credit": CREDIT, "fields": FIELDS,
        "current": {"time": _utc(t).astimezone(tz).strftime("%Y-%m-%dT%H:%M") if t else None,
                    "time_utc": t, "temp_c": _num(cur.get("temperature_2m"), 1),
                    "code": _num(cur.get("weather_code"), 0), "wind_kmh": _num(cur.get("wind_speed_10m"), 1),
                    "cloud": _num(cur.get("cloud_cover"), 0)},
        "days": days})
