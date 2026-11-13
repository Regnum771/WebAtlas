# K5 — Hub, Sign-in, Profile and Admin Pages Implementation Plan

> Executed natively on the server (2026-11-13), task by task, one commit per task, as K3 was.

**Goal:** Every WebATLAS page outside the map takes the analytical look K3 gave the map: the hub (`/`) with
its layer-stack hero, service panels and recent-entries table; the sign-in dialog and the SSO return page;
the profile (`/ho-so`); and Quản lý (`/quan-ly/*`) with its five sections.

**Spec:** `docs/superpowers/specs/2026-11-11-platform-reskin-design.md` ("Visual system", "Surfaces → Hub",
the K5 row, assumption 4).

**Architecture:** as K3. Presenters, stores and queries stay; `*.view.tsx` files and styles change. Each converted
view's root carries a `data-slot`; its folder joins Tailwind's `@source` list (tests excluded) and the cascade
test's list; its legacy CSS is deleted in the same task. Legacy content kept inside a converted container sits in
a container without `data-slot` that sets `border-solid` itself.

## Global Constraints

As K3's: corners 3/4/6 px, a 1 px `line` border on every panel, a shadow only on what floats, controls 28 px in
panels and 32 px in bars, body 13 px, panel titles 14 px, page titles 20 px at most; display type (Archivo
`wdth` 120, up to 56 px) on the hub hero only. No pill shapes, switches, segmented tabs, round avatars, floating
action buttons, frosted bars or stat cards. Numbers in `font-num`. Vietnamese copy, existing strings reused.
Supported from 768 px; every browser check runs at 768, 1100 and 1440. Commits: Vietnamese Conventional Commits
with the `Co-Authored-By` trailer. No recursive deletes.

## Decisions This Plan Makes Beyond the Spec

1. **No basins in the hero.** No basin layer exists in GeoServer or the database; the third layer is the river
   network alone. It gains basins when a basin dataset lands.
2. **Terrain is computed, not served:** a hillshade from the PostGIS raster `basemap.dem_region` (FABDEM), with the
   plain contours (`webatlas:contours_plain`) drawn over it, rendered by the snapshot script.
3. **Flood depth comes from the HEC-RAS import** on GeoNode's GeoServer (`geonode:ts_7cba03198bc64faf`, the
   10/2025 Thu Bồn – Vu Gia run), at its peak step, styled with the spec's violet ramp (`depth-1..4`) through
   `SLD_BODY`. The script takes the layer and step as arguments.
4. **Snapshots are committed** under `apps/web/src/pages/trang-chu/assets/` (WebP, about 900 px square). The script
   is a tools-image Python tool (`packages/atlas-data/tools/hub/snapshots.py`): GeoServer `GetMap` as PNG, then
   GDAL's WebP driver. It is run by hand when the data changes, never in CI.
5. **The replay status line shows what exists today:** "PHÁT LẠI 10/2025", the scenario's place and its sources,
   linking to Kịch bản lũ. Basin rain and the Ái Nghĩa level join it when the forecast track (S3/S4) supplies them.
6. **No Magic UI.** The hero's float, spread and drifting contours are CSS keyframes and an inline SVG; nothing new
   is installed.
7. **"Mới cập nhật" reads a new endpoint** `GET /api/catalogue/recent?limit=` (spec assumption 4): the entries the
   reader may see, newest first by `updated_at`, with the same visibility rules as the catalogue search.
8. **The sign-in route stays a dialog** (there is no `/dang-nhap` page besides the SSO return); K5 restyles the dialog
   and the return page.

## Tasks

### Task 1: Layer snapshots for the hero
Files: `packages/atlas-data/tools/hub/snapshots.py` (+ `test_snapshots.py`), `apps/web/src/pages/trang-chu/assets/*.webp`,
`apps/web/scripts/README.md`.
- [ ] Pure parts tested (`ok`/`FAIL` script, as the other tools): the square 3857 box around the Vu Gia – Thu Bồn
  extent, the GetMap URLs, the violet SLD.
- [ ] Render terrain (hillshade + contours), basemap, rivers, flood depth; write four WebP files.
- [ ] Commit: `feat(atlas-data): ảnh chụp bốn lớp cho phần mở đầu trang chủ`

### Task 2: Recent catalogue entries
Files: `apps/api/src/modules/catalogue/{routes,controller,repository,schemas}.ts`, tests.
- [ ] Tests: anonymous readers get only published public entries; an owner also gets their own; newest first;
  `limit` defaults to 6 and is capped at 20.
- [ ] Commit: `feat(api): danh mục mới cập nhật cho trang chủ`

### Task 3: Hub
Files: `src/pages/trang-chu/**`, `src/entities/catalogue` (recent query), `app.css` `@source`, `main.css` (delete `.hub*`).
- [ ] Tests: the hero names its four layers (leader-line labels) and offers Mở bản đồ and Danh mục; the stack is
  static when reduced motion is asked for (`motion-reduce` classes present, no animation names); three service panels
  with a status tag each (Hoạt động / Không kết nối được / Đang kiểm tra / Chưa kết nối); the recent table lists title,
  kind, date, and says so when empty or failed.
- [ ] Build it: hero with the CSS 3D stack (`rotateX(60deg) rotateZ(-45deg)`), staggered float, hover spread, faint
  contour SVG and river line; panels; table.
- [ ] Commit: `feat(web): trang chủ mới — chồng lớp, bảng dịch vụ, danh mục mới cập nhật`

### Task 4: Sign-in dialog and SSO return
Files: `src/features/auth/ui/LoginModal.view.tsx`, `src/pages/dang-nhap/SsoCallback.tsx`, tests, CSS.
- [ ] Commit: `feat(web): hộp thoại đăng nhập và trang quay về SSO theo diện mạo mới`

### Task 5: Profile
Files: `src/pages/ho-so/**`, tests, CSS.
- [ ] Commit: `feat(web): trang hồ sơ theo diện mạo mới`

### Task 6: Quản lý shell and four sections
Files: `src/pages/quan-ly/index.tsx` (view part), `src/features/{user-management,access-groups,unassigned}/ui/*`,
`src/features/my-maps/ui/UsageTable.view.tsx`, tests, CSS.
- [ ] Commit: `feat(web): khung Quản lý và các mục người dùng, nhóm quyền, đơn vị chưa gán, bản đồ cá nhân`

### Task 7: Dictionary editor and history
Files: `src/features/dictionary/ui/*`, tests, CSS.
- [ ] Commit: `feat(web): từ điển dữ liệu theo diện mạo mới`

### Task 8: Browser proof and cleanup
- [ ] `verify:pages` at 768, 1100, 1440: the hub's stack, panels and table fit with no sideways scroll; the stack is
  static under reduced motion; each Quản lý section and the profile render without overflow (signed-in checks need
  the verify account, else SKIPPED). Screenshots to `--out`.
- [ ] The legacy comparison stops applying to the converted pages; the handoff note records K5.
- [ ] Commit: `test(web): kiểm chứng trên trình duyệt cho các trang K5`
