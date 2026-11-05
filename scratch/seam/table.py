import json, sys
for t in ["utm10n_429_5293", "utm10n_439_5293"]:
    b = json.load(open(f"scratch/seam/check_before_{t}.json")); a = json.load(open(f"scratch/seam/check_after_{t}.json"))
    f = lambda d: (d["samples"], d["length_km"], d["reaches"], d["bed_gap"]["within_5cm"], d["bed_gap"]["within_15cm"], d["clip"]["over_25cm"],
                   d["clip"]["over_1m"], d["above_bank"]["over_10cm"], d["rises"]["within_reach"], d["rises"]["into_receiving_reach_over_5cm"],
                   d["rises"]["into_max_m"], d.get("off_roads", {}).get("bed_within_5cm"))
    print(t); print("  keys: samples, km, reaches, bed<=5cm, bed<=15cm, clip>25cm, clip>1m, above_bank>10cm, rises_within, rises_into, into_max, offroad_bed5")
    print("  before", f(b)); print("  after ", f(a))
