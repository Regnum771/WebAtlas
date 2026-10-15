"""
Checks for levels.py: recorded readings to hourly series, derived stations, preset scaling.

No pytest (see basemap/test_load_basemap.py). Runs inside the atlas-tools image:

    python3 packages/atlas-data/tools/flood_scenario/test_levels.py
"""
import importlib.util
import pathlib
import sys
from datetime import datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve().parent
CSV = HERE.parents[1] / "data" / "seeds" / "flood-2025-10-levels.csv"
spec = importlib.util.spec_from_file_location("levels", HERE / "levels.py")
levels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(levels)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


T0 = datetime(2025, 10, 27, 21, tzinfo=timezone(timedelta(hours=7)))

s = levels.hourly_series([(T0, 4.81), (T0 + timedelta(hours=24), 5.11)], T0, 24)
check("interpolates linearly", abs(s[12] - 4.96) < 1e-9)
check("holds the last value", levels.hourly_series([(T0, 1.0)], T0, 3) == [1.0, 1.0, 1.0, 1.0])
check("holds the first value before it", levels.hourly_series([(T0 + timedelta(hours=2), 3.0)], T0, 2) == [3.0, 3.0, 3.0])
check("hoi an at BD3", abs(levels.derive_hoi_an(4.0) - 2.0) < 1e-9)
check("hoi an at 5.6", abs(levels.derive_hoi_an(5.6) - 3.504) < 1e-9)
check("giao thuy", abs(levels.derive_giao_thuy(10.0) - 9.5) < 1e-9)
check("1000 mm is the event", levels.scale_series([2.31, 5.62], 2.31, 1000) == [2.31, 5.62])
check("500 mm scales the rise", abs(levels.scale_series([5.62], 2.31, 500)[0] - (2.31 + 3.31 * 0.5 ** 0.6)) < 1e-9)

readings = levels.load_readings(str(CSV))
check("two recorded stations", sorted(readings) == ["ai-nghia", "cau-lau"])
START = datetime(2025, 10, 26, 5, tzinfo=timezone(timedelta(hours=7)))
check("starts 05:00 26/10, before the rise", levels.START == START and levels.HOURS == 136 and levels.BULLETIN_HOUR == 64)

lv = levels.scenario_levels("kttv-2025-10", readings)
check("four stations", sorted(lv) == ["ai-nghia", "cau-lau", "giao-thuy", "hoi-an"])
check("137 values per station", all(len(v) == 137 for v in lv.values()))
check("peak at Cau Lau is 5.62", abs(max(lv["cau-lau"]) - 5.62) < 1e-9)
check("peak at Ai Nghia is 10.60", abs(max(lv["ai-nghia"]) - 10.60) < 1e-9)
check("hoi an derived", abs(lv["hoi-an"][93] - levels.derive_hoi_an(5.62)) < 1e-9)
check("below BD1 at the start (estimated anchor)", lv["ai-nghia"][0] < 6.5 and lv["cau-lau"][0] < 2.0)
check("estimated anchor is loaded with the readings", readings["cau-lau"][0][0] == START)

big = levels.scenario_levels("preset-1300", readings)
small = levels.scenario_levels("preset-500", readings)
same = levels.scenario_levels("preset-1000", readings)
check("1300 above the event", max(big["cau-lau"]) > 5.62)
check("500 below the event", max(small["cau-lau"]) < 5.62)
check("1000 equals the event", same == lv)
check("presets derive from scaled values", abs(big["hoi-an"][93] - levels.derive_hoi_an(big["cau-lau"][93])) < 1e-9)
check("presets keep the pre-event level", abs(small["cau-lau"][0] - lv["cau-lau"][0]) < 1e-9)

fc = levels.load_forecast(str(CSV))
check("forecast has 4 points per station", all(len(v) == 4 for v in fc.values()))

check("scenario ids", [s["id"] for s in levels.SCENARIOS] == ["kttv-2025-10", "preset-500", "preset-1000", "preset-1300"])
check("station ids", [s["id"] for s in levels.STATIONS] == ["ai-nghia", "cau-lau", "hoi-an", "giao-thuy"])
check("bulletin at-risk list", "Điện Bàn" in levels.BULLETIN_AT_RISK and "Hội An Tây" in levels.BULLETIN_AT_RISK)

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
