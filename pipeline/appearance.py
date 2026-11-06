"""What a species looks like, by body region, from open sources: the colours a fauna model's texture is asked for, and
the colours its build is checked against (world pipeline phase 1, iteration 6; docs/decisions.md 2026-11-06).

One rule for every species, nothing per species:

  research  the species' Wikipedia article (the scientific name, redirects followed: the lead and the sections headed
            Description, Characteristics, Appearance, Physical description, Fur, Plumage, Colouration, Mane) and its Animal
            Diversity Web account (University of Michigan, the "Physical Description" section); when neither says what
            colour the body is, the genus's Wikipedia article (a Masai giraffe's article has the spots' shape, not their
            colour). Each sentence that names a colour and a body covering or a body part is a candidate; dropped are those
            about the young (juveniles, cubs, chicks, foals, calves, hatchlings, newborns; "juveniles and young adults"
            stays), a change with age (fades to, becomes, with age, mature adults), rare morphs and captives, regional
            variants (subspecies, populations, climates), other taxa (unlike, confused with, another binomial), the past
            (extinct forms: had, were) and non-body matter (secretions, eggs, glands, tongue); when the text describes the
            male, the female-only sentences go (the model is an adult male: the agama's colours are the male's).
  facts     each kept sentence is split into clauses (; while, whereas, but, with, and a) and each colour phrase in a
            clause ("pale greyish-brown", "dark bronze", "off-yellow") is placed: a colour just before a pattern word
            (spots, rosettes, stripes, blotches, bars, bands, patches, streaks, rings, lines) is that marking's colour; a
            colour just before a body word ("white thigh feathers") is that region's; a clause about a pattern ("the spots
            may be reddish") gives marking colours; any other colour is the ground colour of the clause's subject (the
            region words before it, else after it, else the previous clause's, else the whole body). Regions are canonical
            (body, upperparts, flanks, underparts, head, neck, legs, tail, wings); the source's own words are not kept.
  store     library/animals/appearance/<code>.json (beside the trait cards, not in them: pipeline/fauna.py may rewrite a
            generated card): per region the ground colours and the markings (colours, pattern), the source URLs (and
            the Wikipedia revision), and a summary composed from the facts. Facts only, no copied prose.
  prompt    texture_prompt(): the summary leads the refine's texture prompt (pipeline/fauna_models.py prompts()).
  check     check(): the built GLB (tools/build_*.py: COLOR_0 per vertex, _PART per vertex) is split into the same
            regions (the head, legs, tail and wing parts; the body by face normal into upper side, flanks, underside);
            each face's colour is matched to the region's described colours (its own, the whole body's, the neck's for
            the head and back, and the colours between two chromatic ones named: brown, red and yellow take in the
            ochres) by CIEDE2000 with lightness at half weight (a named colour says hue and chroma better than
            lightness), within MATCH_DE; a described region passes when half of it matches, the whole model when 60%
            does, and a described marking must be there (MARK_SHARE of its region; the body's on the back and flanks). A model that fails is re-refined once (pipeline/fauna_models.py).

    arch -arm64 .venv/bin/python -m pipeline.appearance <code> [<code> ...] [--refresh] [--check]
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import math
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "library" / "animals" / "appearance"
CACHE = ROOT / "pipeline" / "_cache" / "appearance"   # the fetched source text (git-ignored), so a rule change re-reads offline
UA = {"User-Agent": "wild-earth-pipeline/1 (https://github.com/; world pipeline appearance research)"}
FORMAT = 1
MATCH_DE = 16.0       # CIEDE2000 (kL 2) within which a face's colour is one the description names
REGION_PASS = 0.5     # a region passes when at least this share of its area matches
MARK_SHARE = 0.015    # a described marking's colour must cover at least this share of its region
MIN_REGION = 0.06     # regions under this share of the model's area are not judged
SCORE_PASS = 0.6      # and most of the model, all regions together, must be in described colours

# ---- colours: the words a description uses, as an sRGB guess for a natural animal colour ----
BASE = {
    "black": "1c1b1a", "blackish": "2b2724", "dark": "33302c", "charcoal": "3a3a3a", "sooty": "35322f",
    "grey": "8a8a88", "gray": "8a8a88", "greyish": "8f8d88", "grayish": "8f8d88", "slate": "5c6168", "silver": "b4b4b2",
    "silvery": "b4b4b2", "ash": "9a9894", "ashy": "9a9894", "white": "efeeea", "whitish": "e2dfd6", "ivory": "ece4d0",
    "cream": "e6d8b4", "creamy": "e6d8b4", "buff": "d4b688", "buffy": "d4b688", "tan": "c4a070", "fawn": "c6a27a",
    "sandy": "d2b48a", "beige": "d4c3a0", "tawny": "c2964e", "khaki": "b4a272", "straw": "dcc890", "ochre": "c49a3c",
    "ochraceous": "c49a3c", "golden": "cf9e3c", "gold": "cf9e3c", "yellow": "d8c048", "yellowish": "d2be5a",
    "lemon": "e2d24c", "sulphur": "dcd25a", "orange": "dc7a2c", "orangish": "d8823a", "rust": "a64a20", "rusty": "a64a20",
    "ginger": "b8662c", "red": "b0302a", "reddish": "a8483a", "crimson": "a01c2c", "scarlet": "c4281e",
    "rufous": "a4552c", "chestnut": "84442a", "cinnamon": "a0643a", "brown": "6c4a32", "brownish": "785640",
    "chocolate": "4a3022", "mahogany": "5c2c1e", "bronze": "7a6436", "pink": "dc9c98", "pinkish": "d4a09a",
    "rose": "d08890", "salmon": "e09478", "flesh": "dcae98", "purple": "6a3a78", "purplish": "6e4a72",
    "violet": "7a44a0", "magenta": "b8307c", "mauve": "9a7a94", "lilac": "b0a0c8", "blue": "3a5a9c", "bluish": "4c6488",
    "indigo": "3c3c8a", "turquoise": "3c9ca0", "green": "4a7c3a", "greenish": "5e7c4a", "olive": "6c6a34",
}
MODS = {"pale": (14, 0.75), "light": (12, 0.85), "dark": (-16, 0.95), "deep": (-14, 1.1), "bright": (4, 1.3),
        "dull": (-4, 0.7), "dingy": (-6, 0.65), "rich": (-6, 1.2), "pure": (0, 1.0), "vivid": (2, 1.3)}
PATTERN = {"spot": "spots", "spots": "spots", "spotted": "spots", "spotting": "spots", "rosette": "rosettes",
           "rosettes": "rosettes", "stripe": "stripes", "stripes": "stripes", "striped": "stripes", "striping": "stripes",
           "blotch": "blotches", "blotches": "blotches", "blotched": "blotches", "band": "bands", "bands": "bands",
           "banded": "bands", "bar": "bars", "bars": "bars", "barred": "bars", "barring": "bars", "patch": "patches",
           "patches": "patches", "streak": "streaks", "streaks": "streaks", "ring": "rings", "rings": "rings",
           "ringed": "rings", "line": "lines", "lines": "lines", "dash": "dashes", "dashes": "dashes", "mottled": "mottling",
           "mottling": "mottling", "speckled": "speckles", "speckles": "speckles", "chevrons": "chevrons", "marks": "marks",
           "markings": "marks", "tuft": "tuft", "tip": "tip", "tipped": "tip", "mask": "mask", "dappling": "dappling",
           "crossbands": "bands", "cross-bands": "bands"}
REGION = {
    "head": "head", "face": "head", "facial": "head", "muzzle": "head", "snout": "head", "ear": "head", "ears": "head",
    "crown": "head", "forehead": "head", "cheek": "head", "cheeks": "head", "chin": "head", "lips": "head", "bill": "head",
    "beak": "head", "lappets": "head", "ossicones": "head", "nape": "neck", "neck": "neck", "throat": "neck",
    "throats": "neck", "mane": "neck", "manes": "neck", "ruff": "neck", "shoulders": "neck", "crest": "upperparts", "back": "upperparts",
    "backs": "upperparts", "upperparts": "upperparts", "above": "upperparts", "dorsal": "upperparts", "dorsum": "upperparts",
    "mantle": "upperparts", "carapace": "upperparts", "shell": "upperparts", "scutes": "upperparts", "rump": "upperparts",
    "flanks": "flanks", "flank": "flanks", "sides": "flanks", "belly": "underparts", "underbelly": "underparts",
    "underparts": "underparts", "underside": "underparts", "undersides": "underparts", "below": "underparts",
    "ventral": "underparts", "chest": "underparts", "chests": "underparts", "breast": "underparts", "abdomen": "underparts",
    "plastron": "underparts", "thigh": "underparts", "thighs": "underparts", "leg": "legs", "legs": "legs", "limbs": "legs",
    "feet": "legs", "foot": "legs", "paws": "legs", "hooves": "legs", "tarsus": "legs", "toes": "legs", "tail": "tail",
    "tails": "tail", "wing": "wings", "wings": "wings", "primaries": "wings", "secondaries": "wings", "coverts": "wings",
    "body": "body", "coat": "body", "fur": "body", "skin": "body", "plumage": "body", "feathers": "body", "pelage": "body",
    "hair": "body", "scales": "body", "males": "body", "adults": "body", "animal": "body",
    "patterned": "body", "coloured": "body", "colored": "body", "background": "body", "colouration": "body", "coloration": "body", "overall": "body",
}
ORDER = ["body", "upperparts", "flanks", "underparts", "head", "neck", "legs", "tail", "wings"]
COLOUR_RE = "|".join(sorted(BASE, key=len, reverse=True))
PHRASE = re.compile(rf"\b(?:(?:{'|'.join(MODS)}|off|almost|nearly)[\s-]+)*(?:(?:{COLOUR_RE})(?:-|\s(?=(?:{COLOUR_RE})\b)))*"
                    rf"(?:{COLOUR_RE})\b(?!-coloured\s+(?:{COLOUR_RE}))")
YOUNG = re.compile(r"\b(juveniles?|young|cubs?|chicks?|foals?|calf|calves|hatchlings?|newborns?|newly born|natal|neonates?|"
                   r"immatures?|subadults?|kittens?|pups?|infants?|nestlings?|fledglings?)\b", re.I)
ADULTS_TOO = re.compile(r"\badults\b|\byoung adults?\b", re.I)
AGE_CHANGE = re.compile(r"\bfades?\s+to\b|\btend to fade\b|\bwith age\b|\bmature adults\b|\bbecom\w*\b|\bturns?\b|\bold age\b", re.I)
MORPH = re.compile(r"\b(morphs?|melanis\w*|leucis\w*|albin\w*|panthers?|captiv\w*|hybrids?|aberrant|domestic\w*)\b", re.I)
REGIONAL = re.compile(r"\b(subspecies|populations?|climates?|peninsula|arabian|india|regions|habitats?|forests?|deserts?)\b|\bin (?:the )?(?:more )?"
                      r"(?:north|south|east|west|central)\w*\b|\b(?:north|south|east|west)\w*\s+african\b", re.I)
OTHER_TAXA = re.compile(r"\b(unlike|confused with|other species|related species|similar species|distinguish\w* from|"
                        r"compared|than (?:those|that) of|relationship|genus|family|also called|also known|known as|"
                        r"literally means|species of)\b", re.I)
PAST = re.compile(r"\b(had|were)\b", re.I)
NONBODY = re.compile(r"\b(secret\w*|eggs?|eggshells?|glands?|sweat|milk|dung|faeces|feces|tongue|teeth|blood|sunscreen|"
                     r"urine|nests?|horns?|tusks?|ivory|poaching|meat)\b", re.I)
FEMALE = re.compile(r"\b(females?|female's|cows|hens?|does|ewes?)\b", re.I)
MALE = re.compile(r"\b(males?|male's|bulls?|cocks?|stags?)\b", re.I)
SECTION = re.compile(r"descr|charact|appear|physical|^fur$|plumage|colou?r|mane|morpholog|^anatomy$", re.I)


# ---- colour science ----
def _hex_lin(h: str) -> np.ndarray:
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(lin) -> np.ndarray:
    """CIELAB (D65) of linear sRGB colour(s), shape (..., 3)."""
    lin = np.asarray(lin, dtype=np.float64)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_hex(L: np.ndarray) -> str:
    fy = (L[0] + 16) / 116; fx = fy + L[1] / 500; fz = fy - L[2] / 200
    t = np.array([fx, fy, fz]); xyz = np.where(t ** 3 > 216 / 24389, t ** 3, (116 * t - 16) / (24389 / 27)) * np.array([0.95047, 1.0, 1.08883])
    lin = np.linalg.solve(np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]), xyz)
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    return "".join(f"{int(round(v * 255)):02x}" for v in np.clip(s, 0, 1))


def de2000(a: np.ndarray, b: np.ndarray, kL: float = 2.0) -> np.ndarray:
    """CIEDE2000 between Lab arrays a (N,3) and b (M,3): (N,M). kL 2 weighs lightness half."""
    a = np.asarray(a, dtype=np.float64)[:, None, :]; b = np.asarray(b, dtype=np.float64)[None, :, :]
    L1, a1, b1 = a[..., 0], a[..., 1], a[..., 2]; L2, a2, b2 = b[..., 0], b[..., 1], b[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2); Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p; dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh)); dh = np.where(C1p * C2p == 0, 0, dh)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lm, Cmp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    hm = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = 1 - 0.17 * np.cos(np.radians(hm - 30)) + 0.24 * np.cos(np.radians(2 * hm)) + 0.32 * np.cos(np.radians(3 * hm + 6)) - 0.2 * np.cos(np.radians(4 * hm - 63))
    SL = 1 + 0.015 * (Lm - 50) ** 2 / np.sqrt(20 + (Lm - 50) ** 2); SC = 1 + 0.045 * Cmp; SH = 1 + 0.015 * Cmp * T
    RT = -2 * np.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)) * np.sin(np.radians(60 * np.exp(-((hm - 275) / 25) ** 2)))
    return np.sqrt((dLp / (kL * SL)) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))


def colour_lab(phrase: str) -> np.ndarray | None:
    """A colour phrase as Lab: the last colour word is the base; earlier colour words ("greyish-brown", "yellowish-grey")
    pull it a third of the way; modifiers (pale, dark, dull, bright) shift lightness and chroma."""
    words = [w for w in re.split(r"[\s-]+", phrase.lower()) if w]
    cols = [w for w in words if w in BASE and not (w == "dark" and words.index(w) < len(words) - 1)]
    if not cols:
        return None
    base = lab(_hex_lin(BASE[cols[-1]]))
    for w in cols[:-1]:
        base = base * (2 / 3) + lab(_hex_lin(BASE[w])) * (1 / 3)
    for w in words:
        if w in MODS and not (w == "dark" and cols == ["dark"]):
            dl, kc = MODS[w]
            base = np.array([min(97.0, max(4.0, base[0] + dl)), base[1] * kc, base[2] * kc])
    if "off" in words:
        base = np.array([base[0] - 4, base[1] * 0.8 + 1, base[2] * 0.8 + 6])
    return base


# ---- sources ----
def _get(url: str, tries: int = 4) -> bytes | None:
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            wait = float(e.headers.get("Retry-After") or 0) if e.headers else 0
            time.sleep(max(wait, 5 * (k + 1)))
        except Exception:
            time.sleep(3 * (k + 1))
    return None


def wikipedia(title: str) -> dict | None:
    """The article's plain text cut into (heading, text), its URL and revision; None if there is no article."""
    q = urllib.parse.urlencode({"action": "query", "prop": "extracts|info|revisions", "explaintext": 1, "inprop": "url",
                                "rvprop": "ids", "titles": title, "format": "json", "redirects": 1})
    raw = _get("https://en.wikipedia.org/w/api.php?" + q)
    time.sleep(1.0)
    if not raw:
        return None
    pages = json.loads(raw).get("query", {}).get("pages", {})
    p = next(iter(pages.values()), {})
    if "missing" in p or not p.get("extract"):
        return None
    parts = re.split(r"\n(==+ [^=]+ ==+)\n", p["extract"])
    secs = [("lead", parts[0])] + [(parts[i].strip("= "), parts[i + 1]) for i in range(1, len(parts) - 1, 2)]
    rev = (p.get("revisions") or [{}])[0].get("revid")
    return {"url": p.get("fullurl") or f"https://en.wikipedia.org/wiki/{urllib.parse.quote(p.get('title', title))}",
            "title": p.get("title"), "revision": rev, "sections": [(h, t) for h, t in secs if h == "lead" or SECTION.search(h)]}


def adw(sci: str) -> dict | None:
    """Animal Diversity Web's account (University of Michigan Museum of Zoology): its Physical Description section."""
    url = f"https://animaldiversity.org/accounts/{sci.strip().replace(' ', '_')}/"
    raw = _get(url, tries=2)
    time.sleep(0.5)
    if not raw:
        return None
    t = raw.decode("utf-8", "replace")
    i = t.find("Physical Description")
    if i < 0:
        return None
    seg = t[i:i + 12000]
    j = seg.find("Other Physical Features")
    seg = seg[:j] if j > 0 else seg[:5000]
    seg = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", seg, flags=re.S)
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", seg))).replace("Physical Description", "", 1).strip()
    return {"url": url, "title": f"ADW: {sci}", "revision": None, "sections": [("Physical Description", text)]} if text else None


# ---- facts ----
def _sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", re.sub(r"\([^()]*\d[^()]*\)", "", text))
    return [s.strip() for s in re.split(r"(?:(?<=[.!?])|(?<=[.!?][\"'\u201d\u2019]))\s+(?=[A-Z\"'\u201c])", text) if s.strip()]


def _keep(s: str, sci: str, male_text: bool) -> str | None:
    """Why a sentence is dropped, or None if it is kept."""
    if YOUNG.search(s) and not ADULTS_TOO.search(s):
        return "young"
    for name, rx in (("age change", AGE_CHANGE), ("morph", MORPH), ("regional", REGIONAL), ("other taxa", OTHER_TAXA),
                     ("past", PAST), ("not the body", NONBODY)):
        if rx.search(s):
            return name
    if re.match(r"(?:The|A|An)\s+[A-Z][a-z]+", s):   # another taxon is the subject (The Gyps vultures ...): ours was named "it"
        return "other taxa"
    for g, e in re.findall(r"\b([A-Z][a-z]+) ([a-z]{3,})\b", s):
        if g.lower() != sci.split()[0].lower() and f"{g} {e}" not in sci and re.search(rf"\(\s*{g} {e}", s):
            return "other taxa"
    if male_text and FEMALE.search(s) and not MALE.search(s):
        return "female"
    return None


def _strip_names(s: str, names: list[str]) -> str:
    """The species' own names out of a sentence (a blue wildebeest is not blue, a lappet-faced vulture's name is no face)."""
    for n in sorted({n for n in names if n}, key=len, reverse=True):
        s = re.sub(rf"\b{re.escape(n)}(?:es|s)?\b", "it", s, flags=re.I)
    return s


def _tokens(clause: str) -> list[tuple[int, str]]:
    return [(m.start(), m.group(0).lower()) for m in re.finditer(r"[A-Za-z]+(?:-[A-Za-z]+)*", clause)]


def _region_hits(clause: str) -> list[tuple[int, str]]:
    """(position, region) of the body words in a clause; "the underside of the wings" is the wings'."""
    clause = re.sub(r"\b(underside|undersides|underparts|surfaces?|insides?|parts?|portions?|tips?|base|edges?)\s+of\s+(?:the\s+|its\s+|their\s+)?",
                    lambda m: " " * len(m.group(0)), clause, flags=re.I)
    out = []
    for pos, w in _tokens(clause):
        for part in w.split("-"):
            r = REGION.get(part)
            if part in ("above", "below") and not re.match(r"(above|below)\s*(?:[,.;]|and\b|with\b|$)", clause[pos:], re.I):
                continue   # "a white band above both eyes" is no upper side
            if r and not (part in ("back", "backs") and re.match(r"(back|backs)\s+of\b", clause[pos:], re.I)):
                out.append((pos, r))
                break
    return out


def _pattern(w: str) -> str | None:
    return PATTERN.get(w) or PATTERN.get(w.split("-")[0]) or (PATTERN.get(w.split("-")[-1]) if "-" in w else None)


def _specific(regions) -> list[str]:
    """The regions named, without "body" when a part is named (scales on the tarsus are the legs')."""
    rr = sorted(set(regions))
    return [r for r in rr if r != "body"] or rr


def _next_word(after: str, n: int = 1) -> str:
    """The n-th word after a colour phrase, past the adjectives of a marking (large, faint, rosette-like, hairy...)."""
    skip = r"(?:[a-z]+-like|[a-z]+-shaped|tiny|small|large|faint|faded|irregular|solid|round|roundish|oval|bold|thin|" \
           r"oblique|vertical|transverse|broad|narrow|hairy|bushy|distinct|conspicuous|prominent|and|or|evenly|spaced)"
    words = re.findall(r"[a-z]+(?:-[a-z]+)*|[,.;:]", after)
    out = []
    for w in words:
        if w in ",":
            continue
        if w in ".;:":
            break
        if re.fullmatch(skip, w) or re.fullmatch(rf"(?:{COLOUR_RE})(?:ish)?(?:-(?:{COLOUR_RE})(?:ish)?)*", w):
            continue
        out.append(w)
        if len(out) >= n:
            break
    return out[n - 1] if len(out) >= n else ""


def facts_from(text: str, sci: str, names: list[str], male_text: bool, trace: list | None = None) -> tuple[list[dict], dict]:
    """(facts, dropped counts): a fact is {region, colours [phrases], pattern | None, male}. trace (a list) collects
    (sentence, why dropped | facts) for --explain."""
    out, dropped = [], {}
    for s in _sentences(text):
        if not PHRASE.search(s.lower()):
            continue
        s2 = _strip_names(s, names)
        why = _keep(s2, sci, male_text)
        about_it = re.match(r"(?:\w+,\s*)?(?:the\s+)?it\b", s2, re.I)   # the species is the subject
        if not why and not about_it and not _region_hits(s2) and not re.search("|".join(PATTERN), s2, re.I):
            why = "no body word"
        if why:
            dropped[why] = dropped.get(why, 0) + 1
            if trace is not None:
                trace.append((s2, why))
            continue
        n0 = len(out)
        sid = abs(hash(s2)) % 10 ** 8
        male = bool(MALE.search(s2))
        clauses = re.split(r",\s*(?=(?:the\s+)?(?:fe)?males?\b)|;|,\s*while\s|\swhile\s|,\s*whereas\s|,?\s+but\s|,?\s+with\s|\s+and\s+(?=an?\s)|,\s+and\s+(?=an?\s)", s2)
        prev = None
        for ci, cl in enumerate(clauses):
            if male_text and FEMALE.search(cl) and not MALE.search(cl):
                continue
            low = cl.lower()
            regs = _region_hits(cl)
            pats = [(p, _pattern(w)) for p, w in _tokens(cl) if _pattern(w)]
            phrases = [(m.start(), m.end(), m.group(0)) for m in PHRASE.finditer(low)]
            # a colour word capitalised mid-sentence is a name (Orange River, Red List); "green eyes" is no body colour
            phrases = [p for p in phrases if not (p[0] > 0 and cl[p[0]].isupper()) and colour_lab(p[2]) is not None
                       and not re.match(r"\s*(?:eyes?|iris|irises|pupils?)\b", low[p[1]:])]
            if not phrases:
                if regs:
                    prev = _specific(r for _, r in regs)
                continue
            last = None
            for k, (a, b, ph) in enumerate(phrases):
                after = low[b:b + 40]
                if male_text and re.match(r"\s*in (?:the |a )?(?:females?|hens?|cows)\b", after):
                    continue
                lo = phrases[k - 1][1] if k else 0
                hi = phrases[k + 1][0] if k + 1 < len(phrases) else len(cl)
                win_b = [(p, r) for p, r in regs if lo <= p < a]
                win_a = [r for p, r in regs if b <= p < hi]
                verb = re.search(r"\b(is|are|has|have|was|appears?|ranges?|varies|vary|being)\b", low[lo:a])
                subj = _specific(r for p, r in win_b if not verb or p < lo + verb.start()) if win_b else []
                nxt = _next_word(after)
                if _pattern(nxt):
                    pat = _pattern(nxt)
                    near = [(p, r) for p, r in regs if p >= b]   # the marking's place: the nearest body word after it
                    near = [r for p, r in near if p <= near[0][0] + 25] if near else []
                    rr = _specific(near) or subj or last or prev or ["body"]
                    if pat in ("tip", "tuft") and set(rr) <= {"body"}:
                        rr = ["tail"]
                    for r in rr:
                        out.append({"region": r, "colours": [ph], "pattern": pat, "male": male, "alt": f"{sid}.{ci}"})
                    last = rr
                    continue
                if ph.strip() == "dark":   # bare "dark" is only a marking's colour
                    continue
                if REGION.get(nxt) or REGION.get(nxt.split("-")[0]):
                    rr = [REGION.get(nxt) or REGION[nxt.split("-")[0]]]
                elif pats and pats[0][0] < a and not subj:
                    for r in (last or prev or ["body"]):
                        out.append({"region": r, "colours": [ph], "pattern": pats[0][1], "male": male, "alt": f"{sid}.{ci}"})
                    continue
                else:
                    rr = subj or _specific(win_a) or last or prev or ["body"]
                for r in rr:
                    out.append({"region": r, "colours": [ph], "pattern": None, "male": male})
                last = rr
            if regs:
                prev = _specific(r for _, r in regs)
        if trace is not None:
            trace.append((s2, out[n0:]))
    return out, dropped


def _summarise(facts: list[dict]) -> dict:
    """Per region: the ground colours, and the markings, each {pattern, colours}: the colours of one marking are the
    alternatives one clause gives ("reddish, deep brown or almost blackish spots"); two clauses, two markings (the
    monitor's greenish-yellow spots and the blackish spot in their middle)."""
    regions: dict[str, dict] = {}
    keyed: dict[tuple, dict] = {}
    for f in facts:
        e = regions.setdefault(f["region"], {"colours": [], "markings": []})
        for c in f["colours"]:
            c = re.sub(r"\s+", " ", c.strip())
            if f["pattern"] in (None, "tip", "tuft"):
                if f["pattern"]:
                    c = f"{c} {f['pattern']}"
                if c not in e["colours"]:
                    e["colours"].append(c)
            else:
                k = (f["region"], f["pattern"], f.get("alt"))
                mk = keyed.get(k)
                if not mk:
                    mk = keyed[k] = {"pattern": f["pattern"], "colours": []}; e["markings"].append(mk)
                if c not in mk["colours"]:
                    mk["colours"].append(c)
    for e in regions.values():   # the same marking said twice is one
        seen, ms = set(), []
        for m in e["markings"]:
            k = (m["pattern"], tuple(sorted(m["colours"])))
            if k not in seen:
                seen.add(k); ms.append(m)
        e["markings"] = ms
    return {r: regions[r] for r in ORDER if r in regions}


NICE = {"body": "body", "upperparts": "back", "flanks": "flanks", "underparts": "belly and underparts", "head": "head",
        "neck": "neck", "legs": "legs", "tail": "tail", "wings": "wings"}


def summary_text(app: dict, kind: str | None = None) -> str:
    parts = []
    for r, e in app.get("regions", {}).items():
        name = NICE[r]
        if r == "upperparts" and kind == "tortoise":
            name = "shell"
        elif r == "body" and kind == "tortoise":
            name = "shell and body"
        bits = []
        if e["colours"]:
            bits.append(", ".join(e["colours"][:4]))
        bypat: dict[str, list[str]] = {}
        for m in e["markings"]:
            for c in m["colours"]:
                if c not in bypat.setdefault(m["pattern"], []):
                    bypat[m["pattern"]].append(c)
        for pat, cols in list(bypat.items())[:3]:
            bits.append(("with " if bits else "") + ", ".join(cols[:3]) + " " + pat)
        if bits:
            parts.append(f"{name} {' '.join(bits)}")
    return "; ".join(parts)


def _cached(key: str, fetch, refresh: bool = False):
    p = CACHE / (re.sub(r"[^A-Za-z0-9_]+", "_", key) + ".json")
    if p.exists() and not refresh:
        try:
            return json.loads(p.read_text())
        except ValueError:
            pass
    v = fetch()
    if v is not None:
        CACHE.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(v))
    return v


def research(code: str, sci: str, common: str | None = None, refresh: bool = False, log=print, refetch: bool = False,
             explain: bool = False) -> dict:
    """The species' appearance, from the store unless refresh (or absent): see the module docstring."""
    p = STORE / f"{code}.json"
    refresh = refresh or refetch or explain
    if p.exists() and not refresh:
        try:
            return json.loads(p.read_text())
        except ValueError:
            pass
    names = [n for n in {common, (common or "").lower(), sci} if n]
    srcs = [s for s in (_cached(f"wp_{sci}", lambda: wikipedia(sci), refetch), _cached(f"adw_{sci}", lambda: adw(sci), refetch)) if s]
    if common and srcs and srcs[0].get("title"):
        names.append(srcs[0]["title"])
    def gather(sources):
        text_all = " ".join(t for s in sources for _, t in s["sections"])
        male_text = bool(re.search(r"\b(the male's|males are|adult males|the males|male has|males have)\b[^.]*\b(" + COLOUR_RE + r")\b", text_all, re.I))
        facts, used, dropped = [], [], {}
        for s in sources:
            n0 = len(facts)
            for _, t in s["sections"]:
                tr = [] if explain else None
                f, d = facts_from(t, sci, names, male_text, tr)
                for sent, res in tr or []:
                    log(f"   [{s['title']}] {sent[:160]}\n      -> " + (res if isinstance(res, str) else
                        "; ".join(f"{x['region']}:{'/'.join(x['colours'])}{' ' + x['pattern'] if x['pattern'] else ''}" for x in res)))
                facts += f
                for k, v in d.items():
                    dropped[k] = dropped.get(k, 0) + v
            if len(facts) > n0:
                used.append({"url": s["url"], "title": s["title"], **({"revision": s["revision"]} if s.get("revision") else {}),
                             "facts": len(facts) - n0})
        return facts, used, dropped, male_text
    facts, used, dropped, male_text = gather(srcs)
    if not any(f["region"] in ("body", "upperparts", "flanks") for f in facts):
        g = _cached(f"wp_{sci.split()[0]}", lambda: wikipedia(sci.split()[0]), refetch)   # the genus's article (redirects to the group's: Giraffa -> Giraffe)
        if g:
            gnames = names + [g.get("title") or "", (g.get("title") or "").lower()]
            names[:] = gnames
            f2, u2, d2, _ = gather([g])
            facts += f2; used += [{**u, "genus": True} for u in u2]
            for k, v in d2.items():
                dropped[k] = dropped.get(k, 0) + v
    app = {"format": FORMAT, "code": code, "scientific": sci, "common": common, "sex": "male" if male_text else "either",
           "regions": _summarise(facts), "facts": len(facts), "dropped": dropped, "sources": used,
           "retrieved": dt.date.today().isoformat(), "by": "pipeline/appearance.py",
           "licence": "facts (colours by body region) read from the sources listed; no text copied"}
    app["summary"] = summary_text(app)
    STORE.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(app, indent=1) + "\n")
    log(f"{code}: {app['facts']} facts from {len(used)} source(s): {app['summary'][:300]}")
    return app


def texture_lead(app: dict | None, kind: str | None = None) -> str:
    """The described appearance as the head of a texture prompt ('' when there is none)."""
    if not app or not app.get("regions"):
        return ""
    s = summary_text(app, kind)
    sex = "adult male" if app.get("sex") == "male" else "adult"
    return f"Coloured as the {sex} is described: {s}." if s else ""


# ---- the check ----
CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
PARTS = {0: "body", 1: "legs", 2: "legs", 3: "tail", 8: "tail", 6: "head", 4: "wings", 5: "wings", 9: "wings", 10: "wings"}


def read_glb(path: Path, mesh: str = "lod0") -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(positions, linear colours, part per vertex, triangles) of a fauna GLB's mesh."""
    b = Path(path).read_bytes()
    n = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + n])
    off = 20 + n; bn = struct.unpack("<I", b[off:off + 4])[0]; bin_ = b[off + 8:off + 8 + bn]

    def acc(i):
        a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
        dt_ = np.dtype(CT[a["componentType"]]); nc = NC[a["type"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0); stride = bv.get("byteStride") or dt_.itemsize * nc
        if stride == dt_.itemsize * nc:
            arr = np.frombuffer(bin_, dtype=dt_, count=a["count"] * nc, offset=o).reshape(a["count"], nc)
        else:
            arr = np.stack([np.frombuffer(bin_, dtype=dt_, count=nc, offset=o + k * stride) for k in range(a["count"])])
        return arr.astype(np.float64)
    ms = [m for m in j["meshes"] if m.get("name") == mesh] or j["meshes"][:1]
    P, C, R, I, base = [], [], [], [], 0
    for pr in ms[0]["primitives"]:
        at = pr["attributes"]
        p = acc(at["POSITION"]); c = acc(at["COLOR_0"])[:, :3] if "COLOR_0" in at else np.full((len(p), 3), 0.2)
        part = acc(at["_PART"])[:, 0] if "_PART" in at else np.zeros(len(p))
        w = acc(at["_PARTW"])[:, 0] if "_PARTW" in at else np.ones(len(p))
        part = np.where(w >= 0.5, part, 0)
        idx = acc(pr["indices"]).astype(int).reshape(-1, 3) if "indices" in pr else np.arange(len(p)).reshape(-1, 3)
        P.append(p); C.append(c); R.append(part); I.append(idx + base); base += len(p)
    return np.vstack(P), np.vstack(C), np.concatenate(R), np.vstack(I)


def model_regions(path: Path) -> dict:
    """{region: (Lab per face, area per face)} of a built model: its parts, the body by face normal."""
    P, C, R, I = read_glb(path)
    tri = P[I]
    cr = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); area = np.linalg.norm(cr, axis=1) / 2
    ny = cr[:, 1] / (2 * area + 1e-12)
    part = np.round(np.median(R[I], axis=1)).astype(int)
    L = lab(C[I].mean(1))
    reg = np.array([PARTS.get(int(k), "body") for k in part], dtype=object)
    body = reg == "body"
    reg[body & (ny > 0.35)] = "upperparts"; reg[body & (ny < -0.35)] = "underparts"; reg[body & (np.abs(ny) <= 0.35)] = "flanks"
    return {r: (L[reg == r], area[reg == r]) for r in sorted(set(reg.tolist()))}


_NAMES = [w for w in BASE if not w.endswith(("ish", "y")) or w in ("grey", "gray", "ivory")]
_NAME_LAB = np.array([lab(_hex_lin(BASE[w])) for w in _NAMES])


def _name_of(L: np.ndarray, A: np.ndarray) -> str | None:
    """The commonest colour word (by area) of faces, for the correction of a re-refine ("not orange")."""
    if not len(L):
        return None
    near = de2000(L, _NAME_LAB).argmin(1)
    votes = np.bincount(near, weights=A, minlength=len(_NAMES))
    return _NAMES[int(votes.argmax())]


def offs(result: dict) -> dict:
    """{region: the off colour} of a failed check's failing regions (kept with each attempt for the next correction)."""
    return {r: e["off"] for r, e in (result.get("regions") or {}).items()
            if e.get("off") and (e["match"] < REGION_PASS or e.get("missing"))}


def correction(result: dict, app: dict, kind: str | None = None, earlier: list | None = None) -> str:
    """What a failed check says to a re-refine: per failing region its described colours and the colours the builds had
    instead, this one's and earlier attempts' ("shell yellow, not cinnamon or orange"), and the markings it lacked."""
    bits = []
    before = {}
    for o in earlier or []:
        for r, c in (o or {}).items():
            before.setdefault(r, [])
            if c not in before[r]:
                before[r].append(c)
    regs = app.get("regions") or {}
    for r, e in (result.get("regions") or {}).items():
        failing = e["match"] < REGION_PASS or e.get("missing")
        if not failing or not e.get("off"):
            continue
        src = regs.get(r) or regs.get("body") or {}
        want = [c for c in src.get("colours", []) if not c.endswith(("tip", "tuft"))][:3]
        name = NICE[r] if not (kind == "tortoise" and r in ("upperparts", "flanks")) else "shell"
        bad = [c for c in [e["off"]] + before.get(r, []) if c not in " ".join(want)]
        if want and bad:
            bits.append(f"{name} {', '.join(want)}, not {' or '.join(dict.fromkeys(bad))}")
        for m in e.get("missing", []):
            bits.append(f"{name} with {m.split(' (')[0]}")
    bits = list(dict.fromkeys(bits))
    return ("Correct this: " + "; ".join(bits) + ".") if bits else ""


def _between(labs: list) -> np.ndarray:
    """The named colours and the colours between two chromatic ones (a coat "painted with brown, red and yellow" has
    the ochres between them; black to yellow is no olive-brown: only pairs with chroma over 20 each are joined)."""
    pts = [np.asarray(x) for x in labs]
    chrom = [x for x in pts if math.hypot(x[1], x[2]) > 20]
    for i in range(len(chrom)):
        for j in range(i + 1, len(chrom)):
            for t in (0.25, 0.5, 0.75):
                pts.append(chrom[i] * (1 - t) + chrom[j] * t)
    return np.array(pts)


ALLOW = {"upperparts": ["body", "neck", "flanks"], "flanks": ["body", "upperparts", "underparts"], "underparts": ["body", "flanks"],
         "head": ["body", "neck"], "legs": ["body"], "tail": ["body"], "wings": ["body", "upperparts"]}


def check(glb: Path, app: dict) -> dict:
    """How well a built model's colours follow its described appearance (see the module docstring): {ok, score,
    regions: {region: {share, match, missing markings}}, worst}."""
    regs = app.get("regions") or {}
    if not regs:
        return {"ok": True, "score": None, "why": "no described appearance"}
    mr = model_regions(glb)
    total = sum(a.sum() for _, a in mr.values())
    out, fails, num, den = {}, [], 0.0, 0.0
    for r, (L, A) in mr.items():
        share = float(A.sum() / total)
        own = regs.get(r) or {}
        allowed, marks = [], []
        for src in [r] + ALLOW.get(r, []):
            e = regs.get(src) or {}
            allowed += [c for c in e.get("colours", [])]
            for m in e.get("markings", []):
                allowed += m["colours"]
                # a region's own markings, and the whole body's on the back and flanks, must be there
                if (src == r or (src == "body" and r in ("upperparts", "flanks"))) and m["pattern"] not in ("lines", "mask", "rings", "marks"):
                    marks.append((m["pattern"], m["colours"]))
        allowed = [re.sub(r"\s+(tip|tuft)$", "", c) for c in allowed]
        labs = [colour_lab(c) for c in allowed]
        labs = [x for x in labs if x is not None]
        if not labs or share < MIN_REGION:
            continue
        d = de2000(L, _between(labs)).min(1)
        match = float(A[d <= MATCH_DE].sum() / max(A.sum(), 1e-12))
        off = _name_of(L[d > MATCH_DE], A[d > MATCH_DE]) if match < 0.9 else None
        miss = []
        if share >= MIN_REGION and own is not None:
            for pat, cols in marks:
                ml = [colour_lab(c) for c in cols]; ml = np.array([x for x in ml if x is not None])
                if len(ml):
                    have = float(A[de2000(L, ml).min(1) <= MATCH_DE].sum() / max(A.sum(), 1e-12))
                    if have < MARK_SHARE:
                        miss.append(f"{'/'.join(cols)} {pat} ({have:.1%})")
        out[r] = {"share": round(share, 3), "match": round(match, 3), **({"missing": miss} if miss else {}),
                  **({"off": off} if off else {}), "described": bool(own)}
        num += match * share; den += share
        if match < REGION_PASS and (own or r in ("upperparts", "flanks")):
            fails.append(f"{r} {match:.0%} matches")
        fails += [f"{r}: no {m}" for m in miss]
    score = round(num / den, 3) if den else None
    if score is not None and score < SCORE_PASS:
        fails.append(f"only {score:.0%} of the model in described colours")
    return {"ok": not fails, "score": score, "fails": fails, "regions": out, "match_de": MATCH_DE}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Research a species' appearance (colours by body region) and check a model against it.")
    ap.add_argument("codes", nargs="+")
    ap.add_argument("--refresh", action="store_true", help="read the facts again from the cached sources")
    ap.add_argument("--refetch", action="store_true", help="fetch the sources again")
    ap.add_argument("--explain", action="store_true", help="show each sentence read and what it gave")
    ap.add_argument("--check", action="store_true", help="also check client/assets/fauna/<code>.glb against it")
    a = ap.parse_args(argv)
    sys.path.insert(0, str(ROOT))
    from pipeline.fauna_models import _traits
    for code in a.codes:
        t = _traits(code)
        sci = t.get("scientific") or code.replace("_", " ").capitalize()
        app = research(code, sci, t.get("common"), refresh=a.refresh, refetch=a.refetch, explain=a.explain)
        if not (a.refresh or a.refetch or a.explain):
            print(f"{code}: {app.get('summary', '')[:300]}")
        glb = ROOT / "client" / "assets" / "fauna" / f"{code}.glb"
        if a.check and glb.exists():
            c = check(glb, app)
            print(f"  check: {'ok' if c['ok'] else 'MISMATCH'} score {c['score']} {'; '.join(c.get('fails', []))}")
            for r, e in c.get("regions", {}).items():
                print(f"    {r:11s} share {e['share']:.2f} match {e['match']:.2f} {e.get('missing', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
