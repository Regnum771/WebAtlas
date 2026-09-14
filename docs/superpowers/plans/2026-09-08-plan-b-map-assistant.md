# Map Assistant Implementation Plan (Plan B of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-side LLM assistant that answers questions about map entities in Vietnamese, measures them authoritatively in PostGIS, drives the map through the `MapCommand` seam Plan A extracted, and attaches provenance to everything it asserts.

**Architecture:** `POST /api/assistant/messages` runs a `claude-haiku-4-5` Tool Runner loop server-side. Tools come in two classes from one registry — **data** tools query PostGIS and return facts plus provenance, **command** tools emit validated `MapCommand`s. The route returns `{ segments, commands, provenance }`; the browser replays the commands through the same `createCommandExecutor` the toolbar and search results already use, so the assistant's map control is not a second implementation of the toolbar. A guarded SQL escape hatch runs on a separate connection pool as a `webatlas_assistant` database role that has no grant of any kind on the `app` schema.

**Tech Stack:** `@anthropic-ai/sdk` ^0.124.0 (beta Tool Runner + `betaZodTool`), Zod 3, Fastify 5, PostGIS, React 19, Vitest + Testing Library, `pg`.

**Spec:** [2026-09-07-ui-overhaul-and-map-assistant-design.md](../specs/2026-09-07-ui-overhaul-and-map-assistant-design.md)

**Plan A** ([2026-09-07-plan-a-ui-overhaul.md](2026-09-07-plan-a-ui-overhaul.md)) is merged. This plan consumes its `MapCommand` contract (`packages/shared/src/map-commands.ts`), its executor (`apps/web/src/features/map/model/mapCommands.ts`), and its rail/flyout shell (`RailItemId` already reserves `'assistant'`).

## Resolutions of the spec's "Open for refinement"

The spec listed five areas needing another pass. They are settled here so no task has to invent an answer:

1. **Retrieval architecture** — out of scope. Spec 3 adds a `retrieval` tool class to `tools/registry.ts`; nothing in this plan blocks it. No vector store is built.
2. **Relationship model** — ad-hoc, not general. `relatedFeatures` (Task 6) answers "what is near this" with PostGIS spatial predicates. No relationship table, no graph. YAGNI until a second consumer exists.
3. **Provenance schema** — fixed in Task 2 as `{ tool, layerKey, rowCount, datasetVersion, sql? }`. One record per tool call, in call order.
4. **Session and cost policy** — session TTL 30 min (`ASSISTANT_SESSION_TTL_MS`), 20 turns retained per session, sessions bound to the user id that created them. Per-user ceiling 200,000 tokens per UTC day (`ASSISTANT_DAILY_TOKEN_BUDGET`); at the ceiling the route returns 429 `ASSISTANT_BUDGET_EXCEEDED` with a Vietnamese message. Both live in memory like the session store — they reset on restart, which is acceptable for the single-process deployment and is recorded as a known limit in Task 10's runbook.
5. **Failure UX** — Task 10. Every failure renders in the panel as a Vietnamese message with a retry affordance; a tool that throws returns its error to the model as text (the loop continues) rather than failing the whole request.

## Global Constraints

- **The OpenLayers quarantine.** Only `apps/web/src/features/map/model/*` may import from `ol` at runtime. The assistant slice (`features/assistant/`) must never import `ol` — it reaches the map only through `createCommandExecutor` and the `MapContext` builder, both of which live in `features/map/model/`. `apps/web/src/components/OGCClient.tsx` remains the one documented, excluded violation.
- **No new runtime dependency in `packages/shared`.** It is imported by both the browser bundle and the API; validation there is hand-written, not Zod.
- **`packages/shared/dist` is git-tracked.** After editing `packages/shared/src/*`, run `npm run build:shared` and commit the regenerated `dist` in the same commit as the source.
- **`npm run build:web` is the type gate** for web changes, not `vitest` — Vitest uses esbuild and skips type-checking. Every task that changes web TypeScript runs `build:web` before its commit.
- **Zod belongs to the API only.** `apps/api` already depends on `zod@^3.23.8`; tool schemas use it via `betaZodTool`. Do not add Zod to `packages/shared` or `apps/web`.
- **Commit messages in Vietnamese**, matching repo convention. Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vietnamese is the UI language and the assistant's response language.** All user-facing strings and the system prompt's output-language instruction are Vietnamese. Tool `description` fields are English — they are model-facing, and the surrounding SDK/schema vocabulary is English.
- **`ANTHROPIC_API_KEY` is optional in `config/env.ts`.** `env.ts` parses at import time and every existing API test builds the app; making the key required would break the whole suite and every dev machine without one. The route returns 503 `ASSISTANT_UNAVAILABLE` when it is unset.
- **Model is `claude-haiku-4-5`** (the user's recorded choice in the spec), configurable via `ASSISTANT_MODEL`. Haiku 4.5 takes `budget_tokens` rather than adaptive thinking; **no `thinking` parameter is sent at all** — a tool-routing agent does not need it, and latency and cost dominate. Haiku 4.5 does **not** support mid-conversation system messages: volatile `MapContext` goes in the latest user turn, never in the top-level `system` field.
- **Extensions and roles are added by migration, never by editing `infra/postgis/init.sql`** — that file runs only on first database init, so an edit would silently skip every existing dev database.
- **Editable layer keys are the 8 in `EDITABLE_LAYER_KEYS`**: `dams, rivers, lakes, stations, flood_zones, drought_points, saltwater_intrusion, flood_generation`. Only these have `water.<key>_active` views. Administrative boundaries are client-side GeoJSON with no DB table — the assistant cannot query them.
- **API tests run against the live dev database** (see `apps/api/src/modules/search/search.test.ts` for the precedent). `docker compose -f infra/docker-compose.yml up -d db` and `npm run migrate` must have been run first. Tests that call the real model are excluded from the default run by filename (Task 7).

## File Structure

**`packages/shared/src/`** — contracts imported by both sides, no runtime deps.

| File | Responsibility |
|---|---|
| `map-commands.ts` (modify) | Adds `highlightFeatures` / `clearHighlights` variants + validation |
| `assistant.ts` (new) | `MapContext`, `Provenance`, `ReplySegment`, `AssistantRequest`, `AssistantReply`, `parseReplySegments` |

**`apps/api/src/modules/assistant/`** — one concern per file, following the existing `routes / controller / service / repository` split.

| File | Responsibility |
|---|---|
| `routes.ts` | Route registration, auth preHandler, per-user rate limit |
| `controller.ts` | Zod request validation, budget check, 503 when unconfigured |
| `service.ts` | Runs the model loop, collects commands + provenance, updates the session |
| `sessionStore.ts` | In-memory session map with TTL and user binding |
| `budget.ts` | Per-user daily token counter |
| `prompt.ts` | System prompt and `MapContext` serialization |
| `tools/types.ts` | `ToolContext`, `ToolFactory`, the provenance collector |
| `tools/registry.ts` | Assembles the tool list from the two classes |
| `tools/command/*.ts` | One file per command tool |
| `tools/data/*.ts` | One file per data tool |
| `sql/guard.ts` | Query guard (the parser layer) |
| `sql/pool.ts` | The `webatlas_assistant` connection pool |

**`apps/web/src/features/`**

| File | Responsibility |
|---|---|
| `map/model/highlightLayer.ts` (new) | The highlight vector layer; the only new OL code |
| `map/model/mapCommands.ts` (modify) | Executes the two new command kinds |
| `map/model/mapContext.ts` (new) | Reads viewport bbox/zoom off the map into a `MapContext` |
| `assistant/index.tsx` | Container: wires presenter, view, and the command executor |
| `assistant/model/useAssistant.ts` | Presenter: session id, turns, loading, error, send |
| `assistant/api/assistant.api.ts` | `postAssistantMessage` |
| `assistant/ui/AssistantPanel.view.tsx` | Passive view: transcript, segments, provenance chips, composer |

---

### Task 1: `highlightFeatures` — the command Plan A deferred

Plan A left a note in `map-commands.ts` saying a `highlightFeatures` variant was deliberately omitted and that "Plan B adds it with a real highlight source and tests when the assistant needs it." This is that task. Delete that note as part of the change.

The command carries **coordinates, not feature ids**: every data tool already returns `lonLat` for its rows, so the browser needs no second lookup and the executor needs no WFS access.

**Files:**
- Modify: `packages/shared/src/map-commands.ts`
- Modify: `packages/shared/src/map-commands.test.ts`
- Create: `apps/web/src/features/map/model/highlightLayer.ts`
- Create: `apps/web/src/features/map/model/highlightLayer.test.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.test.ts`

**Interfaces:**
- Consumes: `isLonLat` (private, already in `map-commands.ts`), `CommandDeps` from `mapCommands.ts`.
- Produces: `MapCommand` variants `{ kind: 'highlightFeatures'; points: HighlightPoint[] }` and `{ kind: 'clearHighlights' }`; `type HighlightPoint = { lonLat: [number, number]; label?: string }`; `MAX_HIGHLIGHT_POINTS = 50`. From `highlightLayer.ts`: `showHighlights(map, points): void`, `clearHighlights(map): void`, `HIGHLIGHT_LAYER_ID`. Tasks 4 and 9 emit and execute these.

- [ ] **Step 1: Write the failing shared-contract tests**

Append to `packages/shared/src/map-commands.test.ts`:

```typescript
describe('isMapCommand — highlight variants', () => {
  it('accepts a highlightFeatures command with labelled points', () => {
    expect(
      isMapCommand({
        kind: 'highlightFeatures',
        points: [{ lonLat: [108.1, 12.7], label: 'Đập Buôn Kuốp' }, { lonLat: [108.3, 12.9] }],
      })
    ).toBe(true);
  });

  it('accepts clearHighlights', () => {
    expect(isMapCommand({ kind: 'clearHighlights' })).toBe(true);
  });

  it('rejects highlightFeatures with an empty points array', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [] })).toBe(false);
  });

  it('rejects more points than MAX_HIGHLIGHT_POINTS', () => {
    const points = Array.from({ length: MAX_HIGHLIGHT_POINTS + 1 }, () => ({ lonLat: [108, 12] }));
    expect(isMapCommand({ kind: 'highlightFeatures', points })).toBe(false);
  });

  it('rejects a point whose lonLat is malformed', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [{ lonLat: [108] }] })).toBe(false);
  });

  it('rejects a non-string label', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [{ lonLat: [108, 12], label: 7 }] })).toBe(false);
  });
});
```

Update the existing `lists every kind in MAP_COMMAND_KINDS` test — it currently asserts an exact sorted array, so it will fail until the two new kinds are added:

```typescript
  it('lists every kind in MAP_COMMAND_KINDS', () => {
    expect([...MAP_COMMAND_KINDS].sort()).toEqual([
      'clearHighlights',
      'highlightFeatures',
      'resetView',
      'setBasemap',
      'setLayerOpacity',
      'setLayerVisible',
      'zoomTo',
      'zoomToFeature',
      'zoomToRegion',
    ]);
  });
```

Add `MAX_HIGHLIGHT_POINTS` to the file's existing import from `./map-commands.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:shared -- map-commands`
Expected: FAIL — `MAX_HIGHLIGHT_POINTS` is not exported, and the highlight kinds are rejected.

- [ ] **Step 3: Add the variants to the shared contract**

In `packages/shared/src/map-commands.ts`, add the two kinds to `MAP_COMMAND_KINDS`:

```typescript
export const MAP_COMMAND_KINDS = [
  'zoomToRegion',
  'zoomToFeature',
  'zoomTo',
  'resetView',
  'setLayerVisible',
  'setLayerOpacity',
  'setBasemap',
  'highlightFeatures',
  'clearHighlights',
] as const;
```

Add the point type and cap above the `MapCommand` union:

```typescript
/**
 * A point the assistant wants drawn on the map. Coordinates, not feature ids:
 * every data tool already returns lonLat for the rows it reports, so the browser
 * needs no second lookup and the executor needs no WFS access.
 */
export interface HighlightPoint {
  lonLat: [number, number];
  label?: string;
}

/** Cap on one highlight command. Beyond this the map is noise, and a runaway
 *  tool result would push an unbounded payload through the route. */
export const MAX_HIGHLIGHT_POINTS = 50;
```

Replace the `NOTE:` comment that says `highlightFeatures` was left out with the two new union members:

```typescript
  | { kind: 'setBasemap'; basemap: BasemapName }
  | { kind: 'highlightFeatures'; points: HighlightPoint[] }
  | { kind: 'clearHighlights' };
```

Add the validation branches to `isMapCommand`, before `default`:

```typescript
    case 'highlightFeatures':
      return (
        Array.isArray(c.points) &&
        c.points.length > 0 &&
        c.points.length <= MAX_HIGHLIGHT_POINTS &&
        c.points.every((p) => {
          if (typeof p !== 'object' || p === null) return false;
          const point = p as Record<string, unknown>;
          if (!isLonLat(point.lonLat)) return false;
          return point.label === undefined || typeof point.label === 'string';
        })
      );
    case 'clearHighlights':
      return true;
```

- [ ] **Step 4: Run the shared tests to verify they pass**

Run: `npm run test:shared -- map-commands`
Expected: PASS.

- [ ] **Step 5: Write the failing highlight-layer test**

Create `apps/web/src/features/map/model/highlightLayer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Map } from 'ol';
import { showHighlights, clearHighlights, HIGHLIGHT_LAYER_ID } from './highlightLayer';
import { fromLonLat } from 'ol/proj';

function makeMap() {
  const added: unknown[] = [];
  const map = { addLayer: vi.fn((l: unknown) => added.push(l)) } as unknown as Map;
  return { map, added };
}

describe('highlightLayer', () => {
  it('adds exactly one layer to the map however many times it is called', () => {
    const { map } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    showHighlights(map, [{ lonLat: [108.2, 12.8] }]);
    expect((map.addLayer as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('tags the layer so it is identifiable in the layer stack', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    const layer = added[0] as { get: (k: string) => unknown };
    expect(layer.get('id')).toBe(HIGHLIGHT_LAYER_ID);
  });

  it('replaces the previous highlights rather than accumulating them', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }, { lonLat: [108.2, 12.8] }]);
    showHighlights(map, [{ lonLat: [108.3, 12.9] }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => unknown[] } }).getSource();
    expect(source.getFeatures()).toHaveLength(1);
  });

  it('projects lonLat into the map projection', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => Array<{ getGeometry: () => { getCoordinates: () => number[] } }> } }).getSource();
    expect(source.getFeatures()[0].getGeometry().getCoordinates()).toEqual(fromLonLat([108.1, 12.7]));
  });

  it('carries the label through as a feature property', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7], label: 'Đập Buôn Kuốp' }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => Array<{ get: (k: string) => unknown }> } }).getSource();
    expect(source.getFeatures()[0].get('label')).toBe('Đập Buôn Kuốp');
  });

  it('clearHighlights empties the source without removing the layer', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    clearHighlights(map);
    const source = (added[0] as { getSource: () => { getFeatures: () => unknown[] } }).getSource();
    expect(source.getFeatures()).toHaveLength(0);
    expect((map.addLayer as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('clearHighlights on a map that never highlighted anything does nothing', () => {
    const { map } = makeMap();
    expect(() => clearHighlights(map)).not.toThrow();
    expect((map.addLayer as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:web -- highlightLayer`
Expected: FAIL — `Cannot find module './highlightLayer'`.

- [ ] **Step 7: Write the highlight layer**

Create `apps/web/src/features/map/model/highlightLayer.ts`:

```typescript
import type { Map } from 'ol';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { HighlightPoint } from '@webatlas/shared';

/** Identifies the layer in the OL layer stack. Deliberately NOT a member of
 *  LAYER_STATE_IDS: this layer is transient assistant output, not a data layer
 *  the user can toggle, so it must never appear in the layers panel. */
export const HIGHLIGHT_LAYER_ID = 'layer_assistant_highlight';

/** Kept local rather than added to styles.ts: nothing else highlights points,
 *  and the style only exists because this layer does. */
const highlightStyle = (feature: { get: (key: string) => unknown }) =>
  new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: 'rgba(217, 119, 6, 0.35)' }),
      stroke: new Stroke({ color: '#b45309', width: 2 }),
    }),
    text: new Text({
      text: (feature.get('label') as string | undefined) ?? '',
      offsetY: -18,
      font: '12px sans-serif',
      fill: new Fill({ color: '#78350f' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
    }),
  });

// Keyed by map so a remounted map gets its own layer and the old one is
// collected with it — a module-level singleton would leak across MapModel
// teardown/rebuild and re-add a layer to a disposed map.
const layers = new WeakMap<Map, VectorLayer<VectorSource>>();

function ensureLayer(map: Map): VectorLayer<VectorSource> {
  const existing = layers.get(map);
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    style: highlightStyle as never,
    properties: { id: HIGHLIGHT_LAYER_ID },
    // Above every data layer: a highlight that renders under the rivers it
    // points at is not a highlight.
    zIndex: 999,
  });
  map.addLayer(layer);
  layers.set(map, layer);
  return layer;
}

/** Replaces whatever is currently highlighted with `points`. */
export function showHighlights(map: Map, points: HighlightPoint[]): void {
  const source = ensureLayer(map).getSource();
  if (!source) return;
  source.clear();
  source.addFeatures(
    points.map(
      (p) =>
        new Feature({
          geometry: new Point(fromLonLat(p.lonLat)),
          label: p.label ?? '',
        })
    )
  );
}

/** Empties the highlight source. Leaves the (empty) layer in place — removing
 *  and re-adding it on every clear would churn the layer stack for nothing. */
export function clearHighlights(map: Map): void {
  layers.get(map)?.getSource()?.clear();
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test:web -- highlightLayer`
Expected: PASS (7 tests).

- [ ] **Step 9: Write the failing executor tests**

Append to `apps/web/src/features/map/model/mapCommands.test.ts`:

```typescript
describe('createCommandExecutor — highlights', () => {
  it('highlightFeatures draws the points and reports how many', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({
      kind: 'highlightFeatures',
      points: [{ lonLat: [108.1, 12.7] }, { lonLat: [108.2, 12.8] }],
    });
    expect(result).toEqual({ ok: true, text: 'Đã đánh dấu 2 vị trí trên bản đồ.' });
  });

  it('highlightFeatures fails cleanly when the map is not ready', () => {
    const result = createCommandExecutor(makeDeps({ map: null }))({
      kind: 'highlightFeatures',
      points: [{ lonLat: [108.1, 12.7] }],
    });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });

  it('clearHighlights reports success even with nothing highlighted', () => {
    const result = createCommandExecutor(makeDeps())({ kind: 'clearHighlights' });
    expect(result).toEqual({ ok: true, text: 'Đã xoá đánh dấu.' });
  });
});
```

The shared `makeDeps` helper builds `map` from an object literal with only `getView`; add `addLayer: vi.fn()` to it so the highlight path has the method it calls:

```typescript
  const map = {
    getView: () => ({
      animate,
      getMinZoom: viewOverrides.getMinZoom ?? (() => undefined),
      getMaxZoom: viewOverrides.getMaxZoom ?? (() => undefined),
    }),
    addLayer: vi.fn(),
  } as unknown as CommandDeps['map'];
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npm run test:web -- mapCommands`
Expected: FAIL — the switch has no branch for the new kinds, so TypeScript's exhaustiveness makes `run` return `undefined` for them.

- [ ] **Step 11: Execute the new commands**

In `apps/web/src/features/map/model/mapCommands.ts`, add the import:

```typescript
import { showHighlights, clearHighlights } from './highlightLayer';
```

and the two branches, after `setBasemap`:

```typescript
      case 'highlightFeatures': {
        if (!deps.map) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        showHighlights(deps.map, cmd.points);
        return { ok: true, text: `Đã đánh dấu ${cmd.points.length} vị trí trên bản đồ.` };
      }
      case 'clearHighlights': {
        if (deps.map) clearHighlights(deps.map);
        return { ok: true, text: 'Đã xoá đánh dấu.' };
      }
```

- [ ] **Step 12: Run the web tests and the type gate**

Run: `npm run test:web -- mapCommands highlightLayer`
Expected: PASS.

Run: `npm run build:shared && npm run build:web`
Expected: both succeed with no type errors.

- [ ] **Step 13: Commit**

```bash
git add packages/shared/src/map-commands.ts packages/shared/src/map-commands.test.ts packages/shared/dist apps/web/src/features/map/model/highlightLayer.ts apps/web/src/features/map/model/highlightLayer.test.ts apps/web/src/features/map/model/mapCommands.ts apps/web/src/features/map/model/mapCommands.test.ts
git commit -m "$(cat <<'EOF'
feat(shared,web): lệnh đánh dấu vị trí trên bản đồ cho trợ lý

Plan A cố ý hoãn highlightFeatures vì chưa có nguồn đánh dấu thật.
Lệnh mang toạ độ chứ không mang id đối tượng: mọi công cụ dữ liệu của
trợ lý đều trả lonLat sẵn, nên trình duyệt không phải tra cứu lần hai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The assistant wire contract

One file in `packages/shared` describing everything that crosses the route, plus the parser that splits a reply into grounded text and labelled general knowledge. The parser lives here, not in the API, because the panel view (Task 9) needs the same segment type and the same tag constants to render the callout.

**Files:**
- Create: `packages/shared/src/assistant.ts`
- Create: `packages/shared/src/assistant.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `MapCommand`, `BasemapName` from `./map-commands.js`; `EditableLayerKey` from `./index.js`.
- Produces: `MapContext`, `Provenance`, `ReplySegment`, `AssistantRequest`, `AssistantReply`, `KNOWLEDGE_OPEN_TAG`, `KNOWLEDGE_CLOSE_TAG`, `parseReplySegments(text: string): ReplySegment[]`. Tasks 3, 7, 9 all consume these.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/assistant.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseReplySegments, KNOWLEDGE_OPEN_TAG, KNOWLEDGE_CLOSE_TAG } from './assistant.js';

describe('parseReplySegments', () => {
  it('returns a single grounded segment for plain text', () => {
    expect(parseReplySegments('Có 151 đập trong vùng.')).toEqual([
      { kind: 'grounded', text: 'Có 151 đập trong vùng.' },
    ]);
  });

  it('splits a labelled general-knowledge block out of the surrounding text', () => {
    const raw = `Có 151 đập.${KNOWLEDGE_OPEN_TAG}Đập vòm thường dùng ở hẻm núi hẹp.${KNOWLEDGE_CLOSE_TAG}Bạn cần thêm gì?`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'grounded', text: 'Có 151 đập.' },
      { kind: 'knowledge', text: 'Đập vòm thường dùng ở hẻm núi hẹp.' },
      { kind: 'grounded', text: 'Bạn cần thêm gì?' },
    ]);
  });

  it('handles a reply that is entirely general knowledge', () => {
    const raw = `${KNOWLEDGE_OPEN_TAG}Mùa khô ở Tây Nguyên kéo dài từ tháng 11.${KNOWLEDGE_CLOSE_TAG}`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'knowledge', text: 'Mùa khô ở Tây Nguyên kéo dài từ tháng 11.' },
    ]);
  });

  it('handles more than one knowledge block', () => {
    const raw = `A${KNOWLEDGE_OPEN_TAG}B${KNOWLEDGE_CLOSE_TAG}C${KNOWLEDGE_OPEN_TAG}D${KNOWLEDGE_CLOSE_TAG}`;
    expect(parseReplySegments(raw).map((s) => s.kind)).toEqual([
      'grounded', 'knowledge', 'grounded', 'knowledge',
    ]);
  });

  it('treats an unclosed tag as knowledge to the end — never silently as grounded fact', () => {
    const raw = `Có 151 đập.${KNOWLEDGE_OPEN_TAG}Phần này không đóng thẻ`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'grounded', text: 'Có 151 đập.' },
      { kind: 'knowledge', text: 'Phần này không đóng thẻ' },
    ]);
  });

  it('drops segments that are empty or whitespace only', () => {
    const raw = `${KNOWLEDGE_OPEN_TAG}B${KNOWLEDGE_CLOSE_TAG}   `;
    expect(parseReplySegments(raw)).toEqual([{ kind: 'knowledge', text: 'B' }]);
  });

  it('returns an empty array for an empty reply', () => {
    expect(parseReplySegments('')).toEqual([]);
    expect(parseReplySegments('   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:shared -- assistant`
Expected: FAIL — `Cannot find module './assistant.js'`.

- [ ] **Step 3: Write the contract**

Create `packages/shared/src/assistant.ts`:

```typescript
/**
 * The assistant wire contract: everything that crosses POST /api/assistant/messages,
 * plus the reply parser both sides need.
 *
 * Hand-written, no Zod — this module is imported by the browser bundle. The API
 * validates incoming requests with its own Zod schema (modules/assistant/controller.ts);
 * the types here are the shape both sides agree on.
 */
import type { BasemapName, MapCommand } from './map-commands.js';
import type { EditableLayerKey } from './index.js';

/**
 * What the user is currently looking at. Serialized into the latest user turn —
 * never into the top-level system field, which would invalidate the prompt cache
 * on every message. This is what makes "hồ nào lớn nhất ở đây" resolvable.
 */
export interface MapContext {
  /** Viewport bounds in WGS84 degrees: [west, south, east, north]. */
  bbox: [number, number, number, number];
  zoom: number;
  /** layerStateIds currently visible, e.g. ['layer_dams', 'layer_rivers']. */
  visibleLayerStateIds: string[];
  basemap: BasemapName;
  selectedFeature?: { layerKey: EditableLayerKey; featureId: string; name?: string };
}

/**
 * Where one asserted fact came from. One record per tool call, in call order.
 * `datasetVersion` is the label of the active app.dataset_versions row for the
 * layer, so a reader can tell which map the number describes; null when the tool
 * touched no layer (command tools) or the layer has no active version.
 */
export interface Provenance {
  tool: string;
  layerKey: EditableLayerKey | null;
  rowCount: number;
  datasetVersion: string | null;
  /** Present only for the guarded SQL escape hatch, so a reviewer sees what ran. */
  sql?: string;
}

/**
 * A run of reply text and whether it is grounded in tool results or is the
 * model's own knowledge. The spec requires model knowledge to render in a
 * visually distinct labelled callout rather than italics, which the panel
 * cannot do without knowing where the boundaries are.
 */
export type ReplySegment = { kind: 'grounded' | 'knowledge'; text: string };

export interface AssistantRequest {
  /** Client-generated, opaque. Bound to the authenticated user on first use. */
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export interface AssistantReply {
  segments: ReplySegment[];
  commands: MapCommand[];
  provenance: Provenance[];
}

/** The model is instructed to wrap general knowledge in these. XML-ish tags,
 *  because that is what models emit most reliably, and they are far less likely
 *  to occur in Vietnamese prose than any bracket or punctuation delimiter. */
export const KNOWLEDGE_OPEN_TAG = '<kienthucchung>';
export const KNOWLEDGE_CLOSE_TAG = '</kienthucchung>';

/**
 * Splits a raw reply into grounded and knowledge runs.
 *
 * An unclosed opening tag makes everything after it knowledge, deliberately:
 * a truncated reply must never let unlabelled model knowledge render as though
 * it came from the database.
 */
export function parseReplySegments(text: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  const push = (kind: ReplySegment['kind'], raw: string) => {
    const trimmed = raw.trim();
    if (trimmed) segments.push({ kind, text: trimmed });
  };

  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf(KNOWLEDGE_OPEN_TAG);
    if (open === -1) {
      push('grounded', rest);
      break;
    }
    push('grounded', rest.slice(0, open));
    const afterOpen = rest.slice(open + KNOWLEDGE_OPEN_TAG.length);
    const close = afterOpen.indexOf(KNOWLEDGE_CLOSE_TAG);
    if (close === -1) {
      push('knowledge', afterOpen);
      break;
    }
    push('knowledge', afterOpen.slice(0, close));
    rest = afterOpen.slice(close + KNOWLEDGE_CLOSE_TAG.length);
  }
  return segments;
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add to the export list (after the `map-commands.js` line, so the type-only import inside `assistant.ts` resolves in declaration order):

```typescript
export * from './assistant.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:shared -- assistant`
Expected: PASS (7 tests).

- [ ] **Step 6: Build shared and commit**

Run: `npm run build:shared`
Expected: succeeds; `packages/shared/dist/assistant.js` and `.d.ts` appear.

```bash
git add packages/shared/src/assistant.ts packages/shared/src/assistant.test.ts packages/shared/src/index.ts packages/shared/dist
git commit -m "$(cat <<'EOF'
feat(shared): hợp đồng dữ liệu cho trợ lý bản đồ

MapContext, Provenance, ReplySegment và bộ tách đoạn trả lời. Thẻ
<kienthucchung> chưa đóng được coi là kiến thức chung tới hết câu —
trả lời bị cắt ngang không bao giờ được hiện như dữ liệu tra được.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Route, session store, and budget — no model yet

The whole request path except the model call: authentication, per-user rate limiting, request validation, the session store, the daily token ceiling, and the 503 when no API key is configured. The service is a stub that echoes, so every one of these behaviours is testable now, without spending a token.

**Files:**
- Create: `apps/api/src/modules/assistant/routes.ts`
- Create: `apps/api/src/modules/assistant/controller.ts`
- Create: `apps/api/src/modules/assistant/service.ts`
- Create: `apps/api/src/modules/assistant/sessionStore.ts`
- Create: `apps/api/src/modules/assistant/sessionStore.test.ts`
- Create: `apps/api/src/modules/assistant/budget.ts`
- Create: `apps/api/src/modules/assistant/budget.test.ts`
- Create: `apps/api/src/modules/assistant/assistant.route.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `app.authenticate` (from `plugins/authentication.ts`), `authorize` + `CAN_READ_FEATURES` (from `hooks/`), `validate` (from `lib/validate.ts`), `AppError` family (from `errors/`), `AssistantRequest`/`AssistantReply`/`MapContext` (from `@webatlas/shared`).
- Produces: `sessionStore` — `{ get(sessionId, userId), append(sessionId, userId, turns), size() }` returning `Turn[]`; `budget` — `{ check(userId), record(userId, tokens), used(userId) }`; `runAssistant(deps): Promise<AssistantReply>` in `service.ts`. Task 7 replaces the body of `runAssistant`; Tasks 4-6 register tools it calls.

- [ ] **Step 1: Write the failing session-store test**

Create `apps/api/src/modules/assistant/sessionStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSessionStore, type Turn } from './sessionStore';

const A: Turn[] = [{ role: 'user', content: 'xin chào' }];
const B: Turn[] = [{ role: 'assistant', content: 'chào bạn' }];

describe('createSessionStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns an empty history for an unknown session', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    expect(store.get('s1', 'u1')).toEqual([]);
  });

  it('accumulates turns across calls', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    store.append('s1', 'u1', B);
    expect(store.get('s1', 'u1')).toEqual([...A, ...B]);
  });

  it('keeps sessions of different users apart even under the same id', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('shared-id', 'u1', A);
    // u2 presenting u1's session id must not read u1's conversation.
    expect(store.get('shared-id', 'u2')).toEqual([]);
  });

  it('refuses to append to another user session and starts a fresh one', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('shared-id', 'u1', A);
    store.append('shared-id', 'u2', B);
    expect(store.get('shared-id', 'u1')).toEqual(A);
    expect(store.get('shared-id', 'u2')).toEqual(B);
  });

  it('expires a session once the TTL has elapsed since its last use', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    vi.advanceTimersByTime(1001);
    expect(store.get('s1', 'u1')).toEqual([]);
  });

  it('use refreshes the TTL', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    vi.advanceTimersByTime(800);
    store.append('s1', 'u1', B);
    vi.advanceTimersByTime(800);
    expect(store.get('s1', 'u1')).toHaveLength(2);
  });

  it('drops the oldest turns beyond maxTurns', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 3 });
    for (const n of ['1', '2', '3', '4']) {
      store.append('s1', 'u1', [{ role: 'user', content: n }]);
    }
    expect(store.get('s1', 'u1').map((t) => t.content)).toEqual(['2', '3', '4']);
  });

  it('sweeps expired sessions out of memory rather than leaking them', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    store.append('s2', 'u2', A);
    expect(store.size()).toBe(2);
    vi.advanceTimersByTime(1001);
    store.get('s3', 'u3');
    expect(store.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- sessionStore`
Expected: FAIL — `Cannot find module './sessionStore'`.

- [ ] **Step 3: Write the session store**

Create `apps/api/src/modules/assistant/sessionStore.ts`:

```typescript
/**
 * Multi-turn memory, in memory, per the spec: not persisted across restarts and
 * not shared between processes. The message array is stored as plain text turns,
 * NOT as raw SDK content blocks — a stored tool_use block would oblige us to
 * store a matching tool_result block or the next request would be rejected, and
 * replaying old tool results teaches the model nothing the fresh call cannot
 * re-derive. History is what was said, not how it was computed.
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  userId: string;
  turns: Turn[];
  lastUsedAt: number;
}

export interface SessionStoreOptions {
  ttlMs: number;
  maxTurns: number;
}

export function createSessionStore({ ttlMs, maxTurns }: SessionStoreOptions) {
  const sessions = new Map<string, Session>();

  function sweep(now: number): void {
    for (const [id, s] of sessions) {
      if (now - s.lastUsedAt > ttlMs) sessions.delete(id);
    }
  }

  /**
   * A session id is client-generated and therefore guessable. Binding the
   * session to the user who created it means presenting someone else's id
   * yields an empty conversation, not theirs.
   */
  function live(sessionId: string, userId: string, now: number): Session | undefined {
    const s = sessions.get(sessionId);
    if (!s) return undefined;
    if (s.userId !== userId) return undefined;
    if (now - s.lastUsedAt > ttlMs) {
      sessions.delete(sessionId);
      return undefined;
    }
    return s;
  }

  return {
    get(sessionId: string, userId: string): Turn[] {
      const now = Date.now();
      sweep(now);
      const s = live(sessionId, userId, now);
      if (!s) return [];
      s.lastUsedAt = now;
      return s.turns;
    },

    append(sessionId: string, userId: string, turns: Turn[]): void {
      const now = Date.now();
      sweep(now);
      const existing = live(sessionId, userId, now);
      // No existing session, or one owned by someone else: start a fresh one.
      // Overwriting the other user's entry is safe — they cannot read ours
      // either, and the id is theirs to re-create.
      const s = existing ?? { userId, turns: [], lastUsedAt: now };
      s.turns = [...s.turns, ...turns].slice(-maxTurns);
      s.lastUsedAt = now;
      sessions.set(sessionId, s);
    },

    size(): number {
      return sessions.size;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:api -- sessionStore`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing budget test**

Create `apps/api/src/modules/assistant/budget.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBudget } from './budget';

describe('createBudget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a fresh user as under the ceiling', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    expect(budget.check('u1')).toEqual({ allowed: true, used: 0, limit: 1000 });
  });

  it('accumulates recorded tokens per user', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 400);
    budget.record('u1', 100);
    budget.record('u2', 900);
    expect(budget.check('u1').used).toBe(500);
    expect(budget.check('u2').used).toBe(900);
  });

  it('blocks once the ceiling is reached', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1000);
    expect(budget.check('u1').allowed).toBe(false);
  });

  it('blocks a user who overshot the ceiling on the last call', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1500);
    expect(budget.check('u1')).toEqual({ allowed: false, used: 1500, limit: 1000 });
  });

  it('resets at the UTC day boundary', () => {
    vi.setSystemTime(new Date('2026-09-08T23:59:00Z'));
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1000);
    expect(budget.check('u1').allowed).toBe(false);
    vi.setSystemTime(new Date('2026-09-09T00:01:00Z'));
    expect(budget.check('u1')).toEqual({ allowed: true, used: 0, limit: 1000 });
  });

  it('treats a ceiling of 0 as unlimited so the feature can be run without a cap', () => {
    const budget = createBudget({ dailyTokens: 0 });
    budget.record('u1', 999999);
    expect(budget.check('u1').allowed).toBe(true);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:api -- budget`
Expected: FAIL — `Cannot find module './budget'`.

- [ ] **Step 7: Write the budget**

Create `apps/api/src/modules/assistant/budget.ts`:

```typescript
/**
 * Per-user daily token ceiling. The spec's first recorded risk is unbounded
 * per-user API cost; this is the day-one mitigation it asks for.
 *
 * In memory and per process, like the session store: a restart forgives the
 * day's spend. That is a real limit, documented in the runbook, and still far
 * better than no ceiling. Counting resets on the UTC day boundary, not a rolling
 * window, so a user always knows when their allowance returns.
 */
export interface BudgetOptions {
  /** Tokens per user per UTC day. 0 means unlimited. */
  dailyTokens: number;
}

export interface BudgetStatus {
  allowed: boolean;
  used: number;
  limit: number;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function createBudget({ dailyTokens }: BudgetOptions) {
  let day = utcDay(Date.now());
  let used = new Map<string, number>();

  function rollover(): void {
    const today = utcDay(Date.now());
    if (today !== day) {
      day = today;
      used = new Map();
    }
  }

  return {
    check(userId: string): BudgetStatus {
      rollover();
      const spent = used.get(userId) ?? 0;
      return {
        allowed: dailyTokens === 0 || spent < dailyTokens,
        used: spent,
        limit: dailyTokens,
      };
    },

    /** Called after a turn completes, with input + output tokens. */
    record(userId: string, tokens: number): void {
      rollover();
      used.set(userId, (used.get(userId) ?? 0) + tokens);
    },
  };
}

export type Budget = ReturnType<typeof createBudget>;
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm run test:api -- budget`
Expected: PASS (6 tests).

- [ ] **Step 9: Add the environment settings**

In `apps/api/src/config/env.ts`, add to `EnvSchema` (before `NODE_ENV`):

```typescript
  // Optional: env.ts parses at import time and every API test builds the app,
  // so a required key would break the whole suite and every dev machine that
  // has not been given one. The route returns 503 when it is absent.
  ANTHROPIC_API_KEY: z.string().optional(),
  ASSISTANT_MODEL: z.string().default('claude-haiku-4-5'),
  /** Tokens per user per UTC day. 0 disables the ceiling. */
  ASSISTANT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(200000),
  ASSISTANT_SESSION_TTL_MS: z.coerce.number().int().min(60000).default(1800000),
  /** Connection string for the read-only webatlas_assistant role (Task 8). */
  ASSISTANT_DATABASE_URL: z.string().url().optional(),
```

In `apps/api/.env.example`, add at the end:

```
# Assistant (Plan B). Without ANTHROPIC_API_KEY the route returns 503.
ANTHROPIC_API_KEY=
ASSISTANT_MODEL=claude-haiku-4-5
ASSISTANT_DAILY_TOKEN_BUDGET=200000
ASSISTANT_SESSION_TTL_MS=1800000
# Read-only role created by the assistant-db-role migration (Task 8).
ASSISTANT_DATABASE_URL=postgres://webatlas_assistant:change_me_dev@localhost:5432/webatlas
```

- [ ] **Step 10: Write the failing route test**

Create `apps/api/src/modules/assistant/assistant.route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import type { MapContext } from '@webatlas/shared';

let app: ReturnType<typeof buildApp>;
let token: string;

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  // The seeded admin from `npm run create-admin`; the same account the other
  // authenticated API tests use.
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: process.env.TEST_ADMIN_EMAIL ?? 'admin@webatlas.test', password: process.env.TEST_ADMIN_PASSWORD ?? 'change_me_dev' },
  });
  token = (res.json() as { token: string }).token;
});
afterAll(async () => {
  await app.close();
});

function post(payload: unknown, auth = true) {
  return app.inject({
    method: 'POST',
    url: '/api/assistant/messages',
    headers: auth ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
}

describe('POST /api/assistant/messages', () => {
  it('rejects an anonymous request', async () => {
    const res = await post({ sessionId: 's1', message: 'xin chào', mapContext: MAP_CONTEXT }, false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing message', async () => {
    const res = await post({ sessionId: 's1', mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty message', async () => {
    const res = await post({ sessionId: 's1', message: '   ', mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a message beyond the length cap', async () => {
    const res = await post({ sessionId: 's1', message: 'a'.repeat(2001), mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed bbox', async () => {
    const res = await post({
      sessionId: 's1',
      message: 'xin chào',
      mapContext: { ...MAP_CONTEXT, bbox: [107.5, 12.0, 109.0] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown basemap', async () => {
    const res = await post({
      sessionId: 's1',
      message: 'xin chào',
      mapContext: { ...MAP_CONTEXT, basemap: 'moon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers an authenticated, well-formed request', async () => {
    const res = await post({ sessionId: 's1', message: 'xin chào', mapContext: MAP_CONTEXT });
    // 503 is the correct answer on a machine with no ANTHROPIC_API_KEY set;
    // 200 on one that has it. Both are pass conditions — what must never
    // happen is a 4xx or a 500.
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 503) {
      expect((res.json() as { error: { code: string } }).error.code).toBe('ASSISTANT_UNAVAILABLE');
    } else {
      const body = res.json() as { segments: unknown[]; commands: unknown[]; provenance: unknown[] };
      expect(Array.isArray(body.segments)).toBe(true);
      expect(Array.isArray(body.commands)).toBe(true);
      expect(Array.isArray(body.provenance)).toBe(true);
    }
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npm run test:api -- assistant.route`
Expected: FAIL — every request 404s; the route does not exist.

- [ ] **Step 12: Write the stub service**

Create `apps/api/src/modules/assistant/service.ts`:

```typescript
import type { Pool } from 'pg';
import type { AssistantReply, MapContext } from '@webatlas/shared';
import { config } from '../../config/env';
import { createSessionStore } from './sessionStore';
import { createBudget } from './budget';

export const sessionStore = createSessionStore({
  ttlMs: config.ASSISTANT_SESSION_TTL_MS,
  maxTurns: 20,
});

export const budget = createBudget({ dailyTokens: config.ASSISTANT_DAILY_TOKEN_BUDGET });

export interface AssistantDeps {
  pool: Pool;
  userId: string;
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

/**
 * Task 7 replaces this body with the Tool Runner loop. Until then the route,
 * its auth, its validation, its rate limit, the session store and the budget
 * are all exercised end to end without spending a token.
 */
export async function runAssistant(deps: AssistantDeps): Promise<AssistantReply> {
  const history = sessionStore.get(deps.sessionId, deps.userId);
  const reply = `Đã nhận: "${deps.message}" (${history.length} lượt trước đó).`;
  sessionStore.append(deps.sessionId, deps.userId, [
    { role: 'user', content: deps.message },
    { role: 'assistant', content: reply },
  ]);
  return { segments: [{ kind: 'grounded', text: reply }], commands: [], provenance: [] };
}
```

- [ ] **Step 13: Write the controller**

Create `apps/api/src/modules/assistant/controller.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BASEMAP_TYPES, EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { AppError, AuthError } from '../../errors';
import { config } from '../../config/env';
import { runAssistant, budget } from './service';

const MapContextSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  zoom: z.number().min(0).max(24),
  visibleLayerStateIds: z.array(z.string()).max(32),
  basemap: z.enum(BASEMAP_TYPES),
  selectedFeature: z
    .object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string().max(128),
      name: z.string().max(256).optional(),
    })
    .optional(),
});

const MessageBody = z.object({
  sessionId: z.string().min(1).max(128),
  // 2000 chars is far more than any real question and keeps a pathological
  // paste from becoming an expensive prompt.
  message: z.string().trim().min(1, 'Câu hỏi không được để trống').max(2000),
  mapContext: MapContextSchema,
});

export async function postMessage(req: FastifyRequest, reply: FastifyReply) {
  if (!req.currentUser) throw new AuthError();
  const { sessionId, message, mapContext } = validate(MessageBody, req.body);

  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(
      503,
      'ASSISTANT_UNAVAILABLE',
      'Trợ lý chưa được cấu hình trên máy chủ này.'
    );
  }

  const status = budget.check(req.currentUser.id);
  if (!status.allowed) {
    throw new AppError(
      429,
      'ASSISTANT_BUDGET_EXCEEDED',
      'Bạn đã dùng hết hạn mức trợ lý trong ngày. Vui lòng thử lại sau 00:00 UTC.',
      { used: status.used, limit: status.limit }
    );
  }

  const result = await runAssistant({
    pool: req.server.pg,
    userId: req.currentUser.id,
    sessionId,
    message,
    mapContext,
  });
  reply.send(result);
}
```

- [ ] **Step 14: Write the routes**

Create `apps/api/src/modules/assistant/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { CAN_READ_FEATURES } from '../../hooks/capabilities';
import { postMessage } from './controller';

export default async function assistantRoutes(app: FastifyInstance) {
  app.post(
    '/assistant/messages',
    {
      preHandler: [app.authenticate, authorize(...CAN_READ_FEATURES)],
      config: {
        // Tighter than the global 100/min and keyed per user rather than per IP:
        // every message costs API tokens, and a shared office IP must not let one
        // user's burst throttle the rest. The daily ceiling in budget.ts is the
        // cost bound; this is the burst bound.
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: { currentUser?: { id: string }; ip: string }) =>
            req.currentUser?.id ?? req.ip,
        },
      },
    },
    postMessage
  );
}
```

- [ ] **Step 15: Register the routes**

In `apps/api/src/server.ts`, add the import beside the others:

```typescript
import assistantRoutes from './modules/assistant/routes';
```

and the registration after `searchRoutes`:

```typescript
  app.register(assistantRoutes, { prefix: '/api' });
```

- [ ] **Step 16: Run the route test to verify it passes**

Run: `npm run test:api -- assistant.route`
Expected: PASS (7 tests). The final test passes as 503 when no `ANTHROPIC_API_KEY` is set.

- [ ] **Step 17: Run the whole API suite**

Run: `npm run test:api`
Expected: PASS — nothing else regressed.

- [ ] **Step 18: Commit**

```bash
git add apps/api/src/modules/assistant apps/api/src/config/env.ts apps/api/src/server.ts apps/api/.env.example
git commit -m "$(cat <<'EOF'
feat(api): tuyến trợ lý, phiên hội thoại và hạn mức token

Toàn bộ đường đi của yêu cầu trừ lời gọi mô hình: xác thực, giới hạn
tần suất theo người dùng, kiểm tra dữ liệu vào, phiên có TTL gắn với
người tạo, và trần token mỗi ngày. Chưa cấu hình khoá thì trả 503.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The tool registry and the command tools

The tool layer's shape: one file per tool exporting a factory, one registry that assembles them. Command tools emit a `MapCommand` into a per-request collector and return confirmation text to the model — that is what satisfies "tool use acts on the map *and* returns chat text".

Every command tool validates its own output with `isMapCommand` before collecting it. That is not belt-and-braces: the model chooses the arguments, so an out-of-region province code or an unknown `layerStateId` reaches the collector unless something checks.

**Files:**
- Create: `apps/api/src/modules/assistant/tools/types.ts`
- Create: `apps/api/src/modules/assistant/tools/command/zoomToRegion.ts`
- Create: `apps/api/src/modules/assistant/tools/command/zoomToFeature.ts`
- Create: `apps/api/src/modules/assistant/tools/command/setLayerVisible.ts`
- Create: `apps/api/src/modules/assistant/tools/command/setBasemap.ts`
- Create: `apps/api/src/modules/assistant/tools/command/highlightFeatures.ts`
- Create: `apps/api/src/modules/assistant/tools/registry.ts`
- Create: `apps/api/src/modules/assistant/tools/command/command.test.ts`
- Modify: `apps/api/package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `isMapCommand`, `MapCommand`, `REGION_PROVINCE_CODES`, `REGION_PROVINCE_NAMES`, `LAYER_STATE_IDS`, `BASEMAP_TYPES`, `EDITABLE_LAYER_KEYS`, `MAX_HIGHLIGHT_POINTS` from `@webatlas/shared`; `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`.
- Produces: `ToolContext` (`{ pool, mapContext, collect, provenance }`), `type ToolFactory = (ctx: ToolContext) => BetaRunnableTool`, `buildTools(ctx): BetaRunnableTool[]`, and one factory per file (`zoomToRegionTool`, `zoomToFeatureTool`, `setLayerVisibleTool`, `setBasemapTool`, `highlightFeaturesTool`). Tasks 5, 6, 8 add data tools to the same registry; Task 7 calls `buildTools`.

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk@^0.124.0 -w @webatlas/api`
Expected: `apps/api/package.json` gains the dependency and `package-lock.json` updates.

- [ ] **Step 2: Write the tool context**

Create `apps/api/src/modules/assistant/tools/types.ts`:

```typescript
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/helpers/beta/zod';

/**
 * Everything a tool may touch, handed to it per request. Tools are factories
 * over this rather than free functions reading globals, so a test constructs a
 * context and asserts exactly what the tool collected.
 */
export interface ToolContext {
  pool: Pool;
  /** What the user is looking at — resolves "ở đây", "vùng đang xem". */
  mapContext: MapContext;
  /** Command tools push validated MapCommands here, in call order. */
  collect: (command: MapCommand) => void;
  /** Data tools push one record per call here, in call order. */
  provenance: (record: Provenance) => void;
}

export type ToolFactory = (ctx: ToolContext) => BetaRunnableTool;
```

If `BetaRunnableTool` is not the exported name in the installed SDK version, run `npx tsc --noEmit -p apps/api` and take the name the compiler reports from `@anthropic-ai/sdk/helpers/beta/zod`; do not invent one. The rest of this plan refers to it only through `ToolFactory`.

- [ ] **Step 3: Write the failing command-tool tests**

Create `apps/api/src/modules/assistant/tools/command/command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { MapCommand, MapContext } from '@webatlas/shared';
import { isMapCommand } from '@webatlas/shared';
import type { ToolContext } from '../types';
import { zoomToRegionTool } from './zoomToRegion';
import { zoomToFeatureTool } from './zoomToFeature';
import { setLayerVisibleTool } from './setLayerVisible';
import { setBasemapTool } from './setBasemap';
import { highlightFeaturesTool } from './highlightFeatures';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

function makeCtx() {
  const collected: MapCommand[] = [];
  const ctx = {
    pool: {} as ToolContext['pool'],
    mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => collected.push(c)),
    provenance: vi.fn(),
  } satisfies ToolContext;
  return { ctx, collected };
}

/** The runner calls tools through `.run`; these tests call it the same way. */
function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never) as string);
}

describe('command tools', () => {
  it('zoomToRegion collects a valid command and confirms in Vietnamese', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToRegionTool(ctx), { provinceCode: '66' });
    expect(collected).toEqual([{ kind: 'zoomToRegion', provinceCode: '66' }]);
    expect(collected.every(isMapCommand)).toBe(true);
    expect(text).toContain('Đắk Lắk');
  });

  it('zoomToRegion refuses a province outside the working region without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToRegionTool(ctx), { provinceCode: '01' });
    expect(collected).toEqual([]);
    expect(text).toContain('không thuộc vùng công tác');
  });

  it('zoomToFeature collects coordinates the data tools produced', async () => {
    const { ctx, collected } = makeCtx();
    await run(zoomToFeatureTool(ctx), {
      layerKey: 'dams', featureId: 'abc', lon: 108.1, lat: 12.7,
    });
    expect(collected).toEqual([
      { kind: 'zoomToFeature', layerKey: 'dams', featureId: 'abc', lonLat: [108.1, 12.7] },
    ]);
  });

  it('zoomToFeature refuses coordinates outside Vietnam', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToFeatureTool(ctx), {
      layerKey: 'dams', featureId: 'abc', lon: 0, lat: 0,
    });
    expect(collected).toEqual([]);
    expect(text).toContain('Toạ độ không hợp lệ');
  });

  it('setLayerVisible collects a toggle for a known layer', async () => {
    const { ctx, collected } = makeCtx();
    await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_rivers', visible: true });
    expect(collected).toEqual([{ kind: 'setLayerVisible', layerStateId: 'layer_rivers', visible: true }]);
  });

  it('setLayerVisible refuses an unknown layer id without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_nope', visible: true });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có lớp');
  });

  it('setBasemap collects a basemap change', async () => {
    const { ctx, collected } = makeCtx();
    await run(setBasemapTool(ctx), { basemap: 'satellite' });
    expect(collected).toEqual([{ kind: 'setBasemap', basemap: 'satellite' }]);
  });

  it('highlightFeatures collects the points it was given', async () => {
    const { ctx, collected } = makeCtx();
    await run(highlightFeaturesTool(ctx), {
      points: [{ lon: 108.1, lat: 12.7, label: 'Đập A' }],
    });
    expect(collected).toEqual([
      { kind: 'highlightFeatures', points: [{ lonLat: [108.1, 12.7], label: 'Đập A' }] },
    ]);
  });

  it('highlightFeatures drops points outside Vietnam rather than drawing them', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      points: [{ lon: 108.1, lat: 12.7 }, { lon: 0, lat: 0 }],
    });
    expect(collected).toEqual([{ kind: 'highlightFeatures', points: [{ lonLat: [108.1, 12.7] }] }]);
    expect(text).toContain('1');
  });

  it('highlightFeatures collects nothing when every point is invalid', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), { points: [{ lon: 0, lat: 0 }] });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có toạ độ hợp lệ');
  });

  it('every collected command passes the shared validator', async () => {
    const { ctx, collected } = makeCtx();
    await run(zoomToRegionTool(ctx), { provinceCode: '48' });
    await run(setBasemapTool(ctx), { basemap: 'dem' });
    await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_lakes', visible: false });
    expect(collected).toHaveLength(3);
    expect(collected.every(isMapCommand)).toBe(true);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:api -- command.test`
Expected: FAIL — none of the tool modules exist.

- [ ] **Step 5: Write a shared coordinate guard and the first two command tools**

Create `apps/api/src/modules/assistant/tools/command/zoomToRegion.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { REGION_PROVINCE_CODES, REGION_PROVINCE_NAMES, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

export const zoomToRegionTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zoom_to_province',
    description:
      'Move the map to one of the six provinces in the working region. Use when the user names a province.',
    inputSchema: z.object({
      provinceCode: z
        .string()
        .describe(
          `Province code. One of: ${REGION_PROVINCE_CODES.map(
            (c) => `${c} (${REGION_PROVINCE_NAMES[c]})`
          ).join(', ')}`
        ),
    }),
    run: (input) => {
      const command = { kind: 'zoomToRegion' as const, provinceCode: input.provinceCode };
      // The model picks the argument, so the shared validator is the only thing
      // between a hallucinated province code and the map.
      if (!isMapCommand(command)) {
        return `Mã tỉnh ${input.provinceCode} không thuộc vùng công tác. Các tỉnh hợp lệ: ${REGION_PROVINCE_CODES.map(
          (c) => REGION_PROVINCE_NAMES[c]
        ).join(', ')}.`;
      }
      ctx.collect(command);
      return `Đã phóng to tới ${REGION_PROVINCE_NAMES[input.provinceCode]}.`;
    },
  });
```

Create `apps/api/src/modules/assistant/tools/command/zoomToFeature.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

/**
 * Rough Vietnam bounds. `isMapCommand` only checks that lonLat is two finite
 * numbers, so without this a (0, 0) from a null-island row would fly the map
 * into the Atlantic and report success.
 */
export function inVietnam(lon: number, lat: number): boolean {
  return lon >= 102 && lon <= 110 && lat >= 8 && lat <= 24;
}

export const zoomToFeatureTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zoom_to_feature',
    description:
      'Move the map to a single feature. Use the coordinates returned by a data tool; never invent them.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer the feature belongs to'),
      featureId: z.string().describe('Feature id as returned by a data tool'),
      lon: z.number().describe('Longitude in WGS84 degrees, from a data tool result'),
      lat: z.number().describe('Latitude in WGS84 degrees, from a data tool result'),
    }),
    run: (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ do công cụ dữ liệu trả về.';
      }
      const command = {
        kind: 'zoomToFeature' as const,
        layerKey: input.layerKey,
        featureId: input.featureId,
        lonLat: [input.lon, input.lat] as [number, number],
      };
      if (!isMapCommand(command)) return 'Không phóng to được tới đối tượng này.';
      ctx.collect(command);
      return 'Đã phóng to tới đối tượng.';
    },
  });
```

- [ ] **Step 6: Write the remaining three command tools**

Create `apps/api/src/modules/assistant/tools/command/setLayerVisible.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { LAYER_STATE_IDS, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

export const setLayerVisibleTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'set_layer_visible',
    description: 'Turn a map layer on or off.',
    inputSchema: z.object({
      layerStateId: z.string().describe(`Layer id. One of: ${LAYER_STATE_IDS.join(', ')}`),
      visible: z.boolean(),
    }),
    run: (input) => {
      const command = {
        kind: 'setLayerVisible' as const,
        layerStateId: input.layerStateId,
        visible: input.visible,
      };
      if (!isMapCommand(command)) {
        return `Không có lớp dữ liệu nào tên "${input.layerStateId}". Các lớp hợp lệ: ${LAYER_STATE_IDS.join(', ')}.`;
      }
      ctx.collect(command);
      return input.visible ? 'Đã bật lớp dữ liệu.' : 'Đã tắt lớp dữ liệu.';
    },
  });
```

Create `apps/api/src/modules/assistant/tools/command/setBasemap.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { BASEMAP_TYPES, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

const LABELS: Record<string, string> = {
  street: 'bản đồ đường phố',
  satellite: 'ảnh vệ tinh',
  dem: 'mô hình số độ cao',
};

export const setBasemapTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'set_basemap',
    description: 'Change the background map: street, satellite, or elevation (dem).',
    inputSchema: z.object({ basemap: z.enum(BASEMAP_TYPES) }),
    run: (input) => {
      const command = { kind: 'setBasemap' as const, basemap: input.basemap };
      if (!isMapCommand(command)) return 'Nền bản đồ không hợp lệ.';
      ctx.collect(command);
      return `Đã đổi nền sang ${LABELS[input.basemap]}.`;
    },
  });
```

Create `apps/api/src/modules/assistant/tools/command/highlightFeatures.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { MAX_HIGHLIGHT_POINTS, isMapCommand, type HighlightPoint } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from './zoomToFeature';

export const highlightFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'highlight_features',
    description:
      'Mark locations on the map. Use the coordinates returned by a data tool so the user can see which features an answer refers to.',
    inputSchema: z.object({
      points: z
        .array(
          z.object({
            lon: z.number(),
            lat: z.number(),
            label: z.string().optional().describe('Short Vietnamese label, e.g. the feature name'),
          })
        )
        .min(1)
        .max(MAX_HIGHLIGHT_POINTS),
    }),
    run: (input) => {
      const points: HighlightPoint[] = input.points
        .filter((p) => inVietnam(p.lon, p.lat))
        .map((p) => ({
          lonLat: [p.lon, p.lat] as [number, number],
          ...(p.label ? { label: p.label } : {}),
        }));
      if (points.length === 0) {
        return 'Không có toạ độ hợp lệ để đánh dấu — chỉ dùng toạ độ do công cụ dữ liệu trả về.';
      }
      const command = { kind: 'highlightFeatures' as const, points };
      if (!isMapCommand(command)) return 'Không đánh dấu được các vị trí này.';
      ctx.collect(command);
      return `Đã đánh dấu ${points.length} vị trí trên bản đồ.`;
    },
  });
```

- [ ] **Step 7: Write the registry**

Create `apps/api/src/modules/assistant/tools/registry.ts`:

```typescript
import type { ToolContext, ToolFactory } from './types';
import { zoomToRegionTool } from './command/zoomToRegion';
import { zoomToFeatureTool } from './command/zoomToFeature';
import { setLayerVisibleTool } from './command/setLayerVisible';
import { setBasemapTool } from './command/setBasemap';
import { highlightFeaturesTool } from './command/highlightFeatures';

/**
 * The whole tool surface, in a fixed order.
 *
 * Order matters for cost, not behaviour: tool definitions are resent on every
 * turn and sit inside the cached prefix, so a set that reorders itself between
 * requests would miss the cache every time. Adding a capability means adding a
 * file and one line here — never editing a dispatcher.
 *
 * Data tools (Tasks 5, 6) and the SQL escape hatch (Task 8) append below.
 */
const FACTORIES: ToolFactory[] = [
  zoomToRegionTool,
  zoomToFeatureTool,
  setLayerVisibleTool,
  setBasemapTool,
  highlightFeaturesTool,
];

export function buildTools(ctx: ToolContext) {
  return FACTORIES.map((factory) => factory(ctx));
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:api -- command.test`
Expected: PASS (11 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/assistant/tools apps/api/package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(api): sổ đăng ký công cụ và nhóm công cụ điều khiển bản đồ

Mỗi công cụ một tệp, sổ đăng ký chỉ ghép lại — thêm năng lực là thêm
tệp, không sửa bộ điều phối. Mọi lệnh đều đi qua isMapCommand trước
khi được thu thập: mô hình chọn tham số, nên đó là chốt chặn duy nhất.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Data tools, part 1 — the query foundation

The shared query helpers plus the two tools that answer "what is here" and "what is nearest". Measurement runs in PostGIS, not on screen coordinates, so "khoảng cách giữa hai đập là 42,3 km" is authoritative rather than a function of the current projection and zoom.

Every data tool returns compact JSON text to the model and pushes exactly one `Provenance` record per call, carrying the row count and the active `dataset_version` label — so the panel can show which map a number describes.

**Files:**
- Create: `apps/api/src/modules/assistant/tools/data/helpers.ts`
- Create: `apps/api/src/modules/assistant/tools/data/helpers.test.ts`
- Create: `apps/api/src/modules/assistant/tools/data/featuresInView.ts`
- Create: `apps/api/src/modules/assistant/tools/data/nearestFeatures.ts`
- Create: `apps/api/src/modules/assistant/tools/data/data.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`

**Interfaces:**
- Consumes: `ToolContext`, `ToolFactory` (Task 4); `EDITABLE_LAYER_KEYS`, `LAYER_ATTRIBUTE_MAP` from `@webatlas/shared`; `Pool` from `pg`.
- Produces: `layerView(key): string`, `activeVersionLabel(pool, key): Promise<string | null>`, `LAYER_LABELS`, `type FeatureRow = { featureId: string; name: string | null; lon: number; lat: number }`, `featuresInViewTool`, `nearestFeaturesTool`. Task 6 consumes `layerView`, `activeVersionLabel`, `LAYER_LABELS`, `FeatureRow`.

- [ ] **Step 1: Write the failing helper test**

Create `apps/api/src/modules/assistant/tools/data/helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getPool, closePool } from '../../../../db/pool';
import { layerView, activeVersionLabel, LAYER_LABELS, isFeatureId } from './helpers';

describe('layerView', () => {
  it('maps a layer key to its active-version view', () => {
    expect(layerView('dams')).toBe('water.dams_active');
    expect(layerView('flood_zones')).toBe('water.flood_zones_active');
  });

  it('throws on anything outside EDITABLE_LAYER_KEYS rather than interpolating it', () => {
    // The layer key reaches this function from a model-chosen tool argument.
    // It is interpolated into SQL, so an unknown key must never get through.
    expect(() => layerView('users; DROP TABLE app.users' as never)).toThrow();
    expect(() => layerView('provinces' as never)).toThrow();
  });

  it('has a Vietnamese label for every layer key', () => {
    for (const key of Object.keys(LAYER_LABELS)) {
      expect(LAYER_LABELS[key as keyof typeof LAYER_LABELS].length).toBeGreaterThan(0);
    }
  });
});

describe('isFeatureId', () => {
  it('accepts a uuid in either case', () => {
    expect(isFeatureId('3f8a1c2d-4b5e-6f70-8192-a3b4c5d6e7f8')).toBe(true);
    expect(isFeatureId('3F8A1C2D-4B5E-6F70-8192-A3B4C5D6E7F8')).toBe(true);
  });

  it('rejects anything that would make Postgres raise 22P02 instead of returning no rows', () => {
    expect(isFeatureId('not-a-uuid')).toBe(false);
    expect(isFeatureId('')).toBe(false);
    expect(isFeatureId("1' OR '1'='1")).toBe(false);
  });
});

describe('activeVersionLabel', () => {
  it('returns the label of the active dataset version for a seeded layer', async () => {
    const label = await activeVersionLabel(getPool(), 'dams');
    expect(typeof label).toBe('string');
    expect((label ?? '').length).toBeGreaterThan(0);
    await closePool();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- helpers.test`
Expected: FAIL — `Cannot find module './helpers'`.

- [ ] **Step 3: Write the helpers**

Create `apps/api/src/modules/assistant/tools/data/helpers.ts`:

```typescript
import type { Pool } from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/** How many rows any single data tool will list. Beyond this the model is
 *  reading a table out loud rather than answering a question, and the tokens
 *  are wasted. Counts are still reported in full. */
export const ROW_LIMIT = 25;

/**
 * The active-version view for a layer.
 *
 * The key arrives as a model-chosen tool argument and is interpolated into SQL
 * (a table name cannot be a bind parameter), so it is checked against the known
 * key set first. This is the only place in the data tools where any part of a
 * query is built from a tool argument that is not a bind parameter.
 */
export function layerView(key: EditableLayerKey): string {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown layer key: ${String(key)}`);
  }
  return `water.${key}_active`;
}

/** Vietnamese layer names for the model's replies — it must not translate
 *  layer keys itself and invent a name the UI never uses. */
export const LAYER_LABELS: Record<EditableLayerKey, string> = {
  dams: 'đập & hồ chứa',
  rivers: 'sông ngòi',
  lakes: 'hồ',
  stations: 'trạm quan trắc',
  flood_zones: 'vùng ngập lụt',
  drought_points: 'điểm hạn hán',
  saltwater_intrusion: 'điểm xâm nhập mặn',
  flood_generation: 'vùng sinh lũ',
};

/** One row as every list-shaped data tool reports it. */
export interface FeatureRow {
  featureId: string;
  name: string | null;
  lon: number;
  lat: number;
}

/**
 * The label of the layer's active dataset version — what the provenance chip
 * shows, so a reader can tell which map a number describes. Null when the layer
 * has no active version (an un-ingested layer), which is itself worth showing.
 */
export async function activeVersionLabel(
  pool: Pool,
  key: EditableLayerKey
): Promise<string | null> {
  const { rows } = await pool.query<{ label: string }>(
    'SELECT label FROM app.dataset_versions WHERE layer_key = $1 AND is_active LIMIT 1',
    [key]
  );
  return rows[0]?.label ?? null;
}

/** A representative point for any geometry type — ST_PointOnSurface keeps line
 *  and polygon results navigable, the same choice modules/search made. */
export const POINT_SQL = 'ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat';

/**
 * Feature ids are uuids and arrive as model-chosen tool arguments. A malformed
 * one makes Postgres raise 22P02 rather than return no rows, which reaches the
 * model as a database error instead of an honest "no such feature".
 */
export function isFeatureId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:api -- helpers.test`
Expected: PASS (6 tests). Requires the dev database with seeded dams.

- [ ] **Step 5: Write the failing data-tool tests**

Create `apps/api/src/modules/assistant/tools/data/data.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { featuresInViewTool } from './featuresInView';
import { nearestFeaturesTool } from './nearestFeatures';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

/** The Central Highlands / south-central coast working region. */
const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

function makeCtx(mapContext: MapContext = MAP_CONTEXT) {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool,
    mapContext,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

describe('features_in_view', () => {
  it('counts and lists dams inside the current viewport', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    const parsed = JSON.parse(text) as { count: number; rows: Array<{ lon: number; lat: number }> };
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows[0].lon).toBeGreaterThan(100);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: 'features_in_view', layerKey: 'dams' });
    expect(records[0].rowCount).toBe(parsed.count);
  });

  it('caps the listed rows without capping the count', async () => {
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(featuresInViewTool(ctx), { layerKey: 'rivers' })) as {
      count: number; rows: unknown[];
    };
    expect(parsed.rows.length).toBeLessThanOrEqual(25);
    expect(parsed.count).toBeGreaterThanOrEqual(parsed.rows.length);
  });

  it('reports no data rather than an empty structure when the viewport is empty', async () => {
    // A viewport in the South China Sea: valid, and genuinely contains nothing.
    const { ctx, records } = makeCtx({ ...MAP_CONTEXT, bbox: [115.0, 10.0, 116.0, 11.0] });
    const text = await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    expect(text).toContain('Không có dữ liệu');
    expect(records[0].rowCount).toBe(0);
  });

  it('records the active dataset version in provenance', async () => {
    const { ctx, records } = makeCtx();
    await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    expect(typeof records[0].datasetVersion).toBe('string');
  });
});

describe('nearest_features', () => {
  it('returns features ordered by distance, in kilometres', async () => {
    const { ctx, records } = makeCtx();
    // Buôn Ma Thuột, roughly centre of the working region.
    const text = await run(nearestFeaturesTool(ctx), { layerKey: 'dams', lon: 108.05, lat: 12.68, limit: 5 });
    const parsed = JSON.parse(text) as { rows: Array<{ distanceKm: number }> };
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThanOrEqual(5);
    const distances = parsed.rows.map((r) => r.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(records[0]).toMatchObject({ tool: 'nearest_features', layerKey: 'dams' });
  });

  it('refuses coordinates outside Vietnam without querying', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(nearestFeaturesTool(ctx), { layerKey: 'dams', lon: 0, lat: 0, limit: 5 });
    expect(text).toContain('Toạ độ không hợp lệ');
    expect(records).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:api -- data.test`
Expected: FAIL — neither tool module exists.

- [ ] **Step 7: Write `features_in_view`**

Create `apps/api/src/modules/assistant/tools/data/featuresInView.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, layerView } from './helpers';

export const featuresInViewTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'features_in_view',
    description:
      'Count and list the features of one layer inside a map area. Defaults to what the user is currently looking at. Use this for "here", "in this area", "on screen".',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      bbox: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe('[west, south, east, north] in WGS84 degrees. Omit to use the current viewport.'),
    }),
    run: async (input) => {
      const bbox = input.bbox ?? ctx.mapContext.bbox;
      const view = layerView(input.layerKey);
      const envelope = 'ST_MakeEnvelope($1, $2, $3, $4, 4326)';

      const { rows: countRows } = await ctx.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${view} WHERE geom && ${envelope}`,
        bbox
      );
      const count = Number(countRows[0].n);

      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${POINT_SQL}
           FROM ${view}
          WHERE geom && ${envelope}
          ORDER BY name NULLS LAST
          LIMIT ${ROW_LIMIT}`,
        bbox
      );

      ctx.provenance({
        tool: 'features_in_view',
        layerKey: input.layerKey,
        rowCount: count,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      // The spec's one guard on top of soft grounding: a tool that exists for
      // the question and finds nothing must say so, so the model reports "no
      // data" instead of filling the silence from its own knowledge.
      if (count === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.layerKey]} nào trong khu vực này.`;
      }
      return JSON.stringify({ layerKey: input.layerKey, bbox, count, listed: rows.length, rows });
    },
  });
```

- [ ] **Step 8: Write `nearest_features`**

Create `apps/api/src/modules/assistant/tools/data/nearestFeatures.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../command/zoomToFeature';
import { LAYER_LABELS, POINT_SQL, activeVersionLabel, layerView } from './helpers';

export const nearestFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'nearest_features',
    description:
      'Find the features of one layer closest to a point, with distances in kilometres. Use for "nearest", "closest to", "around".',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      lon: z.number().describe('Longitude in WGS84 degrees'),
      lat: z.number().describe('Latitude in WGS84 degrees'),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ trong lãnh thổ Việt Nam do công cụ dữ liệu trả về.';
      }
      const view = layerView(input.layerKey);
      // Distance on the spheroid (::geography), not in degrees: a degree of
      // longitude is ~109 km at the equator and the answer is quoted in km.
      // The ORDER BY uses the same expression so the KNN order and the reported
      // distance can never disagree.
      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${POINT_SQL},
                round((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM ${view}
          ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          LIMIT $3`,
        [input.lon, input.lat, input.limit]
      );

      ctx.provenance({
        tool: 'nearest_features',
        layerKey: input.layerKey,
        rowCount: rows.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      if (rows.length === 0) {
        return `Không có dữ liệu: lớp ${LAYER_LABELS[input.layerKey]} chưa có đối tượng nào.`;
      }
      return JSON.stringify({ layerKey: input.layerKey, from: [input.lon, input.lat], rows });
    },
  });
```

- [ ] **Step 9: Register both tools**

In `apps/api/src/modules/assistant/tools/registry.ts`, add the imports and extend `FACTORIES`:

```typescript
import { featuresInViewTool } from './data/featuresInView';
import { nearestFeaturesTool } from './data/nearestFeatures';
```

```typescript
const FACTORIES: ToolFactory[] = [
  zoomToRegionTool,
  zoomToFeatureTool,
  setLayerVisibleTool,
  setBasemapTool,
  highlightFeaturesTool,
  featuresInViewTool,
  nearestFeaturesTool,
];
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm run test:api -- data.test helpers.test`
Expected: PASS (10 tests).

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/assistant/tools
git commit -m "$(cat <<'EOF'
feat(api): nền truy vấn và hai công cụ dữ liệu đầu tiên

features_in_view và nearest_features. Đo bằng PostGIS trên ::geography
nên khoảng cách là số thật, không phụ thuộc phép chiếu màn hình. Khoá
lớp là tham số do mô hình chọn nên được đối chiếu trước khi ghép vào SQL.
Truy vấn không có dòng nào thì trả "Không có dữ liệu" — mô hình phải báo
thiếu dữ liệu chứ không được tự lấp bằng kiến thức chung.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Data tools, part 2 — measurement, filtering, relationships

The four tools that make the assistant more than a search box: distance between two named features, area of a polygon feature, attribute filtering, and "what of layer B is within X km of this feature of layer A" — the spec's `relatedFeatures`, answered with spatial predicates rather than a relationship model (see the resolutions at the top of this plan).

**Files:**
- Create: `apps/api/src/modules/assistant/tools/data/distanceBetween.ts`
- Create: `apps/api/src/modules/assistant/tools/data/areaOf.ts`
- Create: `apps/api/src/modules/assistant/tools/data/filterByAttribute.ts`
- Create: `apps/api/src/modules/assistant/tools/data/relatedFeatures.ts`
- Create: `apps/api/src/modules/assistant/tools/data/data2.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`

**Interfaces:**
- Consumes: `layerView`, `activeVersionLabel`, `LAYER_LABELS`, `POINT_SQL`, `ROW_LIMIT` (Task 5); `ToolFactory` (Task 4).
- Produces: `distanceBetweenTool`, `areaOfTool`, `filterByAttributeTool`, `relatedFeaturesTool`, and `FILTERABLE_COLUMNS`. Task 7 exposes all of them through the registry; nothing else consumes them.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/assistant/tools/data/data2.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { distanceBetweenTool } from './distanceBetween';
import { areaOfTool } from './areaOf';
import { filterByAttributeTool, FILTERABLE_COLUMNS } from './filterByAttribute';
import { relatedFeaturesTool } from './relatedFeatures';

let pool: Pool;
let damIds: string[] = [];
let lakeId: string | undefined;

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

beforeAll(async () => {
  pool = getPool();
  const dams = await pool.query<{ id: string }>(
    'SELECT id::text AS id FROM water.dams_active ORDER BY name LIMIT 2'
  );
  damIds = dams.rows.map((r) => r.id);
  const lakes = await pool.query<{ id: string }>(
    'SELECT id::text AS id FROM water.lakes_active ORDER BY area_km2 DESC NULLS LAST LIMIT 1'
  );
  lakeId = lakes.rows[0]?.id;
});
afterAll(async () => { await closePool(); });

function makeCtx() {
  const records: Provenance[] = [];
  const ctx = {
    pool,
    mapContext: MAP_CONTEXT,
    collect: vi.fn(),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

describe('distance_between', () => {
  it('measures between two real dams in kilometres', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: damIds[0],
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    const parsed = JSON.parse(text) as { distanceKm: number };
    expect(parsed.distanceKm).toBeGreaterThan(0);
    // Two dams in one working region are never a whole hemisphere apart; this
    // catches a degrees-instead-of-metres regression, which would read as ~0.
    expect(parsed.distanceKm).toBeLessThan(2000);
    expect(records[0]).toMatchObject({ tool: 'distance_between' });
  });

  it('reports no data for an unknown feature id instead of measuring from nothing', async () => {
    const { ctx } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: '00000000-0000-0000-0000-000000000000',
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    expect(text).toContain('Không có dữ liệu');
  });

  it('rejects a malformed feature id without throwing a database error', async () => {
    const { ctx } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: 'not-a-uuid',
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    expect(text).toContain('Không có dữ liệu');
  });
});

describe('area_of', () => {
  it('measures a lake in square kilometres', async () => {
    if (!lakeId) return;
    const { ctx, records } = makeCtx();
    const parsed = JSON.parse(await run(areaOfTool(ctx), { layerKey: 'lakes', featureId: lakeId })) as {
      areaKm2: number;
    };
    expect(parsed.areaKm2).toBeGreaterThan(0);
    expect(records[0]).toMatchObject({ tool: 'area_of', layerKey: 'lakes' });
  });

  it('refuses a point layer, which has no area', async () => {
    const { ctx } = makeCtx();
    const text = await run(areaOfTool(ctx), { layerKey: 'dams', featureId: damIds[0] });
    expect(text).toContain('không có diện tích');
  });
});

describe('filter_by_attribute', () => {
  it('exposes a column allowlist for every layer', () => {
    expect(Object.keys(FILTERABLE_COLUMNS)).toHaveLength(8);
  });

  it('filters dams by operational status', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'status', value: 'Operating',
    });
    // Either matches or an explicit no-data answer — both are correct; what
    // must not happen is an error or a silent empty structure.
    expect(text.startsWith('{') || text.includes('Không có dữ liệu')).toBe(true);
    expect(records[0]).toMatchObject({ tool: 'filter_by_attribute', layerKey: 'dams' });
  });

  it('refuses a column outside the allowlist without querying', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'created_by', value: 'x',
    });
    expect(text).toContain('Không lọc được theo');
    expect(records).toHaveLength(0);
  });

  it('refuses a column that belongs to a different layer', async () => {
    const { ctx } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'lake_type', value: 'x',
    });
    expect(text).toContain('Không lọc được theo');
  });
});

describe('related_features', () => {
  it('finds features of another layer within a radius of a feature', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: damIds[0], relatedLayerKey: 'rivers', radiusKm: 25,
    });
    expect(text.startsWith('{') || text.includes('Không có dữ liệu')).toBe(true);
    expect(records[0]).toMatchObject({ tool: 'related_features', layerKey: 'rivers' });
  });

  it('caps the radius so a runaway query cannot scan the whole layer', async () => {
    const { ctx } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: damIds[0], relatedLayerKey: 'rivers', radiusKm: 5000,
    });
    expect(text).toContain('Bán kính tối đa');
  });

  it('reports no data for an unknown anchor feature', async () => {
    const { ctx } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000',
      relatedLayerKey: 'rivers', radiusKm: 10,
    });
    expect(text).toContain('Không có dữ liệu');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- data2.test`
Expected: FAIL — none of the four modules exist.

- [ ] **Step 3: Write `distance_between`**

Create `apps/api/src/modules/assistant/tools/data/distanceBetween.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { activeVersionLabel, isFeatureId, layerView } from './helpers';

export const distanceBetweenTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'distance_between',
    description:
      'Measure the distance in kilometres between two features. Feature ids must come from a data tool result.',
    inputSchema: z.object({
      fromLayerKey: z.enum(EDITABLE_LAYER_KEYS),
      fromFeatureId: z.string(),
      toLayerKey: z.enum(EDITABLE_LAYER_KEYS),
      toFeatureId: z.string(),
    }),
    run: async (input) => {
      if (!isFeatureId(input.fromFeatureId) || !isFeatureId(input.toFeatureId)) {
        return 'Không có dữ liệu: mã đối tượng không hợp lệ.';
      }
      const fromView = layerView(input.fromLayerKey);
      const toView = layerView(input.toLayerKey);

      const { rows } = await ctx.pool.query(
        `SELECT a.name AS "fromName", b.name AS "toName",
                round((ST_Distance(a.geom::geography, b.geom::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM ${fromView} a, ${toView} b
          WHERE a.id = $1 AND b.id = $2`,
        [input.fromFeatureId, input.toFeatureId]
      );

      ctx.provenance({
        tool: 'distance_between',
        layerKey: input.fromLayerKey,
        rowCount: rows.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.fromLayerKey),
      });

      if (rows.length === 0) {
        return 'Không có dữ liệu: không tìm thấy một trong hai đối tượng.';
      }
      return JSON.stringify(rows[0]);
    },
  });
```

- [ ] **Step 4: Write `area_of`**

Create `apps/api/src/modules/assistant/tools/data/areaOf.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, LAYER_GEOMETRY, type EditableLayerKey } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, activeVersionLabel, isFeatureId, layerView } from './helpers';

/** Read from the shared geometry registry rather than listed a second time
 *  here — a hand-copied list is exactly what drifts when a layer changes type. */
function hasArea(key: EditableLayerKey): boolean {
  return LAYER_GEOMETRY[key].includes('Polygon');
}

export const areaOfTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'area_of',
    description:
      'Measure the area of one polygon feature in square kilometres. Only for polygon layers: lakes, flood_zones, flood_generation.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
    }),
    run: async (input) => {
      if (!hasArea(input.layerKey)) {
        return `Lớp ${LAYER_LABELS[input.layerKey]} không có diện tích — đây là lớp điểm hoặc đường.`;
      }
      if (!isFeatureId(input.featureId)) return 'Không có dữ liệu: mã đối tượng không hợp lệ.';

      const { rows } = await ctx.pool.query(
        `SELECT name,
                round((ST_Area(geom::geography) / 1000000)::numeric, 3)::float8 AS "areaKm2",
                round((ST_Perimeter(geom::geography) / 1000)::numeric, 2)::float8 AS "perimeterKm"
           FROM ${layerView(input.layerKey)}
          WHERE id = $1`,
        [input.featureId]
      );

      ctx.provenance({
        tool: 'area_of',
        layerKey: input.layerKey,
        rowCount: rows.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      if (rows.length === 0) return 'Không có dữ liệu: không tìm thấy đối tượng.';
      return JSON.stringify({ layerKey: input.layerKey, ...rows[0] });
    },
  });
```

- [ ] **Step 5: Write `filter_by_attribute`**

Create `apps/api/src/modules/assistant/tools/data/filterByAttribute.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, layerView } from './helpers';

/**
 * Which columns may be filtered, per layer. A column name cannot be a bind
 * parameter, so this allowlist is the boundary: anything not listed here never
 * reaches the query string. It deliberately excludes the audit columns
 * (created_by, updated_by, dataset_version_id) — those are plumbing, not
 * attributes anyone asks about, and they identify users.
 *
 * Equality/contains only. Numeric ranges ("dams above 50 MW") are the SQL
 * escape hatch's job; adding an operator vocabulary here would rebuild a query
 * language one keyword at a time.
 */
export const FILTERABLE_COLUMNS: Record<EditableLayerKey, string[]> = {
  dams: ['name', 'name_en', 'status', 'year_launched', 'year_operational'],
  rivers: ['name', 'code', 'stream_order'],
  lakes: ['name', 'lake_type'],
  stations: ['name', 'station_type', 'status', 'value'],
  flood_zones: ['name', 'hazard_type', 'risk_level', 'area'],
  drought_points: ['name', 'risk_level', 'status'],
  saltwater_intrusion: ['name', 'salinity', 'risk_level', 'status'],
  flood_generation: ['name', 'risk_level', 'area', 'flow_rate'],
};

export const filterByAttributeTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'filter_by_attribute',
    description:
      'List the features of one layer whose attribute contains a value, e.g. dams with status "Operating". Matching is case-insensitive and partial.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      column: z
        .string()
        .describe(
          `Attribute to filter on. Allowed per layer: ${Object.entries(FILTERABLE_COLUMNS)
            .map(([k, cols]) => `${k}: ${cols.join('/')}`)
            .join('; ')}`
        ),
      value: z.string().max(100),
    }),
    run: async (input) => {
      const allowed = FILTERABLE_COLUMNS[input.layerKey];
      if (!allowed.includes(input.column)) {
        return `Không lọc được theo "${input.column}" trên lớp ${LAYER_LABELS[input.layerKey]}. Các thuộc tính hợp lệ: ${allowed.join(', ')}.`;
      }
      const view = layerView(input.layerKey);
      // input.column is a member of the allowlist above, never raw model text.
      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${input.column}::text AS "matchedValue", ${POINT_SQL}
           FROM ${view}
          WHERE ${input.column}::text ILIKE $1
          ORDER BY name NULLS LAST
          LIMIT ${ROW_LIMIT + 1}`,
        [`%${input.value}%`]
      );

      const truncated = rows.length > ROW_LIMIT;
      const listed = truncated ? rows.slice(0, ROW_LIMIT) : rows;

      ctx.provenance({
        tool: 'filter_by_attribute',
        layerKey: input.layerKey,
        rowCount: listed.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      if (listed.length === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.layerKey]} nào có ${input.column} chứa "${input.value}".`;
      }
      return JSON.stringify({
        layerKey: input.layerKey,
        column: input.column,
        value: input.value,
        truncated,
        rows: listed,
      });
    },
  });
```

- [ ] **Step 6: Write `related_features`**

Create `apps/api/src/modules/assistant/tools/data/relatedFeatures.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, isFeatureId, layerView } from './helpers';

/** A radius beyond this stops being a relationship and becomes a full scan of
 *  the layer — rivers alone is ~9,500 rows. */
const MAX_RADIUS_KM = 200;

export const relatedFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'related_features',
    description:
      'Find features of one layer within a radius of a feature of another layer, e.g. rivers within 20 km of a dam, or monitoring stations near a flood zone.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer of the anchor feature'),
      featureId: z.string().describe('Anchor feature id, from a data tool result'),
      relatedLayerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer to search'),
      radiusKm: z.number().min(0.1).max(MAX_RADIUS_KM).default(20),
    }),
    run: async (input) => {
      if (input.radiusKm > MAX_RADIUS_KM) {
        return `Bán kính tối đa là ${MAX_RADIUS_KM} km.`;
      }
      if (!isFeatureId(input.featureId)) return 'Không có dữ liệu: mã đối tượng không hợp lệ.';

      const anchorView = layerView(input.layerKey);
      const relatedView = layerView(input.relatedLayerKey);

      const { rows } = await ctx.pool.query(
        `WITH anchor AS (SELECT geom, name FROM ${anchorView} WHERE id = $1)
         SELECT r.id::text AS "featureId", r.name, ${POINT_SQL.replace(/geom/g, 'r.geom')},
                round((ST_Distance(r.geom::geography, a.geom::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM ${relatedView} r, anchor a
          WHERE ST_DWithin(r.geom::geography, a.geom::geography, $2)
          ORDER BY 5
          LIMIT ${ROW_LIMIT}`,
        [input.featureId, input.radiusKm * 1000]
      );

      const anchor = await ctx.pool.query<{ name: string | null }>(
        `SELECT name FROM ${anchorView} WHERE id = $1`,
        [input.featureId]
      );

      ctx.provenance({
        tool: 'related_features',
        layerKey: input.relatedLayerKey,
        rowCount: rows.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.relatedLayerKey),
      });

      if (anchor.rowCount === 0) return 'Không có dữ liệu: không tìm thấy đối tượng gốc.';
      if (rows.length === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.relatedLayerKey]} nào trong bán kính ${input.radiusKm} km.`;
      }
      return JSON.stringify({
        anchor: { layerKey: input.layerKey, name: anchor.rows[0].name },
        relatedLayerKey: input.relatedLayerKey,
        radiusKm: input.radiusKm,
        rows,
      });
    },
  });
```

`ORDER BY 5` orders by the fifth select-list column (`distanceKm`) — an ordinal rather than the alias, because the alias is not visible to `ORDER BY` when it is computed in the same select list on some Postgres versions. If `EXPLAIN` shows this misordering during implementation, replace it with the full `ST_Distance(...)` expression rather than the alias.

- [ ] **Step 7: Register the four tools**

In `apps/api/src/modules/assistant/tools/registry.ts`, add the imports and extend `FACTORIES` to its final Task-6 state:

```typescript
import { distanceBetweenTool } from './data/distanceBetween';
import { areaOfTool } from './data/areaOf';
import { filterByAttributeTool } from './data/filterByAttribute';
import { relatedFeaturesTool } from './data/relatedFeatures';
```

```typescript
const FACTORIES: ToolFactory[] = [
  zoomToRegionTool,
  zoomToFeatureTool,
  setLayerVisibleTool,
  setBasemapTool,
  highlightFeaturesTool,
  featuresInViewTool,
  nearestFeaturesTool,
  distanceBetweenTool,
  areaOfTool,
  filterByAttributeTool,
  relatedFeaturesTool,
];
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:api -- data2.test`
Expected: PASS (11 tests).

Run: `npm run test:api`
Expected: PASS — the whole API suite.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/assistant/tools
git commit -m "$(cat <<'EOF'
feat(api): công cụ đo đạc, lọc thuộc tính và quan hệ không gian

distance_between, area_of, filter_by_attribute, related_features. Cột
lọc đi qua danh sách cho phép theo từng lớp — tên cột không thể là tham
số ràng buộc nên đó là ranh giới duy nhất. Quan hệ trả lời bằng vị từ
không gian, không dựng mô hình quan hệ tổng quát (xem phần đầu kế hoạch).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The model loop

The Tool Runner replaces the stub `runAssistant`. This is the task where the assistant starts costing money, so it is also where token accounting, the cached prefix, and upstream error mapping land.

**Files:**
- Create: `apps/api/src/modules/assistant/prompt.ts`
- Create: `apps/api/src/modules/assistant/prompt.test.ts`
- Create: `apps/api/src/modules/assistant/assistant.live.test.ts`
- Modify: `apps/api/src/modules/assistant/service.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`
- Create: `apps/api/src/modules/assistant/tools/registry.test.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/package.json` (add the `test:live` script)
- Modify: `package.json` (root: add `test:api:live`)

**Interfaces:**
- Consumes: `buildTools` (Task 4), `sessionStore`/`budget` (Task 3), `parseReplySegments` (Task 2), `Anthropic` from `@anthropic-ai/sdk`.
- Produces: `SYSTEM_PROMPT`, `formatMapContext(ctx): string`, and a `runAssistant` that performs the real loop. Task 9's panel consumes its response shape unchanged from Task 2.

- [ ] **Step 1: Write the failing prompt test**

Create `apps/api/src/modules/assistant/prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_OPEN_TAG, KNOWLEDGE_CLOSE_TAG, type MapContext } from '@webatlas/shared';
import { SYSTEM_PROMPT, formatMapContext } from './prompt';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9.25,
  visibleLayerStateIds: ['layer_dams', 'layer_rivers'],
  basemap: 'street',
};

describe('SYSTEM_PROMPT', () => {
  it('names both knowledge tags so the model can produce parseable output', () => {
    expect(SYSTEM_PROMPT).toContain(KNOWLEDGE_OPEN_TAG);
    expect(SYSTEM_PROMPT).toContain(KNOWLEDGE_CLOSE_TAG);
  });

  it('instructs the model to report missing data rather than fill the gap', () => {
    expect(SYSTEM_PROMPT).toContain('Không có dữ liệu');
  });

  it('is stable across calls — a varying prefix would miss the cache every turn', () => {
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('formatMapContext', () => {
  it('includes the viewport, zoom, visible layers and basemap', () => {
    const text = formatMapContext(MAP_CONTEXT);
    expect(text).toContain('107.5');
    expect(text).toContain('13.5');
    expect(text).toContain('9.25');
    expect(text).toContain('layer_dams');
    expect(text).toContain('street');
  });

  it('says so explicitly when no layer is visible', () => {
    expect(formatMapContext({ ...MAP_CONTEXT, visibleLayerStateIds: [] })).toContain('không có lớp nào');
  });

  it('includes the selected feature when there is one', () => {
    const text = formatMapContext({
      ...MAP_CONTEXT,
      selectedFeature: { layerKey: 'dams', featureId: 'abc', name: 'Đập Buôn Kuốp' },
    });
    expect(text).toContain('Đập Buôn Kuốp');
    expect(text).toContain('abc');
  });

  it('omits the selection line entirely when nothing is selected', () => {
    expect(formatMapContext(MAP_CONTEXT)).not.toContain('Đối tượng đang chọn');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- prompt.test`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Write the prompt module**

Create `apps/api/src/modules/assistant/prompt.ts`:

```typescript
import {
  KNOWLEDGE_CLOSE_TAG,
  KNOWLEDGE_OPEN_TAG,
  REGION_NAME,
  REGION_PROVINCE_CODES,
  REGION_PROVINCE_NAMES,
  type MapContext,
} from '@webatlas/shared';

/**
 * The stable half of the prompt. Everything here must be byte-identical on every
 * request: it sits inside the cached prefix, and one interpolated timestamp or
 * request id would invalidate the cache on every message. Volatile context goes
 * in the user turn via formatMapContext, never here.
 *
 * Vietnamese, because the answers are Vietnamese and an English instruction to
 * "reply in Vietnamese" is a weaker signal than writing the whole brief in it.
 */
export const SYSTEM_PROMPT = `Bạn là trợ lý bản đồ của WebATLAS — hệ thống bản đồ tài nguyên nước vùng ${REGION_NAME}, gồm ${REGION_PROVINCE_CODES.length} tỉnh: ${REGION_PROVINCE_CODES.map(
  (c) => REGION_PROVINCE_NAMES[c]
).join(', ')}.

QUY TẮC BẮT BUỘC

1. Luôn trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm.

2. Mọi con số, tên đối tượng, khoảng cách, diện tích và số lượng PHẢI lấy từ kết quả công cụ. Không được tự suy ra, tự ước lượng hay nhớ từ kiến thức chung.

3. Khi một công cụ trả về "Không có dữ liệu", hãy nói thẳng với người dùng là hệ thống không có dữ liệu đó. Tuyệt đối không lấp chỗ trống bằng kiến thức chung của bạn. "Tôi không có số liệu về việc này" là câu trả lời đúng; một con số bịa ra thì không.

4. Nếu bạn bổ sung kiến thức chung ngoài dữ liệu hệ thống, PHẢI bọc phần đó trong ${KNOWLEDGE_OPEN_TAG} … ${KNOWLEDGE_CLOSE_TAG}. Giao diện hiển thị phần này trong khung riêng để người đọc biết đó không phải dữ liệu tra được. Không bọc phần lấy từ công cụ vào thẻ này.

5. Chỉ dùng toạ độ do công cụ dữ liệu trả về khi phóng to hoặc đánh dấu bản đồ. Không bao giờ tự nghĩ ra toạ độ.

6. Khi người dùng nói "ở đây", "vùng này", "trên màn hình", hãy dùng khung nhìn hiện tại trong phần BỐI CẢNH BẢN ĐỒ của lượt hỏi.

7. Khi câu trả lời nhắc tới các đối tượng cụ thể trên bản đồ, hãy dùng công cụ đánh dấu để người dùng nhìn thấy chúng.

8. Bạn chỉ đọc dữ liệu. Bạn không thể thêm, sửa hay xoá bất cứ thứ gì; nếu người dùng yêu cầu, hãy chỉ họ tới bảng Biên tập.`;

/**
 * The volatile half. Serialized into the LATEST USER TURN — not the top-level
 * system field, which would invalidate the cached prefix on every message, and
 * not a mid-conversation system message, which Haiku 4.5 does not support.
 */
export function formatMapContext(ctx: MapContext): string {
  const [w, s, e, n] = ctx.bbox;
  const layers =
    ctx.visibleLayerStateIds.length > 0
      ? ctx.visibleLayerStateIds.join(', ')
      : 'không có lớp nào đang bật';
  const selected = ctx.selectedFeature
    ? `\nĐối tượng đang chọn: ${ctx.selectedFeature.name ?? '(không tên)'} (lớp ${ctx.selectedFeature.layerKey}, id ${ctx.selectedFeature.featureId})`
    : '';
  return `BỐI CẢNH BẢN ĐỒ
Khung nhìn (WGS84): tây ${w}, nam ${s}, đông ${e}, bắc ${n}
Mức thu phóng: ${ctx.zoom}
Lớp đang hiện: ${layers}
Nền bản đồ: ${ctx.basemap}${selected}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:api -- prompt.test`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing registry test**

Create `apps/api/src/modules/assistant/tools/registry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { MapContext } from '@webatlas/shared';
import { buildTools, guardToolErrors } from './registry';
import type { ToolContext } from './types';

const ctx: ToolContext = {
  pool: {} as ToolContext['pool'],
  mapContext: {
    bbox: [107.5, 12.0, 109.0, 13.5],
    zoom: 9,
    visibleLayerStateIds: [],
    basemap: 'street',
  } satisfies MapContext,
  collect: vi.fn(),
  provenance: vi.fn(),
};

describe('buildTools', () => {
  it('builds every registered tool with unique names', () => {
    const tools = buildTools(ctx);
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names.length).toBeGreaterThanOrEqual(11);
    expect(new Set(names).size).toBe(names.length);
  });

  it('returns tools in a stable order — the definitions sit in the cached prefix', () => {
    const a = buildTools(ctx).map((t) => (t as { name: string }).name);
    const b = buildTools(ctx).map((t) => (t as { name: string }).name);
    expect(a).toEqual(b);
  });
});

describe('guardToolErrors', () => {
  it('turns a thrown tool error into text the model can act on', async () => {
    const tool = guardToolErrors({
      name: 'boom',
      run: () => {
        throw new Error('connection terminated');
      },
    } as never) as { run: (i: unknown) => Promise<string> };
    const result = await tool.run({});
    expect(result).toContain('gặp lỗi');
    expect(result).toContain('connection terminated');
  });

  it('passes a successful result through untouched', async () => {
    const tool = guardToolErrors({ name: 'ok', run: () => 'fine' } as never) as {
      run: (i: unknown) => Promise<string>;
    };
    expect(await tool.run({})).toBe('fine');
  });

  it('catches a rejected promise as well as a synchronous throw', async () => {
    const tool = guardToolErrors({
      name: 'async-boom',
      run: () => Promise.reject(new Error('timeout')),
    } as never) as { run: (i: unknown) => Promise<string> };
    expect(await tool.run({})).toContain('timeout');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:api -- registry.test`
Expected: FAIL — `guardToolErrors` is not exported.

- [ ] **Step 7: Add the tool error guard**

In `apps/api/src/modules/assistant/tools/registry.ts`, add above `buildTools`:

```typescript
/**
 * A tool that throws must not fail the whole request. The database can time out,
 * a geometry can be degenerate — the model should see the failure as a result it
 * can respond to ("thử cách khác, hoặc báo cho người dùng"), the same way it sees
 * an empty result. A thrown error inside the runner ends the turn with a 500 and
 * the user sees nothing.
 */
export function guardToolErrors<T extends { run: (input: never) => unknown }>(tool: T): T {
  const original = tool.run.bind(tool);
  return Object.assign(tool, {
    run: async (input: never) => {
      try {
        return await original(input);
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'lỗi không rõ';
        return `Công cụ gặp lỗi: ${detail}. Hãy thử cách khác hoặc nói cho người dùng biết là chưa truy vấn được.`;
      }
    },
  });
}
```

and wrap the factories:

```typescript
export function buildTools(ctx: ToolContext) {
  return FACTORIES.map((factory) => guardToolErrors(factory(ctx) as never));
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm run test:api -- registry.test`
Expected: PASS (5 tests).

- [ ] **Step 9: Replace the stub service with the real loop**

Rewrite `apps/api/src/modules/assistant/service.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import {
  parseReplySegments,
  type AssistantReply,
  type MapCommand,
  type MapContext,
  type Provenance,
} from '@webatlas/shared';
import { config } from '../../config/env';
import { AppError } from '../../errors';
import { createSessionStore } from './sessionStore';
import { createBudget } from './budget';
import { SYSTEM_PROMPT, formatMapContext } from './prompt';
import { buildTools } from './tools/registry';

export const sessionStore = createSessionStore({
  ttlMs: config.ASSISTANT_SESSION_TTL_MS,
  maxTurns: 20,
});

export const budget = createBudget({ dailyTokens: config.ASSISTANT_DAILY_TOKEN_BUDGET });

/** Enough for a paragraph and a few tool calls' worth of confirmations. The
 *  panel is a chat sidebar, not a report generator. */
const MAX_TOKENS = 2048;

/** A question that needs more round trips than this is not going to converge;
 *  each iteration is a paid call. */
const MAX_ITERATIONS = 8;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Constructed lazily and once: the constructor reads the key, and building it
  // at module load would make importing this module fail on a machine without one.
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export interface AssistantDeps {
  pool: Pool;
  userId: string;
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export async function runAssistant(deps: AssistantDeps): Promise<AssistantReply> {
  const commands: MapCommand[] = [];
  const provenance: Provenance[] = [];

  const tools = buildTools({
    pool: deps.pool,
    mapContext: deps.mapContext,
    collect: (c) => commands.push(c),
    provenance: (p) => provenance.push(p),
  });

  const history = sessionStore.get(deps.sessionId, deps.userId);
  const userTurn = `${deps.message}\n\n${formatMapContext(deps.mapContext)}`;

  const runner = getClient().beta.messages.toolRunner({
    model: config.ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    // The cache breakpoint goes on the last system block. Render order is
    // tools -> system -> messages, so one breakpoint here covers the tool
    // definitions too — and those dominate the prompt, being resent every turn.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: [...history.map((t) => ({ role: t.role, content: t.content })), { role: 'user', content: userTurn }],
    max_iterations: MAX_ITERATIONS,
  });

  let last: Anthropic.Beta.BetaMessage | undefined;
  let tokens = 0;
  try {
    for await (const message of runner) {
      tokens += message.usage.input_tokens + message.usage.output_tokens;
      last = message;
    }
  } catch (e) {
    throw toAppError(e);
  }

  budget.record(deps.userId, tokens);

  const text = (last?.content ?? [])
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const segments = parseReplySegments(
    text || 'Xin lỗi, tôi chưa tạo được câu trả lời cho câu hỏi này.'
  );

  // History stores what was said, not how it was computed: the user's question
  // WITHOUT the map context (which is stale by the next turn and would be sent
  // twice), and the assistant's final text.
  sessionStore.append(deps.sessionId, deps.userId, [
    { role: 'user', content: deps.message },
    { role: 'assistant', content: text },
  ]);

  return { segments, commands, provenance };
}

function toAppError(e: unknown): AppError {
  if (e instanceof Anthropic.RateLimitError) {
    return new AppError(429, 'ASSISTANT_UPSTREAM_BUSY', 'Trợ lý đang quá tải, vui lòng thử lại sau ít phút.');
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new AppError(503, 'ASSISTANT_UNAVAILABLE', 'Trợ lý chưa được cấu hình đúng trên máy chủ này.');
  }
  if (e instanceof Anthropic.APIError) {
    return new AppError(502, 'ASSISTANT_UPSTREAM_ERROR', 'Không kết nối được tới dịch vụ trợ lý.');
  }
  return new AppError(500, 'ASSISTANT_ERROR', 'Trợ lý gặp lỗi khi xử lý câu hỏi.');
}
```

If `max_iterations` is not a parameter the installed SDK's `toolRunner` accepts, the compiler will say so. In that case drop it from the params and bound the loop by counting iterations in the `for await` body, breaking after `MAX_ITERATIONS`. Do not guess a different parameter name.

- [ ] **Step 10: Add the live-model test, excluded from the default run**

Create `apps/api/src/modules/assistant/assistant.live.test.ts`:

```typescript
/**
 * The one place a live model is required: intent routing. Excluded from the
 * default run by filename (vitest.config.ts) because it costs tokens on every
 * execution. Run deliberately with `npm run test:api:live`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MapCommand, MapContext } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { runAssistant } from './service';
import { config } from '../../config/env';

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

const enabled = Boolean(config.ANTHROPIC_API_KEY);
const maybe = enabled ? describe : describe.skip;

let pool: ReturnType<typeof getPool>;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

function ask(message: string, sessionId = `live-${Math.random()}`) {
  return runAssistant({ pool, userId: 'live-test-user', sessionId, message, mapContext: MAP_CONTEXT });
}

maybe('intent routing (live model)', () => {
  it('routes a province request to a zoom command', async () => {
    const { commands } = await ask('Chuyển bản đồ tới Đắk Lắk');
    expect(commands.some((c: MapCommand) => c.kind === 'zoomToRegion')).toBe(true);
  }, 60_000);

  it('routes a layer request to a visibility command', async () => {
    const { commands } = await ask('Bật lớp sông ngòi lên giúp tôi');
    expect(commands.some((c: MapCommand) => c.kind === 'setLayerVisible')).toBe(true);
  }, 60_000);

  it('answers a counting question from tool results with provenance', async () => {
    const { provenance, segments } = await ask('Có bao nhiêu đập trong khu vực đang xem?');
    expect(provenance.length).toBeGreaterThan(0);
    expect(segments.some((s) => s.kind === 'grounded')).toBe(true);
  }, 60_000);

  it('reports missing data instead of inventing it', async () => {
    const { segments } = await ask('Có bao nhiêu trạm quan trắc ở Bắc Kạn?');
    const all = segments.map((s) => s.text).join(' ');
    // Bắc Kạn is outside the working region; the honest answer says so.
    expect(all.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.kind === 'grounded' || s.kind === 'knowledge')).toBe(true);
  }, 60_000);

  it('keeps multi-turn context within one session', async () => {
    const sessionId = `live-multiturn-${Math.random()}`;
    await ask('Chuyển bản đồ tới Đắk Lắk', sessionId);
    const { segments } = await ask('Còn tỉnh nào nữa trong vùng công tác?', sessionId);
    expect(segments.length).toBeGreaterThan(0);
  }, 90_000);
});
```

- [ ] **Step 11: Exclude it from the default run**

In `apps/api/vitest.config.ts`, add the import and the `exclude`:

```typescript
import { defineConfig, configDefaults } from 'vitest/config';
```

```typescript
    // Live-model suites cost real API tokens on every execution, so they are
    // opt-in (`npm run test:api:live`) rather than part of the default run.
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
```

In `apps/api/package.json` scripts, add:

```json
    "test:live": "vitest run --exclude '**/node_modules/**' src/modules/assistant/assistant.live.test.ts",
```

In the root `package.json` scripts, add:

```json
    "test:api:live": "npm run test:live -w @webatlas/api",
```

- [ ] **Step 12: Verify**

Run: `npm run test:api`
Expected: PASS, and the live suite does not appear in the output.

Run: `npm run test:api -- assistant.route`
Expected: PASS. On a machine with `ANTHROPIC_API_KEY` set, the final test now returns 200 with real segments.

If a key is available, run: `npm run test:api:live`
Expected: PASS (5 tests). Then check the cache is working — a second identical run should report a non-zero `cache_read_input_tokens`. If it stays zero, the tool + system prefix is below Haiku 4.5's minimum cacheable length (2048 tokens) rather than broken; record which it is in the task report rather than chasing it.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/modules/assistant apps/api/vitest.config.ts apps/api/package.json package.json
git commit -m "$(cat <<'EOF'
feat(api): vòng lặp mô hình cho trợ lý bản đồ

Tool Runner của SDK Anthropic với claude-haiku-4-5. Lời nhắc hệ thống và
danh sách công cụ nằm trong tiền tố có cache; bối cảnh bản đồ đi trong
lượt hỏi mới nhất, không đặt ở trường system — đặt ở đó thì mỗi tin nhắn
lại phá cache. Công cụ ném lỗi được chuyển thành văn bản để mô hình xử lý
tiếp thay vì làm hỏng cả yêu cầu. Bộ kiểm thử cần mô hình thật tách riêng.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The guarded SQL escape hatch

Two independent layers, because a parser check is not a security boundary. The **database privilege** layer is the real one: a dedicated `webatlas_assistant` role with `SELECT` on the `water.*_active` views and **no grant of any kind on the `app` schema**, so a perfect injection still cannot reach `app.users` (argon2 hashes) or `app.audit_log`. The **query guard** is the second layer, and it is the one that makes ordinary mistakes cheap.

Granting on the views rather than the base tables is load-bearing: a view runs with its owner's privileges (`security_invoker` is off by default), so the `*_active` views resolve the version chain through `app.dataset_versions` on the owner's behalf while the assistant role itself still has nothing on `app`.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000008_assistant-db-role.cjs`
- Create: `apps/api/src/modules/assistant/sql/guard.ts`
- Create: `apps/api/src/modules/assistant/sql/guard.test.ts`
- Create: `apps/api/src/modules/assistant/sql/pool.ts`
- Create: `apps/api/src/modules/assistant/tools/data/runSql.ts`
- Create: `apps/api/src/modules/assistant/sql/privileges.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`
- Modify: `infra/.env.example`

**Interfaces:**
- Consumes: `layerView`, `LAYER_LABELS` (Task 5); `ToolFactory` (Task 4); `config.ASSISTANT_DATABASE_URL` (Task 3).
- Produces: `guardSql(sql): GuardResult`, `SQL_ROW_LIMIT`, `getAssistantPool(): Pool | null`, `closeAssistantPool()`, `runSqlTool`. Nothing later consumes these.

- [ ] **Step 1: Write the failing guard test**

Create `apps/api/src/modules/assistant/sql/guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { guardSql, SQL_ROW_LIMIT } from './guard';

function reject(sql: string) {
  const result = guardSql(sql);
  expect(result.ok, `expected rejection for: ${sql}`).toBe(false);
  return result;
}

describe('guardSql — accepts', () => {
  it('a plain SELECT', () => {
    const r = guardSql('SELECT name FROM water.dams_active');
    expect(r.ok).toBe(true);
  });

  it('a WITH query', () => {
    expect(guardSql('WITH x AS (SELECT 1 AS n) SELECT n FROM x').ok).toBe(true);
  });

  it('a trailing semicolon, which is ordinary and harmless', () => {
    expect(guardSql('SELECT 1;').ok).toBe(true);
  });

  it('wraps the query in an enforced LIMIT', () => {
    const r = guardSql('SELECT name FROM water.dams_active');
    expect(r.ok && r.sql).toContain(`LIMIT ${SQL_ROW_LIMIT}`);
  });

  it('keeps the caller LIMIT and still applies its own outer one', () => {
    const r = guardSql('SELECT name FROM water.dams_active LIMIT 5');
    expect(r.ok && r.sql).toContain('LIMIT 5');
    expect(r.ok && r.sql).toContain(`LIMIT ${SQL_ROW_LIMIT}`);
  });
});

describe('guardSql — rejects', () => {
  it('a second statement', () => reject('SELECT 1; DELETE FROM water.dams'));
  it('a write disguised after a SELECT', () => reject('SELECT 1;DROP TABLE water.dams'));
  it('a bare write', () => reject('DELETE FROM water.dams'));
  it('an UPDATE', () => reject('UPDATE water.dams SET name = 1'));
  it('an INSERT', () => reject("INSERT INTO water.dams(name) VALUES ('x')"));
  it('a data-modifying CTE', () => reject('WITH x AS (DELETE FROM water.dams RETURNING 1) SELECT * FROM x'));
  it('DDL', () => reject('CREATE TABLE t (a int)'));
  it('a GRANT', () => reject('GRANT SELECT ON app.users TO webatlas_assistant'));
  it('COPY', () => reject("COPY water.dams TO '/tmp/x'"));
  it('a line comment, which can hide the rest of a statement', () => reject('SELECT 1 -- DROP TABLE x'));
  it('a block comment', () => reject('SELECT /* sneaky */ 1'));
  it('a server-side file read', () => reject("SELECT pg_read_file('/etc/passwd')"));
  it('a sleep, which would hold a connection', () => reject('SELECT pg_sleep(10)'));
  it('an empty query', () => reject('   '));
  it('a query beyond the length cap', () => reject(`SELECT '${'a'.repeat(4000)}'`));
});

describe('guardSql — does not reject on substrings', () => {
  it('allows a column named created_at even though it contains "create"', () => {
    expect(guardSql('SELECT created_at FROM water.dams_active').ok).toBe(true);
  });

  it('allows OFFSET even though it contains "set"', () => {
    expect(guardSql('SELECT name FROM water.dams_active OFFSET 5').ok).toBe(true);
  });

  it('allows a column named updated_at even though it contains "update"', () => {
    expect(guardSql('SELECT updated_at FROM water.dams_active').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- guard.test`
Expected: FAIL — `Cannot find module './guard'`.

- [ ] **Step 3: Write the guard**

Create `apps/api/src/modules/assistant/sql/guard.ts`:

```typescript
/**
 * The parser half of the SQL escape hatch. This is NOT the security boundary —
 * the database privileges of the webatlas_assistant role are (see the
 * assistant-db-role migration and privileges.test.ts). This layer exists so
 * ordinary mistakes fail fast and cheaply, and so obviously hostile input never
 * reaches a connection at all.
 *
 * Treat every rule here as defence in depth. If a rule and the grant table ever
 * disagree about whether something is allowed, the grant table wins.
 */
export const SQL_ROW_LIMIT = 200;
const MAX_SQL_LENGTH = 2000;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/**
 * Word-boundary anchored so ordinary identifiers are not caught by substring:
 * `created_at` contains "create", `updated_at` contains "update", `OFFSET`
 * contains "set". Each of those has a test.
 */
const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'vacuum', 'analyze', 'reindex', 'cluster',
  'call', 'do', 'set', 'reset', 'listen', 'notify', 'lock', 'prepare',
  'execute', 'refresh', 'comment', 'security', 'returning',
];

const FORBIDDEN_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'lo_import', 'lo_export', 'dblink', 'pg_sleep', 'pg_terminate_backend',
  'pg_reload_conf', 'set_config', 'current_setting',
];

export function guardSql(raw: string): GuardResult {
  const sql = raw.trim().replace(/;+\s*$/, '').trim();

  if (sql.length === 0) return { ok: false, reason: 'Câu truy vấn rỗng.' };
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: `Câu truy vấn quá dài (tối đa ${MAX_SQL_LENGTH} ký tự).` };
  }
  // Comments can hide the rest of a statement from a human reviewer reading the
  // provenance block, which is the only reason the escape hatch is acceptable.
  if (sql.includes('--') || sql.includes('/*')) {
    return { ok: false, reason: 'Không cho phép chú thích trong câu truy vấn.' };
  }
  // A remaining semicolon after the trailing one was stripped means more than
  // one statement.
  if (sql.includes(';')) {
    return { ok: false, reason: 'Chỉ cho phép một câu lệnh duy nhất.' };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: 'Chỉ cho phép SELECT hoặc WITH.' };
  }
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(sql)) {
      return { ok: false, reason: `Từ khoá "${word}" không được phép.` };
    }
  }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(sql)) {
      return { ok: false, reason: `Hàm "${fn}" không được phép.` };
    }
  }

  // The outer LIMIT is enforced regardless of what the inner query says: an
  // inner LIMIT is the model's intent, this is the system's ceiling.
  return { ok: true, sql: `SELECT * FROM (${sql}) AS assistant_query LIMIT ${SQL_ROW_LIMIT}` };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:api -- guard.test`
Expected: PASS (23 tests).

- [ ] **Step 5: Write the migration**

Create `apps/api/src/db/migrations/1000000000008_assistant-db-role.cjs`:

```javascript
/* eslint-disable camelcase */
exports.shorthands = undefined;

const ROLE = 'webatlas_assistant';
const PASSWORD = process.env.ASSISTANT_DB_PASSWORD || 'change_me_dev';

const LAYERS = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

exports.up = (pgm) => {
  // CREATE ROLE is not transactional-safe to repeat; guard it so re-running
  // migrations on an existing database does not fail.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}';
      END IF;
    END
    $$;
  `);

  // The database name is not known at authoring time (POSTGRES_DB is
  // configurable), so build the GRANT with the current database's own name.
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${ROLE}', current_database());
    END
    $$;
  `);

  // PostGIS functions live in public; without USAGE every ST_* call fails.
  pgm.sql(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
  pgm.sql(`GRANT USAGE ON SCHEMA water TO ${ROLE};`);

  // SELECT on the *_active VIEWS ONLY — never the base tables.
  //
  // This is the load-bearing choice. A view executes with its owner's
  // privileges (security_invoker is off by default), so the *_active views
  // resolve the dataset-version chain through app.dataset_versions on the
  // owner's behalf, while this role still holds nothing on the app schema.
  // Granting the base tables instead would expose deleted tombstones and every
  // superseded version, and would still not resolve "current".
  for (const layer of LAYERS) {
    pgm.sql(`GRANT SELECT ON water.${layer}_active TO ${ROLE};`);
  }

  // Belt and braces: the role was never granted anything on app, but say so
  // explicitly so the intent survives a future "GRANT ... ON ALL TABLES" written
  // without reading this file. app.users holds argon2 password hashes.
  pgm.sql(`REVOKE ALL ON SCHEMA app FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA water FROM ${ROLE};`);
  // The REVOKE above also strips the view grants, so re-apply them last.
  for (const layer of LAYERS) {
    pgm.sql(`GRANT SELECT ON water.${layer}_active TO ${ROLE};`);
  }
};

exports.down = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`REVOKE ALL ON water.${layer}_active FROM ${ROLE};`);
  }
  pgm.sql(`REVOKE ALL ON SCHEMA water FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON SCHEMA public FROM ${ROLE};`);
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM ${ROLE}', current_database());
    END
    $$;
  `);
  pgm.sql(`DROP ROLE IF EXISTS ${ROLE};`);
};
```

In `infra/.env.example`, add:

```
# Read-only DB role the assistant SQL escape hatch connects as.
ASSISTANT_DB_PASSWORD=change_me_dev
```

- [ ] **Step 6: Run the migration**

Run: `npm run migrate`
Expected: `1000000000008_assistant-db-role` applies with no error.

Verify by hand:

```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U webatlas -d webatlas -c "\du webatlas_assistant"
```

Expected: the role exists.

- [ ] **Step 7: Write the assistant pool**

Create `apps/api/src/modules/assistant/sql/pool.ts`:

```typescript
import pg from 'pg';
import { config } from '../../../config/env';

/**
 * A SEPARATE pool from app.pg, connecting as webatlas_assistant. This is the
 * whole point: the app's pool connects as the owner of every table, so running
 * generated SQL on it would make the query guard the only thing between a
 * model and app.users.
 */
let pool: pg.Pool | undefined;

export function getAssistantPool(): pg.Pool | null {
  if (!config.ASSISTANT_DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.ASSISTANT_DATABASE_URL,
      // Small: this pool serves one optional tool, and a runaway loop must not
      // be able to starve the app's own pool of database connections.
      max: 4,
      // Nothing here should be long-lived; the per-query statement_timeout is 3s.
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function closeAssistantPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```

- [ ] **Step 8: Write the failing privilege test**

Create `apps/api/src/modules/assistant/sql/privileges.test.ts`:

```typescript
/**
 * Adversarial tests for the SQL escape hatch.
 *
 * The assertions that matter here fail at the DATABASE PRIVILEGE level, not in
 * the parser: each one runs SQL that the guard would have rejected, directly on
 * the assistant pool, and requires Postgres itself to refuse it. A guard that
 * silently stopped working must still leave these failing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getAssistantPool, closeAssistantPool } from './pool';

let pool: Pool | null;
beforeAll(() => { pool = getAssistantPool(); });
afterAll(async () => { await closeAssistantPool(); });

const maybe = process.env.ASSISTANT_DATABASE_URL ? describe : describe.skip;

/** Postgres SQLSTATE for insufficient_privilege. */
const INSUFFICIENT_PRIVILEGE = '42501';

async function expectDenied(sql: string, code = INSUFFICIENT_PRIVILEGE) {
  await expect(pool!.query(sql)).rejects.toMatchObject({ code });
}

maybe('webatlas_assistant database privileges', () => {
  it('can read the active-version views', async () => {
    const { rows } = await pool!.query('SELECT count(*)::int AS n FROM water.dams_active');
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
  });

  it('cannot read app.users — the argon2 hashes are unreachable by privilege', async () => {
    await expectDenied('SELECT * FROM app.users');
  });

  it('cannot read app.audit_log', async () => {
    await expectDenied('SELECT * FROM app.audit_log');
  });

  it('cannot read app.dataset_versions directly, only through the views', async () => {
    await expectDenied('SELECT * FROM app.dataset_versions');
  });

  it('cannot read the water base tables, only the active views', async () => {
    await expectDenied('SELECT * FROM water.dams');
  });

  it('cannot write to a water table', async () => {
    await expectDenied("INSERT INTO water.dams (name, geom) VALUES ('x', ST_MakePoint(0,0))");
  });

  it('cannot create a table', async () => {
    // CREATE in the public schema is revoked from PUBLIC since Postgres 15.
    await expect(pool!.query('CREATE TABLE assistant_probe (a int)')).rejects.toBeTruthy();
  });

  it('cannot grant itself more privilege', async () => {
    await expect(pool!.query('GRANT SELECT ON app.users TO webatlas_assistant')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 9: Run it to verify the privileges hold**

Set `ASSISTANT_DATABASE_URL` in `apps/api/.env` to match the migration's role and password, then:

Run: `npm run test:api -- privileges.test`
Expected: PASS (8 tests). If the `app.users` test does **not** reject, stop — the grant model is wrong and no amount of parser work fixes it.

- [ ] **Step 10: Write the escape-hatch tool**

Create `apps/api/src/modules/assistant/tools/data/runSql.ts`:

```typescript
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { guardSql } from '../../sql/guard';
import { getAssistantPool } from '../../sql/pool';

const VIEWS = EDITABLE_LAYER_KEYS.map((k) => `water.${k}_active`).join(', ');

export const runSqlTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'run_sql',
    description:
      `Last resort for questions the typed tools cannot express (aggregates, groupings, numeric ranges). Read-only SELECT against these views only: ${VIEWS}. Every column of the underlying layer is available. Prefer a typed tool whenever one fits.`,
    inputSchema: z.object({
      sql: z.string().describe('A single read-only SELECT or WITH statement. No comments, no semicolons.'),
      purpose: z.string().max(200).describe('One Vietnamese sentence: what this query answers.'),
    }),
    run: async (input) => {
      const pool = getAssistantPool();
      if (!pool) return 'Công cụ SQL chưa được cấu hình trên máy chủ này. Hãy dùng công cụ khác.';

      const guarded = guardSql(input.sql);
      if (!guarded.ok) return `Truy vấn bị từ chối: ${guarded.reason}`;

      const client = await pool.connect();
      try {
        // READ ONLY on BEGIN, not `SET LOCAL default_transaction_read_only`:
        // that GUC only affects transactions started afterwards, so setting it
        // inside the transaction it is meant to constrain does nothing.
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '3s'");
        // Keeps app out of the default resolution path. Ergonomics, not a
        // boundary — the boundary is the role's grants.
        await client.query('SET LOCAL search_path = water, public');
        const result = await client.query(guarded.sql);
        await client.query('COMMIT');

        // The generated SQL goes into provenance so a reviewer can see exactly
        // what ran. That visibility is the condition on which the escape hatch
        // is acceptable at all.
        ctx.provenance({
          tool: 'run_sql',
          layerKey: null,
          rowCount: result.rowCount ?? 0,
          datasetVersion: null,
          sql: guarded.sql,
        });

        if ((result.rowCount ?? 0) === 0) {
          return 'Không có dữ liệu: truy vấn không trả về dòng nào.';
        }
        return JSON.stringify({ purpose: input.purpose, rowCount: result.rowCount, rows: result.rows });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = e instanceof Error ? e.message : 'lỗi không rõ';
        return `Truy vấn thất bại: ${detail}. Hãy thử công cụ có sẵn thay vì SQL.`;
      } finally {
        client.release();
      }
    },
  });
```

- [ ] **Step 11: Register it conditionally**

In `apps/api/src/modules/assistant/tools/registry.ts`, import it and register it only when the pool is configured:

```typescript
import { config } from '../../../config/env';
import { runSqlTool } from './data/runSql';
```

```typescript
export function buildTools(ctx: ToolContext) {
  // The escape hatch is only offered when a read-only role is configured.
  // Advertising a tool that always answers "not configured" wastes cached
  // prefix tokens on every turn and teaches the model to try it anyway.
  const factories = config.ASSISTANT_DATABASE_URL ? [...FACTORIES, runSqlTool] : FACTORIES;
  return factories.map((factory) => guardToolErrors(factory(ctx) as never));
}
```

- [ ] **Step 12: Verify**

Run: `npm run test:api -- guard.test privileges.test registry.test`
Expected: PASS.

Run: `npm run test:api`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/db/migrations/1000000000008_assistant-db-role.cjs apps/api/src/modules/assistant infra/.env.example
git commit -m "$(cat <<'EOF'
feat(api): lối thoát SQL có kiểm soát cho trợ lý

Hai lớp độc lập. Lớp thật là quyền cơ sở dữ liệu: vai trò
webatlas_assistant chỉ có SELECT trên các view *_active, không có bất kỳ
quyền nào trên schema app — nên dù bị chèn SQL hoàn hảo cũng không chạm
được app.users. Cấp quyền trên view chứ không phải bảng gốc là điểm mấu
chốt: view chạy bằng quyền của chủ sở hữu nên vẫn giải được chuỗi phiên
bản. Lớp thứ hai là bộ kiểm câu lệnh, để lỗi thường gặp trượt sớm và rẻ.
Câu SQL sinh ra được ghi vào provenance để người duyệt thấy đúng cái đã chạy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The assistant panel

The last slice: a rail entry, a chat panel, and the `MapContext` builder. The panel never touches OpenLayers — it reads context through `features/map/model/mapContext.ts` and replays commands through `createCommandExecutor`, both of which live inside the quarantine.

**`selectedFeature` stays unpopulated in v1.** Feature selection lives in local state inside `components/DynamicPopup.tsx`, and the spec forbids changing that file. The field is in the contract so wiring it later needs no contract change; `formatMapContext` already omits the line when it is absent. Record this in the task report rather than reaching into the popup.

**Files:**
- Create: `apps/web/src/features/map/model/mapContext.ts`
- Create: `apps/web/src/features/map/model/mapContext.test.ts`
- Create: `apps/web/src/features/assistant/api/assistant.api.ts`
- Create: `apps/web/src/features/assistant/model/useAssistant.ts`
- Create: `apps/web/src/features/assistant/model/useAssistant.test.ts`
- Create: `apps/web/src/features/assistant/ui/AssistantPanel.view.tsx`
- Create: `apps/web/src/features/assistant/ui/AssistantPanel.view.test.tsx`
- Create: `apps/web/src/features/assistant/index.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `useMapContext` (MapProvider), `createCommandExecutor` (Task 1), `apiRequest`, `useSession`, `AssistantReply`/`MapContext`/`ReplySegment`/`Provenance` (Task 2).
- Produces: `buildMapContext(deps): MapContext | null`, `postAssistantMessage(body): Promise<AssistantReply>`, `useAssistant()`, `AssistantPanelView`. Nothing later consumes these.

- [ ] **Step 1: Write the failing MapContext test**

Create `apps/web/src/features/map/model/mapContext.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Map } from 'ol';
import { fromLonLat } from 'ol/proj';
import { buildMapContext } from './mapContext';

function makeMap(extent4326: [number, number, number, number], zoom = 9) {
  const [w, s, e, n] = extent4326;
  const [minX, minY] = fromLonLat([w, s]);
  const [maxX, maxY] = fromLonLat([e, n]);
  return {
    getSize: () => [800, 600],
    getView: () => ({
      calculateExtent: () => [minX, minY, maxX, maxY],
      getZoom: () => zoom,
    }),
  } as unknown as Map;
}

const LAYERS = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_rivers', visible: false, opacity: 0.8 },
  { id: 'layer_lakes', visible: true, opacity: 0.85 },
];

describe('buildMapContext', () => {
  it('returns null before the map exists', () => {
    expect(buildMapContext({ map: null, basemap: 'street', layersState: LAYERS })).toBeNull();
  });

  it('reports the viewport in WGS84 degrees, not Web Mercator metres', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5]), basemap: 'street', layersState: LAYERS });
    expect(ctx!.bbox[0]).toBeCloseTo(107.5, 4);
    expect(ctx!.bbox[3]).toBeCloseTo(13.5, 4);
  });

  it('rounds the zoom to two decimals so an identical view yields an identical context', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5], 9.123456), basemap: 'street', layersState: LAYERS });
    expect(ctx!.zoom).toBe(9.12);
  });

  it('lists only the visible layers', () => {
    const ctx = buildMapContext({ map: makeMap([107.5, 12.0, 109.0, 13.5]), basemap: 'satellite', layersState: LAYERS });
    expect(ctx!.visibleLayerStateIds).toEqual(['layer_dams', 'layer_lakes']);
    expect(ctx!.basemap).toBe('satellite');
  });

  it('returns null when the view has no zoom yet', () => {
    const map = {
      getSize: () => [800, 600],
      getView: () => ({ calculateExtent: () => [0, 0, 1, 1], getZoom: () => undefined }),
    } as unknown as Map;
    expect(buildMapContext({ map, basemap: 'street', layersState: LAYERS })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web -- mapContext`
Expected: FAIL — `Cannot find module './mapContext'`.

- [ ] **Step 3: Write the MapContext builder**

Create `apps/web/src/features/map/model/mapContext.ts`:

```typescript
import type { Map } from 'ol';
import { transformExtent } from 'ol/proj';
import type { BasemapName, MapContext } from '@webatlas/shared';
import type { LayerState } from './MapModel';

export interface MapContextDeps {
  map: Map | null;
  basemap: BasemapName;
  layersState: LayerState[];
}

/**
 * Reads what the user is currently looking at off the map.
 *
 * Lives in features/map/model because it imports from 'ol' — the assistant
 * slice must not. It is the assistant's only window onto the map's state, the
 * mirror image of createCommandExecutor being its only lever on it.
 */
export function buildMapContext({ map, basemap, layersState }: MapContextDeps): MapContext | null {
  if (!map) return null;
  const view = map.getView();
  const zoom = view.getZoom();
  if (zoom === undefined) return null;

  const extent = view.calculateExtent(map.getSize());
  const [west, south, east, north] = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');

  return {
    bbox: [round(west), round(south), round(east), round(north)],
    // Rounded so a map that has not moved produces a byte-identical context;
    // an unrounded float would differ on every render and make each turn's
    // user message needlessly unique.
    zoom: Math.round(zoom * 100) / 100,
    visibleLayerStateIds: layersState.filter((l) => l.visible).map((l) => l.id),
    basemap,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:web -- mapContext`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the api client**

Create `apps/web/src/features/assistant/api/assistant.api.ts`:

```typescript
import type { AssistantReply, MapContext } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export interface AssistantRequestBody {
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export function postAssistantMessage(body: AssistantRequestBody): Promise<AssistantReply> {
  return apiRequest<AssistantReply>('/api/assistant/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 6: Write the failing presenter test**

Create `apps/web/src/features/assistant/model/useAssistant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AssistantReply, MapContext } from '@webatlas/shared';
import { useAssistant } from './useAssistant';

vi.mock('../api/assistant.api', () => ({ postAssistantMessage: vi.fn() }));
import { postAssistantMessage } from '../api/assistant.api';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

const REPLY: AssistantReply = {
  segments: [{ kind: 'grounded', text: 'Có 151 đập.' }],
  commands: [{ kind: 'zoomToRegion', provinceCode: '66' }],
  provenance: [{ tool: 'features_in_view', layerKey: 'dams', rowCount: 151, datasetVersion: 'v1' }],
};

const mocked = () => postAssistantMessage as ReturnType<typeof vi.fn>;

describe('useAssistant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with an empty transcript and no error', () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('appends the question and the answer, and executes the commands', async () => {
    mocked().mockResolvedValue(REPLY);
    const run = vi.fn().mockReturnValue({ ok: true, text: 'ok' });
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run }));

    await act(async () => { await result.current.send('Có bao nhiêu đập?'); });

    expect(result.current.turns[0]).toMatchObject({ role: 'user', text: 'Có bao nhiêu đập?' });
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', segments: REPLY.segments });
    expect(run).toHaveBeenCalledWith(REPLY.commands[0]);
  });

  it('sends the same session id on every message so the server can keep context', async () => {
    mocked().mockResolvedValue(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.send('hai'); });
    const [first, second] = mocked().mock.calls;
    expect(first[0].sessionId).toBe(second[0].sessionId);
    expect(first[0].sessionId).toBeTruthy();
  });

  it('refuses to send when the map is not ready rather than sending a null context', async () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => null, run: vi.fn() }));
    await act(async () => { await result.current.send('xin chào'); });
    expect(mocked()).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Bản đồ chưa sẵn sàng');
  });

  it('ignores an empty message', async () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('   '); });
    expect(mocked()).not.toHaveBeenCalled();
  });

  it('surfaces the server message on failure and keeps the question in the transcript', async () => {
    mocked().mockRejectedValue(Object.assign(new Error('Bạn đã dùng hết hạn mức'), { status: 429 }));
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('xin chào'); });
    await waitFor(() => expect(result.current.error).toContain('hết hạn mức'));
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('clears a previous error on the next successful send', async () => {
    mocked().mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValueOnce(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.send('hai'); });
    expect(result.current.error).toBeNull();
  });

  it('retry re-sends the last question', async () => {
    mocked().mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValueOnce(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.retry(); });
    expect(mocked().mock.calls[1][0].message).toBe('một');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:web -- useAssistant`
Expected: FAIL — `Cannot find module './useAssistant'`.

- [ ] **Step 8: Write the presenter**

Create `apps/web/src/features/assistant/model/useAssistant.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import type { MapCommand, MapContext, Provenance, ReplySegment } from '@webatlas/shared';
import { postAssistantMessage } from '../api/assistant.api';

export type AssistantTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; segments: ReplySegment[]; provenance: Provenance[] };

export interface UseAssistantDeps {
  /** Null while the map is still initialising. */
  getMapContext: () => MapContext | null;
  run: (command: MapCommand) => unknown;
}

export function useAssistant({ getMapContext, run }: UseAssistantDeps) {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One session id per mount. Not persisted: the spec rules out cross-session
  // memory, and the server binds the id to the authenticated user anyway.
  const sessionId = useRef<string>(crypto.randomUUID());
  const lastMessage = useRef<string | null>(null);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || loading) return;

      const mapContext = getMapContext();
      if (!mapContext) {
        setError('Bản đồ chưa sẵn sàng, vui lòng thử lại sau giây lát.');
        return;
      }

      lastMessage.current = message;
      setError(null);
      setLoading(true);
      // The question goes into the transcript before the request, and stays
      // there if the request fails — a question that vanishes on error is the
      // most annoying possible failure mode.
      setTurns((prev) => [...prev, { role: 'user', text: message }]);

      try {
        const reply = await postAssistantMessage({ sessionId: sessionId.current, message, mapContext });
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', segments: reply.segments, provenance: reply.provenance },
        ]);
        // Commands run after the reply is rendered, in the order the model
        // issued them. The server has already validated each one with
        // isMapCommand; the executor validates the layer ids again.
        for (const command of reply.commands) run(command);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : 'Không gửi được câu hỏi.');
      } finally {
        setLoading(false);
      }
    },
    [getMapContext, loading, run]
  );

  const retry = useCallback(async () => {
    const message = lastMessage.current;
    if (!message) return;
    // Drop the failed question so retrying does not duplicate it.
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      return last && last.role === 'user' ? prev.slice(0, -1) : prev;
    });
    await send(message);
  }, [send]);

  return { turns, loading, error, send, retry };
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npm run test:web -- useAssistant`
Expected: PASS (8 tests).

- [ ] **Step 10: Write the failing view test**

Create `apps/web/src/features/assistant/ui/AssistantPanel.view.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AssistantTurn } from '../model/useAssistant';
import { AssistantPanelView } from './AssistantPanel.view';

const TURNS: AssistantTurn[] = [
  { role: 'user', text: 'Có bao nhiêu đập?' },
  {
    role: 'assistant',
    segments: [
      { kind: 'grounded', text: 'Có 151 đập trong vùng.' },
      { kind: 'knowledge', text: 'Đập vòm thường dùng ở hẻm núi hẹp.' },
    ],
    provenance: [{ tool: 'features_in_view', layerKey: 'dams', rowCount: 151, datasetVersion: 'HydroLAKES v1' }],
  },
];

function renderPanel(overrides: Partial<Parameters<typeof AssistantPanelView>[0]> = {}) {
  const props = {
    turns: TURNS, loading: false, error: null,
    onSend: vi.fn(), onRetry: vi.fn(),
    ...overrides,
  };
  render(<AssistantPanelView {...props} />);
  return props;
}

describe('AssistantPanelView', () => {
  it('renders both the question and the grounded answer', () => {
    renderPanel();
    expect(screen.getByText('Có bao nhiêu đập?')).toBeInTheDocument();
    expect(screen.getByText('Có 151 đập trong vùng.')).toBeInTheDocument();
  });

  it('labels the general-knowledge block visibly rather than by styling alone', () => {
    renderPanel();
    // The spec is explicit: a bordered labelled callout, not italics — a subtle
    // label is one users skim past.
    expect(screen.getByText('Kiến thức chung, không phải dữ liệu hệ thống')).toBeInTheDocument();
    expect(screen.getByText('Đập vòm thường dùng ở hẻm núi hẹp.')).toBeInTheDocument();
  });

  it('shows a provenance chip naming the tool, the row count and the dataset version', () => {
    renderPanel();
    const chip = screen.getByTitle(/features_in_view/);
    expect(chip.textContent).toContain('151');
    expect(chip.textContent).toContain('HydroLAKES v1');
  });

  it('shows the generated SQL when provenance carries it', () => {
    renderPanel({
      turns: [
        {
          role: 'assistant',
          segments: [{ kind: 'grounded', text: 'x' }],
          provenance: [{ tool: 'run_sql', layerKey: null, rowCount: 3, datasetVersion: null, sql: 'SELECT 1' }],
        },
      ],
    });
    expect(screen.getByText('SELECT 1')).toBeInTheDocument();
  });

  it('submits the composer and clears it', () => {
    const props = renderPanel();
    const input = screen.getByLabelText('Câu hỏi cho trợ lý') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hồ nào lớn nhất?' } });
    fireEvent.submit(input.closest('form')!);
    expect(props.onSend).toHaveBeenCalledWith('Hồ nào lớn nhất?');
    expect(input.value).toBe('');
  });

  it('disables the composer while a request is in flight', () => {
    renderPanel({ loading: true });
    expect(screen.getByLabelText('Câu hỏi cho trợ lý')).toBeDisabled();
    expect(screen.getByText('Đang xử lý…')).toBeInTheDocument();
  });

  it('shows an error with a retry button', () => {
    const props = renderPanel({ error: 'Trợ lý đang quá tải' });
    expect(screen.getByText('Trợ lý đang quá tải')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('shows a starting hint when the transcript is empty', () => {
    renderPanel({ turns: [] });
    expect(screen.getByText(/Hỏi về đập, sông, hồ/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npm run test:web -- AssistantPanel`
Expected: FAIL — `Cannot find module './AssistantPanel.view'`.

- [ ] **Step 12: Write the view**

Create `apps/web/src/features/assistant/ui/AssistantPanel.view.tsx`:

```typescript
import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import type { Provenance } from '@webatlas/shared';
import type { AssistantTurn } from '../model/useAssistant';

interface Props {
  turns: AssistantTurn[];
  loading: boolean;
  error: string | null;
  onSend: (message: string) => void;
  onRetry: () => void;
}

function ProvenanceChips({ records }: { records: Provenance[] }) {
  if (records.length === 0) return null;
  return (
    <div className="assistant-provenance">
      {records.map((r, i) => (
        <span
          key={i}
          className="assistant-chip"
          title={`Công cụ: ${r.tool}${r.layerKey ? ` · lớp ${r.layerKey}` : ''}`}
        >
          {r.tool} · {r.rowCount} bản ghi
          {r.datasetVersion ? ` · ${r.datasetVersion}` : ''}
        </span>
      ))}
      {records
        .filter((r) => r.sql)
        .map((r, i) => (
          <pre key={`sql-${i}`} className="assistant-sql">{r.sql}</pre>
        ))}
    </div>
  );
}

/** Passive. Every piece of state lives in useAssistant except the draft. */
export function AssistantPanelView({ turns, loading, error, onSend, onRetry }: Props) {
  const [draft, setDraft] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <div className="assistant-panel">
      <h2 className="panel-title">Trợ lý</h2>

      <div className="assistant-transcript">
        {turns.length === 0 && (
          <p className="assistant-hint">
            Hỏi về đập, sông, hồ và các lớp hiểm họa trong vùng công tác — hoặc bảo tôi di chuyển
            bản đồ. Ví dụ: “Có bao nhiêu đập trong khu vực đang xem?”
          </p>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p key={i} className="assistant-turn assistant-turn-user">{turn.text}</p>
          ) : (
            <div key={i} className="assistant-turn assistant-turn-bot">
              {turn.segments.map((segment, j) =>
                segment.kind === 'knowledge' ? (
                  // Bordered callout with its own background and an explicit
                  // label — the spec rules out italics, which users skim past.
                  <aside key={j} className="assistant-knowledge">
                    <span className="assistant-knowledge-label">
                      Kiến thức chung, không phải dữ liệu hệ thống
                    </span>
                    <p>{segment.text}</p>
                  </aside>
                ) : (
                  <p key={j}>{segment.text}</p>
                )
              )}
              <ProvenanceChips records={turn.provenance} />
            </div>
          )
        )}

        {loading && <p className="assistant-status">Đang xử lý…</p>}

        {error && (
          <div className="assistant-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>Thử lại</button>
          </div>
        )}
      </div>

      <form className="assistant-composer" onSubmit={submit}>
        <textarea
          aria-label="Câu hỏi cho trợ lý"
          value={draft}
          disabled={loading}
          rows={2}
          placeholder="Hỏi trợ lý…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — the chat convention.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
        />
        <button type="submit" disabled={loading || !draft.trim()} aria-label="Gửi">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 13: Write the container**

Create `apps/web/src/features/assistant/index.tsx`:

```typescript
import { useCallback } from 'react';
import { useAssistant } from './model/useAssistant';
import { AssistantPanelView } from './ui/AssistantPanel.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { buildMapContext } from '../map/model/mapContext';
import { useMapContext as useMapProvider } from '../../app/providers/MapProvider';

export default function Assistant() {
  const { map, basemap, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } =
    useMapProvider();

  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
    layerExists: (id) => layersState.some((l) => l.id === id),
  });

  // Read at send time, not render time: the user may pan between typing and
  // sending, and the context that matters is the one at the moment they ask.
  const getMapContext = useCallback(
    () => buildMapContext({ map, basemap, layersState }),
    [map, basemap, layersState]
  );

  const { turns, loading, error, send, retry } = useAssistant({ getMapContext, run });

  return (
    <AssistantPanelView
      turns={turns}
      loading={loading}
      error={error}
      onSend={send}
      onRetry={retry}
    />
  );
}
```

- [ ] **Step 14: Add the rail entry**

In `apps/web/src/app/App.tsx`, add the imports:

```typescript
import Assistant from '../features/assistant';
import { useSession } from '../entities/session/model/session.store';
import { Layers, List, MessageSquare } from 'lucide-react';
```

`useSession` reads a context that `AppProviders` supplies, so `App` itself cannot call it — `App` is the component that *renders* `AppProviders`. Extract the rail block into a small component in the same file, which is rendered inside the provider tree and can therefore read both the rail state and the session:

```typescript
function RailAndFlyout() {
  const rail = useRail();
  const { status } = useSession();
  // The assistant costs API tokens per message, so the route is authenticated;
  // showing the entry to an anonymous visitor would only ever produce a 401.
  const items = [
    { id: 'layers' as const, label: 'Lớp dữ liệu', icon: <Layers size={20} /> },
    { id: 'legend' as const, label: 'Chú giải', icon: <List size={20} /> },
    ...(status === 'authenticated'
      ? [{ id: 'assistant' as const, label: 'Trợ lý', icon: <MessageSquare size={20} /> }]
      : []),
  ];

  return (
    <>
      <MapView flyoutOpen={rail.active !== null} />
      <IconRail items={items} active={rail.active} onToggle={rail.toggle} />
      {rail.active !== null && (
        <aside className="rail-flyout">
          {rail.active === 'layers' && <LayersPanel />}
          {rail.active === 'legend' && <Legend />}
          {rail.active === 'assistant' && <Assistant />}
        </aside>
      )}
    </>
  );
}
```

Replace the existing `<MapView …/>`, `<IconRail …/>` and `{rail.active !== null && …}` block in `App` with `<RailAndFlyout />`, and delete the now-unused `const rail = useRail();` from `App`.

- [ ] **Step 15: Add the panel styles**

Append to `apps/web/src/styles/main.css`:

```css
/* Trợ lý — khung chat trong flyout. Dùng chung token với các bảng khác. */
.assistant-panel {
  display: flex; flex-direction: column; height: 100%;
  padding: var(--space-3); color: var(--text-main);
}
.assistant-transcript { flex: 1; overflow-y: auto; font-size: 13px; }
.assistant-hint { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.assistant-turn { margin: 0 0 var(--space-3); line-height: 1.5; }
.assistant-turn-user {
  background: var(--surface-sunken); border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3); font-weight: 500;
}
.assistant-turn-bot p { margin: 0 0 var(--space-2); }

/* Khối kiến thức chung: viền và nền riêng, có nhãn hiện rõ — theo thiết kế,
   KHÔNG dùng chữ nghiêng, vì nhãn mờ là thứ người đọc lướt qua. */
.assistant-knowledge {
  border: 1px solid #d97706; border-left-width: 3px;
  background: #fffbeb; border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3); margin: var(--space-2) 0;
}
.assistant-knowledge-label {
  display: block; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.02em; color: #92400e;
  margin-bottom: var(--space-1);
}
.assistant-knowledge p { margin: 0; }

.assistant-provenance { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
.assistant-chip {
  font-size: 11px; color: var(--text-muted);
  background: var(--surface-sunken); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 1px var(--space-2);
}
.assistant-sql {
  width: 100%; margin: var(--space-1) 0 0; padding: var(--space-2);
  background: var(--surface-sunken); border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 11px;
  overflow-x: auto; white-space: pre;
}
.assistant-status { color: var(--text-muted); font-size: 12px; }
.assistant-error {
  display: flex; align-items: center; gap: var(--space-2);
  background: #fef2f2; border: 1px solid var(--danger);
  border-radius: var(--radius-sm); color: var(--danger);
  font-size: 12px; padding: var(--space-2);
}
.assistant-error button {
  background: var(--danger); color: #fff; border: none;
  border-radius: var(--radius-sm); padding: 2px var(--space-2); cursor: pointer;
}
.assistant-composer { display: flex; gap: var(--space-2); padding-top: var(--space-2); }
.assistant-composer textarea {
  flex: 1; resize: none; font: inherit; font-size: 13px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: var(--space-2);
}
.assistant-composer button {
  background: var(--accent); color: #fff; border: none;
  border-radius: var(--radius-sm); padding: 0 var(--space-3); cursor: pointer;
}
.assistant-composer button:disabled { background: var(--border-strong); cursor: default; }
```

- [ ] **Step 16: Verify**

Run: `npm run test:web -- assistant mapContext`
Expected: PASS (13 tests).

Run: `npm run test:web`
Expected: PASS — `App.routing.test.tsx` in particular, which renders the whole tree.

Run: `npm run lint:web && npm run build:web`
Expected: both clean.

- [ ] **Step 17: Commit**

```bash
git add apps/web/src/features/assistant apps/web/src/features/map/model/mapContext.ts apps/web/src/features/map/model/mapContext.test.ts apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "$(cat <<'EOF'
feat(web): bảng trợ lý bản đồ trong thanh biểu tượng

Slice trợ lý không chạm OpenLayers: đọc bối cảnh qua mapContext.ts và
phát lệnh qua createCommandExecutor — cùng bộ lệnh mà nút bấm và kết quả
tìm kiếm vẫn dùng. Khối kiến thức chung hiện trong khung có viền và nhãn
rõ ràng, không phải chữ nghiêng. Mục trợ lý chỉ hiện với người đã đăng
nhập vì mỗi tin nhắn đều tốn token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Runbook, gates, and the whole-system check

The last task documents the operational surface the previous nine created, re-verifies the constraints that hold the architecture together, and records honestly what was and was not built.

**Files:**
- Create: `docs/runbooks/map-assistant.md`
- Modify: `README.md`
- Modify: `apps/api/src/server.ts` (close the assistant pool on shutdown)

**Interfaces:**
- Consumes: everything above.
- Produces: no code interfaces; the runbook is the deliverable.

- [ ] **Step 1: Close the assistant pool on shutdown**

The app's own pool is closed by `plugins/db.ts`'s `onClose` hook. The assistant pool has no such hook, so a test run or a graceful shutdown leaves its connections open. In `apps/api/src/server.ts`, after the route registrations:

```typescript
import { closeAssistantPool } from './modules/assistant/sql/pool';
```

```typescript
  // The assistant's read-only pool is separate from app.pg (deliberately — see
  // modules/assistant/sql/pool.ts), so it needs its own shutdown hook.
  app.addHook('onClose', async () => {
    await closeAssistantPool();
  });
```

- [ ] **Step 2: Verify the OpenLayers quarantine still holds**

```bash
grep -rn "from 'ol" apps/web/src --include=*.tsx --include=*.ts \
  | grep -v "src/features/map/model/" | grep -v ".test." \
  | grep -v "src/components/OGCClient.tsx" \
  | grep -v "import type "
```

Expected: no output. `highlightLayer.ts` and `mapContext.ts` are both inside `features/map/model/`, which is exactly why they were put there. If `features/assistant/` appears in this output, the slice is reaching the map directly and the seam has been bypassed — fix the import, do not widen the filter.

- [ ] **Step 3: Verify no assistant tool bypasses the command validator**

```bash
grep -rn "collect(" apps/api/src/modules/assistant/tools --include=*.ts | grep -v ".test."
```

Expected: every hit is preceded by an `isMapCommand` check in the same function. The model chooses tool arguments, so a `collect` that is not guarded is a path from a hallucinated argument to the map.

- [ ] **Step 4: Verify the app schema is unreachable from the assistant role**

```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U webatlas -d webatlas \
  -c "SELECT has_table_privilege('webatlas_assistant', 'app.users', 'SELECT') AS can_read_users, \
             has_table_privilege('webatlas_assistant', 'water.dams_active', 'SELECT') AS can_read_dams;"
```

Expected: `can_read_users` is `f`, `can_read_dams` is `t`. This is the security claim of Task 8 in one command.

- [ ] **Step 5: Write the runbook**

Create `docs/runbooks/map-assistant.md`:

```markdown
# Runbook — Trợ lý bản đồ (Map Assistant)

Vận hành `POST /api/assistant/messages` và bảng Trợ lý trong giao diện.

## Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | (rỗng) | Không đặt thì tuyến trả 503 `ASSISTANT_UNAVAILABLE`. Đây là công tắc bật/tắt tính năng. |
| `ASSISTANT_MODEL` | `claude-haiku-4-5` | Mô hình. Lựa chọn đã ghi trong bản thiết kế. |
| `ASSISTANT_DAILY_TOKEN_BUDGET` | `200000` | Trần token mỗi người dùng mỗi ngày UTC. `0` là không giới hạn. |
| `ASSISTANT_SESSION_TTL_MS` | `1800000` | Thời gian sống của một phiên hội thoại (30 phút). |
| `ASSISTANT_DATABASE_URL` | (rỗng) | Chuỗi kết nối của vai trò `webatlas_assistant`. Không đặt thì công cụ `run_sql` không được đăng ký. |
| `ASSISTANT_DB_PASSWORD` | `change_me_dev` | Mật khẩu vai trò, đọc lúc chạy migration `1000000000008`. |

## Giới hạn đã biết

- **Phiên hội thoại và hạn mức token nằm trong bộ nhớ tiến trình.** Khởi động lại API là xoá sạch cả hai: lịch sử hội thoại mất, và hạn mức ngày được tha. Chấp nhận được với triển khai một tiến trình; chạy nhiều tiến trình thì cả hai đều sai. Muốn nhiều tiến trình thì phải chuyển hai thứ này sang bộ nhớ dùng chung trước.
- **Không có bộ nhớ xuyên phiên.** Đúng theo thiết kế.
- **Không phát trực tiếp (streaming).** Bảng hiển thị "Đang xử lý…" chứ không chảy chữ.
- **`selectedFeature` chưa được nối.** Trạng thái chọn đối tượng nằm trong state cục bộ của `components/DynamicPopup.tsx`, mà bản thiết kế cấm sửa tệp đó. Trường này đã có sẵn trong hợp đồng nên nối sau không phải đổi hợp đồng.
- **Chưa có RAG.** Trợ lý truy vấn có cấu trúc trên PostGIS, không có kho vector, không có bước truy hồi tài liệu. Đó là Spec 3.

## Chi phí

Mỗi tin nhắn là một chuỗi lời gọi API có trả phí. Hai chốt chặn:

1. `@fastify/rate-limit` trên tuyến: 20 tin nhắn/phút, khoá theo id người dùng chứ không theo IP.
2. Trần token ngày trong `budget.ts`. Chạm trần thì tuyến trả 429 `ASSISTANT_BUDGET_EXCEEDED`.

Định nghĩa công cụ và lời nhắc hệ thống nằm trong tiền tố có cache. Kiểm tra cache có ăn hay không bằng `usage.cache_read_input_tokens` — bằng 0 liên tục nghĩa là có gì đó trong tiền tố đang đổi mỗi lượt, hoặc tiền tố ngắn hơn ngưỡng tối thiểu của Haiku 4.5 (2048 token).

## Mã lỗi

| Mã | HTTP | Khi nào |
|---|---|---|
| `ASSISTANT_UNAVAILABLE` | 503 | Chưa cấu hình `ANTHROPIC_API_KEY`, hoặc khoá sai. |
| `ASSISTANT_BUDGET_EXCEEDED` | 429 | Người dùng hết hạn mức ngày. |
| `ASSISTANT_UPSTREAM_BUSY` | 429 | Anthropic trả 429. |
| `ASSISTANT_UPSTREAM_ERROR` | 502 | Lỗi khác từ Anthropic. |
| `ASSISTANT_ERROR` | 500 | Lỗi không phân loại được. |
| `RATE_LIMITED` | 429 | Vượt 20 tin nhắn/phút. |

Công cụ ném lỗi thì **không** làm hỏng cả yêu cầu: lỗi được chuyển thành văn bản trả lại cho mô hình (`guardToolErrors`), mô hình xử lý tiếp hoặc báo cho người dùng.

## Ranh giới an toàn của lối thoát SQL

Có hai lớp, và **chỉ lớp thứ nhất là ranh giới thật**:

1. **Quyền cơ sở dữ liệu.** Vai trò `webatlas_assistant` chỉ có `SELECT` trên tám view `water.*_active`, không có quyền nào trên schema `app`. Cấp quyền trên view chứ không phải bảng gốc là chủ ý: view chạy bằng quyền của chủ sở hữu nên vẫn giải được chuỗi phiên bản qua `app.dataset_versions`, trong khi vai trò này vẫn không đọc được `app.users`.
2. **Bộ kiểm câu lệnh** (`sql/guard.ts`): một câu lệnh, chỉ `SELECT`/`WITH`, không chú thích, `BEGIN READ ONLY`, `statement_timeout = 3s`, `LIMIT` bắt buộc ở ngoài.

Kiểm tra lớp thứ nhất bất cứ lúc nào:

```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U webatlas -d webatlas \
  -c "SELECT has_table_privilege('webatlas_assistant', 'app.users', 'SELECT');"
```

Phải trả `f`. Nếu trả `t`, tắt `ASSISTANT_DATABASE_URL` ngay và sửa quyền trước khi bật lại.

## Kiểm thử

- `npm run test:api` — toàn bộ, không gọi mô hình.
- `npm run test:api:live` — bộ kiểm định tuyến ý định, **có gọi mô hình thật và tốn token**. Chạy khi sửa lời nhắc hệ thống hoặc thêm/bớt công cụ.
- `npm run test:api -- privileges.test` — kiểm tra ranh giới quyền, cần `ASSISTANT_DATABASE_URL`.
```

- [ ] **Step 6: Update the README**

In `README.md`, add the assistant to the feature list and point at the runbook. Find the section listing the app's capabilities and add one line in the same style as its neighbours:

```markdown
- **Trợ lý bản đồ** — hỏi đáp tiếng Việt về đối tượng trên bản đồ, đo đạc bằng PostGIS và điều khiển bản đồ bằng ngôn ngữ tự nhiên. Xem [runbook](docs/runbooks/map-assistant.md).
```

If the README still says "Plan 7 is next", correct it to reflect the current state: Plan A and Plan B are landed, and the re-documentation plan (`docs/superpowers/plans/2026-09-07-repo-redocumentation.md`) is the outstanding one.

- [ ] **Step 7: Full verification**

Run each and confirm the expected result before claiming the plan complete:

```bash
npm run build:shared
npm run test:shared
npm run test:api
npm run test:web
npm run lint:web
npm run build:web
```

Expected: all six succeed. Record the test counts for shared / api / web in the task report — the branch's starting point was shared 72, web 268, api 113.

- [ ] **Step 8: Confirm the app actually works**

Start the stack and exercise the assistant by hand — the automated suites never render the panel against a live API:

```bash
docker compose -f infra/docker-compose.yml up -d
npm run dev -w @webatlas/api
npm run dev:web
```

Log in, open the Trợ lý rail entry, and check four things:
1. "Có bao nhiêu đập trong khu vực đang xem?" returns a number **and** a provenance chip naming `features_in_view`.
2. "Chuyển bản đồ tới Đắk Lắk" moves the map.
3. A question with no data ("Có bao nhiêu trạm quan trắc ở Hà Nội?") produces an honest "no data" answer, not an invented number.
4. With `ANTHROPIC_API_KEY` unset, the panel shows the 503 message rather than a blank panel or a stuck spinner.

- [ ] **Step 9: Commit**

```bash
git add docs/runbooks/map-assistant.md README.md apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
docs: runbook trợ lý bản đồ và đóng pool khi tắt máy chủ

Ghi rõ các giới hạn đã biết thay vì để người sau tự phát hiện: phiên và
hạn mức nằm trong bộ nhớ tiến trình nên khởi động lại là mất, chưa nối
selectedFeature vì không được sửa DynamicPopup, và đây chưa phải RAG.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Completion criteria

The plan is done when all of the following are true:

1. Every task's checkboxes are ticked and every commit is on the branch.
2. `npm run build:shared`, `test:shared`, `test:api`, `test:web`, `lint:web`, `build:web` all pass.
3. The OpenLayers quarantine grep (Task 10, Step 2) produces no output.
4. `has_table_privilege('webatlas_assistant', 'app.users', 'SELECT')` returns `f`.
5. The four manual checks in Task 10, Step 8 pass against a running stack.

## Divergences from the spec

Three, each deliberate:

1. **The response field is `segments`, not `reply`.** The spec says the response is `{ reply, commands[], provenance[] }`. A single `reply` string cannot express the spec's own requirement that model knowledge render in a visually distinct callout — the panel would have to re-parse the text, and the boundary would live in two places. `segments` is the parsed form of the same thing, produced once, in `packages/shared` (Task 2), and consumed by both sides.

2. **`featuresInRegion` is named `features_in_view`.** The spec's name suggests an administrative region, but administrative boundaries are client-side GeoJSON with no database table, so there is nothing to query a region against. The tool takes a bounding box and defaults to the current viewport, which is what the name now says.

3. **The panel shows "Đang xử lý…", not which tool is running.** The spec says the panel shows per-tool progress ("đang đo khoảng cách…") as the compensation for not streaming. That is not achievable over a single JSON response: the server cannot report progress mid-request without a streaming transport, which v1 rules out. Rather than promise progress the architecture cannot deliver, the panel shows a single honest busy state. Per-tool progress and streaming are the same piece of work and should be decided together, not half-built here.

## Deliberately not in this plan

Recorded so a later reader does not mistake these for oversights:

- **RAG / document retrieval** — Spec 3. The tool registry is the seam it plugs into.
- **Prediction-data grounding** — Spec 4, blocked: no model prediction data exists in the repository.
- **Streaming model output** — ruled out for v1 by the spec.
- **Cross-session chat memory** — ruled out by the user.
- **`DynamicPopup.tsx`** — untouched, per the spec. This is why `selectedFeature` is unpopulated.
- **New roles** — the `admin | editor | viewer` matrix is unchanged; the assistant is available to all three.
