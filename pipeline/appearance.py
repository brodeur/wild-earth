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
            lightness; grey before a hue is a low chroma, the ISCC-NBS sense of "grayish"), within MATCH_DE; a described
            region passes when REGION_PASS of it matches, the whole model when SCORE_PASS does, and a described marking
            must be there (MARK_SHARE of its region; the body's markings, one per pattern whatever colour each source
            gives it, on the back and flanks together); a snake's underside lies on the ground and is not judged. The
            thresholds are fitted to the judge's verdicts (fit_check). A model that fails is re-refined once
            (pipeline/fauna_models.py).

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
FORMAT = 2            # 2: the features (horns, tail, sizes) and the marking-before-region-word rule (2026-11-06, iteration 7)
# The thresholds were fitted (iteration 8, fit_check, library/animals/check_fit.json) to the 39 library models whose
# verdicts are known: MATCH_DE, MARK_SHARE, GROUND_MIN and PATCH_SHARE kept iteration 7's values; REGION_PASS fell from
# 0.5 to 0.3 and SCORE_PASS from 0.6 to 0.4 (the accepted garter snake's black back against its described greyish-green:
# 34% of the back and 44% of the model in described colours; no rejected model passes for it)
MATCH_DE = 16.0       # CIEDE2000 (kL 2) within which a face's colour is one the description names
REGION_PASS = 0.3     # a region passes when at least this share of its area matches
MARK_SHARE = 0.015    # a described marking's colour must cover at least this share of its region
MIN_REGION = 0.06     # regions under this share of the model's area are not judged
SCORE_PASS = 0.4      # and this share of the model, all regions together, must be in described colours
GROUND_MIN = 0.12     # where markings are described, at least this share of the region in its ground colours

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
GREYISH = {"grey", "gray", "greyish", "grayish"}
GREYISH_C = 0.4         # a hue's chroma under a grey modifier (ISCC-NBS "grayish": chroma about 1.5-3 of a hue's 6-10)
LIGHTNESS_WORDS = {"pale", "light", "dark", "deep"}
KL_NAMED = 2.0          # the lightness weight of a phrase that names its lightness (colour_kl): the fit kept 2 (at 1 the
                        # Egyptian goose's grey-brown flanks fail its "light brown"; no rejected model needs it)
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
    "bellies": "underparts", "underparts": "underparts", "underside": "underparts", "undersides": "underparts", "below": "underparts",
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
MORPH = re.compile(r"\b(variet\w*|occasional\w*|sometimes|rarely|some individuals|morphs?|melanis\w*|leucis\w*|albin\w*|panthers?|captiv\w*|hybrids?|aberrant|domestic\w*)\b", re.I)
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
        if w in GREYISH and cols[-1] not in GREYISH:
            # "greyish green", "grayish brown": grey before a hue names a low chroma, not a hue (the ISCC-NBS colour
            # names, NBS Circular 553: "grayish" is the low-chroma band of a hue); the third-of-the-way pull left
            # iteration 7's grayish-green at chroma 29, a fresh green no garter snake has (iteration 8)
            base = np.array([base[0] * (2 / 3) + lab(_hex_lin(BASE[w]))[0] * (1 / 3), base[1] * GREYISH_C, base[2] * GREYISH_C])
            continue
        base = base * (2 / 3) + lab(_hex_lin(BASE[w])) * (1 / 3)
    for w in words:
        if w in MODS and not (w == "dark" and cols == ["dark"]):
            dl, kc = MODS[w]
            base = np.array([min(97.0, max(4.0, base[0] + dl)), base[1] * kc, base[2] * kc])
    if "off" in words:
        base = np.array([base[0] - 4, base[1] * 0.8 + 1, base[2] * 0.8 + 6])
    return base


def colour_kl(phrase: str, named: float | None = None) -> float:
    """The lightness weight a colour phrase is matched with (CIEDE2000 kL): half weight (2) as a rule, since a colour
    word says hue and chroma better than lightness; full weight (1) where the phrase states its lightness ("light
    orange", "pale buff", "dark brown"): iteration 7 matched a rust-red spot (L 45) to "light orange" (L 73)."""
    words = [w for w in re.split(r"[\s-]+", phrase.lower()) if w]
    return (KL_NAMED if named is None else named) if any(w in LIGHTNESS_WORDS for w in words[:-1]) else 2.0


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
        if re.fullmatch(skip, w) or w in MODS or re.fullmatch(rf"(?:{COLOUR_RE})(?:ish)?(?:-(?:{COLOUR_RE})(?:ish)?)*", w):
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
                # a region word between the colour and a pattern word is the marking's place, not the colour's ground: "a
                # yellow dorsal stripe" (2026-11-06: the garter snake's stripe colour was read as its back's)
                reg_mark = REGION.get(nxt) and nxt not in ("body", "coat", "skin", "fur", "scales") and _pattern(_next_word(after, 2))
                if _pattern(nxt) or reg_mark:
                    pat = _pattern(nxt) or _pattern(_next_word(after, 2))
                    near = [(p, r) for p, r in regs if p >= b]   # the marking's place: the nearest body word after it
                    near = [r for p, r in near if p <= near[0][0] + 25] if near else []
                    rr = ([REGION[nxt]] if reg_mark else []) or _specific(near) or subj or last or prev or ["body"]
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
            old = json.loads(p.read_text())
            if old.get("format", 1) >= FORMAT:
                return old
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
    app["features"] = features_from([s for s in srcs], sci, names)
    STORE.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(app, indent=1) + "\n")
    log(f"{code}: {app['facts']} facts from {len(used)} source(s): {app['summary'][:300]}")
    return app


# ---- features: what the description says of the horns, the tail and the size (iteration 7) ----
# The colour facts above leave out the horns (non-body matter) and every number. A model can wear the right colours and
# still be another animal: an ibex's long curved horns on a mountain goat, a raccoon's long ringed tail on a badger. These
# are read from the same sources, by one rule for every species: each measurement (a number with a unit, or a range) is
# given to the subject named nearest before it in its clause, or to the phrase just after it ("at the shoulder", "from
# nose to tail", "in head-and-body length"); a unit conversion in brackets after a measurement is dropped; the horns'
# and the tail's words (short, long, curved, pronged ...) and the horns' colour are read from the clauses that name them.
# Sentences about the young, females only, other taxa, regional forms and the past are dropped as for the colours.
UNIT = {"mm": 0.001, "cm": 0.01, "m": 1.0, "in": 0.0254, "ft": 0.3048}
_NUM = r"\d+(?:\.\d+)?"
MEAS = re.compile(rf"(?<![\d.])({_NUM})(?:\s*(mm|cm|m|in|ft)\b)?\s*(?:to|–|—|-|and)\s*({_NUM})\s*(mm|cm|m|in|ft)\b"
                  rf"|(?<![\d.])({_NUM})\s*(mm|cm|m|in|ft)\b")
SUBJECT_BEFORE = [("horn", r"\bhorns?\b|\bhorn sheaths?\b"), ("antler", r"\bantlers?\b"), ("tail", r"\btails?\b"),
                  ("ear", r"\bears?\b"), ("shoulder", r"\bshoulders?\b|\bwithers\b"),
                  ("total", r"\b(?:head|nose|snout) to (?:the )?tail\b|\btotal length\b"),
                  ("head_body", r"\bhead[\s–-]*(?:and|to)?[\s–-]*body\b|\bbody length\b"),
                  ("other", r"\b(?:manes?|beards?|hairs?|fur|hooves|feet|foot|skull|neck|legs?|wingspan|eggs?|young|weigh\w*)\b")]
SUBJECT_AFTER = [("shoulder", r"^[^.;]{0,30}?\b(?:at|to) the (?:shoulders?|withers)\b|^[^.;]{0,25}?shoulder height"),
                 ("total", r"^[^.;]{0,25}?\b(?:from )?(?:the )?(?:head|nose|snout) to (?:the )?tail\b|^[^.;]{0,20}?total length"),
                 ("head_body", r"^[^.;]{0,25}?\bhead[\s–-]*(?:and|to)?[\s–-]*body\b|^[^.;]{0,20}?body length")]
HORN_WORDS = {"short": "short", "small": "short", "long": "long", "large": "long", "massive": "long", "curved": "curved",
              "curve": "curved", "curves": "curved", "curl": "curled", "curled": "curled", "curling": "curled",
              "spiral": "spiral", "spiralled": "spiral", "twisted": "spiral", "straight": "straight", "erect": "straight",
              "pronged": "pronged", "prong": "pronged", "prongs": "pronged", "forked": "pronged", "hook": "hooked",
              "hooked": "hooked", "thin": "thin", "slender": "thin"}
TAIL_WORDS = {"short": "short", "small": "short", "stubby": "short", "stub": "short", "inconspicuous": "short",
              "vestigial": "short", "tiny": "short", "long": "long", "bushy": "bushy", "ringed": "rings", "rings": "rings",
              "banded": "rings", "bands": "rings"}
PAST_F = re.compile(r"\b(had|were|existed|extinct|fossils?|pleistocene|epoch|prehistoric|ancestors?)\b", re.I)


def _raw_sentences(text: str) -> list[str]:
    """Sentences with their numbers kept; a bracketed conversion after a measurement dropped ("1 m (3.3 ft)")."""
    text = re.sub(r"\s+", " ", text)
    text = re.sub(rf"((?:{_NUM})\s*(?:mm|cm|m|in|ft|kg|lb|g)\b)\s*\([^()]*\)", r"\1", text)
    text = re.sub(r"\(([^()]*)\)", r", \1,", text)
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+(?=[A-Z])", text) if x.strip()]


def _subject(clause: str, start: int, end: int, lo: int) -> str | None:
    after = clause[end:end + 60]
    for name, rx in SUBJECT_AFTER:
        if re.search(rx, after, re.I):
            return name
    best, bp = None, -1
    for name, rx in SUBJECT_BEFORE:
        for m in re.finditer(rx, clause[lo:start], re.I):
            if m.start() > bp:
                best, bp = name, m.start()
    return best


def features_from(sources: list[dict], sci: str, names: list[str]) -> dict:
    """{horns, tail, shoulder_m, head_body_m, total_m} read from the sources' sections (see above)."""
    meas: dict[str, list[tuple[float, float]]] = {}
    horn = {"described": False, "words": [], "colours": []}
    tail = {"words": []}
    for src in sources:
        for _, text in src.get("sections", []):
            for sent in _raw_sentences(text):
                s2 = _strip_names(sent, names)
                if YOUNG.search(s2) and not ADULTS_TOO.search(s2):
                    continue
                if FEMALE.search(s2) and not MALE.search(s2) and not re.search(r"\bboth sexes\b|\bmale and female\b", s2, re.I):
                    continue
                if any(rx.search(s2) for rx in (MORPH, REGIONAL, OTHER_TAXA, PAST_F)):
                    continue
                for cl in re.split(r";|,\s*while\s|\swhereas\s|,?\s+but\s", s2):
                    lo = 0
                    for m in MEAS.finditer(cl):
                        if m.group(5):
                            a = b = float(m.group(5)); u = m.group(6)
                        else:
                            a, b, u = float(m.group(1)), float(m.group(3)), m.group(4)
                            if m.group(2) and m.group(2) != u:
                                a = a * UNIT[m.group(2)] / UNIT[u]
                        subj = _subject(cl, m.start(), m.end(), lo)
                        if re.search(r"\b(?:span|spread|across|apart|wide|width|circumference|girth|base)\b", cl[max(lo, m.start() - 40):m.end() + 25], re.I):
                            subj = None   # a horn span or a base's girth, not a length
                        lo = m.end()
                        if subj in ("horn", "tail", "shoulder", "total", "head_body"):
                            meas.setdefault(subj, []).append((min(a, b) * UNIT[u], max(a, b) * UNIT[u]))
                    low = cl.lower()
                    if re.search(r"\bhorns?\b", low) and not re.search(r"\bhorn to horn\b|\bbetween (?:the |its |their )?horns\b", low):
                        horn["described"] = True
                        for w in re.findall(r"[a-z]+", low):
                            if w in HORN_WORDS and HORN_WORDS[w] not in horn["words"]:
                                horn["words"].append(HORN_WORDS[w])
                        for ph in PHRASE.finditer(low):
                            nxt = _next_word(low[ph.end():ph.end() + 40])
                            if (nxt.startswith("horn") or re.match(r"\s*in colou?r", low[ph.end():ph.end() + 12])) \
                                    and colour_lab(ph.group(0)) is not None and ph.group(0) not in horn["colours"]:
                                horn["colours"].append(ph.group(0))
                    if re.search(r"\btails?\b", low):
                        # the words of the tail's own phrase: "a short tail", "the tail is short", not "long ears and an
                        # inconspicuous tail" (the ears' long)
                        for m in re.finditer(r"\btails?\b", low):
                            near = re.findall(r"[a-z]+", low[max(0, m.start() - 25):m.end() + 25])
                            for w in near:
                                if w in TAIL_WORDS and TAIL_WORDS[w] not in tail["words"] and not \
                                        re.search(rf"\b{w}\s+(?:ears?|legs?|hair|mane|neck|horns?)\b", low):
                                    tail["words"].append(TAIL_WORDS[w])
    # each measure as the median of the lower bounds and of the upper ones: a stray figure (a moose "more than 30 cm
    # higher at the shoulder than the next-largest deer") does not stretch the range
    rng = lambda k: [round(float(np.median([a for a, _ in meas[k]])), 4), round(float(np.median([b for _, b in meas[k]])), 4)] if meas.get(k) else None
    if rng("horn"):
        horn["described"] = True
    horn["length_m"] = rng("horn")
    tail["length_m"] = rng("tail")
    return {"horns": horn, "tail": tail, "shoulder_m": rng("shoulder"), "head_body_m": rng("head_body"), "total_m": rng("total")}



def feature_lead(app: dict | None) -> str:
    """The described defining features as a sentence for the mesh prompt ('' when none): "Horns short, black, pronged,
    about 25 cm long. Tail short, about 10 cm." (iteration 7: a mountain goat asked for in words got an ibex's horns)."""
    f = (app or {}).get("features") or {}
    bits = []
    h = f.get("horns") or {}
    if h.get("described"):
        w = [x for x in h.get("words", []) if not (x == "long" and "short" in h.get("words", []) and h.get("length_m"))]
        hl = h.get("length_m")
        if hl and f.get("shoulder_m") and _mid(hl) / _mid(f["shoulder_m"]) < 0.4:
            w = ["short"] + [x for x in w if x not in ("short", "long")]
        desc = ", ".join(dict.fromkeys(w + h.get("colours", [])[:1]))
        bits.append(f"Horns {desc}" + (f", about {round(_mid(hl) * 100)} cm long" if hl else "") + ".")
    t = f.get("tail") or {}
    tl = t.get("length_m")
    if tl or "short" in t.get("words", []):
        hb = _mid(f.get("head_body_m")) or ((_mid(f.get("total_m")) - _mid(tl)) if tl and f.get("total_m") else None)
        short = ("short" in t.get("words", []) and "long" not in t.get("words", [])) or (tl and hb and _mid(tl) / hb < 0.25)
        if short:
            bits.append("Tail short" + (f", about {round(_mid(tl) * 100)} cm" if tl else "") + ".")
    return " ".join(bits)


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
            if e.get("off") and (e.get("match", 1.0) < REGION_PASS or e.get("missing"))}


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
        failing = e.get("match", 1.0) < REGION_PASS or e.get("missing")
        if not failing:
            continue
        src = regs.get(r) or regs.get("body") or {}
        want = [c for c in src.get("colours", []) if not c.endswith(("tip", "tuft"))][:3]
        name = NICE[r] if not (kind == "tortoise" and r in ("upperparts", "flanks")) else "shell"
        bad = [c for c in [e.get("off")] + before.get(r, []) if c and c not in " ".join(want)]
        if want and bad and e.get("off"):
            bits.append(f"{name} {', '.join(want)}, not {' or '.join(dict.fromkeys(bad))}")
        for m in e.get("missing", []):
            bits.append(f"{name} with {m.split(' (')[0]}")
    # the texture's features (iteration 7): what the feature check found on the coat
    fe = result.get("features") or {}
    main = (fe.get("measured") or {}).get("coat_main")
    for f in fe.get("texture", []):
        if f.startswith("tail ringed"):
            bits.append("the tail plain, no rings or bands")
        elif "pale patch" in f:   # the coat's own main colour, without the patch
            bits.append(f"the coat evenly {main or 'one colour'} all over the back, shoulders and flanks, no pale patches or blotches")
    # a region in its markings' colours: its ground colour named, the markings kept narrow (the garter snake's stripes)
    for f in result.get("fails") or []:
        m = re.match(r"(\w+): only \d+% in its ground colours", f)
        if m:
            r = m.group(1); e = regs.get(r) or {}
            ground = [c for c in e.get("colours", []) if not c.endswith(("tip", "tuft"))][:2]
            marks = [(mk["pattern"], mk["colours"][0]) for mk in e.get("markings", []) + (regs.get("body") or {}).get("markings", [])][:1]
            if ground:
                bits.append(f"{NICE[r]} {' or '.join(ground)} as the ground colour" + (f", with only narrow {marks[0][1]} {marks[0][0]} on it" if marks else ""))
    bits = list(dict.fromkeys(bits))
    return ("Correct this: " + "; ".join(bits) + ".") if bits else ""


def _specs(phrases: list, kl_named: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(Lab, kL) of the named colours and of the colours between two chromatic ones (a coat "painted with brown, red and
    yellow" has the ochres between them; black to yellow is no olive-brown: only pairs with chroma over 20 each are
    joined, at the more lenient of the two lightness weights). Tip and tuft colours count as colours."""
    pts = []
    for c in phrases:
        c = re.sub(r"\s+(tip|tuft)$", "", c)
        L = colour_lab(c)
        if L is not None:
            pts.append((np.asarray(L, dtype=np.float64), colour_kl(c, kl_named)))
    chrom = [p for p in pts if math.hypot(p[0][1], p[0][2]) > 20]
    for i in range(len(chrom)):
        for j in range(i + 1, len(chrom)):
            for t in (0.25, 0.5, 0.75):
                pts.append((chrom[i][0] * (1 - t) + chrom[j][0] * t, max(chrom[i][1], chrom[j][1])))
    if not pts:
        return np.zeros((0, 3)), np.zeros(0)
    return np.array([p[0] for p in pts]), np.array([p[1] for p in pts])


def _dist(L: np.ndarray, specs: tuple) -> np.ndarray:
    """Each face's (Lab row's) distance to the nearest named colour (CIEDE2000, each colour at its own lightness weight)."""
    labs, kls = specs
    d = np.full(len(L), np.inf)
    for k in np.unique(kls):
        d = np.minimum(d, de2000(L, labs[kls == k], kL=float(k)).min(1))
    return d


ALLOW = {"upperparts": ["body", "neck", "flanks"], "flanks": ["body", "upperparts", "underparts"], "underparts": ["body", "flanks"],
         "head": ["body", "neck"], "legs": ["body"], "tail": ["body"], "wings": ["body", "upperparts"]}
BODY_SIDES = ("upperparts", "flanks")          # where the whole body's markings are looked for, together
UNMARKED = ("lines", "mask", "rings", "marks")  # patterns too fine or too local to require by area
# a body lying on the ground (tools/build_snake.py's rig kind): the faces facing down are against the ground, unseen from
# any eye above it, so they are not judged (iteration 8: the accepted garter snake's grey belly, described yellow)
GROUND_BODIES = {"snake"}


def colour_stats(mr: dict, regs: dict, kind: str | None = None, match_de: float = MATCH_DE, kl_named: float | None = None) -> dict:
    """What the colour check measures on a model's regions (model_regions) at one tolerance: per judged region its share
    of the model, the share matching its described colours, the share in its ground colours (where markings are
    described) and each required marking's share; and the body's markings on the back and flanks together."""
    hidden = {"underparts"} if kind in GROUND_BODIES else set()
    total = sum(a.sum() for r, (_, a) in mr.items() if r not in hidden)
    # one marking per pattern on the body: the sources describe the same stripes with different colours ("yellow" in one,
    # "yellow, light orange or white" in another); any of them, anywhere on the back and flanks together, is the marking
    body_marks: dict = {}
    for src in ("body",) + BODY_SIDES:
        for m in (regs.get(src) or {}).get("markings", []):
            if m["pattern"] not in UNMARKED:
                body_marks.setdefault(m["pattern"], [])
                body_marks[m["pattern"]] += [c for c in m["colours"] if c not in body_marks[m["pattern"]]]
    frac = lambda A, sel: float(A[sel].sum() / max(A.sum(), 1e-12))
    regions = {}
    for r, (L, A) in mr.items():
        if r in hidden:
            regions[r] = {"hidden": True}
            continue
        share = float(A.sum() / total)
        own = regs.get(r) or {}
        allowed, ground, marks = [], [], []
        for src in [r] + ALLOW.get(r, []):
            e = regs.get(src) or {}
            allowed += e.get("colours", []); ground += e.get("colours", [])
            for m in e.get("markings", []):
                allowed += m["colours"]
                if src == r and r not in BODY_SIDES and r != "body" and m["pattern"] not in UNMARKED:
                    marks.append((m["pattern"], m["colours"]))
        spec = _specs(allowed, kl_named)
        if not len(spec[0]) or share < MIN_REGION:
            continue
        d = _dist(L, spec)
        e = {"share": share, "match": frac(A, d <= match_de), "judged": bool(own) or r in BODY_SIDES, "described": bool(own),
             "marks": {}}
        e["off"] = _name_of(L[d > match_de], A[d > match_de]) if e["match"] < 0.9 else None
        gs = _specs(ground, kl_named)
        if (marks or (r in BODY_SIDES and body_marks)) and len(gs[0]):
            # a marking is a marking (iteration 7): where markings are described, the ground colours must hold some of it
            e["ground"] = frac(A, _dist(L, gs) <= match_de)
        for pat, cols in marks:
            ms = _specs(cols, kl_named)
            if len(ms[0]):
                e["marks"][f"{'/'.join(cols)} {pat}"] = frac(A, _dist(L, ms) <= match_de)
        regions[r] = e
    body = {}
    sides = [mr[r] for r in BODY_SIDES if r in regions and "match" in regions[r]]
    if body_marks and sides:
        L = np.vstack([s[0] for s in sides]); A = np.concatenate([s[1] for s in sides])
        for pat, cols in body_marks.items():
            ms = _specs(cols, kl_named)
            if len(ms[0]):
                body[f"{'/'.join(cols)} {pat}"] = frac(A, _dist(L, ms) <= match_de)
    return {"regions": regions, "body_marks": body}


def colour_fails(st: dict, p: dict) -> dict:
    """The colour check's verdict on colour_stats at the thresholds p: {fails, score, regions (rounded, for the record
    and the correction)}."""
    fails, num, den, out = [], 0.0, 0.0, {}
    for r, e in st["regions"].items():
        if e.get("hidden"):
            out[r] = {"hidden": True}
            continue
        miss = [f"{k} ({v:.1%})" for k, v in e["marks"].items() if v < p["mark_share"]]
        if e.get("ground") is not None and e["ground"] < p["ground_min"] and e["judged"]:
            fails.append(f"{r}: only {e['ground']:.0%} in its ground colours, the rest in its markings' colours")
        if e["match"] < p["region_pass"] and e["judged"]:
            fails.append(f"{r} {e['match']:.0%} matches")
        fails += [f"{r}: no {m}" for m in miss]
        num += e["match"] * e["share"]; den += e["share"]
        out[r] = {"share": round(e["share"], 3), "match": round(e["match"], 3), **({"missing": miss} if miss else {}),
                  **({"ground": round(e["ground"], 3)} if e.get("ground") is not None else {}),
                  **({"off": e["off"]} if e.get("off") else {}), "described": e["described"]}
    for k, v in st["body_marks"].items():
        if v < p["mark_share"]:
            fails.append(f"body: no {k} ({v:.1%})")
            for r in BODY_SIDES:
                if r in out and "match" in out[r]:
                    out[r].setdefault("missing", []).append(f"{k} ({v:.1%})")
    score = round(num / den, 3) if den else None
    if score is not None and score < p["score_pass"]:
        fails.append(f"only {score:.0%} of the model in described colours")
    return {"fails": fails, "score": score, "regions": out}


def check(glb: Path, app: dict, params: dict | None = None) -> dict:
    """How well a built model's colours follow its described appearance (see the module docstring): {ok, score, fails,
    regions: {region: {share, match, missing markings}}, features}. params: the thresholds (CHECK_PARAMS by default)."""
    p = {**CHECK_PARAMS, **(params or {})}
    regs = app.get("regions") or {}
    if not regs:
        return {"ok": True, "score": None, "why": "no described appearance"}
    kind = (glb_extras(glb).get("rig") or {}).get("kind")
    cc = colour_fails(colour_stats(model_regions(glb), regs, kind, p["match_de"], p["kl_named"]), p)
    # the defining features (iteration 7): horns, tail, rings, a pale patch, on a quadruped
    fc = feature_check(glb, app, p)
    return {"ok": not cc["fails"] and not fc["fails"], "score": cc["score"], "fails": cc["fails"] + fc["fails"],
            "colour_fails": cc["fails"], "features": fc, "regions": cc["regions"], "match_de": p["match_de"]}


# ---- the feature check (iteration 7): the defining features the description gives, measured on the built model ----
# What the colours cannot see. On a quadruped's GLB (tools/build_quadruped.py: _PART per vertex, extras.withers_m and
# extras.rig): the horns are the thin pieces standing out from the top of the head (the head part voxelised, opened by a
# ball of half the skull's thickness; what the opening removes and stands above the skull's centre is a protrusion, its
# length the geodesic distance from its base to its tip; when the horns' colour is described, the protrusions in it);
# their length is measured against the withers and compared with the described horn length against the described
# shoulder height; the tail's length (its parts' farthest point from the tail root) against the head and body (nose to
# tail root), compared with the description's tail against head-and-body (or total less tail); a tail is ringed when its
# lightness along its length alternates three times or more; a coat described with no markings on the back and flanks
# must not carry a large patch of a contrasting colour there (a white blotch on a grizzly's shoulder). Every comparison
# allows FEATURE_TOL either way of the described ratio (the descriptions give ranges; a model sized by mass may be
# stockier than the measured animal). A failed geometric feature (horns, tail length) needs a new mesh: the next rung is
# the reference photo (pipeline/fauna_models.py); a failed pattern (rings, patch) a new texture.
FEATURE_TOL = 1.6       # a measured ratio within 1/1.6 - 1.6 times the described one passes
SHORT_HORN = 0.35       # "short horns" with no figure: at most this share of the withers
SHORT_TAIL = 0.25       # "a short tail" with no figure: at most this share of head and body
PATCH_DE = 25.0         # a coat colour this far (CIEDE2000, kL 1) from the coat's main colour is a contrasting one
PATCH_DL = 15.0         # ... and this much lighter (a pale blotch)
PATCH_SHARE = 0.05      # a pale patch over this share of the back and flanks, on a coat described plain, in a colour the
                        # description does not give the coat (described_pale), fails
RING_DL = 7.0           # a tail band: lightness this far from the tail's median
RING_FLIPS = 2          # alternations along the tail that make it ringed
# the check's thresholds as one set (check(params=...) takes another: fit_check fits them to the judge's verdicts)
CHECK_PARAMS = {"match_de": MATCH_DE, "region_pass": REGION_PASS, "score_pass": SCORE_PASS, "mark_share": MARK_SHARE,
                "ground_min": GROUND_MIN, "patch_share": PATCH_SHARE, "kl_named": KL_NAMED}


def glb_extras(path: Path) -> dict:
    b = Path(path).read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20:20 + n]).get("extras") or {}


def _inside(P: np.ndarray, I: np.ndarray, lo: np.ndarray, h: float, shape: tuple) -> np.ndarray:
    """Voxel centres inside the closed surface (ray parity along x per (y, z) column)."""
    ny, nz = shape[1], shape[2]
    ys = lo[1] + (np.arange(ny) + 0.5) * h; zs = lo[2] + (np.arange(nz) + 0.5) * h
    cross: dict = {}
    tri = P[I]; hi = lo + np.array(shape) * h
    tmin, tmax = tri.min(1), tri.max(1)
    keep = (tmax[:, 1] >= lo[1]) & (tmin[:, 1] <= hi[1]) & (tmax[:, 2] >= lo[2]) & (tmin[:, 2] <= hi[2])
    for t in tri[keep]:
        j0 = max(0, int(np.ceil((t[:, 1].min() - lo[1]) / h - 0.5))); j1 = min(ny - 1, int(np.floor((t[:, 1].max() - lo[1]) / h - 0.5)))
        k0 = max(0, int(np.ceil((t[:, 2].min() - lo[2]) / h - 0.5))); k1 = min(nz - 1, int(np.floor((t[:, 2].max() - lo[2]) / h - 0.5)))
        if j1 < j0 or k1 < k0:
            continue
        Y, Z = np.meshgrid(ys[j0:j1 + 1], zs[k0:k1 + 1], indexing="ij")
        (y0, z0), (y1, z1), (y2, z2) = t[0, 1:], t[1, 1:], t[2, 1:]
        d = (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0)
        if abs(d) < 1e-14:
            continue
        a = ((y1 - Y) * (z2 - Z) - (y2 - Y) * (z1 - Z)) / d
        b = ((y2 - Y) * (z0 - Z) - (y0 - Y) * (z2 - Z)) / d
        m = (a >= 0) & (b >= 0) & (a + b <= 1)
        X = a * t[0, 0] + b * t[1, 0] + (1 - a - b) * t[2, 0]
        for jj, kk in zip(*np.nonzero(m)):
            cross.setdefault((j0 + jj, k0 + kk), []).append(X[jj, kk])
    G = np.zeros(shape, bool)
    xs = lo[0] + (np.arange(shape[0]) + 0.5) * h
    for (j, k), c in cross.items():
        c.sort()
        for q in range(0, len(c) - 1, 2):
            G[(xs > c[q]) & (xs < c[q + 1]), j, k] = True
    return G


def head_protrusions(P, C, R, I, withers: float, neck_base=None) -> list[dict]:
    """The thin pieces standing out from the top of the head part (horns, ears, antlers), longest first: {len_m, lab,
    rel (len / withers)}. See the section's comment."""
    from scipy import ndimage
    from scipy.spatial import cKDTree
    from skimage.graph import MCP_Geometric
    head = R == 6
    if head.sum() < 20:
        return []
    hp = P[head]
    h = withers / 120
    lo = hp.min(0) - 3 * h; hi = hp.max(0) + 3 * h
    shape = tuple(int(x) for x in np.ceil((hi - lo) / h))
    G = _inside(P, I, lo, h, shape)
    G = ndimage.binary_closing(G) | G
    idx = np.argwhere(G)
    if not len(idx):
        return []
    tree = cKDTree(P)
    _, nn = tree.query(lo + (idx + 0.5) * h)
    hv = np.zeros(shape, bool); hv[tuple(idx.T)] = head[nn]
    if not hv.any():
        return []
    edt = ndimage.distance_transform_edt(G)
    # the snout: the head part's point farthest from the neck base (a head turned toward the camera, from a photo, has
    # its snout off the +z axis); the skull: the thickest point within a fifth of the withers of it
    nb = np.array(neck_base, dtype=np.float64) if neck_base is not None else hp.mean(0)
    hornless = hp[np.argsort(np.linalg.norm(hp - nb, axis=1))[: max(1, int(0.9 * len(hp)))]]   # horn tips are far too
    nose = hornless[np.argmax(np.linalg.norm(hornless - nb, axis=1) - 0.5 * np.maximum(hornless[:, 1] - nb[1], 0))]
    vi = np.argwhere(hv); vc = lo + (vi + 0.5) * h
    near = np.linalg.norm(vc - nose, axis=1) < 0.2 * withers
    if not near.any():
        return []
    en = edt[tuple(vi[near].T)]
    skull = lo + (vi[near][np.argmax(en)] + 0.5) * h
    t = max(2.0, 0.55 * float(en.max()))
    r = int(t)
    ball = np.linalg.norm(np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1], axis=0) <= t
    opened = ndimage.binary_dilation(ndimage.binary_erosion(G, ball), ball) & G
    thin = G & ~opened & hv
    lab_, n = ndimage.label(thin, np.ones((3, 3, 3)))
    base = ndimage.binary_dilation(opened, np.ones((3, 3, 3)))
    out = []
    for k in range(1, n + 1):
        comp = lab_ == k
        if comp.sum() < 4:
            continue
        seeds = np.argwhere(comp & base)
        if not len(seeds):
            continue
        if lo[1] + (seeds[:, 1].mean() + 0.5) * h < skull[1]:   # below the skull's centre: a beard, a dewlap, the jaw
            continue
        dist, _ = MCP_Geometric(np.where(comp, 1.0, np.inf)).find_costs([tuple(x) for x in seeds])
        L = float(np.nanmax(np.where(comp, dist, np.nan))) * h + h
        _, nv = tree.query(lo + (np.argwhere(comp) + 0.5) * h)
        out.append({"len_m": round(L, 3), "rel": round(L / withers, 3), "lab": lab(C[nv].mean(0)).round(1).tolist()})
    return sorted(out, key=lambda o: -o["len_m"])


def coloured_pieces(P, C, R, I, want: np.ndarray, part: int = 6) -> list[dict]:
    """The pieces of a part (the head's, by default) in a described colour (a horn's black), longest first: {len_m (the
    piece's longest chord), n faces}. A horn too thin for the voxels at lod0 (a mountain goat's, 18 vertices) is still a
    piece of its own colour; the snout's black is a short one."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    fp = np.round(np.median(R[I], axis=1)).astype(int) == part
    if not fp.any() or not len(want):
        return []
    F = I[fp]
    hit = de2000(lab(C[F].mean(1)), want).min(1) <= MATCH_DE
    F = F[hit]
    if not len(F):
        return []
    cen = P[F].mean(1)
    e = float(np.median(np.linalg.norm(P[F][:, 0] - P[F][:, 1], axis=1)))
    pairs = cKDTree(cen).query_pairs(2.0 * e, output_type="ndarray")
    n = len(F)
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)) if len(pairs) else coo_matrix((n, n))
    k, lab_ = connected_components(g, directed=False)
    out = []
    for i in range(k):
        v = P[np.unique(F[lab_ == i].ravel())]
        if len(v) < 3:
            continue
        d = np.linalg.norm(v[:, None] - v[None], axis=-1).max()
        out.append({"len_m": round(float(d), 3), "faces": int((lab_ == i).sum())})
    return sorted(out, key=lambda o: -o["len_m"])


def tail_measure(P, C, R, I, rig: dict) -> dict:
    """{len_m, head_body_m, flips}: the tail parts' farthest point from the tail root, the nose to the tail root, and
    how often the tail's lightness along its length crosses from a dark band to a light one and back."""
    nose_z = float(P[:, 2].max())
    root = np.array(rig.get("tail") or [0, 0, P[:, 2].min()], dtype=np.float64)
    hb = nose_z - float(root[2])
    tv = np.isin(np.round(R).astype(int), (3, 8))
    if tv.sum() < 6 or not rig.get("tail"):
        return {"len_m": 0.0, "head_body_m": round(hb, 3), "flips": 0}
    d = np.linalg.norm(P[tv] - root, axis=1)
    tri = I[np.all(tv[I], axis=1)]
    flips = 0
    if len(tri) >= 20:
        dc = np.linalg.norm(P[tri].mean(1) - root, axis=1)
        L = lab(C[tri].mean(1))[:, 0]
        cr = np.cross(P[tri][:, 1] - P[tri][:, 0], P[tri][:, 2] - P[tri][:, 0]); A = np.linalg.norm(cr, axis=1) / 2
        edges = np.quantile(dc, np.linspace(0, 1, 13))
        prof = [float(np.average(L[(dc >= a) & (dc <= b)], weights=A[(dc >= a) & (dc <= b)] + 1e-12)) for a, b in zip(edges, edges[1:])
                if ((dc >= a) & (dc <= b)).any()]
        med = float(np.median(prof)); signs = [np.sign(x - med) for x in prof if abs(x - med) > RING_DL]
        flips = sum(1 for a, b in zip(signs, signs[1:]) if a != b)
    return {"len_m": round(float(d.max()), 3), "head_body_m": round(hb, 3), "flips": int(flips)}


def coat_patch(P, C, R, I, with_main: bool = False, with_colour: bool = False):
    """The largest connected pale patch of a colour contrasting with the coat's main colour, as a share of the back
    and flanks (the body part's faces facing up or sideways); with_main, also the main colour; with_colour, also the
    patch's own colour (its area-weighted mean Lab)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    tri = P[I]
    cr = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); A = np.linalg.norm(cr, axis=1) / 2
    ny = cr[:, 1] / (2 * A + 1e-12)
    part = np.round(np.median(R[I], axis=1)).astype(int)
    sel = (part == 0) & (ny >= -0.35) & (A > 0)
    if sel.sum() < 30:
        return (0.0, None, None) if with_colour else (0.0, None) if with_main else 0.0
    L = lab(C[I[sel]].mean(1)); As = A[sel]; cen = tri[sel].mean(1)
    # the coat's main colour: of its distinct colours, the one with the most area within PATCH_DE / 2 of it (shades of
    # one coat count together)
    uniq, inv = np.unique(np.round(L, 0), axis=0, return_inverse=True)
    ua = np.bincount(inv.ravel(), weights=As)
    top = np.argsort(-ua)[:40]
    near = de2000(uniq[top], uniq, kL=1.0) <= PATCH_DE / 2
    main = uniq[top[int(np.argmax(near @ ua))]]
    # a pale patch on the coat (a darker saddle or dorsal shading is common and seldom described: the wolf's)
    far = (de2000(L, main[None], kL=1.0)[:, 0] > PATCH_DE) & (L[:, 0] > main[0] + PATCH_DL)
    if not far.any():
        return (0.0, main, None) if with_colour else (0.0, main) if with_main else 0.0
    fc = cen[far]; fa = As[far]
    rad = 2.5 * float(np.sqrt(np.median(As)))
    pairs = cKDTree(fc).query_pairs(rad, output_type="ndarray")
    n = len(fc)
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)) if len(pairs) else coo_matrix((n, n))
    _, labels = connected_components(g, directed=False)
    w = np.bincount(labels, weights=fa)
    share = round(float(w.max() / As.sum()), 3)
    if with_colour:
        big = labels == int(np.argmax(w))
        return share, main, np.average(L[far][big], axis=0, weights=fa[big])
    return (share, main) if with_main else share


def _mid(r):
    return (r[0] + r[1]) / 2 if r else None


def described_pale(patch: np.ndarray, regs: dict, tol: float, kl_named: float | None = None) -> str | None:
    """The coat colour the description gives (the body, back, neck or flanks) that a pale patch is in, or None. A grizzly's
    frosted shoulders ("whitish-cream" on the back), a moose's brown on a black coat and an elephant's dust ("red",
    "brown") are described colours, not blotches (iteration 8: the patch rule flagged the three, the judge kept them).
    The ends of a range of individuals ("almost white", "nearly black") are no pattern on one animal and do not count."""
    cols = [c for r in ("body", "upperparts", "neck", "flanks") for c in (regs.get(r) or {}).get("colours", [])
            if not re.match(r"(?:almost|nearly)\b", c)]
    for c in cols:
        L = colour_lab(re.sub(r"\s+(tip|tuft)$", "", c))
        if L is not None and float(de2000(np.asarray(patch)[None], L[None], kL=colour_kl(c, kl_named))[0, 0]) <= tol:
            return c
    return None


def feature_check(glb: Path, app: dict, params: dict | None = None) -> dict:
    """The defining features the description gives, measured on a quadruped's GLB (see the section's comment):
    {fails, geometry (the failures a new mesh must fix), texture (a new texture), measured, expected}."""
    p = {**CHECK_PARAMS, **(params or {})}
    feats = app.get("features") or {}
    ex = glb_extras(glb)
    rig = ex.get("rig") or {}
    if rig.get("kind") != "quadruped" or not feats:
        return {"fails": [], "geometry": [], "texture": [], "measured": {}, "expected": {}}
    P, C, R, I = read_glb(glb)
    wm = float(ex.get("withers_m") or 1.0)
    geo, tex, meas, exp = [], [], {}, {}
    horns = feats.get("horns") or {}
    if horns.get("described"):
        prot = head_protrusions(P, C, R, I, wm, rig.get("head"))
        want = [colour_lab(c) for c in horns.get("colours", [])]; want = [w for w in want if w is not None]
        # the protrusions in the described horn colour; when the voxels find none (a horn too thin for them at lod0: a
        # mountain goat's, 18 vertices), the head's pieces in that colour, their longest chord (a black face mask that
        # joins the horns overstates it, so it is only the fallback); with no colour described, the longest protrusion
        cand = [p for p in prot if want and float(de2000(np.array([p["lab"]]), np.array(want)).min()) <= 2 * MATCH_DE and p["len_m"] > 2 * wm / 120]
        by = "voxel protrusion in the horn colour"
        if want and not cand:
            cand, by = coloured_pieces(P, C, R, I, np.array(want)), "piece in the horn colour"
        if not want:
            cand, by = prot, "voxel protrusion"
        best = cand[0]["len_m"] if cand else 0.0
        hl, sh = _mid(horns.get("length_m")), _mid(feats.get("shoulder_m"))
        rel = round(best / wm, 3)
        meas["horns"] = {"len_m": best, "of_withers": rel, "by": by}
        if hl and sh:
            e = hl / sh; exp["horns_of_withers"] = round(e, 3)
            if rel > e * FEATURE_TOL:
                geo.append(f"horns too long: {rel:.2f} of the withers, described {hl:.2f} m at a {sh:.2f} m shoulder ({e:.2f})")
            elif rel < 0.3 * e:
                geo.append(f"horns missing or stubs: {rel:.2f} of the withers, described {e:.2f}")
        elif "short" in horns.get("words", []) and "long" not in horns.get("words", []):
            exp["horns_of_withers"] = f"<= {SHORT_HORN} (short)"
            if rel > SHORT_HORN:
                geo.append(f"horns too long: {rel:.2f} of the withers, described short")
        elif not cand:
            geo.append("no horns: the description gives horns")
    tail = feats.get("tail") or {}
    tm = tail_measure(P, C, R, I, rig)
    rel = tm["len_m"] / max(tm["head_body_m"], 1e-6)
    meas["tail"] = {**tm, "of_head_body": round(rel, 3)}
    tl = _mid(tail.get("length_m"))
    hb = _mid(feats.get("head_body_m")) or ((_mid(feats.get("total_m")) - tl) if tl and feats.get("total_m") else None)
    if tl and hb and hb > tl:
        e = tl / hb; exp["tail_of_head_body"] = round(e, 3)
        if rel > e * FEATURE_TOL and rel - e > 0.05:
            geo.append(f"tail too long: {rel:.2f} of the head and body, described {tl:.2f} m of {hb:.2f} m ({e:.2f})")
    elif "short" in tail.get("words", []) and "long" not in tail.get("words", []):
        exp["tail_of_head_body"] = f"<= {SHORT_TAIL} (short)"
        if rel > SHORT_TAIL:
            geo.append(f"tail too long: {rel:.2f} of the head and body, described short")
    regs = app.get("regions") or {}
    # rings on the tail are described there, or come with a banded or striped body (a zebra's); a dorsal stripe is no band
    tail_marks = [m["pattern"] for r in ("tail", "body", "flanks") for m in (regs.get(r) or {}).get("markings", [])]
    if tm["flips"] >= RING_FLIPS and not ({"rings", "bands", "bars", "stripes"} & set(tail_marks)) and "rings" not in tail.get("words", []):
        tex.append(f"tail ringed ({tm['flips']} alternations), described without rings")
    marked = any((regs.get(r) or {}).get("markings") for r in ("body", "upperparts", "flanks"))
    if not marked and regs:
        share, main, pc = coat_patch(P, C, R, I, with_main=True, with_colour=True)
        meas["coat_patch"] = share
        if main is not None:
            meas["coat_main"] = _name_of(main[None], np.ones(1))
        named = described_pale(pc, regs, p["match_de"], p["kl_named"]) if pc is not None else None
        if pc is not None:
            meas["coat_patch_colour"] = named or _name_of(np.asarray(pc)[None], np.ones(1))
            meas["coat_patch_described"] = bool(named)
            meas["coat_patch_lab"] = [round(float(x), 1) for x in pc]
        if share > p["patch_share"] and not named:
            tex.append(f"a large pale patch on the coat ({share:.0%} of the back and flanks), in a colour the description does not give it")
    return {"fails": geo + tex, "geometry": geo, "texture": tex, "measured": meas, "expected": exp}


# ---- the check fitted to the judge's verdicts (iteration 8) ----
# The thresholds above were set by hand on a few models; iteration 7's check then flagged three models the judge kept
# (the garter snake, the grizzly, the moose). They are now fitted to every library model whose verdict is known
# (known_verdicts: each species' current model, accepted unless the judge or a record rejected it, and each judged job
# recorded in models.json `verdicts`, built again into the cache): a grid of the thresholds, scored by balanced accuracy
# (the mean of the rejected models flagged and the accepted models passed), ties broken toward iteration 7's values;
# leave-one-out (each model predicted by the thresholds fitted without it) says how well the fit generalises. The rule
# changes that let the fit agree for reasons, not by loosening everything, are in colour_lab (grey before a hue is low
# chroma), colour_kl (a phrase that names its lightness), colour_stats (one marking per pattern over the body; a snake's
# underside unseen) and described_pale (a pale patch in a described coat colour). `--fit` reruns it and writes
# library/animals/check_fit.json.
VERDICT_BUILDS = ROOT / "pipeline" / "_cache" / "verdict_builds"   # judged jobs built again (git-ignored)
FIT_GRID = {"match_de": (12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0), "kl_named": (1.0, 1.5, 2.0),
            "region_pass": (0.3, 0.4, 0.5, 0.6), "score_pass": (0.4, 0.5, 0.6, 0.7), "ground_min": (0.06, 0.12, 0.2),
            "mark_share": (0.005, 0.015, 0.03), "patch_share": (0.03, 0.05, 0.08, 0.12)}
ITERATION7 = {"match_de": 16.0, "kl_named": 2.0, "region_pass": 0.5, "score_pass": 0.6, "ground_min": 0.12,
              "mark_share": 0.015, "patch_share": 0.05}


def rule_served(e: dict) -> bool:
    """Whether a species' current model is drawn on the acceptance rule's decision alone (fauna_models.procedural_snake:
    `served_by` 'rule'; the procedural snakes' build), so it carries no recorded verdict (2026-11-07)."""
    return e.get("served_by") == "rule" or e.get("build") == "tools/build_snake_proc.py"


def known_verdicts() -> list[dict]:
    """The library's models whose verdicts are known: every species' current model (its judge's verdict; else a
    'current' entry of its `verdicts`; else accepted: drawn, no rejection recorded; but not a model the rule alone
    served, rule_served, unless someone has judged it) and every judged job in `verdicts`."""
    reg = json.loads((ROOT / "library" / "animals" / "models.json").read_text())["species"]
    out = []
    for code, e in reg.items():
        vs = e.get("verdicts") or []
        cur = next((v for v in vs if v["model"] == "current"), None)
        if e.get("judge"):
            verdict, by = e["judge"]["verdict"], e["judge"].get("by", "the judge")
        elif cur:
            verdict, by = cur["verdict"], cur["by"]
        elif rule_served(e):
            verdict = None   # served by the rule's own decision (a procedural snake): no one has judged it, and the rule is not fitted on itself
        else:
            verdict, by = "accepted", "drawn, no rejection recorded"
        if verdict is not None and e.get("glb"):
            out.append({"code": code, "model": "current", "glb": ROOT / e["glb"], "verdict": verdict, "by": by, "entry": e})
        for v in vs:
            if v["model"] != "current":
                out.append({"code": code, "model": v["model"], "job": ROOT / v["model"], "verdict": v["verdict"], "by": v["by"],
                            "glb": VERDICT_BUILDS / f"{code}__{Path(v['model']).name[:8]}.glb", "entry": e})
    return out


def _build_judged(k: dict, log=print) -> bool:
    """A judged job's model built again (its kind's build, without rig or clips: the check reads colours and parts)."""
    import subprocess
    if k["glb"].exists():
        return True
    from .fauna_models import BLENDER
    e = k["entry"]
    kind = e.get("kind", "quadruped")
    script = {"snake": "build_snake.py", "reptile": "build_reptile.py", "bird": "build_bird.py"}.get(kind, "build_quadruped.py")
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(ROOT / "tools" / script), "--", str(k["job"]), str(k["glb"]), "--species", k["code"]]
    if kind in ("bird", "reptile") and e.get("archetype"):
        cmd += ["--archetype", e["archetype"]]
    VERDICT_BUILDS.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if not k["glb"].exists():
        log(f"  {k['code']} {k['model']}: build failed ({(r.stdout + r.stderr).strip().splitlines()[-1:]})")
    return k["glb"].exists()


def _confusion(y: np.ndarray, flag: np.ndarray) -> dict:
    return {"rejected_flagged": int((y & flag).sum()), "rejected_passed": int((y & ~flag).sum()),
            "accepted_passed": int((~y & ~flag).sum()), "accepted_flagged": int((~y & flag).sum())}


def fit_check(log=print) -> dict:
    """The check's thresholds fitted to the known verdicts (see the section's comment): {params, confusion (in sample),
    loo (leave-one-out), models}."""
    import itertools
    from .fauna_models import appearance as app_of
    known = [k for k in known_verdicts() if _build_judged(k, log)]
    rows = []
    for k in known:
        app = app_of(k["code"]) or {}
        regs = app.get("regions") or {}
        kind = (glb_extras(k["glb"]).get("rig") or {}).get("kind")
        mr = model_regions(k["glb"]) if regs else {}
        fc = feature_check(k["glb"], app, {"patch_share": 9.0}) if regs else {"geometry": [], "texture": [], "measured": {}}
        meas = fc.get("measured") or {}
        fixed = fc["geometry"] + [f for f in fc["texture"] if "pale patch" not in f]   # what no threshold here moves
        stats = {(md, kl): colour_stats(mr, regs, kind, md, kl) for md in FIT_GRID["match_de"] for kl in FIT_GRID["kl_named"]} if regs else {}
        rows.append({"k": k, "regs": regs, "fixed": fixed, "stats": stats, "patch": meas.get("coat_patch", 0.0), "patch_lab": meas.get("coat_patch_lab")})
    names = list(FIT_GRID)
    combos = [dict(zip(names, v)) for v in itertools.product(*FIT_GRID.values())]
    y = np.array([r["k"]["verdict"] == "rejected" for r in rows])
    pale = {}
    def flagged(r, p):
        if not r["regs"]:
            return False
        if r["fixed"] or colour_fails(r["stats"][(p["match_de"], p["kl_named"])], p)["fails"]:
            return True
        if r["patch_lab"] is not None and r["patch"] > p["patch_share"]:
            key = (id(r), p["match_de"], p["kl_named"])
            if key not in pale:
                pale[key] = described_pale(np.array(r["patch_lab"]), r["regs"], p["match_de"], p["kl_named"])
            return not pale[key]
        return False
    F = np.array([[flagged(r, p) for r in rows] for p in combos])       # combos x models
    prior = np.array([sum(abs(FIT_GRID[n].index(p[n]) - FIT_GRID[n].index(ITERATION7[n])) / len(FIT_GRID[n]) for n in names) for p in combos])
    def best(idx):
        yy = y[idx]; f = F[:, idx]
        tpr = (f & yy).sum(1) / max(1, yy.sum()); tnr = (~f & ~yy).sum(1) / max(1, (~yy).sum())
        ba = (tpr + tnr) / 2
        top = np.flatnonzero(ba >= ba.max() - 1e-9)
        return int(top[np.argmin(prior[top])]), float(ba.max())
    allidx = np.arange(len(rows))
    b, ba = best(allidx)
    loo = np.array([F[best(np.delete(allidx, i))[0], i] for i in allidx])
    it7 = int(next(i for i, p in enumerate(combos) if p == ITERATION7))
    out = {"date": dt.date.today().isoformat(), "by": "pipeline/appearance.py fit_check", "models": len(rows),
           "rejected": int(y.sum()), "accepted": int((~y).sum()), "grid": {n: list(v) for n, v in FIT_GRID.items()},
           "params": combos[b], "balanced_accuracy": round(ba, 3),
           "confusion": _confusion(y, F[b]), "loo": _confusion(y, loo),
           "iteration7_thresholds_new_rules": _confusion(y, F[it7]),
           "per_model": [{"code": r["k"]["code"], "model": r["k"]["model"], "verdict": r["k"]["verdict"], "by": r["k"]["by"],
                          "flagged": bool(F[b][i]), "flagged_loo": bool(loo[i])} for i, r in enumerate(rows)]}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Research a species' appearance (colours by body region) and check a model against it.")
    ap.add_argument("codes", nargs="*")
    ap.add_argument("--fit", action="store_true", help="fit the check's thresholds to the known verdicts; writes library/animals/check_fit.json")
    ap.add_argument("--refresh", action="store_true", help="read the facts again from the cached sources")
    ap.add_argument("--refetch", action="store_true", help="fetch the sources again")
    ap.add_argument("--explain", action="store_true", help="show each sentence read and what it gave")
    ap.add_argument("--check", action="store_true", help="also check client/assets/fauna/<code>.glb against it")
    a = ap.parse_args(argv)
    sys.path.insert(0, str(ROOT))
    if a.fit:
        r = fit_check()
        (ROOT / "library" / "animals" / "check_fit.json").write_text(json.dumps(r, indent=1) + "\n")
        print(json.dumps({k: r[k] for k in ("params", "balanced_accuracy", "confusion", "loo", "iteration7_thresholds_new_rules")}, indent=1))
        return 0
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
                if "match" in e:
                    print(f"    {r:11s} share {e['share']:.2f} match {e['match']:.2f} {e.get('missing', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ---- the model's tint (2026-11-07, the herds lane) -------------------------------------------------------------------
# A served model whose coat should read another colour than it came out is tinted toward it by the client (fauna.json
# `tint`, per linear channel on the vertex colours: animals.js installFauna, the drawn model's tiers and the procedural
# stand-in alike) rather than re-textured. Which colour is a recorded per-species choice (library/animals/tints.json:
# the target, its reason and source), since the descriptions often allow several (the bison's "dark-brown, brown": its
# mesh matches "brown", a reddish tan, and a herd of four hundred read from a ridge as a pale pink patch); the
# multiplier is the rule: the target over the model's body colour (upperparts and flanks, the area-weighted median of
# the faces' linear colour), per channel, each within TINT_RANGE.
TINT_RANGE = (0.2, 2.0)
TINTS = Path(__file__).resolve().parent.parent / "library" / "animals" / "tints.json"


def body_colour(glb: Path) -> np.ndarray | None:
    """The model's body colour (linear RGB): its upperparts and flanks, the area-weighted median per channel."""
    if not Path(glb).exists():
        return None
    P, C, R, I = read_glb(glb)
    tri = P[I]; cr = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); area = np.linalg.norm(cr, axis=1) / 2
    ny = cr[:, 1] / (2 * area + 1e-12); part = np.round(np.median(R[I], axis=1)).astype(int)
    body = np.array([PARTS.get(int(k), "body") == "body" for k in part]) & (ny > -0.35)
    if not body.any():
        return None
    col = C[I].mean(1)[body]; w = area[body]
    return np.array([np.interp(0.5, np.cumsum(w[np.argsort(col[:, c])]) / w.sum(), np.sort(col[:, c])) for c in range(3)])


def model_tint(code: str, glb: Path) -> dict | None:
    """fauna.json's tint for a modelled slot: {tint: [r, g, b], target, measured, reason, source}, or None (no recorded
    target, or no model to measure)."""
    rec = (json.loads(TINTS.read_text()).get("species") or {}).get(code) if TINTS.exists() else None
    med = body_colour(glb) if rec else None
    if not rec or med is None:
        return None
    want = _hex_lin(rec["target"].lstrip("#"))
    tint = np.clip(want / np.maximum(med, 1e-4), *TINT_RANGE)
    return {"tint": [round(float(v), 3) for v in tint], "target": rec["target"], "measured": lab_to_hex(lab(med)),
            "reason": rec.get("reason"), "source": rec.get("source"), "rule": "pipeline/appearance.py model_tint"}
