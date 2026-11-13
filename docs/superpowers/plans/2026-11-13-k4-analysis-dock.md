# K4 — Analysis Dock, Charts and Time Row Implementation Plan

> Executed natively on the server (2026-11-13), task by task, one commit per task, as K3 and K5 were.
> Branch `feat/k4-analysis-dock` off `main` `c6fe752` (K3 and K5 merged), in the `.superpowers/wt-k3` worktree.

**Goal:** The map gets the forecast and analysis dock of artboard 3b v2. A 500 px dock on the right holds the
forecast run and the analysis results in four tabs. Both hand-drawn charts become shadcn Charts on Recharts,
each with a table view. One time row sits above the status bar while a time layer is on. Flood depth turns
violet. Below 1100 px the dock is a Vaul drawer.

**Spec:** `docs/superpowers/specs/2026-11-11-platform-reskin-design.md` ("Map with the forecast and analysis
dock", R8, tokens `series-*`, `alarm-*`, `depth-*`, the K4 row, assumption 5).

**Architecture:** as K3 and K5. Presenters, stores and queries stay; `*.view.tsx` and styles change. New state
lives in `shell.store` (which dock view is open, its tab, whether the contents panel is collapsed). Each new or
converted view's root carries a `data-slot`, and its folder joins Tailwind's `@source` list (tests excluded).
The legacy CSS it replaces is deleted in the same task.

## State of the forecast track (checked 2026-11-13)

S1 (catalogue → map, time layers, the HEC-RAS import) is on `main`. **S3 (simulated live rainfall) and S4 (the
forecast placeholder) are not built:** there is no `obs.observations`, no basin rain series, no `forecast.runs`.
What exists today and feeds the dock:
- the flood scenario demo (`flood-scenario`): stations with BĐ1–BĐ3, hourly levels, the bulletin's forecast
  points and issue hour, flooded km² per hour, roads and wards reached, the scenario's rain total;
- the S1 time layers (the shared time slider's steps);
- the spatial-analysis results (`analysis`, `roi`): summary, rows, elevation profile.

K4 builds the place S3/S4 will render into and fills it from these. S3/S4 later replace the data, not the dock.

## Global Constraints

As K3's: corners 3/4/6 px, a 1 px `line` border on every panel, a shadow only on what floats, controls 28 px in
panels and 32 px in bars, body 13 px, panel titles 14 px. No pill shapes, switches, segmented tabs, round
avatars, floating action buttons, frosted bars or stat cards. Every measured value carries a unit and an "as
of" time. Charts have axis ticks, units and a legend, and a table view. Each data panel shows its source;
sample data carries a MẪU tag. Numbers in `font-num`. Vietnamese copy, existing strings reused. Supported from
768 px; every browser check runs at 768, 1100 and 1440. Commits: Vietnamese Conventional Commits with the
`Co-Authored-By` trailer. No recursive deletes.

## Decisions This Plan Makes Beyond the Spec

1. **The dock is the page's third grid column at 1100 px and wider**, where Trợ lý's column is today, so it
   never covers the map's status bar: the status bar ends at the dock's edge. Below 1100 px it is a drawer
   from the right over the map, stopping above the status bar and the time row (R8). See decision 12.
2. **Trợ lý is a view of the dock** (spec assumption 5). The dock shows either the forecast/analysis tabs or
   Trợ lý. The header button, `/` and the rail's Trợ lý button switch to it. `toggleAssistant` keeps its name.
3. **The rail is always there.** The contents panel's title row gains a collapse button. Opening the dock
   collapses the panel to the 34 px rail once; Mục lục on the rail opens it again.
4. **What opens the dock:** opening a flood scenario (tool menu or assistant command) opens Tổng quan. A new
   analysis result opens Phân tích. The rail's "Dự báo và phân tích" button opens the last tab.
5. **The flood demo's bottom panel goes.** Its scenario picker, sample note and Phương án sơ tán move to the run
   header. Its impacts become KPIs, its level chart moves to Mực nước, and its play controls move to the time row.
6. **Mưa shows what exists:** the scenario's rain total as a KPI (presets carry one; the KTTV replay has none)
   and an empty chart state, "Chưa có chuỗi mưa lưu vực — có khi chạy mô phỏng mưa (S3)". The basin chart
   component is built and tested with fixture data, ready for S3.
7. **No simulation tag and no "+ Điểm trên bản đồ" yet.** Both need the replay clock (S3) or the model
   interface (S4). The run header reads "Kịch bản lũ · {name} · phát hành {bulletin time}" and carries MẪU.
8. **One time row, one source at a time.** While a flood scenario is open, it drives the row (hours; the
   observed segment up to the bulletin hour, the forecast after it, the issue-time mark). Otherwise the S1 time
   layers drive it (their steps). Its × closes the scenario, or for S1 layers hides the row until the set of
   time layers changes. The step-size picker is a Select (1, 2 or 4 hours per tick for the scenario; 1, 2 or 4
   steps for S1 layers), replacing the 1×/2×/4× segmented buttons.
9. **Five violet depth bands, not four.** The demo's legend, the hover readback and the catalogue's depth
   style use five bands (< 0,5 · 0,5–1 · 1–2 · 2–3 · ≥ 3 m). Tokens `depth-1..4` keep their values for the
   first four bands. A new `depth-5` `#261A5C` takes ≥ 3 m. The pixel encoding (band colour + step offset in
   red) is unchanged, so the hover still reads depth exactly. Existing frames are recoloured in place by the
   generalised `recolor_frames.py`, with no rebuild. The catalogue's `webatlas_depth` style is updated in the file; it
   is re-applied to GeoNode's GeoServer when K4 merges (see Task 2).
10. **Charts:** shadcn's `chart` component on Recharts 3. Water level: the gauge level line (`series-2`,
    observed), bulletin forecast points (`series-1`, open circles), BĐ1–BĐ3 as dashed `alarm-1..3` lines with
    text labels, the record line, the issue-time line, the current-time line, a crosshair tooltip. Profile:
    distance (km) against elevation in the dictionary's display unit. Each chart has "Biểu đồ · Bảng" as
    underline tabs (the only tab style allowed).
11. **Xuất CSV exports the active tab:** Tổng quan and Mực nước export the forecast-point table and every
    station's hourly series. Phân tích exports the existing result CSV. Mưa exports the rain series when there
    is one, and is disabled otherwise.

12. **(Found while building) No Vaul.** Vaul 1.1.2 accepts `modal={false}` but never passes it to the Radix
    dialog it wraps, so its drawer trapped focus and hid the map from assistive technology: the time row's
    keys did nothing while it was open. The narrow dock is a plain non-modal `aside` inside the map stage,
    sliding in by CSS (not under reduced motion), closed by its × or Escape inside it. Vaul is uninstalled;
    swipe-to-close is not offered.
13. **(Found while building) Trợ lý keeps its conversation.** Both dock views stay mounted while the dock is
    open; the one not shown is hidden, so switching to the forecast view and back keeps the chat.

## Tasks

### Task 1: Libraries and primitives
Files: `apps/web/package.json`, `src/shared/ui/shadcn/{chart,tabs,drawer,select}.tsx` (as needed),
`src/shared/ui/{Tabs,Drawer,NumberValue}.tsx`, `app.css` `@source`, tests.
- [ ] Install `recharts@3`, `vaul`, `@number-flow/react`; fetch shadcn `chart`, `tabs`, `drawer` (one at a time,
  answer `n` to overwrites, uninstall the `cn` package, point imports at `@/shared/lib/utils`).
- [ ] Restyle: underline tabs (2 px `brand` underline, 13 px, 32 px tall), drawer without the handle pill, `NumberValue`
  (NumberFlow in `font-num`, value + unit).
- [ ] Tests: tabs switch with arrow keys; NumberValue renders value and unit; `shadcn.test` still passes.
- [ ] Commit: `feat(web): thư viện biểu đồ, ngăn kéo và thẻ cho khung phân tích`

### Task 2: Violet depth ramp
Files: `packages/theme/tokens.json` (+ generated), `packages/atlas-data/tools/flood_scenario/{depth,recolor_frames}.py`
(+ tests), `packages/atlas-data/tools/timeseries/styles/depth.sld`, `apps/web/src/features/flood-scenario/model/depthColour.ts`
(+ test), `packages/shared/src/dictionary/entries/flood_depth.ts` if it names colours.
- [ ] `depth-5` token; theme regenerated; contrast test untouched (no text on depth).
- [ ] Python and TS band tables in violet, in step; the decode test checks colours the Python build prints.
- [ ] `recolor_frames.py` takes the source bands (`--from blue-bands`) and maps every step colour to the new one.
- [ ] Run it on this worktree's copy of the frame cache only. The main checkout's frames and GeoNode's
  `webatlas_depth` style also serve the LAN demo, which runs `main` (blue decode); they change when K4 merges:
  `recolor_frames.py` on `main`'s cache, then `ensure_styles()`.
- [ ] Commit: `feat: độ sâu ngập màu tím — năm dải, khung ảnh và kiểu lớp chuỗi thời gian`

### Task 3: Charts with a table view
Files: `src/features/flood-scenario/ui/LevelChart.view.tsx` (rewrite), `src/features/analysis/ui/ProfileChart.view.tsx`
(rewrite), `src/shared/ui/ChartFrame.view.tsx` (title, unit, legend, source, Biểu đồ · Bảng), new
`src/features/forecast-dock/ui/RainChart.view.tsx`, tests; `pages/print` if it renders the profile.
- [ ] Tests: each chart has a named figure, axis units, a legend naming every series, and a table view listing
  the same values; BĐ lines labelled in text; the issue-time and now lines present; the profile table shows
  distance and elevation in the display unit.
- [ ] Colours: `series-1/2` and `alarm-1..3` pairs through the dataviz validator (recorded in the commit body).
- [ ] Commit: `feat(web): biểu đồ mực nước, trắc diện và mưa trên Recharts, kèm dạng bảng`

### Task 4: Dock, rail and drawer
Files: `src/features/shell/model/shell.store.ts`, `src/features/shell/ui/{AppShell,Dock,Rail,SidePanel}.view.tsx`,
`src/app/MapScreen.tsx`, `src/widgets/top-bar`, `src/features/command-palette`, `src/styles/shell.css`, tests.
- [ ] Store: `dock: 'forecast' | 'assistant' | null`, `dockTab`, `contentsCollapsed`; `toggleAssistant`,
  `openDock(tab)`, `closeDock`, `toggleContents`. Tests for each, and for "opening the dock collapses the panel once".
- [ ] Dock view: 500 px column at ≥ 1100 px, Vaul drawer below, close button, `aria-label`; Trợ lý inside it.
- [ ] Rail: 34 px, three icon buttons with tooltips (Mục lục, Dự báo và phân tích, Trợ lý), pressed state.
- [ ] Old `.assistant-dock` CSS and `AssistantDockView` deleted.
- [ ] Commit: `feat(web): khung phân tích bên phải, thanh rail và ngăn kéo ở màn hình hẹp`

### Task 5: Dock content
Files: new `src/features/forecast-dock/**` (presenter `useForecastDock`, views `RunHeader`, `KpiRow`,
`ForecastPointTable`, tabs), `src/features/flood-scenario/{index.tsx,ui/FloodDock.view.tsx (deleted),ui/flood.css}`,
`src/features/analysis/index.tsx` (result leaves the menu), tests.
- [ ] Run header: scenario picker, "phát hành …", MẪU, Phương án sơ tán, close.
- [ ] KPI row: level at the chosen station (value, m, alarm reached, as of), flooded area (km²), roads cut (km),
  wards reached (and people), each with its as-of time; NumberFlow.
- [ ] Forecast-point table: bulletin level, forecast peak, time of peak, alarm reached; the breached row in `alert` tint.
- [ ] Tabs Tổng quan · Mưa · Mực nước · Phân tích, Xuất CSV; empty states when no scenario or no result.
- [ ] Sources line on each tab.
- [ ] Commit: `feat(web): nội dung khung phân tích — tổng quan, mưa, mực nước, phân tích`

### Task 6: Time row
Files: new `src/features/time-row/**` replacing `src/features/time-slider/ui` and `model/floodDockHeight.ts`,
`src/app/MapScreen.tsx`, tests.
- [ ] Adapter per source (scenario, S1 layers) → `{ steps, index, issueIndex?, observedUntil?, stepSizes }`.
- [ ] View: step back, play/pause, step forward, current time, day ticks, observed and forecast segments, issue
  mark, step-size Select, ×. Arrow keys step. Sits directly above the status bar, full map width.
- [ ] Tests: each source drives the row; × behaves as decision 8; the row never renders without a source.
- [ ] Commit: `feat(web): hàng thời gian phía trên thanh tỉ lệ`

### Task 7: Browser checks and handoff
Files: `apps/web/scripts/verify-map-shell.mjs`, `docs/superpowers/handoff/2026-11-12-reskin-k2-k3.md`.
- [ ] At 768, 1100 and 1440: open Kịch bản lũ → the dock (or drawer) opens on Tổng quan; the KPI row has values
  with units; the level chart switches to its table; the time row sits above the status bar without overlap; the
  dock never covers the status bar; Trợ lý opens in the dock (signed in) or is absent (signed out); screenshots.
- [ ] Legacy comparison: differences only inside the map shell.
- [ ] Commit: `test(web): kiểm chứng trên trình duyệt cho khung phân tích K4`
