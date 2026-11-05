# the before/after table (markdown) from scratch/reroute/{before,after}_<tile>.json
import json, sys
rows = []
for t in sys.argv[1:]:
    b = json.load(open(f"scratch/reroute/before_{t}.json")); a = json.load(open(f"scratch/reroute/after_{t}.json"))
    f = lambda r, k1, k2, pct=True: (f"{100 * r[k1][k2]:.1f}%" if pct else f"{r[k1][k2]}")
    rows.append(f"| {t} | {f(b,'bed_gap','within_5cm')} -> {f(a,'bed_gap','within_5cm')} | "
                f"{100*b['off_roads']['bed_within_5cm']:.1f}% -> {100*a['off_roads']['bed_within_5cm']:.1f}% | "
                f"{f(b,'clip','over_1m')} -> {f(a,'clip','over_1m')} | {f(b,'above_bank','over_10cm')} -> {f(a,'above_bank','over_10cm')} | "
                f"{b['rises']['into_receiving_reach_over_5cm']} -> {a['rises']['into_receiving_reach_over_5cm']} (max {b['rises']['into_max_m']} -> {a['rises']['into_max_m']} m) | "
                f"{a['shift_from_5m']['median_m']} / {a['shift_from_5m']['p90_m']} / {a['shift_from_5m']['max_m']} m | "
                f"{b['nhd_offset']['median_m']:.1f} -> {a['nhd_offset']['median_m']:.1f} m |")
print("| Tile | Bed within 5 cm of the cross-section's lowest ground | ... away from erased roads | Ground over the level by 1 m+ (clip) | Water over the bank by 10 cm+ | Level rising into the receiving reach | Shift from the 5 m line, median / p90 / max | Median distance to NHD |")
print("|---|---|---|---|---|---|---|---|")
print("\n".join(rows))
