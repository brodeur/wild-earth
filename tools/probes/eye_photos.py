"""Eye-level photos of a tile for the held-out judge: openly licensed, geotagged, ground-level landscape photos taken
inside a 10 km tile, found, licence-filtered, downloaded and selected by rule, to be compared later with viewer renders
from the same point and bearing.

    arch -arm64 .venv/bin/python -I tools/probes/eye_photos.py <tile> [--limit 10] [--refresh]

Sources (no account, no key, generic User-Agent, one request a second, every API response cached on disk under
tiles/<tile>/_cache/judge/api/ and never asked again unless --refresh):

  Wikimedia Commons  generator=geosearch (namespace 6, files) over a grid of 16 circles of 1800 m radius covering the
            tile (cell centres 2500 m apart; a circle that returns the 500-result cap is split into four half-size
            circles, down to three levels), prop=coordinates with coprimary=all. What the API really offers: the
            geosearch index holds each file's PRIMARY coordinate, which on Commons is the camera position written by
            {{Location}} / {{Location dec}} (coordinates type "camera"); {{Object location}} (the subject's position)
            comes back as a secondary coordinate, and a few files carry only "landmark" or no type. We keep a file only
            when it has a primary coordinate of type "camera" inside the tile bounds. Headings: the coordinates
            prop does not expose them. Two places do, and both were found populated: structured data
            (action=wbgetentities, ids=M<pageid>) property P1259 "coordinates of the point of view" with qualifier
            P7787 "heading" (a quantity in degrees, Q28390), which a bot has copied from the wikitext for most files;
            and the wikitext itself, {{Location|...|heading:NNN}} (also compass points such as heading:NE). We read the
            structured data first and the wikitext second (prop=revisions, rvslots=main, 50 pages per request), only
            for files that passed the metadata rules. Then prop=imageinfo with iiprop=url|size|mime|extmetadata and
            iiurlwidth=1280, 50 files per request, gives the licence (LicenseShortName, UsageTerms, LicenseUrl),
            author (Artist, Credit), date (DateTimeOriginal), ImageDescription, Categories and a 1280 px rendition.
  iNaturalist  /v1/observations in the tile's WGS84 bounding box, photo_license=cc0,cc-by,cc-by-sa,
            quality_grade=research, iconic_taxa=Plantae, geoprivacy=open, acc_below=50, order_by=votes, 200 a page,
            three pages. Observations with obscured coordinates, unknown or >= 50 m positional accuracy, or a point
            outside the tile are dropped; each photo's own license_code is checked again. These carry no heading and
            are mostly close-ups; the image rules below drop those. The "large" rendition (1024 px long side) is used.

Licences kept: CC0, public domain (PD marks, PD-USGov, PD-self ...), CC BY (any version or port), CC BY-SA (any version
or port). Rejected: anything NC or ND, GFDL-only, fair use, other or unknown or missing.

Metadata rules (in this order; the first that fails is the reason recorded):
  no_camera_location   no primary camera-type coordinate (Commons)
  outside_tile         camera point outside the tile bounds
  obscured / accuracy  iNaturalist coordinates obscured, or positional accuracy unknown or >= 50 m
  licence              licence not in the kept list
  not_jpeg             MIME type other than image/jpeg
  too_small            rendition narrower than MIN_WIDTH (1000 px)
  aspect               width / height outside ASPECT (1.2 .. 2.2): portraits, squares and stitched panoramas
  before_2000          year taken known and earlier than 2000
  kw_<group>           title, description or (non-maintenance) categories match a keyword group below
                       (buildings, people, vehicles, signs, maps, aerial, historical, closeup, night, low_sun, winter);
                       whole-word, case-insensitive. The people group includes work and staff words (crew, staff,
                       rescue, SAR, training ...) because NPS Flickr imports are often titled only by personal names.
                       The photo's month is recorded whatever it is.
  binomial_title       the title is only a Latin binomial (optionally a subspecies or a number) with no place word:
                       a portrait of an organism, not of the land
  flickr_name_only     a Flickr-import title "<words> (digits).jpg" whose words and description contain no place or
                       landscape word (PLACE_RE): such titles are usually people's names
  low_sun_time         the photo's clock time (DateTimeOriginal, else a "YYYY-MM-DD HH MM" time in the file name;
                       iNaturalist time_observed_at) is known and the sun is
                       then below LOW_SUN_DEG (10 deg), taking the lower of the elevations for the longitude's standard
                       UTC offset and for daylight time (camera clocks carry no zone): sunrise, sunset and dusk light
                       cannot be compared with a daytime render

Image rules (after download; PIL, numpy and skimage on a copy shrunk to 256 px wide):
  undecodable          PIL cannot open and fully decode the file as JPEG
  greyscale            mean HSV saturation below GREY_SAT (0.07)
  dark                 mean luminance below DARK (0.18)
  not_wide             not a wide shot. A real sky is required: pixels that are sky-coloured (blue [b > r + 0.03,
                       b >= g - 0.02, V > 0.35] or pale [S < 0.15, V > 0.62]) AND smooth (5x5 mean luminance gradient
                       below SKY_SMOOTH 0.03), in connected regions touching the top edge, covering at least SKY_REGION
                       0.20 of the top quarter (pale rock or bleached twigs behind a close-up are textured or not
                       connected to the top edge, so they no longer count); land below it (at least LAND_BELOW 0.60 of
                       the lower half not sky); and detail spread over the lower half (at least DETAIL_SPREAD 0.5 of
                       the lower-half cells of an 8x8 grid hold DETAIL_FRAC 0.2 of the busiest cell's Laplacian energy).
  silhouette           land luminance (lower half, not sky) below SILHOUETTE 0.30 of the sky's: a backlit skyline
                       The numbers (and the older sky_top / horizon_step measures, kept for reference) are recorded per
                       selected photo.

Selection (deterministic): candidates that passed the metadata rules; files with a known heading first, then the rest;
within each tier, greedy farthest-point in tile-plane metres (x = easting - xmin, north = northing - ymin), each new pick
the candidate whose distance to the nearest already chosen photo is largest, never closer than MIN_SEP_M (300 m), at most
INAT_CAP (3) from iNaturalist; the first pick and ties go to the larger image, then the id. Each pick is downloaded and
must pass the image rules, else it is recorded as rejected and the next is tried.

Downloads are untrusted data: each photo in its own new directory tiles/<tile>/_cache/judge/photos/<source>_<id>/ as
photo.jpg plus meta.json, read only by PIL, never executed. The tracked output is tiles/<tile>/judge/eye_photos.json.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UA = "wild-earth-pipeline/0.2 (open-source tile builder; held-out judge)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
INAT_API = "https://api.inaturalist.org/v1"

MIN_WIDTH = 1000
ASPECT = (1.2, 2.2)
MIN_YEAR = 2000
MIN_SEP_M = 300.0
INAT_CAP = 3
INAT_PAGES = 3
GRID = 4                 # 4 x 4 circles
CIRCLE_R = 1800.0        # covers a 2500 m cell (half diagonal 1768 m)
SPLIT_DEPTH = 3
GEO_CAP = 500

GREY_SAT = 0.07
SKY_SHARE = 0.25
HORIZON_STEP = 0.10
HORIZON_TEXTURE = 1.8
DETAIL_FRAC = 0.2
DETAIL_SPREAD = 0.5
SKY_SMOOTH = 0.03       # 5x5 mean luminance gradient below which a sky-coloured pixel counts as smooth
SKY_REGION = 0.20       # share of the top quarter covered by smooth sky connected to the top edge
LAND_BELOW = 0.60       # share of the lower half that is not that sky
SILHOUETTE = 0.30       # land luminance below this fraction of the sky's: land in silhouette
DARK = 0.18             # mean luminance below this: a dark (night, dusk) photo
LOW_SUN_DEG = 10.0      # sun elevation at the photo's clock time below this (either UTC offset guess): low sun

LICENCES_KEPT = ["CC0", "Public domain (PD marks, PD-USGov, PD-self ...)", "CC BY (any version)", "CC BY-SA (any version)"]
INAT_LICENCES = {"cc0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
                 "cc-by": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
                 "cc-by-sa": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/")}

# Whole-word keyword groups (regex alternations, matched case-insensitively against title, description, categories).
KEYWORDS = {
    "buildings": r"buildings?|house|houses|hotel|lodge|cabin|cabins|church|chapel|museum|interior|inside|rooms?|"
                 r"restaurant|store|shop|visitor cent(?:er|re)|station|tower|watchtower|dam|ruins?|pueblo|architecture|"
                 r"village|campground|camp ?site|parking|car park|road|roads|highway|street|bridge|tunnel|fence|"
                 r"amphitheat(?:er|re)|kiosk|toilet|restroom|cafeteria|ahwahnee|el tovar|bright angel lodge|"
                 r"kolb studio|hopi house|lookout tower|stable|barn|corral|ranch|construction",
    "people": r"person|people|man|woman|men|women|boy|girl|boys|girls|child|children|kids?|family|portrait|selfie|"
              r"self-portrait|tourists?|hikers?|climbers?|climbing|visitors?|crowd|crowds|ranger|rangers|wedding|couple|"
              r"friends|group|posing|me|my wife|my husband|bride|groom|backpackers?|campers?|mule ride|mules|crews?|staff|"
              r"employees?|volunteers?|workers?|team|specialists?|rescuers?|rescue|search and rescue|sar|training|"
              r"exercise|drill|interns?|students?|class|instructors?|patients?|litter|rope|ropes",
    "vehicles": r"cars?|trucks?|bus|buses|shuttle|trains?|railway|railroad|locomotive|vehicles?|automobiles?|"
                r"bicycles?|bikes?|motorcycles?|rv|rafts?|rafting|boats?|kayaks?|canoes?|dory|dories",
    "signs": r"signs?|signage|plaque|plaques|marker|monument|information board|interpretive|placard|trailhead",
    "maps": r"maps?|diagram|chart|topographic|relief model|plan|schematic|infographic|logo|cross[- ]section|geologic map",
    "aerial": r"aerial|from the air|from above|drone|uav|satellite|landsat|sentinel|iss|astronaut|airplane|aeroplane|"
              r"aircraft|helicopter|flight|flying over|overflight|bird'?s[- ]eye|orthophoto",
    "historical": r"historic|historical|history|vintage|antique|black and white|black-and-white|b&w|b/w|monochrome|"
                  r"sepia|1[89]\d0s|19th century|20th century|photochrom|lantern slide|stereograph|stereoview|"
                  r"postcard|painting|drawing|illustration|engraving|lithograph|sketch|scan|scanned|archive|archival",
    "closeup": r"close[- ]?up|closeups?|macro|detail|flowers?|flowering|blossoms?|bloom|blooms|petals?|leaf|leaves|"
               r"seeds?|cone|cones|bark|fungus|fungi|mushrooms?|lichen|moss|insects?|butterfl(?:y|ies)|moth|bee|"
               r"beetle|spider|birds?|raven|jay|eagle|hawk|owl|lizard|snake|squirrels?|chipmunks?|deer|elk|bison|"
               r"buffalo|bears?|wolf|wolves|coyotes?|pronghorn|bighorn|sheep|condor|marmot|wildlife|animal|animals|"
               r"specimen|fossil|rock sample|crystal",
    "night": r"night|nighttime|night sky|milky way|stars|star trails?|astrophotography|moon|moonlight|moonrise|"
             r"aurora|fireworks|lightning",
    "low_sun": r"sunset|sunsets|sunrise|sunrises|dusk|dawn|twilight|golden hour|afterglow|alpenglow|blue hour",
    "winter": r"snow|snowy|snowfall|snowstorm|blizzard|winter|wintry|frost|frozen|ice|icy|icicles?",
}
KEYWORD_RE = {k: re.compile(r"(?<![\w-])(?:" + v + r")(?![\w-])", re.I) for k, v in KEYWORDS.items()}

# Commons maintenance / provenance categories that are not about the picture's content (e.g. "Pages with maps").
MAINTENANCE_CAT = re.compile(
    r"^(?:pages? with|files? with|files? by|media with|media needing|uploaded|taken with|taken on|photographs taken on|"
    r"cc[- ]|pd[- ]|license|licence|self[- ]published|images? from|images? by|photos? by|photographs by|flickr|panoramio|"
    r"quality images|valued images|featured pictures|location|wikidata|wiki loves|exif|retouched|"
    r"user:|supported by|created with|categories|uploads|ccby|copyright|unidentified|cc-zero|gfdl|"
    r"structured data|scans? |nps |images with)", re.I)

FLICKR_TITLE = re.compile(r"^(?:File:)?(.+?)\s*\(\d{6,}\)\.jpe?g$", re.I)
PLACE_RE = re.compile(r"(?<![\w-])(?:canyon|valley|river|creek|falls?|trail|rim|point|mountains?|mount|mt|peak|dome|"
                      r"meadows?|forest|woods|view|vista|overlook|lake|ridge|butte|mesa|plateau|park|national|landscape|"
                      r"gorge|cliffs?|rocks?|desert|prairie|hills?|grassland|yosemite|yellowstone|lamar|grand|merced|"
                      r"colorado|scenery|scenic|panorama|wilderness|basin|slope|summit|spring|springs)(?![\w-])", re.I)
BINOMIAL_TITLE = re.compile(r"^[A-Z][a-z]+ [a-z]{3,}(?: (?:subsp\.|var\.|ssp\.)? ?[a-z]{3,})?(?:[ -]+\d+)?$")
COMPASS = {n: i * 22.5 for i, n in enumerate(
    "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split())}
REASON_ORDER = ["no_camera_location", "outside_tile", "obscured", "accuracy", "licence", "not_jpeg", "too_small",
                "aspect", "before_2000"] + [f"kw_{k}" for k in KEYWORDS] + ["binomial_title", "flickr_name_only", "low_sun_time",
                "undecodable", "greyscale", "dark", "not_wide", "silhouette"]


# ------------------------------------------------------------------------------------------------- pure functions

def strip_html(v) -> str:
    s = re.sub(r"<[^>]+>", " ", str(v or ""))
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def licence_ok(short_name: str | None, usage_terms: str | None = None) -> bool:
    """True for CC0, public domain, CC BY or CC BY-SA (any version); False for NC, ND, GFDL-only, fair use, unknown."""
    texts = [t for t in (short_name, usage_terms) if t and str(t).strip()]
    if not texts:
        return False
    for raw in texts:
        s = re.sub(r"[-_/,]+", " ", strip_html(raw).lower())
        s = re.sub(r"\s+", " ", s).strip()
        if re.search(r"\b(nc|nd|non ?commercial|no ?derivs?|no ?derivatives|fair use|all rights reserved)\b", s):
            return False
    for raw in texts:
        s = re.sub(r"[-_/,]+", " ", strip_html(raw).lower())
        s = re.sub(r"\s+", " ", s).strip()
        if re.match(r"^(cc0|cc zero|creative commons zero)\b", s):
            return True
        if re.match(r"^(public domain|pd)\b", s):
            return True
        if re.match(r"^cc by( sa)?( \d(\.\d)?)*\b", s):
            return True
        if re.match(r"^creative commons attribution( share ?alike)?( \d(\.\d)?)?\b", s):
            return True
    return False


def parse_heading_wikitext(text: str | None) -> float | None:
    """The camera heading from {{Location|...|heading:NNN}} / {{Location dec}} / {{Camera location}} (not
    {{Object location}}); degrees clockwise from north in [0, 360), or None."""
    if not text:
        return None
    for m in re.finditer(r"\{\{\s*(location(?: dec)?|camera location(?: dec)?)\s*\|([^{}]*)\}\}", text, re.I):
        for h in re.finditer(r"heading\s*[:=]\s*([0-9.+-]+|[NSEW]{1,3})(?=[_|}\s]|$)", m.group(2), re.I):
            v = h.group(1).upper()
            if v in COMPASS:
                return COMPASS[v]
            try:
                f = float(v)
            except ValueError:
                continue
            if math.isfinite(f):
                return f % 360.0
    return None


def parse_taken(v) -> tuple:
    """(iso date or year string, year, month) from a DateTimeOriginal / observed_on value; Nones when unknown."""
    s = strip_html(v)
    m = re.search(r"\b(1[89]\d\d|20\d\d)(?:[-:/.](\d{1,2})(?:[-:/.](\d{1,2}))?)?", s)
    if not m:
        return None, None, None
    y = int(m.group(1))
    mo = int(m.group(2)) if m.group(2) and 1 <= int(m.group(2)) <= 12 else None
    d = int(m.group(3)) if mo and m.group(3) and 1 <= int(m.group(3)) <= 31 else None
    iso = f"{y:04d}" + (f"-{mo:02d}" if mo else "") + (f"-{d:02d}" if d else "")
    return iso, y, mo


def content_categories(cats) -> list:
    out = []
    for c in (cats if isinstance(cats, list) else str(cats or "").split("|")):
        c = c.replace("_", " ").strip()
        if c and not MAINTENANCE_CAT.match(c):
            out.append(c)
    return out


def keyword_group(text: str) -> str | None:
    for k, rx in KEYWORD_RE.items():
        if rx.search(text or ""):
            return k
    return None


def metadata_reject_reason(c: dict) -> str | None:
    """The first metadata rule a candidate fails, or None. Expects keys: camera (bool), inside (bool), licence_ok
    (bool), mime, width, height, year, title, description, categories; iNaturalist ones also obscured, accuracy."""
    if not c.get("camera", True):
        return "no_camera_location"
    if not c.get("inside", True):
        return "outside_tile"
    if c.get("source") == "inaturalist":
        if c.get("obscured"):
            return "obscured"
        acc = c.get("accuracy")
        if acc is None or acc >= 50:
            return "accuracy"
    if not c.get("licence_ok"):
        return "licence"
    if (c.get("mime") or "").lower() not in ("image/jpeg", "image/jpg"):
        return "not_jpeg"
    w, h = c.get("width") or 0, c.get("height") or 0
    if w < MIN_WIDTH:
        return "too_small"
    if not h or not (ASPECT[0] <= w / h <= ASPECT[1]):
        return "aspect"
    if c.get("year") is not None and c["year"] < MIN_YEAR:
        return "before_2000"
    text = " ".join([c.get("title") or "", c.get("description") or ""] + content_categories(c.get("categories")))
    text = re.sub(r"\.(jpe?g|png|tiff?)\b", " ", text.replace("_", " "), flags=re.I)
    g = keyword_group(text)
    if g:
        return f"kw_{g}"
    name = re.sub(r"^File:|\.(jpe?g)$|\s*\(\d+\)$", "", (c.get("title") or "").replace("_", " "), flags=re.I).strip()
    if BINOMIAL_TITLE.match(name) and not PLACE_RE.search(name):
        return "binomial_title"
    m = FLICKR_TITLE.match((c.get("title") or "").replace("_", " "))
    if m and not PLACE_RE.search(m.group(1) + " " + (c.get("description") or "")):
        return "flickr_name_only"
    el = c.get("sun_elevation")
    if el is not None and el < LOW_SUN_DEG:
        return "low_sun_time"
    return None


def sun_elevation(lat: float, lon: float, y: int, mo: int, d: int, hh: int, mm: int, utc_offset_h: float) -> float:
    """Solar elevation in degrees at a local clock time (NOAA approximation, good to about a degree)."""
    n = (_dt.date(y, mo, d) - _dt.date(y, 1, 1)).days + 1
    g = 2 * math.pi / 365.0 * (n - 1 + (hh - 12) / 24.0)
    eot = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g)
                    - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hh * 60 + mm + eot + 4 * lon - 60 * utc_offset_h
    ha = math.radians(tst / 4.0 - 180.0)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1.0, min(1.0, cz))))


def low_sun_elevation(lat: float, lon: float, when: str | None) -> float | None:
    """The sun's elevation at a photo's clock time 'YYYY-MM-DD HH:MM[...]' (camera clocks are local and carry no zone):
    the lower of the two values for the longitude's standard offset and for daylight time, or None with no time."""
    m = re.search(r"\b(20\d\d|19\d\d)[-:/](\d\d)[-:/](\d\d)[ T_](\d\d)[: _.](\d\d)", strip_html(when))
    if not m:
        return None
    y, mo, d, hh, mm = (int(v) for v in m.groups())
    if not (1 <= mo <= 12 and 1 <= d <= 31 and hh < 24 and mm < 60) or (hh == 0 and mm == 0):
        return None   # midnight is how a date without a time is often written
    std = round(lon / 15.0)
    try:
        return round(min(sun_elevation(lat, lon, y, mo, d, hh, mm, std), sun_elevation(lat, lon, y, mo, d, hh, mm, std + 1)), 1)
    except ValueError:
        return None


def wide_shot_stats(im) -> dict:
    """Cheap numbers on a PIL image: saturation, sky share in the top quarter, horizon step and texture ratio, and how
    widely detail spreads over the lower half."""
    import numpy as np
    from PIL import Image
    im = im.convert("RGB")
    if im.width > 256:
        im = im.resize((256, max(1, round(im.height * 256 / im.width))), Image.BILINEAR)
    rgb = np.asarray(im, dtype=np.float32) / 255.0
    hsv = np.asarray(im.convert("HSV"), dtype=np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    S, V = hsv[..., 1], hsv[..., 2]
    H, W = V.shape
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sky = ((b > r + 0.03) & (b >= g - 0.02) & (V > 0.35)) | ((S < 0.15) & (V > 0.62))
    top = sky[: max(1, H // 4)]
    gy = np.abs(np.diff(lum, axis=0))[:, :-1] if H > 1 and W > 1 else np.zeros((1, 1), np.float32)
    gx = np.abs(np.diff(lum, axis=1))[:-1, :] if H > 1 and W > 1 else np.zeros((1, 1), np.float32)
    grad = gx + gy
    k = max(2, H // 20)
    best_step, best_tex, best_y = 0.0, 0.0, None
    rows = lum.mean(axis=1)
    rowtex = grad.mean(axis=1) if grad.shape[0] else np.zeros(1)
    for y in range(max(k, int(0.10 * H)), min(H - k, int(0.75 * H))):
        step = float(rows[y - k:y].mean() - rows[y:y + k].mean())
        above = float(rowtex[max(0, y - k):max(1, y - 1)].mean()) if y > 1 else 0.0
        below = float(rowtex[y:min(len(rowtex), y + 3 * k)].mean())
        tex = below / max(above, 1e-3)
        if step >= HORIZON_STEP and tex >= HORIZON_TEXTURE and step > best_step:
            best_step, best_tex, best_y = step, tex, y
    # detail spread: 8 x 8 grid of Laplacian energy; lower-half cells holding a fair share of the busiest cell's.
    lap = np.zeros_like(lum)
    if H > 2 and W > 2:
        lap[1:-1, 1:-1] = np.abs(4 * lum[1:-1, 1:-1] - lum[:-2, 1:-1] - lum[2:, 1:-1] - lum[1:-1, :-2] - lum[1:-1, 2:])
    cells = np.array([[lap[i * H // 8:(i + 1) * H // 8, j * W // 8:(j + 1) * W // 8].mean() if H >= 8 and W >= 8 else 0.0
                       for j in range(8)] for i in range(8)])
    mx = float(cells.max()) if cells.size else 0.0
    lower = cells[4:]
    spread = float((lower >= DETAIL_FRAC * mx).mean()) if mx > 0 else 0.0
    # a real sky: sky-coloured AND smooth (5x5 mean gradient below SKY_SMOOTH), in regions connected to the top edge.
    from skimage.measure import label
    gpad = np.zeros_like(lum)
    gpad[:grad.shape[0], :grad.shape[1]] = grad
    from PIL import ImageFilter
    gimg = Image.fromarray(np.clip(gpad * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))
    smooth = np.asarray(gimg, dtype=np.float32) / 255.0 < SKY_SMOOTH
    lab = label(sky & smooth, connectivity=2)
    top_ids = np.unique(lab[0][lab[0] > 0])
    region = np.isin(lab, top_ids) if top_ids.size else np.zeros_like(sky)
    q = max(1, H // 4)
    sky_region_top = float(region[:q].mean())
    land_below = float(1.0 - region[H // 2:].mean())
    sky_lum = float(lum[region].mean()) if region.any() else None
    nonsky = ~region
    nonsky[: H // 2] = False
    land_lum = float(lum[nonsky].mean()) if nonsky.any() else float(lum[H // 2:].mean())
    warm = float((r - b)[region].mean()) if region.any() else None
    # the warmest sky row (rows where the real sky covers >= 20% of the width): an orange band at sunrise or sunset
    band = None
    rb = r - b
    for y in range(H):
        m = region[y]
        if m.mean() >= 0.2:
            v = float(rb[y][m].mean())
            band = v if band is None else max(band, v)
    return {"saturation": round(float(S.mean()), 4), "sky_top": round(float(top.mean()), 4),
            "sky_region_top": round(sky_region_top, 4), "land_below": round(land_below, 4),
            "sky_lum": None if sky_lum is None else round(sky_lum, 4), "land_lum": round(land_lum, 4),
            "mean_lum": round(float(lum.mean()), 4), "sky_warmth": None if warm is None else round(warm, 4),
            "sky_warm_band": None if band is None else round(band, 4),
            "horizon_step": round(best_step, 4), "horizon_texture": round(best_tex, 3),
            "horizon_row": None if best_y is None else round(best_y / H, 3), "detail_spread": round(spread, 3)}


def image_reject_reason(st: dict) -> str | None:
    if st["saturation"] < GREY_SAT:
        return "greyscale"
    if st["mean_lum"] < DARK:
        return "dark"
    if st["sky_region_top"] < SKY_REGION or st["land_below"] < LAND_BELOW or st["detail_spread"] < DETAIL_SPREAD:
        return "not_wide"
    if st["sky_lum"] and st["land_lum"] < SILHOUETTE * st["sky_lum"]:
        return "silhouette"
    return None


def select(candidates: list, limit: int = 10, min_sep_m: float = MIN_SEP_M, accept=None, inat_cap: int = INAT_CAP) -> list:
    """Heading known first, then the rest; within a tier greedy farthest-point in tile-plane metres, at least min_sep_m
    apart, at most inat_cap from iNaturalist; first pick and ties by larger image then id. accept(c) -> bool is called
    on each pick (download and image rules); a refused pick is skipped for good."""
    def size(c):
        return (c.get("width") or 0) * (c.get("height") or 0)

    chosen, refused = [], set()
    tiers = [[c for c in candidates if c.get("heading") is not None], [c for c in candidates if c.get("heading") is None]]
    for tier in tiers:
        pool = sorted(tier, key=lambda c: (-size(c), str(c["id"])))
        while len(chosen) < limit:
            best, best_key = None, None
            n_inat = sum(c.get("source") == "inaturalist" for c in chosen)
            for c in pool:
                if c["id"] in refused or any(c is s for s in chosen):
                    continue
                if c.get("source") == "inaturalist" and n_inat >= inat_cap:
                    continue
                d = min((math.hypot(c["x"] - s["x"], c["north"] - s["north"]) for s in chosen), default=math.inf)
                if d < min_sep_m:
                    continue
                key = (d, size(c))
                if best is None or key > best_key:   # strict: pool order (size desc, id) breaks exact ties
                    best, best_key = c, key
            if best is None:
                break
            if accept is None or accept(best):
                chosen.append(best)
            else:
                refused.add(best["id"])
    return chosen


# ------------------------------------------------------------------------------------------------- network code

class Fetcher:
    """One polite client: cached JSON GETs, at most one network request a second, curl fallback on TLS trouble."""

    def __init__(self, cache: Path, refresh: bool = False, log=print):
        self.cache, self.refresh, self.log = cache, refresh, log
        self.cache.mkdir(parents=True, exist_ok=True)
        self._last = 0.0
        self._session = None
        self.network = 0
        self.failed = 0

    def _wait(self):
        dt = time.time() - self._last
        if dt < 1.05:
            time.sleep(1.05 - dt)
        self._last = time.time()

    def _raw(self, url: str, params: dict | None = None) -> bytes | None:
        import urllib.parse
        full = url + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(3):
            self._wait()
            self.network += 1
            try:
                import warnings
                warnings.filterwarnings("ignore")
                import requests
                if self._session is None:
                    self._session = requests.Session()
                    self._session.headers["User-Agent"] = UA
                r = self._session.get(full, timeout=60)
                if r.status_code in (403, 404, 410):
                    self.log(f"  HTTP {r.status_code} {full[:120]}")
                    return None
                if r.status_code in (429, 500, 502, 503, 504):
                    time.sleep(5 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.content
            except Exception as e:  # TLS trouble with LibreSSL: curl
                if "SSL" in repr(e) or "ssl" in repr(e):
                    try:
                        out = subprocess.run(["curl", "-sfL", "--max-time", "60", "-A", UA, full],
                                             capture_output=True, check=True)
                        return out.stdout
                    except subprocess.CalledProcessError:
                        pass
                time.sleep(3 * (attempt + 1))
        return None

    def json(self, url: str, params: dict) -> dict:
        key = hashlib.sha1((url + "?" + json.dumps(params, sort_keys=True)).encode()).hexdigest()[:20]
        p = self.cache / f"{key}.json"
        if p.exists() and not self.refresh:
            return json.loads(p.read_text())
        b = self._raw(url, params)
        try:
            d = json.loads(b) if b else {}
        except ValueError:
            d = {}
        if d and "error" not in d:
            p.write_text(json.dumps({"_url": url, "_params": params, **d}))
        else:
            self.failed += 1
            self.log(f"  no usable response (not cached; a re-run asks again): {url} {str(params)[:160]}")
        return d

    def binary(self, url: str) -> bytes | None:
        return self._raw(url)


def tile_info(tile: str) -> dict:
    m = json.loads((ROOT / "tiles" / tile / "manifest.json").read_text())
    from pyproj import Transformer
    fwd = Transformer.from_crs("EPSG:4326", m["crs"], always_xy=True)
    inv = Transformer.from_crs(m["crs"], "EPSG:4326", always_xy=True)
    return {"tile": tile, "crs": m["crs"], "bounds": m["bounds"], "wgs84": m["bounds_wgs84"], "fwd": fwd, "inv": inv}


def to_plane(t: dict, lat: float, lon: float) -> tuple:
    e, n = t["fwd"].transform(lon, lat)
    xmin, ymin, xmax, ymax = t["bounds"]
    return e - xmin, n - ymin, (xmin <= e <= xmax and ymin <= n <= ymax)


def _commons_query(f: Fetcher, params: dict) -> dict:
    """A query with continuation merged by pageid."""
    base = {"action": "query", "format": "json", **params}
    pages, cont = {}, {}
    for _ in range(40):
        d = f.json(COMMONS_API, {**base, **cont})
        for pid, p in ((d.get("query") or {}).get("pages") or {}).items():
            q = pages.setdefault(pid, {})
            for k, v in p.items():
                if isinstance(v, list) and isinstance(q.get(k), list):
                    q[k] = q[k] + [x for x in v if x not in q[k]]
                else:
                    q.setdefault(k, v)
        if "continue" not in d:
            break
        cont = d["continue"]
    return pages


def commons_candidates(t: dict, f: Fetcher, log=print, per_circle: int = GEO_CAP, split_depth: int = SPLIT_DEPTH) -> list:
    xmin, ymin, xmax, ymax = t["bounds"]
    found, capped = {}, 0

    def circle(cx, cy, half, depth):
        nonlocal capped
        lon, lat = t["inv"].transform(xmin + cx, ymin + cy)
        r = min(10000, int(math.ceil(half * math.sqrt(2) + 30)))
        pages = _commons_query(f, {"generator": "geosearch", "ggsnamespace": 6, "ggscoord": f"{lat:.6f}|{lon:.6f}",
                                   "ggsradius": r, "ggslimit": per_circle, "prop": "coordinates",
                                   "coprop": "type|name|dim|globe", "coprimary": "all", "colimit": "max"})
        if len(pages) >= per_circle and depth < split_depth:
            for dx in (-0.5, 0.5):
                for dy in (-0.5, 0.5):
                    circle(cx + dx * half, cy + dy * half, half / 2, depth + 1)
            return
        if len(pages) >= per_circle:
            capped += 1
        for pid, p in pages.items():
            found.setdefault(int(pid), p)

    step = (xmax - xmin) / GRID
    for i in range(GRID):
        for j in range(GRID):
            circle((i + 0.5) * step, (j + 0.5) * step, step / 2, 0)
    log(f"  commons: {len(found)} files near the tile ({capped} circles still at the cap)")
    cands = []
    for pid, p in sorted(found.items()):
        coords = p.get("coordinates") or []
        cam = next((q for q in coords if q.get("type") == "camera" and "primary" in q and q.get("globe", "earth") == "earth"), None)
        c = {"id": f"commons_{pid}", "source": "commons", "pageid": pid, "title": p.get("title", ""), "camera": cam is not None}
        if cam:
            c["lat"], c["lon"] = cam["lat"], cam["lon"]
            c["x"], c["north"], c["inside"] = to_plane(t, cam["lat"], cam["lon"])
        cands.append(c)
    # imageinfo for those with a camera point in the tile
    need = [c for c in cands if c["camera"] and c["inside"]]
    for k in range(0, len(need), 50):
        batch = need[k:k + 50]
        pages = _commons_query(f, {"prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1280,
                                   "pageids": "|".join(str(c["pageid"]) for c in batch)})
        for c in batch:
            p = pages.get(str(c["pageid"])) or {}
            ii = (p.get("imageinfo") or [{}])[0]
            md = {key: (v or {}).get("value") for key, v in (ii.get("extmetadata") or {}).items()}
            short, terms = strip_html(md.get("LicenseShortName")), strip_html(md.get("UsageTerms"))
            taken, year, month = parse_taken(md.get("DateTimeOriginal"))
            author = strip_html(md.get("Artist")) or strip_html(md.get("Credit"))
            tw, th = ii.get("thumbwidth") or ii.get("width"), ii.get("thumbheight") or ii.get("height")
            c.update({"licence": short or terms, "licence_url": strip_html(md.get("LicenseUrl")) or None,
                      "licence_ok": licence_ok(short, terms), "mime": ii.get("mime"),
                      "url": ii.get("thumburl") or ii.get("url"), "width": tw, "height": th,
                      "orig_width": ii.get("width"), "orig_height": ii.get("height"),
                      "page": ii.get("descriptionurl") or f"https://commons.wikimedia.org/?curid={c['pageid']}",
                      "author": author or None, "credit": strip_html(md.get("Credit")) or None,
                      "description": strip_html(md.get("ImageDescription"))[:600],
                      "categories": md.get("Categories") or "", "taken": taken, "year": year, "month": month})
            name = c["title"].replace("File:", "", 1)
            c["attribution"] = f"{author or 'Unknown author'}, {c['licence']}, via Wikimedia Commons ({name})"
            c["clock"] = strip_html(md.get("DateTimeOriginal"))[:40] or None
            c["sun_elevation"] = low_sun_elevation(c["lat"], c["lon"], md.get("DateTimeOriginal"))
            if c["sun_elevation"] is None:   # a clock time written into the file name, e.g. "2016-03-20 18 12 05 View ..."
                c["sun_elevation"] = low_sun_elevation(c["lat"], c["lon"], c["title"])
    return cands


def commons_headings(cands: list, f: Fetcher) -> None:
    """Structured data P1259/P7787 first, wikitext {{Location|...heading:}} second; sets heading, heading_source."""
    todo = [c for c in cands if c["source"] == "commons"]
    for k in range(0, len(todo), 50):
        batch = todo[k:k + 50]
        d = f.json(COMMONS_API, {"action": "wbgetentities", "format": "json",
                                 "ids": "|".join(f"M{c['pageid']}" for c in batch)})
        ents = d.get("entities") or {}
        for c in batch:
            e = ents.get(f"M{c['pageid']}") or {}
            st = e.get("statements") or e.get("claims") or {}
            for s in st.get("P1259") or []:
                for q in (s.get("qualifiers") or {}).get("P7787") or []:
                    try:
                        v = float(q["datavalue"]["value"]["amount"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if math.isfinite(v):
                        c["heading"], c["heading_source"] = round(v % 360.0, 2), "structured data P7787"
                        break
                if c.get("heading") is not None:
                    break
    rest = [c for c in todo if c.get("heading") is None]
    for k in range(0, len(rest), 50):
        batch = rest[k:k + 50]
        pages = _commons_query(f, {"prop": "revisions", "rvprop": "content", "rvslots": "main",
                                   "pageids": "|".join(str(c["pageid"]) for c in batch)})
        for c in batch:
            p = pages.get(str(c["pageid"])) or {}
            revs = p.get("revisions") or []
            text = ((revs[0].get("slots") or {}).get("main") or {}).get("*") if revs else None
            h = parse_heading_wikitext(text)
            if h is not None:
                c["heading"], c["heading_source"] = round(h, 2), "wikitext"


def inat_candidates(t: dict, f: Fetcher, log=print) -> list:
    w, s, e, n = t["wgs84"]
    cands, seen = [], set()
    for page in range(1, INAT_PAGES + 1):
        d = f.json(f"{INAT_API}/observations", {
            "nelat": f"{n:.6f}", "nelng": f"{e:.6f}", "swlat": f"{s:.6f}", "swlng": f"{w:.6f}",
            "photo_license": "cc0,cc-by,cc-by-sa", "quality_grade": "research", "iconic_taxa": "Plantae",
            "geoprivacy": "open", "acc_below": 50, "photos": "true", "order_by": "votes", "order": "desc",
            "per_page": 200, "page": page})
        res = d.get("results") or []
        for o in res:
            loc = o.get("location") or ""
            try:
                lat, lon = (float(v) for v in loc.split(","))
            except ValueError:
                continue
            x, north, inside = to_plane(t, lat, lon)
            taken, year, month = parse_taken(o.get("observed_on"))
            user = o.get("user") or {}
            taxon = o.get("taxon") or {}
            name = o.get("species_guess") or taxon.get("preferred_common_name") or taxon.get("name") or "plant"
            for ph in o.get("photos") or []:
                if ph["id"] in seen or ph.get("hidden"):
                    continue
                seen.add(ph["id"])
                lic = (ph.get("license_code") or "").lower()
                od = ph.get("original_dimensions") or {}
                ow, oh = od.get("width") or 0, od.get("height") or 0
                k = 1024 / max(ow, oh) if max(ow, oh) > 1024 else 1.0
                lname, lurl = INAT_LICENCES.get(lic, (lic or None, None))
                cands.append({
                    "id": f"inaturalist_{ph['id']}", "source": "inaturalist", "camera": True, "inside": inside,
                    "obscured": bool(o.get("obscured")) or bool(o.get("taxon_geoprivacy") not in (None, "open")),
                    "accuracy": o.get("positional_accuracy"), "lat": lat, "lon": lon, "x": x, "north": north,
                    "licence": lname, "licence_url": lurl, "licence_ok": lic in INAT_LICENCES, "mime": "image/jpeg",
                    "url": (ph.get("url") or "").replace("/square.", "/large."), "width": round(ow * k), "height": round(oh * k),
                    "page": o.get("uri") or f"https://www.inaturalist.org/observations/{o['id']}",
                    "photo_page": f"https://www.inaturalist.org/photos/{ph['id']}",
                    "author": user.get("name") or user.get("login"),
                    "attribution": f"{ph.get('attribution') or user.get('login')}, via iNaturalist",
                    "title": f"{name} (iNaturalist observation {o['id']})", "description": strip_html(o.get("description"))[:600],
                    "categories": "", "taken": taken, "year": year, "month": month,
                    "clock": o.get("time_observed_at"),
                    "sun_elevation": low_sun_elevation(lat, lon, (o.get("time_observed_at") or "")[:16])})
        if len(res) < 200:
            break
    log(f"  inaturalist: {len(cands)} photos from the tile's observations")
    return cands


def download(c: dict, tile: str, f: Fetcher) -> Path | None:
    """The rendition into its own new directory; returns the photo path if it exists or was fetched."""
    folder = ROOT / "tiles" / tile / "_cache" / "judge" / "photos" / c["id"]
    p = folder / "photo.jpg"
    if p.exists() and p.stat().st_size > 2000:
        return p
    if folder.exists() and any(folder.iterdir()):
        return None   # something else is in there: do not mix
    b = f.binary(c["url"]) if c.get("url", "").startswith("https://") else None
    if not b or len(b) < 2000 or b[:3] != b"\xff\xd8\xff":
        return None
    folder.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b)
    return p


def check_image(p: Path) -> tuple:
    from PIL import Image
    try:
        with Image.open(p) as im:
            im.verify()
        with Image.open(p) as im:
            if im.format != "JPEG":
                return "undecodable", None, None
            im.load()
            st = wide_shot_stats(im)
            return image_reject_reason(st), st, im.size
    except Exception:
        return "undecodable", None, None


PUBLIC_KEYS = ["id", "source", "page", "title", "licence", "licence_url", "author", "attribution", "taken", "month",
               "lat", "lon", "x", "north", "heading", "heading_source", "sun_elevation", "width", "height", "cache", "image_stats"]


def run(tile: str, limit: int = 10, refresh: bool = False, log=print, per_circle: int = GEO_CAP, split_depth: int = SPLIT_DEPTH) -> dict:
    t = tile_info(tile)
    f = Fetcher(ROOT / "tiles" / tile / "_cache" / "judge" / "api", refresh=refresh, log=log)
    log(f"{tile}: searching")
    cands = commons_candidates(t, f, log, per_circle, split_depth) + inat_candidates(t, f, log)
    rejected = {}
    passed = []
    for c in cands:
        c.setdefault("heading", None)
        c.setdefault("heading_source", None)
        r = metadata_reject_reason(c)
        if r:
            rejected[r] = rejected.get(r, 0) + 1
        else:
            passed.append(c)
    log(f"  {len(passed)} of {len(cands)} pass the metadata rules; reading headings")
    commons_headings(passed, f)
    log(f"  {sum(c['heading'] is not None for c in passed)} of those have a heading")

    def accept(c):
        p = download(c, tile, f)
        if p is None:
            rejected["undecodable"] = rejected.get("undecodable", 0) + 1
            return False
        reason, st, size = check_image(p)
        c["image_stats"] = st
        if reason:
            rejected[reason] = rejected.get(reason, 0) + 1
            return False
        c["width"], c["height"] = size
        c["cache"] = str(p.relative_to(ROOT))
        (p.parent / "meta.json").write_text(json.dumps({k: c.get(k) for k in PUBLIC_KEYS + ["url", "photo_page", "credit"]}, indent=1))
        return True

    chosen = select(passed, limit, MIN_SEP_M, accept)
    rules = ("Commons files with a primary camera coordinate inside the tile and iNaturalist research-grade Plantae "
             "observations with open coordinates (accuracy < 50 m), CC0 / public domain / CC BY / CC BY-SA only; JPEG, "
             f"rendition >= {MIN_WIDTH} px wide, aspect {ASPECT[0]}-{ASPECT[1]}, taken {MIN_YEAR} or later when dated; "
             "no title/description/category keyword for buildings, people, vehicles, signs, maps, aerial views, "
             "historical images, close-ups of organisms, night, sunrise/sunset/dusk or snow/winter; no title that is only a "
             "Latin binomial; no Flickr-import "
             "title '<words> (digits).jpg' whose words and description name no place or landscape feature; sun at "
             f"least {LOW_SUN_DEG:.0f} deg up at the photo's clock time (lower of standard and daylight offsets) when "
             f"a time is known; after download not greyscale (mean saturation >= {GREY_SAT}), mean luminance >= {DARK}, "
             f"a real sky (sky-coloured pixels with 5x5 mean gradient < {SKY_SMOOTH}, connected to the top edge, "
             f"covering >= {SKY_REGION} of the top quarter) with land below (>= {LAND_BELOW} of the lower half not "
             f"sky), detail spread (>= {DETAIL_SPREAD} of lower-half 8x8 cells holding >= {DETAIL_FRAC} of the busiest "
             f"cell's), and land not in silhouette (land luminance >= {SILHOUETTE} x sky luminance); selected heading-known first, then greedy "
             f"farthest-point in tile metres >= {MIN_SEP_M:.0f} m apart, <= {INAT_CAP} from iNaturalist, ties by "
             "larger image then id. Candidates never reached by the selection were not downloaded.")
    reached = sum(rejected.get(k, 0) for k in ("undecodable", "greyscale", "dark", "not_wide", "silhouette")) + len(chosen)
    out = {"tile": tile, "fetched": _dt.date.today().isoformat(),
           "sources": {"commons": {"api": COMMONS_API, "licences_kept": LICENCES_KEPT,
                                   "query": f"generator=geosearch over {GRID}x{GRID} circles of {CIRCLE_R:.0f} m, {per_circle} "
                                            f"nearest files each" + (f", split at the cap to depth {split_depth}" if split_depth
                                            else ", not split (crawl capped)") + "; camera coordinate inside the tile"},
                       "inaturalist": {"api": f"{INAT_API}/observations", "licences_kept": ["cc0", "cc-by", "cc-by-sa"],
                                       "query": "bbox, research grade, Plantae, geoprivacy open, acc_below 50, "
                                                f"order_by votes, {INAT_PAGES} pages of 200"}},
           "rules": rules, "candidates": len(cands), "passed_metadata": len(passed),
           "heading_known": sum(c["heading"] is not None for c in passed), "image_checked": reached,
           "rejected": {k: rejected[k] for k in REASON_ORDER if rejected.get(k)},
           "photos": [{k: c.get(k) for k in PUBLIC_KEYS} for c in chosen]}
    for p in out["photos"]:
        for k in ("x", "north"):
            p[k] = round(p[k], 1)
        p["lat"], p["lon"] = round(p["lat"], 6), round(p["lon"], 6)
    dest = ROOT / "tiles" / tile / "judge" / "eye_photos.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=1) + "\n")
    log(f"  chose {len(chosen)} ({sum(c['source'] == 'commons' for c in chosen)} Commons, "
        f"{sum(c['source'] == 'inaturalist' for c in chosen)} iNaturalist, "
        f"{sum(c['heading'] is not None for c in chosen)} with heading); {f.network} network requests, {f.failed} failed -> {dest.relative_to(ROOT)}")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tile")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--refresh", action="store_true", help="ask the APIs again instead of using the cache")
    ap.add_argument("--per-circle", type=int, default=GEO_CAP, help="geosearch results per circle (nearest first)")
    ap.add_argument("--no-split", action="store_true", help="do not split a circle that reaches the per-circle cap")
    a = ap.parse_args(argv)
    run(a.tile, a.limit, a.refresh, per_circle=a.per_circle, split_depth=0 if a.no_split else SPLIT_DEPTH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
