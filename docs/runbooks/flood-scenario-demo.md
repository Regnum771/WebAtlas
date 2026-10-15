# Runbook — flood scenario demo

**Run this when:** the Kịch bản lũ dock says "Chưa có dữ liệu kịch bản", or after changing anything under `packages/atlas-data/tools/flood_scenario/`.

**What it builds.** A replay of the record flood of 26–31/10/2025 on Vu Gia – Thu Bồn, plus three rain presets scaled from it, for the box 107.95–108.40 °E, 15.70–15.98 °N:

- `scenario.*` tables in PostGIS (levels per station and hour, flooded km² per hour, roads cut, xã wet, dry gathering points, evacuation plan);
- 137 PNG frames per scenario (one per hour, 05:00 26/10 to 21:00 31/10/2025) in `packages/atlas-data/data/cache/flood/frames/<scenario>/`, git-ignored.

The schema and the frames are rebuilt whole on every run.

## Inputs

| Input | Where | Notes |
|---|---|---|
| Recorded levels, bulletin forecast | `packages/atlas-data/data/seeds/flood-2025-10-levels.csv` | Ái Nghĩa and Câu Lâu from KTTV's national flood bulletins (`dbqg_lulu_*`, 27–31/10/2025), at each bulletin's observation time; the `source` column names the PDF. Two `estimated` rows anchor 05:00 26/10 "below BĐ1" (Tiền Phong, 26/10/2025) |
| DEM | `basemap.dem_region` | FABDEM, see `elevation-dem.md`; load it first |
| OSM roads, buildings, waterways, POIs | `packages/atlas-data/data/cache/basemap/vietnam-261001-free.shp.zip` | the basemap cache |
| Xã/phường | `packages/atlas-data/data/seeds/wards-region.geojson` | |

## How to run it

```bash
docker compose -f infra/docker-compose.yml up -d db
docker compose -f infra/docker-compose.yml --profile tools build tools   # once, for scipy
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
    python3 packages/atlas-data/tools/flood_scenario/build_scenarios.py
```

About 15–25 minutes. Unit checks for the pure parts:

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/flood_scenario/test_levels.py
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/flood_scenario/test_depth.py
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/flood_scenario/test_exposure.py
```

## What the printed checks mean

- **Peak flooded area within 40–600 km²** (hard). Outside that range the water surface or the channel seeds are wrong. The October 2025 replay peaks at about 450 km² at 20:00 29/10, when Ái Nghĩa read 10.60 m.
- **137 frames, ≤ 25 MB per scenario** (hard). The dock preloads all of them.
- **Wet xã vs the bulletin's at-risk list** (printed, not hard): matched / missing / extra. Missing names outside the box (Tam Kỳ, Đông Giang…) are expected.

## What the flood is, and is not

Hour 0 (05:00 26/10) is the decision moment, before the rise; the rise to the first bulletin reading at 20:00 27/10 is a linear interpolation from the estimated anchors. Bridges and tunnels are left out of road exposure.

A planar ("bathtub") approximation: the water level is interpolated by distance from the sea through the four stations (sea 0.8 m at the coast, Hội An, Câu Lâu, then Giao Thủy and Ái Nghĩa, held upstream), FABDEM ground is subtracted, and only water connected to a river or canal is kept. It is not a hydraulic model; the dock and the assistant say "mô phỏng nhanh trên FABDEM".

Hội An and Giao Thủy levels are derived (Hội An = 2.0 + (Câu Lâu − 4.0) × 0.94; Giao Thủy = Ái Nghĩa − 0.5). BĐ1 values and Giao Thủy's alarm levels are from memory; BĐ2/BĐ3 at Ái Nghĩa, Câu Lâu and Hội An are confirmed by the bulletins.

## Serving

The API reads frames from `FLOOD_FRAMES_DIR`, defaulting to the repo cache path resolved from `apps/api` as the working directory. Set it when the API runs from elsewhere.
