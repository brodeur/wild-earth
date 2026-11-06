"""The stratigraphic column of a tile with flat-lying or gently dipping strata, from the geologic map and the DEM.

The geology layer is 2D (one unit per map polygon, 30 m in client/geology.png), and the colour the imagery gives a wall
is smeared down it from above, so a canyon wall at eye height has neither its colour nor its bands. Where the strata lie
flat, the map and the DEM together say which unit outcrops at which elevation, and the column can be drawn on every
steep face by its elevation alone. Part of the `ground` step (pipeline/ground.py), after the geology:

  1. Units. The geology units rasterized on the 5 m DEM grid (geology/units.geojson; larger polygons first, so inliers
     win). Candidates: bedrock units (not water, not a surficial deposit by pipeline/substrate.lithology_of) of at least
     MIN_CELLS cells and MIN_FRACTION of the tile.
  2. Superposition. Every pair of 4-neighbour cells of two different candidate units across a contact with at least
     CONTACT_DZ_M of relief between them says which unit lies on top there. A pair of units is consistent when the one
     higher by median elevation is the upper side along at least SUPERPOSED of their contact (and they share at least
     MIN_CONTACT cells of it): on flat strata cut by erosion every contact runs along the contours with the younger
     unit uphill, whatever the dip; intrusions, folds and faults give mixed sides. While any pair is inconsistent,
     the smaller unit of the inconsistent pairs leaves the chain (the basement's intrusions and the tilted beds under an
     unconformity go; the strata's units stay).
  3. Horizons. The base of each unit of the chain: the contact cells where it is the upper side over any candidate unit
     lower by median, fitted as planes z = h_i + (a + a_i) x + (b + b_i) n (x, n metres east and north of the tile
     centre): one dip shared by all (a, b) and each base's own small tilt about it (a_i, b_i: a unit thickening across
     the tile), the tilts held to the shared dip by a ridge worth TILT_PRIOR contacts off by the tilt over TILT_SCALE_M;
     least squares, three passes dropping each base's residuals past 3 robust sigmas.
  4. Bands. Unit i of the chain fills the ground at or above its base plane and below the base of the unit over it
     (the top unit is open above). On the steep cells (slope at least STEEP_DEG: the faces this is for) a cell is in
     its unit's band when the band at its height, or MAP_TOL_M above or below it, is its unit's (a map's line is drawn
     to a few tens of metres of height on a steep wall). A band's purity is the share of its steep candidate cells
     that are so placed, its recall the share of its unit's steep cells; while the weakest band's min(purity, recall)
     is under MIN_BAND_FIT its unit leaves the chain (a lens in paleovalleys, a monadnock, a tilted unit under the
     unconformity) and the bases are fitted again. A unit with no base contact leaves (the bottom one: the column
     ends at the base over it), as does the smaller of two whose bases cross at the tile centre. Below the lowest base
     the client does as before.
  5. The column holds when it has at least two bands, its steep cells' overall fit is at least MIN_COLUMN_FIT and the
     shared dip is at most MAX_DIP_DEG. Otherwise there is no column (client/strata.json is not written, and an old one
     is removed); geology/strata.json records the test either way: each unit's elevations, every pair's superposition,
     the units dropped and why, each band's fit and contact scatter.

Each band's colour is the unit's rock colour (rock_colour below): the colour words of its name and description first
(a geologic map's unit description leads with its colour: "Tan to white, cliff-forming, ... sandstone"), weighted by
whether the sentence speaks of a cliff (the walls are what this colours), with a minor component's colour ("white
chert nodules") nearly ignored; failing any colour word, a rule table from the lithology terms.
"""
from __future__ import annotations

import json
import math
import re

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from .config import Tile, write_json

MIN_CELLS = 2000             # 5 ha of 5 m cells
MIN_FRACTION = 0.0005
CONTACT_DZ_M = 1.0           # a contact across at least this relief (11 degrees over 5 m) says which side is on top
MIN_CONTACT = 50             # cells of shared contact for a pair to count
SUPERPOSED = 0.75            # share of the contact with the higher unit on top for the pair to be consistent
STEEP_DEG = 25.0             # the faces the column is for
MIN_BAND_FIT = 0.5
MIN_COLUMN_FIT = 0.6
MAX_DIP_DEG = 8.0
TILT_PRIOR = 200             # each base's own tilt about the shared dip: as costly as this many contacts ...
TILT_SCALE_M = 3000.0        # ... each off by the tilt times this distance
MAP_TOL_M = 20.0             # a cell within this height of its unit's band counts as in it: a 1:24 000 map's line is
                             # placed to about +-12 m on the ground, +-20 m of height on a 60 degree wall
MAX_BANDS = 12               # the client's uniform arrays (terrain.js STRATA_N)

# ---------------------------------------------------------------------------------------------------------------
# Rock colour

# Colour terms as sRGB 0..1, for a rock face seen from a few tens of metres. The names are the GSA Rock-Color Chart's
# (Geological Society of America, Rock-Color Chart, Munsell Color 2009 edition, after Goddard et al. 1948), each the
# Munsell chip's sRGB rounded: white N9, light gray N7, gray N6/medium gray N5, dark gray N3, black N1, moderate red
# 5R 4/6, moderate reddish brown 10R 4/6, moderate brown 5YR 4/4, light brown 5YR 5/6, grayish orange 10YR 7/4 (tan,
# buff), pale yellowish orange 10YR 8/6, moderate reddish orange 10R 6/6, grayish pink 5R 8/2, grayish purple 5P 4/2,
# pale purple 5P 6/2, grayish green 10G 4/2, greenish gray 5GY 6/1, light olive gray 5Y 6/1; whites and blacks held
# off the extremes (no rock face is a chip's white). Not tuned to any tile.
HUES = {
    "white": (0.86, 0.85, 0.81), "gray": (0.56, 0.56, 0.55), "grey": (0.56, 0.56, 0.55), "black": (0.16, 0.16, 0.16),
    "red": (0.60, 0.30, 0.25), "brown": (0.47, 0.34, 0.25), "tan": (0.78, 0.66, 0.50), "buff": (0.80, 0.70, 0.54),
    "cream": (0.86, 0.81, 0.69), "yellow": (0.84, 0.72, 0.47), "orange": (0.78, 0.48, 0.33), "pink": (0.80, 0.66, 0.62),
    "purple": (0.44, 0.34, 0.42), "lavender": (0.62, 0.55, 0.64), "violet": (0.44, 0.34, 0.46), "green": (0.38, 0.46, 0.40),
    "olive": (0.50, 0.50, 0.40), "maroon": (0.40, 0.21, 0.19), "rust": (0.62, 0.36, 0.24), "ochre": (0.76, 0.58, 0.32),
    "blue": (0.42, 0.46, 0.52), "salmon": (0.80, 0.56, 0.48), "chocolate": (0.36, 0.25, 0.19), "vermilion": (0.70, 0.30, 0.22),
}
TINTS = {"reddish": "red", "brownish": "brown", "yellowish": "yellow", "grayish": "gray", "greyish": "gray",
         "greenish": "green", "purplish": "purple", "pinkish": "pink", "orangish": "orange", "bluish": "blue",
         "whitish": "white", "blackish": "black", "olive": "olive", "rusty": "rust", "buff": "buff", "tan": "tan"}
# Value and chroma words as the Rock-Color Chart uses them (Munsell value up or down a step or two): (factor on the
# linear colour, share toward its own grey); "very" squares the factor
VALUES = {"light": (1.55, 0.0), "pale": (1.45, 0.35), "bright": (1.25, -0.15), "dark": (0.45, 0.0), "deep": (0.6, -0.1),
          "dusky": (0.5, 0.3), "medium": (1.0, 0.0), "moderate": (1.0, 0.0)}
TINT_SHARE = 0.3
# A colour word whose noun is a minor part of the rock (within a few words) hardly counts: "white chert lenses",
# "red chert veins", "chert weathers dark gray to black"
MINOR = r"chert|nodules?|lens(es)?|veins?|clasts?|pebbles?|cobbles?|fossils?|crystals?|phenocrysts?|grains?|matrix|mica|" \
        r"cement|concretions?|xenoliths?|inclusions?|stains?|spots?|mottles?|tracks?"
MINOR_W = 0.15
# Sentence weights: the walls are the cliff-forming members (a unit "forms an upper slope, middle cliff, and lower
# slope"), so a sentence about a cliff or ledge counts three times one about a slope
CLIFF_W, PLAIN_W, SLOPE_W, NAME_W = 3.0, 1.5, 1.0, 6.0

# Lithology to a typical weathered face colour (sRGB), tried in order against the major lithologies, then the
# lithology text, the name and the description, when no colour word is given. From the usual field descriptions:
# R.H. Compton, Geology in the Field (1985) and M.E. Tucker, Sedimentary Rocks in the Field (4th ed. 2011) for the
# sediments (sandstone buff to grey, red where hematite coats the grains; limestone light grey to cream; dolomite buff
# grey; shale and mudstone grey to red-brown; chalk white; coal black); Blatt, Tracy and Owens, Petrology (3rd ed.
# 2006) for the igneous and metamorphic rocks (granite pink-grey to light grey with its feldspar; diorite and
# granodiorite salt-and-pepper grey; gabbro and basalt near black; andesite mid grey; rhyolite and tuff pale; schist
# and amphibolite dark; gneiss banded mid grey; quartzite and marble pale; serpentinite dark green; slate dark grey).
LITH_COLOURS = [
    ("basalt", r"basalt|basanite|picrite", (0.22, 0.22, 0.22)),
    ("gabbro", r"gabbro|diabase|dolerite|norite|anorthosite", (0.30, 0.31, 0.30)),
    ("amphibolite", r"amphibolite|greenstone|metabasalt|metavolcanic|spilite", (0.27, 0.30, 0.27)),
    ("serpentinite", r"serpentin|ultramafic|peridotit|dunite", (0.27, 0.34, 0.29)),
    ("slate", r"slate|phyllite|argillite", (0.30, 0.31, 0.32)),
    ("schist", r"schist", (0.38, 0.37, 0.35)),
    ("gneiss", r"gneiss|migmatite|charnockite|enderbite|granulite", (0.50, 0.48, 0.46)),
    ("quartzite", r"quartzite|meta-?arenite", (0.76, 0.72, 0.66)),
    ("marble", r"marble", (0.84, 0.83, 0.80)),
    ("granodiorite", r"granodiorit|tonalit|trondhjemit|diorit|quartz monzonite", (0.60, 0.60, 0.58)),
    ("granite", r"granit|pegmatit|aplite|syenit|monzonit|plutonic", (0.72, 0.65, 0.61)),
    ("andesite", r"andesit|latite|trachyte", (0.44, 0.42, 0.40)),
    ("rhyolite", r"rhyolit|dacit|obsidian", (0.70, 0.63, 0.58)),
    ("tuff", r"tuff|ignimbrite|pyroclastic|volcaniclastic", (0.74, 0.68, 0.58)),
    ("chalk", r"chalk", (0.88, 0.86, 0.81)),
    ("gypsum", r"gypsum|anhydrite|evaporite", (0.86, 0.84, 0.80)),
    ("dolomite", r"dolomite|dolostone", (0.72, 0.68, 0.60)),
    ("limestone", r"limestone|carbonate|travertine", (0.70, 0.68, 0.63)),
    ("coal", r"\bcoal|lignite", (0.12, 0.12, 0.12)),
    ("chert", r"\bchert", (0.55, 0.53, 0.50)),
    ("conglomerate", r"conglomerate|breccia", (0.60, 0.54, 0.46)),
    ("sandstone", r"sandstone|arenite|arkose|gr[ae]ywacke", (0.74, 0.65, 0.51)),
    ("mudrock", r"siltstone|mudstone|shale|claystone", (0.50, 0.46, 0.42)),
    ("volcanic", r"volcanic", (0.40, 0.39, 0.37)),
    ("sedimentary", r"sediment", (0.62, 0.57, 0.50)),
]
DEFAULT_ROCK = (0.55, 0.53, 0.50)


def _lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(np.asarray(c, float), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _phrase_colour(words: list[str]) -> np.ndarray | None:
    """['light', 'olive', 'gray'] -> linear RGB. The last hue is the colour; earlier hues and -ish words tint it; value
    words scale it (what passes 0.85 in a channel spills toward white)."""
    hues = [w for w in words if w in HUES]
    if not hues:
        return None
    base = _lin(HUES[hues[-1]])
    for w in words[:-1]:
        t = TINTS.get(w) or (w if w in HUES and w != hues[-1] else None)
        if t:
            base = base * (1 - TINT_SHARE) + _lin(HUES[t]) * TINT_SHARE
    very = "very" in words
    for w in words:
        if w in VALUES:
            f, grey = VALUES[w]
            f = f * f if very else f
            y = float(base @ np.array([0.2126, 0.7152, 0.0722]))
            base = base + (y - base) * grey
            base = base * f
            over = max(float(base.max()) - 0.85, 0.0)
            base = np.minimum(base, 0.85) + over * 0.5
    return np.clip(base, 0.0, 0.85)


_WORD = re.compile(r"[a-z]+")
_ROCK_NOUN = (r"\w*(stone|shale|ite|ate|rock|gypsum|schist|gneiss|tuff|basalt|granite|marble|slate|chalk|breccia|"
              r"conglomerate|unit|member|formation|beds?|layers?|ledges?|cliffs?|slopes?)")
COLOUR_WORDS = set(HUES) | set(TINTS) | set(VALUES) | {"very"}


def colour_phrases(text: str) -> list[tuple[np.ndarray, float, str]]:
    """The colour phrases of a text: (linear colour, weight, phrase), weighted by the sentence (cliff, slope) and
    whether the colour belongs to a minor component."""
    out = []
    for sent in re.split(r"(?<=[.;])\s+|—|—", text.lower()):
        sw = CLIFF_W if re.search(r"cliff|ledge", sent) else SLOPE_W if re.search(r"slope", sent) else PLAIN_W
        toks = [(m.group(), m.start(), m.end()) for m in _WORD.finditer(sent)]
        i = 0
        while i < len(toks):
            if toks[i][0] not in COLOUR_WORDS:
                i += 1
                continue
            j = i + 1   # a run of colour words joined only by spaces or hyphens ("light-olive-gray", not "red, gray")
            while j < len(toks) and toks[j][0] in COLOUR_WORDS and re.fullmatch(r"[\s-]*", sent[toks[j - 1][2]:toks[j][1]]):
                j += 1
            words = [t[0] for t in toks[i:j]]
            # 'tan' and 'buff' as tints only before another hue; a run without a hue is no colour
            c = _phrase_colour(words)
            if c is not None:
                # minor: the noun the colour goes with (the next few words, up to a rock's name or a comma) is a
                # minor part, or the colour is what a minor part weathers to ("chert beds weather dark gray to black")
                noun = None
                for q in range(j, min(j + 4, len(toks))):
                    if re.search(r"[,;:.()]", sent[toks[q - 1][2]:toks[q][1]]):
                        break
                    if re.fullmatch(_ROCK_NOUN, toks[q][0]):
                        noun = "rock"
                        break
                    if re.fullmatch(MINOR, toks[q][0]):
                        noun = "minor"
                        break
                before = " ".join(t[0] for t in toks[max(0, i - 5):i])
                minor = noun == "minor" or (noun is None and (
                    bool(re.search(rf"\b({MINOR})\b(\s+\w+)?\s+weathers?\b", before))
                    or bool(re.search(rf"\b({MINOR})\b", " ".join(t[0] for t in toks[max(0, i - 3):i])))))
                w = sw * (MINOR_W if minor else 1.0)
                out.append((c, w, " ".join(words)))
            i = j
    return out


def lithology_colour(unit: dict) -> tuple[tuple[float, float, float], str]:
    majors = unit.get("lithology") or ""
    for src, text in (("lithology", majors), ("name", unit.get("name") or ""), ("description", unit.get("description") or "")):
        t = text.lower()
        if not t.strip():
            continue
        if src == "description":   # the lithology named first in the description
            hits = [(m.start(), k) for k, (_, pat, _) in enumerate(LITH_COLOURS) for m in [re.search(pat, t)] if m]
            if hits:
                k = min(hits)[1]
                return LITH_COLOURS[k][2], f"description: {LITH_COLOURS[k][0]}"
            continue
        for name, pat, col in LITH_COLOURS:
            if re.search(pat, t):
                return col, f"{src}: {name}"
    return DEFAULT_ROCK, "no lithology named"


def rock_colour(unit: dict) -> dict:
    """{colour, alt, alt_share, bedding, from}: the unit's face colour (sRGB), a second colour for its sub-beds and the
    share they take, and how strongly its bedding shows (0.04 massive .. 0.12 interbedded)."""
    phrases = [(c, NAME_W, p) for c, _, p in colour_phrases(unit.get("name") or "")]
    phrases += colour_phrases(unit.get("description") or "")
    desc = (unit.get("description") or "").lower()
    bedding = 0.12 if re.search(r"interbed|alternat|intertongu", desc) else 0.04 if re.search(r"massive|thick-bedded|very thick", desc) else 0.07
    if not phrases:
        col, why = lithology_colour(unit)
        return {"colour": [round(float(v), 3) for v in col], "alt": [round(float(v), 3) for v in col], "alt_share": 0.0,
                "bedding": bedding, "from": why}
    W = np.array([w for _, w, _ in phrases])
    C = np.array([c for c, _, _ in phrases])
    # two colours, by a weighted 2-means over the phrases (in sRGB, nearer to how different they look): the unit's
    # main colour and the colour of its other beds (the Supai's grey limestone ledges among its red sandstone)
    P = _srgb(C)
    m1 = (P * W[:, None]).sum(0) / W.sum()
    m2 = P[np.argmax(W * np.sqrt(((P - m1) ** 2).sum(1)))]
    for _ in range(12):
        k2 = ((P - m2) ** 2).sum(1) < ((P - m1) ** 2).sum(1)
        if k2.all() or not k2.any():
            break
        m1 = (P[~k2] * W[~k2, None]).sum(0) / W[~k2].sum()
        m2 = (P[k2] * W[k2, None]).sum(0) / W[k2].sum()
    if k2.all() or not k2.any() or np.sqrt(((m1 - m2) ** 2).sum()) < 0.08:
        main, alt, share = _srgb((C * W[:, None]).sum(0) / W.sum()), None, 0.0
    else:
        w1, w2 = W[~k2].sum(), W[k2].sum()
        lin1, lin2 = (C[~k2] * W[~k2, None]).sum(0) / w1, (C[k2] * W[k2, None]).sum(0) / w2
        if w2 > w1:
            lin1, lin2, w1, w2 = lin2, lin1, w2, w1
        main, alt, share = _srgb(lin1), _srgb(lin2), float(min(w2 / (w1 + w2), 0.5))
    alt = main if alt is None else alt
    top = sorted(zip(W, [p for _, _, p in phrases]), key=lambda t: -t[0])[:5]
    return {"colour": [round(float(v), 3) for v in main], "alt": [round(float(v), 3) for v in alt],
            "alt_share": round(share, 2), "bedding": bedding,
            "from": f"colour words ({len(phrases)}): " + ", ".join(p for _, p in top)}


# ---------------------------------------------------------------------------------------------------------------
# The column

def _units_5m(tile: Tile, shape_hw, transform) -> np.ndarray:
    gj = json.loads(tile.path("geology/units.geojson").read_text())
    fwd = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
    shapes = [(shp_transform(fwd.transform, shape(f["geometry"])), int(f["properties"]["unit_index"])) for f in gj["features"]]
    shapes.sort(key=lambda s: -s[0].area)
    return rasterize(shapes, out_shape=shape_hw, transform=transform, fill=0, dtype="uint16")


def _contacts(u, z, cand):
    """4-neighbour contacts between candidate units with relief: (upper unit, lower unit, row, col, z at the contact)."""
    ups, los, rr, cc, zz = [], [], [], [], []
    for dr, dc in ((0, 1), (1, 0)):
        a, b = u[:u.shape[0] - dr, :u.shape[1] - dc], u[dr:, dc:]
        za, zb = z[:z.shape[0] - dr, :z.shape[1] - dc], z[dr:, dc:]
        m = (a != b) & cand[a] & cand[b] & (np.abs(za - zb) >= CONTACT_DZ_M)
        r, c = np.nonzero(m)
        hi = za[r, c] > zb[r, c]
        ups.append(np.where(hi, a[r, c], b[r, c])); los.append(np.where(hi, b[r, c], a[r, c]))
        rr.append(r + 0.5 * dr); cc.append(c + 0.5 * dc); zz.append(0.5 * (za[r, c] + zb[r, c]))
    return np.concatenate(ups), np.concatenate(los), np.concatenate(rr), np.concatenate(cc), np.concatenate(zz)


def _fit_horizons(chain, med, up, lo, X, N, Z):
    """Planes through each chain unit's base contacts: one shared dip, and each base its own small tilt about it (a unit
    that thickens across the tile), held to the shared dip by a ridge (TILT_PRIOR pseudo-contacts per base at
    TILT_SCALE_M). X, N about the tile centre. Returns (a, b, {unit: (h, slope_e, slope_n, sigma, n)})."""
    rows = []
    for k, ui in enumerate(chain):
        m = (up == ui) & np.isin(lo, [v for v in med if med[v] < med[ui]])
        idx = np.nonzero(m)[0]
        if idx.size >= MIN_CONTACT:
            rows.append((k, idx))
    if not rows:
        return 0.0, 0.0, {}
    J = len(rows)
    I = np.concatenate([idx for _, idx in rows])
    K = np.concatenate([np.full(idx.size, j) for j, (_, idx) in enumerate(rows)])
    keep = np.ones(I.size, bool)
    prior = np.zeros((2 * J, 2 + 3 * J))
    for j in range(J):
        prior[2 * j, 2 + J + j] = prior[2 * j + 1, 2 + 2 * J + j] = math.sqrt(TILT_PRIOR) * TILT_SCALE_M
    for _ in range(3):
        ii, kk = I[keep], K[keep]
        A = np.zeros((ii.size, 2 + 3 * J))
        A[:, 0], A[:, 1] = X[ii], N[ii]
        r = np.arange(ii.size)
        A[r, 2 + kk] = 1.0
        A[r, 2 + J + kk] = X[ii]
        A[r, 2 + 2 * J + kk] = N[ii]
        sol, *_ = np.linalg.lstsq(np.vstack([A, prior]), np.concatenate([Z[ii], np.zeros(2 * J)]), rcond=None)
        res = Z[I] - (sol[2 + K] + (sol[0] + sol[2 + J + K]) * X[I] + (sol[1] + sol[2 + 2 * J + K]) * N[I])
        new = np.ones(I.size, bool)
        for j in range(J):
            rj = res[K == j]
            sg = 1.4826 * np.median(np.abs(rj - np.median(rj))) + 1e-6
            new[K == j] = np.abs(rj - np.median(rj)) <= 3 * sg
        keep = new
    out = {}
    for j, (k, _) in enumerate(rows):
        rj = res[(K == j) & keep]
        out[chain[k]] = (float(sol[2 + j]), float(sol[0] + sol[2 + J + j]), float(sol[1] + sol[2 + 2 * J + j]),
                         float(1.4826 * np.median(np.abs(rj - np.median(rj)))), int(rj.size))
    return float(sol[0]), float(sol[1]), out


def _bands_of(z, X, N, chain, hz):
    """The chain's band index for elevations z at (X, N): the first base from the top that z is at or above; len(chain)
    below the column."""
    band = np.full(z.shape, len(chain), np.int16)
    for i in range(len(chain) - 1, -1, -1):
        h, se, sn = hz[chain[i]][:3]
        band[z >= h + se * X + sn * N] = i
    return band


def build_column(tile: Tile) -> dict:
    """The column test for the tile; writes geology/strata.json always and client/strata.json when the column holds.
    Returns the manifest layers written."""
    units = json.loads(tile.path("geology/classes.json").read_text())["units"]
    with rasterio.open(tile.path("terrain/dem.tif")) as src:
        z = src.read(1).astype("float64")
        tr, res = src.transform, src.res[0]
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
    record, out = column_from(units, _units_5m(tile, z.shape, tr), z, res)
    write_json(tile.path("geology/strata.json"), record)
    layers = {"geology.strata": {"path": "geology/strata.json", "kind": "table", "derived_from": ["geology.units", "terrain.dem"],
                                 "column": record["column"], **({"quality": record["quality"]} if out else {"reason": record["reason"]})}}
    p = tile.path("client/strata.json")
    if out is None:
        if p.exists():
            p.unlink()
        return layers
    write_json(p, out)
    layers["client.strata"] = {"path": "client/strata.json", "kind": "table", "derived_from": ["geology.strata"],
                               "encoding": out["encoding"], "bands": len(out["bands"])}
    return layers


def column_from(units: dict, u: np.ndarray, z: np.ndarray, res: float) -> tuple[dict, dict | None]:
    """The column of a tile from its geology units (geology/classes.json `units`), their raster u on the DEM's grid
    (row 0 north) and the DEM z (NaN where none), res metres a cell: (the record of the test, the client's column or
    None where it does not hold)."""
    from .substrate import lithology_of
    total = u.size
    gy, gx = np.gradient(np.nan_to_num(z, nan=np.nanmean(z)), res)
    steep = np.degrees(np.arctan(np.hypot(gx, gy))) >= STEEP_DEG
    valid = ~np.isnan(z)

    nmax = max(int(k) for k in units) + 1
    cand = np.zeros(max(nmax, int(u.max()) + 1), bool)
    lith, med, area = {}, {}, {}
    record = {"units": {}}
    for k, v in units.items():
        ui = int(k)
        m = (u == ui) & valid
        n = int(m.sum())
        lname, why = lithology_of(v)
        lith[ui] = lname
        info = {"name": v.get("name"), "lithology": lname, "cells": n}
        if n:
            q = np.percentile(z[m], [5, 25, 50, 75, 95])
            info["elevation_m"] = {"p5": round(q[0], 1), "p25": round(q[1], 1), "median": round(q[2], 1), "p75": round(q[3], 1), "p95": round(q[4], 1)}
        ok = not v.get("water") and lname != "surficial" and n >= MIN_CELLS and n >= MIN_FRACTION * total
        info["candidate"] = bool(ok)
        if not ok:
            info["why_not"] = "water" if v.get("water") else "surficial deposit" if lname == "surficial" else "too small"
        if ok:
            cand[ui] = True
            med[ui] = float(np.median(z[m]))
            area[ui] = n
        record["units"][k] = info

    def done(reason, extra=None):
        record.update({"column": False, "reason": reason, **(extra or {}), "rule": _RULE})
        return record, None

    if len(med) < 2:
        return done(f"{len(med)} bedrock unit(s) large enough: no column")

    zc = np.where(valid, z, 0.0)
    up, lo, R, C, Z = _contacts(u, zc, cand)
    vv = valid[R.astype(int), C.astype(int)]
    up, lo, R, C, Z = up[vv], lo[vv], R[vv], C[vv], Z[vv]
    cx, cn = z.shape[1] * res / 2, z.shape[0] * res / 2   # the tile centre: coordinates about it
    X = (C + 0.5) * res - cx                         # metres east of the tile centre
    Nn = (z.shape[0] - (R + 0.5)) * res - cn         # metres north of it

    # 2. superposition
    pairs = {}
    for a, b in zip(up.tolist(), lo.tolist()):
        key = (a, b)
        pairs[key] = pairs.get(key, 0) + 1
    rel = {}
    for (a, b), n in pairs.items():
        hi, lw = (a, b) if med[a] >= med[b] else (b, a)
        if (hi, lw) in rel:
            continue
        n_ok, n_bad = pairs.get((hi, lw), 0), pairs.get((lw, hi), 0)
        if n_ok + n_bad >= MIN_CONTACT:
            rel[(hi, lw)] = (n_ok, n_bad)
    record["superposition"] = [{"upper": units[str(a)]["name"], "lower": units[str(b)]["name"], "contact_cells": ok + bad,
                                "upper_on_top": round(ok / (ok + bad), 3)} for (a, b), (ok, bad) in
                               sorted(rel.items(), key=lambda kv: -sum(kv[1]))]
    chain = sorted(med, key=lambda k: -med[k])
    dropped = []
    while True:
        bad = [(a, b) for (a, b), (ok, no) in rel.items() if a in chain and b in chain and ok / (ok + no) < SUPERPOSED]
        if not bad:
            break
        involved = {x for p in bad for x in p}
        out = min(involved, key=lambda k: area[k])
        chain.remove(out)
        dropped.append({"unit": units[str(out)]["name"], "why": "not superposed: mixed sides along its contacts with " +
                        ", ".join(sorted({units[str(b if a == out else a)]["name"] for a, b in bad if out in (a, b)}))})
    record["consistent_pairs"] = round(sum(1 for (ok, no) in rel.values() if ok / (ok + no) >= SUPERPOSED) / max(len(rel), 1), 3)

    # 3-4. horizons and bands
    sr, sc = np.nonzero(steep & valid)
    zs, cs = z[sr, sc], u[sr, sc]
    cand_steep = cand[cs]
    Xs, Ns = (sc + 0.5) * res - cx, (z.shape[0] - (sr + 0.5)) * res - cn
    unit_steep = {k: int((cs == k).sum()) for k in chain}

    def fit_of(chain, hz):
        """Per band (fit, purity, recall, cells, unit) on the steep candidate cells, a cell counting as in its unit's
        band when the band at its height or MAP_TOL_M above or below it is its unit's; and the overall share."""
        b0, bu, bd = (_bands_of(zs + d, Xs, Ns, chain, hz) for d in (0.0, MAP_TOL_M, -MAP_TOL_M))
        U = np.array(chain + [-1])
        ok = cand_steep & ((U[b0] == cs) | (U[bu] == cs) | (U[bd] == cs))
        strict = cand_steep & (U[b0] == cs)
        fits = []
        for i, k in enumerate(chain):
            inb = (b0 == i) & cand_steep
            n_in = int(inb.sum())
            purity = int((inb & ok).sum()) / n_in if n_in else 0.0
            recall = int(((cs == k) & ok & ((b0 == i) | (bu == i) | (bd == i))).sum()) / max(unit_steep.get(k) or int((cs == k).sum()), 1)
            fits.append((min(purity, recall), purity, recall, n_in, k))
        in_col = (b0 < len(chain)) & cand_steep
        n = max(int(in_col.sum()), 1)
        return fits, int((ok & in_col).sum()) / n, int((strict & in_col).sum()) / n, int(in_col.sum())

    while True:
        if len(chain) < 2:
            record["dropped"] = dropped
            return done("fewer than two units left in the column", {"dropped": dropped})
        a, b, hz = _fit_horizons(chain, med, up, lo, X, Nn, Z)
        # the chain's units without a base horizon (no contact below them in the tile) can only be the bottom one
        nob = [k for k in chain[:-1] if k not in hz]
        if nob:
            out = min(nob, key=lambda k: area[k])
            chain.remove(out)
            dropped.append({"unit": units[str(out)]["name"], "why": "no base contact in the tile"})
            continue
        if chain[-1] not in hz:   # the bottom unit's base is not seen: the column ends at the base of the one over it
            dropped.append({"unit": units[str(chain[-1])]["name"], "why": "its base is not seen in the tile: below the column"})
            chain = chain[:-1]
            continue
        # a base above the base of the unit over it (at the tile centre): drop the smaller
        inv = [(chain[i], chain[i + 1]) for i in range(len(chain) - 1) if hz[chain[i + 1]][0] >= hz[chain[i]][0]]
        if inv:
            out = min({x for p in inv for x in p}, key=lambda k: area[k])
            chain.remove(out)
            dropped.append({"unit": units[str(out)]["name"], "why": "its base horizon crosses the next unit's"})
            continue
        fits, overall, strict, n_col = fit_of(chain, hz)
        worst = min(fits)
        if worst[0] < MIN_BAND_FIT:
            chain.remove(worst[4])
            dropped.append({"unit": units[str(worst[4])]["name"], "why": f"its band's steep cells are {worst[1]:.0%} its own unit "
                            f"and hold {worst[2]:.0%} of the unit's steep cells (under {MIN_BAND_FIT:.0%})"})
            continue
        break

    dip = math.degrees(math.atan(math.hypot(a, b)))
    dip_dir = (math.degrees(math.atan2(-a, -b)) + 360) % 360   # down-dip azimuth, clockwise from north
    bands = []
    for i, k in enumerate(chain):
        h, se, sn, sig, nc = hz[k]
        v = units[str(k)]
        f = fits[i]
        bands.append({"unit": k, "name": v.get("name"), "age": v.get("age"), "lithology": lith[k],
                      "base_m": round(h, 1), "slope_e": round(se, 6), "slope_n": round(sn, 6),
                      "thickness_at_centre_m": None if i == 0 else round(hz[chain[i - 1]][0] - h, 1),
                      "contact_sigma_m": round(sig, 1), "contact_cells": nc,
                      "purity": round(f[1], 3), "recall": round(f[2], 3), **rock_colour(v)})
    quality = {"overall_fit_steep": round(overall, 3), "overall_fit_steep_strict": round(strict, 3), "map_tol_m": MAP_TOL_M,
               "dip_deg": round(dip, 2), "dip_azimuth_deg": round(dip_dir, 1), "steep_cells_in_column": n_col,
               "bands": len(chain), "median_contact_sigma_m": round(float(np.median([hz[k][3] for k in chain])), 1),
               "superposed_pairs": record["consistent_pairs"]}
    record.update({"dropped": dropped, "quality": quality})
    if overall < MIN_COLUMN_FIT:
        return done(f"the column's steep cells match their band in {overall:.0%} (under {MIN_COLUMN_FIT:.0%})", {"bands": bands})
    if dip > MAX_DIP_DEG:
        return done(f"the strata dip {dip:.1f} degrees (over {MAX_DIP_DEG}): not flat-lying", {"bands": bands})
    if len(bands) > MAX_BANDS:
        return done(f"{len(bands)} bands, over the client's {MAX_BANDS}", {"bands": bands})

    out = {"encoding": "bands top to bottom; band i holds the ground at or above its base, base_m + slope_e (x - 5000) + "
                       "slope_n (n - 5000) with x, n metres east and north of the tile's south-west corner, and below the "
                       "base of the band over it (the first is open above); below the last base there is no column. "
                       "colour and alt sRGB 0..1, alt_share the share of beds in the alt colour, bedding the beds' "
                       "tone contrast; lithology one of client/substrate.json lithologies",
           "centre": [cx, cn],
           "bands": [{k: bd[k] for k in ("name", "lithology", "base_m", "slope_e", "slope_n", "colour", "alt", "alt_share", "bedding")}
                     for bd in bands],
           "quality": quality}
    record.update({"column": True, "bands": bands, "rule": _RULE})
    return record, out


_RULE = {"min_cells": MIN_CELLS, "min_fraction": MIN_FRACTION, "contact_dz_m": CONTACT_DZ_M, "min_contact": MIN_CONTACT,
         "superposed": SUPERPOSED, "steep_deg": STEEP_DEG, "min_band_fit": MIN_BAND_FIT, "min_column_fit": MIN_COLUMN_FIT,
         "max_dip_deg": MAX_DIP_DEG, "tilt_prior": TILT_PRIOR, "tilt_scale_m": TILT_SCALE_M,
         "map_tol_m": MAP_TOL_M, "doc": "pipeline/strata.py"}
