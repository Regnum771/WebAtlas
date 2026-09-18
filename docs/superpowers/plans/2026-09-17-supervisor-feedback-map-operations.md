# Supervisor Feedback — Map Operations, Assistant Updates, Print, CRS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the day-1 cut of the supervisor feedback: admin-only writes, chat → prefilled update wizard with source fields, line/polygon highlighting, 7 spatial-analysis operations drawn on the map, print/export, and (stretch) a CRS toggle.

**Architecture:** One shared `MapCommand` contract grows two kinds (`showGeometries`, `proposeFeatureEdit`). A server-side PostGIS analysis module (`apps/api/src/modules/analysis`) is called by both an HTTP route (toolbar) and thin assistant tools. The assistant never writes: it emits a proposal the browser opens in a wizard; the admin saves through the existing `PUT` route.

**Tech Stack:** Fastify 5 + pg + PostGIS 3.4 (raster), Zod (v3 in routes, `zod/v4` inside `betaZodTool`), Anthropic SDK tool runner, React 19 + OpenLayers 10, Vitest, `proj4` (Task 16 only).

**Spec:** [docs/superpowers/specs/2026-09-17-supervisor-feedback-map-operations-design.md](../specs/2026-09-17-supervisor-feedback-map-operations-design.md)

## Global Constraints

- Branch `feat/supervisor-feedback`. Commit after every task. Commit messages in Vietnamese (repo convention), ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- User-facing strings are Vietnamese.
- Stack must be up for API tests: `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`.
- Commands: `npm run build:shared`, `npm run test:shared`, `npm run test -w @webatlas/api -- <path>`, `npm run test -w @webatlas/web -- <path>`, `npm run build:web` (type-check; vitest does not type-check), `npm run migrate`.
- **`packages/shared/dist` trap:** after editing `packages/shared/src`, run `npm run build:shared` and commit `dist`. A NEW `src/foo.ts` needs `git add -f packages/shared/dist/foo.js packages/shared/dist/foo.d.ts` — plain `git add` silently skips new dist files. Check with `git status --ignored packages/shared/dist`.
- Assistant tools: import `z` from `'zod/v4'` (plain `zod` throws inside `betaZodTool`). Append to `FACTORIES`, never insert. Every data-tool path emits `ctx.provenance(...)`; empty results start with `Không có dữ liệu:`.
- OpenLayers imports only under `apps/web/src/features/map/model/`.
- Caps (verbatim from spec): `MAX_RESULT_ITEMS = 200`, `MAX_RESULT_VERTICES = 20_000`, analysis input ≤ 5,000 vertices, buffer radius 0 < r ≤ 100 km, nearest k ≤ 25, profile samples ≤ 200 (default 100), listed rows ≤ 25, source document ≤ 500 chars, provider ≤ 200 chars, analysis rate limit 60/min, analysis statement timeout 5 s → 504 `ANALYSIS_TIMEOUT`.
- Only `admin` writes. `editor` keeps its enum value and is read-only.
- Tier checkpoints: after Task 9 (Tier A), Task 15 (Tier B), Task 16 (Tier C) the branch must be green: `npm run test:shared`, `npm run test:api`, `npm run test:web`, `npm run build:web`.

## File map

| Area | Files |
|---|---|
| RBAC | `apps/api/src/hooks/capabilities.ts`, `apps/web/src/entities/persona/persona.ts`, `apps/web/src/features/feature-editing/index.tsx` |
| Audit source | `apps/api/src/db/migrations/1000000000014_audit-source.cjs`, `apps/api/src/modules/audit/service.ts`, `apps/api/src/modules/layers/{controller,service}.ts` |
| Shared contract | `packages/shared/src/geometry.ts` (new), `packages/shared/src/analysis.ts` (new), `packages/shared/src/map-commands.ts` |
| Result rendering | `apps/web/src/features/map/model/highlightLayer.ts`, `mapCommands.ts` |
| Feature geometry | `apps/api/src/lib/resultGeometry.ts` (new), `apps/api/src/modules/assistant/tools/data/helpers.ts` (`resolveFeature`), `apps/api/src/modules/geometry/*` (new) |
| Assistant | `tools/types.ts`, `tools/registry.ts`, `prompt.ts`, `service.ts`, `controller.ts`, `tools/command/highlightFeatures.ts`, `tools/command/proposeFeatureUpdate.ts` (new), `tools/data/{bufferFeature,selectWithin,elevationProfile,zonalElevation}.ts` (new) |
| Wizard | `apps/web/src/entities/proposal/proposal.store.ts` (new), `apps/web/src/features/feature-editing/{model/useProposedEditPresenter.ts,ui/ProposedEditWizard.view.tsx,ProposedEdit.tsx}` (new) |
| Analysis API | `apps/api/src/modules/analysis/{routes,controller,schemas,db,area}.ts`, `ops/{buffer,selectWithin,nearest,elevationProfile,zonalElevation}.ts` |
| Analysis web | `apps/web/src/features/analysis/**` (new), `apps/web/src/features/map/model/{analysisDraw.ts,lastShape.ts}` (new) |
| Print | `apps/web/src/features/map/model/exportMap.ts` (new), `apps/web/src/pages/print/**` (new) |
| CRS | `packages/shared/src/crs.ts` (new), `apps/web/src/features/map/model/crs.ts` (new), `apps/web/src/features/map/ui/CrsSelect.tsx` (new) |

---

# Tier A

### Task 1: Admin-only writes (RBAC)

**Files:**
- Modify: `apps/api/src/hooks/capabilities.ts`
- Modify: `apps/api/src/hooks/capabilities.test.ts`
- Modify: `apps/api/src/modules/layers/layers.test.ts:77-93`
- Modify: `apps/web/src/entities/persona/persona.ts`
- Modify: `apps/web/src/entities/persona/persona.test.ts`
- Modify: `apps/web/src/entities/persona/usePersona.test.ts:43-56`
- Modify: `apps/web/src/features/shell/model/useShellPresenter.test.ts:25-29`
- Modify: `apps/web/src/features/feature-editing/index.tsx:130-140`
- Modify: `apps/web/src/features/user-management/ui/UserFormModal.view.tsx:44`
- Modify: `apps/web/src/app/App.tsx:73`

**Interfaces:**
- Produces: `CAN_WRITE_FEATURES = ['admin']`; `rolePersonas('editor') === ['governance','research']`; `PERSONAS.steward.requiredRole === 'admin'`.

- [ ] **Step 1: Update the API capability test to the new rule**

In `apps/api/src/hooks/capabilities.test.ts` replace the write test:

```ts
  it('write features: admin only (editor is read-only since 2026-09-17)', () => {
    expect([...CAN_WRITE_FEATURES]).toEqual(['admin']);
  });
```

In `apps/api/src/modules/layers/layers.test.ts` replace the whole `it('editor can read and write features', ...)` block with:

```ts
  it('editor can read features but cannot write (read-only since 2026-09-17)', async () => {
    const editorToken = await tokenFor(EDITOR);
    const eAuth = { authorization: `Bearer ${editorToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: eAuth });
    expect(read.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: eAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.81, 21.01] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/hooks/capabilities.test.ts src/modules/layers/layers.test.ts`
Expected: FAIL — capability test gets `['admin','editor']`; editor create returns 201.

- [ ] **Step 3: Change the capability**

`apps/api/src/hooks/capabilities.ts`:

```ts
import type { Role } from '../modules/users/repository';

// Single source of truth for the role → capability matrix (design §2, §4.1).
// Routes reference these named sets; they never inline role literals.
export const CAN_READ_FEATURES: readonly Role[] = ['admin', 'editor', 'viewer'];
// Admin only (supervisor feedback 2026-09-17): "chỉ admin mới có quyền cập nhật,
// người dùng readonly". `editor` keeps its enum value so existing accounts still
// log in, but it grants nothing beyond `viewer`.
export const CAN_WRITE_FEATURES: readonly Role[] = ['admin'];
export const CAN_MANAGE_USERS: readonly Role[] = ['admin'];
```

- [ ] **Step 4: Run API tests to verify pass**

Run: `npm run test -w @webatlas/api -- src/hooks/capabilities.test.ts src/modules/layers/layers.test.ts`
Expected: PASS.

- [ ] **Step 5: Update web tests to the new persona mapping**

`apps/web/src/entities/persona/persona.test.ts` — replace the editor test and the steward assertion:

```ts
  it('editor is read-only: governance + research, like viewer', () => {
    expect(rolePersonas('editor')).toEqual(['governance', 'research']);
  });
```

```ts
    expect(PERSONAS.steward.requiredRole).toBe('admin');
```

`apps/web/src/entities/persona/usePersona.test.ts` — replace the two editor-based tests:

```ts
  it('ignores a stored pick that is invalid for the role (falls back to first available)', () => {
    mockRole = 'viewer'; // governance + research
    localStorage.setItem(PERSONA_STORAGE_KEY, 'steward'); // not allowed for viewer
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('governance');
  });

  it('setActive rejects an id not available to the role', () => {
    mockRole = 'viewer';
    const { result } = renderHook(() => usePersona());
    act(() => result.current.setActive('admin')); // not allowed
    expect(result.current.active).toBe('governance'); // unchanged
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).not.toBe('admin');
  });
```

`apps/web/src/features/shell/model/useShellPresenter.test.ts` — rename the `'editor has a drawer'` test (the input `['steward']` is still a valid persona set, only admin reaches it now):

```ts
  it('a steward persona set has a drawer', () => {
```

- [ ] **Step 6: Run to verify failure**

Run: `npm run test -w @webatlas/web -- src/entities/persona`
Expected: FAIL — `rolePersonas('editor')` returns `['steward']`, steward requiredRole is `'editor'`.

- [ ] **Step 7: Implement the web side**

`apps/web/src/entities/persona/persona.ts`:

```ts
export const PERSONAS: Record<PersonaId, Persona> = {
  public:     { id: 'public',     label: 'Public',       requiredRole: null },
  governance: { id: 'governance', label: 'Governance',   requiredRole: 'viewer' },
  research:   { id: 'research',   label: 'Research',     requiredRole: 'viewer' },
  steward:    { id: 'steward',    label: 'Data Steward', requiredRole: 'admin' },
  admin:      { id: 'admin',      label: 'Management',   requiredRole: 'admin' },
};

// Which personas a role may inhabit. admin is a superset (steward + admin).
// editor is read-only since 2026-09-17 (only admin writes), so it reads like viewer.
export function rolePersonas(role: Role | null | undefined): PersonaId[] {
  if (role === 'admin') return ['steward', 'admin'];
  if (role === 'editor' || role === 'viewer') return ['governance', 'research'];
  return ['public'];
}
```

`apps/web/src/features/feature-editing/index.tsx` — replace the final comment + component:

```tsx
// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// write route); a non-admin who forces this open still gets 403 on the API call.
// Only admins edit features (CAN_WRITE_FEATURES, supervisor feedback 2026-09-17).
export default function FeatureEditing() {
  return (
    <RequireRole role="admin">
      <EditToolbar />
      <EditExisting />
    </RequireRole>
  );
}
```

`apps/web/src/features/user-management/ui/UserFormModal.view.tsx:44`:

```tsx
          <option value="editor">editor (chỉ xem)</option>
```

`apps/web/src/app/App.tsx:73` comment: `{/* Left: doing. Burger drawer with the editing tools (admin only). */}`

- [ ] **Step 8: Run web tests + type-check**

Run: `npm run test -w @webatlas/web -- src/entities src/features/shell src/features/feature-editing src/features/user-management src/features/auth` then `npm run build:web`
Expected: PASS; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/hooks apps/api/src/modules/layers/layers.test.ts apps/web/src/entities/persona apps/web/src/features/shell apps/web/src/features/feature-editing/index.tsx apps/web/src/features/user-management/ui/UserFormModal.view.tsx apps/web/src/app/App.tsx
git commit -m "feat(rbac): chỉ admin được ghi dữ liệu, editor chuyển sang chỉ xem

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Source document / provider on the audit log

**Files:**
- Create: `apps/api/src/db/migrations/1000000000014_audit-source.cjs`
- Modify: `apps/api/src/modules/audit/service.ts`
- Modify: `apps/api/src/modules/layers/controller.ts:10`
- Modify: `apps/api/src/modules/layers/service.ts` (`FeatureInput`, `create`, `update`)
- Test: `apps/api/src/modules/layers/layers.test.ts`

**Interfaces:**
- Produces: `PUT/POST /api/layers/:key/features[/:id]` body accepts `source?: { document: string (1..500), provider: string (1..200) }`; stored in `app.audit_log.source_document` / `source_provider`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('feature CRUD (admin only)'...)` block in `layers.test.ts`:

```ts
  it('admin update stores the source document and provider on the audit row', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };
    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.99, 12.93] }, properties: { name: NAME } },
    });
    const id = create.json().feature.id;

    const upd = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: {
        properties: { wattage_mw: 72 },
        source: { document: 'Quyết định 123/QĐ-UBND', provider: 'Sở Công Thương Đắk Lắk' },
      },
    });
    expect(upd.statusCode).toBe(200);

    const { rows } = await getPool().query(
      `SELECT source_document, source_provider FROM app.audit_log
        WHERE feature_id = $1 AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [id]
    );
    expect(rows[0]).toEqual({ source_document: 'Quyết định 123/QĐ-UBND', source_provider: 'Sở Công Thương Đắk Lắk' });
  });

  it('rejects a blank source provider', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'PUT', url: '/api/layers/dams/features/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token}` },
      payload: { properties: { name: 'x' }, source: { document: 'QĐ 1', provider: '' } },
    });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/layers/layers.test.ts`
Expected: FAIL — column `source_document` does not exist; blank provider returns 404 not 400.

- [ ] **Step 3: Migration**

`apps/api/src/db/migrations/1000000000014_audit-source.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Nguồn của một lần sửa dữ liệu (phản hồi giám sát 2026-09-17): cập nhật số liệu qua
 * trợ lý phải kèm tài liệu nguồn và người cung cấp. Lưu cạnh before/after trên chính
 * dòng audit để một lần sửa và bằng chứng của nó không thể tách rời.
 *
 * Nullable: sửa thủ công trong ngăn Biên tập chưa bắt buộc hai trường này.
 */
exports.up = (pgm) => {
  pgm.addColumns({ schema: 'app', name: 'audit_log' }, {
    source_document: { type: 'text' },
    source_provider: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns({ schema: 'app', name: 'audit_log' }, ['source_document', 'source_provider']);
};
```

Run: `npm run migrate`
Expected: `Migrating files: - 1000000000014_audit-source` and `Migrations complete!`

- [ ] **Step 4: Audit service**

`apps/api/src/modules/audit/service.ts`:

```ts
import type { Pool } from 'pg';

export interface EditSource { document: string; provider: string }

export function auditService(pg: Pool) {
  return {
    async record(entry: {
      userId?: string; action: 'create' | 'update' | 'delete';
      tableName: string; featureId?: string | null; before?: unknown; after?: unknown;
      source?: EditSource;
    }): Promise<void> {
      await pg.query(
        `INSERT INTO app.audit_log (user_id, action, table_name, feature_id, before, after, source_document, source_provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [entry.userId ?? null, entry.action, entry.tableName, entry.featureId ?? null,
         entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null,
         entry.source?.document ?? null, entry.source?.provider ?? null]
      );
    },
  };
}
```

- [ ] **Step 5: Controller body schema**

`apps/api/src/modules/layers/controller.ts` line 10:

```ts
const Source = z.object({
  document: z.string().trim().min(1, 'Thiếu tài liệu nguồn').max(500),
  provider: z.string().trim().min(1, 'Thiếu người cung cấp').max(200),
});
const FeatureBody = z.object({
  geometry: z.unknown().optional(),
  properties: z.record(z.unknown()).optional(),
  source: Source.optional(),
});
```

- [ ] **Step 6: Service passes it through**

In `apps/api/src/modules/layers/service.ts`:

```ts
import { auditService, type EditSource } from '../audit/service';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown>; source?: EditSource };
```

In `create`: `await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row, source: input.source });`

In `update`: `await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after, source: input.source });`

- [ ] **Step 7: Run tests to verify pass**

Run: `npm run test -w @webatlas/api -- src/modules/layers`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/migrations/1000000000014_audit-source.cjs apps/api/src/modules/audit apps/api/src/modules/layers
git commit -m "feat(api): lưu tài liệu nguồn và người cung cấp trên nhật ký sửa đổi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Shared contract — geometry, analysis result, `showGeometries`, `proposeFeatureEdit`

**Files:**
- Create: `packages/shared/src/geometry.ts`, `packages/shared/src/geometry.test.ts`
- Create: `packages/shared/src/analysis.ts`
- Modify: `packages/shared/src/map-commands.ts`, `packages/shared/src/map-commands.test.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces (all exported from `@webatlas/shared`):
  - `type GeoJsonGeometry` (Point/MultiPoint/LineString/MultiLineString/Polygon/MultiPolygon)
  - `isGeoJsonGeometry(v: unknown): v is GeoJsonGeometry`
  - `positionsOf(g: GeoJsonGeometry): number[][]`, `countVertices(g: GeoJsonGeometry): number`
  - `RESULT_ROLES`, `type ResultRole = 'highlight'|'input'|'result'`
  - `interface ResultGeometry { geometry: GeoJsonGeometry; role: ResultRole; label?: string; layerKey?: EditableLayerKey; featureId?: string }`
  - `MAX_RESULT_ITEMS = 200`, `MAX_RESULT_VERTICES = 20_000`, `MAX_SOURCE_DOCUMENT_LENGTH = 500`, `MAX_SOURCE_PROVIDER_LENGTH = 200`
  - `capResultItems(items: ResultGeometry[]): { items: ResultGeometry[]; truncated: boolean }`
  - `editableColumns(layerKey: EditableLayerKey): string[]` (LAYER_ATTRIBUTE_MAP columns minus `external_id`)
  - `MapCommand` members `{ kind: 'showGeometries'; items: ResultGeometry[]; fit?: boolean }` and `FeatureEditProposal` = `{ kind: 'proposeFeatureEdit'; layerKey; featureId; name?; current: Record<string,string|null>; proposed: Record<string,string|null>; sourceDocument?; sourceProvider? }`
  - `ANALYSIS_OPS`, `type AnalysisOp`, `interface AnalysisRow`, `interface ProfileSample`, `interface AnalysisResult`

- [ ] **Step 1: Write geometry tests**

`packages/shared/src/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isGeoJsonGeometry, countVertices, positionsOf } from './geometry.js';

describe('isGeoJsonGeometry', () => {
  it('accepts every supported type', () => {
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [108, 12] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiPoint', coordinates: [[108, 12]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'LineString', coordinates: [[108, 12], [108.1, 12.1]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiLineString', coordinates: [[[108, 12], [108.1, 12.1]]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] })).toBe(true);
    expect(isGeoJsonGeometry({ type: 'MultiPolygon', coordinates: [[[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]]] })).toBe(true);
  });

  it('rejects wrong nesting, non-finite and out-of-range coordinates', () => {
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [[108, 12]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'LineString', coordinates: [[108, 12]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [NaN, 12] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [200, 12] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Point', coordinates: [108, 95] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108, 12]]] })).toBe(false);
    expect(isGeoJsonGeometry({ type: 'GeometryCollection', geometries: [] })).toBe(false);
    expect(isGeoJsonGeometry(null)).toBe(false);
  });
});

describe('countVertices / positionsOf', () => {
  it('counts every position of a multi geometry', () => {
    const g = { type: 'MultiLineString' as const, coordinates: [[[1, 1], [2, 2]], [[3, 3], [4, 4], [5, 5]]] };
    expect(countVertices(g)).toBe(5);
    expect(positionsOf(g)[4]).toEqual([5, 5]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:shared -- src/geometry.test.ts`
Expected: FAIL — cannot find module `./geometry.js`.

- [ ] **Step 3: Implement `geometry.ts`**

`packages/shared/src/geometry.ts`:

```ts
/**
 * GeoJSON geometry (EPSG:4326) as it crosses the wire between the API and the
 * browser: result shapes, analysis inputs. Hand-written validation, no Zod —
 * imported by the browser bundle.
 */
export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint'; coordinates: number[][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

function isPosition(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    v[0] >= -180 && v[0] <= 180 &&
    v[1] >= -90 && v[1] <= 90
  );
}

function isLine(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length >= 2 && v.every(isPosition);
}

function isRing(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length >= 4 && v.every(isPosition);
}

function isPolygonCoords(v: unknown): v is number[][][] {
  return Array.isArray(v) && v.length >= 1 && v.every(isRing);
}

export function isGeoJsonGeometry(value: unknown): value is GeoJsonGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  const c = g.coordinates;
  switch (g.type) {
    case 'Point': return isPosition(c);
    case 'MultiPoint': return Array.isArray(c) && c.length >= 1 && c.every(isPosition);
    case 'LineString': return isLine(c);
    case 'MultiLineString': return Array.isArray(c) && c.length >= 1 && c.every(isLine);
    case 'Polygon': return isPolygonCoords(c);
    case 'MultiPolygon': return Array.isArray(c) && c.length >= 1 && c.every(isPolygonCoords);
    default: return false;
  }
}

/** Every position of a geometry, flattened. */
export function positionsOf(g: GeoJsonGeometry): number[][] {
  switch (g.type) {
    case 'Point': return [g.coordinates];
    case 'MultiPoint':
    case 'LineString': return g.coordinates;
    case 'MultiLineString':
    case 'Polygon': return g.coordinates.flat();
    case 'MultiPolygon': return g.coordinates.flat(2);
  }
}

export function countVertices(g: GeoJsonGeometry): number {
  return positionsOf(g).length;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:shared -- src/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write command tests**

Append to `packages/shared/src/map-commands.test.ts` (and add `'proposeFeatureEdit'`, `'showGeometries'` to the sorted list in the existing `'lists every kind in MAP_COMMAND_KINDS'` test — they sort after `'highlightFeatures'`/`'resetView'` respectively; keep the array alphabetically sorted):

```ts
import {
  capResultItems,
  editableColumns,
  MAX_RESULT_ITEMS,
  MAX_RESULT_VERTICES,
  type ResultGeometry,
} from './map-commands.js';

const LINE: ResultGeometry = {
  geometry: { type: 'LineString', coordinates: [[108, 12], [108.1, 12.1]] },
  role: 'highlight',
  label: 'Sông Ba',
};

describe('showGeometries', () => {
  it('accepts a well-formed command', () => {
    expect(isMapCommand({ kind: 'showGeometries', items: [LINE], fit: true })).toBe(true);
  });

  it('rejects an unknown role, a bad geometry, or an empty list', () => {
    expect(isMapCommand({ kind: 'showGeometries', items: [{ ...LINE, role: 'glow' }] })).toBe(false);
    expect(isMapCommand({ kind: 'showGeometries', items: [{ ...LINE, geometry: { type: 'Point', coordinates: [1] } }] })).toBe(false);
    expect(isMapCommand({ kind: 'showGeometries', items: [] })).toBe(false);
    expect(isMapCommand({ kind: 'showGeometries', items: [{ ...LINE, layerKey: 'nope' }] })).toBe(false);
  });

  it('rejects more than MAX_RESULT_ITEMS items or MAX_RESULT_VERTICES vertices', () => {
    const tooMany = Array.from({ length: MAX_RESULT_ITEMS + 1 }, () => LINE);
    expect(isMapCommand({ kind: 'showGeometries', items: tooMany })).toBe(false);
    const huge: ResultGeometry = {
      role: 'result',
      geometry: { type: 'LineString', coordinates: Array.from({ length: MAX_RESULT_VERTICES + 1 }, (_, i) => [108, 12 + i * 1e-6]) },
    };
    expect(isMapCommand({ kind: 'showGeometries', items: [huge] })).toBe(false);
  });

  it('capResultItems trims to the caps and says so', () => {
    const many = Array.from({ length: MAX_RESULT_ITEMS + 5 }, () => LINE);
    const capped = capResultItems(many);
    expect(capped.items).toHaveLength(MAX_RESULT_ITEMS);
    expect(capped.truncated).toBe(true);
    expect(capResultItems([LINE])).toEqual({ items: [LINE], truncated: false });
  });
});

describe('proposeFeatureEdit', () => {
  const base = {
    kind: 'proposeFeatureEdit',
    layerKey: 'dams',
    featureId: '6f1c2a54-2b0e-4d8c-9d61-1f4f1f0c2a11',
    name: 'Sông Hinh',
    current: { wattage_mw: '70', status: null },
    proposed: { wattage_mw: '72' },
    sourceDocument: 'QĐ 123',
  };

  it('accepts a well-formed proposal', () => {
    expect(isMapCommand(base)).toBe(true);
  });

  it('rejects unknown or non-editable columns, empty proposals and over-long sources', () => {
    expect(isMapCommand({ ...base, proposed: { secret: '1' } })).toBe(false);
    expect(isMapCommand({ ...base, proposed: { external_id: '9' } })).toBe(false);
    expect(isMapCommand({ ...base, proposed: {} })).toBe(false);
    expect(isMapCommand({ ...base, sourceDocument: 'x'.repeat(501) })).toBe(false);
    expect(isMapCommand({ ...base, sourceProvider: 'x'.repeat(201) })).toBe(false);
    expect(isMapCommand({ ...base, layerKey: 'nope' })).toBe(false);
  });

  it('editableColumns drops external_id', () => {
    expect(editableColumns('dams')).toContain('wattage_mw');
    expect(editableColumns('dams')).not.toContain('external_id');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm run test:shared -- src/map-commands.test.ts`
Expected: FAIL — `capResultItems` is not exported.

- [ ] **Step 7: Implement the command kinds**

In `packages/shared/src/map-commands.ts`:

(a) Add imports below the existing ones:

```ts
import { isGeoJsonGeometry, countVertices, type GeoJsonGeometry } from './geometry.js';
```

(b) Extend `MAP_COMMAND_KINDS` by appending `'showGeometries'` and `'proposeFeatureEdit'` after `'clearHighlights'`.

(c) Add after `MAX_HIGHLIGHT_POINTS`:

```ts
/** How a drawn result reads on the map: a feature the answer points at, a shape
 *  the user supplied, or a shape an analysis produced. */
export const RESULT_ROLES = ['highlight', 'input', 'result'] as const;
export type ResultRole = (typeof RESULT_ROLES)[number];

/** One shape to draw. Geometry travels inside the command, never through the
 *  model, so it costs no tokens — but it does cost payload, hence the caps. */
export interface ResultGeometry {
  geometry: GeoJsonGeometry;
  role: ResultRole;
  label?: string;
  layerKey?: EditableLayerKey;
  featureId?: string;
}

export const MAX_RESULT_ITEMS = 200;
export const MAX_RESULT_VERTICES = 20_000;
export const MAX_SOURCE_DOCUMENT_LENGTH = 500;
export const MAX_SOURCE_PROVIDER_LENGTH = 200;

/** Keeps the leading items that fit both caps. The server calls this before
 *  building a command so it never emits one its own validator rejects. */
export function capResultItems(items: ResultGeometry[]): { items: ResultGeometry[]; truncated: boolean } {
  const kept: ResultGeometry[] = [];
  let vertices = 0;
  for (const item of items) {
    const n = countVertices(item.geometry);
    if (kept.length >= MAX_RESULT_ITEMS || vertices + n > MAX_RESULT_VERTICES) {
      return { items: kept, truncated: true };
    }
    kept.push(item);
    vertices += n;
  }
  return { items: kept, truncated: false };
}

/** Columns an update may touch: the layer's attributes minus `external_id`, which
 *  is identity, not data (the API's attributeSchema excludes it too). */
export function editableColumns(layerKey: EditableLayerKey): string[] {
  return Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes).filter((c) => c !== 'external_id');
}

export interface FeatureEditProposal {
  kind: 'proposeFeatureEdit';
  layerKey: EditableLayerKey;
  featureId: string;
  name?: string;
  /** DB column → current value (as text). */
  current: Record<string, string | null>;
  /** Only the columns the proposal changes. */
  proposed: Record<string, string | null>;
  sourceDocument?: string;
  sourceProvider?: string;
}
```

(d) Extend the `MapCommand` union:

```ts
  | { kind: 'clearHighlights' }
  | { kind: 'showGeometries'; items: ResultGeometry[]; fit?: boolean }
  | FeatureEditProposal;
```

(e) Add helpers above `isMapCommand`:

```ts
function isResultGeometry(value: unknown): value is ResultGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isGeoJsonGeometry(r.geometry) &&
    typeof r.role === 'string' &&
    (RESULT_ROLES as readonly string[]).includes(r.role) &&
    (r.label === undefined || typeof r.label === 'string') &&
    (r.layerKey === undefined || isLayerKey(r.layerKey)) &&
    (r.featureId === undefined || typeof r.featureId === 'string')
  );
}

function isValueRecord(value: unknown, allowed: string[]): value is Record<string, string | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([k, v]) => allowed.includes(k) && (v === null || typeof v === 'string')
  );
}

function isOptionalText(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}
```

(f) Add cases inside the `isMapCommand` switch before `default`:

```ts
    case 'showGeometries': {
      if (!Array.isArray(c.items) || c.items.length === 0 || c.items.length > MAX_RESULT_ITEMS) return false;
      if (!c.items.every(isResultGeometry)) return false;
      const vertices = (c.items as ResultGeometry[]).reduce((n, i) => n + countVertices(i.geometry), 0);
      return vertices <= MAX_RESULT_VERTICES && (c.fit === undefined || typeof c.fit === 'boolean');
    }
    case 'proposeFeatureEdit': {
      if (!isLayerKey(c.layerKey) || typeof c.featureId !== 'string') return false;
      const allowed = editableColumns(c.layerKey);
      return (
        isValueRecord(c.current, allowed) &&
        isValueRecord(c.proposed, allowed) &&
        Object.keys(c.proposed as object).length > 0 &&
        (c.name === undefined || typeof c.name === 'string') &&
        isOptionalText(c.sourceDocument, MAX_SOURCE_DOCUMENT_LENGTH) &&
        isOptionalText(c.sourceProvider, MAX_SOURCE_PROVIDER_LENGTH)
      );
    }
```

- [ ] **Step 8: Analysis result types**

`packages/shared/src/analysis.ts`:

```ts
/**
 * The analysis wire contract: POST /api/analysis/:op returns an AnalysisResult,
 * and the assistant's analysis tools summarise the same shape.
 */
import type { EditableLayerKey } from './index.js';
import type { ResultGeometry } from './map-commands.js';

export const ANALYSIS_OPS = ['buffer', 'select_within', 'nearest', 'elevation_profile', 'zonal_elevation'] as const;
export type AnalysisOp = (typeof ANALYSIS_OPS)[number];

export interface AnalysisRow {
  layerKey?: EditableLayerKey;
  featureId?: string;
  name: string | null;
  lon?: number;
  lat?: number;
  distanceKm?: number;
}

export interface ProfileSample {
  distanceM: number;
  elevationM: number | null;
}

export interface AnalysisResult {
  op: AnalysisOp;
  /** Vietnamese label → value, rendered as rows in the result card and the print page. */
  summary: Record<string, number | string>;
  geometries: ResultGeometry[];
  /** ≤ 25 listed rows. */
  rows?: AnalysisRow[];
  profile?: ProfileSample[];
  attribution?: string;
  /** More matches existed than were drawn. */
  truncated?: boolean;
}
```

In `packages/shared/src/index.ts` append:

```ts
export * from './geometry.js';
export * from './analysis.js';
```

- [ ] **Step 9: Run shared tests and build**

Run: `npm run test:shared` then `npm run build:shared`
Expected: all PASS; build writes `dist/geometry.js`, `dist/analysis.js`.

Note: `npm run build:web` will fail until Task 4 adds executor cases (the executor switch must be exhaustive). Do not run it here.

- [ ] **Step 10: Commit (force-add new dist files)**

```bash
git add packages/shared/src packages/shared/dist
git add -f packages/shared/dist/geometry.js packages/shared/dist/geometry.d.ts packages/shared/dist/analysis.js packages/shared/dist/analysis.d.ts
git status --ignored packages/shared/dist
git commit -m "feat(shared): lệnh showGeometries, proposeFeatureEdit và kiểu kết quả phân tích

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(If `git status --ignored` still lists a `dist/*.js` or `*.d.ts` under "Ignored files" that `index.js` re-exports, `git add -f` it before committing.)

---

### Task 4: Web — results layer and executor cases

**Files:**
- Modify: `apps/web/src/features/map/model/highlightLayer.ts`
- Modify: `apps/web/src/features/map/model/highlightLayer.test.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.test.ts`

**Interfaces:**
- Consumes: `ResultGeometry`, `FeatureEditProposal`, `MapCommand` from Task 3.
- Produces:
  - `RESULTS_LAYER_ID = 'layer_analysis_results'`
  - `showResults(map: Map, items: ResultGeometry[], fit: boolean): void`
  - `clearHighlights(map)` now clears both the point highlights and the results layer
  - `CommandDeps.onProposeEdit?: (proposal: FeatureEditProposal) => void`

- [ ] **Step 1: Write failing tests**

Append to `highlightLayer.test.ts` (update the `makeMap` helper to also provide a view with `fit`):

```ts
import { showResults, RESULTS_LAYER_ID } from './highlightLayer';

function makeMapWithView() {
  const added: Array<{ get: (k: string) => unknown; getSource: () => { getFeatures: () => unknown[] } }> = [];
  const fit = vi.fn();
  const map = {
    addLayer: vi.fn((l) => added.push(l)),
    getView: () => ({ fit }),
    getSize: () => [800, 600],
  } as unknown as Map;
  return { map, added, fit };
}

describe('showResults', () => {
  const line = { role: 'highlight' as const, label: 'Sông Ba', geometry: { type: 'LineString' as const, coordinates: [[108, 12], [108.2, 12.2]] } };
  const poly = { role: 'result' as const, geometry: { type: 'Polygon' as const, coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] } };

  it('draws lines and polygons into its own tagged layer', () => {
    const { map, added } = makeMapWithView();
    showResults(map, [line, poly], false);
    const layer = added.find((l) => l.get('id') === RESULTS_LAYER_ID)!;
    expect(layer.getSource().getFeatures()).toHaveLength(2);
  });

  it('fits the view to the drawn extent only when asked', () => {
    const { map, fit } = makeMapWithView();
    showResults(map, [line], false);
    expect(fit).not.toHaveBeenCalled();
    showResults(map, [line], true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('clearHighlights empties the results layer too', () => {
    const { map, added } = makeMapWithView();
    showResults(map, [line], false);
    clearHighlights(map);
    const layer = added.find((l) => l.get('id') === RESULTS_LAYER_ID)!;
    expect(layer.getSource().getFeatures()).toHaveLength(0);
  });
});
```

Append to `mapCommands.test.ts`:

```ts
  it('showGeometries draws results and reports the count', () => {
    const deps = makeDeps();
    (deps.map as unknown as { getSize: () => number[] }).getSize = () => [800, 600];
    const result = createCommandExecutor(deps)({
      kind: 'showGeometries',
      items: [{ role: 'highlight', geometry: { type: 'Point', coordinates: [108, 12] } }],
    });
    expect(result).toEqual({ ok: true, text: 'Đã hiển thị 1 hình trên bản đồ.' });
  });

  it('proposeFeatureEdit hands the proposal to the wizard callback', () => {
    const onProposeEdit = vi.fn();
    const deps = makeDeps({ onProposeEdit });
    const proposal = {
      kind: 'proposeFeatureEdit' as const, layerKey: 'dams' as const, featureId: 'f1',
      current: { wattage_mw: '70' }, proposed: { wattage_mw: '72' },
    };
    expect(createCommandExecutor(deps)(proposal)).toEqual({ ok: true, text: 'Đã mở biểu mẫu đề xuất cập nhật.' });
    expect(onProposeEdit).toHaveBeenCalledWith(proposal);
  });

  it('proposeFeatureEdit fails cleanly with no wizard mounted', () => {
    const result = createCommandExecutor(makeDeps())({
      kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', current: {}, proposed: { name: 'x' },
    });
    expect(result).toEqual({ ok: false, reason: 'Không mở được biểu mẫu cập nhật.' });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/web -- src/features/map/model/highlightLayer.test.ts src/features/map/model/mapCommands.test.ts`
Expected: FAIL — `showResults` not exported; executor returns undefined for new kinds.

- [ ] **Step 3: Implement the results layer**

Replace `apps/web/src/features/map/model/highlightLayer.ts` with:

```ts
import type { Map } from 'ol';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { HighlightPoint, ResultGeometry, ResultRole } from '@webatlas/shared';

/** Identifies the layer in the OL layer stack. Deliberately NOT a member of
 *  LAYER_STATE_IDS: this layer is transient assistant output, not a data layer
 *  the user can toggle, so it must never appear in the layers panel. */
export const HIGHLIGHT_LAYER_ID = 'layer_assistant_highlight';

/** Lines, polygons and analysis output (search, toolbar, assistant). Same rule as
 *  above: transient, never in the layers panel. */
export const RESULTS_LAYER_ID = 'layer_analysis_results';

const labelText = (text: string) =>
  new Text({
    text,
    offsetY: -18,
    font: '12px sans-serif',
    fill: new Fill({ color: '#78350f' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
    overflow: true,
  });

/** Kept local rather than added to styles.ts: nothing else highlights points,
 *  and the style only exists because this layer does. */
const highlightStyle = (feature: { get: (key: string) => unknown }) =>
  new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: 'rgba(217, 119, 6, 0.35)' }),
      stroke: new Stroke({ color: '#b45309', width: 2 }),
    }),
    text: labelText((feature.get('label') as string | undefined) ?? ''),
  });

const ROLE_STYLE: Record<ResultRole, { stroke: Stroke; fill: Fill }> = {
  highlight: { stroke: new Stroke({ color: '#d97706', width: 4 }), fill: new Fill({ color: 'rgba(217, 119, 6, 0.15)' }) },
  input: { stroke: new Stroke({ color: '#1f2937', width: 2, lineDash: [8, 6] }), fill: new Fill({ color: 'rgba(31, 41, 55, 0.05)' }) },
  result: { stroke: new Stroke({ color: '#1d4ed8', width: 2 }), fill: new Fill({ color: 'rgba(37, 99, 235, 0.25)' }) },
};

const resultStyle = (feature: { get: (key: string) => unknown }) => {
  const role = (feature.get('role') as ResultRole | undefined) ?? 'result';
  const { stroke, fill } = ROLE_STYLE[role];
  return new Style({
    stroke,
    fill,
    image: new Circle({ radius: 7, fill, stroke }),
    text: labelText((feature.get('label') as string | undefined) ?? ''),
  });
};

// Keyed by map so a remounted map gets its own layer and the old one is
// collected with it — a module-level singleton would leak across MapModel
// teardown/rebuild and re-add a layer to a disposed map.
const highlightLayers = new WeakMap<Map, VectorLayer<VectorSource>>();
const resultLayers = new WeakMap<Map, VectorLayer<VectorSource>>();

function ensureLayer(
  map: Map,
  registry: WeakMap<Map, VectorLayer<VectorSource>>,
  id: string,
  style: unknown,
  zIndex: number,
): VectorLayer<VectorSource> {
  const existing = registry.get(map);
  if (existing) return existing;
  const layer = new VectorLayer({ source: new VectorSource(), style: style as never, properties: { id }, zIndex });
  map.addLayer(layer);
  registry.set(map, layer);
  return layer;
}

/** Replaces whatever is currently highlighted with `points`. */
export function showHighlights(map: Map, points: HighlightPoint[]): void {
  // Above every data layer: a highlight that renders under the rivers it
  // points at is not a highlight.
  const source = ensureLayer(map, highlightLayers, HIGHLIGHT_LAYER_ID, highlightStyle, 999).getSource();
  if (!source) return;
  source.clear();
  source.addFeatures(
    points.map((p) => new Feature({ geometry: new Point(fromLonLat(p.lonLat)), label: p.label ?? '' }))
  );
}

const format = new GeoJSON();

/** Replaces the drawn results with `items`; with `fit`, frames them all. */
export function showResults(map: Map, items: ResultGeometry[], fit: boolean): void {
  const source = ensureLayer(map, resultLayers, RESULTS_LAYER_ID, resultStyle, 998).getSource();
  if (!source) return;
  source.clear();
  const extent = createEmpty();
  for (const item of items) {
    const geometry = format.readGeometry(item.geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    extend(extent, geometry.getExtent());
    source.addFeature(new Feature({ geometry, role: item.role, label: item.label ?? '' }));
  }
  if (fit && !isEmpty(extent)) {
    map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 14, duration: 400 });
  }
}

/** Empties both transient layers. Leaves the (empty) layers in place — removing
 *  and re-adding them on every clear would churn the layer stack for nothing. */
export function clearHighlights(map: Map): void {
  highlightLayers.get(map)?.getSource()?.clear();
  resultLayers.get(map)?.getSource()?.clear();
}
```

Note: a single Point's extent is zero-area but not `isEmpty`, so `fit` with `maxZoom: 14` frames it.

- [ ] **Step 4: Implement executor cases**

In `apps/web/src/features/map/model/mapCommands.ts`:

```ts
import {
  REGION_PROVINCE_NAMES,
  type BasemapName,
  type FeatureEditProposal,
  type MapCommand,
} from '@webatlas/shared';
import { showHighlights, showResults, clearHighlights } from './highlightLayer';
```

Add to `CommandDeps`:

```ts
  /**
   * Opens the admin update wizard. Optional: only the assistant slice wires it,
   * and the wizard itself is admin-gated — a proposal reaching a caller without
   * one fails cleanly instead of silently doing nothing.
   */
  onProposeEdit?: (proposal: FeatureEditProposal) => void;
```

Add cases after `clearHighlights`:

```ts
      case 'showGeometries': {
        if (!deps.map) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        showResults(deps.map, cmd.items, cmd.fit ?? false);
        return { ok: true, text: `Đã hiển thị ${cmd.items.length} hình trên bản đồ.` };
      }
      case 'proposeFeatureEdit': {
        if (!deps.onProposeEdit) return { ok: false, reason: 'Không mở được biểu mẫu cập nhật.' };
        deps.onProposeEdit(cmd);
        return { ok: true, text: 'Đã mở biểu mẫu đề xuất cập nhật.' };
      }
```

- [ ] **Step 5: Run tests and type-check**

Run: `npm run test -w @webatlas/web -- src/features/map/model` then `npm run build:web`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/highlightLayer.ts apps/web/src/features/map/model/highlightLayer.test.ts apps/web/src/features/map/model/mapCommands.ts apps/web/src/features/map/model/mapCommands.test.ts
git commit -m "feat(web): lớp kết quả vẽ đường, vùng và lệnh mở biểu mẫu đề xuất

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: API — `resolveFeature`, simplified geometry SQL, geometry endpoint

**Files:**
- Create: `apps/api/src/lib/resultGeometry.ts`
- Modify: `apps/api/src/modules/assistant/tools/data/helpers.ts` (add `Queryable`, `ResolvedFeature`, `resolveFeature`; delete the unused `FeatureRow` interface)
- Create: `apps/api/src/modules/geometry/routes.ts`, `apps/api/src/modules/geometry/controller.ts`
- Create: `apps/api/src/modules/geometry/geometry.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `GeoJsonGeometry`, `LAYER_ATTRIBUTE_MAP` from `@webatlas/shared`.
- Produces:
  - `simplifiedGeoJsonSql(expr: string): string` — SQL expression yielding simplified GeoJSON (`::json`, 6 decimals)
  - `type Queryable = Pick<Pool, 'query'>`
  - `interface ResolvedFeature { featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; properties: Record<string, string | null> }`
  - `resolveFeature(db: Queryable, layerKey: EditableLayerKey, featureId: string, opts?: { simplify?: boolean }): Promise<ResolvedFeature | null>` — active version only, `NOT deleted`, `null` for malformed ids; `simplify` defaults to `true`
  - `GET /api/features/:layerKey/:id/geometry` → `200 { layerKey, featureId, name, geometry }` | `404 NOT_FOUND` | `400` (public, no auth)

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/geometry/geometry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { resolveFeature } from '../assistant/tools/data/helpers';

let app: ReturnType<typeof buildApp>;
let riverId: string;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id::text FROM water.rivers_active WHERE name IS NOT NULL ORDER BY length_m DESC NULLS LAST LIMIT 1`
  );
  riverId = rows[0].id;
});
afterAll(async () => {
  await app.close();
});

describe('resolveFeature', () => {
  it('returns the active row with geometry, a representative point and text properties', async () => {
    const f = await resolveFeature(getPool(), 'rivers', riverId);
    expect(f).not.toBeNull();
    expect(f!.featureId).toBe(riverId);
    expect(['LineString', 'MultiLineString']).toContain(f!.geometry.type);
    expect(f!.lon).toBeGreaterThan(100);
    expect(Object.keys(f!.properties)).toContain('stream_order');
  });

  it('simplifies by default and keeps full precision on request', async () => {
    const simple = await resolveFeature(getPool(), 'rivers', riverId);
    const full = await resolveFeature(getPool(), 'rivers', riverId, { simplify: false });
    const n = (g: { coordinates: unknown }) => JSON.stringify(g.coordinates).split('],[').length;
    expect(n(simple!.geometry)).toBeLessThanOrEqual(n(full!.geometry));
  });

  it('returns null for a malformed or unknown id instead of throwing', async () => {
    expect(await resolveFeature(getPool(), 'rivers', 'not-a-uuid')).toBeNull();
    expect(await resolveFeature(getPool(), 'rivers', '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('GET /api/features/:layerKey/:id/geometry', () => {
  it('returns simplified geometry without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/features/rivers/${riverId}/geometry` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.featureId).toBe(riverId);
    expect(body.layerKey).toBe('rivers');
    expect(['LineString', 'MultiLineString']).toContain(body.geometry.type);
  });

  it('404s an unknown feature and 400s an unknown layer', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/features/rivers/00000000-0000-0000-0000-000000000000/geometry' });
    expect(missing.statusCode).toBe(404);
    const badLayer = await app.inject({ method: 'GET', url: `/api/features/users/${riverId}/geometry` });
    expect(badLayer.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/geometry/geometry.test.ts`
Expected: FAIL — `resolveFeature` is not exported.

- [ ] **Step 3: Simplification SQL**

`apps/api/src/lib/resultGeometry.ts`:

```ts
/**
 * SQL expression turning a geometry column/expression into simplified GeoJSON for
 * drawing. Tolerance scales with the shape's own extent (≈ 1/2000 of its larger side),
 * so a 200 km river loses sub-pixel detail while a 50 m pond keeps its outline.
 * Points have zero extent → tolerance 0 → unchanged.
 *
 * `expr` must be a trusted column name or SQL expression, never tool input.
 */
export function simplifiedGeoJsonSql(expr: string): string {
  const tolerance = `GREATEST(ST_XMax(${expr}) - ST_XMin(${expr}), ST_YMax(${expr}) - ST_YMin(${expr})) / 2000.0`;
  return `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${expr}, ${tolerance}), 6)::json`;
}
```

- [ ] **Step 4: `resolveFeature`**

In `apps/api/src/modules/assistant/tools/data/helpers.ts`, change the imports to:

```ts
import type { Pool } from 'pg';
import {
  EDITABLE_LAYER_KEYS,
  LAYER_ATTRIBUTE_MAP,
  type EditableLayerKey,
  type GeoJsonGeometry,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../../lib/resultGeometry';
```

Delete the unused `export interface FeatureRow { ... }` block (handover §5.3: imported by nothing).

Append at the end of the file:

```ts
/** A pool or a checked-out client — anything with pg's `query`. */
export type Queryable = Pick<Pool, 'query'>;

export interface ResolvedFeature {
  featureId: string;
  name: string | null;
  lon: number;
  lat: number;
  geometry: GeoJsonGeometry;
  /** Every LAYER_ATTRIBUTE_MAP column, as text (null stays null). */
  properties: Record<string, string | null>;
}

/**
 * One feature of the ACTIVE version, by id — the shared form of the
 * candidate/re-apply dance that area_of, distance_between and related_features
 * each hand-wrote (handover §5.3 #1).
 *
 * The candidate predicate `id = $1` is a primary-key hit on the base table; it is
 * re-applied after resolution together with `NOT deleted`, because resolution
 * returns the active row for that external_id — if the id belonged to a
 * superseded version, the active row's id differs and the filter yields nothing.
 */
export async function resolveFeature(
  db: Queryable,
  layerKey: EditableLayerKey,
  featureId: string,
  opts: { simplify?: boolean } = {}
): Promise<ResolvedFeature | null> {
  if (!isFeatureId(featureId)) return null;
  const table = layerTable(layerKey); // allowlist check before any interpolation
  // Column names come from the shared constant map, never from tool input.
  const props = Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes)
    .map((c) => `'${c}', resolved.${c}::text`)
    .join(', ');
  const geometrySql = opts.simplify === false ? 'ST_AsGeoJSON(geom, 7)::json' : simplifiedGeoJsonSql('geom');
  const ctes = candidateCtes(layerKey, `SELECT external_id FROM ${table} WHERE id = $1`);
  const { rows } = await db.query<ResolvedFeature>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            ${geometrySql} AS geometry,
            jsonb_build_object(${props}) AS properties
       FROM resolved
      WHERE id = $1 AND NOT deleted AND geom IS NOT NULL`,
    [featureId]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 5: Route**

`apps/api/src/modules/geometry/controller.ts`:

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';
import { resolveFeature } from '../assistant/tools/data/helpers';

const Params = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  id: z.string().uuid('Mã đối tượng không hợp lệ'),
});

/**
 * GET /api/features/:layerKey/:id/geometry — simplified shape for highlighting a
 * search hit. Public like /api/search: the same data is already public over WFS.
 */
export async function featureGeometry(req: FastifyRequest, reply: FastifyReply) {
  const { layerKey, id } = validate(Params, req.params);
  const feature = await resolveFeature(req.server.pg, layerKey, id);
  if (!feature) throw new NotFoundError('Không tìm thấy đối tượng');
  reply.send({ layerKey, featureId: feature.featureId, name: feature.name, geometry: feature.geometry });
}
```

`apps/api/src/modules/geometry/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { featureGeometry } from './controller';

export default async function geometryRoutes(app: FastifyInstance) {
  app.get('/features/:layerKey/:id/geometry', featureGeometry);
}
```

`apps/api/src/server.ts`: add `import geometryRoutes from './modules/geometry/routes';` and `app.register(geometryRoutes, { prefix: '/api' });` after the search registration.

- [ ] **Step 6: Run tests to verify pass**

Run: `npm run test -w @webatlas/api -- src/modules/geometry src/modules/assistant/tools/data/helpers.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/resultGeometry.ts apps/api/src/modules/assistant/tools/data/helpers.ts apps/api/src/modules/geometry apps/api/src/server.ts
git commit -m "feat(api): resolveFeature dùng chung và tuyến lấy hình đối tượng đã giản lược

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Web — search highlights the whole feature

**Files:**
- Modify: `apps/web/src/features/search/api/search.api.ts`
- Modify: `apps/web/src/features/search/index.tsx`
- Modify: `apps/web/src/features/search/index.test.tsx`

**Interfaces:**
- Consumes: `GET /api/features/:layerKey/:id/geometry` (Task 5), `showGeometries` executor case (Task 4).
- Produces: `fetchFeatureGeometry(layerKey: EditableLayerKey, featureId: string): Promise<{ name: string | null; geometry: GeoJsonGeometry }>`

- [ ] **Step 1: Read the existing test**

Run: `cat apps/web/src/features/search/index.test.tsx` — note how it mocks `useSearch` / `useMapContext`, which hit fixture it uses, and how it selects a result. The new tests reuse those exact helpers.

- [ ] **Step 2: Write failing tests**

Add next to the existing `vi.mock` calls in `apps/web/src/features/search/index.test.tsx`:

```ts
const fetchFeatureGeometry = vi.fn();
vi.mock('./api/search.api', async (orig) => ({
  ...(await orig<typeof import('./api/search.api')>()),
  fetchFeatureGeometry: (...args: unknown[]) => fetchFeatureGeometry(...args),
}));
const showResults = vi.fn();
vi.mock('../map/model/highlightLayer', async (orig) => ({
  ...(await orig<typeof import('../map/model/highlightLayer')>()),
  showResults: (...args: unknown[]) => showResults(...args),
}));
```

Add `beforeEach(() => { fetchFeatureGeometry.mockReset(); showResults.mockReset(); });` and two tests. In each, perform the selection with the same statement the file's existing selection test uses (for example `fireEvent.click(screen.getByText(HIT.name))`):

```ts
  it('draws and frames the whole geometry of the selected hit', async () => {
    fetchFeatureGeometry.mockResolvedValue({
      name: 'Sông Ba',
      geometry: { type: 'LineString', coordinates: [[108, 13], [108.5, 13.4]] },
    });
    renderAndSelectFirstHit();
    await vi.waitFor(() => expect(showResults).toHaveBeenCalledTimes(1));
    const [, items, fit] = showResults.mock.calls[0];
    expect(items[0]).toMatchObject({ role: 'highlight', label: 'Sông Ba' });
    expect(fit).toBe(true);
  });

  it('falls back to zooming to the point when the geometry request fails', async () => {
    fetchFeatureGeometry.mockRejectedValue(new Error('offline'));
    renderAndSelectFirstHit();
    await vi.waitFor(() => expect(animate).toHaveBeenCalled());
    expect(showResults).not.toHaveBeenCalled();
  });
```

Define `renderAndSelectFirstHit()` at the top of the describe block by extracting the render + click lines from the existing selection test; `animate` is the view's `animate` mock the file already creates (rename to match if it is named differently).

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -w @webatlas/web -- src/features/search/index.test.tsx`
Expected: FAIL — `showResults` never called.

- [ ] **Step 4: API client**

In `apps/web/src/features/search/api/search.api.ts`, change the type import to `import type { EditableLayerKey, GeoJsonGeometry } from '@webatlas/shared';` and append:

```ts
export async function fetchFeatureGeometry(
  layerKey: EditableLayerKey,
  featureId: string
): Promise<{ name: string | null; geometry: GeoJsonGeometry }> {
  return apiRequest(`/api/features/${layerKey}/${encodeURIComponent(featureId)}/geometry`);
}
```

- [ ] **Step 5: Container**

In `apps/web/src/features/search/index.tsx` replace `import type { SearchHit } from './api/search.api';` with `import { fetchFeatureGeometry, type SearchHit } from './api/search.api';` and replace `onSelect`:

```tsx
  const onSelect = (hit: SearchHit) => {
    // clear(), not setQuery(''): it resets query + results in the same batch,
    // so the dropdown never flashes stale results before useSearch's effect
    // catches up to the emptied query.
    clear();
    // Draw the whole shape — a river lit along its length, a lake as its outline —
    // and frame it. If the geometry request fails, the point zoom still works.
    fetchFeatureGeometry(hit.layerKey, hit.featureId)
      .then(({ name, geometry }) =>
        run({
          kind: 'showGeometries',
          fit: true,
          items: [{ geometry, role: 'highlight', label: name ?? hit.name, layerKey: hit.layerKey, featureId: hit.featureId }],
        })
      )
      .catch(() =>
        run({ kind: 'zoomToFeature', layerKey: hit.layerKey, featureId: hit.featureId, lonLat: hit.lonLat })
      );
  };
```

- [ ] **Step 6: Run tests and type-check**

Run: `npm run test -w @webatlas/web -- src/features/search` then `npm run build:web`
Expected: PASS. If the pre-existing "selecting a result animates the view" test fails (the zoom is now only a fallback), change its assertion to `expect(fetchFeatureGeometry).toHaveBeenCalledWith(HIT.layerKey, HIT.featureId)`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/search
git commit -m "feat(web): chọn kết quả tìm kiếm tô sáng cả đường và vùng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Assistant — role in context, role-specific prompt, `highlight_features` by feature reference

**Files:**
- Modify: `apps/api/src/modules/assistant/tools/types.ts`
- Modify: `apps/api/src/modules/assistant/prompt.ts`, `prompt.test.ts`
- Modify: `apps/api/src/modules/assistant/service.ts`, `controller.ts`
- Modify: `apps/api/src/modules/assistant/tools/command/highlightFeatures.ts`, `command.test.ts`
- Modify: every test that builds a `ToolContext` — list them with `grep -rln "ToolContext" apps/api/src --include=*.test.ts` (expected: `registry.test.ts`, `command.test.ts`, `data.test.ts`, `data2.test.ts`, `elevation.test.ts`, `locatePlace.test.ts`)

**Interfaces:**
- Consumes: `resolveFeature` (Task 5), `capResultItems` (Task 3).
- Produces:
  - `ToolContext.role: Role` (`'admin' | 'editor' | 'viewer'`, type from `modules/users/repository`)
  - `AssistantDeps.role: Role`
  - `SYSTEM_PROMPT` (read-only variant), `ADMIN_SYSTEM_PROMPT`, `systemPromptFor(role: Role): string`
  - `highlight_features` input `{ points?: {lon, lat, label?}[] (1..50), featureRefs?: {layerKey, featureId}[] (1..50) }`, at least one present; `featureRefs` collect `showGeometries` with `fit: true`

- [ ] **Step 1: Write failing prompt tests**

Append to `apps/api/src/modules/assistant/prompt.test.ts` and extend its import to `import { SYSTEM_PROMPT, ADMIN_SYSTEM_PROMPT, systemPromptFor, formatMapContext } from './prompt';`:

```ts
describe('role-specific prompts', () => {
  it('read-only prompt gives non-admins the exact refusal sentence', () => {
    expect(SYSTEM_PROMPT).toContain('Bạn chỉ có quyền xem dữ liệu; chỉ quản trị viên mới cập nhật được.');
    expect(SYSTEM_PROMPT).not.toContain('propose_feature_update');
  });

  it('admin prompt routes update requests to propose_feature_update', () => {
    expect(ADMIN_SYSTEM_PROMPT).toContain('propose_feature_update');
    expect(ADMIN_SYSTEM_PROMPT).toContain('tài liệu nguồn');
  });

  it('picks the admin prompt only for admin', () => {
    expect(systemPromptFor('admin')).toBe(ADMIN_SYSTEM_PROMPT);
    expect(systemPromptFor('editor')).toBe(SYSTEM_PROMPT);
    expect(systemPromptFor('viewer')).toBe(SYSTEM_PROMPT);
  });

  it('shares every rule before rule 8, so the variants cannot drift', () => {
    const before8 = (p: string) => p.slice(0, p.indexOf('\n\n8. '));
    expect(before8(SYSTEM_PROMPT).length).toBeGreaterThan(100);
    expect(before8(ADMIN_SYSTEM_PROMPT)).toBe(before8(SYSTEM_PROMPT));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/assistant/prompt.test.ts`
Expected: FAIL — `ADMIN_SYSTEM_PROMPT` is not exported.

- [ ] **Step 3: Implement prompts**

In `apps/api/src/modules/assistant/prompt.ts`:
1. Add `import type { Role } from '../users/repository';`.
2. Rename `export const SYSTEM_PROMPT = \`` to `const BASE_RULES = \`` and cut the template so it ends right after rule 7's last sentence (`…hãy dùng công cụ đánh dấu để người dùng nhìn thấy chúng.`) — delete rule 8 and the blank line before it from this template. Keep the existing doc comment on `BASE_RULES`.
3. Add below it:

```ts
const READ_ONLY_RULE = `8. Bạn chỉ đọc dữ liệu. Nếu người dùng yêu cầu thêm, sửa hay xoá dữ liệu, hãy trả lời đúng câu: "Bạn chỉ có quyền xem dữ liệu; chỉ quản trị viên mới cập nhật được." và không gọi công cụ nào cho yêu cầu đó.`;

const ADMIN_UPDATE_RULE = `8. Bạn không tự ghi dữ liệu. Khi quản trị viên yêu cầu cập nhật thuộc tính của một đối tượng: trước hết tìm đúng đối tượng bằng công cụ dữ liệu (ví dụ filter_by_attribute theo tên) để lấy featureId, rồi gọi propose_feature_update. Công cụ này chỉ mở biểu mẫu để quản trị viên kiểm tra và bấm Lưu. Nếu người dùng chưa nêu tài liệu nguồn hoặc người cung cấp, hãy hỏi lại hai thông tin đó. Không đề xuất thêm mới hay xoá đối tượng — hãy chỉ họ tới bảng Biên tập.`;

/**
 * Two stable variants rather than one prompt with the role interpolated: each must
 * be byte-identical across requests to stay inside the cached prefix. Admin and
 * non-admin simply warm two caches.
 */
export const SYSTEM_PROMPT = `${BASE_RULES}\n\n${READ_ONLY_RULE}`;
export const ADMIN_SYSTEM_PROMPT = `${BASE_RULES}\n\n${ADMIN_UPDATE_RULE}`;

export function systemPromptFor(role: Role): string {
  return role === 'admin' ? ADMIN_SYSTEM_PROMPT : SYSTEM_PROMPT;
}
```

- [ ] **Step 4: Run prompt tests to verify pass**

Run: `npm run test -w @webatlas/api -- src/modules/assistant/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the role through**

`apps/api/src/modules/assistant/tools/types.ts` — add `import type { Role } from '../../users/repository';` and to `ToolContext`:

```ts
  /** The caller's role. Decides which tools are offered (propose_feature_update is
   *  admin-only). A UX layer only — the PUT route is still the boundary. */
  role: Role;
```

`apps/api/src/modules/assistant/service.ts`:
- `import type { Role } from '../users/repository';`
- replace `import { SYSTEM_PROMPT, formatMapContext } from './prompt';` with `import { systemPromptFor, formatMapContext } from './prompt';`
- add `role: Role;` to `AssistantDeps`
- in `buildTools({...})` add `role: deps.role,`
- replace `text: SYSTEM_PROMPT` with `text: systemPromptFor(deps.role)`

`apps/api/src/modules/assistant/controller.ts` — in the `runAssistant({...})` call add `role: req.currentUser.role,`.

In every test file from the grep above, add `role: 'viewer',` to each `ToolContext` object literal. If `service.test.ts` or `assistant.route.test.ts` calls `runAssistant(...)` directly, add `role: 'viewer'` there.

- [ ] **Step 6: Write failing highlight tests**

At the top of `apps/api/src/modules/assistant/tools/command/command.test.ts` (this file uses a fake pool) add:

```ts
const KNOWN_ID = '6f1c2a54-2b0e-4d8c-9d61-1f4f1f0c2a11';
vi.mock('../data/helpers', async (orig) => ({
  ...(await orig<typeof import('../data/helpers')>()),
  resolveFeature: vi.fn(async (_db: unknown, _layerKey: string, featureId: string) =>
    featureId === KNOWN_ID
      ? {
          featureId, name: 'Sông Ba', lon: 108.3, lat: 13.2, properties: {},
          geometry: { type: 'LineString', coordinates: [[108, 13], [108.5, 13.4]] },
        }
      : null),
}));
```

Append inside `describe('command tools', ...)`:

```ts
  it('highlightFeatures resolves feature references into drawn, framed geometry', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      featureRefs: [{ layerKey: 'rivers', featureId: KNOWN_ID }],
    });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ kind: 'showGeometries', fit: true });
    expect(collected.every(isMapCommand)).toBe(true);
    expect(text).toContain('Đã tô sáng 1 đối tượng');
  });

  it('highlightFeatures reports references it could not find without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      featureRefs: [{ layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000' }],
    });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có dữ liệu');
  });
```

- [ ] **Step 7: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/assistant/tools/command/command.test.ts`
Expected: FAIL — the tool ignores `featureRefs` (nothing collected).

- [ ] **Step 8: Implement**

Replace `apps/api/src/modules/assistant/tools/command/highlightFeatures.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  EDITABLE_LAYER_KEYS,
  MAX_HIGHLIGHT_POINTS,
  capResultItems,
  isMapCommand,
  type HighlightPoint,
  type ResultGeometry,
} from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../../../../lib/geo';
import { resolveFeature } from '../data/helpers';

export const highlightFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'highlight_features',
    description:
      'Mark features on the map so the user can see which ones an answer refers to. Prefer featureRefs (layerKey + featureId from a data tool): rivers, lakes and zones are then drawn as their whole shape and the map frames them. Use points only for bare coordinates returned by a data tool.',
    inputSchema: z
      .object({
        points: z
          .array(
            z.object({
              lon: z.number(),
              lat: z.number(),
              label: z.string().optional().describe('Short Vietnamese label, e.g. the feature name'),
            })
          )
          .min(1)
          .max(MAX_HIGHLIGHT_POINTS)
          .optional(),
        featureRefs: z
          .array(z.object({ layerKey: z.enum(EDITABLE_LAYER_KEYS), featureId: z.string() }))
          .min(1)
          .max(MAX_HIGHLIGHT_POINTS)
          .optional(),
      })
      .refine((v) => v.points !== undefined || v.featureRefs !== undefined, {
        message: 'Cần points hoặc featureRefs',
      }),
    run: async (input) => {
      const parts: string[] = [];

      if (input.featureRefs) {
        const refs = input.featureRefs;
        const resolved = await Promise.all(refs.map((r) => resolveFeature(ctx.pool, r.layerKey, r.featureId)));
        const items: ResultGeometry[] = [];
        resolved.forEach((f, i) => {
          if (!f) return;
          items.push({
            geometry: f.geometry,
            role: 'highlight',
            ...(f.name ? { label: f.name } : {}),
            layerKey: refs[i].layerKey,
            featureId: f.featureId,
          });
        });
        const capped = capResultItems(items);
        const command = { kind: 'showGeometries' as const, items: capped.items, fit: true };
        if (capped.items.length > 0 && isMapCommand(command)) {
          ctx.collect(command);
          parts.push(`Đã tô sáng ${capped.items.length} đối tượng trên bản đồ.`);
        }
        const missing = resolved.filter((f) => f === null).length;
        if (missing > 0) parts.push(`Không có dữ liệu: không tìm thấy ${missing} đối tượng.`);
      }

      if (input.points) {
        const points: HighlightPoint[] = input.points
          .filter((p) => inVietnam(p.lon, p.lat))
          .map((p) => ({ lonLat: [p.lon, p.lat] as [number, number], ...(p.label ? { label: p.label } : {}) }));
        const command = { kind: 'highlightFeatures' as const, points };
        if (points.length > 0 && isMapCommand(command)) {
          ctx.collect(command);
          parts.push(`Đã đánh dấu ${points.length} vị trí trên bản đồ.`);
        } else {
          parts.push('Không có toạ độ hợp lệ để đánh dấu — chỉ dùng toạ độ do công cụ dữ liệu trả về.');
        }
      }

      return parts.join(' ');
    },
  });
```

- [ ] **Step 9: Run the assistant suite**

Run: `npm run test -w @webatlas/api -- src/modules/assistant`
Expected: PASS. (Pre-existing `highlightFeatures` point tests must still pass unchanged; if one asserts the exact old empty-points message, it still matches.)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/assistant
git commit -m "feat(assistant): vai trò trong ngữ cảnh, lời nhắc theo vai trò, tô sáng theo đối tượng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Assistant — `propose_feature_update` (admin only)

**Files:**
- Create: `apps/api/src/modules/assistant/tools/command/proposeFeatureUpdate.ts`
- Create: `apps/api/src/modules/assistant/tools/command/proposeFeatureUpdate.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`, `registry.test.ts`

**Interfaces:**
- Consumes: `resolveFeature`, `activeVersionLabel`, `isFeatureId`, `LAYER_LABELS` (helpers); `editableColumns`, `isMapCommand`, `MAX_SOURCE_*` (shared); `ToolContext.role` (Task 7).
- Produces: tool `propose_feature_update` with input `{ layerKey, featureId, changes: Record<string, string | null>, sourceDocument?: string (≤500), sourceProvider?: string (≤200) }`. On success collects, in order, `showGeometries` (highlight, fit) then `proposeFeatureEdit`. Registered only when `ctx.role === 'admin'`, after `run_sql`.

- [ ] **Step 1: Write the failing tool tests (live DB)**

`apps/api/src/modules/assistant/tools/command/proposeFeatureUpdate.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { isMapCommand, type MapCommand, type Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { proposeFeatureUpdateTool } from './proposeFeatureUpdate';

let pool: Pool;
let damId: string;
let damName: string;

beforeAll(async () => {
  pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id::text, name FROM water.dams_active WHERE wattage_mw IS NOT NULL AND name IS NOT NULL LIMIT 1`
  );
  damId = rows[0].id;
  damName = rows[0].name;
});
afterAll(async () => { await closePool(); });

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool,
    role: 'admin',
    mapContext: { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' },
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}

const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('propose_feature_update', () => {
  it('collects a highlight then a valid proposal carrying current and proposed values', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), {
      layerKey: 'dams', featureId: damId,
      changes: { wattage_mw: '9999' },
      sourceDocument: 'Quyết định 123/QĐ-UBND', sourceProvider: 'Sở Công Thương',
    });
    expect(commands.map((c) => c.kind)).toEqual(['showGeometries', 'proposeFeatureEdit']);
    expect(commands.every(isMapCommand)).toBe(true);
    const proposal = commands[1] as Extract<MapCommand, { kind: 'proposeFeatureEdit' }>;
    expect(proposal.name).toBe(damName);
    expect(proposal.proposed).toEqual({ wattage_mw: '9999' });
    expect(proposal.current).toHaveProperty('wattage_mw');
    expect(proposal.current).not.toHaveProperty('external_id');
    expect(proposal.sourceDocument).toBe('Quyết định 123/QĐ-UBND');
    expect(records[0]).toMatchObject({ tool: 'propose_feature_update', layerKey: 'dams', rowCount: 1 });
    expect(text).toContain('Lưu');
    expect(text).not.toContain('Còn thiếu');
  });

  it('asks for missing source information', async () => {
    const { ctx } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { wattage_mw: '9999' } });
    expect(text).toContain('Còn thiếu');
    expect(text).toContain('tài liệu nguồn');
    expect(text).toContain('người cung cấp');
  });

  it('rejects unknown columns and names the valid ones, collecting nothing', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { capacity: '72' } });
    expect(commands).toEqual([]);
    expect(text).toContain('capacity');
    expect(text).toContain('wattage_mw');
  });

  it('reports no data for an unknown feature and still emits provenance', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), {
      layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000', changes: { name: 'x' },
    });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(commands).toEqual([]);
    expect(records[0]).toMatchObject({ rowCount: 0 });
  });

  it('says there is nothing to change when proposed values equal current ones', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { name: damName } });
    expect(commands).toEqual([]);
    expect(text).toContain('trùng');
  });
});
```

Append to `apps/api/src/modules/assistant/tools/registry.test.ts`:

```ts
describe('propose_feature_update is admin-only', () => {
  it('is offered to admin, last', () => {
    const names = buildTools({ ...ctx, role: 'admin' }).map((t) => (t as { name: string }).name);
    expect(names[names.length - 1]).toBe('propose_feature_update');
  });

  it('is never offered to editor or viewer', () => {
    for (const role of ['editor', 'viewer'] as const) {
      const names = buildTools({ ...ctx, role }).map((t) => (t as { name: string }).name);
      expect(names).not.toContain('propose_feature_update');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/assistant/tools/command/proposeFeatureUpdate.test.ts src/modules/assistant/tools/registry.test.ts`
Expected: FAIL — module `./proposeFeatureUpdate` not found.

- [ ] **Step 3: Implement the tool**

`apps/api/src/modules/assistant/tools/command/proposeFeatureUpdate.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  EDITABLE_LAYER_KEYS,
  MAX_SOURCE_DOCUMENT_LENGTH,
  MAX_SOURCE_PROVIDER_LENGTH,
  editableColumns,
  isMapCommand,
  type FeatureEditProposal,
} from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, activeVersionLabel, isFeatureId, resolveFeature } from '../data/helpers';

/**
 * Turns "cập nhật công suất Sông Hinh thành 72 MW" into a PROPOSAL, never a write.
 * The browser opens the admin wizard prefilled with it; the admin confirms and the
 * save goes through PUT /api/layers/:key/features/:id, which enforces admin-only.
 * Registered only for admins (registry.ts).
 */
export const proposeFeatureUpdateTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'propose_feature_update',
    description:
      'Open an update form, prefilled with proposed attribute values, for the administrator to review and save. Does NOT write anything. featureId must come from a data tool. changes maps DB column names (e.g. wattage_mw, status, name) to new values as text. Pass sourceDocument (decision/report name or number) and sourceProvider (who supplied the figures) when the user mentions them.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      changes: z.record(z.string(), z.string().nullable()),
      sourceDocument: z.string().max(MAX_SOURCE_DOCUMENT_LENGTH).optional(),
      sourceProvider: z.string().max(MAX_SOURCE_PROVIDER_LENGTH).optional(),
    }),
    run: async (input) => {
      const allowed = editableColumns(input.layerKey);
      const unknown = Object.keys(input.changes).filter((c) => !allowed.includes(c));
      if (unknown.length > 0) {
        return `Không cập nhật được cột ${unknown.join(', ')} của lớp ${LAYER_LABELS[input.layerKey]}. Các cột hợp lệ: ${allowed.join(', ')}.`;
      }
      if (Object.keys(input.changes).length === 0) return 'Chưa có giá trị nào cần cập nhật.';

      const [feature, datasetVersion] = await Promise.all([
        isFeatureId(input.featureId) ? resolveFeature(ctx.pool, input.layerKey, input.featureId) : Promise.resolve(null),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);
      ctx.provenance({
        tool: 'propose_feature_update',
        layerKey: input.layerKey,
        rowCount: feature ? 1 : 0,
        datasetVersion,
      });
      if (!feature) return 'Không có dữ liệu: không tìm thấy đối tượng cần cập nhật.';

      const current: Record<string, string | null> = {};
      for (const c of allowed) current[c] = feature.properties[c] ?? null;
      const proposed: Record<string, string | null> = {};
      for (const [c, v] of Object.entries(input.changes)) {
        if ((current[c] ?? null) !== v) proposed[c] = v;
      }
      if (Object.keys(proposed).length === 0) {
        return 'Giá trị đề xuất trùng với dữ liệu hiện tại — không có gì để cập nhật.';
      }

      const sourceDocument = input.sourceDocument?.trim() || undefined;
      const sourceProvider = input.sourceProvider?.trim() || undefined;
      const proposal: FeatureEditProposal = {
        kind: 'proposeFeatureEdit',
        layerKey: input.layerKey,
        featureId: feature.featureId,
        ...(feature.name ? { name: feature.name } : {}),
        current,
        proposed,
        ...(sourceDocument ? { sourceDocument } : {}),
        ...(sourceProvider ? { sourceProvider } : {}),
      };
      if (!isMapCommand(proposal)) return 'Không tạo được đề xuất cập nhật hợp lệ.';

      const highlight = {
        kind: 'showGeometries' as const,
        fit: true,
        items: [{
          geometry: feature.geometry,
          role: 'highlight' as const,
          ...(feature.name ? { label: feature.name } : {}),
          layerKey: input.layerKey,
          featureId: feature.featureId,
        }],
      };
      if (isMapCommand(highlight)) ctx.collect(highlight);
      ctx.collect(proposal);

      const missing = [
        sourceDocument ? null : 'tài liệu nguồn',
        sourceProvider ? null : 'người cung cấp',
      ].filter(Boolean);
      const label = feature.name ?? 'đối tượng';
      return (
        `Đã mở biểu mẫu đề xuất cập nhật cho "${label}" (${Object.keys(proposed).length} trường). ` +
        'Chưa có gì được ghi: quản trị viên cần kiểm tra và bấm Lưu.' +
        (missing.length > 0 ? ` Còn thiếu: ${missing.join(' và ')} — hãy hỏi người dùng.` : '')
      );
    },
  });
```

- [ ] **Step 4: Register for admin only**

In `apps/api/src/modules/assistant/tools/registry.ts` add `import { proposeFeatureUpdateTool } from './command/proposeFeatureUpdate';` and replace the body of `buildTools`:

```ts
export function buildTools(ctx: ToolContext) {
  // The escape hatch is only offered when a read-only role is configured.
  // Advertising a tool that always answers "not configured" wastes cached
  // prefix tokens on every turn and teaches the model to try it anyway.
  const factories = config.ASSISTANT_DATABASE_URL ? [...FACTORIES, runSqlTool] : [...FACTORIES];
  // Admin-only and LAST, so admin and non-admin each keep one stable cached
  // prefix. Offering it to others would only teach the model to promise edits
  // the API will refuse.
  if (ctx.role === 'admin') factories.push(proposeFeatureUpdateTool);
  return factories.map((factory) => guardToolErrors(factory(ctx) as never));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test -w @webatlas/api -- src/modules/assistant`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/assistant/tools
git commit -m "feat(assistant): công cụ propose_feature_update chỉ dành cho admin

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Web — proposal store and the "Đề xuất cập nhật" wizard

**Files:**
- Create: `apps/web/src/entities/proposal/proposal.store.ts`, `proposal.store.test.ts`
- Create: `apps/web/src/features/feature-editing/model/useProposedEditPresenter.ts`, `useProposedEditPresenter.test.ts`
- Create: `apps/web/src/features/feature-editing/ui/ProposedEditWizard.view.tsx`, `ProposedEditWizard.view.test.tsx`
- Create: `apps/web/src/features/feature-editing/ProposedEdit.tsx`
- Modify: `apps/web/src/features/feature-editing/api/features.api.ts` (`UpdateFeaturePayload.source`)
- Modify: `apps/web/src/features/assistant/model/useAssistant.ts` (`notify`), `apps/web/src/features/assistant/index.tsx`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `FeatureEditProposal`, `editableColumns`, `LAYER_ATTRIBUTE_MAP` (shared); `CommandDeps.onProposeEdit` (Task 4); `PUT` with `source` (Task 2).
- Produces:
  - `openProposal(p: FeatureEditProposal)`, `closeProposal()`, `getProposal()`, `useProposal(): FeatureEditProposal | null`, `notifyProposalSaved(text: string)`, `onProposalSaved(cb: (text: string) => void): () => void`
  - `useProposedEditPresenter(proposal, { onSaved: (changedCount: number) => void })` → `{ columns, labels, values, setField, isChanged(col), previous(col), sourceDocument, setSourceDocument, sourceProvider, setSourceProvider, canSave, saving, error, submit }`
  - `useAssistant(...)` additionally returns `notify(text: string): void`

- [ ] **Step 1: Store test**

`apps/web/src/entities/proposal/proposal.store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { openProposal, closeProposal, useProposal, notifyProposalSaved, onProposalSaved } from './proposal.store';
import type { FeatureEditProposal } from '@webatlas/shared';

const P: FeatureEditProposal = {
  kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh',
  current: { wattage_mw: '70' }, proposed: { wattage_mw: '72' },
};

beforeEach(() => closeProposal());

describe('proposal store', () => {
  it('publishes the open proposal to subscribers and clears it on close', () => {
    const { result } = renderHook(() => useProposal());
    expect(result.current).toBeNull();
    act(() => openProposal(P));
    expect(result.current).toBe(P);
    act(() => closeProposal());
    expect(result.current).toBeNull();
  });

  it('delivers saved notices until unsubscribed', () => {
    const cb = vi.fn();
    const off = onProposalSaved(cb);
    notifyProposalSaved('Đã cập nhật.');
    off();
    notifyProposalSaved('again');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('Đã cập nhật.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/web -- src/entities/proposal`
Expected: FAIL — module not found.

- [ ] **Step 3: Store**

`apps/web/src/entities/proposal/proposal.store.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { FeatureEditProposal } from '@webatlas/shared';

/**
 * The one open update proposal, shared between the assistant slice (which receives
 * it as a MapCommand) and the feature-editing slice (which renders the wizard).
 * A module store rather than React context: the command executor is a plain
 * function built in several slices, and it only needs `openProposal`.
 */
let current: FeatureEditProposal | null = null;
const listeners = new Set<() => void>();
const savedListeners = new Set<(text: string) => void>();

function emit() {
  for (const l of listeners) l();
}

export function openProposal(proposal: FeatureEditProposal): void {
  current = proposal;
  emit();
}

export function closeProposal(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getProposal(): FeatureEditProposal | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProposal(): FeatureEditProposal | null {
  return useSyncExternalStore(subscribe, getProposal, getProposal);
}

/** The wizard reports a successful save so the assistant transcript can say so. */
export function notifyProposalSaved(text: string): void {
  for (const l of savedListeners) l(text);
}

export function onProposalSaved(listener: (text: string) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}
```

Run: `npm run test -w @webatlas/web -- src/entities/proposal` — Expected: PASS.

- [ ] **Step 4: Presenter test**

`apps/web/src/features/feature-editing/model/useProposedEditPresenter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FeatureEditProposal } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';

const updateFeature = vi.fn();
vi.mock('../api/features.api', () => ({ updateFeature: (...a: unknown[]) => updateFeature(...a) }));

import { useProposedEditPresenter } from './useProposedEditPresenter';

const P: FeatureEditProposal = {
  kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh',
  current: { name: 'Sông Hinh', wattage_mw: '70', status: null },
  proposed: { wattage_mw: '72' },
  sourceDocument: 'QĐ 123',
};

beforeEach(() => updateFeature.mockReset());

describe('useProposedEditPresenter', () => {
  it('prefills current values overlaid with proposed ones and marks changes', () => {
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    expect(result.current.values.wattage_mw).toBe('72');
    expect(result.current.values.name).toBe('Sông Hinh');
    expect(result.current.values.status).toBe('');
    expect(result.current.isChanged('wattage_mw')).toBe(true);
    expect(result.current.isChanged('name')).toBe(false);
    expect(result.current.previous('wattage_mw')).toBe('70');
    expect(result.current.columns).not.toContain('external_id');
  });

  it('cannot save until both source fields are filled', () => {
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    expect(result.current.sourceDocument).toBe('QĐ 123');
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setSourceProvider('  '));
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    expect(result.current.canSave).toBe(true);
  });

  it('saves only changed columns with the source, then reports the count', async () => {
    updateFeature.mockResolvedValue({ id: 'f1' });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved }));
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    await act(() => result.current.submit());
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', {
      properties: { wattage_mw: '72' },
      source: { document: 'QĐ 123', provider: 'Sở Công Thương' },
    });
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  it('maps a 403 to a Vietnamese permission message and keeps the values', async () => {
    updateFeature.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    const { result } = renderHook(() => useProposedEditPresenter(P, { onSaved: vi.fn() }));
    act(() => result.current.setSourceProvider('Sở Công Thương'));
    await act(() => result.current.submit());
    expect(result.current.error).toBe('Bạn không có quyền cập nhật.');
    expect(result.current.values.wattage_mw).toBe('72');
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm run test -w @webatlas/web -- src/features/feature-editing/model/useProposedEditPresenter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: API payload + presenter**

In `apps/web/src/features/feature-editing/api/features.api.ts`:

```ts
export interface UpdateFeaturePayload {
  geometry?: GeoJSONGeometry;
  properties: Record<string, unknown>;
  /** Required by the proposal wizard; the API stores it on the audit row. */
  source?: { document: string; provider: string };
}
```

`apps/web/src/features/feature-editing/model/useProposedEditPresenter.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { LAYER_ATTRIBUTE_MAP, editableColumns, type FeatureEditProposal } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { updateFeature } from '../api/features.api';

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'Bạn không có quyền cập nhật.';
    if (e.status === 404) return 'Đối tượng không còn tồn tại.';
    if (e.status === 400) return e.message;
  }
  return 'Không lưu được, vui lòng thử lại.';
}

export function useProposedEditPresenter(
  proposal: FeatureEditProposal,
  { onSaved }: { onSaved: (changedCount: number) => void }
) {
  const columns = useMemo(() => editableColumns(proposal.layerKey), [proposal.layerKey]);
  const labels = useMemo(() => {
    const iso = LAYER_ATTRIBUTE_MAP[proposal.layerKey].attributes;
    return Object.fromEntries(columns.map((c) => [c, iso[c] ?? c]));
  }, [proposal.layerKey, columns]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      columns.map((c) => [c, (c in proposal.proposed ? proposal.proposed[c] : proposal.current[c]) ?? ''])
    )
  );
  const [sourceDocument, setSourceDocument] = useState(proposal.sourceDocument ?? '');
  const [sourceProvider, setSourceProvider] = useState(proposal.sourceProvider ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previous = useCallback((c: string) => proposal.current[c] ?? '', [proposal]);
  const isChanged = useCallback((c: string) => values[c] !== previous(c), [values, previous]);
  const changed = columns.filter(isChanged);

  const canSave =
    !saving && changed.length > 0 && sourceDocument.trim() !== '' && sourceProvider.trim() !== '';

  const setField = useCallback((c: string, v: string) => setValues((prev) => ({ ...prev, [c]: v })), []);

  const submit = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const properties = Object.fromEntries(changed.map((c) => [c, values[c] === '' ? null : values[c]]));
      await updateFeature(proposal.layerKey, proposal.featureId, {
        properties,
        source: { document: sourceDocument.trim(), provider: sourceProvider.trim() },
      });
      onSaved(changed.length);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setSaving(false);
    }
  }, [canSave, changed, values, proposal, sourceDocument, sourceProvider, onSaved]);

  return {
    columns, labels, values, setField, isChanged, previous,
    sourceDocument, setSourceDocument, sourceProvider, setSourceProvider,
    canSave, saving, error, submit,
  };
}
```

Run: `npm run test -w @webatlas/web -- src/features/feature-editing/model/useProposedEditPresenter.test.ts` — Expected: PASS.

- [ ] **Step 7: View test**

`apps/web/src/features/feature-editing/ui/ProposedEditWizard.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProposedEditWizardView, type ProposedEditWizardViewProps } from './ProposedEditWizard.view';

function props(over: Partial<ProposedEditWizardViewProps> = {}): ProposedEditWizardViewProps {
  return {
    title: 'Sông Hinh',
    columns: ['name', 'wattage_mw'],
    labels: { name: 'geographicalName', wattage_mw: 'ratedPower' },
    values: { name: 'Sông Hinh', wattage_mw: '72' },
    isChanged: (c) => c === 'wattage_mw',
    previous: (c) => (c === 'wattage_mw' ? '70' : 'Sông Hinh'),
    sourceDocument: '', sourceProvider: '',
    canSave: false, saving: false, error: null,
    onField: vi.fn(), onSourceDocument: vi.fn(), onSourceProvider: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
    ...over,
  };
}

describe('ProposedEditWizardView', () => {
  it('marks changed fields with their previous value', () => {
    render(<ProposedEditWizardView {...props()} />);
    expect(screen.getByText('Trước: 70')).toBeInTheDocument();
    expect(screen.queryByText('Trước: Sông Hinh')).toBeNull();
  });

  it('shows both required source fields and disables save until allowed', () => {
    render(<ProposedEditWizardView {...props()} />);
    expect(screen.getByLabelText('Tài liệu nguồn *')).toBeRequired();
    expect(screen.getByLabelText('Người cung cấp *')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('cancels without saving', () => {
    const p = props();
    render(<ProposedEditWizardView {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: View**

`apps/web/src/features/feature-editing/ui/ProposedEditWizard.view.tsx`:

```tsx
import { Modal } from '../../../shared/ui/Modal';
import { AttributeFieldView } from './AttributeField.view';

export interface ProposedEditWizardViewProps {
  title: string;
  columns: string[];
  labels: Record<string, string>;
  values: Record<string, string>;
  isChanged: (column: string) => boolean;
  previous: (column: string) => string;
  sourceDocument: string;
  sourceProvider: string;
  canSave: boolean;
  saving: boolean;
  error: string | null;
  onField: (column: string, value: string) => void;
  onSourceDocument: (value: string) => void;
  onSourceProvider: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Passive: every piece of state lives in useProposedEditPresenter.
export function ProposedEditWizardView(p: ProposedEditWizardViewProps) {
  return (
    <Modal open onClose={p.onCancel}>
      <form
        className="proposal-wizard"
        onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}
      >
        <h2 className="panel-title">Đề xuất cập nhật</h2>
        <p className="proposal-subtitle">
          {p.title} — trợ lý đã điền sẵn giá trị đề xuất. Kiểm tra lại trước khi lưu.
        </p>

        {p.columns.map((c) => (
          <div key={c} className={`proposal-field${p.isChanged(c) ? ' changed' : ''}`}>
            <AttributeFieldView column={c} label={p.labels[c] ?? c} value={p.values[c] ?? ''} onChange={(v) => p.onField(c, v)} />
            {p.isChanged(c) && <span className="proposal-previous">Trước: {p.previous(c) || '(trống)'}</span>}
          </div>
        ))}

        <fieldset className="proposal-source">
          <legend>Nguồn số liệu</legend>
          <label htmlFor="proposal-source-document">Tài liệu nguồn *</label>
          <input
            id="proposal-source-document" type="text" required maxLength={500}
            placeholder="Ví dụ: Quyết định 123/QĐ-UBND"
            value={p.sourceDocument} onChange={(e) => p.onSourceDocument(e.target.value)}
          />
          <label htmlFor="proposal-source-provider">Người cung cấp *</label>
          <input
            id="proposal-source-provider" type="text" required maxLength={200}
            placeholder="Ví dụ: Sở Công Thương Đắk Lắk"
            value={p.sourceProvider} onChange={(e) => p.onSourceProvider(e.target.value)}
          />
        </fieldset>

        {p.error && <p className="edit-form-error" role="alert">{p.error}</p>}
        <div className="edit-form-actions">
          <button type="submit" disabled={!p.canSave}>{p.saving ? 'Đang lưu…' : 'Lưu'}</button>
          <button type="button" onClick={p.onCancel}>Huỷ</button>
        </div>
      </form>
    </Modal>
  );
}
```

Run: `npm run test -w @webatlas/web -- src/features/feature-editing/ui/ProposedEditWizard.view.test.tsx` — Expected: PASS.

- [ ] **Step 9: Container, assistant wiring, mount**

`apps/web/src/features/feature-editing/ProposedEdit.tsx`:

```tsx
import { LAYER_ATTRIBUTE_MAP, type FeatureEditProposal } from '@webatlas/shared';
import { RequireRole } from '../auth/ui/RequireRole';
import { useMapEditing } from '../map/model/mapEditing';
import { closeProposal, notifyProposalSaved, useProposal } from '../../entities/proposal/proposal.store';
import { useProposedEditPresenter } from './model/useProposedEditPresenter';
import { ProposedEditWizardView } from './ui/ProposedEditWizard.view';

function ProposedEditDialog({ proposal }: { proposal: FeatureEditProposal }) {
  const { refreshLayer } = useMapEditing();
  const label = proposal.name ?? 'đối tượng';
  const p = useProposedEditPresenter(proposal, {
    onSaved: (count) => {
      refreshLayer(LAYER_ATTRIBUTE_MAP[proposal.layerKey].layerStateId);
      notifyProposalSaved(`Đã cập nhật ${count} trường của "${label}".`);
      closeProposal();
    },
  });
  return (
    <ProposedEditWizardView
      title={label}
      columns={p.columns} labels={p.labels} values={p.values}
      isChanged={p.isChanged} previous={p.previous}
      sourceDocument={p.sourceDocument} sourceProvider={p.sourceProvider}
      canSave={p.canSave} saving={p.saving} error={p.error}
      onField={p.setField} onSourceDocument={p.setSourceDocument} onSourceProvider={p.setSourceProvider}
      onSubmit={p.submit} onCancel={closeProposal}
    />
  );
}

// UX gate ONLY: PUT enforces admin. A proposal opened for a non-admin renders nothing.
export default function ProposedEdit() {
  const proposal = useProposal();
  if (!proposal) return null;
  return (
    <RequireRole role="admin">
      {/* key remounts per proposal so the presenter re-seeds its initial values */}
      <ProposedEditDialog key={`${proposal.featureId}:${JSON.stringify(proposal.proposed)}`} proposal={proposal} />
    </RequireRole>
  );
}
```

`apps/web/src/features/assistant/model/useAssistant.ts` — add before `return`:

```ts
  /** A local assistant line, e.g. confirming a save made in the update wizard. */
  const notify = useCallback((text: string) => {
    setTurns((prev) => [...prev, { role: 'assistant', segments: [{ kind: 'grounded', text }], provenance: [] }]);
  }, []);
```

and return `{ turns, loading, error, send, retry, notify }`.

`apps/web/src/features/assistant/index.tsx`:

```tsx
import { useCallback, useEffect } from 'react';
import { openProposal, onProposalSaved } from '../../entities/proposal/proposal.store';
// …
  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
    layerExists: (id) => layersState.some((l) => l.id === id),
    onProposeEdit: openProposal,
  });
// …
  const { turns, loading, error, send, retry, notify } = useAssistant({ getMapContext, run });
  useEffect(() => onProposalSaved(notify), [notify]);
```

`apps/web/src/app/App.tsx` — `import ProposedEdit from '../features/feature-editing/ProposedEdit';` and render `<ProposedEdit />` right after `<DynamicPopup />`.

Append to `apps/web/src/styles/main.css`:

```css
/* Đề xuất cập nhật từ trợ lý */
.proposal-wizard { display: flex; flex-direction: column; gap: 8px; min-width: 360px; max-height: 80vh; overflow-y: auto; }
.proposal-subtitle { margin: 0 0 4px; font-size: 13px; color: var(--text-muted, #6b7280); }
.proposal-field.changed { border-left: 3px solid #d97706; padding-left: 8px; }
.proposal-previous { font-size: 12px; color: #92400e; }
.proposal-source { display: flex; flex-direction: column; gap: 4px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
```

- [ ] **Step 10: Run tests + type-check**

Run: `npm run test -w @webatlas/web -- src/entities src/features/feature-editing src/features/assistant` then `npm run build:web`
Expected: PASS; build succeeds.

- [ ] **Step 11: Tier A checkpoint**

Run: `npm run test:shared && npm run test:api && npm run test:web && npm run build:web`
Expected: all green. Fix anything red before continuing.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/entities/proposal apps/web/src/features/feature-editing apps/web/src/features/assistant apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): biểu mẫu đề xuất cập nhật từ trợ lý, bắt buộc tài liệu nguồn và người cung cấp

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Tier B

### Task 10: Analysis module — route, timeout, input schemas, `buffer`, `select_within`

**Files:**
- Create: `apps/api/src/modules/analysis/db.ts` — `withAnalysisTimeout`
- Create: `apps/api/src/modules/analysis/schemas.ts` — Zod input schemas
- Create: `apps/api/src/modules/analysis/area.ts` — `inputGeometry`, `areaGeometry`
- Create: `apps/api/src/modules/analysis/ops/buffer.ts`, `ops/selectWithin.ts`, `ops/index.ts`
- Create: `apps/api/src/modules/analysis/controller.ts`, `routes.ts`
- Create: `apps/api/src/modules/analysis/analysis.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `resolveFeature`, `Queryable`, `candidateCtes`, `layerTable`, `LAYER_LABELS`, `POINT_SQL`, `ROW_LIMIT` (helpers); `simplifiedGeoJsonSql` (Task 5); `AnalysisResult`, `ANALYSIS_OPS`, `capResultItems`, `isGeoJsonGeometry`, `countVertices`, `positionsOf`, `MAX_RESULT_ITEMS` (shared); `inVietnam` (`lib/geo`).
- Produces:
  - `ANALYSIS_TIMEOUT_MS = 5000`; `withAnalysisTimeout<T>(pool: Pool, fn: (db: Queryable) => Promise<T>, timeoutMs?: number): Promise<T>` — read-only transaction, maps SQLSTATE `57014` → `AppError(504, 'ANALYSIS_TIMEOUT', 'Phép phân tích quá lâu, hãy thu nhỏ vùng.')`
  - `MAX_INPUT_VERTICES = 5000`; schemas + types `BufferInput`, `SelectWithinInput`, `NearestInput`, `ProfileInput`, `ZonalInput`; `FeatureRefInput = { layerKey, featureId }`
  - `inputGeometry(db, { geometry?, feature? }): Promise<{ geojson: string; label?: string }>`
  - `areaGeometry(db, { geometry?, feature?, bufferKm? }): Promise<{ geojson: string; display: GeoJsonGeometry; label?: string; areaKm2: number }>`
  - `bufferOp(db, BufferInput): Promise<AnalysisResult>`, `selectWithinOp(db, SelectWithinInput): Promise<AnalysisResult>`
  - `OPS: Partial<Record<AnalysisOp, { schema: ZodTypeAny; run: (db: Queryable, input: any) => Promise<AnalysisResult> }>>`
  - `POST /api/analysis/:op` (public, 60/min)

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/analysis/analysis.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { withAnalysisTimeout } from './db';

let app: ReturnType<typeof buildApp>;
let dam: { id: string; lon: number; lat: number };
let riverId: string;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const pool = getPool();
  ({ rows: [dam] } = await pool.query(
    `SELECT id::text, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM water.dams_active WHERE geom IS NOT NULL LIMIT 1`
  ));
  ({ rows: [{ id: riverId }] } = await pool.query(`SELECT id::text FROM water.rivers_active LIMIT 1`));
});
afterAll(async () => { await app.close(); });

const post = (op: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/analysis/${op}`, payload: payload as object });

const square = (lon: number, lat: number, d: number) => ({
  type: 'Polygon',
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
});

describe('POST /api/analysis/buffer', () => {
  it('buffers a point by 1 km to roughly π km²', async () => {
    const res = await post('buffer', { geometry: { type: 'Point', coordinates: [108.05, 12.68] }, radiusKm: 1 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.op).toBe('buffer');
    expect(body.summary['Diện tích vùng đệm (km²)']).toBeGreaterThan(3.0);
    expect(body.summary['Diện tích vùng đệm (km²)']).toBeLessThan(3.2);
    expect(body.geometries.map((g: { role: string }) => g.role)).toEqual(['result', 'input']);
    expect(body.geometries[0].geometry.type).toBe('Polygon');
  });

  it('buffers a feature reference', async () => {
    const res = await post('buffer', { feature: { layerKey: 'rivers', featureId: riverId }, radiusKm: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary['Bán kính (km)']).toBe(2);
  });

  it('rejects bad radii, both inputs at once, and coordinates outside Vietnam', async () => {
    const point = { type: 'Point', coordinates: [108.05, 12.68] };
    expect((await post('buffer', { geometry: point, radiusKm: 0 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: point, radiusKm: 101 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: point, feature: { layerKey: 'rivers', featureId: riverId }, radiusKm: 1 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: { type: 'Point', coordinates: [2.35, 48.85] }, radiusKm: 1 })).statusCode).toBe(400);
  });

  it('404s a feature reference that does not exist', async () => {
    const res = await post('buffer', { feature: { layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000' }, radiusKm: 1 });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/analysis/select_within', () => {
  it('finds the dam inside a small square around it, and draws the area as input', async () => {
    const res = await post('select_within', { geometry: square(dam.lon, dam.lat, 0.02), layerKeys: ['dams'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary['đập & hồ chứa']).toBeGreaterThanOrEqual(1);
    expect(body.summary['Tổng số']).toBeGreaterThanOrEqual(1);
    expect(body.rows.some((r: { featureId: string }) => r.featureId === dam.id)).toBe(true);
    expect(body.geometries[0].role).toBe('input');
  });

  it('accepts a line feature with a buffer distance', async () => {
    const res = await post('select_within', { feature: { layerKey: 'rivers', featureId: riverId }, bufferKm: 5, layerKeys: ['dams', 'lakes'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toHaveProperty('Tổng số');
  });

  it('rejects a point area without a buffer distance', async () => {
    const res = await post('select_within', { geometry: { type: 'Point', coordinates: [dam.lon, dam.lat] }, layerKeys: ['dams'] });
    expect(res.statusCode).toBe(400);
    const lineNoBuffer = await post('select_within', { feature: { layerKey: 'rivers', featureId: riverId }, layerKeys: ['dams'] });
    expect(lineNoBuffer.statusCode).toBe(400);
  });
});

describe('analysis route', () => {
  it('400s an unknown operation', async () => {
    expect((await post('teleport', {})).statusCode).toBe(400);
  });
});

describe('withAnalysisTimeout', () => {
  it('turns a statement timeout into a 504 ANALYSIS_TIMEOUT', async () => {
    await expect(
      withAnalysisTimeout(getPool(), (db) => db.query('SELECT pg_sleep(1)'), 50)
    ).rejects.toMatchObject({ statusCode: 504, code: 'ANALYSIS_TIMEOUT' });
  });

  it('runs read-only', async () => {
    await expect(
      withAnalysisTimeout(getPool(), (db) => db.query('CREATE TEMP TABLE nope (x int)'))
    ).rejects.toMatchObject({ code: '25006' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @webatlas/api -- src/modules/analysis`
Expected: FAIL — `./db` not found.

- [ ] **Step 3: Timeout wrapper**

`apps/api/src/modules/analysis/db.ts`:

```ts
import type { Pool } from 'pg';
import { AppError } from '../../errors';
import type { Queryable } from '../assistant/tools/data/helpers';

export const ANALYSIS_TIMEOUT_MS = 5000;

/** Postgres "query_canceled" — what statement_timeout raises. */
const QUERY_CANCELED = '57014';

/**
 * Runs an analysis on one client inside a READ ONLY transaction with a local
 * statement_timeout. Analysis input is user-drawn, so a huge polygon over the DEM
 * is one click away; the timeout bounds it, and READ ONLY makes the module
 * structurally unable to write even if a future op is careless.
 */
export async function withAnalysisTimeout<T>(
  pool: Pool,
  fn: (db: Queryable) => Promise<T>,
  timeoutMs: number = ANALYSIS_TIMEOUT_MS
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* transaction already ended */ }
    if ((e as { code?: string }).code === QUERY_CANCELED) {
      throw new AppError(504, 'ANALYSIS_TIMEOUT', 'Phép phân tích quá lâu, hãy thu nhỏ vùng.');
    }
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Schemas**

`apps/api/src/modules/analysis/schemas.ts`:

```ts
import { z } from 'zod';
import {
  EDITABLE_LAYER_KEYS,
  countVertices,
  isGeoJsonGeometry,
  positionsOf,
  type GeoJsonGeometry,
} from '@webatlas/shared';
import { inVietnam } from '../../lib/geo';

export const MAX_INPUT_VERTICES = 5000;

type GeometryType = GeoJsonGeometry['type'];
const ALL_TYPES: GeometryType[] = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

function geometryInput(types: GeometryType[]) {
  return z.custom<GeoJsonGeometry>(
    (v) =>
      isGeoJsonGeometry(v) &&
      types.includes(v.type) &&
      countVertices(v) <= MAX_INPUT_VERTICES &&
      positionsOf(v).every(([lon, lat]) => inVietnam(lon, lat)),
    { message: `Hình không hợp lệ: cần ${types.join('/')}, tối đa ${MAX_INPUT_VERTICES} điểm, nằm trong Việt Nam` }
  );
}

export const FeatureRef = z.object({
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  featureId: z.string().uuid('Mã đối tượng không hợp lệ'),
});
export type FeatureRefInput = z.infer<typeof FeatureRef>;

const exactlyOne = (v: { geometry?: unknown; feature?: unknown }) =>
  (v.geometry === undefined) !== (v.feature === undefined);
const EXACTLY_ONE = 'Cần đúng một trong hai: geometry (hình vẽ) hoặc feature (đối tượng)';

const radiusKm = z.number().gt(0, 'Bán kính phải lớn hơn 0').max(100, 'Bán kính tối đa 100 km');

export const BufferInput = z
  .object({ geometry: geometryInput(ALL_TYPES).optional(), feature: FeatureRef.optional(), radiusKm })
  .refine(exactlyOne, EXACTLY_ONE);
export type BufferInput = z.infer<typeof BufferInput>;

export const SelectWithinInput = z
  .object({
    geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(),
    feature: FeatureRef.optional(),
    bufferKm: radiusKm.optional(),
    layerKeys: z.array(z.enum(EDITABLE_LAYER_KEYS)).min(1).max(EDITABLE_LAYER_KEYS.length),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type SelectWithinInput = z.infer<typeof SelectWithinInput>;

export const NearestInput = z
  .object({
    lon: z.number(),
    lat: z.number(),
    layerKey: z.enum(EDITABLE_LAYER_KEYS),
    k: z.number().int().min(1).max(25).default(5),
  })
  .refine(({ lon, lat }) => inVietnam(lon, lat), 'Toạ độ ngoài phạm vi Việt Nam');
export type NearestInput = z.infer<typeof NearestInput>;

export const ProfileInput = z
  .object({
    geometry: geometryInput(['LineString', 'MultiLineString']).optional(),
    feature: FeatureRef.optional(),
    samples: z.number().int().min(2).max(200).default(100),
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ZonalInput = z
  .object({ geometry: geometryInput(['Polygon', 'MultiPolygon']).optional(), feature: FeatureRef.optional() })
  .refine(exactlyOne, EXACTLY_ONE);
export type ZonalInput = z.infer<typeof ZonalInput>;
```

- [ ] **Step 5: Input/area resolution**

`apps/api/src/modules/analysis/area.ts`:

```ts
import type { GeoJsonGeometry } from '@webatlas/shared';
import { NotFoundError, ValidationError } from '../../errors';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { resolveFeature, type Queryable } from '../assistant/tools/data/helpers';
import type { FeatureRefInput } from './schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/** A drawn geometry as-is, or a feature's full-precision geometry. */
export async function inputGeometry(
  db: Queryable,
  input: { geometry?: GeoJsonGeometry; feature?: FeatureRefInput }
): Promise<{ geojson: string; label?: string }> {
  if (input.geometry) return { geojson: JSON.stringify(input.geometry) };
  const ref = input.feature!;
  const f = await resolveFeature(db, ref.layerKey, ref.featureId, { simplify: false });
  if (!f) throw new NotFoundError('Không tìm thấy đối tượng');
  return { geojson: JSON.stringify(f.geometry), ...(f.name ? { label: f.name } : {}) };
}

/**
 * The polygon an area operation runs over: a drawn/feature polygon, or any
 * geometry buffered by `bufferKm`. A point or line with no buffer has no area,
 * which is a user error, not an empty result.
 */
export async function areaGeometry(
  db: Queryable,
  input: { geometry?: GeoJsonGeometry; feature?: FeatureRefInput; bufferKm?: number }
): Promise<{ geojson: string; display: GeoJsonGeometry; label?: string; areaKm2: number }> {
  const src = await inputGeometry(db, input);
  const shapeSql = input.bufferKm !== undefined ? `ST_Buffer(${GEOM}::geography, $2)::geometry` : GEOM;
  const params = input.bufferKm !== undefined ? [src.geojson, input.bufferKm * 1000] : [src.geojson];
  const { rows } = await db.query<{ geojson: string; display: GeoJsonGeometry; type: string; areaKm2: number }>(
    `SELECT ST_AsGeoJSON(a, 7) AS geojson, ${simplifiedGeoJsonSql('a')} AS display,
            GeometryType(a) AS type,
            (ST_Area(a::geography) / 1e6)::float8 AS "areaKm2"
       FROM (SELECT ${shapeSql} AS a) s`,
    params
  );
  const row = rows[0];
  if (row.type !== 'POLYGON' && row.type !== 'MULTIPOLYGON') {
    throw new ValidationError('Vùng phải là đa giác; với điểm hoặc đường hãy nhập bán kính vùng đệm (bufferKm).');
  }
  const label = input.bufferKm !== undefined
    ? `${src.label ?? 'Hình vẽ'} + ${input.bufferKm} km`
    : src.label;
  return { geojson: row.geojson, display: row.display, areaKm2: row.areaKm2, ...(label ? { label } : {}) };
}
```

- [ ] **Step 6: `buffer` op**

`apps/api/src/modules/analysis/ops/buffer.ts`:

```ts
import { capResultItems, type AnalysisResult, type GeoJsonGeometry, type ResultGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { inputGeometry } from '../area';
import type { BufferInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/** Geodesic buffer (::geography), so a 10 km radius is 10 km at any latitude. */
export async function bufferOp(db: Queryable, input: BufferInput): Promise<AnalysisResult> {
  const src = await inputGeometry(db, input);
  const { rows } = await db.query<{ input: GeoJsonGeometry; result: GeoJsonGeometry; areaKm2: number }>(
    `WITH b AS (SELECT ${GEOM} AS src, ST_Buffer(${GEOM}::geography, $2)::geometry AS buf)
     SELECT ${simplifiedGeoJsonSql('src')} AS input,
            ${simplifiedGeoJsonSql('buf')} AS result,
            round((ST_Area(buf::geography) / 1e6)::numeric, 3)::float8 AS "areaKm2"
       FROM b`,
    [src.geojson, input.radiusKm * 1000]
  );
  const row = rows[0];
  const items: ResultGeometry[] = [
    { geometry: row.result, role: 'result', label: `Vùng đệm ${input.radiusKm} km` },
    { geometry: row.input, role: 'input', ...(src.label ? { label: src.label } : {}) },
  ];
  const capped = capResultItems(items);
  return {
    op: 'buffer',
    summary: { 'Bán kính (km)': input.radiusKm, 'Diện tích vùng đệm (km²)': row.areaKm2 },
    geometries: capped.items,
    truncated: capped.truncated,
  };
}
```

- [ ] **Step 7: `select_within` op**

`apps/api/src/modules/analysis/ops/selectWithin.ts`:

```ts
import {
  MAX_RESULT_ITEMS,
  capResultItems,
  type AnalysisResult,
  type AnalysisRow,
  type GeoJsonGeometry,
  type ResultGeometry,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import {
  LAYER_LABELS, POINT_SQL, ROW_LIMIT, candidateCtes, layerTable, type Queryable,
} from '../../assistant/tools/data/helpers';
import { areaGeometry } from '../area';
import type { SelectWithinInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * Features of each layer intersecting an area. The candidate step (`geom && area`)
 * reaches the GiST index on the base table; the real predicate and NOT deleted are
 * re-applied after version resolution (handover §4.2). `count(*) OVER ()` is
 * computed before LIMIT, so counts are full even when drawing is capped.
 */
export async function selectWithinOp(db: Queryable, input: SelectWithinInput): Promise<AnalysisResult> {
  const area = await areaGeometry(db, input);
  const summary: Record<string, number | string> = { 'Tổng số': 0 };
  const rows: AnalysisRow[] = [];
  const highlights: ResultGeometry[] = [];
  let total = 0;

  for (const key of input.layerKeys) {
    const ctes = candidateCtes(
      key,
      `SELECT external_id FROM ${layerTable(key)} WHERE geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`
    );
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `WITH RECURSIVE ${ctes}
       SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM resolved
        WHERE NOT deleted AND geom IS NOT NULL AND ST_Intersects(geom, ${GEOM})
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [area.geojson, MAX_RESULT_ITEMS]
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
  summary['Diện tích vùng (km²)'] = Math.round(area.areaKm2 * 1000) / 1000;
  const capped = capResultItems([
    { geometry: area.display, role: 'input', ...(area.label ? { label: area.label } : {}) },
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

- [ ] **Step 8: Registry, controller, route**

`apps/api/src/modules/analysis/ops/index.ts`:

```ts
import type { ZodTypeAny } from 'zod';
import type { AnalysisOp, AnalysisResult } from '@webatlas/shared';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { BufferInput, SelectWithinInput } from '../schemas';
import { bufferOp } from './buffer';
import { selectWithinOp } from './selectWithin';

export interface OpDef {
  schema: ZodTypeAny;
  // Each op's input type is enforced by its own schema at the route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (db: Queryable, input: any) => Promise<AnalysisResult>;
}

/** One entry per op. The HTTP route and the assistant tools both call through here. */
export const OPS: Partial<Record<AnalysisOp, OpDef>> = {
  buffer: { schema: BufferInput, run: bufferOp },
  select_within: { schema: SelectWithinInput, run: selectWithinOp },
};
```

`apps/api/src/modules/analysis/controller.ts`:

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ANALYSIS_OPS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';
import { withAnalysisTimeout } from './db';
import { OPS } from './ops';

const OpParams = z.object({ op: z.enum(ANALYSIS_OPS) });

/** POST /api/analysis/:op — public like /api/search, bounded by caps, timeout and rate limit. */
export async function runAnalysis(req: FastifyRequest, reply: FastifyReply) {
  const { op } = validate(OpParams, req.params);
  const def = OPS[op];
  if (!def) throw new NotFoundError('Phép phân tích chưa được hỗ trợ');
  const input = validate(def.schema, req.body ?? {});
  const result = await withAnalysisTimeout(req.server.pg, (db) => def.run(db, input));
  reply.send(result);
}
```

`apps/api/src/modules/analysis/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { runAnalysis } from './controller';

/** Own ceiling: an analysis is heavier than a page call, and a user clicking through
 *  toolbar operations should not exhaust the global 100/min for the rest of the API. */
export default async function analysisRoutes(app: FastifyInstance) {
  app.post('/analysis/:op', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, runAnalysis);
}
```

`apps/api/src/server.ts`: `import analysisRoutes from './modules/analysis/routes';` and `app.register(analysisRoutes, { prefix: '/api' });` after the geometry routes.

- [ ] **Step 9: Run tests to verify pass**

Run: `npm run test -w @webatlas/api -- src/modules/analysis`
Expected: PASS. If the READ ONLY test reports a different code, confirm with `psql` that `CREATE TEMP TABLE` inside `BEGIN READ ONLY` raises `25006`; adjust only the expected code, not the transaction mode.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/analysis apps/api/src/server.ts
git commit -m "feat(api): mô-đun phân tích không gian — vùng đệm và chọn theo vùng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Analysis ops — `nearest`, `elevation_profile`, `zonal_elevation`

**Files:**
- Create: `apps/api/src/modules/analysis/dem.ts`
- Create: `apps/api/src/modules/analysis/ops/nearest.ts`, `ops/elevationProfile.ts`, `ops/zonalElevation.ts`
- Create: `apps/api/src/modules/analysis/ops/elevationProfile.test.ts` (pure)
- Modify: `apps/api/src/modules/analysis/ops/index.ts`
- Modify: `apps/api/src/modules/assistant/tools/data/nearestFeatures.ts` (call `queryNearest`)
- Modify: `apps/api/src/modules/analysis/analysis.test.ts`

**Interfaces:**
- Consumes: Task 10 schemas/area/db; `FABDEM_ATTRIBUTION` from `@webatlas/shared`.
- Produces:
  - `demAvailable(db: Queryable): Promise<boolean>`; `DEM_UNAVAILABLE_SUMMARY = { 'Trạng thái': 'Chưa nạp dữ liệu độ cao' }`
  - `interface NearestRow { featureId: string; name: string | null; lon: number; lat: number; distanceKm: number }`
  - `queryNearest(db: Queryable, q: { layerKey: EditableLayerKey; lon: number; lat: number; limit: number }): Promise<NearestRow[]>`
  - `nearestOp`, `elevationProfileOp`, `zonalElevationOp`
  - `profileStats(elevations: (number | null)[], lengthM: number): { min: number; max: number; ascentM: number; descentM: number; meanSlopePct: number; valid: number } | null`
  - `MAX_ZONAL_AREA_KM2 = 5000`

- [ ] **Step 1: Pure stats test**

`apps/api/src/modules/analysis/ops/elevationProfile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { profileStats } from './elevationProfile';

describe('profileStats', () => {
  it('computes range, ascent, descent and mean slope, skipping nodata samples', () => {
    const s = profileStats([100, 150, null, 120, 200], 1000);
    expect(s).toEqual({ min: 100, max: 200, ascentM: 130, descentM: 30, meanSlopePct: 16, valid: 4 });
  });

  it('returns null when no sample has data', () => {
    expect(profileStats([null, null], 500)).toBeNull();
  });
});
```

Run: `npm run test -w @webatlas/api -- src/modules/analysis/ops/elevationProfile.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: DEM availability**

`apps/api/src/modules/analysis/dem.ts`:

```ts
import type { Queryable } from '../assistant/tools/data/helpers';

export const DEM_UNAVAILABLE_SUMMARY = { 'Trạng thái': 'Chưa nạp dữ liệu độ cao' } as const;

/**
 * Checked up front with to_regclass rather than by catching 42P01: the analysis runs
 * inside a transaction, and a caught error there aborts it — every later statement
 * would fail with 25P02. A deployment that never ran the DEM runbook is an ordinary
 * outcome (200 + status), not an error.
 */
export async function demAvailable(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT to_regclass('basemap.dem_region') IS NOT NULL AS ok`);
  return rows[0].ok;
}
```

- [ ] **Step 3: Elevation profile**

`apps/api/src/modules/analysis/ops/elevationProfile.ts`:

```ts
import { FABDEM_ATTRIBUTION, type AnalysisResult, type GeoJsonGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { inputGeometry } from '../area';
import { DEM_UNAVAILABLE_SUMMARY, demAvailable } from '../dem';
import type { ProfileInput } from '../schemas';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function profileStats(elevations: (number | null)[], lengthM: number) {
  const valid = elevations.filter((e): e is number => e !== null);
  if (valid.length === 0) return null;
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i] - valid[i - 1];
    if (d > 0) ascentM += d; else descentM -= d;
  }
  return {
    min: round1(Math.min(...valid)),
    max: round1(Math.max(...valid)),
    ascentM: round1(ascentM),
    descentM: round1(descentM),
    meanSlopePct: lengthM > 0 ? round1(((ascentM + descentM) / lengthM) * 100) : 0,
    valid: valid.length,
  };
}

/**
 * Samples the DEM at `samples` evenly spaced points along a line. A MultiLineString
 * (most rivers) is merged, and its longest part is profiled. Distances are the
 * geodesic length times the planar fraction — accurate to well under 1% over the
 * region's extent.
 */
export async function elevationProfileOp(db: Queryable, input: ProfileInput): Promise<AnalysisResult> {
  const src = await inputGeometry(db, input);
  if (!(await demAvailable(db))) {
    return { op: 'elevation_profile', summary: { ...DEM_UNAVAILABLE_SUMMARY }, geometries: [] };
  }

  const { rows: [line] } = await db.query<{ line: string; lengthM: number; display: GeoJsonGeometry }>(
    `WITH src AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          part AS (
            SELECT d.geom AS g
              FROM src, LATERAL ST_Dump(
                CASE WHEN GeometryType(src.g) = 'MULTILINESTRING' THEN ST_LineMerge(src.g) ELSE src.g END
              ) d
             ORDER BY ST_Length(d.geom::geography) DESC
             LIMIT 1)
     SELECT ST_AsGeoJSON(g, 7) AS line, ST_Length(g::geography)::float8 AS "lengthM",
            ${simplifiedGeoJsonSql('g')} AS display
       FROM part`,
    [src.geojson]
  );

  const { rows: samples } = await db.query<{ i: number; elevationM: number | null }>(
    `WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          pts AS (
            SELECT s.i, ST_LineInterpolatePoint(line.g, s.i::float8 / ($2::int - 1)) AS p
              FROM line, generate_series(0, $2::int - 1) AS s(i))
     SELECT pts.i,
            (SELECT round(ST_Value(r.rast, pts.p)::numeric, 1)::float8
               FROM basemap.dem_region r
              WHERE ST_Intersects(r.rast, pts.p)
              LIMIT 1) AS "elevationM"
       FROM pts
      ORDER BY pts.i`,
    [line.line, input.samples]
  );

  const profile = samples.map((s) => ({
    distanceM: round1((line.lengthM * s.i) / (input.samples - 1)),
    elevationM: s.elevationM,
  }));
  const stats = profileStats(profile.map((p) => p.elevationM), line.lengthM);
  const summary: Record<string, number | string> = { 'Chiều dài (km)': Math.round(line.lengthM / 10) / 100 };
  if (stats) {
    Object.assign(summary, {
      'Thấp nhất (m)': stats.min,
      'Cao nhất (m)': stats.max,
      'Tổng lên (m)': stats.ascentM,
      'Tổng xuống (m)': stats.descentM,
      'Độ dốc trung bình (%)': stats.meanSlopePct,
      'Mẫu có dữ liệu': `${stats.valid}/${input.samples}`,
    });
  } else {
    summary['Trạng thái'] = 'Không có dữ liệu độ cao dọc tuyến';
  }

  return {
    op: 'elevation_profile',
    summary,
    profile,
    geometries: [{ geometry: line.display, role: 'result', label: src.label ?? 'Trắc diện' }],
    attribution: FABDEM_ATTRIBUTION,
  };
}
```

Run: `npm run test -w @webatlas/api -- src/modules/analysis/ops/elevationProfile.test.ts` — Expected: PASS.

- [ ] **Step 4: Zonal elevation**

`apps/api/src/modules/analysis/ops/zonalElevation.ts`:

```ts
import { FABDEM_ATTRIBUTION, type AnalysisResult } from '@webatlas/shared';
import { ValidationError } from '../../../errors';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { areaGeometry } from '../area';
import { DEM_UNAVAILABLE_SUMMARY, demAvailable } from '../dem';
import type { ZonalInput } from '../schemas';

/** ~5.5M 30 m pixels — a few seconds at most; anything bigger belongs in a batch job. */
export const MAX_ZONAL_AREA_KM2 = 5000;

export async function zonalElevationOp(db: Queryable, input: ZonalInput): Promise<AnalysisResult> {
  const area = await areaGeometry(db, input);
  if (area.areaKm2 > MAX_ZONAL_AREA_KM2) {
    throw new ValidationError(`Vùng quá lớn (${Math.round(area.areaKm2)} km²); tối đa ${MAX_ZONAL_AREA_KM2} km².`);
  }
  const drawn = [{ geometry: area.display, role: 'input' as const, ...(area.label ? { label: area.label } : {}) }];
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
    [area.geojson]
  );

  const summary: Record<string, number | string> = { 'Diện tích (km²)': Math.round(area.areaKm2 * 1000) / 1000 };
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

- [ ] **Step 5: Nearest — extract the query from the assistant tool**

`apps/api/src/modules/analysis/ops/nearest.ts`: move the SQL from `nearestFeatures.ts` (the `NEAREST_OVERFETCH_FACTOR` constant with its comment, the fast candidate query, and the count-then-exact fallback) into:

```ts
import type { AnalysisResult, EditableLayerKey, ResultGeometry } from '@webatlas/shared';
import {
  LAYER_LABELS, POINT_SQL, candidateCtes, layerTable, layerView, type Queryable,
} from '../../assistant/tools/data/helpers';
import type { NearestInput } from '../schemas';

// (moved verbatim from nearestFeatures.ts, with its comment)
const NEAREST_OVERFETCH_FACTOR = 20;

export interface NearestRow { featureId: string; name: string | null; lon: number; lat: number; distanceKm: number }

export async function queryNearest(
  db: Queryable,
  q: { layerKey: EditableLayerKey; lon: number; lat: number; limit: number }
): Promise<NearestRow[]> {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
  const overfetch = q.limit * NEAREST_OVERFETCH_FACTOR;
  const ctes = candidateCtes(
    q.layerKey,
    `SELECT external_id FROM ${layerTable(q.layerKey)} ORDER BY geom <-> ${point} LIMIT $4`
  );
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  const { rows: fastRows } = await db.query<NearestRow>(
    `WITH RECURSIVE ${ctes}
     SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM resolved
      WHERE NOT deleted
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch]
  );
  if (fastRows.length >= q.limit) return fastRows;

  // (keep the original fallback comment here)
  const view = layerView(q.layerKey);
  const { rows: countRows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${view}`);
  if (Number(countRows[0].n) < q.limit) return fastRows;
  const { rows: exactRows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM ${view}
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit]
  );
  return exactRows;
}

/** Connector lines from the chosen point to each nearest feature. */
export function nearestGeometries(
  layerKey: EditableLayerKey, lon: number, lat: number, rows: NearestRow[]
): ResultGeometry[] {
  return [
    { geometry: { type: 'Point', coordinates: [lon, lat] }, role: 'input', label: 'Điểm chọn' },
    ...rows.flatMap((r): ResultGeometry[] => [
      { geometry: { type: 'LineString', coordinates: [[lon, lat], [r.lon, r.lat]] }, role: 'result', label: `${r.distanceKm} km` },
      {
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, role: 'highlight', layerKey, featureId: r.featureId,
        ...(r.name ? { label: r.name } : {}),
      },
    ]),
  ];
}

export async function nearestOp(db: Queryable, input: NearestInput): Promise<AnalysisResult> {
  const rows = await queryNearest(db, { layerKey: input.layerKey, lon: input.lon, lat: input.lat, limit: input.k });
  return {
    op: 'nearest',
    summary: {
      'Lớp': LAYER_LABELS[input.layerKey],
      'Số đối tượng': rows.length,
      'Gần nhất (km)': rows[0]?.distanceKm ?? '—',
    },
    rows: rows.map((r) => ({ layerKey: input.layerKey, ...r })),
    geometries: nearestGeometries(input.layerKey, input.lon, input.lat, rows),
  };
}
```

Then in `apps/api/src/modules/assistant/tools/data/nearestFeatures.ts` replace the SQL body of `run` (everything from `const point = …` through the fallback block) with:

```ts
      const [rows, datasetVersion] = await Promise.all([
        queryNearest(ctx.pool, { layerKey: input.layerKey, lon: input.lon, lat: input.lat, limit: input.limit }),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);
```

keeping the `inVietnam` guard, the `ctx.provenance(...)` call, the empty message and the `JSON.stringify({ layerKey, from, rows })` return unchanged. Import `queryNearest` from `'../../../analysis/ops/nearest'` and drop the now-unused imports (`POINT_SQL`, `candidateCtes`, `layerTable`, `layerView`). Leave a one-line comment where the constant was: `// Query lives in modules/analysis/ops/nearest.ts, shared with the toolbar.`

- [ ] **Step 6: Register the ops**

In `apps/api/src/modules/analysis/ops/index.ts` add imports for `NearestInput, ProfileInput, ZonalInput`, `nearestOp`, `elevationProfileOp`, `zonalElevationOp`, and entries:

```ts
  nearest: { schema: NearestInput, run: nearestOp },
  elevation_profile: { schema: ProfileInput, run: elevationProfileOp },
  zonal_elevation: { schema: ZonalInput, run: zonalElevationOp },
```

- [ ] **Step 7: Route tests**

Append to `apps/api/src/modules/analysis/analysis.test.ts` (add `import { demAvailable } from './dem';`):

```ts
describe('POST /api/analysis/nearest', () => {
  it('returns k rows in ascending distance with connector lines', async () => {
    const res = await post('nearest', { lon: 108.05, lat: 12.68, layerKey: 'dams', k: 3 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(3);
    const d = body.rows.map((r: { distanceKm: number }) => r.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(body.geometries.filter((g: { role: string }) => g.role === 'result')).toHaveLength(3);
  });

  it('rejects k above 25', async () => {
    expect((await post('nearest', { lon: 108.05, lat: 12.68, layerKey: 'dams', k: 26 })).statusCode).toBe(400);
  });
});

describe('DEM operations', () => {
  const line = { type: 'LineString', coordinates: [[108.05, 12.68], [108.25, 12.68]] };

  it('elevation_profile samples along the line, or reports an unloaded DEM', async () => {
    const res = await post('elevation_profile', { geometry: line, samples: 50 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (!(await demAvailable(getPool()))) {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
      return;
    }
    expect(body.profile).toHaveLength(50);
    expect(body.summary['Chiều dài (km)']).toBeGreaterThan(21);
    expect(body.summary['Chiều dài (km)']).toBeLessThan(22.5);
    expect(body.summary['Cao nhất (m)']).toBeGreaterThan(body.summary['Thấp nhất (m)']);
    expect(body.attribution).toContain('FABDEM');
  });

  it('zonal_elevation summarises the DEM inside a polygon, or reports an unloaded DEM', async () => {
    const res = await post('zonal_elevation', { geometry: square(108.05, 12.68, 0.02) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (!(await demAvailable(getPool()))) {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
      return;
    }
    expect(body.summary['Trung bình (m)']).toBeGreaterThan(300);
    expect(body.summary['Trung bình (m)']).toBeLessThan(700);
    expect(body.summary['Số điểm ảnh']).toBeGreaterThan(1000);
  });

  it('zonal_elevation refuses an area over the cap', async () => {
    const res = await post('zonal_elevation', { geometry: square(108.0, 13.0, 0.5) });
    expect(res.statusCode).toBe(400);
  });
});
```

(Buôn Ma Thuột is ~472 m per the handover's verified `elevation_at_point` run; the 300–700 m bound tolerates the surrounding 4 km box.)

- [ ] **Step 8: Run tests**

Run: `npm run test -w @webatlas/api -- src/modules/analysis src/modules/assistant/tools/data`
Expected: PASS, including the pre-existing `nearest_features` tests in `data.test.ts` (unchanged behaviour).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/analysis apps/api/src/modules/assistant/tools/data/nearestFeatures.ts
git commit -m "feat(api): phân tích lân cận gần nhất, trắc diện và thống kê độ cao theo vùng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Web analysis model — API client, draw controller, last shape, tool rules, presenter, CSV

**Files:**
- Create: `apps/web/src/features/map/model/analysisDraw.ts`, `analysisDraw.test.ts`
- Create: `apps/web/src/features/map/model/lastShape.ts`
- Modify: `apps/web/src/features/map/model/useMeasure.ts` (record the drawn shape)
- Create: `apps/web/src/features/analysis/api/analysis.api.ts`
- Create: `apps/web/src/features/analysis/model/tools.ts`, `tools.test.ts`
- Create: `apps/web/src/features/analysis/model/csv.ts`, `csv.test.ts`
- Create: `apps/web/src/features/analysis/model/analysisResult.store.ts`
- Create: `apps/web/src/features/analysis/model/useAnalysis.ts`, `useAnalysis.test.ts`

**Interfaces:**
- Consumes: `POST /api/analysis/:op` (Tasks 10–11); `AnalysisOp`, `AnalysisResult`, `GeoJsonGeometry`, `MapCommand` (shared); `olGeometryTo4326GeoJSON` (`features/map/model/geo.ts`).
- Produces:
  - `type DrawKind = 'Point' | 'LineString' | 'Polygon'`; `startAnalysisDraw(map: Map, kind: DrawKind, onDone: (g: GeoJsonGeometry) => void): () => void`
  - `setLastShape(g: GeoJsonGeometry)`, `getLastShape(): GeoJsonGeometry | null`
  - `runAnalysis(op: AnalysisOp, input: object): Promise<AnalysisResult>`
  - `ANALYSIS_TOOL_LABELS: Record<AnalysisOp, string>`, `interface AnalysisParams { shape: DrawKind; radiusKm: number; layerKeys: EditableLayerKey[]; layerKey: EditableLayerKey; k: number; samples: number }`, `DEFAULT_PARAMS`, `drawKindFor(op, params): DrawKind`, `acceptsShape(op, params, g): boolean`, `buildInput(op, params, g): object`
  - `resultToCsv(r: AnalysisResult): string`, `downloadCsv(r: AnalysisResult, filename: string): void`
  - `setAnalysisResult(r: AnalysisResult | null)`, `getAnalysisResult()`, `useAnalysisResult(): AnalysisResult | null`
  - `useAnalysis(deps: { startDraw: (kind: DrawKind, onDone: (g: GeoJsonGeometry) => void) => () => void; run: (cmd: MapCommand) => unknown; getLastShape: () => GeoJsonGeometry | null; fetchResult?: typeof runAnalysis })` → `{ active, params, status: 'idle'|'params'|'drawing'|'running', result, error, open(op), setParams(patch), draw(), useLastShape(), cancel(), clear(), exportCsv() }`

- [ ] **Step 1: Tool-rule tests**

`apps/web/src/features/analysis/model/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { DEFAULT_PARAMS, acceptsShape, buildInput, drawKindFor } from './tools';

const point: GeoJsonGeometry = { type: 'Point', coordinates: [108.05, 12.68] };
const line: GeoJsonGeometry = { type: 'LineString', coordinates: [[108, 12], [108.1, 12.1]] };
const poly: GeoJsonGeometry = { type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] };

describe('analysis tool rules', () => {
  it('picks the draw kind per operation', () => {
    expect(drawKindFor('buffer', { ...DEFAULT_PARAMS, shape: 'LineString' })).toBe('LineString');
    expect(drawKindFor('select_within', DEFAULT_PARAMS)).toBe('Polygon');
    expect(drawKindFor('nearest', DEFAULT_PARAMS)).toBe('Point');
    expect(drawKindFor('elevation_profile', DEFAULT_PARAMS)).toBe('LineString');
    expect(drawKindFor('zonal_elevation', DEFAULT_PARAMS)).toBe('Polygon');
  });

  it('accepts a reused shape only when it fits the operation', () => {
    expect(acceptsShape('buffer', DEFAULT_PARAMS, line)).toBe(true);
    expect(acceptsShape('select_within', DEFAULT_PARAMS, line)).toBe(false);
    expect(acceptsShape('zonal_elevation', DEFAULT_PARAMS, poly)).toBe(true);
    expect(acceptsShape('nearest', DEFAULT_PARAMS, poly)).toBe(false);
  });

  it('builds the request body each route expects', () => {
    expect(buildInput('buffer', DEFAULT_PARAMS, point)).toEqual({ geometry: point, radiusKm: 5 });
    expect(buildInput('select_within', DEFAULT_PARAMS, poly)).toEqual({ geometry: poly, layerKeys: ['dams'] });
    expect(buildInput('nearest', DEFAULT_PARAMS, point)).toEqual({ lon: 108.05, lat: 12.68, layerKey: 'dams', k: 5 });
    expect(buildInput('elevation_profile', DEFAULT_PARAMS, line)).toEqual({ geometry: line, samples: 100 });
    expect(buildInput('zonal_elevation', DEFAULT_PARAMS, poly)).toEqual({ geometry: poly });
  });
});
```

Run: `npm run test -w @webatlas/web -- src/features/analysis/model/tools.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Tool rules**

`apps/web/src/features/analysis/model/tools.ts`:

```ts
import type { AnalysisOp, EditableLayerKey, GeoJsonGeometry } from '@webatlas/shared';
import type { DrawKind } from '../../map/model/analysisDraw';

export const ANALYSIS_TOOL_LABELS: Record<AnalysisOp, string> = {
  buffer: 'Vùng đệm',
  select_within: 'Chọn trong vùng',
  nearest: 'Gần nhất',
  elevation_profile: 'Trắc diện độ cao',
  zonal_elevation: 'Thống kê độ cao',
};

export interface AnalysisParams {
  /** Buffer only: what the user draws. */
  shape: DrawKind;
  radiusKm: number;
  layerKeys: EditableLayerKey[];
  layerKey: EditableLayerKey;
  k: number;
  samples: number;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  shape: 'Point', radiusKm: 5, layerKeys: ['dams'], layerKey: 'dams', k: 5, samples: 100,
};

export function drawKindFor(op: AnalysisOp, params: AnalysisParams): DrawKind {
  switch (op) {
    case 'buffer': return params.shape;
    case 'nearest': return 'Point';
    case 'elevation_profile': return 'LineString';
    case 'select_within':
    case 'zonal_elevation': return 'Polygon';
  }
}

const FAMILY: Record<DrawKind, GeoJsonGeometry['type'][]> = {
  Point: ['Point'],
  LineString: ['LineString', 'MultiLineString'],
  Polygon: ['Polygon', 'MultiPolygon'],
};

export function acceptsShape(op: AnalysisOp, params: AnalysisParams, g: GeoJsonGeometry): boolean {
  if (op === 'buffer') return true; // any shape can be buffered
  return FAMILY[drawKindFor(op, params)].includes(g.type);
}

export function buildInput(op: AnalysisOp, params: AnalysisParams, g: GeoJsonGeometry): object {
  switch (op) {
    case 'buffer': return { geometry: g, radiusKm: params.radiusKm };
    case 'select_within': return { geometry: g, layerKeys: params.layerKeys };
    case 'nearest': {
      const [lon, lat] = (g as { coordinates: number[] }).coordinates;
      return { lon, lat, layerKey: params.layerKey, k: params.k };
    }
    case 'elevation_profile': return { geometry: g, samples: params.samples };
    case 'zonal_elevation': return { geometry: g };
  }
}
```

- [ ] **Step 3: Draw controller, last shape, measure hook**

`apps/web/src/features/map/model/analysisDraw.ts`:

```ts
import type { Map } from 'ol';
import Draw from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON } from './geo';

export type DrawKind = 'Point' | 'LineString' | 'Polygon';

/**
 * One-shot draw for an analysis input. Returns a cleanup that removes the
 * interaction and its sketch layer; the caller runs it on completion or cancel.
 * The drawn shape is handed over in EPSG:4326 — the results layer redraws it as
 * an `input` geometry once the server answers.
 */
export function startAnalysisDraw(map: Map, kind: DrawKind, onDone: (g: GeoJsonGeometry) => void): () => void {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 997,
    style: {
      'stroke-color': '#1f2937', 'stroke-width': 2, 'stroke-line-dash': [8, 6],
      'fill-color': 'rgba(31, 41, 55, 0.05)', 'circle-radius': 6, 'circle-fill-color': '#1f2937',
    },
  });
  const draw = new Draw({ source, type: kind });
  draw.on('drawend', (e) => {
    const geometry = e.feature.getGeometry();
    if (geometry) onDone(olGeometryTo4326GeoJSON(geometry) as unknown as GeoJsonGeometry);
  });
  map.addLayer(layer);
  map.addInteraction(draw);
  return () => {
    map.removeInteraction(draw);
    map.removeLayer(layer);
  };
}
```

`apps/web/src/features/map/model/analysisDraw.test.ts` (reuses the `ResizeObserver` shim and `makeMap` from `DrawController.test.ts` — copy those lines):

```ts
import { describe, it, expect } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import Draw from 'ol/interaction/Draw';
import { fromLonLat } from 'ol/proj';
import { startAnalysisDraw } from './analysisDraw';

function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}

const draws = (map: Map) => map.getInteractions().getArray().filter((i) => i instanceof Draw);

describe('startAnalysisDraw', () => {
  it('adds one draw interaction and removes it on cleanup', () => {
    const map = makeMap();
    const layersBefore = map.getLayers().getLength();
    const stop = startAnalysisDraw(map, 'Polygon', () => {});
    expect(draws(map)).toHaveLength(1);
    expect(map.getLayers().getLength()).toBe(layersBefore + 1);
    stop();
    expect(draws(map)).toHaveLength(0);
    expect(map.getLayers().getLength()).toBe(layersBefore);
  });
});
```

`apps/web/src/features/map/model/lastShape.ts`:

```ts
import type { GeoJsonGeometry } from '@webatlas/shared';

/** The most recent shape the user drew (measure or analysis), in EPSG:4326, so the
 *  next analysis can reuse it — "đo một vùng rồi chọn các đập trong vùng đó". */
let last: GeoJsonGeometry | null = null;

export function setLastShape(g: GeoJsonGeometry): void { last = g; }
export function getLastShape(): GeoJsonGeometry | null { return last; }
```

In `apps/web/src/features/map/model/useMeasure.ts`: add imports `import { olGeometryTo4326GeoJSON } from './geo';`, `import { setLastShape } from './lastShape';`, `import type { GeoJsonGeometry } from '@webatlas/shared';`, and as the first statement after `if (!geom) return;` in the `drawend` handler:

```ts
        setLastShape(olGeometryTo4326GeoJSON(geom) as unknown as GeoJsonGeometry);
```

- [ ] **Step 4: CSV tests + implementation**

`apps/web/src/features/analysis/model/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AnalysisResult } from '@webatlas/shared';
import { resultToCsv } from './csv';

describe('resultToCsv', () => {
  it('starts with a BOM and writes summary, rows, profile and attribution', () => {
    const r: AnalysisResult = {
      op: 'nearest',
      summary: { 'Lớp': 'đập & hồ chứa', 'Gần nhất (km)': 1.5 },
      rows: [{ layerKey: 'dams', featureId: 'f1', name: 'Hồ "Ea Kao", Đắk Lắk', lon: 108.1, lat: 12.6, distanceKm: 1.5 }],
      profile: [{ distanceM: 0, elevationM: 470 }, { distanceM: 10, elevationM: null }],
      geometries: [],
      attribution: 'FABDEM',
    };
    const csv = resultToCsv(r);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Gần nhất (km),1.5');
    expect(csv).toContain('"Hồ ""Ea Kao"", Đắk Lắk"');
    expect(csv).toContain('10,');
    expect(csv.split('\r\n').at(-1)).toBe('FABDEM');
  });
});
```

`apps/web/src/features/analysis/model/csv.ts`:

```ts
import type { AnalysisResult } from '@webatlas/shared';

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 BOM first so Excel reads Vietnamese correctly; CRLF for the same reason. */
export function resultToCsv(r: AnalysisResult): string {
  const lines = ['﻿Mục,Giá trị', ...Object.entries(r.summary).map(([k, v]) => `${esc(k)},${esc(v)}`)];
  if (r.rows && r.rows.length > 0) {
    lines.push('', 'Lớp,Mã đối tượng,Tên,Kinh độ,Vĩ độ,Khoảng cách (km)');
    for (const row of r.rows) {
      lines.push([row.layerKey, row.featureId, row.name, row.lon, row.lat, row.distanceKm].map(esc).join(','));
    }
  }
  if (r.profile && r.profile.length > 0) {
    lines.push('', 'Khoảng cách (m),Độ cao (m)');
    for (const p of r.profile) lines.push(`${p.distanceM},${p.elevationM ?? ''}`);
  }
  if (r.attribution) lines.push('', esc(r.attribution));
  return lines.join('\r\n');
}

export function downloadCsv(r: AnalysisResult, filename: string): void {
  const url = URL.createObjectURL(new Blob([resultToCsv(r)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: API client and result store**

`apps/web/src/features/analysis/api/analysis.api.ts`:

```ts
import type { AnalysisOp, AnalysisResult } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export function runAnalysis(op: AnalysisOp, input: object): Promise<AnalysisResult> {
  return apiRequest<AnalysisResult>(`/api/analysis/${op}`, { method: 'POST', body: JSON.stringify(input) });
}
```

`apps/web/src/features/analysis/model/analysisResult.store.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { AnalysisResult } from '@webatlas/shared';

/** The result on screen, readable by the print page without prop-drilling through the shell. */
let current: AnalysisResult | null = null;
const listeners = new Set<() => void>();

export function setAnalysisResult(r: AnalysisResult | null): void {
  current = r;
  for (const l of listeners) l();
}
export function getAnalysisResult(): AnalysisResult | null { return current; }

function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useAnalysisResult(): AnalysisResult | null {
  return useSyncExternalStore(subscribe, getAnalysisResult, getAnalysisResult);
}
```

- [ ] **Step 6: Presenter tests**

`apps/web/src/features/analysis/model/useAnalysis.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AnalysisResult, GeoJsonGeometry } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useAnalysis } from './useAnalysis';
import { getAnalysisResult, setAnalysisResult } from './analysisResult.store';

const poly: GeoJsonGeometry = { type: 'Polygon', coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] };
const RESULT: AnalysisResult = {
  op: 'select_within', summary: { 'Tổng số': 2 }, rows: [],
  geometries: [{ geometry: poly, role: 'input' }],
};

function setup(lastShape: GeoJsonGeometry | null = null) {
  let finish: ((g: GeoJsonGeometry) => void) | null = null;
  const stop = vi.fn();
  const deps = {
    startDraw: vi.fn((_kind, onDone) => { finish = onDone; return stop; }),
    run: vi.fn(),
    getLastShape: () => lastShape,
    fetchResult: vi.fn().mockResolvedValue(RESULT),
  };
  const hook = renderHook(() => useAnalysis(deps));
  return { hook, deps, stop, finish: (g: GeoJsonGeometry) => finish!(g) };
}

beforeEach(() => setAnalysisResult(null));

describe('useAnalysis', () => {
  it('open → draw → result draws geometries, fits and publishes the result', async () => {
    const { hook, deps, stop, finish } = setup();
    act(() => hook.result.current.open('select_within'));
    expect(hook.result.current.status).toBe('params');
    act(() => hook.result.current.draw());
    expect(deps.startDraw).toHaveBeenCalledWith('Polygon', expect.any(Function));
    expect(hook.result.current.status).toBe('drawing');
    await act(async () => finish(poly));
    expect(stop).toHaveBeenCalled();
    expect(deps.fetchResult).toHaveBeenCalledWith('select_within', { geometry: poly, layerKeys: ['dams'] });
    expect(deps.run).toHaveBeenCalledWith({ kind: 'showGeometries', items: RESULT.geometries, fit: true });
    expect(hook.result.current.result).toBe(RESULT);
    expect(getAnalysisResult()).toBe(RESULT);
  });

  it('reuses the last drawn shape when it fits, and explains when it does not', async () => {
    const { hook, deps } = setup(poly);
    act(() => hook.result.current.open('nearest'));
    await act(async () => hook.result.current.useLastShape());
    expect(deps.fetchResult).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('Hình vừa vẽ không dùng được cho phép này — hãy vẽ mới.');
    act(() => hook.result.current.open('zonal_elevation'));
    await act(async () => hook.result.current.useLastShape());
    expect(deps.fetchResult).toHaveBeenCalledWith('zonal_elevation', { geometry: poly });
  });

  it('shows the API message on failure and returns to params', async () => {
    const { hook, deps, finish } = setup();
    deps.fetchResult.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Vùng quá lớn'));
    act(() => hook.result.current.open('zonal_elevation'));
    act(() => hook.result.current.draw());
    await act(async () => finish(poly));
    expect(hook.result.current.error).toBe('Vùng quá lớn');
    expect(hook.result.current.status).toBe('params');
  });

  it('clear removes drawn results and the published result', async () => {
    const { hook, deps, finish } = setup();
    act(() => hook.result.current.open('select_within'));
    act(() => hook.result.current.draw());
    await act(async () => finish(poly));
    act(() => hook.result.current.clear());
    expect(deps.run).toHaveBeenCalledWith({ kind: 'clearHighlights' });
    expect(hook.result.current.result).toBeNull();
    expect(getAnalysisResult()).toBeNull();
  });
});
```

Run: `npm run test -w @webatlas/web -- src/features/analysis/model/useAnalysis.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 7: Presenter**

`apps/web/src/features/analysis/model/useAnalysis.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisOp, AnalysisResult, GeoJsonGeometry, MapCommand } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import type { DrawKind } from '../../map/model/analysisDraw';
import { setLastShape } from '../../map/model/lastShape';
import { runAnalysis } from '../api/analysis.api';
import { DEFAULT_PARAMS, acceptsShape, buildInput, drawKindFor, ANALYSIS_TOOL_LABELS, type AnalysisParams } from './tools';
import { downloadCsv } from './csv';
import { setAnalysisResult } from './analysisResult.store';

export interface UseAnalysisDeps {
  startDraw: (kind: DrawKind, onDone: (g: GeoJsonGeometry) => void) => () => void;
  run: (cmd: MapCommand) => unknown;
  getLastShape: () => GeoJsonGeometry | null;
  fetchResult?: typeof runAnalysis;
}

export type AnalysisStatus = 'idle' | 'params' | 'drawing' | 'running';

export function useAnalysis({ startDraw, run, getLastShape, fetchResult = runAnalysis }: UseAnalysisDeps) {
  const [active, setActive] = useState<AnalysisOp | null>(null);
  const [params, setParamsState] = useState<AnalysisParams>(DEFAULT_PARAMS);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopDraw = useRef<(() => void) | null>(null);

  const endDraw = useCallback(() => {
    stopDraw.current?.();
    stopDraw.current = null;
  }, []);
  useEffect(() => endDraw, [endDraw]);

  const execute = useCallback(
    async (op: AnalysisOp, p: AnalysisParams, g: GeoJsonGeometry) => {
      setStatus('running');
      setError(null);
      setLastShape(g);
      try {
        const r = await fetchResult(op, buildInput(op, p, g));
        if (r.geometries.length > 0) run({ kind: 'showGeometries', items: r.geometries, fit: true });
        setResult(r);
        setAnalysisResult(r);
        setStatus('idle');
        setActive(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Không chạy được phép phân tích.');
        setStatus('params');
      }
    },
    [fetchResult, run]
  );

  const open = useCallback((op: AnalysisOp) => {
    endDraw();
    setActive(op);
    setError(null);
    setStatus('params');
  }, [endDraw]);

  const setParams = useCallback((patch: Partial<AnalysisParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const draw = useCallback(() => {
    if (!active) return;
    endDraw();
    const op = active;
    const p = params;
    setStatus('drawing');
    stopDraw.current = startDraw(drawKindFor(op, p), (g) => {
      endDraw();
      void execute(op, p, g);
    });
  }, [active, params, startDraw, endDraw, execute]);

  const useLastShape = useCallback(async () => {
    if (!active) return;
    const g = getLastShape();
    if (!g || !acceptsShape(active, params, g)) {
      setError('Hình vừa vẽ không dùng được cho phép này — hãy vẽ mới.');
      return;
    }
    await execute(active, params, g);
  }, [active, params, getLastShape, execute]);

  const cancel = useCallback(() => {
    endDraw();
    setActive(null);
    setStatus('idle');
    setError(null);
  }, [endDraw]);

  const clear = useCallback(() => {
    run({ kind: 'clearHighlights' });
    setResult(null);
    setAnalysisResult(null);
  }, [run]);

  const exportCsv = useCallback(() => {
    if (result) downloadCsv(result, `phan-tich-${ANALYSIS_TOOL_LABELS[result.op]}.csv`);
  }, [result]);

  return { active, params, status, result, error, open, setParams, draw, useLastShape, cancel, clear, exportCsv };
}
```

- [ ] **Step 8: Run tests + type-check**

Run: `npm run test -w @webatlas/web -- src/features/analysis src/features/map/model/analysisDraw.test.ts src/features/map/model` then `npm run build:web`
Expected: PASS. (`useLastShape` is a callback, not a React hook; if oxlint's rules-of-hooks flags the `use` prefix, rename it `reuseLastShape` everywhere including the tests.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/analysis apps/web/src/features/map/model/analysisDraw.ts apps/web/src/features/map/model/analysisDraw.test.ts apps/web/src/features/map/model/lastShape.ts apps/web/src/features/map/model/useMeasure.ts
git commit -m "feat(web): mô hình phân tích — vẽ đầu vào, gọi API, xuất CSV

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Web analysis UI — toolbar group, parameters, result card, profile chart

**Files:**
- Create: `apps/web/src/features/analysis/ui/AnalysisButtons.view.tsx`
- Create: `apps/web/src/features/analysis/ui/AnalysisParams.view.tsx`
- Create: `apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx`, `AnalysisResultCard.view.test.tsx`
- Create: `apps/web/src/features/analysis/ui/ProfileChart.view.tsx`, `ProfileChart.view.test.tsx`
- Create: `apps/web/src/features/analysis/index.tsx` — `useAnalysisTools()`
- Modify: `apps/web/src/features/map/ui/MapToolbar.tsx` (slots), `MapToolbar.test.tsx`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: Task 12 presenter and rules; `createCommandExecutor`, `startAnalysisDraw`, `getLastShape`.
- Produces: `useAnalysisTools(): { buttons: ReactNode; panel: ReactNode }`; `MapToolbarView`/`MapToolbar` props `analysisButtons?: ReactNode`, `analysisPanel?: ReactNode`.

- [ ] **Step 1: View tests**

`apps/web/src/features/analysis/ui/ProfileChart.view.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProfileChartView } from './ProfileChart.view';

describe('ProfileChartView', () => {
  it('draws one polyline point per sample with data and labels the range', () => {
    const { container, getByText } = render(
      <ProfileChartView profile={[
        { distanceM: 0, elevationM: 400 }, { distanceM: 500, elevationM: null }, { distanceM: 1000, elevationM: 520 },
      ]} />
    );
    const points = container.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(2);
    expect(getByText('520 m')).toBeInTheDocument();
    expect(getByText('400 m')).toBeInTheDocument();
    expect(getByText('1 km')).toBeInTheDocument();
  });

  it('renders nothing without data', () => {
    const { container } = render(<ProfileChartView profile={[{ distanceM: 0, elevationM: null }]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
```

`apps/web/src/features/analysis/ui/AnalysisResultCard.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AnalysisResult } from '@webatlas/shared';
import { AnalysisResultCardView } from './AnalysisResultCard.view';

const R: AnalysisResult = {
  op: 'select_within',
  summary: { 'Tổng số': 30, 'đập & hồ chứa': 30 },
  rows: [{ layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh', lon: 108.99, lat: 12.93 }],
  geometries: [],
  truncated: true,
  attribution: 'FABDEM',
};

describe('AnalysisResultCardView', () => {
  it('shows title, summary, rows, truncation note and attribution', () => {
    render(<AnalysisResultCardView result={R} onRow={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('Chọn trong vùng')).toBeInTheDocument();
    expect(screen.getByText('Tổng số')).toBeInTheDocument();
    expect(screen.getByText('Sông Hinh')).toBeInTheDocument();
    expect(screen.getByText('Chỉ hiển thị một phần kết quả trên bản đồ.')).toBeInTheDocument();
    expect(screen.getByText('FABDEM')).toBeInTheDocument();
  });

  it('wires row click, export and clear', () => {
    const onRow = vi.fn(); const onExport = vi.fn(); const onClear = vi.fn();
    render(<AnalysisResultCardView result={R} onRow={onRow} onExport={onExport} onClear={onClear} />);
    fireEvent.click(screen.getByText('Sông Hinh'));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá kết quả' }));
    expect(onRow).toHaveBeenCalledWith(R.rows![0]);
    expect(onExport).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });
});
```

Run: `npm run test -w @webatlas/web -- src/features/analysis/ui` — Expected: FAIL (modules not found).

- [ ] **Step 2: Profile chart**

`apps/web/src/features/analysis/ui/ProfileChart.view.tsx`:

```tsx
import type { ProfileSample } from '@webatlas/shared';

const W = 280;
const H = 110;
const PAD = 4;

/** Hand-drawn SVG: one line, min/max labels, total length. No chart library for one chart. */
export function ProfileChartView({ profile }: { profile: ProfileSample[] }) {
  const pts = profile.filter((p): p is { distanceM: number; elevationM: number } => p.elevationM !== null);
  if (pts.length < 2) return null;
  const maxD = profile[profile.length - 1].distanceM || 1;
  const minE = Math.min(...pts.map((p) => p.elevationM));
  const maxE = Math.max(...pts.map((p) => p.elevationM));
  const spanE = maxE - minE || 1;
  const x = (d: number) => PAD + (d / maxD) * (W - 2 * PAD);
  const y = (e: number) => H - PAD - ((e - minE) / spanE) * (H - 2 * PAD);
  const km = Math.round(maxD / 100) / 10;

  return (
    <figure className="profile-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Trắc diện độ cao">
        <polyline
          fill="none" stroke="#1d4ed8" strokeWidth={2}
          points={pts.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join(' ')}
        />
      </svg>
      <figcaption className="profile-chart-axis">
        <span>{Math.round(maxE)} m</span>
        <span>{Math.round(minE)} m</span>
        <span>{km} km</span>
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 3: Result card**

`apps/web/src/features/analysis/ui/AnalysisResultCard.view.tsx`:

```tsx
import type { AnalysisResult, AnalysisRow } from '@webatlas/shared';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import { ProfileChartView } from './ProfileChart.view';

export interface AnalysisResultCardViewProps {
  result: AnalysisResult;
  onRow: (row: AnalysisRow) => void;
  onExport: () => void;
  onClear: () => void;
}

export function AnalysisResultCardView({ result, onRow, onExport, onClear }: AnalysisResultCardViewProps) {
  return (
    <section className="analysis-card glass-panel" aria-label="Kết quả phân tích">
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[result.op]}</h3>
      <table className="analysis-summary">
        <tbody>
          {Object.entries(result.summary).map(([k, v]) => (
            <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
      {result.profile && <ProfileChartView profile={result.profile} />}
      {result.rows && result.rows.length > 0 && (
        <ul className="analysis-rows">
          {result.rows.map((row, i) => (
            <li key={row.featureId ?? i}>
              <button type="button" className="analysis-row" onClick={() => onRow(row)}>
                {row.name ?? '(không tên)'}
                {row.distanceKm !== undefined && <span className="analysis-row-meta"> · {row.distanceKm} km</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result.truncated && <p className="analysis-note">Chỉ hiển thị một phần kết quả trên bản đồ.</p>}
      {result.attribution && <p className="analysis-attribution">{result.attribution}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onExport}>Xuất CSV</button>
        <button type="button" onClick={onClear}>Xoá kết quả</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Buttons and parameters**

`apps/web/src/features/analysis/ui/AnalysisButtons.view.tsx`:

```tsx
import type { ReactNode } from 'react';
import { CircleDashed, SquareDashed, LocateFixed, TrendingUp, Sigma } from 'lucide-react';
import { ANALYSIS_OPS, type AnalysisOp } from '@webatlas/shared';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';

const ICONS: Record<AnalysisOp, ReactNode> = {
  buffer: <CircleDashed size={18} />,
  select_within: <SquareDashed size={18} />,
  nearest: <LocateFixed size={18} />,
  elevation_profile: <TrendingUp size={18} />,
  zonal_elevation: <Sigma size={18} />,
};

export function AnalysisButtonsView({ active, onOpen }: { active: AnalysisOp | null; onOpen: (op: AnalysisOp) => void }) {
  return (
    <div className="control-group" role="group" aria-label="Phân tích">
      {ANALYSIS_OPS.map((op) => (
        <button
          key={op}
          type="button"
          className={`control-btn ${active === op ? 'active' : ''}`}
          aria-pressed={active === op}
          onClick={() => onOpen(op)}
          title={ANALYSIS_TOOL_LABELS[op]}
          aria-label={ANALYSIS_TOOL_LABELS[op]}
        >
          {ICONS[op]}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/features/analysis/ui/AnalysisParams.view.tsx`:

```tsx
import { EDITABLE_LAYER_KEYS, type AnalysisOp, type EditableLayerKey } from '@webatlas/shared';
import type { AnalysisParams } from '../model/tools';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import type { AnalysisStatus } from '../model/useAnalysis';

const LAYER_NAMES: Record<EditableLayerKey, string> = {
  dams: 'Đập & hồ chứa', rivers: 'Sông ngòi', lakes: 'Hồ', stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt', drought_points: 'Điểm hạn hán', saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};

const HINT: Record<AnalysisOp, string> = {
  buffer: 'Vẽ hình rồi hệ thống tạo vùng đệm theo bán kính.',
  select_within: 'Vẽ một vùng để đếm và tô sáng các đối tượng nằm trong.',
  nearest: 'Chấm một điểm để tìm các đối tượng gần nhất.',
  elevation_profile: 'Vẽ một tuyến để xem trắc diện độ cao.',
  zonal_elevation: 'Vẽ một vùng (tối đa 5.000 km²) để thống kê độ cao.',
};

export interface AnalysisParamsViewProps {
  op: AnalysisOp;
  params: AnalysisParams;
  status: AnalysisStatus;
  error: string | null;
  onParams: (patch: Partial<AnalysisParams>) => void;
  onDraw: () => void;
  onUseLast: () => void;
  onCancel: () => void;
}

export function AnalysisParamsView({ op, params, status, error, onParams, onDraw, onUseLast, onCancel }: AnalysisParamsViewProps) {
  const busy = status === 'running';
  return (
    <section className="analysis-card glass-panel" aria-label={ANALYSIS_TOOL_LABELS[op]}>
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[op]}</h3>
      <p className="analysis-note">{status === 'drawing' ? 'Đang vẽ — nháy đúp để kết thúc.' : HINT[op]}</p>

      {op === 'buffer' && (
        <>
          <label>Hình vẽ
            <select value={params.shape} onChange={(e) => onParams({ shape: e.target.value as AnalysisParams['shape'] })}>
              <option value="Point">Điểm</option><option value="LineString">Đường</option><option value="Polygon">Vùng</option>
            </select>
          </label>
          <label>Bán kính (km)
            <input type="number" min={0.1} max={100} step={0.1} value={params.radiusKm}
              onChange={(e) => onParams({ radiusKm: Number(e.target.value) })} />
          </label>
        </>
      )}
      {op === 'select_within' && (
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
      {op === 'nearest' && (
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

      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onDraw} disabled={busy || (op === 'select_within' && params.layerKeys.length === 0)}>
          {busy ? 'Đang tính…' : 'Vẽ trên bản đồ'}
        </button>
        <button type="button" onClick={onUseLast} disabled={busy}>Dùng hình vừa vẽ</button>
        <button type="button" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Container hook**

`apps/web/src/features/analysis/index.tsx`:

```tsx
import { useCallback, useMemo, type ReactNode } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { createCommandExecutor } from '../map/model/mapCommands';
import { startAnalysisDraw } from '../map/model/analysisDraw';
import { getLastShape } from '../map/model/lastShape';
import { useAnalysis } from './model/useAnalysis';
import { AnalysisButtonsView } from './ui/AnalysisButtons.view';
import { AnalysisParamsView } from './ui/AnalysisParams.view';
import { AnalysisResultCardView } from './ui/AnalysisResultCard.view';

/**
 * Returns the toolbar buttons and the panel above the toolbar as two nodes sharing
 * one presenter — the toolbar renders them in different places.
 */
export function useAnalysisTools(): { buttons: ReactNode; panel: ReactNode } {
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();
  const run = useMemo(
    () => createCommandExecutor({
      map, setBasemap, toggleLayerVisibility, setLayerOpacity,
      getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
      layerExists: (id) => layersState.some((l) => l.id === id),
    }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState]
  );
  const startDraw = useCallback<Parameters<typeof useAnalysis>[0]['startDraw']>(
    (kind, onDone) => (map ? startAnalysisDraw(map, kind, onDone) : () => {}),
    [map]
  );
  const a = useAnalysis({ startDraw, run, getLastShape });

  const buttons = <AnalysisButtonsView active={a.active} onOpen={a.open} />;
  const panel = a.active ? (
    <AnalysisParamsView
      op={a.active} params={a.params} status={a.status} error={a.error}
      onParams={a.setParams} onDraw={a.draw} onUseLast={a.useLastShape} onCancel={a.cancel}
    />
  ) : a.result ? (
    <AnalysisResultCardView
      result={a.result}
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

- [ ] **Step 6: Toolbar slots + composition**

In `apps/web/src/features/map/ui/MapToolbar.tsx`:
- `import React, { useMemo, type ReactNode } from 'react';`
- add to `MapToolbarViewProps`: `analysisButtons?: ReactNode;` and `analysisPanel?: ReactNode;`
- destructure them in `MapToolbarView`
- render `{analysisPanel}` directly after the `measureValue` line (above the rail)
- inside `.toolbar-rail`, directly after the measure `control-group` `</div>`, render:

```tsx
        {analysisButtons && (
          <>
            <div className="control-divider" />
            {analysisButtons}
          </>
        )}
```

- change the container signature to `export default function MapToolbar({ flyoutOpen, analysisButtons, analysisPanel }: { flyoutOpen: boolean; analysisButtons?: ReactNode; analysisPanel?: ReactNode })` and pass both through to `MapToolbarView`.

Append to `apps/web/src/features/map/ui/MapToolbar.test.tsx` (use the file's existing view-props fixture, here called `baseProps`; rename to match):

```tsx
  it('renders the analysis slots when provided', () => {
    render(<MapToolbarView {...baseProps} analysisButtons={<button>Vùng đệm</button>} analysisPanel={<p>panel</p>} />);
    expect(screen.getByRole('button', { name: 'Vùng đệm' })).toBeInTheDocument();
    expect(screen.getByText('panel')).toBeInTheDocument();
  });
```

In `apps/web/src/app/App.tsx` inside `RailAndFlyout`: `import { useAnalysisTools } from '../features/analysis';`, call `const analysis = useAnalysisTools();` at the top of the component, and render `<MapToolbar flyoutOpen={rail.active !== null} analysisButtons={analysis.buttons} analysisPanel={analysis.panel} />`.

Append to `apps/web/src/styles/main.css`:

```css
/* Phân tích không gian */
.analysis-card { max-width: 340px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.analysis-card label { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.analysis-card-title { margin: 0; font-size: 14px; font-weight: 600; }
.analysis-summary { border-collapse: collapse; width: 100%; }
.analysis-summary th { text-align: left; font-weight: 500; padding: 2px 8px 2px 0; }
.analysis-summary td { text-align: right; font-variant-numeric: tabular-nums; }
.analysis-rows { list-style: none; margin: 0; padding: 0; max-height: 140px; overflow-y: auto; }
.analysis-row { background: none; border: none; padding: 2px 0; cursor: pointer; text-align: left; color: var(--primary); }
.analysis-row-meta { color: var(--text-muted, #6b7280); }
.analysis-note, .analysis-attribution { margin: 0; font-size: 12px; color: var(--text-muted, #6b7280); }
.analysis-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.analysis-layers { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; border: none; padding: 0; margin: 0; }
.analysis-layers label { justify-content: flex-start; }
.profile-chart { margin: 0; }
.profile-chart-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted, #6b7280); }
```

- [ ] **Step 7: Run tests, type-check, lint**

Run: `npm run test -w @webatlas/web -- src/features/analysis src/features/map/ui src/app` then `npm run build:web` then `npm run lint:web`
Expected: PASS; build succeeds; lint exits 0.

- [ ] **Step 8: Browser check (jsdom cannot prove reachability)**

Start `npm run dev -w @webatlas/api` and `npm run dev:web` with `run_in_background`, then drive with puppeteer-core per the dev-run recipe: click `button[title="Chọn trong vùng"]`, click "Vẽ trên bản đồ", draw a polygon (3 clicks + double-click) around Buôn Ma Thuột, wait for tile traffic to settle, screenshot. Confirm: the pill wraps rather than overflowing at 768 px width with the flyout open; the card sits above the toolbar and does not cover the zoom controls; highlighted dams appear. Record anything wrong and fix before committing.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/analysis apps/web/src/features/map/ui/MapToolbar.tsx apps/web/src/features/map/ui/MapToolbar.test.tsx apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): nhóm công cụ phân tích trên thanh công cụ, thẻ kết quả và trắc diện

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Assistant analysis tools — results drawn on the map

**Files:**
- Create: `apps/api/src/modules/assistant/tools/data/analysisTool.ts` — shared runner
- Create: `apps/api/src/modules/assistant/tools/data/bufferFeature.ts`, `selectWithin.ts`, `elevationProfile.ts`, `zonalElevation.ts`
- Create: `apps/api/src/modules/assistant/tools/data/analysisTools.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/data/nearestFeatures.ts` (collect connector geometry)
- Modify: `apps/api/src/modules/assistant/tools/data/data.test.ts` (assert the connector command)
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`

**Interfaces:**
- Consumes: `withAnalysisTimeout` (Task 10), `bufferOp`, `selectWithinOp`, `elevationProfileOp`, `zonalElevationOp`, `nearestGeometries` (Tasks 10–11), `ZonalInput`.
- Produces:
  - `runAnalysisTool(ctx: ToolContext, tool: string, layerKey: EditableLayerKey | null, run: (db: Queryable) => Promise<AnalysisResult>): Promise<string>` — emits provenance on every path, collects `showGeometries` (fit) when there are geometries, maps NotFound → `Không có dữ liệu: …`, validation/timeout → `Không thực hiện được: …`, unloaded DEM → `Không có dữ liệu: …`, otherwise returns JSON `{ summary, rows?, truncated? }` (never the full profile)
  - tools `buffer_feature {layerKey, featureId, radiusKm}`, `select_within {layerKeys[], area: {layerKey, featureId, radiusKm?}}`, `elevation_profile {layerKey, featureId, samples?}`, `zonal_elevation {layerKey, featureId, radiusKm?}`, appended to `FACTORIES` in that order

- [ ] **Step 1: Write failing tests (live DB)**

`apps/api/src/modules/assistant/tools/data/analysisTools.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { isMapCommand, type MapCommand, type MapContext, type Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { bufferFeatureTool } from './bufferFeature';
import { selectWithinTool } from './selectWithin';
import { elevationProfileTool } from './elevationProfile';
import { zonalElevationTool } from './zonalElevation';

let pool: Pool;
let damId: string;
let riverId: string;
beforeAll(async () => {
  pool = getPool();
  ({ rows: [{ id: damId }] } = await pool.query(`SELECT id::text FROM water.dams_active WHERE geom IS NOT NULL LIMIT 1`));
  ({ rows: [{ id: riverId }] } = await pool.query(`SELECT id::text FROM water.rivers_active ORDER BY length_m DESC NULLS LAST LIMIT 1`));
});
afterAll(async () => { await closePool(); });

const MAP_CONTEXT: MapContext = { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' };

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool, role: 'viewer', mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}
const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('analysis tools', () => {
  it('buffer_feature draws the buffer and reports its area', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(bufferFeatureTool(ctx), { layerKey: 'rivers', featureId: riverId, radiusKm: 2 });
    expect(JSON.parse(text).summary['Diện tích vùng đệm (km²)']).toBeGreaterThan(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: 'showGeometries', fit: true });
    expect(commands.every(isMapCommand)).toBe(true);
    expect(records[0]).toMatchObject({ tool: 'buffer_feature', layerKey: 'rivers' });
  });

  it('select_within counts dams within 10 km of a dam (at least itself)', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(selectWithinTool(ctx), {
      layerKeys: ['dams'], area: { layerKey: 'dams', featureId: damId, radiusKm: 10 },
    });
    expect(JSON.parse(text).summary['Tổng số']).toBeGreaterThanOrEqual(1);
    expect(commands[0]).toMatchObject({ kind: 'showGeometries' });
  });

  it('refuses a point area without a radius, with provenance and no command', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(zonalElevationTool(ctx), { layerKey: 'dams', featureId: damId });
    expect(text.startsWith('Không thực hiện được:')).toBe(true);
    expect(commands).toEqual([]);
    expect(records).toHaveLength(1);
  });

  it('reports no data for an unknown feature', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(bufferFeatureTool(ctx), {
      layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000', radiusKm: 1,
    });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records[0].rowCount).toBe(0);
  });

  it('elevation_profile answers with a summary, never the full sample array', async () => {
    const { ctx } = makeCtx();
    const text = await run(elevationProfileTool(ctx), { layerKey: 'rivers', featureId: riverId });
    if (text.startsWith('Không có dữ liệu:')) return; // DEM not loaded on this box
    const parsed = JSON.parse(text);
    expect(parsed.summary['Chiều dài (km)']).toBeGreaterThan(0);
    expect(parsed).not.toHaveProperty('profile');
  });
});
```

In `data.test.ts`, inside the existing `nearest_features` happy-path test, add after the tool call:

```ts
    expect(commands.some((c) => c.kind === 'showGeometries')).toBe(true);
```

(`commands` comes from that file's `makeCtx()`; destructure it if the test does not already.)

Run: `npm run test -w @webatlas/api -- src/modules/assistant/tools/data/analysisTools.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 2: Shared runner**

`apps/api/src/modules/assistant/tools/data/analysisTool.ts`:

```ts
import { isMapCommand, type AnalysisResult, type EditableLayerKey } from '@webatlas/shared';
import { AppError, NotFoundError, ValidationError } from '../../../../errors';
import { withAnalysisTimeout } from '../../../analysis/db';
import type { ToolContext } from '../types';
import { activeVersionLabel, type Queryable } from './helpers';

/**
 * The assistant face of modules/analysis: same ops as the toolbar, results drawn
 * the same way. Returns the summary only — geometry goes to the map through the
 * command, never through the model, and a 100-sample profile would be pure token cost.
 */
export async function runAnalysisTool(
  ctx: ToolContext,
  tool: string,
  layerKey: EditableLayerKey | null,
  run: (db: Queryable) => Promise<AnalysisResult>
): Promise<string> {
  const datasetVersion = layerKey ? await activeVersionLabel(ctx.pool, layerKey) : null;
  let result: AnalysisResult;
  try {
    result = await withAnalysisTimeout(ctx.pool, run);
  } catch (e) {
    ctx.provenance({ tool, layerKey, rowCount: 0, datasetVersion });
    if (e instanceof NotFoundError) return 'Không có dữ liệu: không tìm thấy đối tượng.';
    if (e instanceof ValidationError || (e instanceof AppError && e.code === 'ANALYSIS_TIMEOUT')) {
      return `Không thực hiện được: ${e.message}`;
    }
    throw e;
  }

  const total = result.summary['Tổng số'];
  const rowCount = typeof total === 'number' ? total : (result.rows?.length ?? 1);
  ctx.provenance({ tool, layerKey, rowCount, datasetVersion });

  const status = result.summary['Trạng thái'];
  if (status === 'Chưa nạp dữ liệu độ cao') {
    return 'Không có dữ liệu: máy chủ này chưa nạp dữ liệu độ cao (DEM).';
  }

  if (result.geometries.length > 0) {
    const command = { kind: 'showGeometries' as const, items: result.geometries, fit: true };
    if (isMapCommand(command)) ctx.collect(command);
  }
  return JSON.stringify({
    summary: result.summary,
    ...(result.rows ? { rows: result.rows } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  });
}
```

- [ ] **Step 3: The four tools**

`apps/api/src/modules/assistant/tools/data/bufferFeature.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { bufferOp } from '../../../analysis/ops/buffer';
import { runAnalysisTool } from './analysisTool';

export const bufferFeatureTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'buffer_feature',
    description:
      'Draw a buffer zone (vùng đệm / hành lang) of radiusKm around one feature on the map and report its area. featureId must come from a data tool.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      radiusKm: z.number().gt(0).max(100),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'buffer_feature', input.layerKey, (db) =>
        bufferOp(db, { feature: { layerKey: input.layerKey, featureId: input.featureId }, radiusKm: input.radiusKm })
      ),
  });
```

`apps/api/src/modules/assistant/tools/data/selectWithin.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { selectWithinOp } from '../../../analysis/ops/selectWithin';
import { runAnalysisTool } from './analysisTool';

export const selectWithinTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'select_within',
    description:
      'Count and highlight features of one or more layers inside an area. The area is a polygon feature (lake, flood zone) used as-is, or any feature buffered by radiusKm (e.g. dams within 10 km of a river). A point or line feature needs radiusKm. Use for "trong phạm vi", "nằm trong", "dọc theo sông".',
    inputSchema: z.object({
      layerKeys: z.array(z.enum(EDITABLE_LAYER_KEYS)).min(1).max(EDITABLE_LAYER_KEYS.length),
      area: z.object({
        layerKey: z.enum(EDITABLE_LAYER_KEYS),
        featureId: z.string(),
        radiusKm: z.number().gt(0).max(100).optional(),
      }),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'select_within', input.layerKeys.length === 1 ? input.layerKeys[0] : null, (db) =>
        selectWithinOp(db, {
          feature: { layerKey: input.area.layerKey, featureId: input.area.featureId },
          ...(input.area.radiusKm !== undefined ? { bufferKm: input.area.radiusKm } : {}),
          layerKeys: input.layerKeys,
        })
      ),
  });
```

`apps/api/src/modules/assistant/tools/data/elevationProfile.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { elevationProfileOp } from '../../../analysis/ops/elevationProfile';
import { runAnalysisTool } from './analysisTool';

export const elevationProfileTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'elevation_profile',
    description:
      'Elevation profile along a line feature (usually a river): length, lowest/highest point, total rise and fall, mean gradient. Bare-earth DEM (FABDEM). featureId must come from a data tool.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      samples: z.number().int().min(2).max(200).default(100),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'elevation_profile', input.layerKey, (db) =>
        elevationProfileOp(db, { feature: { layerKey: input.layerKey, featureId: input.featureId }, samples: input.samples })
      ),
  });
```

`apps/api/src/modules/assistant/tools/data/zonalElevation.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { zonalElevationOp } from '../../../analysis/ops/zonalElevation';
import type { ZonalInput } from '../../../analysis/schemas';
import { runAnalysisTool } from './analysisTool';

export const zonalElevationTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zonal_elevation',
    description:
      'Lowest, highest and mean ground elevation inside an area: a polygon feature, or any feature buffered by radiusKm (a point or line needs radiusKm). Max 5,000 km².',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      radiusKm: z.number().gt(0).max(100).optional(),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'zonal_elevation', input.layerKey, (db) =>
        // areaGeometry reads bufferKm; ZonalInput's HTTP schema simply does not offer it.
        zonalElevationOp(db, {
          feature: { layerKey: input.layerKey, featureId: input.featureId },
          ...(input.radiusKm !== undefined ? { bufferKm: input.radiusKm } : {}),
        } as ZonalInput)
      ),
  });
```

In `apps/api/src/modules/analysis/ops/zonalElevation.ts` change the call to `areaGeometry(db, input as ZonalInput & { bufferKm?: number })` so the buffer passes through.

- [ ] **Step 4: Nearest connectors**

In `nearestFeatures.ts`, import `capResultItems, isMapCommand` from `@webatlas/shared` and `nearestGeometries` from `'../../../analysis/ops/nearest'`; after `ctx.provenance(...)` and the empty-result return, before the final `return JSON.stringify(...)`, add:

```ts
      const connectors = { kind: 'showGeometries' as const, fit: true,
        items: capResultItems(nearestGeometries(input.layerKey, input.lon, input.lat, rows)).items };
      if (isMapCommand(connectors)) ctx.collect(connectors);
```

- [ ] **Step 5: Register**

In `registry.ts` import the four factories and append after `elevationAtPointTool,`:

```ts
  // Analysis tools (2026-09-17): thin wrappers over modules/analysis, the same
  // ops the toolbar calls. Appended, never inserted.
  bufferFeatureTool,
  selectWithinTool,
  elevationProfileTool,
  zonalElevationTool,
```

- [ ] **Step 6: Run the assistant suite**

Run: `npm run test -w @webatlas/api -- src/modules/assistant src/modules/analysis`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/assistant/tools apps/api/src/modules/analysis/ops/zonalElevation.ts
git commit -m "feat(assistant): công cụ vùng đệm, chọn trong vùng, trắc diện, thống kê độ cao vẽ kết quả lên bản đồ

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Print and export

**Files:**
- Modify: `apps/web/src/features/map/model/MapModel.ts` (`crossOrigin` on verified tile sources)
- Create: `apps/web/src/features/map/model/exportMap.ts`, `exportMap.test.ts`
- Create: `apps/web/src/pages/print/model/usePrintPage.ts`, `usePrintPage.test.ts`
- Create: `apps/web/src/pages/print/ui/PrintPage.view.tsx`, `PrintPage.view.test.tsx`
- Create: `apps/web/src/pages/print/index.tsx`
- Modify: `apps/web/src/app/App.tsx` (route), `apps/web/src/widgets/top-bar/index.tsx` (button), `apps/web/src/styles/main.css`
- Modify: `docs/superpowers/specs/2026-09-17-supervisor-feedback-map-operations-design.md` §5 risk line (see Step 1)

**Interfaces:**
- Consumes: `useAnalysisResult` (Task 12), `Legend` (features/legend), `LEGEND_ATTRIBUTION`, `REGION_NAME` (shared), `formatScale`, `scaleAtZoom` (zoomScale).
- Produces:
  - `cropRect(width: number, height: number, aspect: number): { x: number; y: number; w: number; h: number }`
  - `class ExportBlockedError extends Error`
  - `exportMapCanvas(map: Map, aspect: number): Promise<HTMLCanvasElement>`, `canvasToPngBlob(canvas): Promise<Blob>` (rejects with `ExportBlockedError` on a tainted canvas)
  - `PAPER_SIZES`, `type PaperId = 'A4-landscape' | 'A4-portrait' | 'A3-landscape' | 'A3-portrait'`
  - `BASEMAP_ATTRIBUTION: Record<BasemapName, string>`
  - `usePrintPage(deps: { map: Map | null; basemap: BasemapName; visibleLayerIds: string[]; crsLabel: string; exporter?: { exportMapCanvas; canvasToPngBlob } })`
  - route `/print`

- [ ] **Step 1: Verify CORS on every tile source (decides Step 2)**

Find each tile URL template in `MapModel.ts` (the GeoServer WMTS builder around line 70, the Esri `World_Imagery` and `World_Hillshade` XYZ URLs around lines 513–520). For each, fill `{z}/{x}/{y}` with `8/203/120` (inside the region) and run:

```bash
curl -s -o /dev/null -D - -H "Origin: http://localhost:5173" "<tile url>" | grep -i "access-control-allow-origin"
```

Expected: GeoServer returns `access-control-allow-origin: *` (compose sets `CORS_ENABLED`/`CORS_ALLOWED_ORIGINS: "*"`); Esri `server.arcgisonline.com` normally returns `*`. Record the results in the commit message. **Rule:** add `crossOrigin: 'anonymous'` only to sources that returned the header. A source that did not must stay without it — setting `crossOrigin` on a server without CORS stops its tiles from loading at all, which is worse than a blocked export.

Then edit the spec §5 "Risk — tainted canvas" sentence to what is actually built: *"If a source cannot be exported, the preview says so and suggests switching basemap; PNG and print both use the composed image."* (print cannot fall back to the live DOM because the print sheet covers the map).

- [ ] **Step 2: Enable CORS tiles**

In `MapModel.ts`, add `crossOrigin: 'anonymous',` to each `new XYZ({ ... })` whose URL passed Step 1 (GeoServer WMTS builder at ~line 72, Esri imagery ~513, Esri hillshade ~519). Run `npm run test -w @webatlas/web -- src/features/map/model/MapModel.test.ts` — Expected: PASS.

- [ ] **Step 3: Export helper tests + implementation**

`apps/web/src/features/map/model/exportMap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cropRect, canvasToPngBlob, ExportBlockedError } from './exportMap';

describe('cropRect', () => {
  it('crops a wide viewport to a portrait aspect, centred', () => {
    expect(cropRect(1000, 500, 210 / 297)).toEqual({ x: 323, y: 0, w: 354, h: 500 });
  });
  it('crops a tall viewport to a landscape aspect, centred', () => {
    expect(cropRect(600, 1000, 297 / 210)).toEqual({ x: 0, y: 288, w: 600, h: 424 });
  });
});

describe('canvasToPngBlob', () => {
  it('turns a SecurityError into ExportBlockedError', async () => {
    const canvas = { toBlob: () => { throw new DOMException('tainted', 'SecurityError'); } } as unknown as HTMLCanvasElement;
    await expect(canvasToPngBlob(canvas)).rejects.toBeInstanceOf(ExportBlockedError);
  });
});
```

`apps/web/src/features/map/model/exportMap.ts`:

```ts
import type { Map } from 'ol';

export class ExportBlockedError extends Error {
  constructor() {
    super('Không xuất được ảnh do máy chủ bản đồ nền chặn. Hãy thử đổi bản đồ nền.');
    this.name = 'ExportBlockedError';
  }
}

/** Largest centred rectangle of `aspect` (w/h) inside width × height. */
export function cropRect(width: number, height: number, aspect: number) {
  let w = width;
  let h = Math.round(width / aspect);
  if (h > height) {
    h = height;
    w = Math.round(height * aspect);
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/**
 * Composites every OpenLayers layer canvas into one canvas cropped to the paper
 * aspect — the official OL "export map" technique, plus a crop. Waits for
 * `rendercomplete` so tiles still loading are not captured half-drawn.
 */
export function exportMapCanvas(map: Map, aspect: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    map.once('rendercomplete', () => {
      try {
        const size = map.getSize();
        if (!size) throw new Error('Bản đồ chưa sẵn sàng.');
        const crop = cropRect(size[0], size[1], aspect);
        const out = document.createElement('canvas');
        out.width = crop.w;
        out.height = crop.h;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('Trình duyệt không hỗ trợ xuất ảnh.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, crop.w, crop.h);
        map.getViewport().querySelectorAll<HTMLCanvasElement>('.ol-layer canvas, canvas.ol-layer').forEach((canvas) => {
          if (canvas.width === 0) return;
          const parent = canvas.parentElement as HTMLElement | null;
          const opacity = parent?.style.opacity || canvas.style.opacity;
          ctx.globalAlpha = opacity === '' || opacity === undefined ? 1 : Number(opacity);
          const m = canvas.style.transform.match(/^matrix\(([^(]*)\)$/);
          const matrix = m
            ? m[1].split(',').map(Number)
            : [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0];
          ctx.setTransform(1, 0, 0, 1, -crop.x, -crop.y);
          ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
          const bg = parent?.style.backgroundColor;
          if (bg) {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(canvas, 0, 0);
        });
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
    map.renderSync();
  });
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportBlockedError())), 'image/png');
    } catch (e) {
      reject(e instanceof DOMException && e.name === 'SecurityError' ? new ExportBlockedError() : e);
    }
  });
}
```

Run: `npm run test -w @webatlas/web -- src/features/map/model/exportMap.test.ts` — Expected: PASS.

- [ ] **Step 4: Print presenter test**

`apps/web/src/pages/print/model/usePrintPage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Map } from 'ol';
import { ExportBlockedError } from '../../../features/map/model/exportMap';
import { usePrintPage } from './usePrintPage';

const map = {} as Map;
beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:map');
  globalThis.URL.revokeObjectURL = vi.fn();
});

function deps(over = {}) {
  return {
    map, basemap: 'street' as const, visibleLayerIds: ['layer_dams', 'layer_contours'], crsLabel: 'WGS 84',
    exporter: {
      exportMapCanvas: vi.fn().mockResolvedValue({} as HTMLCanvasElement),
      canvasToPngBlob: vi.fn().mockResolvedValue(new Blob(['x'])),
    },
    ...over,
  };
}

describe('usePrintPage', () => {
  it('captures the map at the paper aspect on mount', async () => {
    const d = deps();
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.imageUrl).toBe('blob:map'));
    expect(d.exporter.exportMapCanvas).toHaveBeenCalledWith(map, 297 / 210);
  });

  it('recaptures when the orientation changes', async () => {
    const d = deps();
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.imageUrl).toBe('blob:map'));
    act(() => result.current.setPaper('A4-portrait'));
    await waitFor(() => expect(d.exporter.exportMapCanvas).toHaveBeenLastCalledWith(map, 210 / 297));
  });

  it('explains a blocked export', async () => {
    const d = deps();
    d.exporter.canvasToPngBlob.mockRejectedValue(new ExportBlockedError());
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.exportError).toContain('máy chủ bản đồ nền chặn'));
    expect(result.current.imageUrl).toBeNull();
  });

  it('always lists the basemap and visible-layer attributions', () => {
    const { result } = renderHook(() => usePrintPage(deps()));
    expect(result.current.attributions[0]).toContain('OpenStreetMap');
    expect(result.current.attributions.some((a) => a.includes('FABDEM'))).toBe(true);
  });
});
```

Run: `npm run test -w @webatlas/web -- src/pages/print` — Expected: FAIL (module not found).

- [ ] **Step 5: Print presenter**

Before writing it, read `apps/web/src/features/map/model/basemapInfo.ts`; if it already exports per-basemap attribution text, import that instead of the local `BASEMAP_ATTRIBUTION` below and delete the constant.

`apps/web/src/pages/print/model/usePrintPage.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map } from 'ol';
import { LEGEND_ATTRIBUTION, REGION_NAME, type BasemapName } from '@webatlas/shared';
import {
  canvasToPngBlob as defaultToBlob,
  exportMapCanvas as defaultExport,
  ExportBlockedError,
} from '../../../features/map/model/exportMap';

export const PAPER_SIZES = {
  'A4-landscape': { label: 'A4 ngang', css: 'A4 landscape', aspect: 297 / 210 },
  'A4-portrait': { label: 'A4 dọc', css: 'A4 portrait', aspect: 210 / 297 },
  'A3-landscape': { label: 'A3 ngang', css: 'A3 landscape', aspect: 420 / 297 },
  'A3-portrait': { label: 'A3 dọc', css: 'A3 portrait', aspect: 297 / 420 },
} as const;
export type PaperId = keyof typeof PAPER_SIZES;

/** Printed on every sheet: the basemap is always in the image, so its licence is always owed. */
export const BASEMAP_ATTRIBUTION: Record<BasemapName, string> = {
  street: 'Nền bản đồ: © OpenStreetMap contributors (ODbL)',
  satellite: 'Ảnh vệ tinh: Esri, Maxar, Earthstar Geographics',
  dem: 'Địa hình: Esri World Hillshade',
};

export interface PrintToggles { legend: boolean; scale: boolean; north: boolean; date: boolean; crs: boolean }

export interface UsePrintPageDeps {
  map: Map | null;
  basemap: BasemapName;
  visibleLayerIds: string[];
  crsLabel: string;
  exporter?: { exportMapCanvas: typeof defaultExport; canvasToPngBlob: typeof defaultToBlob };
}

export function usePrintPage({ map, basemap, visibleLayerIds, crsLabel, exporter }: UsePrintPageDeps) {
  const exportCanvas = exporter?.exportMapCanvas ?? defaultExport;
  const toBlob = exporter?.canvasToPngBlob ?? defaultToBlob;

  const [title, setTitle] = useState(`Bản đồ tài nguyên nước — ${REGION_NAME}`);
  const [paper, setPaper] = useState<PaperId>('A4-landscape');
  const [toggles, setToggles] = useState<PrintToggles>({ legend: true, scale: true, north: true, date: true, crs: true });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    setCapturing(true);
    setExportError(null);
    exportCanvas(map, PAPER_SIZES[paper].aspect)
      .then(toBlob)
      .then((b) => { if (!cancelled) setBlob(b); })
      .catch((e) => {
        if (cancelled) return;
        setBlob(null);
        setExportError(e instanceof ExportBlockedError ? e.message : 'Không chụp được bản đồ.');
      })
      .finally(() => { if (!cancelled) setCapturing(false); });
    return () => { cancelled = true; };
  }, [map, paper, exportCanvas, toBlob]);

  useEffect(() => {
    if (!blob) { setImageUrl(null); return; }
    const url = URL.createObjectURL(blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const attributions = useMemo(() => {
    const layerNotes = visibleLayerIds.map((id) => LEGEND_ATTRIBUTION[id]).filter((a): a is string => Boolean(a));
    return [BASEMAP_ATTRIBUTION[basemap], ...new Set(layerNotes)];
  }, [basemap, visibleLayerIds]);

  const toggle = useCallback((key: keyof PrintToggles) => setToggles((t) => ({ ...t, [key]: !t[key] })), []);

  const downloadPng = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = 'ban-do.png';
    a.click();
  }, [imageUrl]);

  const print = useCallback(() => window.print(), []);

  return {
    title, setTitle, paper, setPaper, toggles, toggle, imageUrl, capturing, exportError,
    attributions, crsLabel, date: new Date().toLocaleDateString('vi-VN'), downloadPng, print,
  };
}
```

Run: `npm run test -w @webatlas/web -- src/pages/print/model` — Expected: PASS.

- [ ] **Step 6: Print view test + view**

`apps/web/src/pages/print/ui/PrintPage.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrintPageView, type PrintPageViewProps } from './PrintPage.view';

function props(over: Partial<PrintPageViewProps> = {}): PrintPageViewProps {
  return {
    title: 'Bản đồ', onTitle: vi.fn(), paper: 'A4-landscape', onPaper: vi.fn(),
    toggles: { legend: true, scale: true, north: true, date: true, crs: true }, onToggle: vi.fn(),
    imageUrl: 'blob:map', capturing: false, exportError: null,
    attributions: ['Nền bản đồ: © OpenStreetMap contributors (ODbL)'],
    scaleText: '1:250.000', crsLabel: 'WGS 84', date: '17/9/2026',
    legend: <div>LEGEND</div>, analysis: null,
    onDownload: vi.fn(), onPrint: vi.fn(), onClose: vi.fn(),
    ...over,
  };
}

describe('PrintPageView', () => {
  it('renders the sheet with title, map image, scale, CRS, date, legend and attributions', () => {
    render(<PrintPageView {...props()} />);
    expect(screen.getByRole('heading', { name: 'Bản đồ' })).toBeInTheDocument();
    expect(screen.getByAltText('Bản đồ in')).toHaveAttribute('src', 'blob:map');
    expect(screen.getByText('Tỷ lệ (theo màn hình): 1:250.000')).toBeInTheDocument();
    expect(screen.getByText('Hệ quy chiếu: WGS 84')).toBeInTheDocument();
    expect(screen.getByText('LEGEND')).toBeInTheDocument();
    expect(screen.getByText('Nền bản đồ: © OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });

  it('hides optional elements when toggled off, but never the attributions', () => {
    render(<PrintPageView {...props({ toggles: { legend: false, scale: false, north: false, date: false, crs: false } })} />);
    expect(screen.queryByText('LEGEND')).toBeNull();
    expect(screen.queryByText(/Tỷ lệ/)).toBeNull();
    expect(screen.getByText('Nền bản đồ: © OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });

  it('shows the export error and disables PNG download without an image', () => {
    render(<PrintPageView {...props({ imageUrl: null, exportError: 'Không xuất được ảnh' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Không xuất được ảnh');
    expect(screen.getByRole('button', { name: 'Tải PNG' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  });
});
```

`apps/web/src/pages/print/ui/PrintPage.view.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PAPER_SIZES, type PaperId, type PrintToggles } from '../model/usePrintPage';

export interface PrintPageViewProps {
  title: string; onTitle: (v: string) => void;
  paper: PaperId; onPaper: (p: PaperId) => void;
  toggles: PrintToggles; onToggle: (k: keyof PrintToggles) => void;
  imageUrl: string | null; capturing: boolean; exportError: string | null;
  attributions: string[]; scaleText: string; crsLabel: string; date: string;
  legend: ReactNode; analysis: ReactNode;
  onDownload: () => void; onPrint: () => void; onClose: () => void;
}

const TOGGLE_LABELS: Record<keyof PrintToggles, string> = {
  legend: 'Chú giải', scale: 'Tỷ lệ', north: 'Mũi tên chỉ hướng Bắc', date: 'Ngày in', crs: 'Hệ quy chiếu',
};

function NorthArrow() {
  return (
    <svg className="print-north" viewBox="0 0 24 36" width="24" height="36" role="img" aria-label="Hướng Bắc">
      <polygon points="12,0 22,24 12,18 2,24" fill="#111827" />
      <text x="12" y="35" textAnchor="middle" fontSize="10">B</text>
    </svg>
  );
}

export function PrintPageView(p: PrintPageViewProps) {
  return (
    <div className="print-route">
      <style>{`@page { size: ${PAPER_SIZES[p.paper].css}; margin: 10mm; }`}</style>
      <aside className="print-controls glass-panel" aria-label="Tuỳ chọn in">
        <h2 className="panel-title">In / Xuất bản đồ</h2>
        <label htmlFor="print-title">Tiêu đề</label>
        <input id="print-title" type="text" value={p.title} onChange={(e) => p.onTitle(e.target.value)} />
        <label htmlFor="print-paper">Khổ giấy</label>
        <select id="print-paper" value={p.paper} onChange={(e) => p.onPaper(e.target.value as PaperId)}>
          {(Object.keys(PAPER_SIZES) as PaperId[]).map((id) => <option key={id} value={id}>{PAPER_SIZES[id].label}</option>)}
        </select>
        {(Object.keys(TOGGLE_LABELS) as (keyof PrintToggles)[]).map((k) => (
          <label key={k} className="print-toggle">
            <input type="checkbox" checked={p.toggles[k]} onChange={() => p.onToggle(k)} /> {TOGGLE_LABELS[k]}
          </label>
        ))}
        {p.exportError && <p className="edit-form-error" role="alert">{p.exportError}</p>}
        <div className="analysis-actions">
          <button type="button" onClick={p.onDownload} disabled={!p.imageUrl}>Tải PNG</button>
          <button type="button" onClick={p.onPrint} disabled={!p.imageUrl}>In / PDF</button>
          <button type="button" onClick={p.onClose}>Đóng</button>
        </div>
      </aside>

      <article className={`print-sheet print-${p.paper}`}>
        <h1 className="print-title">{p.title}</h1>
        <div className="print-map">
          {p.capturing && !p.imageUrl && <p className="analysis-note">Đang chụp bản đồ…</p>}
          {p.imageUrl && <img src={p.imageUrl} alt="Bản đồ in" />}
          {p.toggles.north && <NorthArrow />}
        </div>
        <div className="print-meta">
          {p.toggles.scale && <span>Tỷ lệ (theo màn hình): {p.scaleText}</span>}
          {p.toggles.crs && <span>Hệ quy chiếu: {p.crsLabel}</span>}
          {p.toggles.date && <span>Ngày in: {p.date}</span>}
        </div>
        <div className="print-body">
          {p.toggles.legend && <div className="print-legend">{p.legend}</div>}
          {p.analysis && <div className="print-analysis">{p.analysis}</div>}
        </div>
        <footer className="print-attribution">
          {p.attributions.map((a) => <p key={a}>{a}</p>)}
        </footer>
      </article>
    </div>
  );
}
```

Run: `npm run test -w @webatlas/web -- src/pages/print` — Expected: PASS.

- [ ] **Step 7: Route container, top-bar button, CSS**

`apps/web/src/pages/print/index.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useMapContext } from '../../app/providers/MapProvider';
import Legend from '../../features/legend';
import { useAnalysisResult } from '../../features/analysis/model/analysisResult.store';
import { ANALYSIS_TOOL_LABELS } from '../../features/analysis/model/tools';
import { formatScale, scaleAtZoom } from '../../features/map/model/zoomScale';
import { usePrintPage } from './model/usePrintPage';
import { PrintPageView } from './ui/PrintPage.view';

export default function PrintRoute() {
  const navigate = useNavigate();
  const { map, basemap, layersState } = useMapContext();
  const analysis = useAnalysisResult();
  const p = usePrintPage({
    map,
    basemap,
    visibleLayerIds: layersState.filter((l) => l.visible).map((l) => l.id),
    // Task 16 replaces this with the selected CRS alias.
    crsLabel: 'WGS 84 (EPSG:4326)',
  });
  const zoom = map?.getView().getZoom() ?? 0;

  return (
    <PrintPageView
      title={p.title} onTitle={p.setTitle} paper={p.paper} onPaper={p.setPaper}
      toggles={p.toggles} onToggle={p.toggle}
      imageUrl={p.imageUrl} capturing={p.capturing} exportError={p.exportError}
      attributions={[...p.attributions, ...(analysis?.attribution ? [analysis.attribution] : [])]}
      scaleText={formatScale(scaleAtZoom(zoom))} crsLabel={p.crsLabel} date={p.date}
      legend={<Legend />}
      analysis={analysis ? (
        <section>
          <h2>{ANALYSIS_TOOL_LABELS[analysis.op]}</h2>
          <table className="analysis-summary"><tbody>
            {Object.entries(analysis.summary).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>)}
          </tbody></table>
          {analysis.rows && analysis.rows.length > 0 && (
            <table className="print-rows"><thead><tr><th>Tên</th><th>Lớp</th><th>Khoảng cách (km)</th></tr></thead><tbody>
              {analysis.rows.map((r, i) => (
                <tr key={r.featureId ?? i}><td>{r.name ?? '(không tên)'}</td><td>{r.layerKey ?? ''}</td><td>{r.distanceKm ?? ''}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>
      ) : null}
      onDownload={p.downloadPng} onPrint={p.print} onClose={() => navigate('/')}
    />
  );
}
```

`apps/web/src/app/App.tsx`: `import PrintRoute from '../pages/print';` and `<Route path="/print" element={<PrintRoute />} />` next to the admin route.

`apps/web/src/widgets/top-bar/index.tsx`: add `import { Link } from 'react-router-dom';` and `import { Printer } from 'lucide-react';`, then inside `.top-bar-right`, before the auth branch:

```tsx
        <Link to="/print" className="top-bar-print" title="In / Xuất bản đồ" aria-label="In / Xuất bản đồ">
          <Printer size={18} />
        </Link>
```

If `widgets/top-bar/index.test.tsx` renders without a router, wrap its render in `<MemoryRouter>`.

Append to `apps/web/src/styles/main.css`:

```css
/* In / Xuất bản đồ */
.top-bar-print { display: inline-flex; align-items: center; color: inherit; padding: 6px; border-radius: 6px; margin-right: 8px; }
.print-route { position: fixed; inset: 0; z-index: 1000; background: #e5e7eb; overflow: auto; display: flex; gap: 16px; padding: 16px; align-items: flex-start; }
.print-controls { width: 260px; flex: none; display: flex; flex-direction: column; gap: 6px; padding: 12px; }
.print-toggle { display: flex; gap: 6px; align-items: center; }
.print-sheet { background: #fff; color: #111827; padding: 12mm; box-shadow: 0 4px 16px rgba(0,0,0,.2); display: flex; flex-direction: column; gap: 8px; }
.print-A4-landscape, .print-A3-landscape { width: 277mm; }
.print-A4-portrait, .print-A3-portrait { width: 190mm; }
.print-title { margin: 0; font-size: 20px; text-align: center; }
.print-map { position: relative; border: 1px solid #9ca3af; }
.print-map img { display: block; width: 100%; }
.print-north { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,.85); border-radius: 4px; padding: 2px; }
.print-meta { display: flex; gap: 16px; font-size: 12px; }
.print-body { display: flex; gap: 16px; font-size: 12px; }
.print-legend, .print-analysis { flex: 1; }
.print-rows { border-collapse: collapse; width: 100%; }
.print-rows th, .print-rows td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 2px 4px; }
.print-attribution { font-size: 10px; color: #4b5563; border-top: 1px solid #e5e7eb; padding-top: 4px; }
.print-attribution p { margin: 0; }
@media print {
  body * { visibility: hidden; }
  .print-sheet, .print-sheet * { visibility: visible; }
  .print-route { position: static; background: none; padding: 0; overflow: visible; }
  .print-sheet { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; padding: 0; }
}
```

- [ ] **Step 8: Tests, type-check, lint**

Run: `npm run test -w @webatlas/web` then `npm run build:web` then `npm run lint:web`
Expected: all PASS.

- [ ] **Step 9: Browser verification**

With API + web dev servers running (background), drive with puppeteer-core: open `/`, wait for tiles to settle, click the printer link, wait for `img[alt="Bản đồ in"]`, screenshot the print page on each basemap (`street`, `satellite`, `dem` — switch basemap before opening print). Then `page.emulateMediaType('print')` and screenshot again to confirm only the sheet is visible. Confirm the PNG download works by evaluating `fetch(img.src).then(r => r.blob()).then(b => b.size)` > 0. Any basemap that shows the blocked-export message must match the Step 1 CORS finding; note it in the commit message.

- [ ] **Step 10: Tier B checkpoint**

Run: `npm run test:shared && npm run test:api && npm run test:web && npm run build:web`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/features/map/model/MapModel.ts apps/web/src/features/map/model/exportMap.ts apps/web/src/features/map/model/exportMap.test.ts apps/web/src/pages/print apps/web/src/app/App.tsx apps/web/src/widgets/top-bar apps/web/src/styles/main.css docs/superpowers/specs/2026-09-17-supervisor-feedback-map-operations-design.md
git commit -m "feat(web): trang in và xuất bản đồ PNG/PDF kèm chú giải, tỷ lệ, ghi công và kết quả phân tích

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Tier C (stretch)

### Task 16: Coordinate reference system toggle (WGS84 / VN-2000 with aliases)

**Files:**
- Create: `packages/shared/src/crs.ts`, `packages/shared/src/crs.test.ts`; modify `packages/shared/src/index.ts`
- Modify: `apps/web/package.json` (add `proj4`, dev `@types/proj4`)
- Create: `apps/web/src/features/map/model/crs.ts`, `crs.test.ts`
- Create: `apps/web/src/features/map/model/crsPreference.ts`
- Create: `apps/web/src/features/map/ui/CrsSelect.tsx`
- Modify: `apps/web/src/features/map/model/MapModel.ts` (`setCoordinateFormat`)
- Modify: `apps/web/src/features/map/ui/MapView.tsx`, `apps/web/src/pages/print/index.tsx`, `apps/web/src/styles/main.css`

**Interfaces:**
- Produces:
  - `interface CrsOption { id: string; alias: string; kind: 'geographic' | 'projected'; proj4: string; format?: 'dd' | 'dms' }`; `CRS_OPTIONS: CrsOption[]`; `DEFAULT_CRS_ID = 'wgs84-dd'`; `findCrs(id: string): CrsOption` (falls back to default)
  - `formatCoordinate(lonLat: number[] | undefined, crsId: string): string`; `toDms(value: number, pos: string, neg: string): string`
  - `useCrsPreference(): [string, (id: string) => void]`, `getCrsPreference(): string`
  - `MapModel.setCoordinateFormat(format: (coord?: number[]) => string): void`

- [ ] **Step 1: Get authoritative datum definitions from PostGIS (do not type them from memory)**

Run:

```bash
docker exec webatlas-db-1 psql -U postgres -d webatlas -At -c "SELECT srid, proj4text FROM spatial_ref_sys WHERE srid IN (4756, 3405, 3406, 32648, 32649) ORDER BY srid"
```

(If the user/db names differ, read them from `infra/.env`.) Copy each `proj4text` **verbatim** into Step 3. The `+towgs84=` part of 3405 is the VN-2000 datum shift used for every VN-2000 entry, including the TM-3 zones.

Expected (verify, don't assume): `4756` → `+proj=longlat +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +no_defs`; `3405` → `+proj=utm +zone=48 +ellps=WGS84 +towgs84=… +units=m +no_defs`. If PostGIS shows different numbers or signs, PostGIS wins.

- [ ] **Step 2: Verify the TM-3 central meridians**

Search for "Thông tư 973/2001/TT-TCĐC kinh tuyến trục các tỉnh" (WebSearch) and confirm each meridian below against the circular's appendix. Correct any that differ; **delete any entry you cannot confirm** (spec §6 accuracy gate).

| id | Alias | Central meridian (to confirm) |
|---|---|---|
| `vn2000-tm3-da-nang` | VN-2000 / Đà Nẵng (KTT 107°45′) | 107.75 |
| `vn2000-tm3-quang-nam` | VN-2000 / Đà Nẵng — cũ Quảng Nam (KTT 107°45′) | 107.75 |
| `vn2000-tm3-quang-ngai` | VN-2000 / Quảng Ngãi (KTT 108°00′) | 108.0 |
| `vn2000-tm3-kon-tum` | VN-2000 / Quảng Ngãi — cũ Kon Tum (KTT 107°30′) | 107.5 |
| `vn2000-tm3-gia-lai` | VN-2000 / Gia Lai (KTT 108°30′) | 108.5 |
| `vn2000-tm3-binh-dinh` | VN-2000 / Gia Lai — cũ Bình Định (KTT 108°15′) | 108.25 |
| `vn2000-tm3-khanh-hoa` | VN-2000 / Khánh Hòa (KTT 108°15′) | 108.25 |
| `vn2000-tm3-ninh-thuan` | VN-2000 / Khánh Hòa — cũ Ninh Thuận (KTT 108°15′) | 108.25 |
| `vn2000-tm3-dak-lak` | VN-2000 / Đắk Lắk (KTT 108°30′) | 108.5 |
| `vn2000-tm3-phu-yen` | VN-2000 / Đắk Lắk — cũ Phú Yên (KTT 108°30′) | 108.5 |
| `vn2000-tm3-lam-dong` | VN-2000 / Lâm Đồng (KTT 107°45′) | 107.75 |
| `vn2000-tm3-dak-nong` | VN-2000 / Lâm Đồng — cũ Đắk Nông (KTT 108°30′) | 108.5 |
| `vn2000-tm3-binh-thuan` | VN-2000 / Lâm Đồng — cũ Bình Thuận (KTT 108°30′) | 108.5 |

- [ ] **Step 3: Shared registry + tests**

`packages/shared/src/crs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CRS_OPTIONS, DEFAULT_CRS_ID, findCrs } from './crs.js';

describe('CRS_OPTIONS', () => {
  it('has unique ids and a WGS84 default', () => {
    const ids = CRS_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findCrs(DEFAULT_CRS_ID).alias).toContain('WGS 84');
  });

  it('every TM-3 zone uses k=0.9999, false easting 500 km, and the meridian its alias names', () => {
    const tm3 = CRS_OPTIONS.filter((o) => o.id.startsWith('vn2000-tm3-'));
    expect(tm3.length).toBeGreaterThan(0);
    for (const o of tm3) {
      expect(o.proj4).toContain('+k=0.9999');
      expect(o.proj4).toContain('+x_0=500000');
      const [, deg, min] = o.alias.match(/KTT (\d+)°(\d+)′/)!;
      const lon0 = Number(o.proj4.match(/\+lon_0=([\d.]+)/)![1]);
      expect(lon0).toBeCloseTo(Number(deg) + Number(min) / 60, 6);
    }
  });

  it('falls back to the default for an unknown id', () => {
    expect(findCrs('nope').id).toBe(DEFAULT_CRS_ID);
  });
});
```

`packages/shared/src/crs.ts` (replace the two `VN2000_*` strings with the exact PostGIS text from Step 1, and keep only the TM-3 rows confirmed in Step 2):

```ts
/**
 * Coordinate systems offered in the coordinate readout, the analysis results and the
 * print page. Display only: the map view stays EPSG:3857 and stored data EPSG:4326.
 *
 * VN-2000 datum parameters are copied verbatim from PostGIS spatial_ref_sys (EPSG
 * 4756/3405/3406), not typed from memory. TM-3 central meridians follow Thông tư
 * 973/2001/TT-TCĐC; provinces merged on 01/7/2025 keep one entry per former province,
 * because survey documents still cite the old province's meridian.
 */
export interface CrsOption {
  id: string;
  alias: string;
  kind: 'geographic' | 'projected';
  proj4: string;
  format?: 'dd' | 'dms';
}

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
/** From spatial_ref_sys srid 4756 (Step 1). */
const VN2000_GEOGRAPHIC = '+proj=longlat +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +no_defs';
/** The +ellps/+towgs84 portion of srid 3405 (Step 1). */
const VN2000_DATUM = '+ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278 +units=m +no_defs';

const tm3 = (id: string, alias: string, lon0: number): CrsOption => ({
  id: `vn2000-tm3-${id}`,
  alias,
  kind: 'projected',
  proj4: `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 ${VN2000_DATUM}`,
});

export const DEFAULT_CRS_ID = 'wgs84-dd';

export const CRS_OPTIONS: CrsOption[] = [
  { id: 'wgs84-dd', alias: 'WGS 84 — độ thập phân (EPSG:4326)', kind: 'geographic', proj4: WGS84, format: 'dd' },
  { id: 'wgs84-dms', alias: 'WGS 84 — độ phút giây', kind: 'geographic', proj4: WGS84, format: 'dms' },
  { id: 'wgs84-utm48', alias: 'WGS 84 / UTM 48N (EPSG:32648)', kind: 'projected', proj4: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs' },
  { id: 'wgs84-utm49', alias: 'WGS 84 / UTM 49N (EPSG:32649)', kind: 'projected', proj4: '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs' },
  { id: 'vn2000-geo', alias: 'VN-2000 — độ thập phân (EPSG:4756)', kind: 'geographic', proj4: VN2000_GEOGRAPHIC, format: 'dd' },
  { id: 'vn2000-utm48', alias: 'VN-2000 / UTM 48N (EPSG:3405)', kind: 'projected', proj4: `+proj=utm +zone=48 ${VN2000_DATUM}` },
  { id: 'vn2000-utm49', alias: 'VN-2000 / UTM 49N (EPSG:3406)', kind: 'projected', proj4: `+proj=utm +zone=49 ${VN2000_DATUM}` },
  tm3('da-nang', 'VN-2000 / Đà Nẵng (KTT 107°45′)', 107.75),
  tm3('quang-nam', 'VN-2000 / Đà Nẵng — cũ Quảng Nam (KTT 107°45′)', 107.75),
  tm3('quang-ngai', 'VN-2000 / Quảng Ngãi (KTT 108°00′)', 108.0),
  tm3('kon-tum', 'VN-2000 / Quảng Ngãi — cũ Kon Tum (KTT 107°30′)', 107.5),
  tm3('gia-lai', 'VN-2000 / Gia Lai (KTT 108°30′)', 108.5),
  tm3('binh-dinh', 'VN-2000 / Gia Lai — cũ Bình Định (KTT 108°15′)', 108.25),
  tm3('khanh-hoa', 'VN-2000 / Khánh Hòa (KTT 108°15′)', 108.25),
  tm3('ninh-thuan', 'VN-2000 / Khánh Hòa — cũ Ninh Thuận (KTT 108°15′)', 108.25),
  tm3('dak-lak', 'VN-2000 / Đắk Lắk (KTT 108°30′)', 108.5),
  tm3('phu-yen', 'VN-2000 / Đắk Lắk — cũ Phú Yên (KTT 108°30′)', 108.5),
  tm3('lam-dong', 'VN-2000 / Lâm Đồng (KTT 107°45′)', 107.75),
  tm3('dak-nong', 'VN-2000 / Lâm Đồng — cũ Đắk Nông (KTT 108°30′)', 108.5),
  tm3('binh-thuan', 'VN-2000 / Lâm Đồng — cũ Bình Thuận (KTT 108°30′)', 108.5),
];

export function findCrs(id: string): CrsOption {
  return CRS_OPTIONS.find((o) => o.id === id) ?? CRS_OPTIONS[0];
}
```

Append `export * from './crs.js';` to `packages/shared/src/index.ts`.

Run: `npm run test:shared -- src/crs.test.ts` then `npm run build:shared` — Expected: PASS.

- [ ] **Step 4: Reference coordinates from PostGIS for the web test**

Run (Buôn Ma Thuột):

```bash
docker exec webatlas-db-1 psql -U postgres -d webatlas -At -c "
WITH p AS (SELECT ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326) AS g)
SELECT 'utm48', ST_X(ST_Transform(g, 3405)), ST_Y(ST_Transform(g, 3405)) FROM p
UNION ALL
SELECT 'tm3-dak-lak', ST_X(t), ST_Y(t) FROM p, LATERAL ST_Transform(g, '<paste the vn2000-tm3-dak-lak proj4 string>') t"
```

Note both easting/northing pairs; they go into Step 5's test as `EXPECTED_UTM48` and `EXPECTED_TM3`.

- [ ] **Step 5: Web formatter test**

`npm install proj4 -w @webatlas/web && npm install -D @types/proj4 -w @webatlas/web`

`apps/web/src/features/map/model/crs.test.ts` (fill the four numbers from Step 4):

```ts
import { describe, it, expect } from 'vitest';
import { formatCoordinate, projectLonLat, toDms } from './crs';

const BMT = [108.05, 12.68];
const EXPECTED_UTM48 = { e: 0 /* ST_X from Step 4 */, n: 0 /* ST_Y from Step 4 */ };
const EXPECTED_TM3 = { e: 0 /* ST_X from Step 4 */, n: 0 /* ST_Y from Step 4 */ };

describe('CRS formatting', () => {
  it('WGS84 decimal degrees keeps the existing readout format', () => {
    expect(formatCoordinate(BMT, 'wgs84-dd')).toBe('108.050000°E  12.680000°N');
  });

  it('formats degrees-minutes-seconds', () => {
    expect(toDms(108.05, 'E', 'W')).toBe('108°03′00.0″E');
  });

  it('matches PostGIS for VN-2000 / UTM 48N within 0.5 m', () => {
    const [e, n] = projectLonLat(BMT, 'vn2000-utm48');
    expect(Math.abs(e - EXPECTED_UTM48.e)).toBeLessThan(0.5);
    expect(Math.abs(n - EXPECTED_UTM48.n)).toBeLessThan(0.5);
  });

  it('matches PostGIS for VN-2000 / Đắk Lắk TM-3 within 0.5 m', () => {
    const [e, n] = projectLonLat(BMT, 'vn2000-tm3-dak-lak');
    expect(Math.abs(e - EXPECTED_TM3.e)).toBeLessThan(0.5);
    expect(Math.abs(n - EXPECTED_TM3.n)).toBeLessThan(0.5);
  });

  it('labels projected output with X (Bắc) / Y (Đông), the Vietnamese survey convention', () => {
    expect(formatCoordinate(BMT, 'vn2000-utm48')).toMatch(/^X: [\d.]+,\d{2} m {2}Y: [\d.]+,\d{2} m$/);
  });

  it('returns an empty string without a coordinate', () => {
    expect(formatCoordinate(undefined, 'wgs84-dd')).toBe('');
  });
});
```

Run: `npm run test -w @webatlas/web -- src/features/map/model/crs.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 6: Formatter, preference store, readout wiring**

`apps/web/src/features/map/model/crs.ts`:

```ts
import proj4 from 'proj4';
import { findCrs } from '@webatlas/shared';
import { formatLonLat } from './mapReadouts';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export function projectLonLat(lonLat: number[], crsId: string): [number, number] {
  const option = findCrs(crsId);
  const [x, y] = proj4(WGS84, option.proj4, [lonLat[0], lonLat[1]]);
  return [x, y];
}

export function toDms(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = Math.round(((abs - deg) * 60 - min) * 60 * 10) / 10;
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${deg}°${String(min).padStart(2, '0')}′${sec.toFixed(1).padStart(4, '0')}″${value >= 0 ? pos : neg}`;
}

const metres = (v: number) =>
  v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Readout text in the chosen CRS. Input is WGS84 lon/lat (what MousePosition yields). */
export function formatCoordinate(lonLat: number[] | undefined, crsId: string): string {
  if (!lonLat || lonLat.length < 2) return '';
  const option = findCrs(crsId);
  if (option.kind === 'geographic') {
    const [lon, lat] = option.id.startsWith('wgs84') ? lonLat : projectLonLat(lonLat, crsId);
    if (option.format === 'dms') return `${toDms(lon, 'E', 'W')}  ${toDms(lat, 'N', 'S')}`;
    return formatLonLat([lon, lat]);
  }
  const [easting, northing] = projectLonLat(lonLat, crsId);
  // X is northing and Y easting in Vietnamese survey practice.
  return `X: ${metres(northing)} m  Y: ${metres(easting)} m`;
}
```

(`vi-VN` groups thousands with `.` and uses `,` for decimals, matching the regex in the test.)

`apps/web/src/features/map/model/crsPreference.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_CRS_ID, findCrs } from '@webatlas/shared';

const KEY = 'webatlas.crs';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return findCrs(localStorage.getItem(KEY) ?? DEFAULT_CRS_ID).id;
  } catch {
    return DEFAULT_CRS_ID; // storage blocked (private window) — default, don't crash
  }
}

let current = read();

export function getCrsPreference(): string { return current; }

export function setCrsPreference(id: string): void {
  current = findCrs(id).id;
  try { localStorage.setItem(KEY, current); } catch { /* per-viewer convenience only */ }
  for (const l of listeners) l();
}

export function useCrsPreference(): [string, (id: string) => void] {
  const id = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    getCrsPreference,
    getCrsPreference
  );
  return [id, useCallback((next: string) => setCrsPreference(next), [])];
}
```

`MapModel.ts`: add `import type MousePosition from 'ol/control/MousePosition';`, a field `private mousePosition: MousePosition | null = null;`, change the controls line to create it first (`this.mousePosition = createMousePosition();` then `controls: [createScaleBar(), this.mousePosition]`), and add the method:

```ts
  /** Swaps the coordinate readout's formatter (CRS toggle). The control keeps
   *  projecting to EPSG:4326; the formatter converts from there. */
  setCoordinateFormat(format: (coord?: number[]) => string): void {
    this.mousePosition?.setCoordinateFormat(format);
  }
```

`apps/web/src/features/map/ui/CrsSelect.tsx`:

```tsx
import React from 'react';
import { CRS_OPTIONS } from '@webatlas/shared';
import { useCrsPreference } from '../model/crsPreference';

const CrsSelect: React.FC = () => {
  const [crsId, setCrsId] = useCrsPreference();
  return (
    <select
      className="map-crs-select"
      value={crsId}
      onChange={(e) => setCrsId(e.target.value)}
      aria-label="Hệ quy chiếu hiển thị toạ độ"
      title="Hệ quy chiếu hiển thị toạ độ"
    >
      {CRS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.alias}</option>)}
    </select>
  );
};

export default CrsSelect;
```

`MapView.tsx`: import `CrsSelect`, `useCrsPreference`, `formatCoordinate`; add

```tsx
  const [crsId] = useCrsPreference();
  useEffect(() => {
    modelRef.current?.setCoordinateFormat((c) => formatCoordinate(c, crsId));
  }, [crsId]);
```

and render `<CrsSelect />` next to `<CursorElevation />`.

`apps/web/src/pages/print/index.tsx`: replace the hard-coded `crsLabel` with `findCrs(crsId).alias`, where `const [crsId] = useCrsPreference();` (imports from `@webatlas/shared` and `../../features/map/model/crsPreference`).

Append to `main.css` (adjust `bottom` so it sits just above `.map-cursor-elevation`; check that rule's `bottom` value first):

```css
.map-crs-select { position: absolute; right: 8px; bottom: 56px; z-index: 5; max-width: 260px; font-size: 12px; padding: 2px 4px; border-radius: 4px; }
```

- [ ] **Step 7: Run tests, type-check, lint**

Run: `npm run test -w @webatlas/web -- src/features/map src/pages/print` then `npm run build:web` then `npm run lint:web`
Expected: PASS.

- [ ] **Step 8: Browser check**

In the running app switch the select to `VN-2000 / Đắk Lắk (KTT 108°30′)`, hover near Buôn Ma Thuột, and screenshot the readout; confirm it does not overlap the elevation readout or the scale bar, and survives a reload (localStorage). Open `/print` and confirm the CRS line shows the alias.

- [ ] **Step 9: Tier C checkpoint + commit**

Run: `npm run test:shared && npm run test:api && npm run test:web && npm run build:web`

```bash
git add packages/shared/src packages/shared/dist apps/web/package.json package-lock.json apps/web/src/features/map apps/web/src/pages/print apps/web/src/styles/main.css
git add -f packages/shared/dist/crs.js packages/shared/dist/crs.d.ts
git commit -m "feat(web): chọn hệ quy chiếu hiển thị toạ độ — WGS 84, VN-2000 UTM và TM-3 theo tỉnh

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Wrap-up

### Task 17: Docs, live assistant routing, final verification

**Files:**
- Modify: `docs/runbooks/map-assistant.md` (tool count, new tools, admin-only proposal flow, known limits)
- Modify: `README.md` (API surface: geometry + analysis routes; roles: editor read-only)
- Modify: `apps/api/src/modules/assistant/assistant.live.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Runbook and README**

In `docs/runbooks/map-assistant.md`:
- opening paragraph: tool count from 14 to 19 (18 always registered including the 4 analysis tools, +`run_sql` when configured, +`propose_feature_update` for admins — recount with `grep -c "Tool," apps/api/src/modules/assistant/tools/registry.ts` and state the real numbers);
- add a section **"Cập nhật dữ liệu qua trợ lý (chỉ quản trị viên)"** describing: the assistant only proposes; the wizard requires *Tài liệu nguồn* and *Người cung cấp*; the save is the normal `PUT` and lands in `app.audit_log.source_document/source_provider`; non-admins get the fixed refusal sentence;
- add the four analysis tools to the tool list with one line each, and a known limit: *DEM tools answer "không có dữ liệu" until `load-dem.sh` has run*.

In `README.md` API surface add:

```
GET    /api/features/:layerKey/:id/geometry → simplified GeoJSON geometry (public)
POST   /api/analysis/:op                → buffer | select_within | nearest | elevation_profile | zonal_elevation (public, 60/min)
```

and change the roles sentence to: *public viewer (read-only), viewer/editor (authenticated, read-only), administrator (the only role that writes)*.

- [ ] **Step 2: Live routing cases (costs tokens — ask the user before running)**

In `assistant.live.test.ts`, give `ask` a role parameter and pass it through:

```ts
function ask(message: string, role: 'admin' | 'viewer' = 'viewer', sessionId = `live-${Math.random()}`) {
  return runAssistant({ pool, userId: 'live-test-user', sessionId, message, mapContext: MAP_CONTEXT, logger: testLogger, role });
}
```

(update any existing call that passed a `sessionId` positionally to `ask(message, 'viewer', sessionId)`), then add inside `maybe('intent routing (live model)', ...)`:

```ts
  it('admin update request becomes a proposal, never a write', async () => {
    const { commands } = await ask(
      'Cập nhật công suất thuỷ điện Sông Hinh thành 72 MW theo Quyết định 123/QĐ-UBND, Sở Công Thương Đắk Lắk cung cấp',
      'admin'
    );
    const proposal = commands.find((c: MapCommand) => c.kind === 'proposeFeatureEdit');
    expect(proposal).toBeDefined();
    expect(proposal).toMatchObject({ proposed: { wattage_mw: expect.stringMatching(/^72(\.0+)?$/) } });
  }, 90_000);

  it('viewer update request is refused with the fixed sentence and no proposal', async () => {
    const { commands, segments } = await ask('Sửa công suất đập Sông Hinh thành 72 MW', 'viewer');
    expect(commands.some((c: MapCommand) => c.kind === 'proposeFeatureEdit')).toBe(false);
    expect(segments.map((s) => s.text).join(' ')).toContain('chỉ quản trị viên mới cập nhật được');
  }, 60_000);

  it('routes a buffer-and-count question to select_within', async () => {
    const { provenance } = await ask('Có bao nhiêu đập trong phạm vi 10 km quanh hồ Lắk?');
    expect(provenance.some((p) => p.tool === 'select_within')).toBe(true);
  }, 90_000);

  it('routes a river gradient question to elevation_profile', async () => {
    const { provenance } = await ask('Trắc diện độ cao sông Srêpốk thế nào?');
    expect(provenance.some((p) => p.tool === 'elevation_profile')).toBe(true);
  }, 90_000);
```

Ask the user: *"The live assistant suite calls the real model and costs tokens. Run `npm run test:api:live` now?"* Run only on a yes; report the results verbatim (a routing miss is a finding, not something to paper over by loosening the assertion).

- [ ] **Step 3: Full verification**

Run, and paste the summary lines into the final report:

```bash
npm run build:shared && npm run test:shared
npm run test:api
npm run test:web
npm run build:web
npm run lint:web
git status --ignored packages/shared/dist
```

Expected: all green; no `dist/*.js`/`*.d.ts` re-exported by `dist/index.js` listed as ignored.

- [ ] **Step 4: End-to-end browser pass (jsdom cannot prove any of this)**

With the stack, API and web running, log in as an admin (create one per the dev-run recipe if needed) and capture screenshots of:
1. Search "Srêpốk" → the whole river highlighted and framed.
2. Assistant (admin): the Sông Hinh update sentence → map highlights the dam, the **Đề xuất cập nhật** wizard opens with `wattage_mw` marked "Trước: 70", Save disabled until both source fields are filled; save → transcript shows "Đã cập nhật 1 trường…"; then `SELECT source_document, source_provider FROM app.audit_log ORDER BY id DESC LIMIT 1` shows the values. **Afterwards restore the dam** (re-run the wizard back to the original value, or delete the created edit-version as `layers.test.ts`'s `afterAll` does) so the dev DB is not left with fake figures.
3. Log in as an editor: no edit drawer; asking the assistant to update → refusal sentence.
4. Toolbar: Vùng đệm with a drawn point, 5 km → buffer drawn. Then Chọn trong vùng → "Dùng hình vừa vẽ" must show "Hình vừa vẽ không dùng được cho phép này — hãy vẽ mới." (the remembered shape is the drawn point, not the buffer). Then draw a polygon → dams highlighted, card lists them, "Xuất CSV" downloads a file that opens in Excel with Vietnamese intact.
5. Trắc diện độ cao along a line → chart renders.
6. `/print` on street basemap → PNG downloads; print preview shows only the sheet.
7. CRS select → VN-2000 TM-3 readout.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/map-assistant.md README.md apps/api/src/modules/assistant/assistant.live.test.ts
git commit -m "docs: cập nhật runbook trợ lý, API và vai trò; ca kiểm thử định tuyến trực tiếp cho công cụ mới

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| §1 Permissions | 1 (API + web), 7 (assistant prompt), 8 (admin-only tool) |
| §2 Update wizard + storage | 2, 3 (`proposeFeatureEdit`), 8, 9 |
| §3 `showGeometries` + search + assistant highlight | 3, 4, 5, 6, 7 |
| §4 Analysis module, toolbar, card, assistant tools | 5 (`resolveFeature`), 10, 11, 12, 13, 14 |
| §5 Print and export | 15 |
| §6 CRS | 16 |
| §7 Later phases | not implemented (by design) |
| §8 Error handling | 8, 9, 10, 11, 14 |
| §9 Testing and verification | every task; 17 |
