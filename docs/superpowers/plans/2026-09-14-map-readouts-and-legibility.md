# Map Readouts and Legibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the map the standard readouts it has never had — loading state, a scale bar, cursor coordinates, a coordinate-capture tool and a graticule — and fix the river line weight that reads as far too heavy.

**Architecture:** Everything here is an `ol/control` or `ol/layer` added to a map that currently passes `controls: []`, plus one styling change. Each decision (coordinate formatting, loading state, line width) is extracted as a pure function tested without a browser, matching the pattern the rest of `features/map/model` already uses.

**Tech Stack:** OpenLayers 10.9.0, React 19 + TypeScript, Vitest + Testing Library.

**Reference:** [thuyloivietnam.vn](http://thuyloivietnam.vn/home#antoan), explored 2026-09-14. It runs OpenLayers **2.13.1** with `Graticule`, `MousePosition`, `ScaleLine`, `Scale`, `Measure`, `LoadingPanel` and `WMSGetFeatureInfo`. The controls are worth copying; the vintage is not.

---

## What the reference actually does

| Element | Their implementation | Ours today |
|---|---|---|
| Loading state | `olControlLoadingPanel` | **nothing** |
| Scale bar, bottom-left | dual bar, km over mi, degrades to m/ft | **nothing** |
| Cursor coordinates, bottom-right | `107.311255°E 12.923165°N` | **nothing** |
| Scale readout | `Scale = 1 : 136K` (abbreviated) | full `1:250.000` in the toolbar |
| Capture a coordinate | "Lấy tọa độ" tool | **nothing** |
| Graticule | lat/lon grid | **nothing** |
| Zoom to box | dedicated toolbar mode | **already works** — shift+drag |

Their scale-bar progression, measured:

| Their scale | km bar | mi bar |
|---|---|---|
| 1 : 9M | 100 km | 100 mi |
| 1 : 1M | 20 km | 10 mi |
| 1 : 136K | 2 km | 1 mi |
| 1 : 17K | 200 m | 1000 ft |

**Deliberately not copied:** the abbreviated `1 : 136K` scale (we snap to round denominators on purpose — abbreviating discards that), and the modal pan/zoom-box/info toolbar, which is a desktop-GIS idiom from 2010.

---

## Global Constraints

- **`controls: []` stays explicit.** [MapModel.ts:283](../../../apps/web/src/features/map/model/MapModel.ts#L283) passes an empty array today; add controls deliberately, never `defaults()`, or a second zoom widget and attribution appear unbidden.
- **Bottom-centre is taken** by `.map-toolbar`. Scale bar goes **bottom-left**, coordinates **bottom-right** — the convention Google, Leaflet, Esri and QGIS all share.
- **Do not add `ol/interaction/DragZoom`.** Verified already active via OL defaults: shift+drag moved zoom 7.001 → 9.424. Task 6 makes it discoverable, nothing more.
- **Coordinates in EPSG:4326**, longitude first, hemisphere suffix, matching the reference and Vietnamese survey convention.
- **Vietnamese UI copy**, matching existing `title=` strings.
- **No per-frame allocation in style functions** — `styles.ts` precomputes `Style` objects at module load and must keep doing so.
- Controls must not swallow map clicks: give every overlay `pointer-events: none` except its interactive parts, as `.map-toolbar` already does.

---

## File Structure

**Created:**
- `apps/web/src/features/map/model/mapReadouts.ts` — `formatLonLat`, `createScaleBar`, `createMousePosition`
- `apps/web/src/features/map/model/mapReadouts.test.ts`
- `apps/web/src/features/map/model/loadingState.ts` — `createLoadTracker`, pure counting
- `apps/web/src/features/map/model/loadingState.test.ts`
- `apps/web/src/features/map/ui/MapLoading.tsx` + `.test.tsx`

**Modified:**
- `apps/web/src/features/map/model/MapModel.ts` — register controls, graticule, load tracking
- `apps/web/src/features/map/model/styles.ts` — river widths
- `apps/web/src/features/map/model/styles.test.ts`
- `apps/web/src/features/map/ui/MapToolbar.tsx` + test — capture-coordinate button, zoom-box hint
- `apps/web/src/styles/main.css` — corner placement

---

### Task 1: Loading indicator

Highest value of the six: the "map renders very slowly" report is GWC rendering tiles on demand (0,012s cached vs 0,07–0,92s cold). The behaviour is normal; the *silence* is what makes it read as a fault.

**Files:**
- Create: `apps/web/src/features/map/model/loadingState.ts`, `loadingState.test.ts`
- Create: `apps/web/src/features/map/ui/MapLoading.tsx`, `MapLoading.test.tsx`
- Modify: `MapModel.ts`, `main.css`

**Interfaces:**
- Produces: `createLoadTracker(onChange: (pending: number) => void)` with `.start()`, `.done()`, `.reset()`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createLoadTracker } from './loadingState';

describe('createLoadTracker', () => {
  it('reports busy while loads are outstanding and idle when they finish', () => {
    const onChange = vi.fn();
    const t = createLoadTracker(onChange);
    t.start(); t.start();
    expect(onChange).toHaveBeenLastCalledWith(2);
    t.done();
    expect(onChange).toHaveBeenLastCalledWith(1);
    t.done();
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('never goes negative — a tile can error after its layer was removed', () => {
    // OL fires tileloadend/tileloaderror for requests already in flight when a
    // layer is torn down, so done() can outnumber start(). Going negative would
    // wedge the spinner permanently off.
    const onChange = vi.fn();
    const t = createLoadTracker(onChange);
    t.done(); t.done();
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('reset clears a stuck count', () => {
    const onChange = vi.fn();
    const t = createLoadTracker(onChange);
    t.start(); t.start(); t.reset();
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('does not re-notify when the count is unchanged', () => {
    const onChange = vi.fn();
    const t = createLoadTracker(onChange);
    t.done();
    t.done();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- loadingState`
Expected: FAIL — cannot resolve `./loadingState`.

- [ ] **Step 3: Write it**

```ts
/**
 * Đếm số yêu cầu tải đang treo (tile của GWC và feature của WFS).
 *
 * Vì sao cần: tile được GWC dựng THEO YÊU CẦU — đã có cache thì 0,012s, chưa có
 * thì 0,07–0,92s. Hành vi đó bình thường, nhưng vì không có dấu hiệu nào nên
 * người dùng thấy bản đồ mờ rồi nét và tưởng là hỏng.
 */
export function createLoadTracker(onChange: (pending: number) => void) {
  let pending = 0;
  const notify = (next: number) => {
    if (next === pending) return;
    pending = next;
    onChange(pending);
  };
  return {
    start: () => notify(pending + 1),
    // Không bao giờ xuống âm: OL vẫn bắn tileloadend/tileloaderror cho những yêu
    // cầu đang bay khi lớp bị gỡ, nên done() có thể nhiều hơn start(). Để âm thì
    // bộ đếm kẹt dưới 0 và vòng quay không bao giờ hiện lại.
    done: () => notify(Math.max(0, pending - 1)),
    reset: () => notify(0),
    get pending() { return pending; },
  };
}
```

- [ ] **Step 4: Wire the sources in MapModel**

For each context tile layer and each WFS vector source:

```ts
    const loadTracker = createLoadTracker((n) => this.onLoadingChange?.(n));
    this.loadTracker = loadTracker;

    for (const { stateId } of CONTEXT_LAYERS) {
      const src = this.contextLayers[stateId].getSource();
      src?.on('tileloadstart', () => loadTracker.start());
      src?.on('tileloadend', () => loadTracker.done());
      src?.on('tileloaderror', () => loadTracker.done());
    }
```

Expose `setLoadingListener(fn: (pending: number) => void)` on `MapModel`, and call `loadTracker.reset()` in `dispose()`.

- [ ] **Step 5: The view**

`MapLoading.tsx` — a passive view, visible only when `pending > 0`:

```tsx
export function MapLoadingView({ pending }: { pending: number }) {
  if (pending <= 0) return null;
  return (
    <div className="map-loading glass-panel" role="status" aria-live="polite">
      <span className="map-loading-spinner" aria-hidden="true" />
      <span>Đang tải bản đồ…</span>
    </div>
  );
}
```

Render tests: hidden at 0, visible at 1, carries `role="status"`.

CSS — top-centre of the map area, clear of both bottom corners and the toolbar:

```css
.map-loading {
  position: absolute;
  top: calc(var(--topbar-height) + var(--space-3));
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 12px;
  pointer-events: none;
  font-size: 13px;
}
```

- [ ] **Step 6: Verify in the browser**

Truncate the cache (`bash apps/api/scripts/basemap/publish-basemap.sh`), reload, pan to a fresh area. The indicator must appear while tiles render and disappear when they settle. **If it never disappears**, the counter is leaking — check `tileloaderror` is wired.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/loadingState.ts apps/web/src/features/map/model/loadingState.test.ts apps/web/src/features/map/ui/MapLoading.tsx apps/web/src/features/map/ui/MapLoading.test.tsx apps/web/src/features/map/model/MapModel.ts apps/web/src/styles/main.css
git commit -m "feat(web): báo hiệu bản đồ đang tải"
```

---

### Task 2: Scale bar and cursor coordinates

One task: both are `ol/control`, both go in the free bottom corners, and they share the CSS work.

**Files:**
- Create: `apps/web/src/features/map/model/mapReadouts.ts`, `mapReadouts.test.ts`
- Modify: `MapModel.ts`, `main.css`

**Interfaces:**
- Produces: `formatLonLat(coord: number[]): string`, `createScaleBar()`, `createMousePosition()`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { formatLonLat } from './mapReadouts';

describe('formatLonLat', () => {
  it('prints longitude first with hemisphere suffixes, like the reference atlas', () => {
    expect(formatLonLat([108.044712, 12.679734])).toBe('108.044712°E  12.679734°N');
  });

  it('uses six decimals — enough to name a point, stable enough to copy', () => {
    expect(formatLonLat([108.1, 12.2])).toBe('108.100000°E  12.200000°N');
  });

  it('uses W and S below zero rather than a minus sign', () => {
    expect(formatLonLat([-58.38, -34.6])).toBe('58.380000°W  34.600000°S');
  });

  it('survives a coordinate the map has not produced yet', () => {
    expect(formatLonLat([])).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- mapReadouts`
Expected: FAIL — cannot resolve `./mapReadouts`.

- [ ] **Step 3: Write it**

```ts
import ScaleLine from 'ol/control/ScaleLine';
import MousePosition from 'ol/control/MousePosition';

/** Số chữ số thập phân cho toạ độ hiển thị. Sáu chữ số ~ 0,1 m: thừa so với độ
 *  chính xác dữ liệu, nhưng ổn định và dễ chép lại — giống bản đồ tham chiếu. */
const COORD_DECIMALS = 6;

/**
 * Toạ độ kiểu bản đồ: KINH ĐỘ TRƯỚC, bán cầu là hậu tố chữ chứ không phải dấu âm.
 * Quy ước này khớp với thuyloivietnam.vn và với cách đọc toạ độ trong ngành.
 */
export function formatLonLat(coord: number[]): string {
  if (!coord || coord.length < 2) return '';
  const [lon, lat] = coord;
  const ew = lon >= 0 ? 'E' : 'W';
  const ns = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lon).toFixed(COORD_DECIMALS)}°${ew}  ${Math.abs(lat).toFixed(COORD_DECIMALS)}°${ns}`;
}

/** Thanh tỷ lệ góc dưới trái. `bar` + `text` cho ra thanh có vạch kèm số, và OL
 *  tự đổi đơn vị xuống m khi phóng gần — đúng như bản đồ tham chiếu làm. */
export function createScaleBar(): ScaleLine {
  return new ScaleLine({ units: 'metric', bar: true, steps: 2, text: true, minWidth: 90, className: 'map-scaleline' });
}

export function createMousePosition(): MousePosition {
  return new MousePosition({
    projection: 'EPSG:4326',
    coordinateFormat: formatLonLat,
    className: 'map-mouseposition',
    placeholder: '',
  });
}
```

- [ ] **Step 4: Register them**

In `MapModel.ts`, replace `controls: []` with:

```ts
      // Giữ danh sách TƯỜNG MINH, không dùng defaults(): defaults() kèm nút zoom
      // và ô ghi công, chồng lên thanh công cụ và góc dưới phải của chính ta.
      controls: [createScaleBar(), createMousePosition()],
```

- [ ] **Step 5: Place them in the free corners**

```css
/* Thanh công cụ chiếm giữa cạnh dưới, nên hai góc còn trống — đúng chỗ quy ước
   đặt thanh tỷ lệ (trái) và toạ độ con trỏ (phải). */
.map-scaleline {
  position: absolute;
  left: var(--space-3);
  bottom: var(--space-3);
  z-index: 20;
  pointer-events: none;
}

.map-mouseposition {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: 20;
  font-size: 12px;
  font-variant-numeric: tabular-nums; /* số không nhảy ngang khi con trỏ di chuyển */
  pointer-events: none;
}
```

- [ ] **Step 6: Verify**

```bash
npm run test -w @webatlas/web -- mapReadouts
npm run test -w @webatlas/web
npm run build:web
```

Then in the browser: the bar must sit bottom-left and change with zoom; the coordinates must update on cursor move and read `108.044712°E  12.679734°N`. Confirm neither overlaps `.map-toolbar` at 768px width with the flyout open.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/mapReadouts.ts apps/web/src/features/map/model/mapReadouts.test.ts apps/web/src/features/map/model/MapModel.ts apps/web/src/styles/main.css
git commit -m "feat(web): thanh tỷ lệ góc dưới trái và toạ độ con trỏ góc dưới phải"
```

---

### Task 3: River line weight

The thing you actually noticed. At 1:1.000.000 the reference draws rivers as pale **1px hairlines with no casing**; ours draws a 7px navy casing under a 3,5px core.

**Files:**
- Modify: `apps/web/src/features/map/model/styles.ts`, `styles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { RIVER_WIDTHS_FOR_TEST } from './styles';

describe('river line weight', () => {
  it('keeps the main trunk close to a reference hairline, not a ribbon', () => {
    // thuyloivietnam.vn draws rivers ~1px with no casing at 1:1.000.000. A 7px
    // dark casing is what made ours read as a ribbon rather than a line.
    const [casing, core] = RIVER_WIDTHS_FOR_TEST[3];
    expect(core).toBeLessThanOrEqual(2);
    expect(casing).toBeLessThanOrEqual(3.5);
  });

  it('still separates the four tiers by width', () => {
    const w = RIVER_WIDTHS_FOR_TEST;
    expect(w[3][1]).toBeGreaterThan(w[2][1]);
    expect(w[2][1]).toBeGreaterThan(w[1][1]);
    expect(w[1][1]).toBeGreaterThan(w[0][1]);
  });

  it('drops the casing on the two thinnest tiers, where it only muddies the line', () => {
    expect(RIVER_WIDTHS_FOR_TEST[1][0]).toBe(0);
    expect(RIVER_WIDTHS_FOR_TEST[0][0]).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- styles`
Expected: FAIL — `RIVER_WIDTHS_FOR_TEST` not exported; current bucket 3 is `[7, 3.5]`.

- [ ] **Step 3: Reweight**

In `styles.ts`:

```ts
// Bucket -> [độ rộng viền, độ rộng lõi]. Viền 0 nghĩa là KHÔNG vẽ viền.
//
// Hạ từ [7, 3.5] xuống sau khi so với thuyloivietnam.vn: ở 1:1.000.000 họ vẽ sông
// bằng nét mảnh ~1px KHÔNG viền, phân biệt sông với đường bằng MÀU chứ không phải
// độ dày. Viền tối mới là thứ biến nét thành dải băng, nặng hơn cả bề rộng.
const RIVER_WIDTHS: Record<number, [number, number]> = {
  3: [3, 1.6],   // sông chính
  2: [2.2, 1.1], // kênh đào
  1: [0, 0.9],   // suối — không viền
  0: [0, 0.6],   // mương / không xác định — không viền
};

/** Chỉ dành cho kiểm thử: khoá độ dày khỏi trôi ngược về mức quá nặng. */
export const RIVER_WIDTHS_FOR_TEST = RIVER_WIDTHS;
```

Update the precompute so a zero casing emits only the core style:

```ts
const RIVER_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    const core = new Style({ stroke: new Stroke({ color: LAYER_PALETTE.layer_rivers.color, width: mainWidth }) });
    if (borderWidth === 0) return [b, [core]];
    return [b, [new Style({ stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) }), core]];
  })
);
```

**Check the existing tests before running:** `styles.test.ts` has a `widthOf` helper that reads `styles![1]` — the core stroke — which is now index 0 for buckets 0 and 1. Fix it to read the last element (`styles![styles!.length - 1]`), which is the core in both shapes.

- [ ] **Step 4: Verify**

```bash
npm run test -w @webatlas/web -- styles
npm run test -w @webatlas/web
npm run build:web
```

- [ ] **Step 5: Look at it**

Compare at 1:1.000.000 against `scratchpad/tl-z3.png`. Rivers should read as a network, not as ribbons. **This is a judgement call — if it now looks too faint, raise the core, not the casing.**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/styles.ts apps/web/src/features/map/model/styles.test.ts
git commit -m "fix(web): nét sông mảnh lại, bỏ viền ở hai bậc nhỏ nhất"
```

---

### Task 4: Capture a coordinate

Their "Lấy tọa độ". Distinct from the hover readout: it captures a point so it can be copied — the useful form for reporting a station or dam location.

**Files:**
- Modify: `MapToolbar.tsx` + test, `DynamicPopup.tsx` or a small popover, `main.css`

**Interfaces:**
- Consumes: `formatLonLat` from Task 2.

- [ ] **Step 1: Write the failing view test**

```ts
it('offers a coordinate-capture mode', async () => {
  const onMeasure = vi.fn();
  render(<MapToolbarView {...base} onMeasure={onMeasure} />);
  await userEvent.click(screen.getByRole('button', { name: 'Lấy toạ độ' }));
  expect(onMeasure).toHaveBeenCalledWith('coordinate');
});

it('shows the captured coordinate with a copy affordance', () => {
  render(<MapToolbarView {...base} measureMode="coordinate" measureValue="108.044712°E  12.679734°N" />);
  expect(screen.getByText('108.044712°E  12.679734°N')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- MapToolbar`
Expected: FAIL — no button named `Lấy toạ độ`.

- [ ] **Step 3: Extend the measure mode**

`MeasureMode` in `useMeasure.ts` gains `'coordinate'`. On a single click in that mode, format the clicked coordinate with `formatLonLat` and put it in `measure.value`, which the toolbar already renders through `.measure-result`. Reuse that path rather than adding a second readout.

Add the button beside the ruler and square, `title="Lấy toạ độ"`, using the `Crosshair` icon from lucide-react.

- [ ] **Step 4: Add copy-to-clipboard**

Wrap `.measure-result` content in a button when the mode is `coordinate`:

```tsx
<button className="measure-copy" onClick={() => navigator.clipboard?.writeText(measureValue)} title="Chép toạ độ">
  {measureValue}
</button>
```

`navigator.clipboard` is undefined in insecure contexts and in jsdom, hence the optional call — the readout must still render without it.

- [ ] **Step 5: Verify and commit**

```bash
npm run test -w @webatlas/web && npm run build:web
git add apps/web/src/features/map apps/web/src/styles/main.css
git commit -m "feat(web): công cụ lấy toạ độ một điểm"
```

---

### Task 5: Graticule

**Files:**
- Modify: `MapModel.ts`

- [ ] **Step 1: Add the layer**

```ts
import Graticule from 'ol/layer/Graticule';
```

```ts
    // Lưới kinh vĩ — quy ước của bản đồ kỹ thuật, và là thứ duy nhất cho biết
    // hướng khi thu nhỏ hết cỡ. Nhạt để không tranh chấp với dữ liệu chuyên đề.
    const graticule = new Graticule({
      strokeStyle: new Stroke({ color: 'rgba(70,90,120,0.25)', width: 1, lineDash: [2, 4] }),
      showLabels: true,
      wrapX: false,
      properties: { id: 'layer_graticule' },
    });
```

Add it **below** the vector layers and above the basemap in the layer array.

- [ ] **Step 2: Verify**

```bash
npm run test -w @webatlas/web && npm run build:web
```

In the browser at 1:12.800.000 the grid and its labels should be visible but recessive. If it competes with the data, lower the stroke alpha — do not remove the labels, which are the useful part.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/map/model/MapModel.ts
git commit -m "feat(web): lưới kinh vĩ mờ trên bản đồ"
```

---

### Task 6: Make zoom-to-box discoverable

**Not a feature — it already works.** Verified: shift+drag moved zoom 7.001 → 9.424, because `DragZoom` ships in OL's default interactions and `MapModel` never overrides `interactions`. Nobody knows it is there.

**Files:**
- Modify: `MapToolbar.tsx` + test

- [ ] **Step 1: Write the failing test**

```ts
it('tells the user about shift+drag zoom, which already works but is invisible', () => {
  render(<MapToolbarView {...base} />);
  expect(screen.getByRole('button', { name: 'Phóng to' })).toHaveAttribute(
    'title',
    expect.stringContaining('Shift'),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- MapToolbar`
Expected: FAIL — the title is exactly `Phóng to`.

- [ ] **Step 3: Extend the tooltip**

```tsx
title="Phóng to (giữ Shift rồi kéo để phóng vào một vùng)"
```

Keep `aria-label="Phóng to"` so the accessible name — which the other tests match on — does not change.

- [ ] **Step 4: Verify and commit**

```bash
npm run test -w @webatlas/web
git add apps/web/src/features/map/ui/MapToolbar.tsx apps/web/src/features/map/ui/MapToolbar.test.tsx
git commit -m "docs(web): chỉ ra thao tác Shift+kéo để phóng vào một vùng"
```

---

## Self-Review

**Coverage of what the exploration found:**

| Finding | Task |
|---|---|
| Loading panel | 1 |
| Scale bar bottom-left, dual units | 2 |
| Cursor coordinates bottom-right | 2 |
| River lines far too heavy | 3 |
| "Lấy tọa độ" capture tool | 4 |
| Graticule | 5 |
| Zoom to box | 6 — already works, only surfaced |
| Abbreviated `1 : 136K` scale | **deliberately not copied** |
| Modal pan/zoom/info toolbar | **deliberately not copied** |

**Ordering rationale:** Task 1 first because it addresses a defect you reported. Task 3 is independent and could go first if the river weight bothers you more. Task 4 depends on Task 2's `formatLonLat`. Tasks 5 and 6 are trivial and can go any time.

**Known risk:** Task 3 changes how every river looks at every zoom, and "right" is a judgement call. The tests pin the *direction* (thinner, no casing on small tiers) and the tier ordering, not the exact values — those should be eyeballed against the reference screenshot at Step 5.

**Open question the plan does not settle:** ODbL attribution currently lives in the **Legend panel**, not on the map. Convention puts attribution bottom-right, which Task 2 now occupies with coordinates. Not a conflict today, but if attribution ever moves onto the map it will need somewhere to go.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-14-map-readouts-and-legibility.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute in this session with checkpoints.
