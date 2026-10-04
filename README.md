# WebATLAS — Water Resources WebGIS

An interactive WebGIS for Vietnam water resources (rivers, dams/reservoirs, monitoring
stations, and hazard layers such as flood, drought, saltwater intrusion, and
flood-generation zones). Built with React 19 + OpenLayers, evolving from a static viewer
into a role-based platform with a spatial database, a backend API, and an editable admin map.

## Architecture

Four cooperating services (see the design spec for detail):

- **PostgreSQL + PostGIS** — single source of truth for thematic feature data (`app` + `water` schemas).
- **GeoServer** — publishes the water/hazard layers read-only as WFS (GeoJSON).
- **Node/TS API** (Fastify) — the only writer: admin auth (JWT), user management, validation, and feature CRUD → PostGIS.
- **React + OpenLayers frontend** — public viewer (no login) + administrator login/editing.

Roles: **public viewer** (read-only, no login), **viewer/editor** (authenticated, read-only),
and **administrator** (the only role that writes).
Authorization is enforced by the API (every admin route requires an admin JWT); the frontend
authenticates its calls and gates admin UI, but the backend is the real security boundary.

## Monorepo layout

```
webatlas/
  apps/
    web/            # React 19 + Vite + OpenLayers frontend (Feature-Sliced Design)
    api/            # Fastify + TypeScript API (auth, users, layer feature CRUD, migrations, seeds)
  packages/
    shared/         # @webatlas/shared — cross-cutting TS types (layer keys, geometry + attribute maps)
    versioning/     # @webatlas/versioning — dataset versions, activation, river hierarchy, feature loading (used by api and atlas-data)
    atlas-data/     # @webatlas/atlas-data — dataset registry + build pipeline (atlas:up / atlas:build / atlas:status / atlas:verify)
  infra/
    docker-compose.yml   # PostGIS + GeoServer, plus the atlas-tools image the pipeline runs its scripts in
    postgis/init.sql     # extensions (postgis, citext) + app/water schemas
    .env.example         # copy to .env (git-ignored) before running the stack
  docs/runbooks/    # data setup order + per-dataset runbooks (start at README.md)
  docs/superpowers/
    specs/          # design specs
    plans/          # phased implementation plans
```

Uses **npm workspaces**. Requires **Node 22** (`>=22 <23`; `atlas:up` rejects any other major) and **npm ≥ 10**.

## Getting started

**Prerequisites:** Node 22, npm 10, Docker (Desktop on Windows/macOS) with Compose v2, and git.
Nothing else: the Python geo stack, GDAL and `raster2pgsql` run inside the `atlas-tools` image.
Allow at least 6 GB free on the drive holding the repository.

```bash
npm install
npm run atlas:up
```

`atlas:up` checks the machine, creates `infra/.env` and `apps/api/.env` from their examples when
missing (local development defaults), starts PostGIS and GeoServer, builds the tools image, applies
migrations, builds every dataset and verifies the result. The first run downloads about 1.2 GB
(the OpenStreetMap Vietnam extract and FABDEM elevation tiles) and took **about 19 minutes** from a
fresh clone on the reference machine, on a line that downloaded at about 55 Mbit/s. That was measured as
one run plus resumed runs (2026-09-30), with the tools image's system packages already cached by Docker;
a machine that has never built that image adds a few minutes. The basemap load alone takes about
5 minutes and needs about 1 GB of memory in Docker. Re-running resumes: finished work is skipped. To skip the elevation
data: `npm run atlas:up -- --except dem` (contours depend on it and are skipped too).

Then create an administrator (there is no default login) and start the app:

```bash
npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"
npm run dev -w @webatlas/api    # API at http://localhost:3001
npm run dev:web                 # web app at http://localhost:5173
```

Where things run (default ports; `POSTGRES_PORT` and `GEOSERVER_PORT` in `infra/.env` change the first two, and
`apps/api/.env` must then point at them): PostgreSQL + PostGIS at `localhost:5432`, GeoServer at
`http://localhost:8080/geoserver/` (WFS: `/geoserver/ows?service=WFS&request=GetCapabilities`), the API at
`http://localhost:3001` (`GET /health` returns `{"status":"ok"}`), the web app at `http://localhost:5173`. Use at least
8 characters for the administrator password: `create-admin` does not check it, but the API enforces that for the users
it creates.

### Day-to-day

| Command | Does |
|---|---|
| `npm run atlas:status` | What is built, stale, missing or failed — and the one command to run next |
| `npm run atlas:build -- --only <id>` | Build one dataset and its dependencies |
| `npm run atlas:build -- --force <id>` | Rebuild a dataset on purpose, from the same inputs. Forcing invalidates its dependents, which rebuild only if they are in the selection: `--force basemap` alone also rebuilds `reference_entities`, while `--only basemap --force basemap` leaves it `missing` until a full build |
| Newer OpenStreetMap extract | The basemap extract is pinned to a first-of-month Geofabrik file: bump its date and `sha256` in `packages/atlas-data/src/descriptors/basemap.ts`, then `npm run atlas:build` (see `docs/runbooks/self-hosted-basemap.md`) |
| `npm run atlas:verify` | Check the atlas actually serves: stages, probes, layers, lineage |
| `npm run atlas:adopt` | A machine set up before the registry: record what is already built, without re-running it |

Datasets: `seeds`, `rivers`, `basemap`, `reference_entities`, `dem`, `contours` (plus the synthetic `demo`).
The runbooks under `docs/runbooks/` describe what each dataset is and where it comes from.

`atlas:up` never recreates or stops a service that is already running, so it is safe to run on a
machine with a stack up. `npm run atlas:up -- --compose <file>` points it at another compose file, and it
accepts the build flags `--only`, `--except` and `--force`. To run one script by hand inside the tools image:
`docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools <argv>`.
Scripts read the GeoServer password from the environment (`infra/.env`, through the compose service), never from argv.

To stop the stack: `docker compose -f infra/docker-compose.yml --env-file infra/.env down`
(add `-v` only if you want to delete the database).

> `infra/.env` holds secrets and is git-ignored. Never commit it; only `infra/.env.example` is tracked.
> The web app's public viewer works with just the frontend and GeoServer; to **log in as an admin** the API
> must also be running. The API's CORS is locked to the web origin (`http://localhost:5173` by default; set
> `CORS_ORIGIN` in `apps/api/.env` if you change the Vite port). `npm run build:web` type-checks and builds the
> frontend; `npm run lint:web` runs oxlint.

## API surface

```
POST   /api/auth/login                 → { token, user }
GET    /api/auth/me                     → current user                       [auth]
GET    /api/users                       → list users                         [admin]
POST   /api/users                       → create user                        [admin]
PUT    /api/users/:id                   → update user                        [admin]
DELETE /api/users/:id                   → delete user                        [admin]
GET    /api/layers                      → editable-layer catalog (metadata)
GET    /api/layers/:key/features        → GeoJSON FeatureCollection           [admin]
POST   /api/layers/:key/features        → create feature                     [admin]
PUT    /api/layers/:key/features/:id    → update feature                     [admin]
DELETE /api/layers/:key/features/:id    → delete feature                     [admin]
GET    /api/features/:layerKey/:id/geometry → simplified GeoJSON geometry (public)
POST   /api/analysis/:op                → buffer | select_within | nearest | elevation_profile | zonal_elevation (public, 60/min)
GET    /api/admin-units?level=province|ward&province= → administrative units with extents (public)
GET    /api/layers/:key/features?province=&ward=      → features of the ACTIVE version, filtered   [auth]
GET    /api/elevation?lon=&lat=         → DEM height at a point (public, 600/min)
GET    /api/search?q=                   → named entities across layers (public)
GET    /api/reference/layers            → reference-layer catalog (public)
GET    /api/reference/:layer/entities[/:entityId] → named reference entities (public)
POST   /api/roi/resolve                 → resolve the analysis region (ROI) — area, line or point (public, 120/min)
POST   /api/assistant/messages          → map assistant (LLM) turn               [auth, rate-limited per user]
```

Passwords are argon2-hashed; JWTs are signed from `JWT_SECRET` with a short expiry; every
write is recorded in `app.audit_log`; geometry is validated in PostGIS before writes.

## Workspace scripts (repo root)

| Script | Action |
|---|---|
| `npm run dev:web` | Start the frontend dev server |
| `npm run build:web` | Build the frontend |
| `npm run lint:web` | Lint the frontend |
| `npm run build:shared` | Build `@webatlas/shared` |
| `npm run test:shared` | Run `@webatlas/shared` tests (Vitest) |
| `npm run migrate` | Apply DB migrations |
| `npm run atlas:up` | Onboarding: check the machine, start the stack, build the tools image, migrate, build and verify every dataset (accepts `--compose <file>`, `--only`, `--except`, `--force`) |
| `npm run atlas:status` | Show what is built, stale, missing or failed, and the next command |
| `npm run atlas:build` | Build datasets (`--only <id>`, `--except <id>`, `--force <id>`) |
| `npm run atlas:verify` | Check the atlas actually serves |
| `npm run atlas:adopt` | Record an already-built machine in the registry without re-running it |
| `npm run seed` | Seed the `water.*` thematic layers — superseded by `atlas:build`; kept until Plan C |
| `npm run publish:geoserver` | Publish the WFS layers in GeoServer — superseded by `atlas:build`; kept until Plan C |
| `npm run test:api` | Run the API test suite (needs the DB stack up) |
| `npm run test:versioning` | Run the versioning package's tests (needs the DB stack up and seeded) |
| `npm run test:api:live` | API tests that call the real LLM (needs an API key) |
| `npm run test:web` | Run the frontend tests |

API-workspace scripts (run with `-w @webatlas/api`): `dev`, `start`, `create-admin`,
`migrate:up`, `migrate:down`, and the build steps the registry runs for you (`ingest:rivers`,
`rivers:hierarchy`, `reference:build`, `contours:generate`). Pipeline tests: `npm run test -w @webatlas/atlas-data`.

## Regenerating administrative boundaries

`apps/web/public/provinces-34.geojson` (34 tỉnh sau sáp nhập, cả nước) và
`wards-region.geojson` (xã của 6 tỉnh trong vùng công tác) là generated
artifact đã commit — không cần chạy lại để chạy app.

Nguồn: [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database)
(MIT), dữ liệu gốc từ NXB Tài nguyên – Môi trường và Bản đồ (Bộ NN&MT).

Chạy lại khi ranh giới hành chính thay đổi:

```bash
node packages/atlas-data/tools/fetch-boundaries.mjs
```

Hình học được đơn giản hóa (Douglas–Peucker tol 0,0001 ≈ 11 m, toạ độ làm tròn
5 chữ số). Bước này bắt buộc: dữ liệu xã thô là 157 MB, sau xử lý còn ~10 MB.
Sai số 11 m nằm dưới nửa pixel ở mức zoom tối đa của app (1:100.000).

## Regenerating OSM water data

`packages/atlas-data/data/seeds/osm-rivers-region.geojson` và
`osm-lakes-region.geojson` là generated artifact đã commit — không cần chạy lại
để chạy app.

Nguồn: OpenStreetMap qua Overpass API, giấy phép **ODbL** (bắt buộc ghi công
"© OpenStreetMap contributors").

OSM là nguồn `rivers`/`lakes` duy nhất (không còn `thuyhe.geojson` — xem
"Project status"). `npm run seed` KHÔNG nạp rivers từ OSM; bước đó là
`ingest:rivers` riêng, **bắt buộc chạy sau `seed`** vì nó tạo và kích hoạt một
version `rivers` mới đè lên bất kỳ version nào `seed` để lại active.

Từ khi có sổ đăng ký, bước 6–7 dưới đây có thể chạy bằng `npm run atlas:build -- --force seeds` rồi `--force rivers`
(`rivers` tự phụ thuộc `seeds`); các lệnh `seed` và `ingest:rivers` cũ vẫn chạy được cho đến Plan C.

Toàn bộ pipeline tái tạo dữ liệu OSM, theo đúng thứ tự (có các ràng buộc thứ tự
bắt buộc — xem danh sách ngay dưới):

```bash
node packages/atlas-data/tools/fetch-osm-waterways.mjs      # 1. tải thô từ Overpass (không commit)
node packages/atlas-data/tools/explore-osm.mjs              # 2. xem phân bố tag đã đổi chưa
node packages/atlas-data/tools/report-dam-crosscheck.mjs    # 3. đối chiếu đập OSM vs danh mục (chỉ sinh báo cáo)
node packages/atlas-data/tools/build-osm-seeds.mjs          # 4. chuyển thành file seed
node packages/atlas-data/tools/clip-to-region.mjs           # 5. cắt xuống vùng công tác
npm run seed -w @webatlas/api                      # 6. nạp lại các layer chuyên đề khác
npm run ingest:rivers -w @webatlas/api             # 7. nạp OSM rivers làm version active
```

**Ràng buộc thứ tự bắt buộc:**

- **Bước 2 trước bước 4** — luôn chạy `explore-osm.mjs` và đối chiếu với bảng
  ánh xạ trong `packages/shared/src/osm-water.ts`: nếu OSM xuất hiện giá trị
  tag mới đáng kể, cập nhật bảng trước khi nạp.
- **Bước 3 trước bước 5** — `clip-to-region.mjs` ghi đè
  `packages/atlas-data/data/seeds/dams.geojson` **tại chỗ** (cắt xuống vùng công
  tác). `report-dam-crosscheck.mjs` cần bản đầy đủ (toàn quốc) để đối chiếu
  đúng; nó có fallback đọc từ `git show HEAD:` nếu file trên đĩa đã bị cắt,
  nhưng fallback đó chỉ in cảnh báo ra console chứ không chặn chạy sai — chạy
  đúng thứ tự để khỏi phụ thuộc fallback.
- **Bước 7 phải chạy sau bước 6** — `seed` không đụng tới `rivers` (không còn
  layer seed nào cho `rivers`), nhưng nếu có version `rivers` khác đang active
  từ trước, `ingest:rivers` là bước duy nhất kích hoạt version OSM mới nhất.

`prune-hydrosheds-versions.mjs` dọn các version `rivers`/`lakes` cũ (HydroSHEDS,
`thuyhe.geojson`) khỏi DB sau khi OSM đã lên active — **từ chối chạy** nếu
version cũ nào đó đang active (để không xoá nhầm dữ liệu đang phục vụ). Chạy
sau bước 7, không bắt buộc:

```bash
node packages/atlas-data/tools/prune-hydrosheds-versions.mjs
```

## Regenerating HydroSHEDS seed data

The lakes/reservoirs seed `packages/atlas-data/data/seeds/hydrolakes-vn.geojson` (clipped to the
Vietnam bbox `102 8 110 24`, lon/lat) and the river-reach seed `hydrorivers-region.geojson`
(whole reaches intersecting the six working provinces) are derived from the upstream
HydroSHEDS datasets and committed as generated artifacts — you don't need to regenerate them
to run the app. Regenerate only when refreshing to a newer upstream release.

`hydrorivers-vn.geojson`, next to them, is **superseded**: it has no `NEXT_DOWN`, so it cannot
carry the river network's topology, and nothing loads it. It is kept in git for history only.

To regenerate:

1. Download the upstream shapefiles:
   - **HydroLAKES v1.0 polygons** — https://www.hydrosheds.org/products/hydrolakes
     (direct: `https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip`, ~800 MB)
   - **HydroRIVERS v1.0 (Asia region)** — https://www.hydrosheds.org/products/hydrorivers
     (direct: `https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip`, ~90 MB)
2. Unzip both. The clipper needs the Python geo toolchain, which lives in the `atlas-tools` image; if you
   run the script directly on the host instead, install it there first (`pip install geopandas shapely pyproj fiona`,
   **only for running this maintainer script outside the container**).
3. Run the prep script against the unzipped `.shp` files:
   ```bash
   packages/atlas-data/tools/prep-hydrosheds.sh /path/to/HydroLAKES_polys_v10.shp /path/to/HydroRIVERS_v10_as.shp
   ```
   This writes `hydrolakes-vn.geojson` and `hydrorivers-region.geojson` into
   `packages/atlas-data/data/seeds/`. Lakes carry `Hylak_id, Lake_name, Lake_type, Lake_area,
   Vol_total, Shore_len`. Reaches carry `HYRIV_ID, NEXT_DOWN, MAIN_RIV, ORD_STRA, LENGTH_KM`,
   at every stream order (13,045 reaches, 3.4 MB with coordinates rounded to 5 decimals):
   `NEXT_DOWN` is the downstream link the river hierarchy is built on, so no order may be
   filtered out without cutting the network. Then change `HYDRORIVERS_SOURCE` in
   `apps/api/src/db/seeds/ingestRivers.ts` and run `npm run ingest:rivers -w @webatlas/api`,
   which loads the reaches and rebuilds the hierarchy. The source string is the ingest's
   idempotency key: left unchanged, the ingest re-activates the existing version instead of
   loading the new file.

## Project status

The build-out is phased. Each plan produces working, testable software on its own.

- [x] **Plan 1 — Monorepo + infrastructure foundation** (workspaces, `@webatlas/shared`, PostGIS + GeoServer via Docker Compose).
- [x] **Plan 2 — DB migrations + seeds + GeoServer publication** (WFS serves the 7 thematic layers).
- [x] **Plan 3 / 3b — Frontend WFS data-source swap + MVP/Feature-Sliced refactor** (read-only viewer).
- [x] **Plan 4 — Fastify API control plane** (global middleware, typed errors, JWT auth, RBAC, user CRUD + audit).
- [x] **Plan 5 — Layers feature CRUD API** (layer registry, generic GeoJSON CRUD, geometry validation, audit).
- [x] **Plan 6 — Frontend admin auth foundation** (apiClient, session/login, RequireRole guard).
- [ ] **Plan 7** — Admin map editing UI (draw/modify/delete + attribute forms → API → WFS refetch). Chưa triển khai; đây không còn là mốc kế tiếp.
- [x] **Vùng công tác + OSM waterways + ranh giới 34 tỉnh** (dữ liệu chuyên đề giới hạn trong 6 tỉnh Nam Trung Bộ & Tây Nguyên; sông/hồ từ OpenStreetMap có tên riêng; ranh giới hành chính sau sáp nhập 01/7/2025).
- [x] **Plan A — Cải tổ giao diện** (thanh biểu tượng thay bảy panel nổi, bảng lớp/chú giải chạy trên dữ liệu thật, lớp lệnh bản đồ dùng chung `MapCommand`).
- [x] **Plan B — Trợ lý bản đồ** (LLM phía máy chủ hỏi đáp tiếng Việt, đo đạc bằng PostGIS, điều khiển bản đồ bằng ngôn ngữ tự nhiên). Xem [runbook](docs/runbooks/map-assistant.md). Đã chạy kiểm tra với khoá API thật ngày 14/09/2026: lần đó phát hiện và sửa lỗi mô hình tự bịa toạ độ địa danh (thêm công cụ `locate_place`); chi tiết ở mục "Lần chạy kiểm tra đầu tiên" trong runbook.
- [x] **Đường đồng mức và DEM** (độ cao theo con trỏ, ô đọc số trên bản đồ, `elevation_profile` / `zonal_elevation`). Xem [runbook DEM](docs/runbooks/elevation-dem.md) và [đường đồng mức](docs/runbooks/terrain-contours.md).
- [x] **Phản hồi giám sát** (chỉ quản trị viên được ghi, cập nhật dữ liệu qua trợ lý, thao tác phân tích, in ấn, hệ quy chiếu).
- [x] **Mô hình thực thể, giai đoạn 1–4**: ranh giới hành chính và đóng dấu mã tỉnh/xã lên mọi đối tượng; lớp tham chiếu, thực thể có tên và tìm kiếm; topology sông và phân cấp ba cấp; vùng phân tích (ROI) là đối tượng hạng nhất cùng thanh công cụ phân tích ([hướng dẫn](docs/runbooks/vung-phan-tich.md)). Giai đoạn 5 chưa làm.
- [x] **Sổ đăng ký dữ liệu — kế hoạch 1, A và B** (`packages/atlas-data`: `atlas:build` / `atlas:status`, dựng lại theo chuỗi phụ thuộc, các stage `run` / `fetch-http` / `publish-geoserver`; ảnh Docker công cụ, `atlas:up` dựng và kiểm chứng mọi thứ từ bản clone mới, `atlas:verify`, `atlas:adopt`). Các [runbook](docs/runbooks/README.md) mô tả từng tập dữ liệu. Kế hoạch C (`packages/versioning`, `load-geojson`, bỏ các lệnh cũ) là bước kế tiếp.
- [ ] **Tài liệu hoá lại kho** ([docs/superpowers/plans/2026-09-07-repo-redocumentation.md](docs/superpowers/plans/2026-09-07-repo-redocumentation.md)) — mốc kế tiếp.

## Documentation

- **Design spec (backend/frontend/DB):** [docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md](docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md)
- **Auth foundation design:** [docs/superpowers/specs/2026-07-14-frontend-admin-auth-foundation-design.md](docs/superpowers/specs/2026-07-14-frontend-admin-auth-foundation-design.md)
- **Implementation plans:** [docs/superpowers/plans/](docs/superpowers/plans/)
