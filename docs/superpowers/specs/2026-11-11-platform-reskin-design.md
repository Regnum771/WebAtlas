# Platform reskin — one analytical look across WebATLAS, GeoNode, Keycloak and Dagster

Date: 2026-11-11. Status: **approved by the user 2026-11-11**, with the hub-hero layer stack added on approval.
Direction canvas: https://claude.ai/artifact/URkzn3iGATu5ZLn5SuV9xG. The artboards that count are **1 Tokens**, **2 Hub**, **3 v2 Map**, **3b v2 Forecast**, **4 GeoNode**, **5 Sign-in** and **6 Dagster**. "3" and "3b" (the old versions) and the A–D row (rejected) are reference only.

## Why

Two things look generic: the visual style, and the controls, which are home-made primitives in `apps/web/src/shared/ui`. A user moving between WebATLAS, GeoNode/MapStore, the Keycloak sign-in page and Dagster also sees four different products. The goal is for the platform to look like one serious analytical tool, for agency readers first.

## Decisions

These are the user's decisions from 2026-11-11 and are binding.

| # | Decision |
|---|---|
| R1 | Change both the look and the component foundations. |
| R2 | One look across WebATLAS, the GeoNode portal, the Keycloak sign-in pages and the Dagster UI. GeoNode keeps its own screens, themed; it is not rebuilt inside WebATLAS. |
| R3 | Direction "modern atlas". The 2026-10-06 rules "minimise decorative accents" and "the green stays in the top bar" are **lifted**. |
| R4 | Approach 1: Tailwind v4 plus shadcn/ui on Radix. Tokens live once, in a theme package that also generates the GeoNode, Keycloak and Dagster stylesheets. |
| R5 | Dashboards, the forecast and chart analysis on the interactive map are in scope. |
| R6 | No soft-card look. The user preferred the original layout over the four surface alternatives (A–D). |
| R7 | It must not look like an iOS consumer app. It must read as an analytical application (see "Visual system"). |
| R8 | **The bottom edge of the map is the scale bar, always.** The time slider appears as a second row above it only while a time layer is on. |

Still binding from earlier tracks:
- The scale slider keeps the 11 stops of `ZOOM_SCALE_LEVELS` (1:12.800.000 to 1:25.000); only its look changes.
- Agency readers are the primary user.
- The OSM Carto basemap stays.
- The supported viewport is 768 px and wider.

## Visual system

### Rules

- **Corners:** 3 px on tags, kbd and swatches; 4 px on buttons, inputs and toolbars; 6 px on panels and dialogs. No pill shapes. Round dots are allowed only for status.
- **Edges:** a 1 px border (`line`) on every panel. A shadow appears only on things that genuinely float above content (popup, menu, toast): `0 4px 12px rgb(20 27 45 / 12%)`.
- **Density:** layer rows 30 px, group rows 32 px, controls 28 px inside panels and 30–32 px in main bars. Body text is 13 px; panel titles 14 px; page titles 20 px at most. Display type (Archivo `wdth` 120, up to 56 px) appears on the hub and the sign-in hero only.
- **Banned:** pill shapes, iOS switches, segmented tab controls, round avatars, floating action buttons, frosted see-through bars, and stat cards in place of values with units.
- **Required:** every measured value carries a unit and an "as of" time. Charts have axis ticks, units and a legend. Each data panel shows its source. Sample data carries a "MẪU" tag.
- **Numbers** use JetBrains Mono so values don't shift when NumberFlow changes them. River names use Newsreader Italic, on the map and in popups only.

### Tokens

| Token | Value | Use |
|---|---|---|
| `brand` | `#14532D` | primary button, active item, tab underline |
| `brand-tint` | `#E3EFE6` | background of a pressed or active tool |
| `ink` / `ink-2` | `#141B2D` / `#4F5A6E` | text; secondary text and axis labels (6.9:1) |
| `water` | `#0F6E8C` | links, river names |
| `surface` / `surface-2` | `#FFFFFF` / `#F7F8F5` | panels; panel headers, inputs, page ground |
| `line` / `line-2` / `line-3` | `#CDD3CA` / `#E3E6E0` / `#EEF0EC` | panel border; section divider; row divider |
| `mark` | `#FFD928` | selected feature, focus ring |
| `alert` | `#B3261E` | failures, irreversible actions, alarm breached |
| `series-1` / `series-2` | `#1F7FB8` / `#D2691E` | forecast / observed (validated: worst CVD ΔE 21.0). Dark surface: `#3F8FD0` / `#D9702F` |
| `alarm-1..3` | `#C99A06` / `#D9773F` / `#C0392B` | BĐ1–BĐ3 lines, always with a text label |
| `depth-1..4` | `#C9C3EA` → `#3F2E8C` | flood depth. Violet so it never reads as basemap water; this resolves the open "depth blues vs OSM water" follow-up |

Motion:
- `fast` 120 ms: hover, layer toggle, tab change.
- `base` 200 ms: group expand, popover, toast.
- Vaul spring: drawers.
- Ambient: hub contour drift and the sign-in hero only, turned off when the reader asks for reduced motion.

## Surfaces

### Map (`/ban-do`), artboard 3 v2

- **Header:** 44 px, opaque, attached to the top edge.
  - Wordmark, then the nav (Bản đồ · Danh mục · Điều phối) with a 2 px underline on the active page.
  - A cmdk search (`Ctrl K`) over places, layers, coordinates and commands.
  - A Trợ lý button (shortcut `/`).
  - The account name with a menu.
- **Contents panel:** floats 8 px from the edges, 312 px wide.
  - A title row with "N lớp bật · Tắt hết", then a layer filter.
  - The six group bars, each showing an `on/total` count.
  - Each layer row has a checkbox, its legend swatch, its opacity and an info button.
  - Layers limited to certain scales say so, for example "từ 1:250.000".
  - The legend for the active area fill sits at the panel foot with a source link.
- **Map tools:** grouped 32 px button stacks at the top right: zoom and full extent; measure, analysis area, profile, print; basemap.
- **Popup:** a 6 px panel with a header strip and an attribute table, plus actions (Phân tích lưu vực, Hỏi trợ lý, ⋯).
- **Toast (Sonner):** light and bordered, with an icon and an undo button.
- **Status bar** (R8): along the bottom edge on every map state. It holds:
  - the scale readout;
  - the 11-stop slider, with the named stops labelled "cấp vùng" and "cấp tỉnh";
  - coordinates;
  - the CRS switch (VN-2000 and the others already supported);
  - how many features are selected.

### Map with the forecast and analysis dock, artboard 3b v2

- The contents panel collapses to a 34 px rail (Mục lục, Dự báo và phân tích, Trợ lý). The dock takes the right side, 500 px wide and full height.
- **Simulation:** a tag in the header (`MÔ PHỎNG · MSWEP lịch sử · 6 giờ/phút · 27/10/2025 00:00`) whenever the replay clock runs.
- **Dock layout, top to bottom:**
  1. Run header: issue time, model and version (HEC-RAS 2D, placeholder), horizon, and a MẪU tag.
  2. Underline tabs Tổng quan · Mưa · Mực nước · Phân tích, plus Xuất CSV.
  3. A KPI row (value + unit + threshold + as-of time).
  4. The basin daily rain chart.
  5. The forecast-point water-level chart (forecast line, bulletin dots, BĐ1–BĐ3, issue time, now line, crosshair tooltip).
  6. A forecast-point table (bulletin level, forecast peak, time of peak, alarm level; the breached row highlighted).
  7. A sources line, and "+ Điểm trên bản đồ" for a clicked point.
- **Time row** (R8): sits above the status bar while a time layer is on, with a × to close it. It holds step back, play, step forward; the current time; day ticks; the observed and forecast segments; the issue-time mark; and a step-size picker.
- **Phân tích tab:** holds the spatial-analysis results: profile, basin statistics, and ROI results from the existing `analysis` and `roi` features. All charts live in the dock instead of each feature having its own card.
- **768–1099 px:** the dock becomes a Vaul drawer from the right, over the map, so it never covers the status bar. This also settles the 2026-10-06 open issue of the floating assistant covering the scale control, because the floating assistant is gone.

### Hub (`/`), artboard 2

- **The hero shows a stylised stack of the atlas's own layers** (user, 2026-11-11), drawn as an exploded isometric stack with leader-line labels. From the bottom up:
  1. terrain (FABDEM hillshade and contours);
  2. the OSM Carto basemap;
  3. rivers and basins (HydroRIVERS, three levels);
  4. forecast flood depth (HEC-RAS 2D, violet ramp).

  The layers are **real snapshots of WebATLAS layers** for the Vu Gia – Thu Bồn extent, not drawn vector art:
  - a build script in K5 renders each layer from GeoServer (WMS `GetMap`, one image per layer, same extent and size) to WebP;
  - the images are stacked with CSS transforms (`rotateX(60deg) rotateZ(-45deg)`), with no WebGL;
  - each layer floats a few pixels on a staggered loop, and the stack spreads further apart on hover;
  - when the reader asks for reduced motion the stack is static.
- The hero background keeps faint drifting contours and a flowing river line. Below the CTAs is a one-line replay status (PHÁT LẠI 10/2025, basin rain, Ái Nghĩa level, sources). This is where the lifted decoration rule applies.
- Below the hero: three bordered service panels (Bản đồ, Danh mục, Điều phối), each with a live status tag from `GET /api/platform/services`.
- A "Mới cập nhật" table of recent catalogue entries.
- Magic UI may supply the hero effect, and only there.

### GeoNode dataset page, artboard 4

- The same header and nav as WebATLAS.
- GeoNode's own sub-tabs (Bộ dữ liệu · Bản đồ · Tài liệu · Chờ duyệt).
- A 20 px title with type tags and the layer id.
- Actions: Mở trên bản đồ WebATLAS · Tải xuống · ⋯.
- A preview with its own legend and time bar.
- Side tables for metadata, access and versions.

### Keycloak sign-in, artboard 5

A split layout: the dark contour hero on the left, the form on the right. The form has 36 px inputs and a 40 px button, the wrong-password state (bordered alert), the focus ring in `mark`, and Vietnamese messages.

### Dagster, artboard 6

A 44 px WebATLAS frame (wordmark, "Điều phối dữ liệu", ← Về bản đồ) plus Dagster recoloured through its CSS variables. Dagster's own text stays English because it has no Vietnamese version. Best effort: layout drift on a Dagster upgrade is accepted.

## How it fits the code

- **Theme package:** a new `packages/theme` holds `tokens.json` as the only source of truth. A build step generates:
  - `tokens.css`: CSS custom properties, light, plus dark values for the series;
  - `tailwind-theme.css`: the `@theme` block WebATLAS imports;
  - `geonode.css`: MapStore/GeoNode variable overrides and header styling;
  - `keycloak/`: the theme folder (`theme.properties`, `login.css`, `messages_vi.properties`);
  - `dagster.css`: overrides for Dagster's CSS variables plus the frame.

  A test checks that the generated files match a fresh build, and checks text contrast for every text/surface pair in the token table.
- **WebATLAS foundations:**
  - Add `tailwindcss` v4 through `@tailwindcss/vite`, then `shadcn` init with its components in `apps/web/src/shared/ui`.
  - **Keep the existing export names** (`Button`, `Dialog`, `ConfirmDialog`, `TextField`, `ToastHost`/`toast.store`, `Spinner`) so the 60 importing files don't change in the first step.
  - Toasts move to Sonner behind the same `toast.store` API.
  - **Cascade:** Tailwind's preflight goes in a lower `@layer`. `ol/ol.css` and the legacy `main.css`/`shell.css` (about 2.8k lines) load in a layer that wins until each screen is converted, and are deleted as screens move over. No screen mixes the two systems for longer than one sub-project.
- **Libraries:**
  - shadcn/ui + Radix: Dialog, AlertDialog, Popover, DropdownMenu, Tabs, Tooltip, Checkbox, Select, Slider (the scale and time sliders keep their own model code).
  - Sonner (toasts), Vaul (edit drawer, narrow-width dock), cmdk (search and commands), NumberFlow (KPI values).
  - shadcn Charts on Recharts replace `ProfileChart.view.tsx` and `LevelChart.view.tsx`.
  - Magic UI on the hub only.
- **Presenter/view split:** unchanged. The reskin touches `*.view.tsx` and styles. Presenters, queries and models change only where a new control needs new state (the dock tabs, the time row's visibility, the cmdk index).
- **GeoNode:** themed through mounted template and static overrides in `infra/platform/geonode`, plus MapStore theme variables. No fork of `geonode-mapstore-client`.
- **Keycloak:** a custom login theme mounted into the container and selected in `webatlas-realm.json`.
- **Dagster:** a reverse proxy in front of the pinned 1.13.27 (oauth2-proxy upstream) injects the stylesheet and the frame with `sub_filter`.

## Sub-projects

Each sub-project gets its own plan, then is built and reviewed.

| # | Sub-project | Depends on | Notes |
|---|---|---|---|
| K1 | Theme package and tokens | — | Generators and the contrast test. |
| K2 | WebATLAS foundations | K1 | Tailwind, shadcn, primitives behind the same exports, Sonner, cascade layers. No visible redesign yet beyond the primitives. |
| K3 | Map screen shell | K2 | Header, contents panel, tools, popup, status bar with the restyled scale slider, cmdk, Trợ lý button. |
| K4 | Analysis dock, charts, time row | K3 | Dock, KPI row, shadcn Charts replacing both hand-drawn charts, forecast-point table, CSV, table view, violet depth ramp, Vaul at narrow widths. **S3/S4** (forecast track) supply the data; K4 gives them the place to render. |
| K5 | Hub, sign-in route, profile, admin pages | K3 | Layer-stack hero with its snapshot build script, service panels, recent-entries table. |
| K6 | Keycloak login theme | K1 | Can run in parallel with K2–K5. |
| K7 | GeoNode/MapStore theme | K1 | **Starts with a spike** to find which hooks GeoNode 5.0.3 offers (template dirs, static override, MapStore CSS variables) before planning. |
| K8 | Dagster frame | K1 | Proxy injection, best effort. |

## Testing

- The existing web suite (788+ tests) stays green after every sub-project. Tests that assert class names are rewritten to assert roles and text.
- **Browser proof** (jsdom cannot prove layout): `verify:shell` is extended to check four things at 768, 1100 and 1440 px:
  - the status bar is visible and clickable in every map state;
  - the time row never overlaps it;
  - the dock never covers the status bar;
  - the cmdk palette opens with `Ctrl K`.
- Every chart has a table view; every chart colour pair goes through the dataviz palette validator; text contrast is checked in K1's test.
- K6–K8 are checked by screenshot in the running platform stack (`infra/docker-compose.platform.yml`), one capture per surface, compared with its artboard.

## Out of scope

- Rebuilding GeoNode screens inside WebATLAS.
- Translating Dagster.
- Dark mode for the whole app (only the series colours have dark values, for future use).
- The printed Atlas.
- New analysis functions. K4 moves and restyles existing ones and hosts S3/S4.

## Assumptions awaiting confirmation

1. "The first option" meant the original canvas layout, not style A.
2. "Dashboard(s)" means the dock on the map. No separate full-page dashboard (the Giám sát screen stays out, as on 2026-10-06).
3. Desktop density (28–32 px controls) is acceptable at 768 px and up. Tablets are a secondary use.
4. The hub's "Mới cập nhật" table reads the catalogue through the existing API's GeoNode bridge. If that needs a new endpoint, it is added in K5.
5. Trợ lý moves from a floating button to the header and the rail; its panel opens in the dock area.
6. Violet for flood depth.
7. The scale stops named on the slider are the two from `NAMED_SCALES` (cấp vùng 1:250.000, cấp tỉnh 1:100.000).

## Supersedes

From `2026-10-06-ui-redesign-design.md`, this spec replaces the visual identity (colours partly kept: green, ink, highlighter yellow, alert red, Archivo, Newsreader for water names) and the decoration and green-bar rules. That spec's structure decisions still stand: chuyên đề grouping, switching rules, scale slider, Quản lý danh mục bản đồ, states and input.
