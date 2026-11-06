"""PanTHERIA: the world's mammals' life history, ecology and geography (Jones et al. 2009), for behaviour from traits.

Read for a mammal's social group size, its measured population density, its home range and its activity cycle (1
nocturnal only, 2 both or crepuscular, 3 diurnal only). Missing values are -999 in the file; a species absent from it or
without a value takes its genus's median where the genus has one (MSW05 names: a newer split, as Equus quagga for
Equus burchellii, finds its genus). Downloaded once into its own folder and read as data, never executed.
"""
from __future__ import annotations

import csv
import io
import statistics

from .config import REPO_ROOT, SOURCES

DIR = REPO_ROOT / "pipeline" / "_cache" / "pantheria"
URL = "https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt"
SOURCES["pantheria"] = {
    "name": "PanTHERIA: a species-level database of life history, ecology, and geography of extant and recently extinct mammals",
    "url": "https://esapubs.org/archive/ecol/E090/184/",
    "license": "no copyright or proprietary restrictions (the data paper's metadata: 'Copyright restrictions: None')",
    "license_url": "https://esapubs.org/archive/ecol/E090/184/metadata.htm",
    "attribution": "Jones, K. E. et al. (2009). PanTHERIA: a species-level database of life history, ecology, and geography "
                   "of extant and recently extinct mammals. Ecology 90: 2648",
    "attribution_url": "https://doi.org/10.1890/08-1494.1",
    "attribution_required": True,
}
FIELDS = {"activity": "1-1_ActivityCycle", "group": "10-2_SocialGrpSize", "population_group": "10-1_PopulationGrpSize",
          "density_km2": "21-1_PopulationDensity_n/km2", "home_range_km2": "22-1_HomeRange_km2", "mass_g": "5-1_AdultBodyMass_g"}
_ROWS: dict | None = None


def rows() -> dict:
    global _ROWS
    if _ROWS is None:
        from .http import download
        DIR.mkdir(parents=True, exist_ok=True)
        dest = download(URL, None, DIR / URL.rsplit("/", 1)[1])
        out = {}
        for r in csv.DictReader(io.StringIO(dest.read_bytes().decode("latin-1")), delimiter="\t"):
            rec = {}
            for k, col in FIELDS.items():
                try:
                    v = float(r.get(col) or "-999")
                except ValueError:
                    v = -999.0
                rec[k] = None if v <= -998 else v
            rec["genus"] = r.get("MSW05_Genus", "")
            out[(r.get("MSW05_Binomial") or "").strip()] = rec
        _ROWS = out
    return _ROWS


def lookup(scientific: str) -> dict:
    """{field: value or None, field + '_level': 'species' | 'genus'} for a binomial."""
    R = rows()
    sp = R.get(" ".join(scientific.split()[:2])) or {}
    genus = scientific.split()[0] if scientific else ""
    out = {}
    for k in FIELDS:
        v = sp.get(k)
        if v is not None:
            out[k], out[k + "_level"] = v, "species"
            continue
        vals = [r[k] for r in R.values() if r["genus"] == genus and r[k] is not None]
        if vals:
            out[k], out[k + "_level"] = statistics.median(vals), "genus"
        else:
            out[k] = None
    return out
