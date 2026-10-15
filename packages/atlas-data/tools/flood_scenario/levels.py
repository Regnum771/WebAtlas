"""
River levels for the flood scenario demo.

The October 2025 flood on Vu Gia - Thu Bon is the basis of every scenario: KTTV's recorded
readings at Ai Nghia and Cau Lau (flood-2025-10-levels.csv, taken from the national flood
bulletins) become hourly series; Hoi An and Giao Thuy are derived from them; presets scale the
event's rise. See docs/superpowers/specs/2026-10-15-flood-scenario-demo-design.md.
"""
import csv
from datetime import datetime, timedelta, timezone

ICT = timezone(timedelta(hours=7))
# 05:00 26/10/2025: the decision moment. All four stations were below BD1 and KTTV forecast a peak
# of BD1-BD2; the real peak was BD3 + 1.6 m. Evacuation deadlines fall after this hour.
START = datetime(2025, 10, 26, 5, tzinfo=ICT)
HOURS = 136
BULLETIN_HOUR = 64  # 21:00 28/10/2025, the bulletin whose forecast table the chart shows

EVENT_MM = 1000.0
EXPONENT = 0.6

# BD1 values and everything at Giao Thuy are from memory (approximate); BD2/BD3 at Ai Nghia,
# Cau Lau and Hoi An are confirmed by the bulletins' "tren BD3 ..." figures.
STATIONS = [
    {"id": "ai-nghia", "name": "Ái Nghĩa", "river": "Vu Gia", "bd1": 6.5, "bd2": 8.0, "bd3": 9.0,
     "record_m": 10.77, "record_year": 2009, "derived": False, "lon": 108.118, "lat": 15.878},
    {"id": "cau-lau", "name": "Câu Lâu", "river": "Thu Bồn", "bd1": 2.0, "bd2": 3.0, "bd3": 4.0,
     "record_m": 5.62, "record_year": 2025, "derived": False, "lon": 108.287, "lat": 15.863},
    {"id": "hoi-an", "name": "Hội An", "river": "Thu Bồn", "bd1": 1.0, "bd2": 1.5, "bd3": 2.0,
     "record_m": 3.40, "record_year": 1964, "derived": True, "lon": 108.333, "lat": 15.876},
    {"id": "giao-thuy", "name": "Giao Thủy", "river": "Thu Bồn", "bd1": 6.0, "bd2": 7.5, "bd3": 8.5,
     "record_m": None, "record_year": None, "derived": True, "lon": 108.100, "lat": 15.836},
]

SCENARIOS = [
    {"id": "kttv-2025-10", "name": "Lũ 26–31/10/2025 — tái hiện từ số liệu thực đo KTTV", "kind": "kttv",
     "rain_total_mm": None, "basis": "Mực nước thực đo KTTV"},
    {"id": "preset-500", "name": "Mưa 500 mm (ước tính từ lũ 10/2025)", "kind": "preset",
     "rain_total_mm": 500, "basis": "Ước tính từ lũ 10/2025"},
    {"id": "preset-1000", "name": "Mưa 1.000 mm (≈ lũ 10/2025)", "kind": "preset",
     "rain_total_mm": 1000, "basis": "Ước tính từ lũ 10/2025"},
    {"id": "preset-1300", "name": "Mưa 1.300 mm (lớn hơn lũ 10/2025)", "kind": "preset",
     "rain_total_mm": 1300, "basis": "Ước tính từ lũ 10/2025"},
]

# Pre-event levels: the estimated readings at 05:00 26/10 ("below BD1"). Presets scale each
# station's rise above these, so every scenario starts from the same calm river.
BASES = {"ai-nghia": 6.3, "cau-lau": 1.9}

# Da Nang xa/phuong listed at flood risk in the 21:00 28/10/2025 bulletin.
BULLETIN_AT_RISK = [
    "Nam Phước", "Xuân Phú", "Duy Nghĩa", "Thăng An", "Điện Bàn", "Hội An Tây", "Hội An Đông",
    "An Thắng", "Điện Bàn Tây", "Điện Bàn Bắc", "Hòa Tiến", "Đại Lộc", "Vu Gia", "Thu Bồn",
    "Ngũ Hành Sơn", "Cẩm Lệ", "Hòa Cường", "Nông Sơn", "Quế Phước", "Đông Giang", "Chiên Đàn",
    "Quảng Phú", "Tam Xuân", "Hương Trà", "Tam Kỳ", "Bàn Thạch",
]


def _load(path, kind):
    out = {}
    with open(path, encoding="utf8") as f:
        for row in csv.DictReader(f):
            if row["kind"] != kind:
                continue
            out.setdefault(row["station_id"], []).append(
                (datetime.fromisoformat(row["time"]), float(row["level_m"])))
    for series in out.values():
        series.sort()
    return out


def load_readings(path):
    """Recorded readings plus the estimated pre-event anchors, which the series interpolates through."""
    out = _load(path, "recorded")
    for sid, pts in _load(path, "estimated").items():
        out[sid] = sorted(out.get(sid, []) + pts)
    return out


def load_forecast(path):
    return _load(path, "forecast")


def hourly_series(readings, start, hours):
    """Linear interpolation at start + 0..hours; outside the readings the end value holds."""
    pts = sorted(readings)
    out = []
    for h in range(hours + 1):
        t = start + timedelta(hours=h)
        if t <= pts[0][0]:
            out.append(pts[0][1])
            continue
        if t >= pts[-1][0]:
            out.append(pts[-1][1])
            continue
        for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
            if t0 <= t <= t1:
                f = (t - t0) / (t1 - t0)
                out.append(v0 + (v1 - v0) * f)
                break
    return out


def derive_hoi_an(cau_lau):
    return 2.0 + (cau_lau - 4.0) * 0.94


def derive_giao_thuy(ai_nghia):
    return ai_nghia - 0.5


def scale_series(series, base, rain_mm, event_mm=EVENT_MM, exponent=EXPONENT):
    k = (rain_mm / event_mm) ** exponent
    return [base + (v - base) * k for v in series]


def scenario_levels(scenario_id, readings):
    scenario = next(s for s in SCENARIOS if s["id"] == scenario_id)
    ai = hourly_series(readings["ai-nghia"], START, HOURS)
    cl = hourly_series(readings["cau-lau"], START, HOURS)
    rain = scenario["rain_total_mm"]
    if rain is not None and rain != EVENT_MM:
        ai = scale_series(ai, BASES["ai-nghia"], rain)
        cl = scale_series(cl, BASES["cau-lau"], rain)
    return {
        "ai-nghia": ai,
        "cau-lau": cl,
        "hoi-an": [derive_hoi_an(v) for v in cl],
        "giao-thuy": [derive_giao_thuy(v) for v in ai],
    }
