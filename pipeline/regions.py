"""Which source covers which part of the Earth, and what a tile outside it falls back to.

Every network source a step reads is listed in COVERAGE with the region it serves, and with the global source that
stands in where it does not reach (`fallback`, implemented) or that would (`next`, not implemented yet: named so the
gap is visible). The region tests are boxes in longitude and latitude, so they are a first cut: the source's own
answer decides at run time (a STAC search with no items, an ImageServer answering nodata), and the step then takes
its fallback through runlog.fallback, which the manifest records.

docs/pipeline.md has the same table for people.
"""
from __future__ import annotations

# (west, south, east, north) boxes, degrees. Generous: a tile at a border is tried against the source first.
REGIONS = {
    "conus": [(-125.0, 24.3, -66.8, 49.5)],
    "alaska": [(-180.0, 51.0, -129.9, 71.6), (172.0, 51.0, 180.0, 53.5)],
    "hawaii": [(-160.6, 18.8, -154.7, 22.4)],
    "puerto_rico": [(-67.5, 17.8, -65.2, 18.6)],
    "nasadem": [(-180.0, -56.0, 180.0, 60.0)],      # SRTM's latitude span
    "global": [(-180.0, -90.0, 180.0, 90.0)],
}
US = ("conus", "alaska", "hawaii", "puerto_rico")

# source key -> what it covers, and what stands in elsewhere. licence: the stand-in's terms, so a fallback is only
# implemented where they are CC0, CC BY or CC BY-SA (or public domain).
COVERAGE = {
    "usgs_3dep": {"regions": US, "what": "bare-earth DEM, 1 m lidar where flown",
                  "fallback": "pc_3dep_seamless", "global": "nasadem",
                  "next": "copernicus_dem_glo30 (30 m; its own licence, not CC: credit required, redistribution allowed)"},
    "pc_3dep_seamless": {"regions": US, "what": "3DEP seamless 10 m DEM (Planetary Computer)", "global": "nasadem"},
    "nasadem": {"regions": ("nasadem",), "what": "NASADEM 1 arc-second (~30 m) DEM, 60 N to 56 S; public domain (NASA)",
                "implemented": True},
    "usgs_3dep_lidar": {"regions": US, "what": "3DEP lidar point clouds (Entwine) and 1 m DEM products, where flown",
                        "global": None,
                        "next": "no global open point cloud; outside 3DEP the lidar step builds nothing and the 5 m base DEM "
                                "carries the terrain (as on a DEM-only tile without the 1 m products)"},
    "usgs_naip": {"regions": ("conus",), "what": "NAIP 0.6-1 m orthoimagery", "fallback": "pc_naip",
                  "global": None, "next": "sentinel2_l2a true colour at 10 m (the seasons step's composites; Copernicus "
                                          "Sentinel data terms: free, credit 'contains modified Copernicus Sentinel data')"},
    "pc_naip": {"regions": ("conus",), "what": "NAIP COGs (Planetary Computer)"},
    "nhdplus_hr": {"regions": ("conus", "hawaii", "puerto_rico"), "what": "named streams, permanence, waterbodies",
                   "global": None,
                   "next": "channels.py already routes every stream by gravity on the DEM; outside NHD the names and the "
                           "perennial / intermittent flag would come from OSM waterways (ODbL, already a source), and "
                           "HydroRIVERS (CC BY 4.0 since 2022) for the large rivers' discharge"},
    "landfire": {"regions": ("conus", "alaska", "hawaii"), "what": "EVT / BpS communities, cover and height at 30 m",
                 "global": None,
                 "next": "ESA WorldCover 2021 10 m (CC BY 4.0) for the habitat classes and tree cover, with the community "
                         "named from the RESOLVE Ecoregions 2017 (CC BY 4.0); the species mix's rules would key on the "
                         "ecoregion and the WorldCover class instead of the EVT name"},
    "usda_sda": {"regions": US, "what": "SSURGO soils via Soil Data Access",
                 "global": None, "next": "SoilGrids 2.0 250 m (CC BY 4.0)"},
    "macrostrat": {"regions": ("global",), "what": "geologic map units (Macrostrat, CC BY 4.0)"},
    "osm": {"regions": ("global",), "what": "buildings, roads, dams, waterways (ODbL)"},
    "gbif": {"regions": ("global",), "what": "species occurrences (per-record CC0 / CC BY / CC BY-NC)"},
    "sentinel2_l2a": {"regions": ("global",), "what": "Sentinel-2 L2A monthly colour (Planetary Computer)"},
    "open_meteo": {"regions": ("global",), "what": "ERA5 hourly weather (CC BY 4.0)"},
    "native_land": {"regions": ("global",), "what": "Indigenous territories (Native Land Digital; key needed)"},
}


def _in(lon: float, lat: float, region: str) -> bool:
    return any(w <= lon <= e and s <= lat <= n for (w, s, e, n) in REGIONS[region])


def centre(tile) -> tuple[float, float]:
    w, s, e, n = tile.bounds_wgs84
    return (w + e) / 2, (s + n) / 2


def covers(source: str, tile) -> bool:
    """Whether `source` should cover the tile (a box test; see the module docstring)."""
    c = COVERAGE.get(source)
    if not c:
        return True
    lon, lat = centre(tile)
    return any(_in(lon, lat, r) for r in c["regions"])


def region_of(tile) -> list[str]:
    lon, lat = centre(tile)
    return [r for r in REGIONS if r != "global" and _in(lon, lat, r)] or ["outside the US"]


def plan(tile, sources: list[str]) -> dict:
    """Per source: covered, or the fallback that stands in, or the gap (`next`)."""
    out = {}
    for s in sources:
        c = COVERAGE.get(s, {})
        if covers(s, tile):
            out[s] = {"covered": True}
        else:
            g = c.get("global")
            out[s] = {"covered": False, "global": g if g and COVERAGE.get(g, {}).get("implemented") else None,
                      "next": c.get("next")}
    return out
