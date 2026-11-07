"""The ground's surface between the plants: the dry colour of the surface soil and how much of it lies under litter.

The client (terrain.js, the gap between a steppe's bunchgrass tufts) draws the ground near the camera as a mix of the
surface soil's dry colour and the litter's, by the litter's share of the exposed ground, then lights it as the ground.
This step finds both per soil map unit (the soils step's soils/classes.json and client/soils.png R), by rule:

  soil colour  SSURGO carries no horizon colours (Soil Data Access has no colour table), so the colour is read from the
               component's Official Series Description (USDA-NRCS OSD, public domain): its typical pedon's first mineral
               horizon (the O horizons skipped), the Munsell notation the description gives dry (the OSD says which
               state its colours are in: "Colors are for dry soil unless otherwise noted", the other state marked
               "moist" or "dry"). The component is the map unit's largest that is not a miscellaneous area (rock
               outcrop, rubble land), since tufts grow on the soil between the outcrops, and of those the largest whose NRCS
               ecological site is a rangeland site (where a map unit mixes a woodland soil, whose typical pedon is forest
               duff over a pale E horizon, with a steppe one: Taglake-Sebud at Teton).
               Without an OSD colour: the dominant component's soil order (Soil Taxonomy's mollic epipedon is dark: dry
               value 5 or less and chroma 3 or less; DEFAULT_BY_ORDER); on a SoilGrids tile (no series), the surface's
               organic carbon (SoilGrids soc, 0-5 cm): dry value 6.5 - 1.6 log2(1 + SOC %), hue 10YR, chroma 3 (soils
               darken with organic matter, Schulze et al. 1993, Soil Sci. Soc. Am. J. 57: 722-726; the line is a stated
               fit to their trend, not their equation).
  Munsell -> linear sRGB: value to luminance by ASTM D1535's polynomial, chroma to CIELAB chroma (3.8 + 0.4 x value per
               step: 4.7 per step at value 3, 5.8 at value 5, matching the renotation's yellow-reds to a few units),
               hue to the CIELAB hue angle by HUE_ANCHORS (the renotation's hue angles at value 5, rounded), then Lab (D65)
               to linear sRGB, read as the surface's reflectance. Good to a few dE: dry soil colours are judged by eye
               against a chip, the conversion is not the weak link.
  litter share the litter's share of the ground between the plants = litter / (litter + bare ground), the middles of the
               ranges the component's NRCS ecological site gives on its rangeland health reference sheet (EDIT, the
               Ecosystem Dynamics Interpretive Tool, USDA public domain: litterCover, and the bare ground narrative, both
               percent of the surface), so 5-40 % litter and 0-10 % bare give 22.5 / 27.5 = 0.82. Biological crust (in the
               same sheet's narrative, 1-2 % on Lamar's loamy sites) is recorded, not drawn. A component with no site
               sheet takes DEFAULT_LITTER (a stated default: the median of the MLRA 43B rangeland sheets read for Lamar
               and Teton, 0.8, rounded down for the drier steppes elsewhere: 0.7).

Writes client/soil_surface.json:
  {"mapunits": {index: {"dry": "10YR 5/2", "moist": "10YR 3/2", "rgb": [linear r, g, b] (the dry colour),
                         "colour_from": "osd HOBACKER" | "order Mollisols" | "soc 2.1 %", "litter_share": 0.82,
                         "litter_cover": [5, 40], "bare_ground": [0, 10], "crust": "...", "litter_from": "esd R043BY122WY"}},
   "default": {...}, "rules": {...}}
"""
from __future__ import annotations

import html
import json
import math
import re

from . import runlog
from .config import REPO_ROOT, SOURCES, US_PUBLIC_DOMAIN, Tile, read_json, write_json
from .http import get

# the sources, registered here (config.all_sources imports this module)
SOURCES["usda_osd"] = {"name": "USDA NRCS Official Soil Series Descriptions", "url": "https://soilseries.sc.egov.usda.gov/",
                       "license": "public domain", "license_url": US_PUBLIC_DOMAIN,
                       "attribution": "Soil Survey Staff, Natural Resources Conservation Service, U.S. Department of Agriculture. "
                                      "Official Soil Series Descriptions",
                       "attribution_url": "https://www.nrcs.usda.gov/resources/data-and-reports/official-soil-series-descriptions-osd",
                       "attribution_required": False}
SOURCES["usda_edit"] = {"name": "USDA NRCS Ecological Site Descriptions via the Ecosystem Dynamics Interpretive Tool (EDIT)",
                        "url": "https://edit.sc.egov.usda.gov/", "license": "public domain", "license_url": US_PUBLIC_DOMAIN,
                        "attribution": "Ecological site descriptions: USDA Natural Resources Conservation Service, Ecosystem "
                                       "Dynamics Interpretive Tool (EDIT)",
                        "attribution_url": "https://edit.jornada.nmsu.edu/", "attribution_required": False}
VERSION = "1"
CACHE = REPO_ROOT / "pipeline" / "_cache"
OSD_URL = "https://soilseries.sc.egov.usda.gov/OSD_Docs/{first}/{name}.html"
ESD_URL = "https://edit.sc.egov.usda.gov/services/descriptions/esd/{mlra}/{eco}.json"
MISC = ("rock outcrop", "rubble land", "rock land", "water", "pits", "dumps", "badland", "talus")

# Munsell hue (0..100 round the circle: R 0-10, YR 10-20, Y 20-30, GY 30-40, G 40-50, BG 50-60, B 60-70, PB 70-80,
# P 80-90, RP 90-100; '10YR' is 20) -> CIELAB hue angle (degrees), the renotation's at value 5, rounded
HUE_ANCHORS = [(0, 10), (5, 25), (10, 38), (15, 55), (20, 73), (25, 88), (30, 98), (35, 112), (40, 130), (45, 155),
               (55, 190), (65, 230), (75, 275), (85, 315), (95, 350), (100, 370)]
HUE_FAMILIES = {"R": 0, "YR": 10, "Y": 20, "GY": 30, "G": 40, "BG": 50, "B": 60, "PB": 70, "P": 80, "RP": 90}
# A soil order's typical dry surface colour where no description gives one (Soil Taxonomy's epipedons): a mollic
# epipedon dark (dry value <= 5, chroma <= 3), an ochric one paler, an aridic surface pale.
DEFAULT_BY_ORDER = {"Mollisols": "10YR 4/2", "Histosols": "10YR 3/2", "Andisols": "10YR 4/3", "Aridisols": "10YR 6/3",
                    "Entisols": "10YR 6/3", "Inceptisols": "10YR 5/3", "Alfisols": "10YR 5/3", "Ultisols": "7.5YR 5/4",
                    "Oxisols": "5YR 4/6", "Vertisols": "10YR 4/1", "Spodosols": "10YR 5/2", "Gelisols": "10YR 4/2"}
DEFAULT_COLOUR = "10YR 5/3"
DEFAULT_LITTER = 0.7
# Biological soil crust and moss, dry (a stated chip: dark grey-green, as lichen and moss crusts read dry; no sheet gives a
# colour). Drawn at the sheet's crust cover.
CRUST_COLOUR = "5GY 3/1"


def munsell_parse(s: str):
    """'10YR 5/2' -> (hue 0..100, value, chroma); 'N 4/' -> (0, 4, 0)."""
    m = re.match(r"\s*(?:(\d+(?:\.\d+)?)\s*(R|YR|Y|GY|G|BG|B|PB|P|RP)|(N))\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)?", s)
    if not m:
        return None
    if m.group(3):
        return 0.0, float(m.group(4)), 0.0
    return (float(m.group(1)) + HUE_FAMILIES[m.group(2)]) % 100 or (100.0 if m.group(2) == "RP" else 0.0), float(m.group(4)), float(m.group(5) or 0)


def munsell_to_linear(s: str) -> list[float] | None:
    """A Munsell notation -> linear sRGB (D65), the reflectance a surface of that chip has (see the module docstring)."""
    p = munsell_parse(s)
    if not p:
        return None
    h, V, C = p
    Y = (1.1914 * V - 0.22533 * V ** 2 + 0.23352 * V ** 3 - 0.020484 * V ** 4 + 0.00081939 * V ** 5) / 100   # ASTM D1535
    L = 116 * Y ** (1 / 3) - 16 if Y > 0.008856 else 903.3 * Y
    for (h0, a0), (h1, a1) in zip(HUE_ANCHORS, HUE_ANCHORS[1:]):
        if h0 <= h <= h1:
            ang = a0 + (a1 - a0) * (h - h0) / (h1 - h0)
            break
    Cab = C * (3.8 + 0.4 * V)
    a, b = Cab * math.cos(math.radians(ang)), Cab * math.sin(math.radians(ang))
    fy = (L + 16) / 116
    f = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    X, Yy, Z = 0.95047 * f(fy + a / 500), f(fy), 1.08883 * f(fy - b / 200)
    r = 3.2406 * X - 1.5372 * Yy - 0.4986 * Z
    g = -0.9689 * X + 1.8758 * Yy + 0.0415 * Z
    bl = 0.0557 * X - 0.2040 * Yy + 1.0570 * Z
    return [round(min(max(v, 0.0), 1.0), 4) for v in (r, g, bl)]


def _text(raw: str) -> str:
    t = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(t))


def osd_surface(name: str, force=False) -> dict | None:
    """The first mineral horizon's dry and moist Munsell colours from a series' OSD, or None (no OSD, no colour)."""
    key = re.sub(r"[^A-Z0-9_]", "", name.strip().upper().replace(" ", "_"))
    if not key:
        return None
    cache = CACHE / "osd" / f"{key}.html"
    if cache.exists() and not force:
        raw = cache.read_text(errors="replace")
        runlog.fetched("usda_osd", str(cache), cached=True)
    else:
        try:
            r = get(OSD_URL.format(first=key[0], name=key), timeout=60, retries=2)
            raw = r.text
        except Exception:  # noqa: BLE001  (a 404: no such series)
            raw = ""
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(raw)
        runlog.fetched("usda_osd", str(cache), cached=False)
    t = _text(raw)
    i = t.find("TYPICAL PEDON")
    if i < 0:
        return None
    t = t[i:]
    j = t.find("TYPE LOCATION")
    t = t[:j] if j > 0 else t[:6000]
    dry_default = not re.search(r"colors? (?:are|is) for moist", t[:400], re.I)
    # horizons: "A --0 to 9 inches;" / "Bt1--5 to 12 cm;"
    hz = [(m.start(), m.group(1)) for m in re.finditer(r"(?<![A-Za-z0-9])(\d?[A-Z][A-Za-z0-9'/]*)\s*-{1,2}\s*[\dO]+(?:\.\d+)?\s*to\s*\d", t)]   # 'O' for a 0 typed as a letter (Shook)
    for k, (pos, hname) in enumerate(hz):
        if hname.lstrip("0123456789").startswith("O"):
            continue
        seg = t[pos:hz[k + 1][0] if k + 1 < len(hz) else pos + 800]
        out = {"horizon": hname}
        for m in re.finditer(r"\(((?:\d+(?:\.\d+)?\s*(?:R|YR|Y|GY|G|BG|B|PB|P|RP))|N)\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)?\)\s*([a-z]+)?", seg):
            note = f"{m.group(1).replace(' ', '')} {m.group(2)}/{m.group(3) or ''}".strip()
            state = m.group(4) if m.group(4) in ("moist", "dry") else ("dry" if dry_default else "moist")
            out.setdefault(state, note)
        if "dry" in out or "moist" in out:
            return out
        return None
    return None


def esd_ground(eco: str, force=False) -> dict | None:
    """The litter cover and bare ground ranges (percent) from an ecological site's reference sheet (EDIT), or None."""
    m = re.match(r"[RF](\d{3}[A-Z])", eco)
    if not m:
        return None
    cache = CACHE / "esd" / f"{eco}.json"
    if cache.exists() and not force:
        txt = cache.read_text()
        runlog.fetched("usda_edit", str(cache), cached=True)
    else:
        try:
            txt = get(ESD_URL.format(mlra=m.group(1), eco=eco), timeout=90, retries=2).text
        except Exception:  # noqa: BLE001
            txt = ""
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(txt)
        runlog.fetched("usda_edit", str(cache), cached=False)
    try:
        d = json.loads(txt)
    except ValueError:
        return None
    rs = d.get("referenceSheet") or {}
    rng = lambda s: [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s or "")[:2]]
    lit = rng(rs.get("litterCover"))
    narr = rs.get("narratives") or {}
    if not lit:   # an older sheet gives it in its litter notes: "Litter ranges from 5-40% of total canopy measurement"
        m2 = re.search(r"litter (?:cover )?(?:ranges|range|is|of)?\s*(?:from )?(\d+)\s*-\s*(\d+)\s*%", narr.get("litterNotes") or "", re.I)
        lit = [float(m2.group(1)), float(m2.group(2))] if m2 else []
    bare = rng(re.sub(r"\(.*?\)", "", narr.get("bareGround") or ""))
    if len(lit) == 1:
        lit = lit * 2
    if len(bare) == 1:
        bare = [0.0, bare[0]] if "less than" in (narr.get("bareGround") or "").lower() else bare * 2
    if len(lit) != 2 or len(bare) != 2:
        return None
    crust, crust_cover = None, [0.0, 0.0]
    narrs = {**((d.get("ecologicalDynamics") or {}).get("narratives") or {}), **((d.get("interpretations") or {}).get("narratives") or {}), **narr}
    for k, v in sorted(narrs.items(), key=lambda kv: "cover" not in (kv[1] or "")):   # the hydrology narrative gives the crust's cover
        c = re.search(r"[^.]*crusts?[^.]*cover \d[^.]*\.", v or "", re.I) or re.search(r"[^.]*crust[^.]*\.", v or "", re.I)
        if c:
            crust = c.group(0).strip()[:200]
            cc = re.search(r"cover (\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%", crust)
            if cc:
                crust_cover = [float(cc.group(1)), float(cc.group(2))]
            break
    # the plant canopy the sheet expects ("Evenly distributed plant canopy (60-95%)", "Dense plant canopy (>95%)")
    canopy = None
    pc = re.search(r"plant canopy \((>?)\s*(\d+)(?:\s*-\s*(\d+))?\s*%\)", narr.get("plantEffects") or "", re.I)
    if pc:
        canopy = [float(pc.group(2)), 100.0] if pc.group(1) else [float(pc.group(2)), float(pc.group(3) or pc.group(2))]
    return {"litter_cover": lit, "bare_ground": bare, "crust": crust, "crust_cover": crust_cover, "canopy": canopy}


def composition(g: dict) -> dict | None:
    """The ground's surface by a site sheet: plant canopy, litter, bare ground, biological crust, the middles of its ranges,
    as shares of one (their sum is about 1 on these sheets: 77.5 + 22.5 + 5 + 1.5 = 106.5 % on Loamy High Mountains)."""
    if not g or not g.get("canopy"):
        return None
    mid = lambda r: (r[0] + r[1]) / 2
    v = {"plant": mid(g["canopy"]), "litter": mid(g["litter_cover"]), "bare": mid(g["bare_ground"]), "crust": mid(g["crust_cover"])}
    t = sum(v.values())
    return {k: round(x / t, 4) for k, x in v.items()} if t > 0 else None


def build_soil_surface(tile: Tile, force=False) -> dict:
    classes = read_json(tile.path("soils/classes.json"))
    mus = classes.get("mapunits", {})
    soilgrids = classes.get("source") == "soilgrids"
    comps_by_mu, eco_by_co = {}, {}
    if not soilgrids:
        from .fetch_soils import _sql
        comps = read_json(tile.path("_cache/sda/component.json"))
        for c in comps:
            comps_by_mu.setdefault(c["mukey"], []).append(c)
        keys = ",".join(f"'{c['cokey']}'" for c in comps)
        for r in _sql(tile, "coecoclass", f"SELECT cokey, ecoclassid, ecoclassname, ecoclasstypename FROM coecoclass WHERE cokey IN ({keys})", force):
            eco_by_co.setdefault(r["cokey"], []).append(r)
    out, osd_seen, esd_seen = {}, {}, {}
    for idx, mu in mus.items():
        e = {}
        if soilgrids:
            soc = mu.get("soc_g_kg")
            if mu.get("texture_class") in ("water", "rock outcrop") or soc is None:
                e["dry"], e["colour_from"] = DEFAULT_COLOUR, "default"
            else:
                v = min(max(6.5 - 1.6 * math.log2(1 + soc / 10), 2.5), 7.0)
                e["dry"], e["colour_from"] = f"10YR {v:.1f}/3", f"soc {soc / 10:.1f} %"
        else:
            cs = sorted(comps_by_mu.get(mu.get("mukey"), []), key=lambda c: -float(c.get("comppct_r") or 0))
            soil = [c for c in cs if (c.get("compkind") or "") != "Miscellaneous area" and not any(w in (c.get("compname") or "").lower() for w in MISC)]
            # the component the tufts grow on: the largest with an NRCS rangeland site (a woodland soil's pedon begins with
            # forest duff over a pale E horizon: Taglake at Teton, 10YR 7/2), else the largest soil component
            range_ = [c for c in soil if any((r.get("ecoclasstypename") or "") == "NRCS Rangeland Site" for r in eco_by_co.get(c["cokey"], []))]
            co = range_[0] if range_ else soil[0] if soil else (cs[0] if cs else None)
            if co:
                name = co["compname"]
                if name not in osd_seen:
                    osd_seen[name] = osd_surface(name, force)
                s = osd_seen[name]
                if s:
                    e.update({k: s[k] for k in ("dry", "moist") if k in s})
                    e["colour_from"] = f"osd {name.upper()} {s['horizon']}"
                    if "dry" not in s:   # a moist colour only: dry soil is about 2 values lighter (stated)
                        h, V, C = munsell_parse(s["moist"])
                        e["dry"] = re.sub(r"\s*[\d.]+/", f" {min(V + 2, 8):g}/", s["moist"], count=1)
                        e["colour_from"] += " (dry = moist + 2 values)"
                else:
                    e["dry"] = DEFAULT_BY_ORDER.get(co.get("taxorder") or "", DEFAULT_COLOUR)
                    e["colour_from"] = f"order {co.get('taxorder')}" if co.get("taxorder") else "default"
                # the litter share: over the map unit's soil components with a site sheet, by their share of it
                acc, wsum, used, comp, cw = 0.0, 0.0, [], {}, 0.0
                for c in soil:
                    for r in eco_by_co.get(c["cokey"], []):
                        if not (r.get("ecoclasstypename") or "").startswith("NRCS"):
                            continue
                        eco = r["ecoclassid"]
                        if eco not in esd_seen:
                            esd_seen[eco] = esd_ground(eco, force)
                        g = esd_seen[eco]
                        if not g:
                            continue
                        lm, bm = sum(g["litter_cover"]) / 2, sum(g["bare_ground"]) / 2
                        if lm + bm <= 0:
                            continue
                        w = float(c.get("comppct_r") or 0) or 1.0
                        acc += w * lm / (lm + bm); wsum += w
                        cp = composition(g)
                        if cp:
                            for k2, x in cp.items():
                                comp[k2] = comp.get(k2, 0.0) + w * x
                            cw += w
                        used.append(f"{eco} {c['compname']} {w:g} %: litter {g['litter_cover'][0]:g}-{g['litter_cover'][1]:g}, bare {g['bare_ground'][0]:g}-{g['bare_ground'][1]:g}")
                        if g.get("crust") and "crust" not in e:
                            e["crust"] = g["crust"]
                        break
                if wsum:
                    e["litter_share"] = round(acc / wsum, 3)
                    e["litter_from"] = "esd " + "; ".join(used)
                if cw:
                    e["ground"] = {k2: round(x / cw, 4) for k2, x in comp.items()}
            else:
                e["dry"], e["colour_from"] = DEFAULT_COLOUR, "default"
        e["rgb"] = munsell_to_linear(e["dry"])
        out[idx] = e
    # map units without a sheet carry the tile's sheet-weighted mean (by the units' area), not a constant
    have = [(float(mus[i].get("fraction") or 0), e) for i, e in out.items() if "ground" in e]
    fw = sum(f for f, _ in have)
    tile_ground = {k: round(sum(f * e["ground"][k] for f, e in have) / fw, 4) for k in ("plant", "litter", "bare", "crust")} if fw else \
        {"plant": 0.7, "litter": 0.2, "bare": 0.08, "crust": 0.02}
    lw = [(float(mus[i].get("fraction") or 0), e["litter_share"]) for i, e in out.items() if "litter_share" in e]
    tile_litter = round(sum(f * x for f, x in lw) / sum(f for f, _ in lw), 3) if lw and sum(f for f, _ in lw) else DEFAULT_LITTER
    for e in out.values():
        if "ground" not in e:
            e["ground"], e["ground_from"] = dict(tile_ground), "the tile's sheet-weighted mean"
        if "litter_share" not in e:
            e["litter_share"], e["litter_from"] = tile_litter, "the tile's sheet-weighted mean"
    write_json(tile.path("client/soil_surface.json"), {
        "encoding": "mapunits keyed by client/soils.png R (soils/classes.json); rgb: the dry surface soil's linear sRGB "
                    "reflectance; litter_share: litter / (litter + bare ground) between the plants",
        "default": {"dry": DEFAULT_COLOUR, "rgb": munsell_to_linear(DEFAULT_COLOUR), "litter_share": tile_litter, "ground": tile_ground},
        "crust": {"dry": CRUST_COLOUR, "rgb": munsell_to_linear(CRUST_COLOUR)},
        "version": VERSION,
        "rules": {"colour": "the first mineral horizon of the largest non-miscellaneous component's Official Series "
                            "Description (dry), else its soil order's typical surface (DEFAULT_BY_ORDER), else SoilGrids "
                            "organic carbon (dry value 6.5 - 1.6 log2(1 + SOC %), 10YR, chroma 3)",
                  "munsell": "ASTM D1535 value, chroma x (3.8 + 0.4 value) in CIELAB, hue by the renotation's angles at "
                             "value 5; Lab D65 to linear sRGB",
                  "litter_share": "litter / (litter + bare ground), the middles of the component's NRCS ecological site "
                                  "reference sheet ranges (EDIT); else the tile's sheet-weighted mean",
                  "ground": "the surface by the sheets (plant canopy, litter, bare ground, crust: range middles, as shares "
                            "of their sum), weighted by component share; units without a sheet the tile's area-weighted mean",
                  "crust": "biological crust and moss, dry: a stated dark grey-green chip (CRUST_COLOUR)"},
        "mapunits": out})
    n_osd = sum(1 for e in out.values() if e["colour_from"].startswith("osd"))
    n_esd = sum(1 for e in out.values() if e.get("litter_from", "").startswith("esd"))
    return {"client.soil_surface": {"path": "client/soil_surface.json", "kind": "table", "derived_from": "soils.classes",
                                    "source": "usda_osd" if n_osd else None,
                                    "sources_used": [s for s, n in (("usda_osd", n_osd), ("usda_edit", n_esd)) if n],
                                    "mapunits": len(out), "colour_from_osd": n_osd, "litter_from_esd": n_esd}}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", required=True)
    a = ap.parse_args()
    t = Tile.from_id(a.tile)
    print(json.dumps(build_soil_surface(t), indent=1))
