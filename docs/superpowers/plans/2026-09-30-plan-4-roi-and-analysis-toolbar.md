# Region of Interest and the Analysis Toolbar — Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the region of interest (*vùng phân tích*) a first-class object — one active ROI, resolved on the server, shown in a chip above the toolbar — and rebuild the analysis toolbar around it.

**Architecture:** A shared `Roi` type describes an ROI by reference (a drawing, a feature, a basemap entity or an admin unit, plus an optional radius). One API function, `resolveRoi`, is the only code that turns an ROI into geometry; `POST /api/roi/resolve` exposes it to the browser and every analysis operation calls it first. The web app keeps the one active ROI in a module store, draws it on its own map layer, and enables each tool from a pure availability function of the resolved ROI.

**Tech Stack:** PostgreSQL 16 / PostGIS 3.4, Fastify + `pg` + zod (v3 API) in `apps/api`, React 19 + OpenLayers + vitest/testing-library in `apps/web`, the dependency-free `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-09-30-roi-analysis-toolbar-design.md` (committed `bebe1a8`). Section numbers below (§8, FR-7, U-11, D12 …) refer to it.

**Branch:** `feat/roi-toolbar`, cut from `main` at `bebe1a8` or later.

## Global Constraints

- **All interface text is Vietnamese**, and the ROI is always called **"vùng phân tích"** (NFR-5). Toolbar groups are exactly **Đo nhanh · Vẽ · Vùng · Tuyến · Lân cận** (U-10).
- **One active ROI** (D1). Setting a new one replaces it; a failed resolve keeps the previous one (FR-14).
- **`resolveRoi` is the only code that turns an ROI into geometry** (§10). No operation reads `geometry`/`feature`/`reference` inputs any other way once Task 4 lands.
- **Limits, applied by `resolveRoi` to every source** (NFR-2): source vertices ≤ 10,000 and parts ≤ 300 before any buffer; resulting area ≤ 25,000 km²; the result clipped to the six working provinces; the resulting vertex count ≤ 5,000 **except for admin units** (see Measured Baselines). Elevation statistics keeps its own 5,000 km² ceiling.
- **Rivers mean level 1** in every collection query: use `entityPredicate(key)` from `apps/api/src/modules/assistant/tools/data/helpers.ts` (merged in `0dd5e19`).
- **Analysis endpoints stay public**, on the analysis pool, in a read-only transaction with the 5-second statement timeout (`withAnalysisTimeout`) (NFR-3).
- **`apps/api` has no typecheck script**: run `npx tsc --noEmit -p .` inside `apps/api` before every commit that touches it.
- **`packages/shared` ships built `dist/` in git.** After editing `packages/shared/src`, run `npm run build:shared` and commit `dist`. A **new** source file's outputs must be added with `git add -f` (the repo's `.gitignore` has a blanket `dist` rule; plain `git add` silently skips new files).
- **`apps/web`:** `npm run build:web` (it runs `tsc -b`) before committing — vitest does not typecheck.
- **Tests run against the live development database** (Docker `webatlas-db-1`), as every existing API suite does.
- **Commit messages in Vietnamese**, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Measured Baselines

Measured on 2026-09-30 against the development database; the numbers the tests pin come from here.

| Quantity | Measured |
|---|---|
| Largest level-1 river | 3,811 vertices, 2 parts (Sông Krông Búk) — under both source limits |
| Level-1 rivers over a source limit | 0 of 588 |
| A river + 5 km radius | *fewer* vertices than the river: Krông Búk 3,811 → 387 |
| Largest province geometry | 5,195 vertices, 164 parts (Khánh Hoà, islands) — **over the 5,000 resulting-vertex cap**, hence the admin exemption |
| Largest ward geometry | 2,253 vertices, 140 parts |
| Province areas | Lâm Đồng 24,246 km² · Gia Lai 21,581 · Đắk Lắk 18,086 · Quảng Ngãi 14,807 · Khánh Hoà 12,292 · Đà Nẵng 12,186 |
| Largest ward | 4,208 km² (so elevation statistics fits every ward) |
| Wards in the working region | 616 |
| `select_within`, geometric, over Lâm Đồng (four layers, after `0dd5e19`) | 5.2 s cold, 2.2 s warm — over budget cold, hence the stamped-code path (Task 5) |
| Union of the six provinces (the clip) | ~80–110 ms per call |
| Rivers stamped into Đắk Lắk (province `66`) | 142 level-1 |
| `GetFeatureInfo` feature id | `<table>.<fid>` (e.g. `roads_region.fid-…`), `osm_id` as a string |
| `reference_entities.member_ids` | `text[]` of OSM ids; no index before Task 7 |

## Deviations From the Spec

1. **`buffer` now accepts a line or point reference without its own radius** and buffers the line itself. Before, `referenceGeometry`'s "want an area" branch refused it. The spec keeps `buffer`'s HTTP body and says nothing changes, but that refusal belonged to the `inputGeometry` path the spec retires (§10); keeping it would need a second code path. The test that pinned it is moved to `select_within`, which genuinely needs an area (Task 4).
2. **Drawn shapes are now clipped to the working region**, like every other source (NFR-2). A drawing entirely outside the six provinces is refused with "nằm ngoài vùng công tác".
3. **`geometryInput` moves to its own module** (`apps/api/src/modules/analysis/geometryInput.ts`) so the ROI schema and the analysis schemas can both import it without a module cycle.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/shared/src/roi.ts` (+ `.test.ts`) | The `Roi` / `ResolvedRoi` contract, `REFERENCE_LAYER_KEYS`, `withRadius` |
| `apps/api/src/modules/analysis/geometryInput.ts` | `MAX_INPUT_VERTICES` and the zod geometry validator, shared by both schema modules |
| `apps/api/src/modules/roi/schema.ts` | `RoiSchema` (zod) |
| `apps/api/src/modules/roi/resolve.ts` (+ `.test.ts`) | `resolveRoi` — the only ROI → geometry code |
| `apps/api/src/modules/roi/kind.ts` | `requireArea` / `requireLine` — each operation's kind check and its message |
| `apps/api/src/modules/roi/fromParts.ts` | `roiFromParts` — the pre-ROI input families (buffer's body, assistant tools) as an `Roi` |
| `apps/api/src/modules/roi/controller.ts`, `routes.ts`, `roi.test.ts` | `POST /api/roi/resolve` |
| `apps/api/src/db/migrations/1000000000021_reference-member-index.cjs` | GIN index on `reference_entities.member_ids` |
| `apps/web/src/features/roi/api/roi.api.ts` | `resolveRoi`, `fetchEntitiesByMember` |
| `apps/web/src/features/roi/model/roi.store.ts` (+ test) | The one active ROI |
| `apps/web/src/features/roi/model/toolAvailability.ts` (+ test) | §8's availability table |
| `apps/web/src/features/roi/model/format.ts` (+ test) | Vietnamese number/unit formatting |
| `apps/web/src/features/roi/model/candidates.ts` (+ test) | The popup's "Dùng làm vùng phân tích" candidates |
| `apps/web/src/features/roi/ui/RoiChip.view.tsx` (+ test), `RoiChip.tsx` | The chip (U-3, U-4) |
| `apps/web/src/features/roi/ui/RoiDrawButtons.tsx` (+ test) | The Vẽ group and the draw lifecycle |
| `apps/web/src/features/roi/ui/UseAsRoiButton.tsx`, `RoiCandidates.view.tsx` (+ test) | The shared action and the popup section |
| `apps/web/src/features/map/model/roiLayer.ts` (+ test) | The ROI's own map layer (U-7) |
| `apps/web/src/features/map/model/drawingState.ts` | "A drawing is in progress" flag the popup reads |
| `apps/web/src/features/map/model/drawAids.ts` (+ test) | U-11's drawing aids |

**Modified:** `apps/api/src/reference/registry.ts`, `apps/api/src/modules/analysis/{area,schemas}.ts`, the five `ops/*.ts`, `apps/api/src/modules/assistant/tools/data/{selectWithin,zonalElevation,elevationProfile}.ts`, `apps/api/src/modules/search/{repository,controller}.ts`, `apps/api/src/modules/reference/{repository,controller}.ts`, `apps/api/src/server.ts`, `packages/shared/src/{index,map-commands}.ts`, and in `apps/web`: `features/analysis/**`, `features/map/{model/mapCommands.ts,model/analysisDraw.ts (renamed roiDraw.ts in Task 11),model/useMeasure.ts,model/basemapInfo.ts,ui/MapToolbar.tsx}`, `features/search/**`, `components/DynamicPopup.tsx`, `app/App.tsx`, `styles/main.css`.

**Deleted:** `apps/web/src/features/map/model/lastShape.ts`.

---

### Task 1: The shared ROI contract

**Files:**
- Create: `packages/shared/src/roi.ts`, `packages/shared/src/roi.test.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/reference/registry.ts:15-19`

**Interfaces:**
- Produces (from `@webatlas/shared`): `REFERENCE_LAYER_KEYS`, `ReferenceLayerKey`, `ROI_MAX_RADIUS_KM` (100), `RoiKind`, `AdminLevel`, `DrawnRoiGeometry`, `Roi`, `RoiMeasure`, `ResolvedRoi`, `withRadius(roi, km | null): Roi`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/roi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REFERENCE_LAYER_KEYS, withRadius, type Roi } from './roi.js';

describe('withRadius', () => {
  const river: Roi = { source: 'feature', layerKey: 'rivers', featureId: 'f', whole: true };

  it('sets a radius', () => {
    expect(withRadius(river, 5)).toEqual({ ...river, radiusKm: 5 });
  });

  it('removes a radius, returning the original line or point', () => {
    expect(withRadius({ ...river, radiusKm: 5 }, null)).toEqual(river);
  });

  it('never gives an admin unit a radius: it is already an area', () => {
    const province: Roi = { source: 'admin', level: 'province', code: '66' };
    expect(withRadius(province, 5)).toBe(province);
  });
});

describe('REFERENCE_LAYER_KEYS', () => {
  it('lists the five basemap reference layers', () => {
    expect(REFERENCE_LAYER_KEYS).toEqual(['roads', 'railways', 'water', 'landuse', 'places']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/shared -- roi`
Expected: FAIL — `Failed to resolve import "./roi.js"`.

- [ ] **Step 3: Write the contract**

Create `packages/shared/src/roi.ts`:

```ts
/**
 * The region of interest (vùng phân tích): the one input every analysis tool takes
 * (docs/superpowers/specs/2026-09-30-roi-analysis-toolbar-design.md §9). The browser
 * holds an Roi — a reference, never geometry — and the server resolves it through
 * POST /api/roi/resolve, which is also what every analysis operation calls first.
 */
import type { EditableLayerKey } from './index.js';
import type { GeoJsonGeometry } from './geometry.js';

/** The basemap reference layers. apps/api/src/reference/registry.ts re-exports these. */
export const REFERENCE_LAYER_KEYS = ['roads', 'railways', 'water', 'landuse', 'places'] as const;
export type ReferenceLayerKey = (typeof REFERENCE_LAYER_KEYS)[number];

export const ROI_MAX_RADIUS_KM = 100;

export type RoiKind = 'area' | 'line' | 'point';
export type AdminLevel = 'province' | 'ward';
export type DrawnRoiGeometry = Extract<GeoJsonGeometry, { type: 'Point' | 'LineString' | 'Polygon' }>;

export type Roi =
  | { source: 'drawn'; geometry: DrawnRoiGeometry; radiusKm?: number }
  /** `whole: true` on a river way means the level-1 river it belongs to (FR-13). */
  | { source: 'feature'; layerKey: EditableLayerKey; featureId: string; whole?: true; radiusKm?: number }
  | { source: 'reference'; referenceLayer: ReferenceLayerKey; entityId: string; radiusKm?: number }
  /** Never a radius: an admin unit is already an area (FR-4). */
  | { source: 'admin'; level: AdminLevel; code: string };

export type RoiMeasure = { areaKm2: number } | { lengthKm: number } | null;

export interface ResolvedRoi {
  /** "Sông Thu Bồn + 5 km", "Tỉnh Đắk Lắk", "Hình vẽ". */
  label: string;
  /** After the radius is applied. */
  kind: RoiKind;
  measure: RoiMeasure;
  /** Simplified, for drawing only. */
  display: GeoJsonGeometry;
  /** [west, south, east, north], EPSG:4326. */
  bbox: [number, number, number, number];
  /** [lon, lat] — what Gần nhất measures from (D12). */
  centroid: [number, number];
}

/**
 * `roi` with its radius set (a number) or removed (null). An admin unit is returned
 * unchanged: it is already an area and never carries a radius.
 */
export function withRadius(roi: Roi, radiusKm: number | null): Roi {
  if (roi.source === 'admin') return roi;
  const { radiusKm: _previous, ...rest } = roi;
  void _previous;
  return (radiusKm === null ? rest : { ...rest, radiusKm }) as Roi;
}
```

Add to `packages/shared/src/index.ts`, after `export * from './analysis.js';`:

```ts
export * from './roi.js';
```

- [ ] **Step 4: Point the API registry at the shared list**

In `apps/api/src/reference/registry.ts`, replace

```ts
export const REFERENCE_LAYER_KEYS = ['roads', 'railways', 'water', 'landuse', 'places'] as const;
export type ReferenceLayerKey = (typeof REFERENCE_LAYER_KEYS)[number];
```

with

```ts
// Defined in @webatlas/shared since Phase 4, so the browser's Roi type and this
// registry cannot drift apart; re-exported so existing imports keep working.
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '@webatlas/shared';
export { REFERENCE_LAYER_KEYS };
export type { ReferenceLayerKey };
```

(The `import` may stay mid-file: ES modules hoist it. If the linter objects, move the line under the existing `import { NotFoundError } …` line.)

- [ ] **Step 5: Run the tests and build**

Run: `npm run test -w @webatlas/shared` → all pass, including the 4 new tests.
Run: `npm run build:shared` → exit 0.
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.
Run: `npm run test -w @webatlas/api -- src/modules/reference` → pass (unchanged behaviour).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/roi.ts packages/shared/src/roi.test.ts packages/shared/src/index.ts \
        apps/api/src/reference/registry.ts packages/shared/dist
git add -f packages/shared/dist/roi.js packages/shared/dist/roi.d.ts
git commit -m "feat(shared): hợp đồng vùng phân tích (Roi, ResolvedRoi)

REFERENCE_LAYER_KEYS chuyển sang @webatlas/shared để kiểu Roi của trình duyệt và
sổ đăng ký lớp tham chiếu của API không thể lệch nhau.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `resolveRoi` — the only ROI → geometry code

**Files:**
- Create: `apps/api/src/modules/analysis/geometryInput.ts`, `apps/api/src/modules/roi/schema.ts`, `apps/api/src/modules/roi/resolve.ts`, `apps/api/src/modules/roi/resolve.test.ts`
- Modify: `apps/api/src/modules/analysis/schemas.ts:1-27`, `apps/api/src/modules/analysis/area.ts:71-74`

**Interfaces:**
- Consumes: Task 1's `Roi`, `ResolvedRoi`; `resolveFeature`, `candidateCtes`, `Queryable` from `assistant/tools/data/helpers.ts`; the limits in `analysis/area.ts`.
- Produces:
  - `MAX_INPUT_VERTICES`, `geometryInput(types)` from `analysis/geometryInput.ts` (re-exported by `analysis/schemas.ts`);
  - `REGION_SQL` exported from `analysis/area.ts`;
  - `RoiSchema` from `roi/schema.ts`;
  - `resolveRoi(db: Queryable, roi: Roi): Promise<RoiResolution>` where
    `RoiResolution = { resolved: ResolvedRoi; geojson: string; facts: RoiFacts }` and
    `RoiFacts = { admin?: { level: AdminLevel; code: string }; feature?: { layerKey: EditableLayerKey; featureId: string } }`.

- [ ] **Step 1: Move the geometry validator to a leaf module**

Create `apps/api/src/modules/analysis/geometryInput.ts`:

```ts
import { z } from 'zod';
import { countVertices, isGeoJsonGeometry, positionsOf, type GeoJsonGeometry } from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';

/** The resulting ROI's vertex ceiling (area.ts explains why admin units are exempt). */
export const MAX_INPUT_VERTICES = 5000;

type GeometryType = GeoJsonGeometry['type'];

/**
 * A GeoJSON geometry of one of `types`, within MAX_INPUT_VERTICES, inside Vietnam.
 * Its own module so roi/schema.ts and analysis/schemas.ts can both use it without
 * importing each other.
 */
export function geometryInput(types: GeometryType[]) {
  return z.custom<GeoJsonGeometry>(
    (v) =>
      isGeoJsonGeometry(v) &&
      types.includes(v.type) &&
      countVertices(v) <= MAX_INPUT_VERTICES &&
      positionsOf(v).every(([lon, lat]) => inVietnam(lon, lat)),
    { message: `Hình không hợp lệ: cần ${types.join('/')}, tối đa ${MAX_INPUT_VERTICES} điểm, nằm trong Việt Nam` }
  );
}
```

In `apps/api/src/modules/analysis/schemas.ts`, replace everything from the first line through the closing `}` of `function geometryInput` (lines 1–27) with:

```ts
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, type GeoJsonGeometry } from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';
import { REFERENCE_LAYER_KEYS } from '../../reference/registry';
import { MAX_INPUT_VERTICES, geometryInput } from './geometryInput';

export { MAX_INPUT_VERTICES };

type GeometryType = GeoJsonGeometry['type'];
const ALL_TYPES: GeometryType[] = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
```

In `apps/api/src/modules/analysis/area.ts`, export the region SQL (line 72): change `const REGION_SQL = \`` to `export const REGION_SQL = \``.

Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0 (a pure move).

- [ ] **Step 2: Write the ROI schema**

Create `apps/api/src/modules/roi/schema.ts`:

```ts
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, REFERENCE_LAYER_KEYS, ROI_MAX_RADIUS_KM } from '@webatlas/shared';
import { geometryInput } from '../analysis/geometryInput';

const radiusKm = z
  .number()
  .gt(0, 'Bán kính phải lớn hơn 0')
  .max(ROI_MAX_RADIUS_KM, `Bán kính tối đa ${ROI_MAX_RADIUS_KM} km`);

/**
 * The wire form of @webatlas/shared's Roi (spec §9). `.strict()` on every member, so
 * an unknown field — notably a radius on an admin unit — is a 400, not silently dropped.
 */
export const RoiSchema = z
  .discriminatedUnion('source', [
    z.object({
      source: z.literal('drawn'),
      geometry: geometryInput(['Point', 'LineString', 'Polygon']),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('feature'),
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
      whole: z.literal(true).optional(),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('reference'),
      referenceLayer: z.enum(REFERENCE_LAYER_KEYS),
      entityId: z.string().min(1, 'Thiếu mã thực thể'),
      radiusKm: radiusKm.optional(),
    }).strict(),
    z.object({
      source: z.literal('admin'),
      level: z.enum(['province', 'ward']),
      code: z.string().regex(/^\d{1,6}$/, 'Mã đơn vị hành chính không hợp lệ'),
    }).strict(),
  ])
  .refine((r) => r.source !== 'feature' || r.whole === undefined || r.layerKey === 'rivers', {
    message: '"Cả sông" (whole) chỉ áp dụng cho lớp sông',
    path: ['whole'],
  });
```

- [ ] **Step 3: Write the failing tests**

Create `apps/api/src/modules/roi/resolve.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Roi } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { NotFoundError, ValidationError } from '../../errors';
import { resolveRoi } from './resolve';

let damId: string;
let damName: string | null;
let lakeId: string;
let namedWay: { id: string; name: string };
let orphanWay: { id: string; name: string };
let roadEntityId: string;

beforeAll(async () => {
  const pool = getPool();
  ({ rows: [{ id: damId, name: damName }] } = await pool.query(
    `SELECT id::text, name FROM water.dams_active WHERE province_codes && ARRAY['66'] ORDER BY name LIMIT 1`
  ));
  ({ rows: [{ id: lakeId }] } = await pool.query(
    `SELECT id::text FROM water.lakes_active WHERE province_codes && ARRAY['66'] ORDER BY area_km2 DESC NULLS LAST LIMIT 1`
  ));
  // A way of Sông Thu Bồn: its level-1 river is what `whole` must return.
  ({ rows: [namedWay] } = await pool.query(
    `SELECT id::text, name FROM water.rivers_active
      WHERE feature_level = 3 AND name = 'Sông Thu Bồn' AND parent_external_id IS NOT NULL
      ORDER BY external_id LIMIT 1`
  ));
  // A named way whose name matched no reach (Phase 3, Deviation 3): it has no river.
  ({ rows: [orphanWay] } = await pool.query(
    `SELECT id::text, name FROM water.rivers_active
      WHERE feature_level = 3 AND name IS NOT NULL AND parent_external_id IS NULL
      ORDER BY external_id LIMIT 1`
  ));
  ({ rows: [{ entity_id: roadEntityId }] } = await pool.query(
    `SELECT entity_id FROM basemap.reference_entities
      WHERE layer_key = 'roads' AND member_count BETWEEN 2 AND 20
      ORDER BY member_count ASC, entity_id LIMIT 1`
  ));
});
afterAll(async () => { await closePool(); });

const resolve = (roi: Roi) => resolveRoi(getPool(), roi);
const square = (lon: number, lat: number, d: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
});

describe('resolveRoi — drawn', () => {
  it('resolves a polygon to an area with its km², label and centroid', async () => {
    const r = await resolve({ source: 'drawn', geometry: square(108.05, 12.68, 0.02) });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Hình vẽ');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(18);
    expect(areaKm2).toBeLessThan(20);
    expect(r.resolved.centroid[0]).toBeCloseTo(108.05, 2);
    expect(r.resolved.centroid[1]).toBeCloseTo(12.68, 2);
    expect(r.resolved.bbox[0]).toBeLessThan(r.resolved.bbox[2]);
  });

  it('turns a point plus a radius into an area of about π r²', async () => {
    const r = await resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, radiusKm: 1 });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Hình vẽ + 1 km');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(3.0);
    expect(areaKm2).toBeLessThan(3.2);
  });

  it('measures a line in km', async () => {
    const r = await resolve({ source: 'drawn', geometry: { type: 'LineString', coordinates: [[108.05, 12.68], [108.25, 12.68]] } });
    expect(r.resolved.kind).toBe('line');
    const { lengthKm } = r.resolved.measure as { lengthKm: number };
    expect(lengthKm).toBeGreaterThan(21);
    expect(lengthKm).toBeLessThan(22.5);
  });

  it('refuses a drawing entirely outside the working region', async () => {
    // Hà Nội: inside Vietnam, outside the six provinces.
    await expect(resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [105.85, 21.03] } }))
      .rejects.toThrow(/ngoài vùng công tác/);
  });

  it('refuses a result over the area limit, quoting both figures', async () => {
    // 100 km around this point in Gia Lai clips to ~30,257 km² (measured 2026-09-30).
    const run = resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [108.4, 13.6] }, radiusKm: 100 });
    await expect(run).rejects.toBeInstanceOf(ValidationError);
    await expect(run).rejects.toThrow(/diện tích[\s\S]*25\.000 km²/);
  });
});

describe('resolveRoi — feature', () => {
  it('resolves a dam to a point with no measure', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'dams', featureId: damId });
    expect(r.resolved.kind).toBe('point');
    expect(r.resolved.measure).toBeNull();
    expect(r.resolved.label).toBe(damName ?? 'Đối tượng không tên');
    expect(r.facts.feature).toEqual({ layerKey: 'dams', featureId: damId });
  });

  it('refuses a radius on something that is already an area', async () => {
    await expect(resolve({ source: 'feature', layerKey: 'lakes', featureId: lakeId, radiusKm: 1 }))
      .rejects.toThrow(/không cần bán kính/);
  });

  it('with whole: true, resolves a river way to its whole level-1 river', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'rivers', featureId: namedWay.id, whole: true });
    expect(r.resolved.label).toBe('Sông Thu Bồn');
    expect(r.resolved.kind).toBe('line');
    const { rows: [river] } = await getPool().query<{ feature_level: number }>(
      `SELECT feature_level FROM water.rivers WHERE id = $1`, [r.facts.feature!.featureId]
    );
    expect(river.feature_level).toBe(1);
  });

  it('with whole: true on a way that has no river, resolves the way itself as "(đoạn)"', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'rivers', featureId: orphanWay.id, whole: true });
    expect(r.resolved.label).toBe(`${orphanWay.name} (đoạn)`);
    expect(r.facts.feature!.featureId).toBe(orphanWay.id);
  });

  it('404s a feature that does not exist', async () => {
    await expect(resolve({ source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resolveRoi — reference', () => {
  it('resolves a road to a line, and to an area with a radius', async () => {
    const line = await resolve({ source: 'reference', referenceLayer: 'roads', entityId: roadEntityId });
    expect(line.resolved.kind).toBe('line');
    const area = await resolve({ source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 });
    expect(area.resolved.kind).toBe('area');
    expect(area.resolved.label).toMatch(/ \+ 1 km$/);
  });
});

describe('resolveRoi — admin', () => {
  it('resolves a province to its area, label and facts', async () => {
    const r = await resolve({ source: 'admin', level: 'province', code: '66' });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Tỉnh Đắk Lắk');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(18_000);
    expect(areaKm2).toBeLessThan(18_200);
    expect(r.facts.admin).toEqual({ level: 'province', code: '66' });
  });

  it('resolves Khánh Hoà, whose 5,195 vertices are over the resulting-vertex cap', async () => {
    const r = await resolve({ source: 'admin', level: 'province', code: '56' });
    expect(r.resolved.kind).toBe('area');
  });

  it('resolves a ward', async () => {
    const r = await resolve({ source: 'admin', level: 'ward', code: '22015' });
    expect(r.resolved.label).toBe('Phường Tuy Hoà');
  });

  it('refuses a province outside the working region, and 404s one that does not exist', async () => {
    await expect(resolve({ source: 'admin', level: 'province', code: '01' })).rejects.toThrow(/ngoài vùng công tác/);
    await expect(resolve({ source: 'admin', level: 'ward', code: '999999' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npm run test -w @webatlas/api -- src/modules/roi/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 5: Write the resolver**

Create `apps/api/src/modules/roi/resolve.ts`:

```ts
import {
  REGION_PROVINCE_CODES,
  type AdminLevel,
  type EditableLayerKey,
  type GeoJsonGeometry,
  type ResolvedRoi,
  type Roi,
  type RoiKind,
  type RoiMeasure,
} from '@webatlas/shared';
import { NotFoundError, ValidationError } from '../../errors';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { candidateCtes, resolveFeature, type Queryable } from '../assistant/tools/data/helpers';
import {
  MAX_ROI_AREA_KM2,
  MAX_SOURCE_ENTITY_PARTS,
  MAX_SOURCE_ENTITY_VERTICES,
  REGION_SQL,
} from '../analysis/area';
import { MAX_INPUT_VERTICES } from '../analysis/geometryInput';

export interface RoiFacts {
  admin?: { level: AdminLevel; code: string };
  feature?: { layerKey: EditableLayerKey; featureId: string };
}

export interface RoiResolution {
  resolved: ResolvedRoi;
  /** Full precision, EPSG:4326, after the radius and the working-region clip. */
  geojson: string;
  /** What the operations need to know about the source (the stamped-code path, Gần nhất's exclusion). */
  facts: RoiFacts;
}

interface Source {
  geojson: string;
  label: string;
  facts: RoiFacts;
  /**
   * False for admin units: they are selected by code from the six working provinces,
   * so they are inside the region by construction, and Khánh Hoà alone (5,195 vertices,
   * 164 parts) would trip the resulting-vertex cap. No operation feeds an admin unit's
   * full geometry to an expensive geometric step: Chọn trong vùng counts it by stamped
   * codes, elevation statistics refuses every province on area, the largest ward is
   * 2,253 vertices, and Gần nhất uses the centroid.
   */
  bounded: boolean;
}

const vn = (n: number) => n.toLocaleString('vi-VN');
const REGION_CODES = [...REGION_PROVINCE_CODES];

async function featureSource(db: Queryable, layerKey: EditableLayerKey, featureId: string, suffix = ''): Promise<Source> {
  const f = await resolveFeature(db, layerKey, featureId, { simplify: false });
  if (!f) throw new NotFoundError('Đối tượng không còn tồn tại');
  return {
    geojson: JSON.stringify(f.geometry),
    label: `${f.name ?? 'Đối tượng không tên'}${suffix}`,
    facts: { feature: { layerKey, featureId } },
    bounded: true,
  };
}

/** The level-1 river a way belongs to (FR-13), or the way itself when it has none. */
async function wholeRiverSource(db: Queryable, wayId: string): Promise<Source> {
  const way = candidateCtes('rivers', `SELECT external_id FROM water.rivers WHERE id = $1`);
  const { rows: [w] } = await db.query<{ parent: string | null }>(
    `WITH RECURSIVE ${way}
     SELECT parent_external_id AS parent FROM resolved WHERE id = $1 AND NOT deleted`,
    [wayId]
  );
  if (!w) throw new NotFoundError('Đối tượng không còn tồn tại');

  if (w.parent) {
    const river = candidateCtes('rivers', `SELECT external_id FROM water.rivers WHERE external_id = $1`);
    const { rows: [r] } = await db.query<{ id: string }>(
      `WITH RECURSIVE ${river}
       SELECT id::text AS id FROM resolved WHERE external_id = $1 AND NOT deleted AND feature_level = 1`,
      [w.parent]
    );
    if (r) return featureSource(db, 'rivers', r.id);
  }
  // 27 names have ways but no matched reach (Phase 3, Deviation 3): no river to return,
  // so the way itself — labelled as a segment rather than failing the pick.
  return featureSource(db, 'rivers', wayId, ' (đoạn)');
}

async function referenceSource(db: Queryable, layer: string, entityId: string): Promise<Source> {
  const { rows: [e] } = await db.query<{ name: string | null; geojson: string }>(
    `SELECT coalesce(ref, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson
       FROM basemap.reference_entities WHERE layer_key = $1 AND entity_id = $2`,
    [layer, entityId]
  );
  if (!e) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  return { geojson: e.geojson, label: e.name ?? 'Thực thể không tên', facts: {}, bounded: true };
}

async function adminSource(db: Queryable, level: AdminLevel, code: string): Promise<Source> {
  const sql = level === 'province'
    ? `SELECT coalesce(full_name, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson,
              code = ANY($2::text[]) AS "inRegion"
         FROM admin.provinces WHERE code = $1`
    : `SELECT coalesce(full_name, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson,
              province_code = ANY($2::text[]) AS "inRegion"
         FROM admin.wards WHERE code = $1`;
  const { rows: [u] } = await db.query<{ name: string; geojson: string; inRegion: boolean }>(sql, [code, REGION_CODES]);
  if (!u) throw new NotFoundError('Không tìm thấy đơn vị hành chính');
  if (!u.inRegion) throw new ValidationError('Đơn vị hành chính này nằm ngoài vùng công tác.');
  return { geojson: u.geojson, label: u.name, facts: { admin: { level, code } }, bounded: false };
}

function sourceOf(db: Queryable, roi: Roi): Promise<Source> {
  switch (roi.source) {
    case 'drawn':
      return Promise.resolve({ geojson: JSON.stringify(roi.geometry), label: 'Hình vẽ', facts: {}, bounded: true });
    case 'feature':
      return roi.whole ? wholeRiverSource(db, roi.featureId) : featureSource(db, roi.layerKey, roi.featureId);
    case 'reference':
      return referenceSource(db, roi.referenceLayer, roi.entityId);
    case 'admin':
      return adminSource(db, roi.level, roi.code);
  }
}

interface ShapeRow {
  sourceDim: number; sourceVertices: number; sourceParts: number; outDim: number;
  refused: boolean; empty: boolean;
  geojson: string | null; display: GeoJsonGeometry | null;
  areaKm2: number | null; lengthKm: number | null; vertices: number | null;
  cx: number | null; cy: number | null;
  west: number | null; south: number | null; east: number | null; north: number | null;
}

const KIND_BY_DIM: Record<number, RoiKind> = { 0: 'point', 1: 'line', 2: 'area' };
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turn an ROI into geometry (spec §10). The ONLY place this happens: every analysis
 * operation calls it first, and POST /api/roi/resolve exposes it to the browser, so the
 * chip never shows an ROI a tool would then refuse (NFR-2).
 *
 * Order of the checks matters, and matches the old area.ts: the source-complexity guard
 * runs INSIDE the SQL (a CASE that never evaluates ST_Buffer for an oversized source —
 * buffering the 22,662-point Quốc lộ 14 once OOM-killed a backend), then the working-
 * region clip, the area ceiling, and the resulting-vertex ceiling.
 */
export async function resolveRoi(db: Queryable, roi: Roi): Promise<RoiResolution> {
  const src = await sourceOf(db, roi);
  const radiusKm = roi.source === 'admin' ? null : roi.radiusKm ?? null;
  // Admin units are inside the region by construction (adminSource), so they skip the
  // ~100 ms union-and-intersect; everything else is clipped to the six provinces.
  const clip = src.bounded
    ? `ST_CollectionExtract(ST_Intersection(s.g, (${REGION_SQL})), s.outdim + 1)`
    : 's.g';

  const { rows: [row] } = await db.query<ShapeRow>(
    `WITH src AS (
       SELECT g, ST_Dimension(g) AS dim, ST_NPoints(g) AS npoints, ST_NumGeometries(g) AS nparts
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) raw
     ),
     shaped AS (
       SELECT dim, npoints, nparts,
              CASE WHEN $2::float8 IS NULL THEN dim ELSE 2 END AS outdim,
              CASE WHEN $2::float8 IS NULL THEN g
                   WHEN dim = 2 THEN NULL::geometry
                   WHEN npoints > ${MAX_SOURCE_ENTITY_VERTICES} OR nparts > ${MAX_SOURCE_ENTITY_PARTS}
                     THEN NULL::geometry
                   ELSE ST_Buffer(g::geography, $2 * 1000)::geometry END AS g
         FROM src
     ),
     -- MATERIALIZED: g is read a dozen times below; without it each reference would
     -- re-run the whole buffer-and-clip expression (see the old area.ts, same reason).
     clipped AS MATERIALIZED (
       SELECT dim, npoints, nparts, outdim,
              CASE WHEN s.g IS NULL THEN NULL::geometry ELSE ${clip} END AS g
         FROM shaped s
     )
     SELECT dim AS "sourceDim", npoints AS "sourceVertices", nparts AS "sourceParts", outdim AS "outDim",
            g IS NULL AS refused, (g IS NULL OR ST_IsEmpty(g)) AS empty,
            ST_AsGeoJSON(g, 7) AS geojson,
            CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ${simplifiedGeoJsonSql('g')} END AS display,
            (ST_Area(g::geography) / 1e6)::float8 AS "areaKm2",
            (ST_Length(g::geography) / 1000)::float8 AS "lengthKm",
            ST_NPoints(g) AS vertices,
            ST_X(ST_Centroid(g)) AS cx, ST_Y(ST_Centroid(g)) AS cy,
            ST_XMin(g) AS west, ST_YMin(g) AS south, ST_XMax(g) AS east, ST_YMax(g) AS north
       FROM clipped`,
    [src.geojson, radiusKm]
  );

  if (row.refused) {
    if (row.sourceDim === 2) {
      throw new ValidationError('Vùng đã có diện tích, không cần bán kính.');
    }
    const reasons: string[] = [];
    if (row.sourceVertices > MAX_SOURCE_ENTITY_VERTICES) {
      reasons.push(`${vn(row.sourceVertices)} điểm vượt giới hạn ${vn(MAX_SOURCE_ENTITY_VERTICES)} điểm cho thực thể nguồn`);
    }
    if (row.sourceParts > MAX_SOURCE_ENTITY_PARTS) {
      reasons.push(`${vn(row.sourceParts)} phần rời rạc vượt giới hạn ${vn(MAX_SOURCE_ENTITY_PARTS)} phần cho thực thể nguồn`);
    }
    throw new ValidationError(
      `Thực thể quá phức tạp để tạo vùng đệm: ${reasons.join('; ')}. Hãy chọn thực thể khác hoặc bỏ bán kính.`
    );
  }
  if (row.empty) throw new ValidationError('Vùng phân tích nằm ngoài vùng công tác.');

  const kind = KIND_BY_DIM[row.outDim];
  if (kind === 'area' && row.areaKm2! > MAX_ROI_AREA_KM2) {
    throw new ValidationError(
      `Vùng phân tích quá lớn: ${vn(Math.round(row.areaKm2!))} km² vượt giới hạn diện tích ` +
        `${vn(MAX_ROI_AREA_KM2)} km². Hãy giảm bán kính hoặc chọn vùng nhỏ hơn.`
    );
  }
  if (src.bounded && row.vertices! > MAX_INPUT_VERTICES) {
    throw new ValidationError(
      `Vùng phân tích quá phức tạp: ${vn(row.vertices!)} điểm vượt giới hạn ${vn(MAX_INPUT_VERTICES)} điểm.`
    );
  }

  const measure: RoiMeasure =
    kind === 'area' ? { areaKm2: round3(row.areaKm2!) }
      : kind === 'line' ? { lengthKm: round3(row.lengthKm!) }
        : null;

  return {
    geojson: row.geojson!,
    facts: src.facts,
    resolved: {
      label: radiusKm === null ? src.label : `${src.label} + ${vn(radiusKm)} km`,
      kind,
      measure,
      display: row.display!,
      bbox: [row.west!, row.south!, row.east!, row.north!],
      centroid: [row.cx!, row.cy!],
    },
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run test -w @webatlas/api -- src/modules/roi/resolve.test.ts`
Expected: PASS, 15 tests.
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.

- [ ] **Step 7: Prove the admin exemption is load-bearing**

Temporarily change `bounded: false` in `adminSource` to `bounded: true` and re-run the file. Expected: "resolves Khánh Hoà …" FAILS with "Vùng phân tích quá phức tạp: 5.195 điểm". Restore `bounded: false`, re-run, PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/analysis/geometryInput.ts apps/api/src/modules/analysis/schemas.ts \
        apps/api/src/modules/analysis/area.ts apps/api/src/modules/roi/
git commit -m "feat(api): resolveRoi — nơi duy nhất biến vùng phân tích thành hình học

Bốn nguồn (vẽ, đối tượng kèm 'cả sông', thực thể nền, đơn vị hành chính), bán kính,
cắt theo vùng công tác và mọi giới hạn cũ áp cho mọi nguồn. Đơn vị hành chính miễn
trần 5.000 điểm kết quả (Khánh Hoà 5.195 điểm) vì không phép nào dùng hình đầy đủ của nó.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/roi/resolve`

**Files:**
- Create: `apps/api/src/modules/roi/controller.ts`, `apps/api/src/modules/roi/routes.ts`, `apps/api/src/modules/roi/roi.test.ts`
- Modify: `apps/api/src/server.ts:45`

**Interfaces:**
- Consumes: `RoiSchema`, `resolveRoi` (Task 2); `withAnalysisTimeout`, `getAnalysisPool`.
- Produces: `POST /api/roi/resolve`, body `{ roi }`, response `ResolvedRoi`. Errors 400 / 404 / 503 / 504 in the API's usual `{ error: { code, message } }` shape.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/roi/roi.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { closeAnalysisPool } from '../analysis/pool';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await closeAnalysisPool(); });

const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/roi/resolve', payload: payload as object });

describe('POST /api/roi/resolve', () => {
  it('returns the resolved ROI', async () => {
    const res = await post({ roi: { source: 'admin', level: 'province', code: '66' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ label: 'Tỉnh Đắk Lắk', kind: 'area' });
    expect(body.measure.areaKm2).toBeGreaterThan(18_000);
    expect(body.display.type).toMatch(/Polygon/);
    expect(body.bbox).toHaveLength(4);
    expect(body.centroid).toHaveLength(2);
    // Internal facts and the full-precision geometry never leave the server.
    expect(body).not.toHaveProperty('geojson');
    expect(body).not.toHaveProperty('facts');
  });

  it('400s a malformed ROI: bad radius, a radius on an admin unit, whole on a non-river', async () => {
    const point = { type: 'Point', coordinates: [108.05, 12.68] };
    expect((await post({ roi: { source: 'drawn', geometry: point, radiusKm: 0 } })).statusCode).toBe(400);
    expect((await post({ roi: { source: 'drawn', geometry: point, radiusKm: 101 } })).statusCode).toBe(400);
    expect((await post({ roi: { source: 'admin', level: 'province', code: '66', radiusKm: 5 } })).statusCode).toBe(400);
    expect((await post({
      roi: { source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000', whole: true },
    })).statusCode).toBe(400);
    expect((await post({})).statusCode).toBe(400);
  });

  it('404s an ROI whose feature does not exist', async () => {
    const res = await post({
      roi: { source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s a limit with the reason in the message', async () => {
    const res = await post({
      roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.4, 13.6] }, radiusKm: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/diện tích/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/roi/roi.test.ts`
Expected: FAIL — every request returns 404 (the route does not exist).

- [ ] **Step 3: Write the route**

Create `apps/api/src/modules/roi/controller.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Roi } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { withAnalysisTimeout } from '../analysis/db';
import { getAnalysisPool } from '../analysis/pool';
import { resolveRoi } from './resolve';
import { RoiSchema } from './schema';

const ResolveBody = z.object({ roi: RoiSchema });

/**
 * POST /api/roi/resolve — public like /api/analysis/:op, and bounded the same way: the
 * analysis pool, a read-only transaction, the 5 s statement timeout (NFR-3). Returns only
 * the ResolvedRoi; the full-precision geometry and the source facts stay server-side.
 */
export async function resolveRoiRoute(req: FastifyRequest, reply: FastifyReply) {
  const { roi } = validate(ResolveBody, req.body ?? {});
  const { resolved } = await withAnalysisTimeout(getAnalysisPool(), (db) => resolveRoi(db, roi as Roi));
  reply.send(resolved);
}
```

Create `apps/api/src/modules/roi/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { resolveRoiRoute } from './controller';

/** Every ROI pick and every radius change is one resolve, so the ceiling is above the
 *  analysis route's 60/min: picking and adjusting is quick, clicking "Chạy" is not. */
export default async function roiRoutes(app: FastifyInstance) {
  app.post('/roi/resolve', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, resolveRoiRoute);
}
```

In `apps/api/src/server.ts`, add `import roiRoutes from './modules/roi/routes';` beside the other route imports, and register it right after `analysisRoutes`:

```ts
  app.register(analysisRoutes, { prefix: '/api' });
  app.register(roiRoutes, { prefix: '/api' });
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @webatlas/api -- src/modules/roi` → PASS (19 tests).
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/roi/controller.ts apps/api/src/modules/roi/routes.ts \
        apps/api/src/modules/roi/roi.test.ts apps/api/src/server.ts
git commit -m "feat(api): POST /api/roi/resolve

Công khai, chạy trên pool phân tích với giao dịch chỉ đọc và giới hạn 5 s; chỉ trả
ResolvedRoi, hình đầy đủ và thông tin nguồn ở lại máy chủ.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The analysis operations take `roi`

This is the step where the old input shapes go: every operation resolves an `Roi`, the assistant's tools build one internally, and the web app's existing draw-then-run flow sends its drawn shape as `{ source: 'drawn' }` — all in one commit, so nothing is ever left half-migrated (spec §14 step 2).

**Files:**
- Create: `apps/api/src/modules/roi/kind.ts`, `apps/api/src/modules/roi/fromParts.ts`
- Modify: `apps/api/src/modules/analysis/schemas.ts`, `apps/api/src/modules/analysis/area.ts`, `apps/api/src/modules/analysis/ops/{selectWithin,zonalElevation,elevationProfile,nearest,buffer}.ts`, `apps/api/src/modules/assistant/tools/data/{selectWithin,zonalElevation,elevationProfile}.ts`, `apps/api/src/modules/analysis/analysis.test.ts`, `apps/api/src/modules/analysis/ops/elevationProfile.test.ts`, `apps/web/src/features/analysis/model/tools.ts`, `apps/web/src/features/analysis/model/tools.test.ts`, `apps/web/src/features/analysis/model/useAnalysis.test.ts`

**Interfaces:**
- Consumes: `resolveRoi`, `RoiSchema` (Task 2).
- Produces:
  - HTTP bodies: `select_within {roi, layerKeys}`, `zonal_elevation {roi}`, `elevation_profile {roi, samples}`, `nearest {roi, layerKey, k}`; `buffer` unchanged.
  - `requireArea(resolved, toolLabel)`, `requireLine(resolved, roi)` in `roi/kind.ts`.
  - `roiFromParts(parts, radiusKm?)` in `roi/fromParts.ts`.
  - `queryNearest(db, { layerKey, lon, lat, limit, excludeId? })`; `nearestGeometries(layerKey, lon, lat, rows, originLabel = 'Điểm chọn')`.
  - `nearest`'s summary gains `'Tính từ'`.

- [ ] **Step 1: Rewrite the tests to the new bodies (they fail first)**

In `apps/api/src/modules/analysis/analysis.test.ts`, make these replacements. Each is the whole payload argument; nothing else on the line changes.

| Line | Old payload | New payload |
|---|---|---|
| 69 | `{ geometry: square(dam.lon, dam.lat, 0.02), layerKeys: ['dams'] }` | `{ roi: { source: 'drawn', geometry: square(dam.lon, dam.lat, 0.02) }, layerKeys: ['dams'] }` |
| 79 | `{ feature: { layerKey: 'rivers', featureId: riverId }, bufferKm: 5, layerKeys: ['dams', 'lakes'] }` | `{ roi: { source: 'feature', layerKey: 'rivers', featureId: riverId, radiusKm: 5 }, layerKeys: ['dams', 'lakes'] }` |
| 85 | `{ geometry: { type: 'Point', coordinates: [dam.lon, dam.lat] }, layerKeys: ['dams'] }` | `{ roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [dam.lon, dam.lat] } }, layerKeys: ['dams'] }` |
| 87 | `{ feature: { layerKey: 'rivers', featureId: riverId }, layerKeys: ['dams'] }` | `{ roi: { source: 'feature', layerKey: 'rivers', featureId: riverId }, layerKeys: ['dams'] }` |
| 100 | `{ lon: 108.05, lat: 12.68, layerKey: 'dams', k: 3 }` | `{ roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] } }, layerKey: 'dams', k: 3 }` |
| 110 | `{ lon: 108.05, lat: 12.68, layerKey: 'dams', k: 26 }` | `{ roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] } }, layerKey: 'dams', k: 26 }` |
| 125 | `{ geometry: sixKmLine }` | `{ roi: { source: 'drawn', geometry: sixKmLine } }` |
| 139 | `{ geometry: line, samples: 50 }` | `{ roi: { source: 'drawn', geometry: line }, samples: 50 }` |
| 154 | `{ geometry: square(108.05, 12.68, 0.02) }` | `{ roi: { source: 'drawn', geometry: square(108.05, 12.68, 0.02) } }` |
| 167 | `{ geometry: square(108.0, 13.0, 0.5) }` | `{ roi: { source: 'drawn', geometry: square(108.0, 13.0, 0.5) } }` |
| 288 | `{ reference: { referenceLayer: 'water', entityId: waterEntityId } }` | `{ roi: { source: 'reference', referenceLayer: 'water', entityId: waterEntityId } }` |
| 325 | `{ reference: { referenceLayer: 'roads', entityId: modest.entity_id }, samples: 10 }` | `{ roi: { source: 'reference', referenceLayer: 'roads', entityId: modest.entity_id }, samples: 10 }` |
| 343 | `{ reference: { referenceLayer: 'water', entityId: waterEntityId } }` | `{ roi: { source: 'reference', referenceLayer: 'water', entityId: waterEntityId } }` |
| 353 | `{ reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 } }` | `{ roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 } }` |
| 468 | `{ reference: { referenceLayer: 'water', entityId: bigWater.entity_id } }` | `{ roi: { source: 'reference', referenceLayer: 'water', entityId: bigWater.entity_id } }` |
| 505–508 | `{ reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 2 }, layerKeys: ['dams'] }` | `{ roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 2 }, layerKeys: ['dams'] }` |

The `buffer` requests (lines 37, 48, 55–58, 62, 219, 278, 364, 391, 431, 480, 492) keep their bodies: `buffer` keeps its pre-ROI shape (spec C-9).

Replace the test at lines 293–307 — the "want an area" refusal it pinned moved from `buffer` to the operations that genuinely need an area (Deviation 1):

```ts
  it('refuses a line entity with no radius on an area operation, naming the radius as the reason', async () => {
    // select_within needs an area; a road with no radius resolves to a line.
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/select_within',
      payload: { roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId }, layerKeys: ['dams'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/bán kính/i);
  });

  it('buffers a line entity that has no radius of its own (Deviation 1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId }, radiusKm: 1 },
    });
    expect(res.statusCode).toBe(200);
  });
```

Add two tests at the end of the `describe('POST /api/analysis/nearest', …)` block:

```ts
  it('excludes the ROI itself when it is a feature of the searched layer', async () => {
    const res = await post('nearest', {
      roi: { source: 'feature', layerKey: 'dams', featureId: dam.id }, layerKey: 'dams', k: 3,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().rows.map((r: { featureId: string }) => r.featureId);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(dam.id);
  });

  it('measures from the centroid of a line or area, and says so', async () => {
    const res = await post('nearest', {
      roi: { source: 'drawn', geometry: square(108.05, 12.68, 0.05) }, layerKey: 'dams', k: 1,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary['Tính từ']).toMatch(/^Trọng tâm của /);
    expect(body.geometries.some((g: { label?: string }) => g.label === 'Trọng tâm vùng phân tích')).toBe(true);
  });
```

In `apps/api/src/modules/analysis/ops/elevationProfile.test.ts` line 78, replace
`const result = await elevationProfileOp(getPool(), { geometry: line, samples: 10 });`
with
`const result = await elevationProfileOp(getPool(), { roi: { source: 'drawn', geometry: line }, samples: 10 } as never);`

In `apps/web/src/features/analysis/model/tools.test.ts`, replace the body of `it('builds the request body each route expects', …)` with:

```ts
    const drawn = (g: GeoJsonGeometry) => ({ source: 'drawn', geometry: g });
    expect(buildInput('buffer', DEFAULT_PARAMS, point)).toEqual({ geometry: point, radiusKm: 5 });
    expect(buildInput('select_within', DEFAULT_PARAMS, poly)).toEqual({ roi: drawn(poly), layerKeys: ['dams'] });
    expect(buildInput('nearest', DEFAULT_PARAMS, point)).toEqual({ roi: drawn(point), layerKey: 'dams', k: 5 });
    expect(buildInput('elevation_profile', DEFAULT_PARAMS, line)).toEqual({ roi: drawn(line), samples: 100 });
    expect(buildInput('zonal_elevation', DEFAULT_PARAMS, poly)).toEqual({ roi: drawn(poly) });
```

In `apps/web/src/features/analysis/model/useAnalysis.test.ts`, replace
`{ geometry: poly, layerKeys: ['dams'] }` with `{ roi: { source: 'drawn', geometry: poly }, layerKeys: ['dams'] }`
and `{ geometry: poly }` (the `zonal_elevation` expectation) with `{ roi: { source: 'drawn', geometry: poly } }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/api -- src/modules/analysis`
Expected: FAIL — every rewritten request is a 400 ("Validation failed": `roi` is not in the schemas yet).
Run: `npm run test -w @webatlas/web -- src/features/analysis`
Expected: FAIL on the two changed expectations.

- [ ] **Step 3: The kind checks and the legacy adapter**

Create `apps/api/src/modules/roi/kind.ts`:

```ts
import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { ValidationError } from '../../errors';

const NOUN: Record<ResolvedRoi['kind'], string> = { area: 'vùng', line: 'đường', point: 'điểm' };

/**
 * An area tool (Chọn trong vùng, Thống kê độ cao) refuses a line or a point and names
 * the fix. The browser disables these tools already (§8); this is the server's own
 * check, so a client that ignores availability still gets a clear 400 (§10).
 */
export function requireArea(resolved: ResolvedRoi, toolLabel: string): void {
  if (resolved.kind !== 'area') {
    throw new ValidationError(`${toolLabel} cần một vùng; hãy thêm bán kính cho ${NOUN[resolved.kind]} này.`);
  }
}

/** Trắc diện độ cao takes a line; if a radius is what made it an area, say to remove it. */
export function requireLine(resolved: ResolvedRoi, roi: Roi): void {
  if (resolved.kind === 'line') return;
  const hasRadius = roi.source !== 'admin' && roi.radiusKm !== undefined;
  throw new ValidationError(
    'Trắc diện độ cao cần một tuyến đường; vùng phân tích này không phải là một tuyến đường' +
      (hasRadius ? ' — hãy bỏ bán kính.' : ', ví dụ hãy chọn một con sông.')
  );
}
```

Create `apps/api/src/modules/roi/fromParts.ts`:

```ts
import type { DrawnRoiGeometry, EditableLayerKey, GeoJsonGeometry, ReferenceLayerKey, Roi } from '@webatlas/shared';
import { ValidationError } from '../../errors';

interface Parts {
  geometry?: GeoJsonGeometry;
  feature?: { layerKey: EditableLayerKey; featureId: string };
  reference?: { referenceLayer: ReferenceLayerKey; entityId: string; radiusKm?: number };
}

/**
 * The pre-ROI input families — buffer's HTTP body and the assistant tools' feature ids —
 * as an Roi, so they go through resolveRoi like everything else. A reference's own
 * radius wins over `radiusKm`, matching how buffer's body always read it.
 */
export function roiFromParts(parts: Parts, radiusKm?: number): Roi {
  const radius = radiusKm !== undefined ? { radiusKm } : {};
  if (parts.geometry) return { source: 'drawn', geometry: parts.geometry as DrawnRoiGeometry, ...radius };
  if (parts.reference) {
    const r = parts.reference.radiusKm ?? radiusKm;
    return {
      source: 'reference',
      referenceLayer: parts.reference.referenceLayer,
      entityId: parts.reference.entityId,
      ...(r !== undefined ? { radiusKm: r } : {}),
    };
  }
  if (parts.feature) {
    return { source: 'feature', layerKey: parts.feature.layerKey, featureId: parts.feature.featureId, ...radius };
  }
  throw new ValidationError('Thiếu vùng phân tích.');
}
```

- [ ] **Step 4: The schemas**

Replace the whole of `apps/api/src/modules/analysis/schemas.ts` with:

```ts
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, type GeoJsonGeometry } from '@webatlas/shared';
import { REFERENCE_LAYER_KEYS } from '../../reference/registry';
import { RoiSchema } from '../roi/schema';
import { MAX_INPUT_VERTICES, geometryInput } from './geometryInput';

export { MAX_INPUT_VERTICES };

type GeometryType = GeoJsonGeometry['type'];
const ALL_TYPES: GeometryType[] = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

export const FeatureRef = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
});
export type FeatureRefInput = z.infer<typeof FeatureRef>;

const radiusKm = z.number().gt(0, 'Bán kính phải lớn hơn 0').max(100, 'Bán kính tối đa 100 km');

export const ReferenceRef = z.object({
  referenceLayer: z.enum(REFERENCE_LAYER_KEYS),
  entityId: z.string().min(1, 'Thiếu mã thực thể'),
  radiusKm: radiusKm.optional(),
});
export type ReferenceRefInput = z.infer<typeof ReferenceRef>;

const exactlyOne = (v: { geometry?: unknown; feature?: unknown; reference?: unknown }) =>
  [v.geometry, v.feature, v.reference].filter((x) => x !== undefined).length === 1;
const EXACTLY_ONE =
  'Cần đúng một trong ba: geometry (hình vẽ), feature (đối tượng) hoặc reference (thực thể nền bản đồ)';

/**
 * buffer keeps its pre-ROI body: only the assistant's buffer_feature calls it since the
 * toolbar's radius replaced the Vùng đệm tool (spec D7, C-9). Its source still goes
 * through resolveRoi (ops/buffer.ts).
 */
export const BufferInput = z
  .object({
    geometry: geometryInput(ALL_TYPES).optional(),
    feature: FeatureRef.optional(),
    reference: ReferenceRef.optional(),
    radiusKm,
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type BufferInput = z.infer<typeof BufferInput>;

export const SelectWithinInput = z.object({
  roi: RoiSchema,
  layerKeys: z.array(z.enum(EDITABLE_LAYER_KEYS)).min(1).max(EDITABLE_LAYER_KEYS.length),
});
export type SelectWithinInput = z.infer<typeof SelectWithinInput>;

export const NearestInput = z.object({
  roi: RoiSchema,
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  k: z.number().int().min(1).max(25).default(5),
});
export type NearestInput = z.infer<typeof NearestInput>;

export const ProfileInput = z.object({
  roi: RoiSchema,
  samples: z.number().int().min(2).max(200).default(100),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ZonalInput = z.object({ roi: RoiSchema });
export type ZonalInput = z.infer<typeof ZonalInput>;
```

- [ ] **Step 5: The operations**

Replace the whole of `apps/api/src/modules/analysis/ops/selectWithin.ts` with:

```ts
import {
  MAX_RESULT_ITEMS,
  capResultItems,
  type AnalysisResult,
  type AnalysisRow,
  type GeoJsonGeometry,
  type ResultGeometry,
  type Roi,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import {
  LAYER_LABELS, POINT_SQL, ROW_LIMIT, candidateCtes, entityPredicate, layerTable, type Queryable,
} from '../../assistant/tools/data/helpers';
import { requireArea } from '../../roi/kind';
import { resolveRoi } from '../../roi/resolve';
import type { SelectWithinInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * Features of each layer inside the ROI. The candidate step reaches the base table's
 * index; the real predicate, NOT deleted and the entity predicate are re-applied after
 * version resolution (handover §4.2). `count(*) OVER ()` is computed before LIMIT, so
 * counts are full even when drawing is capped.
 */
export async function selectWithinOp(db: Queryable, input: SelectWithinInput): Promise<AnalysisResult> {
  const { resolved, geojson } = await resolveRoi(db, input.roi as Roi);
  requireArea(resolved, 'Chọn trong vùng');

  // The area test as SQL over one layer's rows ($1), and its parameter.
  const inArea = { sql: `geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`, param: geojson as string };

  const summary: Record<string, number | string> = { 'Tổng số': 0 };
  const rows: AnalysisRow[] = [];
  const highlights: ResultGeometry[] = [];
  let total = 0;

  for (const key of input.layerKeys) {
    const entity = entityPredicate(key);
    const ctes = candidateCtes(key, `SELECT external_id FROM ${layerTable(key)} WHERE ${inArea.sql} AND ${entity}`);
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `WITH RECURSIVE ${ctes}
       SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM resolved
        WHERE NOT deleted AND geom IS NOT NULL AND ${inArea.sql} AND ${entity}
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [inArea.param, MAX_RESULT_ITEMS]
    );
    const n = found.length > 0 ? Number(found[0].total) : 0;
    summary[LAYER_LABELS[key]] = n;
    total += n;
    for (const f of found) {
      highlights.push({
        geometry: f.geometry, role: 'highlight', layerKey: key, featureId: f.featureId,
        ...(f.name ? { label: f.name } : {}),
      });
      if (rows.length < ROW_LIMIT) {
        rows.push({ layerKey: key, featureId: f.featureId, name: f.name, lon: f.lon, lat: f.lat });
      }
    }
  }

  summary['Tổng số'] = total;
  summary['Diện tích vùng (km²)'] = (resolved.measure as { areaKm2: number }).areaKm2;
  const capped = capResultItems([
    { geometry: resolved.display, role: 'input', label: resolved.label },
    ...highlights,
  ]);
  return {
    op: 'select_within',
    summary,
    rows,
    geometries: capped.items,
    truncated: capped.truncated || highlights.length < total,
  };
}
```

Replace the whole of `apps/api/src/modules/analysis/ops/zonalElevation.ts` with:

```ts
import { FABDEM_ATTRIBUTION, type AnalysisResult, type Roi } from '@webatlas/shared';
import { ValidationError } from '../../../errors';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { requireArea } from '../../roi/kind';
import { resolveRoi } from '../../roi/resolve';
import { DEM_UNAVAILABLE_SUMMARY, demAvailable } from '../dem';
import type { ZonalInput } from '../schemas';

/** ~5.5M 30 m pixels — a few seconds at most; anything bigger belongs in a batch job. */
export const MAX_ZONAL_AREA_KM2 = 5000;

export async function zonalElevationOp(db: Queryable, input: ZonalInput): Promise<AnalysisResult> {
  const { resolved, geojson } = await resolveRoi(db, input.roi as Roi);
  requireArea(resolved, 'Thống kê độ cao');
  const areaKm2 = (resolved.measure as { areaKm2: number }).areaKm2;
  if (areaKm2 > MAX_ZONAL_AREA_KM2) {
    throw new ValidationError(`Vùng quá lớn (${Math.round(areaKm2)} km²); tối đa ${MAX_ZONAL_AREA_KM2} km².`);
  }
  const drawn = [{ geometry: resolved.display, role: 'input' as const, label: resolved.label }];
  if (!(await demAvailable(db))) {
    return { op: 'zonal_elevation', summary: { ...DEM_UNAVAILABLE_SUMMARY }, geometries: drawn };
  }

  const { rows: [s] } = await db.query<{ count: number | null; min: number | null; max: number | null; mean: number | null }>(
    `WITH area AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          clipped AS (
            SELECT ST_Clip(r.rast, area.g, true) AS rast
              FROM basemap.dem_region r, area
             WHERE ST_Intersects(r.rast, area.g)),
          stats AS (SELECT ST_SummaryStatsAgg(rast, 1, true) AS st FROM clipped WHERE rast IS NOT NULL)
     SELECT (st).count::int AS count, round((st).min::numeric, 1)::float8 AS min,
            round((st).max::numeric, 1)::float8 AS max, round((st).mean::numeric, 1)::float8 AS mean
       FROM stats`,
    [geojson]
  );

  const summary: Record<string, number | string> = { 'Diện tích (km²)': areaKm2 };
  if (!s || !s.count) {
    summary['Trạng thái'] = 'Không có dữ liệu độ cao trong vùng';
  } else {
    Object.assign(summary, {
      'Thấp nhất (m)': s.min!, 'Cao nhất (m)': s.max!, 'Trung bình (m)': s.mean!, 'Số điểm ảnh': s.count,
    });
  }
  return { op: 'zonal_elevation', summary, geometries: drawn, attribution: FABDEM_ATTRIBUTION };
}
```

In `apps/api/src/modules/analysis/ops/elevationProfile.ts`:
- change the first import line to `import { FABDEM_ATTRIBUTION, type AnalysisResult, type GeoJsonGeometry, type Roi } from '@webatlas/shared';`
- replace `import { inputGeometry } from '../area';` with
  ```ts
  import { requireLine } from '../../roi/kind';
  import { resolveRoi } from '../../roi/resolve';
  ```
- replace the two lines
  ```ts
    // 'path': for a reference entity, the road/railway's own line geometry, not a
    // buffered area -- see referencePath's comment in area.ts for why.
    const src = await inputGeometry(db, input, { want: 'path' });
  ```
  with
  ```ts
    // A line, unbuffered: resolveRoi returns a road, a river or a drawn line as itself,
    // and requireLine refuses an area (including a line a radius turned into one).
    const { resolved, geojson } = await resolveRoi(db, input.roi as Roi);
    requireLine(resolved, input.roi as Roi);
    const src = { geojson, label: resolved.label };
  ```

Replace the whole of `apps/api/src/modules/analysis/ops/nearest.ts` with:

```ts
import type { AnalysisResult, EditableLayerKey, ResultGeometry, Roi } from '@webatlas/shared';
import {
  LAYER_LABELS, POINT_SQL, candidateCtes, entityPredicate, layerTable, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import { resolveRoi } from '../../roi/resolve';
import type { NearestInput } from '../schemas';

// How many nearest-by-planar-distance candidates to pull off the base table
// per requested result, before resolving the version chain and re-ordering
// by true geography distance. KNN has no simple indexable predicate the way
// a bbox test does, so this is a bounded over-fetch rather than an exact
// filter — generous enough that in practice (one active ingest version per
// layer) the resolved set always has at least `limit` rows, but a layer with
// many edit-versions could starve the candidate set, hence the fallback
// below rather than trusting the over-fetch blindly.
const NEAREST_OVERFETCH_FACTOR = 20;

export interface NearestRow { featureId: string; name: string | null; lon: number; lat: number; distanceKm: number }

/**
 * `excludeId` leaves one feature out — the ROI itself, so "3 đập gần đập X nhất" does
 * not answer with đập X at 0 km (spec §10).
 */
export async function queryNearest(
  db: Queryable,
  q: { layerKey: EditableLayerKey; lon: number; lat: number; limit: number; excludeId?: string }
): Promise<NearestRow[]> {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
  const overfetch = q.limit * NEAREST_OVERFETCH_FACTOR;
  // The entity predicate goes in the KNN candidate step too: without it, the
  // over-fetch for rivers is spent on reaches and ways, the nearest rows of all.
  const entity = entityPredicate(q.layerKey);
  const notExcluded = '($5::uuid IS NULL OR id <> $5::uuid)';
  const ctes = candidateCtes(
    q.layerKey,
    `SELECT external_id FROM ${layerTable(q.layerKey)}
      WHERE ${entity} AND ${notExcluded}
      ORDER BY geom <-> ${point} LIMIT $4`
  );
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  const { rows: fastRows } = await db.query<NearestRow>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM resolved
      WHERE NOT deleted AND ${entity} AND ${notExcluded}
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch, q.excludeId ?? null]
  );
  if (fastRows.length >= q.limit) return fastRows;

  // The over-fetch came back short. That's a legitimate answer if the
  // layer genuinely has fewer than `limit` active features — but if it
  // has enough, the candidate step must have missed some (starved by
  // many edit-versions spreading the same external_ids across more
  // physical rows than the over-fetch pulled). Rather than silently
  // return a short answer, fall back to the exact query.
  const view = layerView(q.layerKey);
  const { rows: countRows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${view} WHERE ${entity} AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [q.excludeId ?? null]
  );
  if (Number(countRows[0].n) < q.limit) return fastRows;
  const { rows: exactRows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM ${view}
      WHERE ${entity} AND ($4::uuid IS NULL OR id <> $4::uuid)
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, q.excludeId ?? null]
  );
  return exactRows;
}

/** Connector lines from the origin point to each nearest feature. */
export function nearestGeometries(
  layerKey: EditableLayerKey, lon: number, lat: number, rows: NearestRow[], originLabel = 'Điểm chọn'
): ResultGeometry[] {
  return [
    { geometry: { type: 'Point', coordinates: [lon, lat] }, role: 'input', label: originLabel },
    ...rows.flatMap((r): ResultGeometry[] => [
      { geometry: { type: 'LineString', coordinates: [[lon, lat], [r.lon, r.lat]] }, role: 'result', label: `${r.distanceKm} km` },
      {
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, role: 'highlight', layerKey, featureId: r.featureId,
        ...(r.name ? { label: r.name } : {}),
      },
    ]),
  ];
}

/**
 * Gần nhất measures from the ROI's centroid (D12), so it works for any kind; a point's
 * centroid is the point. The centroid is drawn and named, because for a curved river or
 * an L-shaped area it can fall outside the shape itself.
 */
export async function nearestOp(db: Queryable, input: NearestInput): Promise<AnalysisResult> {
  const { resolved, facts } = await resolveRoi(db, input.roi as Roi);
  const [lon, lat] = resolved.centroid;
  const excludeId = facts.feature?.layerKey === input.layerKey ? facts.feature.featureId : undefined;
  const rows = await queryNearest(db, {
    layerKey: input.layerKey, lon, lat, limit: input.k, ...(excludeId ? { excludeId } : {}),
  });
  const fromCentroid = resolved.kind !== 'point';
  return {
    op: 'nearest',
    summary: {
      'Lớp': LAYER_LABELS[input.layerKey],
      'Tính từ': fromCentroid ? `Trọng tâm của ${resolved.label}` : resolved.label,
      'Số đối tượng': rows.length,
      'Gần nhất (km)': rows[0]?.distanceKm ?? '—',
    },
    rows: rows.map((r) => ({ layerKey: input.layerKey, ...r })),
    geometries: nearestGeometries(input.layerKey, lon, lat, rows, fromCentroid ? 'Trọng tâm vùng phân tích' : resolved.label),
  };
}
```

In `apps/api/src/modules/analysis/ops/buffer.ts`:
- replace `import { inputGeometry } from '../area';` with
  ```ts
  import { roiFromParts } from '../../roi/fromParts';
  import { resolveRoi } from '../../roi/resolve';
  ```
- replace `const src = await inputGeometry(db, input);` with
  ```ts
  // The source goes through resolveRoi like every input (spec §10); the buffer itself is
  // this op's own work. Its body keeps the pre-ROI shape — only buffer_feature calls it.
  const { geojson, resolved } = await resolveRoi(db, roiFromParts(input));
  const src = { geojson, label: resolved.label };
  ```
  (the rest of the function reads `src.geojson` and `src.label` and is unchanged).

In `apps/api/src/modules/analysis/area.ts`: replace lines 1–8 (the imports and the `GEOM` constant) with the single line
`import { REGION_PROVINCE_CODES } from '@webatlas/shared';`
and delete everything from the `/**` comment that opens `referencePath` (the comment starting "The entity's own line geometry for a path-shaped analysis") to the end of the file. What remains is the three limit constants, their comments, and `REGION_SQL`.

- [ ] **Step 6: The assistant's tools build an Roi**

In `apps/api/src/modules/assistant/tools/data/selectWithin.ts`, add `import { roiFromParts } from '../../../roi/fromParts';` and replace the `selectWithinOp(db, { … })` call with:

```ts
        selectWithinOp(db, {
          roi: roiFromParts({ feature: { layerKey: input.area.layerKey, featureId: input.area.featureId } }, input.area.radiusKm),
          layerKeys: input.layerKeys,
        })
```

In `apps/api/src/modules/assistant/tools/data/zonalElevation.ts`, add the same import, delete `import type { ZonalInput } from '../../../analysis/schemas';`, and replace the `zonalElevationOp(db, { … } as ZonalInput)` call with:

```ts
        zonalElevationOp(db, {
          roi: roiFromParts({ feature: { layerKey: input.layerKey, featureId: input.featureId } }, input.radiusKm),
        })
```

In `apps/api/src/modules/assistant/tools/data/elevationProfile.ts`, replace the `elevationProfileOp(db, { … })` call with:

```ts
        elevationProfileOp(db, {
          roi: { source: 'feature', layerKey: input.layerKey, featureId: input.featureId },
          samples: input.samples,
        })
```

- [ ] **Step 7: The web app sends its drawn shape as an ROI**

In `apps/web/src/features/analysis/model/tools.ts`, replace `buildInput` with:

```ts
export function buildInput(op: AnalysisOp, params: AnalysisParams, g: GeoJsonGeometry): object {
  // Until the ROI chip lands (Task 10), the toolbar still draws per tool; it sends that
  // drawing as a drawn ROI. buffer keeps its own body (spec C-9).
  const roi = { source: 'drawn' as const, geometry: g };
  switch (op) {
    case 'buffer': return { geometry: g, radiusKm: params.radiusKm };
    case 'select_within': return { roi, layerKeys: params.layerKeys };
    case 'nearest': return { roi, layerKey: params.layerKey, k: params.k };
    case 'elevation_profile': return { roi, samples: params.samples };
    case 'zonal_elevation': return { roi };
  }
}
```

- [ ] **Step 8: Run everything**

Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.
Run: `npm run test -w @webatlas/api` → all green (the pre-Task-4 count plus the new tests).
Run: `npm run test -w @webatlas/web` and `npm run build:web` → green, exit 0.

- [ ] **Step 9: Prove the exclusion and the centroid are load-bearing**

In `nearestOp`, temporarily replace `...(excludeId ? { excludeId } : {})` with nothing. Re-run `npm run test -w @webatlas/api -- src/modules/analysis`: "excludes the ROI itself…" FAILS (the dam appears at 0 km). Restore. Then temporarily set `const fromCentroid = false;`: "measures from the centroid…" FAILS. Restore; re-run; green.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/roi/kind.ts apps/api/src/modules/roi/fromParts.ts \
        apps/api/src/modules/analysis apps/api/src/modules/assistant/tools/data/selectWithin.ts \
        apps/api/src/modules/assistant/tools/data/zonalElevation.ts \
        apps/api/src/modules/assistant/tools/data/elevationProfile.ts \
        apps/web/src/features/analysis/model
git commit -m "feat(api): mọi phép phân tích nhận roi và đi qua resolveRoi

select_within, zonal_elevation, elevation_profile, nearest nhận { roi, … }; bỏ bộ ba
geometry/feature/reference, bufferKm và lon/lat. Gần nhất tính từ trọng tâm và loại
chính đối tượng làm vùng. buffer giữ thân cũ cho buffer_feature nhưng nguồn cũng qua
resolveRoi; đường không bán kính giờ được tạo vùng đệm (độ lệch 1). Công cụ trợ lý dựng
Roi bên trong; web gửi hình vẽ dưới dạng { source: 'drawn' }.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Chọn trong vùng counts an admin unit by its stamped codes

**Files:**
- Modify: `apps/api/src/modules/analysis/ops/selectWithin.ts`, `apps/api/src/modules/analysis/analysis.test.ts`

**Interfaces:**
- Consumes: `RoiFacts.admin` (Task 2); `featuresInAdminUnitTool`.
- Produces: over an admin ROI, `select_within`'s summary gains `'Cách đếm': 'Theo mã hành chính đã gán'`, and its counts equal `features_in_admin_unit`'s (NFR-7).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/modules/analysis/analysis.test.ts`, after the `select_within` describe block (add `import { featuresInAdminUnitTool } from '../assistant/tools/data/featuresInAdminUnit';` and `import type { ToolContext } from '../assistant/tools/types';` to the imports):

```ts
describe('POST /api/analysis/select_within over an admin unit', () => {
  const inProvince = (code: string, layerKeys: string[]) =>
    post('select_within', { roi: { source: 'admin', level: 'province', code }, layerKeys });

  it('counts by the stamped codes: the same answer as the assistant, and says so', async () => {
    const ctx = {
      pool: getPool(), collect: () => undefined, provenance: () => undefined, role: 'viewer',
      mapContext: { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' },
    } as unknown as ToolContext;
    const tool = featuresInAdminUnitTool(ctx) as unknown as { run: (i: unknown) => Promise<string> };
    for (const layerKey of ['dams', 'rivers', 'lakes'] as const) {
      const res = await inProvince('66', [layerKey]);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary['Cách đếm']).toBe('Theo mã hành chính đã gán');
      const { count } = JSON.parse(await tool.run({ layerKey, code: '66' })) as { count: number };
      expect(body.summary['Tổng số'], layerKey).toBe(count);
    }
  }, 60_000);

  it('stays inside the budget over the largest province, all four layers', async () => {
    const started = Date.now();
    const res = await inProvince('68', ['dams', 'rivers', 'lakes', 'stations']);
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stays inside the budget over the longest river + 10 km, geometrically', async () => {
    const { rows: [river] } = await getPool().query<{ id: string }>(
      `SELECT id::text FROM water.rivers_active WHERE feature_level = 1
        ORDER BY ST_Length(geom::geography) DESC LIMIT 1`
    );
    const started = Date.now();
    const res = await post('select_within', {
      roi: { source: 'feature', layerKey: 'rivers', featureId: river.id, radiusKm: 10 },
      layerKeys: ['dams', 'rivers', 'lakes', 'stations'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary['Cách đếm']).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/api -- src/modules/analysis/analysis.test.ts -t "admin unit"`
Expected: FAIL — `summary['Cách đếm']` is undefined.

- [ ] **Step 3: Add the stamped-code path**

In `apps/api/src/modules/analysis/ops/selectWithin.ts`, change the resolve line to also take `facts`:

```ts
  const { resolved, geojson, facts } = await resolveRoi(db, input.roi as Roi);
```

and replace the `inArea` declaration with:

```ts
  // An admin unit is counted by the codes stamped on every feature (D11, FR-17): the
  // same method as the assistant's features_in_admin_unit, so the two answers agree
  // (NFR-7), and served by the GIN index — the geometric path over Lâm Đồng took 5.2 s
  // cold. The column name comes from the resolver's facts, never from request input.
  const inArea = facts.admin
    ? {
        sql: `${facts.admin.level === 'province' ? 'province_codes' : 'ward_codes'} && ARRAY[$1]::text[]`,
        param: facts.admin.code,
      }
    : { sql: `geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`, param: geojson };
```

and, after `summary['Diện tích vùng (km²)'] = …`, add:

```ts
  if (facts.admin) summary['Cách đếm'] = 'Theo mã hành chính đã gán';
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @webatlas/api -- src/modules/analysis` → green.
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.

- [ ] **Step 5: Prove the path is taken**

Temporarily change `const inArea = facts.admin ?` to `const inArea = false ?` (keep the rest). Re-run the file: the parity test FAILS on `'Cách đếm'`. Restore; green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/analysis/ops/selectWithin.ts apps/api/src/modules/analysis/analysis.test.ts
git commit -m "feat(api): chọn trong vùng đếm đơn vị hành chính theo mã đã gán

Cùng cách với features_in_admin_unit nên hai câu trả lời trùng nhau, và dùng chỉ mục
GIN thay cho phép giao hình (Lâm Đồng mất 5,2 s khi lạnh). Tóm tắt ghi 'Cách đếm'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Search's `admin` source

**Files:**
- Modify: `apps/api/src/modules/search/repository.ts`, `apps/api/src/modules/search/search.test.ts`

**Interfaces:**
- Produces: `GET /api/search?…&sources=admin` → hits `{ source: 'admin', layerKey: 'province' | 'ward', featureId: <code>, name, lonLat }`, only for the six working provinces and their 616 wards. Omitting `sources` still searches the four water layers only.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/modules/search/search.test.ts`:

```ts
describe('GET /api/search with the admin source', () => {
  const search = (q: string, sources?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(q)}${sources ? `&sources=${sources}` : ''}`,
    });
  type Hit = { source: string; layerKey: string; featureId: string; name: string; lonLat: number[] };

  it('finds a working-region province by name', async () => {
    const res = await search('Đắk Lắk', 'admin');
    expect(res.statusCode).toBe(200);
    const hit = (res.json().results as Hit[]).find((h) => h.featureId === '66');
    expect(hit).toMatchObject({ source: 'admin', layerKey: 'province', name: 'Tỉnh Đắk Lắk' });
    expect(hit!.lonLat).toHaveLength(2);
  });

  it('finds a ward', async () => {
    const res = await search('Tuy Hoà', 'admin');
    const hit = (res.json().results as Hit[]).find((h) => h.featureId === '22015');
    expect(hit).toMatchObject({ source: 'admin', layerKey: 'ward', name: 'Phường Tuy Hoà' });
  });

  it('never returns an admin unit outside the working region', async () => {
    const res = await search('Hà Nội', 'admin');
    expect((res.json().results as Hit[]).filter((h) => h.source === 'admin')).toEqual([]);
  });

  it('adds no admin hits unless asked', async () => {
    const res = await search('Đắk Lắk');
    expect((res.json().results as Hit[]).some((h) => h.source === 'admin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/api -- src/modules/search`
Expected: FAIL — `sources=admin` is a 400 ("Nguồn tìm kiếm không hợp lệ").

- [ ] **Step 3: Add the source**

In `apps/api/src/modules/search/repository.ts`:

- extend the imports: `import { REGION_PROVINCE_CODES, type AdminLevel, type EditableLayerKey } from '@webatlas/shared';` (replacing the existing `import type { EditableLayerKey } …` line);
- change `SearchHit`:
  ```ts
  export interface SearchHit {
    layerKey: EditableLayerKey | ReferenceLayerKey | AdminLevel;
    featureId: string;
    name: string;
    /** 'layer' = an editable water feature; 'reference' = a dissolved basemap entity;
     *  'admin' = a province or ward of the working region (featureId is its code). */
    source: 'layer' | 'reference' | 'admin';
    lonLat: [number, number];
  }
  ```
- add `'admin'` to `SEARCH_SOURCES`:
  ```ts
  export const SEARCH_SOURCES: readonly string[] = [
    ...SEARCHABLE,
    ...REFERENCE_LAYER_KEYS.map((k) => `${REFERENCE_PREFIX}${k}`),
    'admin',
  ];
  ```
- add, after `referenceSelect`:
  ```ts
  /**
   * The six working provinces and their 616 wards (spec §10). 622 rows: no index needed.
   * Only in-region units, because an ROI outside the region is refused anyway — a hit
   * that cannot be used would only mislead.
   */
  function adminSelect(): string {
    const codes = REGION_PROVINCE_CODES.map((c) => `'${c}'`).join(',');
    return `
        SELECT 'province'::text AS layer_key, 'admin'::text AS source, code AS feature_id,
               coalesce(full_name, name) AS name,
               ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
               GREATEST(similarity(name, $1), coalesce(similarity(full_name, $1), 0)) AS sim
          FROM admin.provinces
         WHERE code = ANY(ARRAY[${codes}]) AND (name % $1 OR full_name % $1)
        UNION ALL
        SELECT 'ward'::text, 'admin'::text, code, coalesce(full_name, name),
               ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom)),
               GREATEST(similarity(name, $1), coalesce(similarity(full_name, $1), 0))
          FROM admin.wards
         WHERE province_code = ANY(ARRAY[${codes}]) AND (name % $1 OR full_name % $1)`;
  }
  ```
- in `searchByName`, split `admin` out before the layer keys — replace
  ```ts
    const layerKeys = unique.filter((s) => !s.startsWith(REFERENCE_PREFIX)) as EditableLayerKey[];
  ```
  with
  ```ts
    const wantAdmin = unique.includes('admin');
    const layerKeys = unique.filter((s) => !s.startsWith(REFERENCE_PREFIX) && s !== 'admin') as EditableLayerKey[];
  ```
  and after `if (referenceKeys.length) selects.push(referenceSelect(referenceKeys));` add
  ```ts
    if (wantAdmin) selects.push(adminSelect());
  ```
- in the final `rows.map`, change the two casts to
  ```ts
      layerKey: r.layer_key as SearchHit['layerKey'],
      …
      source: r.source as SearchHit['source'],
  ```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @webatlas/api -- src/modules/search` → green.
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/search/repository.ts apps/api/src/modules/search/search.test.ts
git commit -m "feat(api): tìm kiếm có nguồn admin — tỉnh và xã/phường trong vùng công tác

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A clicked basemap segment → its whole entity

**Files:**
- Create: `apps/api/src/db/migrations/1000000000021_reference-member-index.cjs`
- Modify: `apps/api/src/modules/reference/repository.ts`, `apps/api/src/modules/reference/controller.ts`, `apps/api/src/modules/reference/reference.test.ts`

**Interfaces:**
- Produces: `GET /api/reference/:layer/entities?member=<osm_id>` → `{ entities: ReferenceEntity[] }`, every entity whose `member_ids` contains that id (possibly two: a segment tagged `QL.14;HCM` belongs to both routes). `listEntitiesByMember(pool, key, osmId)` in the repository.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/modules/reference/reference.test.ts` (add `import { buildReferenceLayer } from '../../db/referenceEntities';` and `import { getPool } from '../../db/pool';` if not already imported):

```ts
describe('GET /api/reference/:layer/entities?member=', () => {
  beforeAll(async () => { await buildReferenceLayer(getPool(), 'roads'); }, 300_000);

  it('finds the entity a clicked segment belongs to', async () => {
    const { rows: [e] } = await getPool().query<{ entity_id: string; member: string }>(
      `SELECT entity_id, member_ids[1] AS member FROM basemap.reference_entities
        WHERE layer_key = 'roads' ORDER BY entity_id LIMIT 1`
    );
    const res = await app.inject({ method: 'GET', url: `/api/reference/roads/entities?member=${e.member}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().entities.map((x: { entityId: string }) => x.entityId)).toContain(e.entity_id);
  });

  it('returns every entity sharing a segment (QL.14;HCM belongs to two routes)', async () => {
    const { rows: [shared] } = await getPool().query<{ member: string; n: number }>(
      `SELECT m AS member, count(*)::int AS n
         FROM basemap.reference_entities, unnest(member_ids) AS m
        WHERE layer_key = 'roads' GROUP BY m HAVING count(*) > 1 ORDER BY m LIMIT 1`
    );
    const res = await app.inject({ method: 'GET', url: `/api/reference/roads/entities?member=${shared.member}` });
    expect(res.json().entities).toHaveLength(shared.n);
  });

  it('400s a member that is not an OSM id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/roads/entities?member=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('is served by a GIN index created by migration 21', async () => {
    const { rows } = await getPool().query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'basemap' AND indexname = 'reference_entities_member_ids_gin'`
    );
    expect(rows).toHaveLength(1);
  });
});
```

(`app` is the Fastify instance the file already builds in its top-level `beforeAll`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/api -- src/modules/reference`
Expected: FAIL — `member` is ignored (the first test's list is the default top-50, which does not contain the entity), `member=abc` is 200, the index does not exist.

- [ ] **Step 3: The migration**

Create `apps/api/src/db/migrations/1000000000021_reference-member-index.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * GIN index on basemap.reference_entities.member_ids, for "which entity is the segment I
 * clicked part of" (the map popup's "Dùng làm vùng phân tích", Phase 4 spec §10). The
 * table is rebuilt by `npm run reference:build` with DELETE + INSERT, never dropped, so
 * the index survives every rebuild (migration 17 explains why this table, unlike the
 * loader's, can hold indexes at all).
 */
exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX IF NOT EXISTS reference_entities_member_ids_gin
             ON basemap.reference_entities USING GIN (member_ids)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS basemap.reference_entities_member_ids_gin`);
};
```

Run: `npm run migrate:up -w @webatlas/api` → "Migrations complete!".

- [ ] **Step 4: The lookup**

In `apps/api/src/modules/reference/repository.ts`, add after `listEntities`:

```ts
/**
 * Every entity of one layer containing this OSM segment. `@>` on the text[] column is
 * what the GIN index from migration 21 serves. Usually one; two where a segment carries
 * two routes (e.g. `QL.14;HCM`, see referenceEntities.ts).
 */
export async function listEntitiesByMember(
  pool: Pool,
  key: ReferenceLayerKey,
  osmId: string
): Promise<ReferenceEntity[]> {
  getReferenceLayer(key);
  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS} FROM basemap.reference_entities
      WHERE layer_key = $1 AND member_ids @> ARRAY[$2]::text[]
      ORDER BY member_count DESC, entity_id`,
    [key, osmId]
  );
  return rows.map(toEntity);
}
```

In `apps/api/src/modules/reference/controller.ts`:
- import it: `import { getEntity, listEntities, listEntitiesByMember } from './repository';`
- add to `ListQuery`: `member: z.string().regex(/^\d+$/, 'Mã OSM không hợp lệ').optional(),`
- replace the body of `referenceEntities` after `const layer = layerOf(req.params);` with:
  ```ts
    const { q, fclass, limit, member } = validate(ListQuery, req.query);
    // A member lookup answers "which entity is this segment part of" and ignores q/fclass.
    if (member) {
      reply.send({ entities: await listEntitiesByMember(req.server.pg, layer, member) });
      return;
    }
    const entities = await listEntities(req.server.pg, layer, {
      limit,
      ...(q ? { q } : {}),
      ...(fclass ? { fclass } : {}),
    });
    reply.send({ entities });
  ```

- [ ] **Step 5: Run the tests, and the migration round trip**

Run: `npm run test -w @webatlas/api -- src/modules/reference` → green.
Run: `npm run migrate:down -w @webatlas/api` then `npm run migrate:up -w @webatlas/api` → both "Migrations complete!"; re-run the reference tests → green.
Run: `cd apps/api && npx tsc --noEmit -p . ; cd ../..` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/1000000000021_reference-member-index.cjs apps/api/src/modules/reference
git commit -m "feat(api): tra thực thể nền bản đồ theo đoạn OSM được nhấp

Migration 21 thêm chỉ mục GIN trên member_ids; GET /api/reference/:layer/entities?member=
trả mọi thực thể chứa đoạn đó (QL.14;HCM thuộc hai tuyến).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The web ROI model

**Files:**
- Create: `apps/web/src/features/roi/api/roi.api.ts`, `apps/web/src/features/roi/model/{format,toolAvailability,roi.store}.ts` and a `.test.ts` beside each model file

**Interfaces:**
- Consumes: `POST /api/roi/resolve` (Task 3); `withRadius`, `Roi`, `ResolvedRoi` from `@webatlas/shared`.
- Produces:
  - `resolveRoi(roi): Promise<ResolvedRoi>` (api);
  - `formatMeasure(measure): string | null`, `formatKm2(n): string`, `KIND_LABELS: Record<RoiKind, string>` (format);
  - `RoiTool = 'select_within' | 'zonal_elevation' | 'elevation_profile' | 'nearest'`, `ROI_TOOLS`, `Availability`, `toolAvailability(tool, resolved | null)`, `MAX_ZONAL_AREA_KM2` (availability);
  - `RoiState`, `RoiStatus`, `RoiDrawKind = 'Polygon' | 'Box' | 'LineString' | 'Point'`, `RoiFit = boolean | 'ifOutside'`, and `setRoi(roi, { fit })`, `setRadius(km | null)`, `clearRoi()`, `startDrawing(kind)`, `stopDrawing()`, `setRoiHint(text | null)`, `dismissRoiMessage()`, `getRoiState()`, `useRoi()`, plus test hooks `setRoiResolver(fn)` and `resetRoiStore()` (store).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/roi/model/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatKm2, formatMeasure, KIND_LABELS } from './format';

describe('formatMeasure', () => {
  it('writes areas and lengths the Vietnamese way', () => {
    expect(formatMeasure({ areaKm2: 1204.3 })).toBe('1.204 km²');
    expect(formatMeasure({ lengthKm: 212.4 })).toBe('212 km');
    expect(formatMeasure({ areaKm2: 3.14159 })).toBe('3,14 km²');
    expect(formatMeasure(null)).toBeNull();
  });
  it('formats a bare km² figure for reasons', () => {
    expect(formatKm2(18086.4)).toBe('18.086');
  });
  it('names the kinds', () => {
    expect(KIND_LABELS).toEqual({ area: 'vùng', line: 'đường', point: 'điểm' });
  });
});
```

Create `apps/web/src/features/roi/model/toolAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ResolvedRoi } from '@webatlas/shared';
import { toolAvailability, ROI_TOOLS } from './toolAvailability';

const base = { label: 'x', display: { type: 'Point', coordinates: [108, 13] }, bbox: [108, 13, 108, 13], centroid: [108, 13] } as const;
const area = (areaKm2: number): ResolvedRoi => ({ ...base, kind: 'area', measure: { areaKm2 } } as ResolvedRoi);
const line = { ...base, kind: 'line', measure: { lengthKm: 10 } } as ResolvedRoi;
const point = { ...base, kind: 'point', measure: null } as ResolvedRoi;
const off = (reason: string) => ({ enabled: false, reason });
const ON = { enabled: true };

describe('toolAvailability — spec §8, cell by cell', () => {
  it('disables everything with no ROI', () => {
    for (const tool of ROI_TOOLS) expect(toolAvailability(tool, null)).toEqual(off('Chưa có vùng phân tích'));
  });
  it('Chọn trong vùng', () => {
    expect(toolAvailability('select_within', area(10))).toEqual(ON);
    expect(toolAvailability('select_within', line)).toEqual(off('Thêm bán kính để dùng cho đường này'));
    expect(toolAvailability('select_within', point)).toEqual(off('Thêm bán kính để dùng cho điểm này'));
  });
  it('Thống kê độ cao', () => {
    expect(toolAvailability('zonal_elevation', area(5000))).toEqual(ON);
    expect(toolAvailability('zonal_elevation', area(18086.4)))
      .toEqual(off('Vùng 18.086 km² vượt giới hạn 5.000 km² của thống kê độ cao'));
    expect(toolAvailability('zonal_elevation', line)).toEqual(off('Cần một vùng — thêm bán kính'));
    expect(toolAvailability('zonal_elevation', point)).toEqual(off('Cần một vùng — thêm bán kính'));
  });
  it('Trắc diện độ cao', () => {
    expect(toolAvailability('elevation_profile', line)).toEqual(ON);
    expect(toolAvailability('elevation_profile', area(10))).toEqual(off('Cần một đường, ví dụ một con sông'));
    expect(toolAvailability('elevation_profile', point)).toEqual(off('Cần một đường, ví dụ một con sông'));
  });
  it('Gần nhất works on every kind (from the centroid)', () => {
    for (const r of [area(10), line, point]) expect(toolAvailability('nearest', r)).toEqual(ON);
  });
});
```

Create `apps/web/src/features/roi/model/roi.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import {
  clearRoi, dismissRoiMessage, getRoiState, resetRoiStore, setRadius, setRoi, setRoiHint,
  setRoiResolver, startDrawing, stopDrawing,
} from './roi.store';

const line: ResolvedRoi = {
  label: 'Sông Ba', kind: 'line', measure: { lengthKm: 352 },
  display: { type: 'LineString', coordinates: [[108, 13], [108.1, 13.1]] },
  bbox: [108, 13, 108.1, 13.1], centroid: [108.05, 13.05],
};
const buffered: ResolvedRoi = { ...line, label: 'Sông Ba + 5 km', kind: 'area', measure: { areaKm2: 2882 } };
const river: Roi = { source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true };

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

beforeEach(() => resetRoiStore());

describe('roi.store', () => {
  it('starts empty', () => {
    expect(getRoiState()).toMatchObject({ roi: null, resolved: null, status: 'empty', error: null });
  });

  it('resolves a pick and keeps it with its fit mode', async () => {
    setRoiResolver(vi.fn().mockResolvedValue(line));
    const pending = setRoi(river, { fit: true });
    expect(getRoiState().status).toBe('resolving');
    await pending;
    expect(getRoiState()).toMatchObject({ roi: river, resolved: line, status: 'ready', fit: true });
  });

  it('keeps the previous ROI when a new pick fails, and shows the reason (FR-14)', async () => {
    setRoiResolver(vi.fn().mockResolvedValueOnce(line)
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Vùng phân tích quá lớn')));
    await setRoi(river, { fit: true });
    await setRoi({ source: 'admin', level: 'province', code: '68' }, { fit: true });
    expect(getRoiState()).toMatchObject({ roi: river, resolved: line, status: 'ready', error: 'Vùng phân tích quá lớn' });
    dismissRoiMessage();
    expect(getRoiState().error).toBeNull();
  });

  it('ignores a slower, older pick that resolves after a newer one', async () => {
    const first = deferred<ResolvedRoi>(); const second = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const a = setRoi(river, { fit: true });
    const b = setRoi({ ...river, featureId: 'r2' }, { fit: true });
    second.resolve(buffered); await b;
    first.resolve(line); await a;
    expect(getRoiState().resolved).toBe(buffered);
  });

  it('adds and removes a radius through the resolver, refitting only if needed', async () => {
    const resolver = vi.fn().mockResolvedValueOnce(line).mockResolvedValueOnce(buffered).mockResolvedValueOnce(line);
    setRoiResolver(resolver);
    await setRoi(river, { fit: true });
    await setRadius(5);
    expect(resolver).toHaveBeenLastCalledWith({ ...river, radiusKm: 5 });
    expect(getRoiState()).toMatchObject({ resolved: buffered, fit: 'ifOutside' });
    await setRadius(null);
    expect(resolver).toHaveBeenLastCalledWith(river);
  });

  it('clears, and a clear wins over a pick still in flight', async () => {
    const pending = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValue(pending.promise));
    const p = setRoi(river, { fit: true });
    clearRoi();
    pending.resolve(line); await p;
    expect(getRoiState()).toMatchObject({ roi: null, resolved: null, status: 'empty' });
  });

  it('tracks drawing and returns to the settled state when it stops', async () => {
    setRoiResolver(vi.fn().mockResolvedValue(line));
    startDrawing('Polygon');
    expect(getRoiState()).toMatchObject({ status: 'drawing', drawKind: 'Polygon' });
    stopDrawing();
    expect(getRoiState()).toMatchObject({ status: 'empty', drawKind: null });
    await setRoi(river, { fit: false });
    startDrawing('Box'); stopDrawing();
    expect(getRoiState().status).toBe('ready');
  });

  it('holds a neutral hint separately from errors (U-2)', () => {
    setRoiHint('Cần một đường, ví dụ một con sông');
    expect(getRoiState()).toMatchObject({ hint: 'Cần một đường, ví dụ một con sông', error: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/web -- src/features/roi`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Write the modules**

Create `apps/web/src/features/roi/api/roi.api.ts`:

```ts
import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export function resolveRoi(roi: Roi): Promise<ResolvedRoi> {
  return apiRequest<ResolvedRoi>('/api/roi/resolve', { method: 'POST', body: JSON.stringify({ roi }) });
}
```

Create `apps/web/src/features/roi/model/format.ts`:

```ts
import type { RoiKind, RoiMeasure } from '@webatlas/shared';

const nf = (maxDigits: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: maxDigits });

/** Two decimals below 10, none above: "3,14 km²", "1.204 km²", "212 km". */
export function formatMeasure(measure: RoiMeasure): string | null {
  if (!measure) return null;
  if ('areaKm2' in measure) return `${nf(measure.areaKm2 < 10 ? 2 : 0).format(measure.areaKm2)} km²`;
  return `${nf(measure.lengthKm < 10 ? 2 : 0).format(measure.lengthKm)} km`;
}

/** A whole km² figure for reasons: "18.086". */
export function formatKm2(areaKm2: number): string {
  return nf(0).format(Math.round(areaKm2));
}

export const KIND_LABELS: Record<RoiKind, string> = { area: 'vùng', line: 'đường', point: 'điểm' };
```

Create `apps/web/src/features/roi/model/toolAvailability.ts`:

```ts
import type { ResolvedRoi } from '@webatlas/shared';
import { formatKm2 } from './format';

export type RoiTool = 'select_within' | 'zonal_elevation' | 'elevation_profile' | 'nearest';
export const ROI_TOOLS: readonly RoiTool[] = ['select_within', 'zonal_elevation', 'elevation_profile', 'nearest'];

/** Mirrors apps/api/src/modules/analysis/ops/zonalElevation.ts's ceiling (spec C-3). */
export const MAX_ZONAL_AREA_KM2 = 5000;

export type Availability = { enabled: true } | { enabled: false; reason: string };

const ON: Availability = { enabled: true };
const off = (reason: string): Availability => ({ enabled: false, reason });

/**
 * Spec §8's availability table as one pure function (FR-7). Every disabled reason names
 * what would enable the tool (U-10).
 */
export function toolAvailability(tool: RoiTool, roi: ResolvedRoi | null): Availability {
  if (!roi) return off('Chưa có vùng phân tích');
  switch (tool) {
    case 'select_within':
      return roi.kind === 'area' ? ON : off(`Thêm bán kính để dùng cho ${roi.kind === 'line' ? 'đường' : 'điểm'} này`);
    case 'zonal_elevation': {
      if (roi.kind !== 'area') return off('Cần một vùng — thêm bán kính');
      const areaKm2 = (roi.measure as { areaKm2: number }).areaKm2;
      return areaKm2 > MAX_ZONAL_AREA_KM2
        ? off(`Vùng ${formatKm2(areaKm2)} km² vượt giới hạn ${formatKm2(MAX_ZONAL_AREA_KM2)} km² của thống kê độ cao`)
        : ON;
    }
    case 'elevation_profile':
      return roi.kind === 'line' ? ON : off('Cần một đường, ví dụ một con sông');
    case 'nearest':
      return ON;
  }
}
```

Create `apps/web/src/features/roi/model/roi.store.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { withRadius, type ResolvedRoi, type Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { resolveRoi } from '../api/roi.api';

export type RoiDrawKind = 'Polygon' | 'Box' | 'LineString' | 'Point';
export type RoiStatus = 'empty' | 'drawing' | 'resolving' | 'ready';
/** How the map frames a newly resolved ROI (U-5): always, never, or only if it is off screen. */
export type RoiFit = boolean | 'ifOutside';

export interface RoiState {
  roi: Roi | null;
  resolved: ResolvedRoi | null;
  status: RoiStatus;
  /** Why the last pick failed. The previous ROI is kept (FR-14). */
  error: string | null;
  /** A neutral message — e.g. why a pressed tool is disabled (U-2). */
  hint: string | null;
  drawKind: RoiDrawKind | null;
  fit: RoiFit;
}

const EMPTY: RoiState = {
  roi: null, resolved: null, status: 'empty', error: null, hint: null, drawKind: null, fit: false,
};

/**
 * The one active ROI (D1). A module store, like analysisResult.store.ts, so the popup,
 * search, result cards and the toolbar all read and set it without prop-drilling.
 */
let state: RoiState = EMPTY;
const listeners = new Set<() => void>();
function publish(next: RoiState) { state = next; for (const l of listeners) l(); }
function update(patch: Partial<RoiState>) { publish({ ...state, ...patch }); }

let resolver: (roi: Roi) => Promise<ResolvedRoi> = resolveRoi;
/** Each pick bumps this; a response for an older pick is dropped. */
let seq = 0;

/** Tests only. */
export function setRoiResolver(fn: (roi: Roi) => Promise<ResolvedRoi>): void { resolver = fn; }
/** Tests only. */
export function resetRoiStore(): void { seq++; resolver = resolveRoi; publish(EMPTY); }

export async function setRoi(roi: Roi, opts: { fit: RoiFit }): Promise<void> {
  const mine = ++seq;
  const kept = { roi: state.roi, resolved: state.resolved };
  update({ status: 'resolving', error: null, hint: null, drawKind: null });
  try {
    const resolved = await resolver(roi);
    if (mine !== seq) return;
    update({ roi, resolved, status: 'ready', fit: opts.fit });
  } catch (e) {
    if (mine !== seq) return;
    update({
      ...kept,
      status: kept.resolved ? 'ready' : 'empty',
      error: e instanceof ApiError ? e.message : 'Không xác định được vùng phân tích.',
    });
  }
}

/** A radius turns a line or point into an area; null returns it to the line or point. */
export function setRadius(radiusKm: number | null): Promise<void> {
  if (!state.roi) return Promise.resolve();
  return setRoi(withRadius(state.roi, radiusKm), { fit: 'ifOutside' });
}

export function clearRoi(): void { seq++; publish(EMPTY); }
export function startDrawing(kind: RoiDrawKind): void { update({ status: 'drawing', drawKind: kind, error: null, hint: null }); }
export function stopDrawing(): void { update({ status: state.resolved ? 'ready' : 'empty', drawKind: null }); }
export function setRoiHint(hint: string | null): void { update({ hint }); }
export function dismissRoiMessage(): void { update({ error: null, hint: null }); }

export function getRoiState(): RoiState { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useRoi(): RoiState { return useSyncExternalStore(subscribe, getRoiState, getRoiState); }
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @webatlas/web -- src/features/roi` → green.
Run: `npm run build:web` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/roi
git commit -m "feat(web): mô hình vùng phân tích — kho, bảng khả dụng công cụ, định dạng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The ROI on the map, and the chip

**Files:**
- Modify: `packages/shared/src/map-commands.ts`, `packages/shared/src/map-commands.test.ts`, `apps/web/src/features/map/model/mapCommands.ts`, `apps/web/src/features/map/ui/MapToolbar.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/styles/main.css`
- Create: `apps/web/src/features/map/model/roiLayer.ts` (+ `.test.ts`), `apps/web/src/features/map/model/useMapCommands.ts`, `apps/web/src/features/roi/ui/RoiChip.view.tsx` (+ `.test.tsx`), `apps/web/src/features/roi/ui/RoiChip.tsx`

**Interfaces:**
- Consumes: Task 8's store and format.
- Produces:
  - `MapCommand` kinds `{ kind: 'showRoi'; geometry: GeoJsonGeometry; label: string; fit?: boolean | 'ifOutside' }` and `{ kind: 'clearRoi' }`;
  - `drawRoi(map, geometry, label, fit)`, `eraseRoi(map)`, `getRoiLayer(map)`, `ROI_LAYER_ID = 'layer_roi'` (roiLayer);
  - `useMapCommands(): (cmd: MapCommand) => CommandResult`;
  - `RoiChipView` props `{ state, drawHint?, liveMeasure?, onRadius, onClear, onDismiss }`; default export `RoiChip` (container, props `{ drawHint?, liveMeasure? }`);
  - `MapToolbarView` / `MapToolbar` prop `roiChip?: ReactNode`, rendered between the panel and the toolbar (U-8).

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/map-commands.test.ts`, replace the array inside `it('lists every kind in MAP_COMMAND_KINDS', …)` with:

```ts
      'clearHighlights', 'clearRoi', 'highlightFeatures', 'proposeFeatureEdit', 'resetView', 'setBasemap',
      'setLayerOpacity', 'setLayerVisible', 'showGeometries', 'showRoi', 'zoomTo', 'zoomToFeature', 'zoomToRegion',
```

and add, inside `describe('isMapCommand', …)`:

```ts
  it('accepts showRoi with a geometry, a label and a fit mode', () => {
    const geometry = { type: 'Point' as const, coordinates: [108, 13] };
    expect(isMapCommand({ kind: 'showRoi', geometry, label: 'Đập A' })).toBe(true);
    expect(isMapCommand({ kind: 'showRoi', geometry, label: 'Đập A', fit: 'ifOutside' })).toBe(true);
    expect(isMapCommand({ kind: 'showRoi', geometry, label: 'Đập A', fit: 'sometimes' })).toBe(false);
    expect(isMapCommand({ kind: 'showRoi', label: 'Đập A' })).toBe(false);
  });

  it('accepts clearRoi', () => {
    expect(isMapCommand({ kind: 'clearRoi' })).toBe(true);
  });
```

Create `apps/web/src/features/map/model/roiLayer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import { ROI_LAYER_ID, drawRoi, eraseRoi, getRoiLayer } from './roiLayer';

function makeMap(): Map {
  const el = document.createElement('div');
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
const point = { type: 'Point' as const, coordinates: [108.05, 12.68] };

describe('roiLayer', () => {
  it('draws the ROI on its own layer and replaces it on the next call', () => {
    const map = makeMap();
    drawRoi(map, point, 'Đập A', false);
    drawRoi(map, point, 'Đập B', false);
    const layer = getRoiLayer(map)!;
    expect(layer.get('id')).toBe(ROI_LAYER_ID);
    const features = layer.getSource()!.getFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].get('label')).toBe('Đập B');
  });

  it('fits only when asked', () => {
    const map = makeMap();
    const fit = vi.spyOn(map.getView(), 'fit');
    drawRoi(map, point, 'Đập A', false);
    expect(fit).not.toHaveBeenCalled();
    drawRoi(map, point, 'Đập A', true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('erases, leaving the empty layer in place', () => {
    const map = makeMap();
    drawRoi(map, point, 'Đập A', false);
    eraseRoi(map);
    expect(getRoiLayer(map)!.getSource()!.getFeatures()).toHaveLength(0);
  });
});
```

Create `apps/web/src/features/roi/ui/RoiChip.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResolvedRoi } from '@webatlas/shared';
import type { RoiState } from '../model/roi.store';
import { RoiChipView } from './RoiChip.view';

const line: ResolvedRoi = {
  label: 'Sông Thu Bồn', kind: 'line', measure: { lengthKm: 212.4 },
  display: { type: 'LineString', coordinates: [[108, 15], [108.1, 15.1]] }, bbox: [108, 15, 108.1, 15.1], centroid: [108.05, 15.05],
};
const base: RoiState = { roi: null, resolved: null, status: 'empty', error: null, hint: null, drawKind: null, fit: false };
const ready: RoiState = {
  ...base, status: 'ready', resolved: line,
  roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true },
};
const handlers = () => ({ onRadius: vi.fn(), onClear: vi.fn(), onDismiss: vi.fn() });

describe('RoiChipView — the five states (U-3)', () => {
  it('empty: says how to set one', () => {
    render(<RoiChipView state={base} {...handlers()} />);
    expect(screen.getByText(/Chưa có vùng phân tích/)).toBeInTheDocument();
  });

  it('drawing: shows the hint for the kind, and a live measure when given', () => {
    render(<RoiChipView state={{ ...base, status: 'drawing', drawKind: 'Polygon' }} liveMeasure="3,2 km²" {...handlers()} />);
    expect(screen.getByText(/nhấp đúp để kết thúc/)).toBeInTheDocument();
    expect(screen.getByText('3,2 km²')).toBeInTheDocument();
  });

  it('resolving: says so', () => {
    render(<RoiChipView state={{ ...base, status: 'resolving' }} {...handlers()} />);
    expect(screen.getByText('Đang xác định vùng…')).toBeInTheDocument();
  });

  it('ready: label, kind, measure, radius and clear', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    expect(screen.getByText('Sông Thu Bồn')).toBeInTheDocument();
    expect(screen.getByText('· đường · 212 km')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ vùng phân tích' }));
    expect(h.onClear).toHaveBeenCalled();
  });

  it('error: keeps the ROI and shows the reason, dismissible', async () => {
    const h = handlers();
    render(<RoiChipView state={{ ...ready, error: 'Vùng phân tích quá lớn' }} {...h} />);
    expect(screen.getByText('Sông Thu Bồn')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Vùng phân tích quá lớn');
    await userEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(h.onDismiss).toHaveBeenCalled();
  });
});

describe('RoiChipView — the radius editor (U-4)', () => {
  it('offers a radius only for a line or point, or to change an existing one', () => {
    const { rerender } = render(<RoiChipView state={ready} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Bán kính' })).toBeInTheDocument();
    const area = { ...line, kind: 'area' as const, measure: { areaKm2: 18086 } };
    rerender(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'admin', level: 'province', code: '66' } }} {...handlers()} />);
    expect(screen.queryByRole('button', { name: 'Bán kính' })).toBeNull();
    rerender(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', radiusKm: 5 } }} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Bán kính: 5 km' })).toBeInTheDocument();
  });

  it('applies a preset, a typed value with Enter, and cancels with Esc', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    await userEvent.click(screen.getByRole('button', { name: '2 km' }));
    expect(h.onRadius).toHaveBeenLastCalledWith(2);

    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    const input = screen.getByRole('spinbutton', { name: 'Bán kính (km)' });
    await userEvent.clear(input);
    await userEvent.type(input, '7.5{Enter}');
    expect(h.onRadius).toHaveBeenLastCalledWith(7.5);

    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('refuses a radius outside (0, 100]', async () => {
    const h = handlers();
    render(<RoiChipView state={ready} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính' }));
    const input = screen.getByRole('spinbutton', { name: 'Bán kính (km)' });
    await userEvent.clear(input);
    await userEvent.type(input, '150{Enter}');
    expect(h.onRadius).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Áp dụng bán kính' })).toBeDisabled();
  });

  it('removes an existing radius', async () => {
    const h = handlers();
    const area = { ...line, kind: 'area' as const, measure: { areaKm2: 896 } };
    render(<RoiChipView state={{ ...ready, resolved: area, roi: { source: 'feature', layerKey: 'rivers', featureId: 'r1', radiusKm: 5 } }} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bán kính: 5 km' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ bán kính' }));
    expect(h.onRadius).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/shared -- map-commands` → FAIL (kinds list, `showRoi` rejected).
Run: `npm run test -w @webatlas/web -- src/features/map/model/roiLayer src/features/roi/ui` → FAIL (modules missing).

- [ ] **Step 3: The commands**

In `packages/shared/src/map-commands.ts`:
- add `'showRoi',` and `'clearRoi',` to `MAP_COMMAND_KINDS` after `'showGeometries',`;
- add to the `MapCommand` union, after the `showGeometries` member:
  ```ts
    /** The active ROI's outline on its own layer (Phase 4). `fit: 'ifOutside'` frames it
     *  only if it has left the viewport — used after a radius change (U-5). */
    | { kind: 'showRoi'; geometry: GeoJsonGeometry; label: string; fit?: boolean | 'ifOutside' }
    | { kind: 'clearRoi' }
  ```
- add to `isMapCommand`'s switch, after `case 'showGeometries': {…}`:
  ```ts
      case 'showRoi':
        return (
          isGeoJsonGeometry(c.geometry) &&
          countVertices(c.geometry) <= MAX_RESULT_VERTICES &&
          typeof c.label === 'string' &&
          (c.fit === undefined || typeof c.fit === 'boolean' || c.fit === 'ifOutside')
        );
      case 'clearRoi':
        return true;
  ```

Run: `npm run test -w @webatlas/shared` → green. Run: `npm run build:shared` → exit 0.

- [ ] **Step 4: The layer and the executor**

Create `apps/web/src/features/map/model/roiLayer.ts`:

```ts
import type { Map } from 'ol';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { containsExtent } from 'ol/extent';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { GeoJsonGeometry } from '@webatlas/shared';

/** Not a LAYER_STATE_ID: the ROI is not a data layer the user toggles. */
export const ROI_LAYER_ID = 'layer_roi';

// U-7: dark dashed outline, faint fill — distinct from the blue drawing sketch and the
// amber/blue result highlights (highlightLayer.ts).
const stroke = new Stroke({ color: '#1f2937', width: 2.5, lineDash: [10, 6] });
const fill = new Fill({ color: 'rgba(31, 41, 55, 0.08)' });
const style = (feature: { get: (k: string) => unknown }) =>
  new Style({
    stroke,
    fill,
    image: new Circle({ radius: 8, fill: new Fill({ color: 'rgba(31, 41, 55, 0.25)' }), stroke }),
    text: new Text({
      text: (feature.get('label') as string | undefined) ?? '',
      offsetY: -18,
      font: '600 12px sans-serif',
      fill: new Fill({ color: '#111827' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
    }),
  });

const layers = new WeakMap<Map, VectorLayer<VectorSource>>();
const format = new GeoJSON();

function ensureLayer(map: Map): VectorLayer<VectorSource> {
  const existing = layers.get(map);
  if (existing) return existing;
  // Below the analysis results (998) and highlights (999): a result drawn inside the ROI
  // must stay visible on top of it.
  const layer = new VectorLayer({ source: new VectorSource(), style, properties: { id: ROI_LAYER_ID }, zIndex: 997 });
  map.addLayer(layer);
  layers.set(map, layer);
  return layer;
}

export function getRoiLayer(map: Map): VectorLayer<VectorSource> | undefined {
  return layers.get(map);
}

/** Replaces the drawn ROI. `fit`: always, never, or only if it is not wholly in view. */
export function drawRoi(map: Map, geometry: GeoJsonGeometry, label: string, fit: boolean | 'ifOutside'): void {
  const source = ensureLayer(map).getSource()!;
  source.clear();
  const g = format.readGeometry(geometry, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
  source.addFeature(new Feature({ geometry: g, label }));
  const view = map.getView();
  const size = map.getSize();
  const inView = size ? containsExtent(view.calculateExtent(size), g.getExtent()) : false;
  if (fit === true || (fit === 'ifOutside' && !inView)) {
    // Bottom padding clears the toolbar, the chip and a result card.
    view.fit(g.getExtent(), { padding: [80, 80, 200, 80], maxZoom: 13, duration: 400 });
  }
}

export function eraseRoi(map: Map): void {
  layers.get(map)?.getSource()?.clear();
}
```

In `apps/web/src/features/map/model/mapCommands.ts`, add `import { drawRoi, eraseRoi } from './roiLayer';` and, after `case 'showGeometries': {…}`:

```ts
      case 'showRoi': {
        if (!deps.map) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        drawRoi(deps.map, cmd.geometry, cmd.label, cmd.fit ?? false);
        return { ok: true, text: `Đã đặt vùng phân tích: ${cmd.label}.` };
      }
      case 'clearRoi': {
        if (deps.map) eraseRoi(deps.map);
        return { ok: true, text: 'Đã bỏ vùng phân tích.' };
      }
```

Create `apps/web/src/features/map/model/useMapCommands.ts`:

```ts
import { useMemo } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { createCommandExecutor } from './mapCommands';

/** The command executor wired to the live map — the same wiring MapToolbar and
 *  features/analysis build by hand, in one place for the new ROI components. */
export function useMapCommands() {
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();
  return useMemo(
    () =>
      createCommandExecutor({
        map, setBasemap, toggleLayerVisibility, setLayerOpacity,
        getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
        layerExists: (id) => layersState.some((l) => l.id === id),
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState]
  );
}
```

- [ ] **Step 5: The chip**

Create `apps/web/src/features/roi/ui/RoiChip.view.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { ROI_MAX_RADIUS_KM, type Roi } from '@webatlas/shared';
import { KIND_LABELS, formatMeasure } from '../model/format';
import type { RoiDrawKind, RoiState } from '../model/roi.store';

const DRAW_HINTS: Record<RoiDrawKind, string> = {
  Polygon: 'Nhấp để vẽ · nhấp đúp hoặc Enter để kết thúc · Backspace xoá điểm · Esc để huỷ',
  Box: 'Nhấp hai góc đối nhau · Esc để huỷ',
  LineString: 'Nhấp để vẽ · nhấp đúp hoặc Enter để kết thúc · Backspace xoá điểm · Esc để huỷ',
  Point: 'Nhấp để chọn điểm · Esc để huỷ',
};
const PRESETS = [1, 2, 5, 10];

function radiusOf(roi: Roi | null): number | null {
  return roi && roi.source !== 'admin' ? roi.radiusKm ?? null : null;
}
const validRadius = (n: number) => Number.isFinite(n) && n > 0 && n <= ROI_MAX_RADIUS_KM;

export interface RoiChipViewProps {
  state: RoiState;
  /** While drawing, the aid's current hint (U-11), overriding the default for the kind. */
  drawHint?: string | null;
  liveMeasure?: string | null;
  onRadius: (km: number | null) => void;
  onClear: () => void;
  onDismiss: () => void;
}

/** The ROI chip above the toolbar: its five states (U-3) and the radius editor (U-4). */
export function RoiChipView({ state, drawHint, liveMeasure, onRadius, onClear, onDismiss }: RoiChipViewProps) {
  const [editing, setEditing] = useState(false);
  const current = radiusOf(state.roi);
  const [draft, setDraft] = useState(String(current ?? 5));
  const r = state.resolved;
  const canRadius = !!r && (r.kind !== 'area' || current !== null);

  const apply = (km: number | null) => {
    if (km !== null && !validRadius(km)) return;
    setEditing(false);
    onRadius(km);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply(Number(draft));
    if (e.key === 'Escape') setEditing(false);
  };

  let body;
  if (state.status === 'drawing' && state.drawKind) {
    body = (
      <>
        <span className="roi-chip-muted">{drawHint ?? DRAW_HINTS[state.drawKind]}</span>
        {liveMeasure && <span className="roi-chip-measure">{liveMeasure}</span>}
      </>
    );
  } else if (state.status === 'resolving') {
    body = (<><span className="roi-chip-spinner" aria-hidden="true" /><span className="roi-chip-muted">Đang xác định vùng…</span></>);
  } else if (!r) {
    body = (
      <span className="roi-chip-muted">
        Chưa có vùng phân tích — vẽ một hình, hoặc chọn một đối tượng trên bản đồ hay trong tìm kiếm
      </span>
    );
  } else if (editing) {
    body = (
      <>
        <b className="roi-chip-label" title={r.label}>{r.label}</b>
        <span className="roi-chip-muted">+</span>
        <input
          type="number" min={0.1} max={ROI_MAX_RADIUS_KM} step={0.1} value={draft} autoFocus
          aria-label="Bán kính (km)" onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
        />
        <span className="roi-chip-muted">km</span>
        {PRESETS.map((km) => (
          <button key={km} type="button" aria-label={`${km} km`} onClick={() => apply(km)}>{km}</button>
        ))}
        <button type="button" aria-label="Áp dụng bán kính" disabled={!validRadius(Number(draft))} onClick={() => apply(Number(draft))}>✓</button>
        {current !== null && <button type="button" onClick={() => apply(null)}>Bỏ bán kính</button>}
      </>
    );
  } else {
    const measure = formatMeasure(r.measure);
    body = (
      <>
        <span className="roi-chip-muted">Vùng phân tích:</span>
        <b className="roi-chip-label" title={r.label}>{r.label}</b>
        <span className="roi-chip-measure">{`· ${KIND_LABELS[r.kind]}${measure ? ` · ${measure}` : ''}`}</span>
        {canRadius && (
          <button type="button" onClick={() => { setDraft(String(current ?? 5)); setEditing(true); }}>
            {current === null ? 'Bán kính' : `Bán kính: ${current} km`}
          </button>
        )}
        <button type="button" aria-label="Bỏ vùng phân tích" onClick={onClear}>✕</button>
      </>
    );
  }

  return (
    <div className="roi-chip glass-panel" role="status">
      {body}
      {(state.error || state.hint) && (
        <>
          <span className={state.error ? 'roi-chip-error' : 'roi-chip-muted'} role={state.error ? 'alert' : undefined}>
            {state.error ?? state.hint}
          </span>
          <button type="button" aria-label="Đóng thông báo" onClick={onDismiss}>×</button>
        </>
      )}
    </div>
  );
}
```

Create `apps/web/src/features/roi/ui/RoiChip.tsx`:

```tsx
import { useEffect } from 'react';
import { useMapCommands } from '../../map/model/useMapCommands';
import { clearRoi, dismissRoiMessage, setRadius, useRoi } from '../model/roi.store';
import { RoiChipView } from './RoiChip.view';

/** Container: renders the chip and keeps the map's ROI layer in step with the store. */
export default function RoiChip({ drawHint, liveMeasure }: { drawHint?: string | null; liveMeasure?: string | null }) {
  const state = useRoi();
  const run = useMapCommands();
  const { resolved, fit } = state;
  useEffect(() => {
    if (resolved) run({ kind: 'showRoi', geometry: resolved.display, label: resolved.label, fit });
    else run({ kind: 'clearRoi' });
    // Only a new resolution redraws; `fit` travels with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, run]);
  return (
    <RoiChipView
      state={state} drawHint={drawHint} liveMeasure={liveMeasure}
      onRadius={(km) => void setRadius(km)} onClear={clearRoi} onDismiss={dismissRoiMessage}
    />
  );
}
```

In `apps/web/src/features/map/ui/MapToolbar.tsx`:
- add `roiChip?: ReactNode;` to `MapToolbarViewProps` (after `analysisPanel`), destructure it in `MapToolbarView`, and render it right after `{analysisPanel}`:
  ```tsx
        {analysisPanel}

        {roiChip}
  ```
- add `roiChip` to the container's props type (`{ flyoutOpen: boolean; analysisButtons?: ReactNode; analysisPanel?: ReactNode; roiChip?: ReactNode }`), destructure it, and pass `roiChip={roiChip}` to `MapToolbarView`.

In `apps/web/src/app/App.tsx`, add `import RoiChip from '../features/roi/ui/RoiChip';` and pass `roiChip={<RoiChip />}` to `<MapToolbar … />`.

Append to `apps/web/src/styles/main.css`:

```css
/* Vùng phân tích (Phase 4) */
.roi-chip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 12px; border-radius: 999px;
  font-size: 13px; max-width: min(680px, calc(100% - var(--space-4))); }
.roi-chip-label { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.roi-chip-muted { color: var(--text-muted, #6b7280); }
.roi-chip-measure { color: var(--text-muted, #6b7280); white-space: nowrap; }
.roi-chip-error { color: #b91c1c; }
.roi-chip button { background: none; border: none; color: var(--primary); cursor: pointer; padding: 2px 4px; font: inherit; }
.roi-chip button:disabled { color: var(--text-muted, #6b7280); cursor: not-allowed; }
.roi-chip input { width: 64px; }
.roi-chip-spinner { width: 12px; height: 12px; border: 2px solid #93c5fd; border-top-color: #2563eb; border-radius: 50%;
  animation: roi-spin 0.8s linear infinite; }
@keyframes roi-spin { to { transform: rotate(360deg); } }
.control-group-label { font-size: 10px; color: var(--text-muted, #6b7280); margin-right: 2px; white-space: nowrap; }
.control-btn[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
@media (max-width: 600px) {
  .control-group-label { display: none; }
  .roi-chip-label { max-width: 140px; }
}
```

- [ ] **Step 6: Run everything**

Run: `npm run test -w @webatlas/web` → green (the new files plus the unchanged suites).
Run: `npm run build:web` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/map-commands.ts packages/shared/src/map-commands.test.ts packages/shared/dist \
        apps/web/src/features/map/model/roiLayer.ts apps/web/src/features/map/model/roiLayer.test.ts \
        apps/web/src/features/map/model/useMapCommands.ts apps/web/src/features/map/model/mapCommands.ts \
        apps/web/src/features/roi/ui apps/web/src/features/map/ui/MapToolbar.tsx apps/web/src/app/App.tsx \
        apps/web/src/styles/main.css
git commit -m "feat(web): chip vùng phân tích và lớp bản đồ riêng cho vùng

Lệnh showRoi/clearRoi (dùng được cho trợ lý ở giai đoạn 5); chip năm trạng thái và
trình sửa bán kính; lớp vùng tách khỏi lớp kết quả nên 'Xoá kết quả' không xoá vùng.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The analysis tools run on the ROI

**Files:**
- Modify (rewrite): `apps/web/src/features/analysis/model/tools.ts`, `tools.test.ts`, `useAnalysis.ts`, `useAnalysis.test.ts`, `ui/AnalysisButtons.view.tsx`, `ui/AnalysisParams.view.tsx`, `index.tsx`
- Modify: `apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx` (+ test), `apps/web/src/features/map/ui/MapToolbar.tsx` (+ test), `apps/web/src/features/map/model/useMeasure.ts`
- Create: `apps/web/src/features/analysis/ui/AnalysisButtons.view.test.tsx`
- Delete: `apps/web/src/features/map/model/lastShape.ts`

**Interfaces:**
- Consumes: Task 8 (`toolAvailability`, `RoiTool`, `getRoiState`, `setRoiHint`, `useRoi`), Task 9 (`useMapCommands`).
- Produces: `buildInput(tool: RoiTool, params, roi: Roi)`; `useAnalysis({ run, fetchResult?, getRoi?, onUnavailable? })` returning `{ active, params, status, result, resultRoiLabel, error, open, setParams, execute, cancel, clear, exportCsv }`; `AnalysisButtonsView({ active, availability, onOpen })`; `AnalysisParamsView({ tool, roiLabel, params, status, error, onParams, onRun, onCancel })`; `AnalysisResultCardView` gains `roiLabel?: string | null`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `apps/web/src/features/analysis/model/tools.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type { Roi } from '@webatlas/shared';
import { DEFAULT_PARAMS, buildInput } from './tools';

const roi: Roi = { source: 'admin', level: 'province', code: '66' };

describe('buildInput', () => {
  it('sends the ROI as it is, with each tool’s own parameters', () => {
    expect(buildInput('select_within', DEFAULT_PARAMS, roi)).toEqual({ roi, layerKeys: ['dams'] });
    expect(buildInput('nearest', DEFAULT_PARAMS, roi)).toEqual({ roi, layerKey: 'dams', k: 5 });
    expect(buildInput('elevation_profile', DEFAULT_PARAMS, roi)).toEqual({ roi, samples: 100 });
    expect(buildInput('zonal_elevation', DEFAULT_PARAMS, roi)).toEqual({ roi });
  });
});
```

Replace the whole of `apps/web/src/features/analysis/model/useAnalysis.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AnalysisResult, ResolvedRoi, Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useAnalysis } from './useAnalysis';
import { getAnalysisResult, setAnalysisResult } from './analysisResult.store';

const roi: Roi = { source: 'admin', level: 'province', code: '66' };
const resolved: ResolvedRoi = {
  label: 'Tỉnh Đắk Lắk', kind: 'area', measure: { areaKm2: 18086 },
  display: { type: 'Point', coordinates: [108, 12.7] }, bbox: [107, 12, 109, 13.5], centroid: [108, 12.7],
};
const RESULT: AnalysisResult = {
  op: 'select_within', summary: { 'Tổng số': 2 }, rows: [],
  geometries: [{ geometry: { type: 'Point', coordinates: [108, 12.7] }, role: 'input' }],
};

function setup(current: { roi: Roi | null; resolved: ResolvedRoi | null } = { roi, resolved }) {
  const deps = {
    run: vi.fn(),
    fetchResult: vi.fn().mockResolvedValue(RESULT),
    getRoi: () => current,
    onUnavailable: vi.fn(),
  };
  const hook = renderHook(() => useAnalysis(deps));
  return { hook, deps };
}

beforeEach(() => setAnalysisResult(null));

describe('useAnalysis', () => {
  it('open → run sends the ROI, draws the result and names the ROI it answers', async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('select_within'));
    expect(hook.result.current.status).toBe('params');
    await act(async () => hook.result.current.execute());
    expect(deps.fetchResult).toHaveBeenCalledWith('select_within', { roi, layerKeys: ['dams'] });
    expect(deps.run).toHaveBeenCalledWith({ kind: 'showGeometries', items: RESULT.geometries, fit: true });
    expect(hook.result.current.result).toBe(RESULT);
    expect(hook.result.current.resultRoiLabel).toBe('Tỉnh Đắk Lắk');
    expect(getAnalysisResult()).toBe(RESULT);
    expect(hook.result.current.active).toBeNull();
  });

  it('does not open a disabled tool: it reports the reason instead (U-2)', () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('elevation_profile'));
    expect(hook.result.current.active).toBeNull();
    expect(deps.onUnavailable).toHaveBeenCalledWith('Cần một đường, ví dụ một con sông');
  });

  it('with no ROI, every tool reports why', () => {
    const { hook, deps } = setup({ roi: null, resolved: null });
    act(() => hook.result.current.open('nearest'));
    expect(deps.onUnavailable).toHaveBeenCalledWith('Chưa có vùng phân tích');
  });

  it('shows the API message on failure and returns to params', async () => {
    const { hook, deps } = setup();
    deps.fetchResult.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Vùng quá lớn'));
    act(() => hook.result.current.open('select_within'));
    await act(async () => hook.result.current.execute());
    expect(hook.result.current.error).toBe('Vùng quá lớn');
    expect(hook.result.current.status).toBe('params');
  });

  it('clear removes the result and its highlights', async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.open('select_within'));
    await act(async () => hook.result.current.execute());
    act(() => hook.result.current.clear());
    expect(deps.run).toHaveBeenLastCalledWith({ kind: 'clearHighlights' });
    expect(hook.result.current.result).toBeNull();
  });
});
```

Create `apps/web/src/features/analysis/ui/AnalysisButtons.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Availability, RoiTool } from '../../roi/model/toolAvailability';
import { AnalysisButtonsView } from './AnalysisButtons.view';

const all = (a: Availability) => ({ select_within: a, zonal_elevation: a, elevation_profile: a, nearest: a }) as Record<RoiTool, Availability>;

describe('AnalysisButtonsView', () => {
  it('groups the tools as Vùng · Tuyến · Lân cận, with no Vùng đệm', () => {
    render(<AnalysisButtonsView active={null} availability={all({ enabled: true })} onOpen={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Vùng' })).getAllByRole('button')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Tuyến' })).getByRole('button', { name: 'Trắc diện độ cao' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Lân cận' })).getByRole('button', { name: 'Gần nhất' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vùng đệm' })).toBeNull();
  });

  it('keeps a disabled tool focusable and pressable, with its reason in the tooltip', async () => {
    const onOpen = vi.fn();
    render(<AnalysisButtonsView active={null} availability={all({ enabled: false, reason: 'Chưa có vùng phân tích' })} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Gần nhất' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', 'Gần nhất — Chưa có vùng phân tích');
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith('nearest');
  });
});
```

In `apps/web/src/features/analysis/ui/AnalysisResultCard.view.test.tsx`, add inside the describe:

```tsx
  it('names the ROI the result was computed for (FR-10)', () => {
    render(<AnalysisResultCardView result={R} roiLabel="Sông Thu Bồn + 5 km" onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Kết quả cho: Sông Thu Bồn + 5 km')).toBeInTheDocument();
  });
```

In `apps/web/src/features/map/ui/MapToolbar.test.tsx`, add inside the describe:

```tsx
  it('labels the measure buttons as the Đo nhanh group', () => {
    render(<MapToolbarView {...baseProps} />);
    const group = screen.getByRole('group', { name: 'Đo nhanh' });
    expect(within(group).getByRole('button', { name: /Đo chiều dài/ })).toBeInTheDocument();
  });
```

(and add `within` to that file's `@testing-library/react` import).

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/web -- src/features/analysis src/features/map/ui`
Expected: FAIL — `buildInput`'s signature, `execute`, `resultRoiLabel`, the groups and `roiLabel` do not exist yet.

- [ ] **Step 3: The model**

Replace the whole of `apps/web/src/features/analysis/model/tools.ts` with:

```ts
import type { AnalysisOp, EditableLayerKey, Roi } from '@webatlas/shared';
import type { RoiTool } from '../../roi/model/toolAvailability';

/** Every op keeps its label: result cards and the print page name results by op. */
export const ANALYSIS_TOOL_LABELS: Record<AnalysisOp, string> = {
  buffer: 'Vùng đệm',
  select_within: 'Chọn trong vùng',
  nearest: 'Gần nhất',
  elevation_profile: 'Trắc diện độ cao',
  zonal_elevation: 'Thống kê độ cao',
};

export interface AnalysisParams {
  layerKeys: EditableLayerKey[];
  layerKey: EditableLayerKey;
  k: number;
  samples: number;
}

export const DEFAULT_PARAMS: AnalysisParams = { layerKeys: ['dams'], layerKey: 'dams', k: 5, samples: 100 };

/** The request body: the ROI as it is, plus the tool's own parameters (spec §8). */
export function buildInput(tool: RoiTool, params: AnalysisParams, roi: Roi): object {
  switch (tool) {
    case 'select_within': return { roi, layerKeys: params.layerKeys };
    case 'nearest': return { roi, layerKey: params.layerKey, k: params.k };
    case 'elevation_profile': return { roi, samples: params.samples };
    case 'zonal_elevation': return { roi };
  }
}
```

Replace the whole of `apps/web/src/features/analysis/model/useAnalysis.ts` with:

```ts
import { useCallback, useState } from 'react';
import type { AnalysisResult, MapCommand } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { getRoiState, setRoiHint, type RoiState } from '../../roi/model/roi.store';
import { toolAvailability, type RoiTool } from '../../roi/model/toolAvailability';
import { runAnalysis } from '../api/analysis.api';
import { ANALYSIS_TOOL_LABELS, DEFAULT_PARAMS, buildInput, type AnalysisParams } from './tools';
import { downloadCsv } from './csv';
import { setAnalysisResult } from './analysisResult.store';

export interface UseAnalysisDeps {
  run: (cmd: MapCommand) => unknown;
  fetchResult?: typeof runAnalysis;
  getRoi?: () => Pick<RoiState, 'roi' | 'resolved'>;
  /** Where a disabled tool's reason goes when it is pressed (U-2): the chip. */
  onUnavailable?: (reason: string) => void;
}

export type AnalysisStatus = 'idle' | 'params' | 'running';

export function useAnalysis({
  run, fetchResult = runAnalysis, getRoi = getRoiState, onUnavailable = setRoiHint,
}: UseAnalysisDeps) {
  const [active, setActive] = useState<RoiTool | null>(null);
  const [params, setParamsState] = useState<AnalysisParams>(DEFAULT_PARAMS);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [resultRoiLabel, setResultRoiLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((tool: RoiTool) => {
    const availability = toolAvailability(tool, getRoi().resolved);
    if (!availability.enabled) {
      onUnavailable(availability.reason);
      return;
    }
    setActive(tool);
    setError(null);
    setStatus('params');
  }, [getRoi, onUnavailable]);

  const setParams = useCallback((patch: Partial<AnalysisParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const execute = useCallback(async () => {
    const { roi, resolved } = getRoi();
    if (!active || !roi || !resolved) return;
    // The ROI may have changed since the panel opened.
    const availability = toolAvailability(active, resolved);
    if (!availability.enabled) {
      setError(availability.reason);
      return;
    }
    setStatus('running');
    setError(null);
    try {
      const r = await fetchResult(active, buildInput(active, params, roi));
      if (r.geometries.length > 0) run({ kind: 'showGeometries', items: r.geometries, fit: true });
      setResult(r);
      setResultRoiLabel(resolved.label);
      setAnalysisResult(r);
      setStatus('idle');
      setActive(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không chạy được phép phân tích.');
      setStatus('params');
    }
  }, [active, params, getRoi, fetchResult, run]);

  const cancel = useCallback(() => {
    setActive(null);
    setStatus('idle');
    setError(null);
  }, []);

  const clear = useCallback(() => {
    run({ kind: 'clearHighlights' });
    setResult(null);
    setResultRoiLabel(null);
    setAnalysisResult(null);
  }, [run]);

  const exportCsv = useCallback(() => {
    if (result) downloadCsv(result, `phan-tich-${ANALYSIS_TOOL_LABELS[result.op]}.csv`);
  }, [result]);

  return { active, params, status, result, resultRoiLabel, error, open, setParams, execute, cancel, clear, exportCsv };
}
```

- [ ] **Step 4: The views**

Replace the whole of `apps/web/src/features/analysis/ui/AnalysisButtons.view.tsx` with:

```tsx
import { Fragment, type ReactNode } from 'react';
import { SquareDashed, Sigma, TrendingUp, LocateFixed } from 'lucide-react';
import type { Availability, RoiTool } from '../../roi/model/toolAvailability';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';

const ICONS: Record<RoiTool, ReactNode> = {
  select_within: <SquareDashed size={18} />,
  zonal_elevation: <Sigma size={18} />,
  elevation_profile: <TrendingUp size={18} />,
  nearest: <LocateFixed size={18} />,
};

/** Grouped by what each tool needs from the ROI (spec §8, U-10). */
const GROUPS: { label: string; tools: RoiTool[] }[] = [
  { label: 'Vùng', tools: ['select_within', 'zonal_elevation'] },
  { label: 'Tuyến', tools: ['elevation_profile'] },
  { label: 'Lân cận', tools: ['nearest'] },
];

export interface AnalysisButtonsViewProps {
  active: RoiTool | null;
  availability: Record<RoiTool, Availability>;
  onOpen: (tool: RoiTool) => void;
}

/**
 * A disabled tool uses aria-disabled, not `disabled`: it stays focusable and hoverable, so
 * its reason is reachable, and pressing it shows the reason in the chip (U-2, NFR-4).
 */
export function AnalysisButtonsView({ active, availability, onOpen }: AnalysisButtonsViewProps) {
  return (
    <>
      {GROUPS.map((group, i) => (
        <Fragment key={group.label}>
          {i > 0 && <div className="control-divider" />}
          <div className="control-group" role="group" aria-label={group.label}>
            <span className="control-group-label" aria-hidden="true">{group.label}</span>
            {group.tools.map((tool) => {
              const a = availability[tool];
              const label = ANALYSIS_TOOL_LABELS[tool];
              return (
                <button
                  key={tool}
                  type="button"
                  className={`control-btn ${active === tool ? 'active' : ''}`}
                  aria-pressed={active === tool}
                  aria-disabled={!a.enabled}
                  aria-label={label}
                  title={a.enabled ? label : `${label} — ${a.reason}`}
                  onClick={() => onOpen(tool)}
                >
                  {ICONS[tool]}
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
    </>
  );
}
```

Replace the whole of `apps/web/src/features/analysis/ui/AnalysisParams.view.tsx` with:

```tsx
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import type { RoiTool } from '../../roi/model/toolAvailability';
import { ANALYSIS_TOOL_LABELS, type AnalysisParams } from '../model/tools';
import type { AnalysisStatus } from '../model/useAnalysis';

const LAYER_NAMES: Record<EditableLayerKey, string> = {
  dams: 'Đập & hồ chứa', rivers: 'Sông ngòi', lakes: 'Hồ', stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt', drought_points: 'Điểm hạn hán', saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};

const HINT: Record<RoiTool, string> = {
  select_within: 'Đếm và tô sáng các đối tượng nằm trong vùng phân tích.',
  zonal_elevation: 'Độ cao thấp nhất, cao nhất và trung bình trong vùng (tối đa 5.000 km²).',
  elevation_profile: 'Trắc diện độ cao dọc theo tuyến.',
  nearest: 'Các đối tượng gần nhất, tính từ điểm — hoặc từ trọng tâm nếu vùng phân tích là đường hay vùng.',
};

export interface AnalysisParamsViewProps {
  tool: RoiTool;
  roiLabel: string | null;
  params: AnalysisParams;
  status: AnalysisStatus;
  error: string | null;
  onParams: (patch: Partial<AnalysisParams>) => void;
  onRun: () => void;
  onCancel: () => void;
}

/** Only the tool's own parameters: the ROI is already chosen, so there is no draw step. */
export function AnalysisParamsView({ tool, roiLabel, params, status, error, onParams, onRun, onCancel }: AnalysisParamsViewProps) {
  const busy = status === 'running';
  return (
    <section className="analysis-card glass-panel" aria-label={ANALYSIS_TOOL_LABELS[tool]}>
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[tool]}</h3>
      {roiLabel && <p className="analysis-note">Vùng phân tích: {roiLabel}</p>}
      <p className="analysis-note">{HINT[tool]}</p>

      {tool === 'select_within' && (
        <fieldset className="analysis-layers"><legend>Lớp cần chọn</legend>
          {EDITABLE_LAYER_KEYS.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={params.layerKeys.includes(k)}
                onChange={(e) => onParams({
                  layerKeys: e.target.checked ? [...params.layerKeys, k] : params.layerKeys.filter((x) => x !== k),
                })} />
              {LAYER_NAMES[k]}
            </label>
          ))}
        </fieldset>
      )}
      {tool === 'nearest' && (
        <>
          <label>Lớp
            <select value={params.layerKey} onChange={(e) => onParams({ layerKey: e.target.value as EditableLayerKey })}>
              {EDITABLE_LAYER_KEYS.map((k) => <option key={k} value={k}>{LAYER_NAMES[k]}</option>)}
            </select>
          </label>
          <label>Số đối tượng
            <input type="number" min={1} max={25} value={params.k} onChange={(e) => onParams({ k: Number(e.target.value) })} />
          </label>
        </>
      )}
      {tool === 'elevation_profile' && (
        <label>Số điểm lấy mẫu
          <input type="number" min={2} max={200} value={params.samples}
            onChange={(e) => onParams({ samples: Number(e.target.value) })} />
        </label>
      )}

      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onRun} disabled={busy || (tool === 'select_within' && params.layerKeys.length === 0)}>
          {busy ? 'Đang tính…' : 'Chạy'}
        </button>
        <button type="button" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  );
}
```

In `apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx`:
- add `roiLabel?: string | null;` to the props interface and destructure it;
- right after the `<h3 className="analysis-card-title">…</h3>` line, add
  `{roiLabel && <p className="analysis-note">Kết quả cho: {roiLabel}</p>}`.

Replace the whole of `apps/web/src/features/analysis/index.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { useMapCommands } from '../map/model/useMapCommands';
import { useRoi } from '../roi/model/roi.store';
import { ROI_TOOLS, toolAvailability, type Availability, type RoiTool } from '../roi/model/toolAvailability';
import { useAnalysis } from './model/useAnalysis';
import { AnalysisButtonsView } from './ui/AnalysisButtons.view';
import { AnalysisParamsView } from './ui/AnalysisParams.view';
import { AnalysisResultCardView } from './ui/AnalysisResultCard.view';

/**
 * Returns the toolbar buttons and the panel above the toolbar as two nodes sharing one
 * presenter — the toolbar renders them in different places.
 */
export function useAnalysisTools(): { buttons: ReactNode; panel: ReactNode } {
  const run = useMapCommands();
  const roi = useRoi();
  const a = useAnalysis({ run });
  const availability = Object.fromEntries(
    ROI_TOOLS.map((tool) => [tool, toolAvailability(tool, roi.resolved)])
  ) as Record<RoiTool, Availability>;

  const buttons = <AnalysisButtonsView active={a.active} availability={availability} onOpen={a.open} />;
  const panel = a.active ? (
    <AnalysisParamsView
      tool={a.active} roiLabel={roi.resolved?.label ?? null} params={a.params} status={a.status} error={a.error}
      onParams={a.setParams} onRun={() => void a.execute()} onCancel={a.cancel}
    />
  ) : a.result ? (
    <AnalysisResultCardView
      result={a.result}
      roiLabel={a.resultRoiLabel}
      onRow={(row) => {
        if (row.layerKey && row.featureId && row.lon !== undefined && row.lat !== undefined) {
          run({ kind: 'zoomToFeature', layerKey: row.layerKey, featureId: row.featureId, lonLat: [row.lon, row.lat] });
        }
      }}
      onExport={a.exportCsv}
      onClear={a.clear}
    />
  ) : null;

  return { buttons, panel };
}
```

- [ ] **Step 5: The ruler stays; the last-shape mechanism goes**

In `apps/web/src/features/map/ui/MapToolbar.tsx`, replace the whole first control group — lines 69–94, from `<div className="control-group">` through its closing `</div>` (the pan, length and area buttons) — with a pan group and a separate, labelled **Đo nhanh** group (D9):

```tsx
        <div className="control-group">
          <button
            className={`control-btn ${measureMode === 'none' ? 'active' : ''}`}
            aria-pressed={measureMode === 'none'}
            onClick={() => onMeasure('none')}
            title="Di chuyển bản đồ"
          >
            <MousePointer2 size={18} />
          </button>
        </div>

        <div className="control-divider" />

        <div className="control-group" role="group" aria-label="Đo nhanh">
          <span className="control-group-label" aria-hidden="true">Đo nhanh</span>
          <button
            className={`control-btn ${measureMode === 'length' ? 'active' : ''}`}
            aria-pressed={measureMode === 'length'}
            onClick={() => onMeasure('length')}
            title="Đo chiều dài (sông)"
          >
            <Ruler size={18} />
          </button>
          <button
            className={`control-btn ${measureMode === 'area' ? 'active' : ''}`}
            aria-pressed={measureMode === 'area'}
            onClick={() => onMeasure('area')}
            title="Đo diện tích (ngập)"
          >
            <Square size={18} />
          </button>
        </div>
```

In `apps/web/src/features/map/model/useMeasure.ts`, delete the lines `import { olGeometryTo4326GeoJSON } from './geo';`, `import { setLastShape } from './lastShape';`, `import type { GeoJsonGeometry } from '@webatlas/shared';` and `setLastShape(olGeometryTo4326GeoJSON(geom) as unknown as GeoJsonGeometry);` — the ruler's shape is temporary and never becomes the ROI (D9).

Delete `apps/web/src/features/map/model/lastShape.ts`.

- [ ] **Step 6: Run everything**

Run: `npm run test -w @webatlas/web` → green.
Run: `npm run build:web` → exit 0 (catches any remaining `lastShape` / `drawKindFor` / `acceptsShape` import).
Run: `grep -rn "lastShape\|acceptsShape\|drawKindFor\|getLastShape" apps/web/src` → no output.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/features/analysis apps/web/src/features/map/ui/MapToolbar.tsx \
        apps/web/src/features/map/ui/MapToolbar.test.tsx apps/web/src/features/map/model/useMeasure.ts \
        apps/web/src/features/map/model/lastShape.ts
git commit -m "feat(web): công cụ phân tích chạy trên vùng phân tích

Nhóm Vùng · Tuyến · Lân cận, nút bị tắt vẫn bấm được và nêu lý do trong chip; bảng
tham số không còn bước vẽ hay 'Dùng hình vừa vẽ'; thẻ kết quả ghi 'Kết quả cho'; bỏ
nút Vùng đệm và lastShape; thước Đo nhanh giữ nguyên, tách nhóm riêng.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Drawing an ROI

**Files:**
- Rename: `apps/web/src/features/map/model/analysisDraw.ts` → `roiDraw.ts`, and its test → `roiDraw.test.ts`
- Create: `apps/web/src/features/map/model/drawingState.ts` (+ `.test.ts`), `apps/web/src/features/roi/ui/RoiDrawButtons.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/features/map/ui/MapToolbar.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/components/DynamicPopup.tsx:115`, `apps/web/src/features/map/model/useMeasure.ts`, `apps/web/src/features/roi/ui/RoiChip.tsx`

**Interfaces:**
- Consumes: Task 8's `startDrawing`, `stopDrawing`, `setRoi`, `useRoi`, `RoiDrawKind`.
- Produces:
  - `startRoiDraw(map, kind: RoiDrawKind, onDone: (g: GeoJsonGeometry) => void, hooks?: RoiDrawHooks): () => void` with `RoiDrawHooks = { snapTolerancePx?: number; onDrawCreated?: (draw: Draw) => () => void; validate?: (g: Geometry) => string | null; onInvalid?: (message: string) => void }`;
  - `drawingState`: `DrawOwner = 'roi' | 'ruler'`, `claimDrawing(owner)`, `releaseDrawing(owner)`, `isDrawing()`, `setDrawFeedback({ hint?, measure? })`, `useDrawFeedback(): { owner: DrawOwner | null; hint; measure }`;
  - `RoiDrawButtonsView({ active, onDraw })` and default `RoiDrawButtons` (container);
  - `MapToolbarView` / `MapToolbar` prop `drawButtons?: ReactNode`, rendered after the Đo nhanh group.

- [ ] **Step 1: Rename the draw module**

```bash
git mv apps/web/src/features/map/model/analysisDraw.ts apps/web/src/features/map/model/roiDraw.ts
git mv apps/web/src/features/map/model/analysisDraw.test.ts apps/web/src/features/map/model/roiDraw.test.ts
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `apps/web/src/features/map/model/roiDraw.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import { fromLonLat } from 'ol/proj';
import { startRoiDraw } from './roiDraw';

function makeMap(): Map {
  const el = document.createElement('div');
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
const draws = (map: Map) => map.getInteractions().getArray().filter((i): i is Draw => i instanceof Draw);
const square = () => new Polygon([[fromLonLat([108, 13]), fromLonLat([108.1, 13]), fromLonLat([108.1, 13.1]), fromLonLat([108, 13])]]);

describe('startRoiDraw', () => {
  it('adds one draw interaction and a sketch layer, and removes both on cleanup', () => {
    const map = makeMap();
    const layersBefore = map.getLayers().getLength();
    const stop = startRoiDraw(map, 'Polygon', () => {});
    expect(draws(map)).toHaveLength(1);
    expect(map.getLayers().getLength()).toBe(layersBefore + 1);
    stop();
    expect(draws(map)).toHaveLength(0);
    expect(map.getLayers().getLength()).toBe(layersBefore);
  });

  it('draws a rectangle as a Polygon (OpenLayers draws boxes via Circle + createBox)', () => {
    const map = makeMap();
    const onDone = vi.fn();
    startRoiDraw(map, 'Box', onDone);
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    expect(onDone.mock.calls[0][0].type).toBe('Polygon');
  });

  it('hands a finished shape over in EPSG:4326', () => {
    const map = makeMap();
    const onDone = vi.fn();
    startRoiDraw(map, 'Polygon', onDone);
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    const [lon, lat] = onDone.mock.calls[0][0].coordinates[0][0];
    expect(lon).toBeCloseTo(108, 5);
    expect(lat).toBeCloseTo(13, 5);
  });

  it('refuses a shape the validator rejects, and says why', () => {
    const map = makeMap();
    const onDone = vi.fn(); const onInvalid = vi.fn();
    startRoiDraw(map, 'Polygon', onDone, { validate: () => 'Vùng tự cắt nhau — hãy vẽ lại', onInvalid });
    draws(map)[0].dispatchEvent(new DrawEvent('drawend', new Feature(square())));
    expect(onDone).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith('Vùng tự cắt nhau — hãy vẽ lại');
  });

  it('lets the aids attach to the draw interaction and detaches them on cleanup', () => {
    const map = makeMap();
    const detach = vi.fn();
    const onDrawCreated = vi.fn(() => detach);
    const stop = startRoiDraw(map, 'LineString', () => {}, { onDrawCreated });
    expect(onDrawCreated).toHaveBeenCalledWith(draws(map)[0]);
    stop();
    expect(detach).toHaveBeenCalled();
  });
});
```

Create `apps/web/src/features/map/model/drawingState.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { claimDrawing, getDrawFeedback, isDrawing, releaseDrawing, setDrawFeedback } from './drawingState';

beforeEach(() => { releaseDrawing('roi'); releaseDrawing('ruler'); });

describe('drawingState', () => {
  it('tracks who is drawing', () => {
    expect(isDrawing()).toBe(false);
    claimDrawing('roi');
    expect(isDrawing()).toBe(true);
    expect(getDrawFeedback().owner).toBe('roi');
  });

  it('a hand-over is not undone by the previous owner releasing late', () => {
    claimDrawing('roi');
    claimDrawing('ruler');
    releaseDrawing('roi');
    expect(getDrawFeedback().owner).toBe('ruler');
  });

  it('carries the aids’ hint and live measure, reset on each claim', () => {
    claimDrawing('roi');
    setDrawFeedback({ hint: 'Nhấp để khép vùng', measure: '3,2 km²' });
    expect(getDrawFeedback()).toMatchObject({ hint: 'Nhấp để khép vùng', measure: '3,2 km²' });
    claimDrawing('ruler');
    expect(getDrawFeedback()).toMatchObject({ hint: null, measure: null });
  });
});
```

Create `apps/web/src/features/roi/ui/RoiDrawButtons.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoiDrawButtonsView } from './RoiDrawButtons';

describe('RoiDrawButtonsView', () => {
  it('offers the four draw tools in the Vẽ group (D5)', () => {
    render(<RoiDrawButtonsView active={null} onDraw={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Vẽ' });
    for (const name of ['Vẽ đa giác', 'Vẽ hình chữ nhật', 'Vẽ đường', 'Chọn một điểm']) {
      expect(within(group).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the active one and reports presses', async () => {
    const onDraw = vi.fn();
    render(<RoiDrawButtonsView active="Box" onDraw={onDraw} />);
    expect(screen.getByRole('button', { name: 'Vẽ hình chữ nhật' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Vẽ đường' }));
    expect(onDraw).toHaveBeenCalledWith('LineString');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm run test -w @webatlas/web -- src/features/map/model/roiDraw src/features/map/model/drawingState src/features/roi/ui/RoiDrawButtons`
Expected: FAIL — `startRoiDraw`, `drawingState` and `RoiDrawButtons` do not exist.

- [ ] **Step 4: Write the modules**

Replace the whole of `apps/web/src/features/map/model/roiDraw.ts` with:

```ts
import type { Map } from 'ol';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type Geometry from 'ol/geom/Geometry';
import type { GeoJsonGeometry } from '@webatlas/shared';
import type { RoiDrawKind } from '../../roi/model/roi.store';
import { olGeometryTo4326GeoJSON } from './geo';

export interface RoiDrawHooks {
  /** Pixel distance within which a click on the first vertex closes the polygon (U-11). */
  snapTolerancePx?: number;
  /** Attach the drawing aids to the live interaction; returns their cleanup (Task 12). */
  onDrawCreated?: (draw: Draw) => () => void;
  /** Refuse a finished shape: a message, or null to accept it. */
  validate?: (g: Geometry) => string | null;
  onInvalid?: (message: string) => void;
}

/**
 * One ROI drawing (F1). Returns a cleanup that removes the interaction, its sketch layer
 * and the aids. A refused shape leaves the interaction running, so the user redraws.
 * The sketch keeps OpenLayers' default blue so it is never confused with the committed
 * ROI's dark dashed outline (U-7).
 */
export function startRoiDraw(
  map: Map, kind: RoiDrawKind, onDone: (g: GeoJsonGeometry) => void, hooks: RoiDrawHooks = {}
): () => void {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 996,
    style: { 'stroke-color': '#2563eb', 'stroke-width': 2, 'fill-color': 'rgba(37, 99, 235, 0.08)', 'circle-radius': 6, 'circle-fill-color': '#2563eb' },
  });
  const common = hooks.snapTolerancePx !== undefined ? { snapTolerance: hooks.snapTolerancePx } : {};
  const draw = kind === 'Box'
    ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), ...common })
    : new Draw({ source, type: kind, ...common });

  draw.on('drawend', (e) => {
    const geometry = e.feature.getGeometry();
    if (!geometry) return;
    const problem = hooks.validate?.(geometry) ?? null;
    if (problem) {
      hooks.onInvalid?.(problem);
      // The refused feature is added to `source` after this event; drop it next tick.
      setTimeout(() => source.clear());
      return;
    }
    onDone(olGeometryTo4326GeoJSON(geometry) as unknown as GeoJsonGeometry);
  });

  map.addLayer(layer);
  map.addInteraction(draw);
  const detachAids = hooks.onDrawCreated?.(draw) ?? (() => {});
  return () => {
    detachAids();
    map.removeInteraction(draw);
    map.removeLayer(layer);
  };
}
```

Create `apps/web/src/features/map/model/drawingState.ts`:

```ts
import { useSyncExternalStore } from 'react';

/** Who owns the map's clicks right now: an ROI drawing or the Đo nhanh ruler. */
export type DrawOwner = 'roi' | 'ruler';

export interface DrawFeedback {
  owner: DrawOwner | null;
  /** The drawing aids' current hint (U-11), e.g. "Nhấp để khép vùng". */
  hint: string | null;
  /** The live length or area of the shape being drawn. */
  measure: string | null;
}

let state: DrawFeedback = { owner: null, hint: null, measure: null };
const listeners = new Set<() => void>();
function publish(next: DrawFeedback) { state = next; for (const l of listeners) l(); }

/** Taking over from another owner is allowed; that owner reacts by stopping. */
export function claimDrawing(owner: DrawOwner): void { publish({ owner, hint: null, measure: null }); }
/** Only the current owner can release — a late release after a hand-over is ignored. */
export function releaseDrawing(owner: DrawOwner): void {
  if (state.owner === owner) publish({ owner: null, hint: null, measure: null });
}
export function setDrawFeedback(patch: Partial<Pick<DrawFeedback, 'hint' | 'measure'>>): void {
  publish({ ...state, ...patch });
}
/** Read by the popup: while anything is drawing, a map click is not an inspection. */
export function isDrawing(): boolean { return state.owner !== null; }
export function getDrawFeedback(): DrawFeedback { return state; }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useDrawFeedback(): DrawFeedback { return useSyncExternalStore(subscribe, getDrawFeedback, getDrawFeedback); }
```

Create `apps/web/src/features/roi/ui/RoiDrawButtons.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import { Pentagon, RectangleHorizontal, Spline, MapPin } from 'lucide-react';
import type { DrawnRoiGeometry } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { claimDrawing, releaseDrawing, useDrawFeedback } from '../../map/model/drawingState';
import { startRoiDraw } from '../../map/model/roiDraw';
import { setRoi, startDrawing, stopDrawing, useRoi, type RoiDrawKind } from '../model/roi.store';

const KINDS: { kind: RoiDrawKind; label: string; icon: ReactNode }[] = [
  { kind: 'Polygon', label: 'Vẽ đa giác', icon: <Pentagon size={18} /> },
  { kind: 'Box', label: 'Vẽ hình chữ nhật', icon: <RectangleHorizontal size={18} /> },
  { kind: 'LineString', label: 'Vẽ đường', icon: <Spline size={18} /> },
  { kind: 'Point', label: 'Chọn một điểm', icon: <MapPin size={18} /> },
];

export function RoiDrawButtonsView({ active, onDraw }: { active: RoiDrawKind | null; onDraw: (kind: RoiDrawKind) => void }) {
  return (
    <div className="control-group" role="group" aria-label="Vẽ">
      <span className="control-group-label" aria-hidden="true">Vẽ</span>
      {KINDS.map(({ kind, label, icon }) => (
        <button
          key={kind} type="button" className={`control-btn ${active === kind ? 'active' : ''}`}
          aria-pressed={active === kind} aria-label={label} title={label} onClick={() => onDraw(kind)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/**
 * The Vẽ group and the drawing lifecycle (F1). Pressing a tool starts a drawing; pressing
 * it again, or Esc, cancels. A finished shape becomes the ROI, with no fit — it is on
 * screen by construction (U-5).
 */
export default function RoiDrawButtons() {
  const { map } = useMapContext();
  const roi = useRoi();
  const { owner } = useDrawFeedback();
  const drawing = roi.status === 'drawing' ? roi.drawKind : null;

  useEffect(() => {
    if (!map || !drawing) return;
    claimDrawing('roi');
    const stop = startRoiDraw(map, drawing, (geometry) => {
      void setRoi({ source: 'drawn', geometry: geometry as DrawnRoiGeometry }, { fit: false });
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopDrawing(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stop();
      releaseDrawing('roi');
    };
  }, [map, drawing]);

  // The ruler took the map's clicks: stop drawing an ROI.
  useEffect(() => {
    if (owner === 'ruler' && drawing) stopDrawing();
  }, [owner, drawing]);

  return <RoiDrawButtonsView active={drawing} onDraw={(kind) => (drawing === kind ? stopDrawing() : startDrawing(kind))} />;
}
```

In `apps/web/src/features/map/model/useMeasure.ts`, import `{ claimDrawing, releaseDrawing, useDrawFeedback }` from `'./drawingState'`, and:
- at the top of the effect's `if (mode !== 'none') {` block, add `claimDrawing('ruler');`;
- in the effect's cleanup (the `return () => { … }`), add `releaseDrawing('ruler');`;
- after the effect, add a second one that yields to an ROI drawing:
  ```ts
  const { owner } = useDrawFeedback();
  // An ROI drawing took the map's clicks: stop measuring.
  useEffect(() => {
    if (owner === 'roi' && mode !== 'none') {
      setMode('none');
      setValue(null);
    }
  }, [owner, mode]);
  ```

In `apps/web/src/components/DynamicPopup.tsx`, add `import { isDrawing } from '../features/map/model/drawingState';` and change line 115 from
`if (editing) return; // edit mode owns clicks (feature selection); no popup`
to
`if (editing || isDrawing()) return; // editing or drawing owns clicks; no popup`.

In `apps/web/src/features/map/ui/MapToolbar.tsx`, add a `drawButtons?: ReactNode` prop to both `MapToolbarViewProps` and the container's props (pass it through like `roiChip`), and render it right after the Đo nhanh group's closing `</div>`:

```tsx
        {drawButtons && (
          <>
            <div className="control-divider" />
            {drawButtons}
          </>
        )}
```

In `apps/web/src/app/App.tsx`, add `import RoiDrawButtons from '../features/roi/ui/RoiDrawButtons';` and pass `drawButtons={<RoiDrawButtons />}` to `<MapToolbar … />`.

In `apps/web/src/features/roi/ui/RoiChip.tsx`, show the aids' hint and measure while an ROI is being drawn: import `useDrawFeedback` from `'../../map/model/drawingState'`, read `const feedback = useDrawFeedback();` and pass `drawHint={drawHint ?? feedback.hint} liveMeasure={liveMeasure ?? feedback.measure}` to `RoiChipView`.

- [ ] **Step 5: Run everything**

Run: `npm run test -w @webatlas/web` → green.
Run: `npm run build:web` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/features/map/model/roiDraw.ts apps/web/src/features/map/model/roiDraw.test.ts \
        apps/web/src/features/map/model/analysisDraw.ts apps/web/src/features/map/model/analysisDraw.test.ts \
        apps/web/src/features/map/model/drawingState.ts apps/web/src/features/map/model/drawingState.test.ts \
        apps/web/src/features/map/model/useMeasure.ts apps/web/src/features/roi/ui \
        apps/web/src/features/map/ui/MapToolbar.tsx apps/web/src/app/App.tsx apps/web/src/components/DynamicPopup.tsx
git commit -m "feat(web): vẽ vùng phân tích — đa giác, hình chữ nhật, đường, điểm

Hình vẽ xong thành vùng phân tích; khi đang vẽ (vùng hoặc thước) nhấp bản đồ không
mở popup; thước Đo nhanh và việc vẽ vùng nhường nhau.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The drawing aids

**Files:**
- Create: `apps/web/src/features/map/model/drawAids.ts` (+ `.test.ts`)
- Modify: `apps/web/src/features/roi/ui/RoiDrawButtons.tsx`, `apps/web/src/features/map/model/useMeasure.ts`

**Interfaces:**
- Consumes: `RoiDrawHooks` (Task 11), `setDrawFeedback`, `setRoiHint`, `stopDrawing`, `formatMeasure` (Task 8).
- Produces: `isSimplePolygon(ring)`, `validateShape(g)`, `nearFirstVertex(pointer, first, tolerancePx)`, `closeTolerancePx(coarse)`, `handleDrawKey(key, draw, vertexCount)`, `formatLive(g)`, `snapSourcesOf(map)`, `attachDrawAids(map, draw, { onHint, onMeasure, onCancel })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/map/model/drawAids.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat } from 'ol/proj';
import {
  closeTolerancePx, formatLive, handleDrawKey, isSimplePolygon, nearFirstVertex, validateShape,
} from './drawAids';

const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const bowTie = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];

describe('isSimplePolygon', () => {
  it('accepts a square and a triangle', () => {
    expect(isSimplePolygon(sq)).toBe(true);
    expect(isSimplePolygon([[0, 0], [2, 0], [1, 1], [0, 0]])).toBe(true);
  });
  it('refuses a bow-tie', () => {
    expect(isSimplePolygon(bowTie)).toBe(false);
  });
});

describe('validateShape', () => {
  it('refuses a self-intersecting polygon with the spec’s message, and accepts lines', () => {
    expect(validateShape(new Polygon([bowTie]))).toBe('Vùng tự cắt nhau — hãy vẽ lại');
    expect(validateShape(new Polygon([sq]))).toBeNull();
    expect(validateShape(new LineString([[0, 0], [1, 1], [1, 0], [0, 1]]))).toBeNull();
  });
});

describe('snap-to-close', () => {
  it('is near within the tolerance, not beyond', () => {
    expect(nearFirstVertex([100, 100], [110, 105], 12)).toBe(true);
    expect(nearFirstVertex([100, 100], [120, 100], 12)).toBe(false);
  });
  it('is wider on touch input', () => {
    expect(closeTolerancePx(false)).toBe(12);
    expect(closeTolerancePx(true)).toBe(20);
  });
});

describe('handleDrawKey', () => {
  const draw = () => ({ removeLastPoint: vi.fn(), finishDrawing: vi.fn(), abortDrawing: vi.fn() });
  it('Backspace removes a vertex, or cancels when there is none', () => {
    const d = draw();
    expect(handleDrawKey('Backspace', d, 3)).toBe('undo');
    expect(d.removeLastPoint).toHaveBeenCalled();
    expect(handleDrawKey('Backspace', d, 0)).toBe('cancel');
    expect(d.abortDrawing).toHaveBeenCalled();
  });
  it('Enter finishes, Esc cancels, other keys do nothing', () => {
    const d = draw();
    expect(handleDrawKey('Enter', d, 3)).toBe('finish');
    expect(d.finishDrawing).toHaveBeenCalled();
    expect(handleDrawKey('Escape', d, 3)).toBe('cancel');
    expect(handleDrawKey('a', d, 3)).toBeNull();
  });
});

describe('formatLive', () => {
  it('measures a line in km and a polygon in km²', () => {
    const line = new LineString([fromLonLat([108.05, 12.68]), fromLonLat([108.25, 12.68])]);
    expect(formatLive(line)).toMatch(/^2[12] km$/);
    const poly = new Polygon([[fromLonLat([108, 12]), fromLonLat([108.1, 12]), fromLonLat([108.1, 12.1]), fromLonLat([108, 12.1]), fromLonLat([108, 12])]]);
    expect(formatLive(poly)).toMatch(/km²$/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/web -- src/features/map/model/drawAids`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the aids**

Create `apps/web/src/features/map/model/drawAids.ts`:

```ts
import type { Map, MapBrowserEvent } from 'ol';
import type Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { getArea, getLength } from 'ol/sphere';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import { formatMeasure } from '../../roi/model/format';

type XY = number[];

function cross(o: XY, a: XY, b: XY): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsCross(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  const d1 = cross(q1, q2, p1); const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1); const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two non-adjacent edges of the closed ring cross. */
export function isSimplePolygon(ring: XY[]): boolean {
  const n = ring.length - 1; // the ring repeats its first vertex at the end
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edge share a vertex
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}

/** U-11: a self-intersecting polygon is refused before any request. */
export function validateShape(g: Geometry): string | null {
  if (g instanceof Polygon && !isSimplePolygon(g.getCoordinates()[0])) return 'Vùng tự cắt nhau — hãy vẽ lại';
  return null;
}

export function nearFirstVertex(pointer: XY, first: XY, tolerancePx: number): boolean {
  return Math.hypot(pointer[0] - first[0], pointer[1] - first[1]) <= tolerancePx;
}

/** OpenLayers' own close distance is 12 px; a finger needs more (U-11). */
export function closeTolerancePx(coarsePointer: boolean): number {
  return coarsePointer ? 20 : 12;
}

export type DrawKeyAction = 'undo' | 'finish' | 'cancel' | null;
type DrawLike = Pick<Draw, 'removeLastPoint' | 'finishDrawing' | 'abortDrawing'>;

/** Backspace removes the last vertex (or cancels when none is left); Enter finishes; Esc cancels. */
export function handleDrawKey(key: string, draw: DrawLike, vertexCount: number): DrawKeyAction {
  if (key === 'Backspace') {
    if (vertexCount > 0) { draw.removeLastPoint(); return 'undo'; }
    draw.abortDrawing();
    return 'cancel';
  }
  if (key === 'Enter') { draw.finishDrawing(); return 'finish'; }
  if (key === 'Escape') { draw.abortDrawing(); return 'cancel'; }
  return null;
}

/** The shape's length or area, in the chip's formatting. Geometry is EPSG:3857. */
export function formatLive(g: Geometry): string | null {
  if (g instanceof Polygon) return formatMeasure({ areaKm2: getArea(g) / 1e6 });
  if (g instanceof LineString) return formatMeasure({ lengthKm: getLength(g) / 1000 });
  return null;
}

/** Transient layers are not snap targets: the ROI outline and the data layers are. */
const NOT_SNAPPABLE = new Set(['layer_rivers_overview', 'layer_assistant_highlight', 'layer_analysis_results']);

export function snapSourcesOf(map: Map): VectorSource[] {
  return map.getLayers().getArray()
    .filter((l): l is VectorLayer<VectorSource> => l instanceof VectorLayer && l.getVisible())
    .filter((l) => {
      const id = l.get('id') as string | undefined;
      return !!id && id.startsWith('layer_') && !NOT_SNAPPABLE.has(id);
    })
    .map((l) => l.getSource())
    .filter((s): s is VectorSource => s !== null);
}

const FIRST_VERTEX_STYLE = new Style({
  image: new Circle({ radius: 9, fill: new Fill({ color: 'rgba(37, 99, 235, 0.35)' }), stroke: new Stroke({ color: '#1d4ed8', width: 2 }) }),
});

export interface DrawAidsCallbacks {
  onHint: (hint: string | null) => void;
  onMeasure: (measure: string | null) => void;
  onCancel: () => void;
}

/**
 * U-11 on a live Draw interaction: snapping (Alt draws freely), a visible snap-to-close
 * cue, a live measure, and keyboard control. Returns a cleanup that undoes all of it.
 */
export function attachDrawAids(map: Map, draw: Draw, cb: DrawAidsCallbacks): () => void {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  const tolerance = closeTolerancePx(coarse);

  // Snapping — one Snap per source; removed while Alt is held.
  const snaps = snapSourcesOf(map).map((source) => new Snap({ source, pixelTolerance: 10 }));
  let snapping = false;
  const setSnapping = (on: boolean) => {
    if (on === snapping) return;
    snapping = on;
    for (const s of snaps) (on ? map.addInteraction(s) : map.removeInteraction(s));
  };
  setSnapping(true);

  // The first-vertex cue lives on its own tiny layer above the sketch.
  const cueSource = new VectorSource();
  const cueLayer = new VectorLayer({ source: cueSource, style: FIRST_VERTEX_STYLE, zIndex: 1000 });
  map.addLayer(cueLayer);

  let sketch: Geometry | null = null;
  let vertexCount = 0;
  const onSketchChange = () => {
    if (!sketch) return;
    cb.onMeasure(formatLive(sketch));
    if (sketch instanceof Polygon) vertexCount = Math.max(0, sketch.getCoordinates()[0].length - 2);
    else if (sketch instanceof LineString) vertexCount = Math.max(0, sketch.getCoordinates().length - 1);
  };
  draw.on('drawstart', (e) => {
    sketch = e.feature.getGeometry() ?? null;
    sketch?.on('change', onSketchChange);
  });
  draw.on(['drawend', 'drawabort'], () => {
    sketch = null; vertexCount = 0; cueSource.clear(); cb.onHint(null); cb.onMeasure(null);
  });

  const onPointerMove = (e: MapBrowserEvent<PointerEvent>) => {
    cueSource.clear();
    if (!(sketch instanceof Polygon) || vertexCount < 3) return;
    const first = sketch.getCoordinates()[0][0];
    const firstPx = map.getPixelFromCoordinate(first);
    if (firstPx && nearFirstVertex(e.pixel, firstPx, tolerance)) {
      cueSource.addFeature(new Feature(new Point(first)));
      cb.onHint('Nhấp để khép vùng');
    } else {
      cb.onHint(null);
    }
  };
  map.on('pointermove', onPointerMove);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt') { setSnapping(false); return; }
    if (handleDrawKey(e.key, draw, vertexCount) === 'cancel') cb.onCancel();
    if (e.key === 'Backspace') e.preventDefault(); // not "browser back"
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setSnapping(true); };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    map.un('pointermove', onPointerMove);
    sketch?.un('change', onSketchChange);
    setSnapping(false);
    map.removeLayer(cueLayer);
  };
}
```

- [ ] **Step 4: Use them for ROI drawing and the ruler**

In `apps/web/src/features/roi/ui/RoiDrawButtons.tsx`:
- add imports: `import { attachDrawAids, closeTolerancePx, validateShape } from '../../map/model/drawAids';`, `import { setDrawFeedback } from '../../map/model/drawingState';` (merge into the existing drawingState import), and `setRoiHint` from `'../model/roi.store'` (merge into the existing store import);
- replace the effect's `const stop = startRoiDraw(…);` call and the Esc listener with:
  ```ts
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
    const stop = startRoiDraw(
      map,
      drawing,
      (geometry) => { void setRoi({ source: 'drawn', geometry: geometry as DrawnRoiGeometry }, { fit: false }); },
      {
        snapTolerancePx: closeTolerancePx(coarse),
        onDrawCreated: (draw) => attachDrawAids(map, draw, {
          onHint: (hint) => setDrawFeedback({ hint }),
          onMeasure: (measure) => setDrawFeedback({ measure }),
          onCancel: stopDrawing,
        }),
        validate: validateShape,
        onInvalid: (message) => setRoiHint(message),
      }
    );
    return () => {
      stop();
      releaseDrawing('roi');
    };
  ```
  (the aids' Esc handling replaces the separate listener, so delete `onKey` and its add/remove).

In `apps/web/src/features/map/model/useMeasure.ts`, import `attachDrawAids`, `closeTolerancePx`, `validateShape` from `'./drawAids'`; construct the Draw with `snapTolerance: closeTolerancePx(window.matchMedia?.('(pointer: coarse)').matches === true)`; right after `map.addInteraction(draw);` add

```ts
      const detachAids = attachDrawAids(map, draw, {
        onHint: () => {},
        onMeasure: (m) => setValue(m ? `Đang đo: ${m}` : null),
        onCancel: () => { setMode('none'); setValue(null); },
      });
```

call `detachAids()` in the effect's cleanup (declare `let detachAids = () => {};` above the `if (mode !== 'none')` block so the cleanup can always call it), and at the top of the `drawend` handler add

```ts
        const problem = validateShape(geom);
        if (problem) { setValue(problem); return; }
```

- [ ] **Step 5: Run everything**

Run: `npm run test -w @webatlas/web` → green.
Run: `npm run build:web` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/drawAids.ts apps/web/src/features/map/model/drawAids.test.ts \
        apps/web/src/features/roi/ui/RoiDrawButtons.tsx apps/web/src/features/map/model/useMeasure.ts
git commit -m "feat(web): trợ giúp khi vẽ — khép vùng hiện rõ, bắt dính, đo trực tiếp, phím tắt

Điểm đầu phóng to khi con trỏ đủ gần để khép (12 px, 20 px trên màn cảm ứng); bắt
dính vào đối tượng và vùng phân tích, giữ Alt để vẽ tự do; Backspace xoá điểm, Enter
kết thúc, Esc huỷ; đa giác tự cắt bị từ chối. Áp cho cả vẽ vùng và thước Đo nhanh.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The entry points — popup, search, result rows

**Files:**
- Create: `apps/web/src/features/roi/model/candidates.ts` (+ `.test.ts`), `apps/web/src/features/roi/ui/UseAsRoiButton.tsx`, `apps/web/src/features/roi/ui/RoiCandidates.view.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/features/roi/api/roi.api.ts`, `apps/web/src/features/map/model/basemapInfo.ts` (+ test), `apps/web/src/components/DynamicPopup.tsx`, `apps/web/src/features/search/api/search.api.ts`, `apps/web/src/features/search/ui/SearchBox.view.tsx` (+ test), `apps/web/src/features/search/index.tsx`, `apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx` (+ test), `apps/web/src/features/analysis/index.tsx`, `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `setRoi` (Task 8); `GET /api/reference/:layer/entities?member=` (Task 7); `sources=admin` (Task 6).
- Produces: `RoiCandidate = { key: string; label: string; detail: string; roi: Roi | null; note?: string }`; `thematicCandidate(props)`, `entityCandidates(layer, entities)`, `adminCandidates(province, ward, zoom)`, `referenceLayerOfTable(table)`, `roiOfSearchHit(hit)`; `fetchEntitiesByMember(layer, osmId)`; `UseAsRoiButton({ roi, label })`; `RoiCandidatesView({ candidates, onUse })`; `BasemapFeature` gains `osmId?` and `table?`; `SearchBoxView` gains `renderAction?`; `AnalysisResultCardView` gains `renderRowAction?`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/roi/model/candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adminCandidates, entityCandidates, referenceLayerOfTable, roiOfSearchHit, thematicCandidate } from './candidates';

describe('thematicCandidate', () => {
  it('offers a named river way as the whole river (FR-13)', () => {
    expect(thematicCandidate({ layerKey: 'rivers', id: 'w1', geographicalName: 'Sông Thu Bồn' })).toEqual({
      key: 'feature:w1', label: 'Sông Thu Bồn', detail: 'cả sông',
      roi: { source: 'feature', layerKey: 'rivers', featureId: 'w1', whole: true },
    });
  });
  it('offers an unnamed way as itself', () => {
    expect(thematicCandidate({ layerKey: 'rivers', id: 'w2' })).toMatchObject({
      label: 'Đoạn sông không tên', detail: 'đoạn sông', roi: { source: 'feature', layerKey: 'rivers', featureId: 'w2' },
    });
  });
  it('offers a dam as a dam, and nothing without an id', () => {
    expect(thematicCandidate({ layerKey: 'dams', id: 'd1', geographicalName: 'Buôn Kuốp' }))
      .toMatchObject({ label: 'Buôn Kuốp', detail: 'đập', roi: { source: 'feature', layerKey: 'dams', featureId: 'd1' } });
    expect(thematicCandidate({ layerKey: 'dams' })).toBeNull();
  });
});

describe('adminCandidates', () => {
  const province = { code: '66', name: 'Đắk Lắk', fullName: 'Tỉnh Đắk Lắk' };
  const ward = { code: '22015', name: 'Tuy Hoà', fullName: 'Phường Tuy Hoà' };
  it('lists the ward then the province', () => {
    expect(adminCandidates(province, ward, 11)).toEqual([
      { key: 'ward:22015', label: 'Phường Tuy Hoà', detail: 'xã/phường', roi: { source: 'admin', level: 'ward', code: '22015' } },
      { key: 'province:66', label: 'Tỉnh Đắk Lắk', detail: 'tỉnh', roi: { source: 'admin', level: 'province', code: '66' } },
    ]);
  });
  it('below zoom 10, says how to reach the ward', () => {
    expect(adminCandidates(province, null, 8)[0]).toEqual({
      key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã',
    });
  });
  it('shows a province outside the region without an action', () => {
    expect(adminCandidates({ code: '01', name: 'Hà Nội', fullName: 'Thành phố Hà Nội' }, null, 11)).toEqual([
      { key: 'province:01', label: 'Thành phố Hà Nội', detail: 'tỉnh', roi: null, note: 'ngoài vùng công tác' },
    ]);
  });
});

describe('entityCandidates and referenceLayerOfTable', () => {
  it('maps the clicked table to its reference layer', () => {
    expect(referenceLayerOfTable('roads_region')).toBe('roads');
    expect(referenceLayerOfTable('railways_vn')).toBe('railways');
    expect(referenceLayerOfTable('water_region')).toBe('water');
    expect(referenceLayerOfTable('roads_vn')).toBeNull();
  });
  it('offers each whole entity the segment belongs to', () => {
    expect(entityCandidates('roads', [
      { entityId: 'roads:a:0', name: 'Quốc lộ 14', ref: 'QL.14' },
      { entityId: 'roads:b:0', name: null, ref: 'HCM' },
    ])).toEqual([
      { key: 'reference:roads:a:0', label: 'Quốc lộ 14', detail: 'cả tuyến đường', roi: { source: 'reference', referenceLayer: 'roads', entityId: 'roads:a:0' } },
      { key: 'reference:roads:b:0', label: 'HCM', detail: 'cả tuyến đường', roi: { source: 'reference', referenceLayer: 'roads', entityId: 'roads:b:0' } },
    ]);
  });
});

describe('roiOfSearchHit', () => {
  it('turns each kind of search hit into its ROI', () => {
    expect(roiOfSearchHit({ source: 'layer', layerKey: 'rivers', featureId: 'r1', name: 'Sông Ba', lonLat: [108, 13] }))
      .toEqual({ source: 'feature', layerKey: 'rivers', featureId: 'r1' });
    expect(roiOfSearchHit({ source: 'reference', layerKey: 'roads', featureId: 'roads:a:0', name: 'QL.14', lonLat: [108, 13] }))
      .toEqual({ source: 'reference', referenceLayer: 'roads', entityId: 'roads:a:0' });
    expect(roiOfSearchHit({ source: 'admin', layerKey: 'ward', featureId: '22015', name: 'Phường Tuy Hoà', lonLat: [109, 13] }))
      .toEqual({ source: 'admin', level: 'ward', code: '22015' });
  });
});
```

Create `apps/web/src/features/roi/ui/RoiCandidates.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoiCandidatesView } from './RoiCandidates.view';

describe('RoiCandidatesView', () => {
  it('lists candidates with a "Dùng" action, and notes without one', async () => {
    const onUse = vi.fn();
    const roi = { source: 'admin' as const, level: 'province' as const, code: '66' };
    render(<RoiCandidatesView onUse={onUse} candidates={[
      { key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã' },
      { key: 'province:66', label: 'Tỉnh Đắk Lắk', detail: 'tỉnh', roi },
    ]} />);
    expect(screen.getByText('Dùng làm vùng phân tích:')).toBeInTheDocument();
    expect(screen.getByText('phóng to tới mức 10 để chọn xã')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dùng Tỉnh Đắk Lắk làm vùng phân tích' }));
    expect(onUse).toHaveBeenCalledWith(roi);
  });

  it('renders nothing when there are no candidates', () => {
    const { container } = render(<RoiCandidatesView candidates={[]} onUse={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

In `apps/web/src/features/map/model/basemapInfo.test.ts`, add:

```ts
describe('pickBasemapFeature keeps what the ROI lookup needs', () => {
  it('returns the chosen feature’s osm_id and source table', () => {
    const picked = pickBasemapFeature({
      features: [{ id: 'roads_region.fid-1', properties: { osm_id: '152592272', name: 'Đường tỉnh 690', fclass: 'secondary' } }],
    } as never);
    expect(picked).toMatchObject({ name: 'Đường tỉnh 690', osmId: '152592272', table: 'roads_region' });
  });
});
```

In `apps/web/src/features/search/ui/SearchBox.view.test.tsx`, add (inside its describe; reuse the file's existing imports for `render`, `screen`, `vi`, `SearchBoxView`):

```tsx
  it('shows an admin hit with its level badge and renders the row action', () => {
    render(
      <SearchBoxView
        query="Đắk" loading={false} onQuery={vi.fn()} onSelect={vi.fn()}
        results={[{ source: 'admin', layerKey: 'province', featureId: '66', name: 'Tỉnh Đắk Lắk', lonLat: [108, 12.7] }]}
        renderAction={(hit) => <button type="button">Dùng {hit.name}</button>}
      />
    );
    expect(screen.getByText('Tỉnh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng Tỉnh Đắk Lắk' })).toBeInTheDocument();
  });
```

In `apps/web/src/features/analysis/ui/AnalysisResultCard.view.test.tsx`, add:

```tsx
  it('renders a row action beside each row that has one', () => {
    render(<AnalysisResultCardView result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()}
      renderRowAction={(row) => <button type="button">Dùng {row.name}</button>} />);
    expect(screen.getByRole('button', { name: 'Dùng Sông Hinh' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w @webatlas/web -- src/features/roi src/features/map/model/basemapInfo src/features/search src/features/analysis`
Expected: FAIL — `candidates.ts`, `RoiCandidates.view.tsx` missing; `osmId`/`table` absent; the admin badge and the action slots do not render.

- [ ] **Step 3: The candidates and the shared action**

Add to `apps/web/src/features/roi/api/roi.api.ts`:

```ts
import type { ReferenceLayerKey } from '@webatlas/shared';

export interface MemberEntity { entityId: string; name: string | null; ref: string | null }

/** The whole entities a clicked basemap segment belongs to (Task 7). */
export async function fetchEntitiesByMember(layer: ReferenceLayerKey, osmId: string): Promise<MemberEntity[]> {
  const body = await apiRequest<{ entities: MemberEntity[] }>(
    `/api/reference/${layer}/entities?member=${encodeURIComponent(osmId)}`
  );
  return body.entities;
}
```

(merge the type import into the file's existing `@webatlas/shared` import).

Create `apps/web/src/features/roi/model/candidates.ts`:

```ts
import { EDITABLE_LAYER_KEYS, isRegionProvince, type EditableLayerKey, type ReferenceLayerKey, type Roi } from '@webatlas/shared';
import type { SearchHit } from '../../search/api/search.api';
import type { MemberEntity } from '../api/roi.api';

/** One "Dùng làm vùng phân tích" row (U-6). `roi: null` rows only carry a note. */
export interface RoiCandidate {
  key: string;
  label: string;
  detail: string;
  roi: Roi | null;
  note?: string;
}

const NOUN: Record<EditableLayerKey, string> = {
  dams: 'đập', rivers: 'đoạn sông', lakes: 'hồ', stations: 'trạm quan trắc', flood_zones: 'vùng ngập lụt',
  drought_points: 'điểm hạn hán', saltwater_intrusion: 'điểm xâm nhập mặn', flood_generation: 'vùng sinh lũ',
};

interface ThematicProps { layerKey?: string; id?: string; geographicalName?: string | null; name?: string | null }

/** The clicked thematic feature. A named river way is offered as its whole river (FR-13). */
export function thematicCandidate(props: ThematicProps): RoiCandidate | null {
  if (!props.id || !(EDITABLE_LAYER_KEYS as readonly string[]).includes(props.layerKey ?? '')) return null;
  const layerKey = props.layerKey as EditableLayerKey;
  const name = props.geographicalName ?? props.name ?? null;
  if (layerKey === 'rivers' && name) {
    return {
      key: `feature:${props.id}`, label: name, detail: 'cả sông',
      roi: { source: 'feature', layerKey, featureId: props.id, whole: true },
    };
  }
  return {
    key: `feature:${props.id}`,
    label: name ?? (layerKey === 'rivers' ? 'Đoạn sông không tên' : 'Đối tượng không tên'),
    detail: NOUN[layerKey],
    roi: { source: 'feature', layerKey, featureId: props.id },
  };
}

const TABLE_TO_LAYER: Record<string, ReferenceLayerKey> = {
  roads_region: 'roads', railways_vn: 'railways', water_region: 'water',
};
/** roads_vn is the national duplicate the entity builder skips, so it has no entities. */
export function referenceLayerOfTable(table: string): ReferenceLayerKey | null {
  return TABLE_TO_LAYER[table] ?? null;
}

const ENTITY_NOUN: Partial<Record<ReferenceLayerKey, string>> = {
  roads: 'cả tuyến đường', railways: 'cả tuyến đường sắt', water: 'mặt nước',
};
export function entityCandidates(layer: ReferenceLayerKey, entities: MemberEntity[]): RoiCandidate[] {
  return entities.map((e) => ({
    key: `reference:${e.entityId}`,
    label: e.name ?? e.ref ?? 'Thực thể không tên',
    detail: ENTITY_NOUN[layer] ?? 'thực thể',
    roi: { source: 'reference', referenceLayer: layer, entityId: e.entityId },
  }));
}

interface AdminProps { code: string; name: string; fullName?: string | null }

/** The ward (from zoom 10, where its layer loads) and the province under the click. */
export function adminCandidates(province: AdminProps | null, ward: AdminProps | null, zoom: number): RoiCandidate[] {
  const out: RoiCandidate[] = [];
  if (ward) {
    out.push({
      key: `ward:${ward.code}`, label: ward.fullName ?? ward.name, detail: 'xã/phường',
      roi: { source: 'admin', level: 'ward', code: ward.code },
    });
  } else if (province && zoom < 10) {
    out.push({ key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã' });
  }
  if (province) {
    const label = province.fullName ?? province.name;
    out.push(isRegionProvince(province.code)
      ? { key: `province:${province.code}`, label, detail: 'tỉnh', roi: { source: 'admin', level: 'province', code: province.code } }
      : { key: `province:${province.code}`, label, detail: 'tỉnh', roi: null, note: 'ngoài vùng công tác' });
  }
  return out;
}

/** A search hit as an ROI. A river hit is already the level-1 river (search filters by level). */
export function roiOfSearchHit(hit: SearchHit): Roi {
  switch (hit.source) {
    case 'layer': return { source: 'feature', layerKey: hit.layerKey, featureId: hit.featureId };
    case 'reference': return { source: 'reference', referenceLayer: hit.layerKey as ReferenceLayerKey, entityId: hit.featureId };
    case 'admin': return { source: 'admin', level: hit.layerKey, code: hit.featureId };
  }
}
```

Create `apps/web/src/features/roi/ui/UseAsRoiButton.tsx`:

```tsx
import type { Roi } from '@webatlas/shared';
import { setRoi } from '../model/roi.store';

/** The single "Dùng làm vùng phân tích" control (FR-11). Picks fit the map (U-5). */
export function UseAsRoiButton({ roi, label }: { roi: Roi; label: string }) {
  return (
    <button
      type="button" className="use-as-roi" aria-label={`Dùng ${label} làm vùng phân tích`}
      title="Dùng làm vùng phân tích"
      onClick={(e) => { e.stopPropagation(); void setRoi(roi, { fit: true }); }}
    >
      Dùng
    </button>
  );
}
```

Create `apps/web/src/features/roi/ui/RoiCandidates.view.tsx`:

```tsx
import type { Roi } from '@webatlas/shared';
import type { RoiCandidate } from '../model/candidates';

/** The popup's "Dùng làm vùng phân tích:" section, most specific first (U-6). */
export function RoiCandidatesView({ candidates, onUse }: { candidates: RoiCandidate[]; onUse: (roi: Roi) => void }) {
  if (candidates.length === 0) return null;
  return (
    <div className="roi-candidates">
      <div className="roi-candidates-title">Dùng làm vùng phân tích:</div>
      <ul>
        {candidates.map((c) => (
          <li key={c.key} className="roi-candidate">
            <span>{c.label}{c.detail && <span className="roi-chip-muted"> · {c.detail}</span>}</span>
            {c.roi ? (
              <button type="button" aria-label={`Dùng ${c.label} làm vùng phân tích`} onClick={() => onUse(c.roi!)}>Dùng</button>
            ) : (
              <span className="roi-chip-muted">{c.note}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: The popup**

In `apps/web/src/features/map/model/basemapInfo.ts`:
- add to `BasemapFeature`: `/** For the ROI lookup (Task 7): the clicked segment and its table. */ osmId?: string; table?: string;`
- widen `RawCollection` to `features?: Array<{ id?: string; properties?: Record<string, unknown> }>;`
- in `pickBasemapFeature`, before `return out as unknown as BasemapFeature;`, add
  ```ts
    const osmId = props.osm_id;
    if (typeof osmId === 'string' || typeof osmId === 'number') out.osmId = String(osmId);
    // GetFeatureInfo ids are "<table>.<fid>", e.g. "roads_region.fid-…".
    if (typeof chosen.id === 'string' && chosen.id.includes('.')) out.table = chosen.id.split('.')[0];
  ```

In `apps/web/src/components/DynamicPopup.tsx`:
- add imports:
  ```ts
  import { adminCandidates, entityCandidates, referenceLayerOfTable, thematicCandidate, type RoiCandidate } from '../features/roi/model/candidates';
  import { fetchEntitiesByMember } from '../features/roi/api/roi.api';
  import { RoiCandidatesView } from '../features/roi/ui/RoiCandidates.view';
  import { setRoi } from '../features/roi/model/roi.store';
  ```
- add state beside `popupData`: `const [candidates, setCandidates] = useState<RoiCandidate[]>([]);`
- in `clickHandler`, replace `const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f);` with a pass that collects every hit:
  ```ts
      // Every feature under the click, not just the first: the thematic feature, and the
      // ward and province boundaries, are all "Dùng làm vùng phân tích" candidates (U-6).
      let feature: any = null;
      let thematic: any = null;
      let province: any = null;
      let ward: any = null;
      map.forEachFeatureAtPixel(e.pixel, (f, layer) => {
        const p = f.getProperties();
        if (!feature) feature = f;
        // The normalized props carry `id` for CRUD; fall back to the WFS feature id
        // ("rivers.<uuid>") so a layer that does not set it still offers its feature.
        if (!thematic && p.layerKey) thematic = { ...p, id: p.id ?? String(f.getId() ?? '').split('.').pop() };
        const layerId = layer?.get('id');
        if (!province && layerId === 'layer_provinces_2026') province = p;
        if (!ward && layerId === 'layer_wards_2026') ward = p;
        return undefined; // keep iterating
      });
      const zoom = map.getView().getZoom() ?? 0;
      const base = [
        ...(thematic ? [thematicCandidate(thematic)].filter((c): c is RoiCandidate => c !== null) : []),
        ...adminCandidates(province, ward, zoom),
      ];
      setCandidates(base);
  ```
- in the basemap branch, inside `.then((found) => { … })`, after `setPopupData({ … layerKey: 'basemap' } });`, add
  ```ts
            const layer = found.table ? referenceLayerOfTable(found.table) : null;
            if (layer && found.osmId) {
              fetchEntitiesByMember(layer, found.osmId)
                .then((entities) => setCandidates([...entityCandidates(layer, entities), ...base]))
                .catch(() => { /* the admin candidates stay; the lookup is a convenience */ });
            }
  ```
- render the section inside the popup, right after `<div className="popup-content">{renderPopupContent()}</div>`:
  ```tsx
        <RoiCandidatesView
          candidates={candidates}
          onUse={(roi) => { void setRoi(roi, { fit: true }); setPopupData(null); }}
        />
  ```

- [ ] **Step 5: Search and result rows**

In `apps/web/src/features/search/api/search.api.ts`:
- add a third member to `SearchHit`:
  ```ts
    | {
        /** A province or ward of the working region; featureId is its code (Task 6). */
        source: 'admin';
        layerKey: 'province' | 'ward';
        featureId: string;
        name: string;
        lonLat: [number, number];
      };
  ```
- add `'admin'` to `SOURCES` (after `'ref:places'`).

In `apps/web/src/features/search/ui/SearchBox.view.tsx`:
- add `renderAction?: (hit: SearchHit) => ReactNode;` to `Props` (import `type ReactNode` from 'react') and destructure it;
- compute the badge as
  ```ts
            const badge = hit.source === 'reference' ? 'Nền bản đồ'
              : hit.source === 'admin' ? (hit.layerKey === 'province' ? 'Tỉnh' : 'Xã/phường')
                : (LAYER_BADGE[hit.layerKey] ?? hit.layerKey);
  ```
- render the action after the result `<button>…</button>` inside the `<li>`: `{renderAction?.(hit)}`.

In `apps/web/src/features/search/index.tsx`:
- import `{ UseAsRoiButton }` from `'../roi/ui/UseAsRoiButton'`, `{ roiOfSearchHit }` from `'../roi/model/candidates'`, and `isRegionProvince` from `'@webatlas/shared'`;
- in `onSelect`, after the `clear();` line, add the admin branch:
  ```ts
    if (hit.source === 'admin') {
      if (hit.layerKey === 'province' && isRegionProvince(hit.featureId)) {
        run({ kind: 'zoomToRegion', provinceCode: hit.featureId });
      } else {
        run({ kind: 'showGeometries', fit: true, items: [{ geometry: { type: 'Point', coordinates: hit.lonLat }, role: 'highlight', label: hit.name }] });
      }
      return;
    }
  ```
- pass `renderAction={(hit) => <UseAsRoiButton roi={roiOfSearchHit(hit)} label={hit.name} />}` to `SearchBoxView`.

In `apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx`: add `renderRowAction?: (row: AnalysisRow) => ReactNode;` to the props (import `type ReactNode` from 'react'), destructure it, and render `{renderRowAction?.(row)}` right after the row's `<button className="analysis-row">…</button>` inside its `<li>`.

In `apps/web/src/features/analysis/index.tsx`: import `{ UseAsRoiButton }` from `'../roi/ui/UseAsRoiButton'`, and pass to `AnalysisResultCardView`:

```tsx
      renderRowAction={(row) =>
        row.layerKey && row.featureId
          ? <UseAsRoiButton roi={{ source: 'feature', layerKey: row.layerKey, featureId: row.featureId }} label={row.name ?? 'đối tượng'} />
          : null}
```

Append to `apps/web/src/styles/main.css`:

```css
.use-as-roi { background: none; border: 1px solid var(--primary); color: var(--primary); border-radius: 6px;
  padding: 0 6px; margin-left: 6px; font-size: 12px; cursor: pointer; }
.roi-candidates { border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 6px; font-size: 12px; }
.roi-candidates-title { color: var(--text-muted, #6b7280); margin-bottom: 4px; }
.roi-candidates ul { list-style: none; margin: 0; padding: 0; }
.roi-candidate { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }
.roi-candidate button { background: none; border: none; color: var(--primary); cursor: pointer; font: inherit; }
```

- [ ] **Step 6: Run everything**

Run: `npm run test -w @webatlas/web` → green.
Run: `npm run build:web` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/roi apps/web/src/features/map/model/basemapInfo.ts \
        apps/web/src/features/map/model/basemapInfo.test.ts apps/web/src/components/DynamicPopup.tsx \
        apps/web/src/features/search apps/web/src/features/analysis apps/web/src/styles/main.css
git commit -m "feat(web): 'Dùng làm vùng phân tích' ở popup, tìm kiếm và kết quả

Popup liệt kê mọi ứng viên tại điểm nhấp: đối tượng (đoạn sông có tên → cả sông),
cả tuyến đường của đoạn nền bản đồ, xã/phường (từ mức 10) và tỉnh — tên đường không
còn thay mất đơn vị hành chính. Tìm kiếm có tỉnh/xã; mỗi hàng kết quả có nút Dùng.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Browser pass and documentation

**Files:**
- Modify: `docs/architecture/database-architecture.md`, `docs/superpowers/plans/2026-09-30-plan-4-roi-and-analysis-toolbar.md` (execution notes)
- Create: `docs/runbooks/vung-phan-tich.md`

- [ ] **Step 1: Run the browser pass**

The parent spec §10 requires it: jsdom cannot prove a button is reachable. Follow the run recipe saved in memory (`dev-run-environment`): start the API (`cd apps/api && npx tsx src/start.ts`, backgrounded) and the web app (`npm run dev:web`, backgrounded); drive system Chrome with `puppeteer-core` resolved against the project root (`createRequire('…/webatlas/package.json')`), headless, 1440×900; wait for tile traffic to go quiet before each screenshot. Script it in the session scratchpad — it is not committed.

Drive and screenshot each step:

1. **Tools start disabled**: every tool button carries `aria-disabled="true"`; pressing "Trắc diện độ cao" puts "Chưa có vùng phân tích" in the chip.
2. **Search → ROI**: type "Thu Bồn", press the result's "Dùng" button; the chip reads "Sông Thu Bồn · đường · … km", the map frames the river, "Trắc diện độ cao" is enabled; run it; the profile card reads "Kết quả cho: Sông Thu Bồn".
3. **Radius**: press "Bán kính", pick "5"; the chip reads "Sông Thu Bồn + 5 km · vùng · … km²"; "Chọn trong vùng" enables; run it with dams; count > 0.
4. **Result row → ROI**: press "Dùng" on a dam row; the chip shows the dam; run "Gần nhất" on stations; the first row is not that dam.
5. **Ruler keeps the ROI**: use "Đo chiều dài", draw a line, finish; the chip still shows the dam.
6. **Draw with aids**: press "Vẽ đa giác", click three points, hover near the first — the enlarged first vertex and "Nhấp để khép vùng" appear; click it; the chip shows "Hình vẽ · vùng · … km²".
7. **Popup admin candidates**: zoom to 11 over Đắk Lắk, click an empty spot; the popup lists "Phường/Xã … · xã/phường" and "Tỉnh Đắk Lắk · tỉnh"; press the province's "Dùng"; the chip shows "Tỉnh Đắk Lắk"; "Thống kê độ cao" is disabled with the 5.000 km² reason in its tooltip.

Record what each screenshot showed in Step 3's execution notes. Any step that fails is a bug to fix (and a test to add) before continuing.

- [ ] **Step 2: The documents**

In `docs/architecture/database-architecture.md`:
- bump the revision to `1.4 — <today>` and add, under the Phase 3 line, `Phase 4 (the region of interest and the analysis toolbar) implemented; see docs/superpowers/plans/2026-09-30-plan-4-roi-and-analysis-toolbar.md.`;
- retitle §8 "Region-of-interest model (implemented)" and replace its last two paragraphs (from "Of the four admitted sources…") with a description of what shipped: the four sources as built (`drawn`, `feature` with `whole`, `reference`, `admin`) and why the spec's `result` source was dropped; `resolveRoi` as the only ROI → geometry code, the limits it applies to every source and the admin exemption from the resulting-vertex cap with its measurement (Khánh Hoà 5,195 vertices); `POST /api/roi/resolve`; `select_within` over an admin unit counting by stamped codes, and why (the 5.2 s cold measurement, agreement with `features_in_admin_unit`); Gần nhất from the centroid;
- in §10.2.1 add `POST /api/roi/resolve`, the `admin` source on `GET /api/search`, and `?member=` on the reference entity list; note that `POST /api/analysis/:op` bodies now take `roi` (except `buffer`);
- in §11 add the GIN index on `reference_entities.member_ids` (migration 21);
- in §14 record Phase 4 as shipped and the remaining order (cross-entity relationships, then the assistant operations).

Create `docs/runbooks/vung-phan-tich.md` — a short Vietnamese guide for users of the map:

```markdown
# Vùng phân tích — hướng dẫn sử dụng

Mọi công cụ phân tích chạy trên **một vùng phân tích** duy nhất, hiện trong ô phía trên thanh công cụ.

## Chọn vùng phân tích
- **Vẽ**: nhóm "Vẽ" có đa giác, hình chữ nhật, đường và điểm. Nhấp đúp hoặc Enter để kết thúc,
  Backspace xoá điểm vừa đặt, Esc huỷ. Con trỏ bắt dính vào đối tượng trên bản đồ; giữ Alt để vẽ tự do.
- **Nhấp bản đồ**: popup có mục "Dùng làm vùng phân tích" — đối tượng vừa nhấp (một đoạn sông có tên
  sẽ lấy cả con sông), cả tuyến đường, xã/phường (phóng tới mức 10) và tỉnh.
- **Tìm kiếm**: mỗi kết quả có nút "Dùng" — gồm cả tỉnh và xã/phường trong vùng công tác.
- **Từ kết quả**: mỗi dòng trong thẻ kết quả có nút "Dùng", ví dụ để chọn một đập rồi tìm trạm gần nhất.

Chọn vùng mới sẽ thay vùng cũ.

## Bán kính
Với đường hoặc điểm, bấm "Bán kính" trong ô vùng phân tích (1, 2, 5, 10 km hoặc tự nhập, tối đa 100 km)
để biến nó thành một vùng. Bấm lại để đổi hoặc bỏ bán kính.

## Công cụ
| Nhóm | Công cụ | Cần |
|---|---|---|
| Vùng | Chọn trong vùng, Thống kê độ cao (tối đa 5.000 km²) | một vùng |
| Tuyến | Trắc diện độ cao | một đường |
| Lân cận | Gần nhất | bất kỳ; đường và vùng tính từ trọng tâm |

Nút bị mờ vẫn bấm được: ô vùng phân tích sẽ nói cần gì để dùng nó.
Chọn trong vùng trên một tỉnh hoặc xã đếm theo mã hành chính đã gán, giống như Trợ lý.

## Đo nhanh
"Đo chiều dài" và "Đo diện tích" không thay đổi vùng phân tích.
```

Add a row for it to the table in `docs/runbooks/README.md`? No — that table is the setup order; instead add one line under the table: `For map users: [Vùng phân tích](vung-phan-tich.md) explains choosing an ROI and the analysis tools.`

- [ ] **Step 3: Execution notes**

Append an "Execution Notes" section to this plan: each deviation taken during execution, each measurement (the NFR-1 timings from Task 5, the browser-pass observations from Step 1), and every mutation check's result.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/database-architecture.md docs/runbooks/vung-phan-tich.md docs/runbooks/README.md \
        docs/superpowers/plans/2026-09-30-plan-4-roi-and-analysis-toolbar.md
git commit -m "docs: vùng phân tích — kiến trúc §8 đã triển khai, hướng dẫn người dùng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final Verification

Run before merging:

```bash
npm run build:shared
npm run test -w @webatlas/shared
npm run test -w @webatlas/api
cd apps/api && npx tsc --noEmit -p . && cd ../..
npm run test -w @webatlas/web
npm run build:web
npm run migrate:down -w @webatlas/api && npm run migrate:up -w @webatlas/api   # migration 21 round trip
```

Expected: every command exits 0; `grep -rn "inputGeometry\|areaGeometry\|referenceGeometry\|lastShape" apps/api/src apps/web/src` prints nothing.

## Definition of Done

- One active ROI, set by drawing, the popup, search or a result row; replaced by the next pick; kept when a pick fails.
- Every analysis operation resolves the ROI on the server; the chip never shows an ROI a tool then refuses without saying why.
- Tools enable from the ROI's kind and size; a disabled tool explains itself on hover and when pressed.
- "Sông Thu Bồn + 5 km → đập trong vùng → trạm gần đập lớn nhất" works end to end in the browser.
- Counting dams in Đắk Lắk gives the same number in the toolbar and from the assistant.
- The ruler measures without touching the ROI.

---

## Execution Notes (2026-09-30)

Recorded here because Task 14 Step 3 asks for them. Summarised from the progress ledger and the per-task reports
(`.superpowers/sdd/progress.md`, `task-N-report.md`). Where a report gives no result, these notes say so.

### Deviations

- **Task 2 (`e1f47b3..93178b6`).** GEOS 3.9.0's `ST_Intersection` returns EMPTY for an exactly horizontal or vertical
  line lying wholly inside the region. The clip therefore keeps a shape that is already `ST_CoveredBy` the region as it
  is, and intersects only otherwise (`93178b6`). A boundary-crossing horizontal line was measured correct, and a
  vertical-line test was added. The resolved Khánh Hoà geometry has **5,031** vertices after `ST_AsGeoJSON(…, 7)`, not
  the stored 5,195 that Step 5's expected message names. The comment and the test title still say 5,195.
- **Task 4 (`ddfd312..38f8c2f`).** `riverEntities.test.ts` was not in the task's file list. It called `selectWithinOp`
  with the old `{ geometry }` body, and was moved to `{ roi }` with the same assertions.
- **Task 5 (`38f8c2f..73f7b07`).** Step 5's mutation could not fail as written, because the `'Cách đếm'` row was set
  from `facts.admin` whichever path was taken. Fixed in `73f7b07` by tying the row to `inArea.method`.
- **Task 6 (`73f7b07..fe0676e`).** The planned "Hà Nội → no admin hits" test was wrong: Xã Hà Nha is in the region and
  matches. It was replaced by region-membership and non-empty assertions, plus a partial-name test. The trigram `%`
  operator was kept, and an implementer's `similarity > 0.5` was reverted.
- **Task 8 (`58b83cd..3ce51e6`).** The store was made safe when a drawing and a resolve overlap. `setRoi` always enters
  `resolving`, so a drawn shape ends its drawing. Only a drawing started after the pick survives it, and `stopDrawing`
  does nothing unless a drawing is in progress.
- **Task 9 (`3ce51e6..b1c712c`).** The chip test's regex `/nhấp đúp để kết thúc/` contradicted the planned hint "nhấp
  đúp hoặc Enter để kết thúc". The coordinator kept the hint and changed the regex. Review fix `b1c712c`: the chip
  re-drew and re-fitted the ROI on every layer toggle. The executor now lives in a ref, and the effect depends on
  `[resolved, map]`.
- **Task 11 (`aae6ef1..03ebf50`).** `RoiChip` also needed `useDrawFeedback()`. Review fix `03ebf50`: the click that
  finishes a drawing opened the popup, because OpenLayers fires `singleclick` about 250 ms late. `drawingJustEnded()`
  now gives a 300 ms grace period.
- **Task 12 (`03ebf50..3cd6e56`).**
  - `MapBrowserEvent<PointerEvent>` became `MapBrowserEvent` (tsc TS2769).
  - Esc is owned by `attachDrawAids` alone; the document listener in `RoiDrawButtons` was removed.
  - `keyBelongsToTarget` skips inputs, buttons, selects and links for every key except Esc. Esc must still cancel while
    the draw button just pressed holds focus.
  - Tests and implementation were written together, so the module-missing failure was not observed separately.
  - Review fix `3cd6e56`: the aids' `drawend` `onMeasure(null)` wiped the ruler's final value, and Enter hijacked a
    focused button.
- **Task 13 (`3cd6e56..db85a02`).** The existing search tests' button-name regexes were anchored with `/^(?!Dùng ).*/`,
  because the new button's name contains the hit's name. Review fix `db85a02`: the popup's asynchronous lookups raced
  across clicks and could offer the previous click's region. A click-sequence guard, candidate clearing and
  `DynamicPopup.test.tsx` were added.
- **Tasks 1, 3, 7, 10.** No deviations reported.
- **Task 14.** Step 1 found two bugs, both fixed before the documentation (see below). Two of Step 1's expectations did
  not match the data; they are recorded with the browser pass.

### Measurements

- **NFR-1 (Task 5, budget tests against the development database).** All inside the 5 s budget.

  | Query | Time | Re-run after restoring the mutation |
  |---|---|---|
  | `select_within` over Lâm Đồng (province `68`), four layers, by stamped codes | **1,725 ms** | 1,826 ms |
  | Geometric path, the longest river + 10 km, four layers | **2,459 ms** | 2,158 ms |
  | Assistant/toolbar parity test, three layers | 1,310 ms | — |

  Before the stamped-code path, the geometric path over Lâm Đồng measured 5.2 s cold (Measured Baselines).
- **Task 2.** Khánh Hoà resolves to 5,031 vertices (see above). Without the admin exemption, that is still over the
  5,000 cap.

### Mutation checks

| Task | Mutation | Result |
|---|---|---|
| 2 | `bounded: false` → `true` in `adminSource` | "resolves Khánh Hoà" fails with "Vùng phân tích quá phức tạp: 5.031 điểm vượt giới hạn 5.000 điểm". Restored, 16/16 pass |
| 4 | `excludeId` spread removed from `nearestOp` | "excludes the ROI itself…" fails (1 failed, 38 passed). Restored |
| 4 | `const fromCentroid = false` | "measures from the centroid…" fails (1 of 38). Restored, analysis green |
| 5 | `const inArea = false ? …` | Passed at first, because the plan's check could not fail. After `73f7b07` the parity test fails on `'Cách đếm'` (undefined). Restored, green |
| 12 | `useMeasure` wiring reverted (fix `3cd6e56`) | The two new `useMeasure` tests fail. Restored from a file copy |
| 13 | The two `isCurrent` guards removed (fix `db85a02`) | The two race tests fail; the failure-fallback test passes, as expected. Restored from a file copy, 3/3 pass |
| 14 | `queryNearest`'s old fallback condition (fix `8bdcf7f`) | Both new tests fail: 1 of 2 stations returned, both with the fake DB and on the live DB. Fixed, 3/3 pass |
| 14 | Popup placed by the map pixel alone (fix `c340abf`) | The new placement test fails (`25px`, expected `393px`). Fixed, 4/4 pass |

The plan gave Tasks 1, 3, 6, 7, 8, 9, 10 and 11 no mutation check, and their reports record none. Their new tests were
seen failing before the code existed (RED), except in Task 12 (see above). Task 7's report also records the migration
21 round trip.

### Browser pass (Task 14 Step 1)

The pass drove headless system Chrome through `puppeteer-core` at 1440×900, against the API on :3001 and Vite on :5173.
Each screenshot was taken after tile traffic had been quiet for 3 s. The layers panel is open by default, so the map
starts at x = 368.

1. **Tools start disabled — pass.**
   - All four tools carry `aria-disabled="true"`.
   - The tooltip of "Trắc diện độ cao" reads "Trắc diện độ cao — Chưa có vùng phân tích".
   - Pressing it opens no panel, and adds "Chưa có vùng phân tích" to the chip under the placeholder.
2. **Search → ROI — pass.**
   - "Thu Bồn" returns two hits named "Sông Thu Bồn": the river (badge "Sông") and a basemap water polygon (badge "Nền
     bản đồ"). Their "Dùng" buttons share the accessible name "Dùng Sông Thu Bồn làm vùng phân tích", so the driver
     picked the river's button by its badge.
   - The chip reads "Vùng phân tích: Sông Thu Bồn · đường · 95 km", the map frames the river (1:215.000), and "Trắc
     diện độ cao" enables.
   - The profile card reads "Kết quả cho: Sông Thu Bồn", with 100/100 samples from 3 to 16.5 m, over **57.04 km**. The
     merged river has three disjoint parts totalling 95.6 km, and the profile follows the longest part. That behaviour
     is documented in `elevationProfile.ts` and this plan did not change it.
3. **Radius — pass, with a data finding.**
   - "Bán kính" → "5" gives "Sông Thu Bồn + 5 km · vùng · 850 km²" and enables "Chọn trong vùng".
   - Run on dams, it counts **0**. That is the data, not a bug: the nearest active dam is 5.49 km from the river
     (`ST_Distance` over `water.dams_active`).
   - At 10 km, "Sông Thu Bồn + 10 km · vùng · 1.672 km²" counts 1 dam, Sông Tranh 4, and the chain continues from
     there.
   - On this data, the Definition of Done's chain "Sông Thu Bồn + 5 km → đập trong vùng → trạm gần đập lớn nhất" works
     end to end only with 10 km.
4. **Result row → ROI — pass after fix `8bdcf7f`.**
   - "Dùng" on Sông Tranh 4 gives "Sông Tranh 4 · điểm".
   - "Gần nhất" on stations answers "Kết quả cho: Sông Tranh 4", with Trạm Đo Mưa Phú Ninh first at 32.3 km.
   - Before the fix it listed one station, although the layer has two and k was 5. Each station has 164 versions in the
     development database, so the 100-row over-fetch held only Phú Ninh's versions. The fallback then returned that
     short answer whenever the layer had fewer than k features.
   - After the fix it lists two rows, with An Khê second at 174.69 km.
5. **Ruler keeps the ROI — pass.** "Đo chiều dài", two clicks and a double-click give "Chiều dài: 47.93 km". The chip
   reads "Sông Tranh 4 · điểm" before and after.
6. **Draw with aids — pass.**
   - "Vẽ đa giác" puts the drawing hint in the chip.
   - After three clicks, hovering near the first vertex enlarges it, and the chip reads "Nhấp để khép vùng 1.358 km²".
   - Clicking it gives "Hình vẽ · vùng · 1.351 km²". The live figure had included the hover point.
7. **Popup admin candidates — pass after fix `c340abf`.**
   - The driver searched "Buôn Ma Thuột" and zoomed out to the 1:250.000 stop (zoom ≈ 11.15).
   - Clicking an empty spot lists "Xã Buôn Đôn · xã/phường" and "Tỉnh Đắk Lắk · tỉnh".
   - The province's "Dùng" gives "Tỉnh Đắk Lắk · vùng · 18.086 km²".
   - "Thống kê độ cao" is `aria-disabled`, with the tooltip "Thống kê độ cao — Vùng 18.086 km² vượt giới hạn 5.000 km²
     của thống kê độ cao". Pressing it puts that reason in the chip.
   - Before the fix, the popup opened 368 px left of the click, half hidden behind the layers panel. It is placed in the
     full-window `.app-container` by the map-relative pixel, and the map has been docked right of the rail and flyout
     since `0a5f166` (2026-09-07). The defect therefore predates this plan.

Minor observations, not fixed:
- The search dropdown stays open after "Dùng" (already in the ledger).
- The two "Sông Thu Bồn" hits share a button name.
- The order of equally similar search hits varies between runs.

### Open items

- The chip's draw hint does not mention Shift-drag freehand drawing, although spec §U-11 says the hint names it.
- Alt-to-unsnap does nothing while a draw button holds focus. `keyBelongsToTarget` skips the Alt key on a button, so
  Alt works only after the first map click moves focus to the map.
