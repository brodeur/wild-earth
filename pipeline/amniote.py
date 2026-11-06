"""The amniote life-history database (Myhrvold et al. 2015): adult body mass and length for reptiles, for the trait cards.

EltonTraits covers the birds and mammals only; a reptile's card took the class's typical mass (a Nile crocodile at 0.5
kg). This database has an adult body mass for some 4,000 reptiles (squamates, turtles, crocodilians), and a snout-vent
length for more. Missing values are -999. A species absent takes its genus's median. Downloaded once into its own folder
and read as data, never executed.
"""
from __future__ import annotations

import csv
import io
import statistics

from .config import REPO_ROOT, SOURCES

DIR = REPO_ROOT / "pipeline" / "_cache" / "amniote"
URL = "https://esapubs.org/archive/ecol/E096/269/Data_Files/Amniote_Database_Aug_2015.csv"
SOURCES["amniote"] = {
    "name": "An amniote life-history database to perform comparative analyses with birds, mammals, and reptiles",
    "url": "https://esapubs.org/archive/ecol/E096/269/",
    "license": "CC0 1.0 (the data paper's metadata)",
    "license_url": "https://esapubs.org/archive/ecol/E096/269/metadata.php",
    "attribution": "Myhrvold, N. P. et al. (2015). An amniote life-history database to perform comparative analyses with "
                   "birds, mammals, and reptiles. Ecology 96: 3109",
    "attribution_url": "https://doi.org/10.1890/15-0846R.1",
    "attribution_required": False,
}
FIELDS = {"mass_g": "adult_body_mass_g", "svl_cm": "adult_svl_cm", "longevity_y": "maximum_longevity_y"}
_ROWS: dict | None = None


def rows() -> dict:
    global _ROWS
    if _ROWS is None:
        from .http import download
        DIR.mkdir(parents=True, exist_ok=True)
        dest = download(URL, None, DIR / URL.rsplit("/", 1)[1])
        out = {}
        for r in csv.DictReader(io.StringIO(dest.read_bytes().decode("latin-1"))):
            rec = {"class": r.get("class"), "order": r.get("order"), "family": r.get("family"), "genus": r.get("genus", "")}
            for k, col in FIELDS.items():
                try:
                    v = float(r.get(col) or "-999")
                except ValueError:
                    v = -999.0
                rec[k] = None if v <= -998 else v
            out[f"{r.get('genus', '')} {r.get('species', '')}".strip()] = rec
        _ROWS = out
    return _ROWS


def lookup(scientific: str) -> dict:
    """{mass_kg, mass_level ('species' | 'genus'), svl_m, order, family} for a binomial; {} when neither is known."""
    try:
        R = rows()
    except Exception as e:   # noqa: BLE001 (offline: the class default stays)
        return {"error": str(e)}
    b = " ".join(scientific.split()[:2])
    sp = R.get(b) or {}
    genus = b.split()[0] if b else ""
    out = {"order": sp.get("order"), "family": sp.get("family")}
    for k, scale, name in (("mass_g", 0.001, "mass_kg"), ("svl_cm", 0.01, "svl_m")):
        if sp.get(k) is not None:
            out[name], out[name.split("_")[0] + "_level"] = sp[k] * scale, "species"
            continue
        vals = [r[k] for r in R.values() if r["genus"] == genus and r[k] is not None]
        if vals:
            out[name], out[name.split("_")[0] + "_level"] = statistics.median(vals) * scale, "genus"
    if not out.get("order"):
        g = next((r for r in R.values() if r["genus"] == genus), None)
        if g:
            out["order"], out["family"] = g["order"], g["family"]
    return out
