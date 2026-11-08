"""AVONET: morphology, ecology and geography for all birds (Tobias et al. 2022), for a bird's way of life by trait.

Read for a bird's primary lifestyle (where it spends most of its time moving about and feeding: Aerial, Terrestrial,
Insessorial (perching), Aquatic or Generalist), its Hand-Wing Index (Kipp's distance over the wing length x 100: wing
shape, near 0 in the ratites, whose wings no longer fly), its habitat and habitat density, from the BirdLife-taxonomy
table (AVONET1_BirdLife.csv in the ELEData archive). A name not in it is tried through the BirdLife-BirdTree crosswalk
(the BirdTree name of an older split or lump), then by its genus (the lifestyle most of the genus has, the median Hand-
Wing Index). Downloaded once into its own folder and read as data out of the zip, never executed.
"""
from __future__ import annotations

import csv
import io
import statistics
import zipfile
from collections import Counter

from .config import REPO_ROOT, SOURCES

DIR = REPO_ROOT / "pipeline" / "_cache" / "avonet"
URL = "https://ndownloader.figshare.com/files/38429873"   # ELEData.zip, the figshare item's trait tables
TABLE = "ELEData/TraitData/AVONET1_BirdLife.csv"
CROSSWALK = "ELEData/PhylogeneticData/BirdLife-BirdTree crosswalk.csv"
SOURCES["avonet"] = {
    "name": "AVONET: morphological, ecological and geographical data for all birds (AVONET1_BirdLife)",
    "url": "https://doi.org/10.6084/m9.figshare.16586228",
    "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Tobias, J. A. et al. (2022). AVONET: morphological, ecological and geographical data for all birds. "
                   "Ecology Letters 25: 581-597",
    "attribution_url": "https://doi.org/10.1111/ele.13898",
    "attribution_required": True,
}
_ROWS: dict | None = None
_ALIAS: dict | None = None
_GENUS: dict | None = None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _load() -> None:
    global _ROWS, _ALIAS, _GENUS
    if _ROWS is not None:
        return
    from .http import download
    DIR.mkdir(parents=True, exist_ok=True)
    dest = download(URL, None, DIR / "ELEData.zip")
    rows, alias, by_genus = {}, {}, {}
    with zipfile.ZipFile(dest) as z:
        text = z.read(TABLE).decode("latin-1")
        for r in csv.DictReader(io.StringIO(text)):
            name = (r.get("Species1") or "").strip()
            if not name:
                continue
            rec = {"lifestyle": (r.get("Primary.Lifestyle") or "").strip() or None,
                   "hwi": _num(r.get("Hand-Wing.Index")), "habitat": (r.get("Habitat") or "").strip() or None,
                   "habitat_density": _num(r.get("Habitat.Density")), "family": r.get("Family1"), "order": r.get("Order1"),
                   "mass_g": _num(r.get("Mass")),
                   # 1 sedentary, 2 partially migratory, 3 migratory (the herds step's skeins: pipeline/herds.py)
                   "migration": _num(r.get("Migration"))}
            rows[name] = rec
            by_genus.setdefault(name.split()[0], []).append(rec)
        try:
            for r in csv.DictReader(io.StringIO(z.read(CROSSWALK).decode("latin-1"))):
                bl, bt = (r.get("Species1") or "").strip(), (r.get("Species3") or "").strip()
                if bl and bt and bt != bl and bl in rows:
                    alias.setdefault(bt, bl)
        except KeyError:
            pass
    genus = {}
    for g, recs in by_genus.items():
        life = Counter(x["lifestyle"] for x in recs if x["lifestyle"]).most_common(1)
        hw = [x["hwi"] for x in recs if x["hwi"] is not None]
        genus[g] = {"lifestyle": life[0][0] if life else None, "hwi": statistics.median(hw) if hw else None,
                    "habitat": None, "habitat_density": None, "family": recs[0]["family"], "order": recs[0]["order"],
                    "migration": statistics.median([x["migration"] for x in recs if x.get("migration") is not None] or [None]) if any(x.get("migration") is not None for x in recs) else None}
    _ROWS, _ALIAS, _GENUS = rows, alias, genus


def lookup(scientific: str) -> dict:
    """{lifestyle, hwi, habitat, habitat_density, family, order, mass_g, migration, level: 'species' | 'crosswalk' | 'genus'}
    or {}."""
    if not scientific:
        return {}
    _load()
    name = " ".join(scientific.split()[:2])
    if name in _ROWS:
        return {**_ROWS[name], "level": "species"}
    if name in _ALIAS:
        return {**_ROWS[_ALIAS[name]], "level": "crosswalk", "as": _ALIAS[name]}
    g = _GENUS.get(name.split()[0])
    return {**g, "level": "genus"} if g else {}
