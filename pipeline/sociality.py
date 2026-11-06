"""Mammal social organisation: the average group size and whether the society splits and merges (fission-fusion), from
Prox and Farine (2020)'s scoring of 180 mammal societies, for the size of the groups a tile's animals are seen in.

PanTHERIA has no social group size for many of the animals that live in groups (the lion among them); this scoring has
them. Its rows name a species, sometimes with the sex or unit scored ("Leo panthera, males", "Acynoncyx jubatus, male
coalitions"): a row is matched by its Genus column and the species epithet in its name, and a species takes the largest
average group size of its rows. Downloaded once into its own folder and read as data, never executed.
"""
from __future__ import annotations

import csv
import re

from .config import REPO_ROOT, SOURCES

DIR = REPO_ROOT / "pipeline" / "_cache" / "prox2020"
URL = "https://ndownloader.figshare.com/files/17397305"
SOURCES["prox2020_social"] = {
    "name": "Data for 'A framework for conceptualizing dimensions of social organization in mammals' (Scoring_Species.csv)",
    "url": "https://doi.org/10.6084/m9.figshare.8208959.v2",
    "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Prox, L. and Farine, D. (2020). A framework for conceptualizing dimensions of social organization in "
                   "mammals. Ecology and Evolution 10: 791-807",
    "attribution_url": "https://doi.org/10.1002/ece3.5936",
    "attribution_required": True,
}
_ROWS: dict | None = None


def rows() -> dict:
    """{(genus, epithet): {"group": average group size or None, "fission_fusion": bool, "term": society word}}"""
    global _ROWS
    if _ROWS is None:
        from .http import download
        DIR.mkdir(parents=True, exist_ok=True)
        dest = download(URL, None, DIR / "Scoring_Species.csv")
        text = dest.read_bytes().decode("latin-1").lstrip("﻿").lstrip("ï»¿")
        sep = ";" if text.count(";") > text.count(",") else ","
        out: dict = {}
        for r in csv.DictReader(text.splitlines(), delimiter=sep):
            r = {k.strip().lstrip("﻿").lstrip("ï»¿"): (v or "").strip() for k, v in r.items() if k}
            genus = r.get("Genus", "")
            words = [w.lower() for w in re.findall(r"[A-Za-z]+", r.get("Species", "").split(",")[0])]
            # the epithet: the word beside the genus ("Leo panthera"), else the second word (a misspelt genus: "Acynoncyx")
            epithet = next((w for w in words if w != genus.lower()), None) if genus.lower() in words else (words[1] if len(words) > 1 else None)
            if not genus or not epithet:
                continue
            try:
                g = float(r.get("Actual Average Group Size") or "nan")
            except ValueError:
                g = float("nan")
            raw = re.findall(r"[A-Za-z]+", r.get("Species", "").split(",")[0])
            keys = {(genus, epithet)}
            if len(raw) >= 2 and raw[0][:1].isupper() and raw[1].islower():   # the name's own binomial (Crocuta crocuta under Hyaena)
                keys.add((raw[0], raw[1]))
            for key in keys:
                e = out.setdefault(key, {"group": None, "fission_fusion": False, "term": ""})
                if g == g and g > 0:
                    e["group"] = max(e["group"] or 0, g)
                e["fission_fusion"] |= r.get("Fission-Fusion") == "1"
                e["term"] = e["term"] or r.get("descriptive term for society", "")
        _ROWS = out
    return _ROWS


def lookup(scientific: str) -> dict | None:
    parts = (scientific or "").split()
    return rows().get((parts[0], parts[1].lower())) if len(parts) >= 2 else None
