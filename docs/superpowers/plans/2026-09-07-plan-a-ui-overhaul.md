# UI Overhaul Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven floating glass panels with an icon-rail shell in dark chrome, drive the layers panel and legend from real data instead of mock objects and per-layer branches, fix the search bar's full-layer WFS fetch, and extract the typed command layer that Plan B's assistant will drive.

**Architecture:** Everything routes through one new seam — `MapCommand`, a discriminated union declared in `packages/shared` and executed by a single module in `apps/web` that is the only code touching OpenLayers. Toolbar buttons, search results, and (in Plan B) assistant tools all emit the same commands. UI slices are built innermost-first: the command contract, then its executor, then the shell that hosts panels, then the panels themselves.

**Tech Stack:** React 19, OpenLayers 10, TypeScript, Vitest + Testing Library, Fastify, PostGIS (`pg_trgm`), CSS custom properties.

**Spec:** [2026-09-07-ui-overhaul-and-map-assistant-design.md](../specs/2026-09-07-ui-overhaul-and-map-assistant-design.md)

**Plan B** (the assistant) builds on Task 1 and Task 2 of this plan and is written separately. This plan ships a working, improved application on its own.

## Global Constraints

- **The OpenLayers quarantine is absolute.** After Task 2, only `apps/web/src/features/map/model/*` may import from `ol`. No `ol/...` import may appear in `features/*/ui/`, `widgets/`, `pages/`, or `components/`. Task 10 enforces this with a grep gate.
- **No new runtime dependency in `packages/shared`.** It is imported by both the browser bundle and the API; the command validator is hand-written, not Zod. (The web bundle just went through a performance pass — do not add ~50KB of validator to it.)
- **`packages/shared/dist` is git-tracked.** After editing `packages/shared/src/*`, run `npm run build:shared` and commit the regenerated `dist` in the same commit as the source.
- **`npm run build:web` is the type gate**, not `vitest` — Vitest uses esbuild and skips type-checking. Every task that changes TypeScript runs `build:web` before its commit.
- **Commit messages in Vietnamese**, matching repo convention. Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vietnamese is the UI language.** All user-facing strings are Vietnamese, matching existing components.
- **Editable layer keys are the 8 in `EDITABLE_LAYER_KEYS`**: `dams, rivers, lakes, stations, flood_zones, drought_points, saltwater_intrusion, flood_generation`. Administrative boundaries (`layer_provinces_2026`, `layer_wards_2026`) are **not** API layers — they are client-side GeoJSON and have no catalog entry.
- **Do not modify `apps/web/src/components/DynamicPopup.tsx`.** Explicitly out of scope per the spec.
- **Extensions are added by migration, never by editing `infra/postgis/init.sql`** — that file runs only on first database init, so an edit would silently skip every existing dev database.

---

### Task 1: The `MapCommand` contract

**Files:**
- Create: `packages/shared/src/map-commands.ts`
- Create: `packages/shared/src/map-commands.test.ts`
- Modify: `packages/shared/src/index.ts` (add the export)

**Interfaces:**
- Consumes: `EditableLayerKey` from `./index.js`, `REGION_PROVINCE_CODES` from `./region.js`.
- Produces: `type MapCommand` (discriminated union on `kind`), `function isMapCommand(value: unknown): value is MapCommand`, and `const MAP_COMMAND_KINDS`. Task 2 executes these; Plan B's tools emit them.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/map-commands.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isMapCommand, MAP_COMMAND_KINDS, type MapCommand } from './map-commands.js';

describe('isMapCommand', () => {
  it('accepts a well-formed zoomToRegion command', () => {
    const cmd: MapCommand = { kind: 'zoomToRegion', provinceCode: '66' };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('accepts a well-formed zoomToFeature command', () => {
    const cmd: MapCommand = {
      kind: 'zoomToFeature',
      layerKey: 'dams',
      featureId: 'abc',
      lonLat: [108.1, 12.7],
    };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(isMapCommand({ kind: 'launchMissile' })).toBe(false);
  });

  it('rejects a province code outside the working region', () => {
    expect(isMapCommand({ kind: 'zoomToRegion', provinceCode: '01' })).toBe(false);
  });

  it('rejects lonLat that is not a two-number tuple', () => {
    expect(
      isMapCommand({ kind: 'zoomToFeature', layerKey: 'dams', featureId: 'a', lonLat: [108.1] })
    ).toBe(false);
  });

  it('rejects opacity outside 0..1', () => {
    expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'layer_dams', opacity: 1.5 })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isMapCommand(null)).toBe(false);
    expect(isMapCommand('zoomToRegion')).toBe(false);
  });

  it('lists every kind in MAP_COMMAND_KINDS', () => {
    expect([...MAP_COMMAND_KINDS].sort()).toEqual([
      'setBasemap',
      'setLayerOpacity',
      'setLayerVisible',
      'zoomToFeature',
      'zoomToRegion',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/shared -- map-commands`
Expected: FAIL — `Cannot find module './map-commands.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/map-commands.ts`:

```typescript
/**
 * Commands that mutate the map view. This is the single contract shared by the
 * UI (buttons, search results) and the assistant's tool layer — both emit these,
 * and `features/map/model/mapCommands.ts` is the only code that executes them.
 *
 * Hand-written validation, no Zod: this module is imported by the browser bundle
 * and must not add a validator dependency to it.
 */
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from './index.js';
import { REGION_PROVINCE_CODES } from './region.js';

export const MAP_COMMAND_KINDS = [
  'zoomToRegion',
  'zoomToFeature',
  'setLayerVisible',
  'setLayerOpacity',
  'setBasemap',
] as const;

export type MapCommandKind = (typeof MAP_COMMAND_KINDS)[number];

export const BASEMAP_TYPES = ['street', 'satellite', 'dem'] as const;
export type BasemapName = (typeof BASEMAP_TYPES)[number];

export type MapCommand =
  | { kind: 'zoomToRegion'; provinceCode: string }
  | { kind: 'zoomToFeature'; layerKey: EditableLayerKey; featureId: string; lonLat: [number, number] }
  | { kind: 'setLayerVisible'; layerStateId: string; visible: boolean }
  | { kind: 'setLayerOpacity'; layerStateId: string; opacity: number }
  | { kind: 'setBasemap'; basemap: BasemapName };

// NOTE: a `highlightFeatures` variant was deliberately left out. Nothing in this
// plan highlights anything; Plan B adds it with a real highlight source and tests
// when the assistant needs it.

function isLonLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function isLayerKey(value: unknown): value is EditableLayerKey {
  return typeof value === 'string' && (EDITABLE_LAYER_KEYS as readonly string[]).includes(value);
}

/**
 * Runtime guard. The API validates assistant-produced commands with this before
 * sending them to the browser, so an out-of-region province code or an unknown
 * layer key never reaches the map.
 */
export function isMapCommand(value: unknown): value is MapCommand {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;

  switch (c.kind) {
    case 'zoomToRegion':
      return (
        typeof c.provinceCode === 'string' &&
        (REGION_PROVINCE_CODES as readonly string[]).includes(c.provinceCode)
      );
    case 'zoomToFeature':
      return isLayerKey(c.layerKey) && typeof c.featureId === 'string' && isLonLat(c.lonLat);
    case 'setLayerVisible':
      return typeof c.layerStateId === 'string' && typeof c.visible === 'boolean';
    case 'setLayerOpacity':
      return (
        typeof c.layerStateId === 'string' &&
        typeof c.opacity === 'number' &&
        c.opacity >= 0 &&
        c.opacity <= 1
      );
    case 'setBasemap':
      return typeof c.basemap === 'string' && (BASEMAP_TYPES as readonly string[]).includes(c.basemap);
    default:
      return false;
  }
}
```

- [ ] **Step 4: Export it from the package index**

Append to `packages/shared/src/index.ts`, after the existing `export * from './osm-water.js';` line:

```typescript
export * from './map-commands.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w @webatlas/shared -- map-commands`
Expected: PASS, 8 tests.

- [ ] **Step 6: Rebuild the tracked dist**

Run: `npm run build:shared`
Expected: exit 0. `git status --short` now shows modified files under `packages/shared/dist/` — this is expected and they are committed below.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/map-commands.ts packages/shared/src/map-commands.test.ts packages/shared/src/index.ts packages/shared/dist
git commit -m "feat(shared): hợp đồng MapCommand dùng chung cho giao diện và trợ lý" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The command executor

**Files:**
- Create: `apps/web/src/features/map/model/mapCommands.ts`
- Create: `apps/web/src/features/map/model/mapCommands.test.ts`

**Interfaces:**
- Consumes: `MapCommand`, `isMapCommand` from `@webatlas/shared` (Task 1). `LAYER_REGISTRY` from `../../../entities/layer/layerRegistry`. `REGION_PROVINCE_NAMES` from `@webatlas/shared`.
- Produces: `createCommandExecutor(deps: CommandDeps): (cmd: MapCommand) => CommandResult` where
  `interface CommandDeps { map: Map | null; setBasemap(b: BasemapName): void; toggleLayerVisibility(id: string): void; setLayerOpacity(id: string, o: number): void; getLayerVisible(id: string): boolean }`
  and `type CommandResult = { ok: true; text: string } | { ok: false; reason: string }`.
  Task 7 (toolbar) and Task 9 (search) call this; Plan B dispatches assistant commands through it.

This is the **only** module in the app allowed to import `ol` outside `features/map/model/`. Its dependencies are injected so the test needs no browser and no real OpenLayers map.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/mapCommands.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createCommandExecutor, type CommandDeps } from './mapCommands';

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps & { animate: ReturnType<typeof vi.fn> } {
  const animate = vi.fn();
  const map = { getView: () => ({ animate }) } as unknown as CommandDeps['map'];
  return {
    map,
    animate,
    setBasemap: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
    getLayerVisible: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('createCommandExecutor', () => {
  it('zoomToFeature animates the view and reports the feature', () => {
    const deps = makeDeps();
    const run = createCommandExecutor(deps);

    const result = run({ kind: 'zoomToFeature', layerKey: 'dams', featureId: 'x1', lonLat: [108.1, 12.7] });

    expect(deps.animate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới đối tượng đã chọn.' });
  });

  it('zoomToRegion names the province in Vietnamese', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });

    expect(deps.animate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới Đắk Lắk.' });
  });

  it('setLayerVisible only toggles when the current state differs', () => {
    const deps = makeDeps({ getLayerVisible: vi.fn().mockReturnValue(true) });
    const run = createCommandExecutor(deps);

    run({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: true });
    expect(deps.toggleLayerVisibility).not.toHaveBeenCalled();

    run({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: false });
    expect(deps.toggleLayerVisibility).toHaveBeenCalledWith('layer_dams');
  });

  it('setLayerOpacity forwards the value', () => {
    const deps = makeDeps();
    createCommandExecutor(deps)({ kind: 'setLayerOpacity', layerStateId: 'layer_rivers', opacity: 0.4 });
    expect(deps.setLayerOpacity).toHaveBeenCalledWith('layer_rivers', 0.4);
  });

  it('setBasemap forwards the basemap', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'setBasemap', basemap: 'satellite' });
    expect(deps.setBasemap).toHaveBeenCalledWith('satellite');
    expect(result.ok).toBe(true);
  });

  it('fails cleanly when the map is not ready', () => {
    const deps = makeDeps({ map: null });
    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/web -- mapCommands`
Expected: FAIL — `Failed to resolve import "./mapCommands"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/map/model/mapCommands.ts`:

```typescript
import type { Map } from 'ol';
import { fromLonLat } from 'ol/proj';
import {
  REGION_PROVINCE_NAMES,
  type BasemapName,
  type MapCommand,
} from '@webatlas/shared';
import { PROVINCE_CENTROIDS } from './provinceCentroids';

export interface CommandDeps {
  map: Map | null;
  setBasemap: (basemap: BasemapName) => void;
  toggleLayerVisibility: (layerStateId: string) => void;
  setLayerOpacity: (layerStateId: string, opacity: number) => void;
  getLayerVisible: (layerStateId: string) => boolean;
}

export type CommandResult = { ok: true; text: string } | { ok: false; reason: string };

const FEATURE_ZOOM = 12;
const PROVINCE_ZOOM = 9;
const ANIMATE_MS = 800;

/**
 * Executes MapCommands against OpenLayers. Dependencies are injected so this is
 * testable without a browser; the OL import is confined to this module.
 */
export function createCommandExecutor(deps: CommandDeps) {
  function animateTo(lonLat: [number, number], zoom: number): boolean {
    if (!deps.map) return false;
    deps.map.getView().animate({ center: fromLonLat(lonLat), zoom, duration: ANIMATE_MS });
    return true;
  }

  return function run(cmd: MapCommand): CommandResult {
    switch (cmd.kind) {
      case 'zoomToFeature': {
        if (!animateTo(cmd.lonLat, FEATURE_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: 'Đã phóng to tới đối tượng đã chọn.' };
      }
      case 'zoomToRegion': {
        const centre = PROVINCE_CENTROIDS[cmd.provinceCode];
        if (!centre) return { ok: false, reason: 'Không có toạ độ cho tỉnh này.' };
        if (!animateTo(centre, PROVINCE_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: `Đã phóng to tới ${REGION_PROVINCE_NAMES[cmd.provinceCode]}.` };
      }
      case 'setLayerVisible': {
        if (deps.getLayerVisible(cmd.layerStateId) !== cmd.visible) {
          deps.toggleLayerVisibility(cmd.layerStateId);
        }
        return { ok: true, text: cmd.visible ? 'Đã bật lớp dữ liệu.' : 'Đã tắt lớp dữ liệu.' };
      }
      case 'setLayerOpacity': {
        deps.setLayerOpacity(cmd.layerStateId, cmd.opacity);
        return { ok: true, text: `Đã đặt độ mờ ${Math.round(cmd.opacity * 100)}%.` };
      }
      case 'setBasemap': {
        deps.setBasemap(cmd.basemap);
        return { ok: true, text: 'Đã đổi bản đồ nền.' };
      }
    }
  };
}
```

- [ ] **Step 4: Add the province centroid table**

Create `apps/web/src/features/map/model/provinceCentroids.ts`. These are the six working-region provinces from `REGION_PROVINCE_CODES`, as `[lon, lat]`:

```typescript
/** Approximate centroids (lon, lat) for the six working-region provinces. */
export const PROVINCE_CENTROIDS: Record<string, [number, number]> = {
  '48': [108.15, 16.05], // Đà Nẵng
  '51': [108.75, 15.05], // Quảng Ngãi
  '52': [108.15, 13.85], // Gia Lai
  '56': [109.05, 12.35], // Khánh Hòa
  '66': [108.15, 12.70], // Đắk Lắk
  '68': [108.45, 11.85], // Lâm Đồng
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w @webatlas/web -- mapCommands`
Expected: PASS, 6 tests.

- [ ] **Step 6: Type-check**

Run: `npm run build:web`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/mapCommands.ts apps/web/src/features/map/model/mapCommands.test.ts apps/web/src/features/map/model/provinceCentroids.ts
git commit -m "feat(web): lớp thực thi lệnh bản đồ, cách ly OpenLayers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Design tokens and dark chrome

**Files:**
- Create: `apps/web/src/shared/ui/tokens.css`
- Modify: `apps/web/src/styles/main.css` (import tokens first)
- Modify: `apps/web/src/widgets/top-bar/ui/` (apply chrome classes — read the directory first)

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties every later UI task uses. Names are fixed here and must not be renamed later: `--chrome-bg`, `--chrome-fg`, `--surface`, `--surface-raised`, `--border`, `--text-main`, `--text-muted`, `--accent`, `--space-1..5`, `--radius-sm/md`, `--elev-1`.

- [ ] **Step 1: Read what exists before changing it**

```bash
cat apps/web/src/styles/main.css | head -60
grep -rn "glass-panel" apps/web/src --include=*.css --include=*.tsx | head -20
ls apps/web/src/widgets/top-bar/ui/
```

Note every current `--text-main` / `--text-muted` definition — `DynamicLegend.tsx` references both inline, so those two names must survive.

- [ ] **Step 2: Write the token sheet**

Create `apps/web/src/shared/ui/tokens.css`:

```css
/* Design tokens. Dark chrome (top bar + rail) framing light content panels.
   Chrome greens are chosen to sit away from the hazard-layer palette so the
   frame never competes with data colours. */
:root {
  --chrome-bg: #14532d;
  --chrome-bg-hover: #166534;
  --chrome-fg: #dcfce7;
  --chrome-fg-muted: #86efac;

  --surface: #ffffff;
  --surface-raised: #f8fafc;
  --surface-sunken: #f1f5f9;
  --border: #d4d4d8;
  --border-strong: #a1a1aa;

  --text-main: #18181b;
  --text-muted: #52525b;
  --accent: #0f766e;
  --danger: #b91c1c;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;

  --radius-sm: 3px;
  --radius-md: 6px;

  --elev-1: 0 1px 3px rgba(15, 23, 42, 0.12);
  --elev-2: 0 4px 12px rgba(15, 23, 42, 0.16);

  --rail-width: 48px;
  --flyout-width: 320px;
  --topbar-height: 48px;
}
```

- [ ] **Step 3: Import tokens ahead of everything else**

Add as the **first** line of `apps/web/src/styles/main.css`:

```css
@import '../shared/ui/tokens.css';
```

- [ ] **Step 4: Apply chrome to the top bar**

In the top-bar UI file found in Step 1, replace its background/text colours with `var(--chrome-bg)` and `var(--chrome-fg)`, and set its height to `var(--topbar-height)`. Do not change its markup structure or its tests.

- [ ] **Step 5: Verify the existing suite still passes**

Run: `npm run test -w @webatlas/web`
Expected: PASS. The top-bar tests assert behaviour, not colour, so they must stay green. If one fails on a colour assertion, update that assertion to the token.

- [ ] **Step 6: Type-check and commit**

```bash
npm run build:web
git add apps/web/src/shared/ui/tokens.css apps/web/src/styles/main.css apps/web/src/widgets/top-bar
git commit -m "feat(web): bộ design token và chrome tối cho thanh trên" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Icon rail and flyout host

**Files:**
- Create: `apps/web/src/features/shell/ui/IconRail.view.tsx`
- Create: `apps/web/src/features/shell/ui/IconRail.view.test.tsx`
- Create: `apps/web/src/features/shell/model/useRail.ts`
- Create: `apps/web/src/features/shell/model/useRail.test.ts`
- Modify: `apps/web/src/app/App.tsx:30-56`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type RailItemId = 'layers' | 'legend' | 'assistant' | 'edit'`; `useRail(): { active: RailItemId | null; toggle(id: RailItemId): void }`; `<IconRail items={...} active={...} onToggle={...} />`. Task 5, 6 and Plan B mount their panels into the flyout by adding a `RailItemId`.

- [ ] **Step 1: Write the failing presenter test**

Create `apps/web/src/features/shell/model/useRail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRail } from './useRail';

describe('useRail', () => {
  it('starts with the layers panel open', () => {
    const { result } = renderHook(() => useRail());
    expect(result.current.active).toBe('layers');
  });

  it('closes the active item when it is toggled again', () => {
    const { result } = renderHook(() => useRail());
    act(() => result.current.toggle('layers'));
    expect(result.current.active).toBeNull();
  });

  it('switches directly between items', () => {
    const { result } = renderHook(() => useRail());
    act(() => result.current.toggle('legend'));
    expect(result.current.active).toBe('legend');
    act(() => result.current.toggle('assistant'));
    expect(result.current.active).toBe('assistant');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- useRail`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the presenter**

Create `apps/web/src/features/shell/model/useRail.ts`:

```typescript
import { useState, useCallback } from 'react';

export type RailItemId = 'layers' | 'legend' | 'assistant' | 'edit';

/** Which rail panel is open. Toggling the active item closes it, giving a full-bleed map. */
export function useRail(initial: RailItemId | null = 'layers') {
  const [active, setActive] = useState<RailItemId | null>(initial);
  const toggle = useCallback((id: RailItemId) => {
    setActive((current) => (current === id ? null : id));
  }, []);
  return { active, toggle };
}
```

- [ ] **Step 4: Write the failing view test**

Create `apps/web/src/features/shell/ui/IconRail.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconRail, type RailItem } from './IconRail.view';

const items: RailItem[] = [
  { id: 'layers', label: 'Lớp dữ liệu' },
  { id: 'legend', label: 'Chú giải' },
];

describe('IconRail', () => {
  it('renders a button per item with an accessible label', () => {
    render(<IconRail items={items} active={null} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lớp dữ liệu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chú giải' })).toBeInTheDocument();
  });

  it('marks the active item as pressed', () => {
    render(<IconRail items={items} active="legend" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Chú giải' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lớp dữ liệu' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the item id', async () => {
    const onToggle = vi.fn();
    render(<IconRail items={items} active={null} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chú giải' }));
    expect(onToggle).toHaveBeenCalledWith('legend');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- IconRail`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement the view**

Create `apps/web/src/features/shell/ui/IconRail.view.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { RailItemId } from '../model/useRail';

export interface RailItem {
  id: RailItemId;
  label: string;
  icon?: ReactNode;
}

interface Props {
  items: RailItem[];
  active: RailItemId | null;
  onToggle: (id: RailItemId) => void;
}

/** Passive: the dark icon rail. All state lives in useRail. */
export function IconRail({ items, active, onToggle }: Props) {
  return (
    <nav className="icon-rail" aria-label="Bảng điều khiển">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`icon-rail-btn ${active === item.id ? 'active' : ''}`}
          aria-pressed={active === item.id}
          aria-label={item.label}
          title={item.label}
          onClick={() => onToggle(item.id)}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 7: Add the rail and flyout styles**

Append to `apps/web/src/styles/main.css`:

```css
.icon-rail {
  position: absolute; top: var(--topbar-height); left: 0; bottom: 0;
  width: var(--rail-width);
  background: var(--chrome-bg); color: var(--chrome-fg);
  display: flex; flex-direction: column; gap: var(--space-2);
  padding-top: var(--space-2); z-index: 20;
}
.icon-rail-btn {
  width: 100%; height: var(--rail-width);
  background: transparent; border: none; color: var(--chrome-fg-muted);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.icon-rail-btn:hover { background: var(--chrome-bg-hover); color: var(--chrome-fg); }
.icon-rail-btn.active { background: var(--surface); color: var(--chrome-bg); }

.rail-flyout {
  position: absolute; top: var(--topbar-height); left: var(--rail-width); bottom: 0;
  width: var(--flyout-width);
  background: var(--surface); border-right: 1px solid var(--border);
  overflow-y: auto; z-index: 19;
}
```

- [ ] **Step 8: Wire the rail into App.tsx**

Replace the panel composition in `apps/web/src/app/App.tsx` — delete the `panelsVisible` state, the `panels-wrapper` div, and the `toggle-panels-btn` button (lines 30–56 of the current file), and render the rail plus a flyout that holds the active panel. Keep `MapView`, `TopBar`, `DynamicPopup`, and `<Routes>` exactly where they are — `MapView` must remain a sibling of `<Routes>` so navigation never unmounts the map:

```tsx
const rail = useRail();

// …inside the app-container, after <TopBar />:
<IconRail
  items={[
    { id: 'layers', label: 'Lớp dữ liệu', icon: <Layers size={20} /> },
    { id: 'legend', label: 'Chú giải', icon: <List size={20} /> },
  ]}
  active={rail.active}
  onToggle={rail.toggle}
/>
{rail.active !== null && (
  <aside className="rail-flyout">
    {rail.active === 'layers' && <LayerTree />}
    {rail.active === 'legend' && <DynamicLegend />}
  </aside>
)}
```

`LayerTree` and `DynamicLegend` are the existing components for now; Tasks 5 and 6 replace them in place. `Shell`, `SearchBar`, and `OGCClient` stay mounted as they are and are handled in later tasks.

- [ ] **Step 9: Run the full web suite**

Run: `npm run test -w @webatlas/web`
Expected: PASS. `App.routing.test.tsx` asserts the map survives navigation — it must stay green. If it fails, `MapView` was moved inside `<Routes>`; put it back as a sibling.

- [ ] **Step 10: Type-check and commit**

```bash
npm run build:web
git add apps/web/src/features/shell apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): rail biểu tượng và flyout thay cho các panel nổi" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Layers panel from the real catalog

**Files:**
- Create: `apps/web/src/features/layers-panel/model/useLayersPanel.ts`
- Create: `apps/web/src/features/layers-panel/model/useLayersPanel.test.ts`
- Create: `apps/web/src/features/layers-panel/ui/LayersPanel.view.tsx`
- Create: `apps/web/src/features/layers-panel/ui/LayersPanel.view.test.tsx`
- Create: `apps/web/src/features/layers-panel/index.tsx`
- Create: `apps/web/src/entities/layer/layerDisplay.ts`
- Modify: `apps/web/src/app/App.tsx` (swap `LayerTree` for `LayersPanel`)

**Interfaces:**
- Consumes: `useLayerCatalog()` returning `LayerCatalogEntry[]` (`{ key, geomType, attributes }`) from `entities/layer/useLayerCatalog`; `useMapContext()` giving `layersState: LayerState[]`, `toggleLayerVisibility(id)`, `setLayerOpacity(id, o)`; `LAYER_REGISTRY` (`{ layerKey, layerStateId, wfsTypeName }[]`).
- Produces: `LAYER_DISPLAY: Record<string, LayerDisplayMeta>` in `entities/layer/layerDisplay.ts` where `interface LayerDisplayMeta { name: string; group: string; minZoom?: number }`, keyed by `layerStateId`. Task 6's legend imports the same display names.

**Why a display table is still needed:** `/api/layers` carries `key`, `geomType`, and `attributes` — no Vietnamese display name, no grouping, and no entry at all for the two administrative-boundary layers, which are client-side GeoJSON. The catalog is the authority on *what exists and is editable*; the display table supplies presentation. The panel cross-checks them so a catalog layer with no display entry is surfaced rather than silently dropped.

- [ ] **Step 1: Write the failing presenter test**

Create `apps/web/src/features/layers-panel/model/useLayersPanel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPanelGroups } from './useLayersPanel';

const display = {
  layer_dams: { name: 'Đập & Hồ chứa', group: 'Tài nguyên nước' },
  layer_rivers: { name: 'Mạng lưới sông ngòi', group: 'Tài nguyên nước', minZoom: 8.5 },
  layer_provinces_2026: { name: 'Ranh giới Tỉnh', group: 'Ranh giới hành chính' },
};

const state = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_rivers', visible: true, opacity: 0.8 },
  { id: 'layer_provinces_2026', visible: true, opacity: 1 },
];

describe('buildPanelGroups', () => {
  it('groups layers by their display group, preserving first-seen order', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 10 });
    expect(groups.map((g) => g.name)).toEqual(['Tài nguyên nước', 'Ranh giới hành chính']);
    expect(groups[0].layers.map((l) => l.id)).toEqual(['layer_dams', 'layer_rivers']);
  });

  it('marks a layer gated when the current zoom is below its minZoom', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 7 });
    const rivers = groups[0].layers.find((l) => l.id === 'layer_rivers')!;
    expect(rivers.gated).toBe(true);
    expect(rivers.gateHint).toBe('hiện từ mức 8,5');
  });

  it('does not mark a layer gated at or above its minZoom', () => {
    const groups = buildPanelGroups({ display, layersState: state, currentZoom: 8.5 });
    const rivers = groups[0].layers.find((l) => l.id === 'layer_rivers')!;
    expect(rivers.gated).toBe(false);
    expect(rivers.gateHint).toBeUndefined();
  });

  it('skips state entries that have no display metadata rather than crashing', () => {
    const groups = buildPanelGroups({
      display,
      layersState: [...state, { id: 'layer_unknown', visible: true, opacity: 1 }],
      currentZoom: 10,
    });
    expect(groups.flatMap((g) => g.layers).map((l) => l.id)).not.toContain('layer_unknown');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- useLayersPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the display table**

Create `apps/web/src/entities/layer/layerDisplay.ts`. `minZoom` values come from the zoom gates the performance work introduced (rivers/lakes 8.5, wards 10):

```typescript
export interface LayerDisplayMeta {
  name: string;
  group: string;
  /** Zoom below which the layer is not loaded — surfaced in the panel as a hint. */
  minZoom?: number;
  /** Seeds MapProvider's initial layersState (Task 10 removes the mockData source). */
  defaultVisible: boolean;
  opacity: number;
}

/** Presentation metadata keyed by layerStateId. The API catalog is the authority
 *  on which layers exist and are editable; this supplies names and grouping,
 *  including for the client-only administrative boundaries. */
export const LAYER_DISPLAY: Record<string, LayerDisplayMeta> = {
  layer_provinces_2026: { name: 'Ranh giới Tỉnh', group: 'Ranh giới hành chính', defaultVisible: true, opacity: 1 },
  layer_wards_2026: { name: 'Ranh giới Xã/Phường', group: 'Ranh giới hành chính', minZoom: 10, defaultVisible: true, opacity: 1 },
  layer_dams: { name: 'Đập & Hồ chứa', group: 'Tài nguyên nước', defaultVisible: true, opacity: 1 },
  layer_rivers: { name: 'Mạng lưới sông ngòi', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.8 },
  layer_lakes: { name: 'Hồ & Hồ chứa', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.85 },
  layer_stations: { name: 'Trạm quan trắc', group: 'Tài nguyên nước', defaultVisible: false, opacity: 1 },
  layer_flood: { name: 'Vùng ngập lụt', group: 'Hiểm họa', defaultVisible: false, opacity: 0.6 },
  layer_drought_survey: { name: 'Vùng hạn hán', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_saltwater_intrusion: { name: 'Xâm nhập mặn', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_flood_generation: { name: 'Vùng sinh lũ', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
};
```

These `defaultVisible`/`opacity` values are copied from the current `layerGroups` in `apps/web/src/data/mockData.ts` — verify them against that file before committing, since it is the behaviour being preserved:

```bash
sed -n '1,32p' apps/web/src/data/mockData.ts
```

- [ ] **Step 4: Implement the presenter**

Create `apps/web/src/features/layers-panel/model/useLayersPanel.ts`:

```typescript
import { useMapContext, type LayerState } from '../../../app/providers/MapProvider';
import { LAYER_DISPLAY, type LayerDisplayMeta } from '../../../entities/layer/layerDisplay';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
import { useLayerCatalog } from '../../../entities/layer/useLayerCatalog';

export interface PanelLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  gated: boolean;
  gateHint?: string;
}

export interface PanelGroup {
  name: string;
  layers: PanelLayer[];
}

function formatZoom(z: number): string {
  return String(z).replace('.', ',');
}

/** Pure: turns layer state + display metadata into grouped rows. Tested directly. */
export function buildPanelGroups(input: {
  display: Record<string, LayerDisplayMeta>;
  layersState: Pick<LayerState, 'id' | 'visible' | 'opacity'>[];
  currentZoom: number;
}): PanelGroup[] {
  const groups: PanelGroup[] = [];

  for (const state of input.layersState) {
    const meta = input.display[state.id];
    if (!meta) continue; // no display metadata: not renderable, skip rather than crash

    const gated = meta.minZoom !== undefined && input.currentZoom < meta.minZoom;
    let group = groups.find((g) => g.name === meta.group);
    if (!group) {
      group = { name: meta.group, layers: [] };
      groups.push(group);
    }
    group.layers.push({
      id: state.id,
      name: meta.name,
      visible: state.visible,
      opacity: state.opacity,
      gated,
      gateHint: gated ? `hiện từ mức ${formatZoom(meta.minZoom!)}` : undefined,
    });
  }

  return groups;
}

export function useLayersPanel(currentZoom: number) {
  const { layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const catalog = useLayerCatalog();

  const groups = buildPanelGroups({ display: LAYER_DISPLAY, layersState, currentZoom });

  // A layer the API says exists but that has no display metadata would silently
  // vanish from the panel. Surface it instead: map catalog keys through
  // LAYER_REGISTRY to their layerStateId and check LAYER_DISPLAY covers each.
  const missingDisplay = (catalog.data ?? [])
    .map((entry) => LAYER_REGISTRY.find((r) => r.layerKey === entry.key)?.layerStateId)
    .filter((layerStateId): layerStateId is string => layerStateId !== undefined)
    .filter((layerStateId) => LAYER_DISPLAY[layerStateId] === undefined);

  return { groups, toggleLayerVisibility, setLayerOpacity, catalogError: catalog.isError, missingDisplay };
}
```

- [ ] **Step 5: Run the presenter test**

Run: `npm run test -w @webatlas/web -- useLayersPanel`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing view test**

Create `apps/web/src/features/layers-panel/ui/LayersPanel.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersPanelView } from './LayersPanel.view';

const groups = [
  {
    name: 'Tài nguyên nước',
    layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', visible: true, opacity: 1, gated: false },
      { id: 'layer_rivers', name: 'Sông ngòi', visible: true, opacity: 0.8, gated: true, gateHint: 'hiện từ mức 8,5' },
    ],
  },
];

describe('LayersPanelView', () => {
  it('shows the gate hint on a zoom-gated layer', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByText('hiện từ mức 8,5')).toBeInTheDocument();
  });

  it('calls onToggle with the layer id', async () => {
    const onToggle = vi.fn();
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={onToggle} onOpacity={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Đập & Hồ chứa/ }));
    expect(onToggle).toHaveBeenCalledWith('layer_dams');
  });

  it('renders the group heading', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Tài nguyên nước' })).toBeInTheDocument();
  });

  it('warns about catalog layers that have no display metadata', () => {
    render(
      <LayersPanelView
        groups={groups}
        missingDisplay={['layer_new_thing']}
        onToggle={vi.fn()}
        onOpacity={vi.fn()}
      />
    );
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('layer_new_thing');
    expect(warning).toHaveTextContent('chưa có mô tả hiển thị');
  });

  it('renders no warning when nothing is missing', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run it to verify it fails, then implement the view**

Run: `npm run test -w @webatlas/web -- LayersPanel` → FAIL (module not found).

Create `apps/web/src/features/layers-panel/ui/LayersPanel.view.tsx`:

```tsx
import type { PanelGroup } from '../model/useLayersPanel';

interface Props {
  groups: PanelGroup[];
  /** layerStateIds the API catalog knows about but LAYER_DISPLAY does not cover. */
  missingDisplay: string[];
  onToggle: (layerStateId: string) => void;
  onOpacity: (layerStateId: string, opacity: number) => void;
}

/** Passive: renders grouped layer rows. No data fetching, no map access. */
export function LayersPanelView({ groups, missingDisplay, onToggle, onOpacity }: Props) {
  return (
    <div className="layers-panel">
      <h2 className="panel-title">Quản lý dữ liệu</h2>
      {missingDisplay.length > 0 && (
        <p role="status" className="layers-warning">
          {missingDisplay.length} lớp có trong hệ thống nhưng chưa có mô tả hiển thị:{' '}
          {missingDisplay.join(', ')}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.name} className="layers-group">
          <h3 className="layers-group-title">{group.name}</h3>
          {group.layers.map((layer) => (
            <div key={layer.id} className={`layer-row ${layer.gated ? 'gated' : ''}`}>
              <label className="layer-label">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{layer.name}</span>
              </label>
              {layer.gated && <span className="layer-gate-hint">{layer.gateHint}</span>}
              {layer.visible && !layer.gated && (
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={layer.opacity}
                  aria-label={`Độ mờ ${layer.name}`}
                  onChange={(e) => onOpacity(layer.id, parseFloat(e.target.value))}
                />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Create the slice entry point**

Create `apps/web/src/features/layers-panel/index.tsx`:

```tsx
import { useLayersPanel } from './model/useLayersPanel';
import { LayersPanelView } from './ui/LayersPanel.view';
import { useMapZoom } from '../map/model/useMapZoom';

export default function LayersPanel() {
  const zoom = useMapZoom();
  const { groups, missingDisplay, toggleLayerVisibility, setLayerOpacity } = useLayersPanel(zoom);
  return (
    <LayersPanelView
      groups={groups}
      missingDisplay={missingDisplay}
      onToggle={toggleLayerVisibility}
      onOpacity={setLayerOpacity}
    />
  );
}
```

- [ ] **Step 9: Extract the zoom hook from MapControls**

`MapControls.tsx:28-49` already subscribes to `change:resolution`. Extract that into `apps/web/src/features/map/model/useMapZoom.ts` so both the panel and the toolbar share one subscription:

```typescript
import { useEffect, useState } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { MIN_ZOOM } from './zoomScale';

/** Current map zoom, updated continuously during interaction. */
export function useMapZoom(): number {
  const { map } = useMapContext();
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);

  useEffect(() => {
    if (!map) return;
    const view = map.getView();
    setZoom(view.getZoom() ?? MIN_ZOOM);
    const onChange = () => {
      const z = view.getZoom();
      if (z !== undefined) setZoom(z);
    };
    view.on('change:resolution', onChange);
    return () => view.un('change:resolution', onChange);
  }, [map]);

  return zoom;
}
```

- [ ] **Step 10: Swap it into the flyout**

In `App.tsx`, replace `<LayerTree />` with `<LayersPanel />` and update the import.

- [ ] **Step 11: Run the suite, type-check, commit**

```bash
npm run test -w @webatlas/web
npm run build:web
git add apps/web/src/features/layers-panel apps/web/src/entities/layer/layerDisplay.ts apps/web/src/features/map/model/useMapZoom.ts apps/web/src/app/App.tsx
git commit -m "feat(web): panel lớp dữ liệu theo catalog thật, hiện trạng thái cổng zoom" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Data-driven legend

**Files:**
- Create: `packages/shared/src/legend.ts`
- Create: `packages/shared/src/legend.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/web/src/features/legend/ui/Legend.view.tsx`
- Create: `apps/web/src/features/legend/ui/Legend.view.test.tsx`
- Create: `apps/web/src/features/legend/index.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: `DAM_STATUS_SLUGS`, `DAM_STATUS_DISPLAY` from `@webatlas/shared`; `LAYER_DISPLAY` from Task 5.
- Produces: `interface LegendEntry { swatch: string; shape: 'dot' | 'line' | 'box'; label: string; size?: number }`, `interface LegendSection { title: string; entries: LegendEntry[]; note?: string }`, `function legendFor(layerStateId: string): LegendSection[]`, `const LEGEND_ATTRIBUTION: Record<string, string>`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/legend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { legendFor, LEGEND_ATTRIBUTION } from './legend.js';
import { DAM_STATUS_SLUGS } from './dam-status.js';

describe('legendFor', () => {
  it('returns a status section and a capacity section for dams', () => {
    const sections = legendFor('layer_dams');
    expect(sections.map((s) => s.title)).toEqual(['Theo Trạng thái', 'Theo Công suất']);
  });

  it('emits one status entry per dam status slug', () => {
    const [status] = legendFor('layer_dams');
    expect(status.entries).toHaveLength(DAM_STATUS_SLUGS.length);
    expect(status.entries.every((e) => e.swatch.startsWith('#'))).toBe(true);
  });

  it('returns a single line entry for rivers', () => {
    const sections = legendFor('layer_rivers');
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].shape).toBe('line');
  });

  it('returns an empty array for a layer with no legend', () => {
    expect(legendFor('layer_provinces_2026')).toEqual([]);
  });

  it('carries ODbL attribution for the OSM-sourced layers', () => {
    expect(LEGEND_ATTRIBUTION.layer_rivers).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_lakes).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_dams).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/shared -- legend`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the descriptors**

Create `packages/shared/src/legend.ts`:

```typescript
import { DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY } from './dam-status.js';

export interface LegendEntry {
  swatch: string;
  shape: 'dot' | 'line' | 'box';
  label: string;
  /** Rendered diameter in px for 'dot' entries that encode magnitude. */
  size?: number;
}

export interface LegendSection {
  title: string;
  entries: LegendEntry[];
  note?: string;
}

/** Attribution required by the data licence, keyed by layerStateId.
 *  OSM data is ODbL and MUST carry this wherever the layer is shown. */
export const LEGEND_ATTRIBUTION: Record<string, string> = {
  layer_rivers: '© OpenStreetMap contributors (ODbL)',
  layer_lakes: '© OpenStreetMap contributors (ODbL)',
};

const CAPACITY_ENTRIES: LegendEntry[] = [
  { swatch: '#6b7280', shape: 'dot', size: 6, label: 'Nhỏ (< 200 MW)' },
  { swatch: '#6b7280', shape: 'dot', size: 11, label: 'Vừa (200 – 1000 MW)' },
  { swatch: '#6b7280', shape: 'dot', size: 16, label: 'Lớn (> 1000 MW)' },
];

/** Legend sections for a layer. Adding a layer means adding a case here —
 *  no JSX branches, no inline styles. */
export function legendFor(layerStateId: string): LegendSection[] {
  switch (layerStateId) {
    case 'layer_dams':
      return [
        {
          title: 'Theo Trạng thái',
          entries: DAM_STATUS_SLUGS.map((slug) => ({
            swatch: DAM_STATUS_DISPLAY[slug].color,
            shape: 'dot' as const,
            label: DAM_STATUS_DISPLAY[slug].label,
          })),
        },
        { title: 'Theo Công suất', entries: CAPACITY_ENTRIES },
      ];
    case 'layer_rivers':
      return [{ title: 'Sông ngòi', entries: [{ swatch: '#3b82f6', shape: 'line', label: 'Dòng chảy' }] }];
    case 'layer_lakes':
      return [{ title: 'Hồ', entries: [{ swatch: '#60a5fa', shape: 'box', label: 'Mặt nước' }] }];
    case 'layer_stations':
      return [{ title: 'Trạm quan trắc', entries: [{ swatch: '#f59e0b', shape: 'dot', label: 'Trạm' }] }];
    default:
      return [];
  }
}
```

Add `export * from './legend.js';` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run the test, rebuild dist**

```bash
npm run test -w @webatlas/shared -- legend    # PASS, 5 tests
npm run build:shared
```

- [ ] **Step 5: Write the failing view test**

Create `apps/web/src/features/legend/ui/Legend.view.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegendView } from './Legend.view';

describe('LegendView', () => {
  it('renders nothing when no layers are visible', () => {
    const { container } = render(<LegendView layers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a section title and its entry labels', () => {
    render(
      <LegendView
        layers={[
          {
            layerStateId: 'layer_rivers',
            name: 'Sông ngòi',
            sections: [{ title: 'Sông ngòi', entries: [{ swatch: '#3b82f6', shape: 'line', label: 'Dòng chảy' }] }],
          },
        ]}
      />
    );
    expect(screen.getByText('Dòng chảy')).toBeInTheDocument();
  });

  it('renders the licence attribution when present', () => {
    render(
      <LegendView
        layers={[
          {
            layerStateId: 'layer_lakes',
            name: 'Hồ',
            sections: [{ title: 'Hồ', entries: [{ swatch: '#60a5fa', shape: 'box', label: 'Mặt nước' }] }],
            attribution: '© OpenStreetMap contributors (ODbL)',
          },
        ]}
      />
    );
    expect(screen.getByText('© OpenStreetMap contributors (ODbL)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Implement the view**

Create `apps/web/src/features/legend/ui/Legend.view.tsx`:

```tsx
import type { LegendEntry, LegendSection } from '@webatlas/shared';

export interface LegendLayer {
  layerStateId: string;
  name: string;
  sections: LegendSection[];
  attribution?: string;
}

function Swatch({ entry }: { entry: LegendEntry }) {
  const size = entry.size ?? 12;
  if (entry.shape === 'line') {
    return <span className="legend-swatch-line" style={{ background: entry.swatch }} />;
  }
  return (
    <span
      className={entry.shape === 'dot' ? 'legend-swatch-dot' : 'legend-swatch-box'}
      style={{ background: entry.swatch, width: size, height: size }}
    />
  );
}

/** Passive: renders legend descriptors. No layer-specific branching. */
export function LegendView({ layers }: { layers: LegendLayer[] }) {
  if (layers.length === 0) return null;

  return (
    <div className="legend-panel">
      <h2 className="panel-title">Chú giải</h2>
      {layers.map((layer) => (
        <section key={layer.layerStateId} className="legend-layer">
          <h3 className="legend-layer-title">{layer.name}</h3>
          {layer.sections.map((section) => (
            <div key={section.title} className="legend-section">
              <div className="legend-section-title">{section.title}</div>
              {section.entries.map((entry) => (
                <div key={entry.label} className="legend-entry">
                  <Swatch entry={entry} />
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          ))}
          {layer.attribution && <p className="legend-attribution">{layer.attribution}</p>}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create the slice entry point**

Create `apps/web/src/features/legend/index.tsx`:

```tsx
import { legendFor, LEGEND_ATTRIBUTION } from '@webatlas/shared';
import { useMapContext } from '../../app/providers/MapProvider';
import { LAYER_DISPLAY } from '../../entities/layer/layerDisplay';
import { LegendView, type LegendLayer } from './ui/Legend.view';

export default function Legend() {
  const { layersState } = useMapContext();

  const layers: LegendLayer[] = layersState
    .filter((l) => l.visible)
    .map((l) => ({
      layerStateId: l.id,
      name: LAYER_DISPLAY[l.id]?.name ?? l.id,
      sections: legendFor(l.id),
      attribution: LEGEND_ATTRIBUTION[l.id],
    }))
    .filter((l) => l.sections.length > 0);

  return <LegendView layers={layers} />;
}
```

- [ ] **Step 8: Swap into the flyout, add styles**

In `App.tsx` replace `<DynamicLegend />` with `<Legend />`. Append to `main.css`:

```css
.legend-swatch-dot { display: inline-block; border-radius: 50%; }
.legend-swatch-box { display: inline-block; border-radius: var(--radius-sm); }
.legend-swatch-line { display: inline-block; width: 16px; height: 3px; }
.legend-entry { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; }
.legend-section-title { font-size: 11px; color: var(--text-muted); font-weight: 500; margin-top: var(--space-2); }
.legend-attribution { font-size: 10px; color: var(--text-muted); margin-top: var(--space-2); }
```

- [ ] **Step 9: Run, type-check, commit**

```bash
npm run test -w @webatlas/web
npm run build:web
git add packages/shared/src/legend.ts packages/shared/src/legend.test.ts packages/shared/src/index.ts packages/shared/dist apps/web/src/features/legend apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat: chú giải theo mô tả dữ liệu, kèm ghi công ODbL" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Toolbar on the command layer

**Files:**
- Create: `apps/web/src/features/map/ui/MapToolbar.tsx`
- Create: `apps/web/src/features/map/ui/MapToolbar.test.tsx`
- Create: `apps/web/src/features/map/model/useMeasure.ts`
- Modify: `apps/web/src/app/App.tsx`
- Delete: `apps/web/src/components/MapControls.tsx`, `apps/web/src/components/BasemapSwitcher.tsx`

**Interfaces:**
- Consumes: `createCommandExecutor`, `CommandDeps` (Task 2); `useMapZoom` (Task 5); `MIN_ZOOM`, `MAX_ZOOM`, `scaleAtZoom`, `formatScale` from `features/map/model/zoomScale`.
- Produces: `useMeasure(): { mode: 'none' | 'length' | 'area'; value: string | null; start(m): void; clear(): void }` — Plan B's `measure` tool reads the same formatting helpers.

The measurement logic moves from `components/MapControls.tsx` into `features/map/model/useMeasure.ts` **unchanged in behaviour** — this task is a move plus a rewiring, not a rewrite of the measurement maths.

- [ ] **Step 1: Read the code being moved**

```bash
sed -n '50,246p' apps/web/src/components/MapControls.tsx
```

Copy the `Draw` interaction setup, the `getLength`/`getArea` handlers, and the formatting verbatim into the new hook. Behaviour must not change.

- [ ] **Step 2: Write the failing toolbar test**

Create `apps/web/src/features/map/ui/MapToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapToolbarView } from './MapToolbar';

const base = {
  zoom: 9,
  scaleText: '1:200.000',
  measureMode: 'none' as const,
  measureValue: null,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onReset: vi.fn(),
  onMeasure: vi.fn(),
  onBasemap: vi.fn(),
};

describe('MapToolbarView', () => {
  it('renders the current scale', () => {
    render(<MapToolbarView {...base} />);
    expect(screen.getByText('1:200.000')).toBeInTheDocument();
  });

  it('calls onReset when the home button is pressed', async () => {
    const onReset = vi.fn();
    render(<MapToolbarView {...base} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Về vùng công tác' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the measurement readout when there is a value', () => {
    render(<MapToolbarView {...base} measureMode="length" measureValue="42,3 km" />);
    expect(screen.getByText('42,3 km')).toBeInTheDocument();
  });

  it('marks the active measure tool as pressed', () => {
    render(<MapToolbarView {...base} measureMode="area" />);
    expect(screen.getByRole('button', { name: 'Đo diện tích' })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then implement**

Run: `npm run test -w @webatlas/web -- MapToolbar` → FAIL.

Create `apps/web/src/features/map/ui/MapToolbar.tsx` exporting both `MapToolbarView` (passive, props-only, as exercised above) and a default `MapToolbar` container that wires `useMapZoom`, `useMeasure`, and `createCommandExecutor`. The container's zoom buttons and reset call commands:

```tsx
const run = createCommandExecutor({
  map, setBasemap, toggleLayerVisibility, setLayerOpacity,
  getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
});

const onReset = () => run({ kind: 'zoomToRegion', provinceCode: '66' });
const onBasemap = (b: BasemapName) => run({ kind: 'setBasemap', basemap: b });
```

- [ ] **Step 4: Mount the toolbar, delete the old components**

In `App.tsx`, replace `<MapControls />` with `<MapToolbar />` and remove the `BasemapSwitcher` import from the old `LayerTree` path (that component is deleted; basemap selection now lives in the toolbar).

```bash
git rm apps/web/src/components/MapControls.tsx apps/web/src/components/BasemapSwitcher.tsx
```

- [ ] **Step 5: Verify no OpenLayers import escaped the quarantine**

```bash
grep -rn "from 'ol" apps/web/src --include=*.tsx --include=*.ts \
  | grep -v "src/features/map/model/" | grep -v ".test."
```

Expected: no output. Any hit must be moved into `features/map/model/`.

- [ ] **Step 6: Run, type-check, commit**

```bash
npm run test -w @webatlas/web
npm run build:web
git add apps/web/src/features/map apps/web/src/app/App.tsx
git commit -m "feat(web): thanh công cụ bản đồ chạy qua lớp lệnh" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Search endpoint

**Files:**
- Create: `apps/api/src/db/migrations/1000000000007_pg-trgm-search.cjs`
- Create: `apps/api/src/modules/search/repository.ts`
- Create: `apps/api/src/modules/search/service.ts`
- Create: `apps/api/src/modules/search/controller.ts`
- Create: `apps/api/src/modules/search/routes.ts`
- Create: `apps/api/src/modules/search/search.test.ts`
- Modify: `apps/api/src/server.ts` (register the route)

**Interfaces:**
- Consumes: `req.server.pg`, the `validate` helper from `../../lib/validate`, `EDITABLE_LAYER_KEYS`.
- Produces: `GET /api/search?q=<string>&limit=<number>` returning `{ results: SearchHit[] }` where
  `interface SearchHit { layerKey: EditableLayerKey; featureId: string; name: string; lonLat: [number, number] }`.
  Task 9 consumes this; Plan B's `nearestFeatures` tool reuses `repository.ts`.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/db/migrations/1000000000007_pg-trgm-search.cjs`. It must be a **migration**, not an edit to `infra/postgis/init.sql`, because that file runs only on first database init and would silently skip every existing dev database:

```javascript
/* eslint-disable camelcase */
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql(`CREATE INDEX IF NOT EXISTS dams_name_trgm ON water.dams USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS lakes_name_trgm ON water.lakes USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS rivers_name_trgm ON water.rivers USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS stations_name_trgm ON water.stations USING gin (name gin_trgm_ops)`);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS water.dams_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.lakes_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.rivers_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.stations_name_trgm');
  // pg_trgm is left installed: other objects may depend on it.
};
```

- [ ] **Step 2: Confirm the column name before relying on it**

```bash
grep -rn "name" apps/api/src/db/migrations/1000000000002_water-schema.cjs | head -20
```

If any of the four tables uses a different column for its display name, correct the migration and the repository query to match. Do not assume.

- [ ] **Step 3: Apply the migration**

Run: `npm run migrate:up -w @webatlas/api`
Expected: the new migration applies cleanly. If `CREATE EXTENSION` fails on permissions, the dev database user needs superuser — note it and stop; that is an environment problem, not a code one.

- [ ] **Step 4: Write the failing integration test**

Create `apps/api/src/modules/search/search.test.ts`, following the pattern in `apps/api/src/modules/layers/layers.test.ts` (read it first for the app-building and cleanup conventions):

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /api/search', () => {
  it('rejects a missing query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a query shorter than two characters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=a' });
    expect(res.statusCode).toBe(400);
  });

  it('returns matching features with coordinates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=thu' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ layerKey: string; lonLat: [number, number]; name: string }> };
    expect(Array.isArray(body.results)).toBe(true);
    for (const hit of body.results) {
      expect(hit.lonLat).toHaveLength(2);
      expect(typeof hit.name).toBe('string');
    }
  });

  it('caps results at the requested limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=a&limit=3' });
    if (res.statusCode === 200) {
      expect(res.json().results.length).toBeLessThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- search`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 6: Implement the repository**

Create `apps/api/src/modules/search/repository.ts`. Searching only the four named layers (the ones with names worth searching), against the active-version views:

```typescript
import type { Pool } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';

export interface SearchHit {
  layerKey: EditableLayerKey;
  featureId: string;
  name: string;
  lonLat: [number, number];
}

const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

/** Trigram search across the named layers, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(pool: Pool, q: string, limit: number): Promise<SearchHit[]> {
  const unions = SEARCHABLE.map(
    (key) => `
      SELECT '${key}'::text AS layer_key, id::text AS feature_id, name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             similarity(name, $1) AS sim
      FROM water.${key}_active
      WHERE geom IS NOT NULL AND name IS NOT NULL AND name % $1`
  ).join(' UNION ALL ');

  const { rows } = await pool.query(
    `${unions} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as EditableLayerKey,
    featureId: r.feature_id,
    name: r.name,
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
```

- [ ] **Step 7: Confirm the active-version view names**

```bash
grep -n "CREATE.*VIEW\|_active" apps/api/src/db/migrations/1000000000005_active-version-views.cjs
```

If the views are not named `<layer>_active`, correct the query. Do not guess the naming.

- [ ] **Step 8: Implement service, controller, routes**

`service.ts`:

```typescript
import type { Pool } from 'pg';
import { searchByName, type SearchHit } from './repository';

export function searchService(pool: Pool) {
  return {
    search: (q: string, limit: number): Promise<SearchHit[]> => searchByName(pool, q, limit),
  };
}
```

`controller.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { searchService } from './service';

const SearchQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function search(req: FastifyRequest, reply: FastifyReply) {
  const { q, limit } = validate(SearchQuery, req.query);
  const results = await searchService(req.server.pg).search(q, limit);
  reply.send({ results });
}
```

`routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { search } from './controller';

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', search);
}
```

Register in `apps/api/src/server.ts`, after the layers registration:

```typescript
app.register(searchRoutes, { prefix: '/api' });
```

- [ ] **Step 9: Run the test, commit**

```bash
npm run test -w @webatlas/api -- search    # PASS, 4 tests
git add apps/api/src/modules/search apps/api/src/db/migrations/1000000000007_pg-trgm-search.cjs apps/api/src/server.ts
git commit -m "feat(api): endpoint tìm kiếm theo tên dùng pg_trgm" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Search UI on the endpoint

**Files:**
- Create: `apps/web/src/features/search/api/search.api.ts`
- Create: `apps/web/src/features/search/model/useSearch.ts`
- Create: `apps/web/src/features/search/model/useSearch.test.ts`
- Create: `apps/web/src/features/search/ui/SearchBox.view.tsx`
- Create: `apps/web/src/features/search/ui/SearchBox.view.test.tsx`
- Create: `apps/web/src/features/search/index.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Delete: `apps/web/src/components/SearchBar.tsx`

**Interfaces:**
- Consumes: `GET /api/search` (Task 8) via `apiRequest` from `shared/api/apiClient`; `createCommandExecutor` (Task 2).
- Produces: nothing consumed later.

The defect being fixed: the old component fetched the entire `dams` layer over WFS on mount with no bbox. Nothing in the new slice fetches a layer.

- [ ] **Step 1: Write the failing debounce test**

Create `apps/web/src/features/search/model/useSearch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearch } from './useSearch';
import * as api from '../api/search.api';

describe('useSearch', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not query for input shorter than two characters', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('a'));
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(spy).not.toHaveBeenCalled();
  });

  it('debounces to a single request for rapid input', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('th'));
    act(() => result.current.setQuery('thu'));
    act(() => result.current.setQuery('thuy'));
    await act(async () => { vi.advanceTimersByTime(500); });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('thuy');
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement the API and hook**

Run: `npm run test -w @webatlas/web -- useSearch` → FAIL.

`apps/web/src/features/search/api/search.api.ts`:

```typescript
import { apiRequest } from '../../../shared/api/apiClient';
import type { EditableLayerKey } from '@webatlas/shared';

export interface SearchHit {
  layerKey: EditableLayerKey;
  featureId: string;
  name: string;
  lonLat: [number, number];
}

export async function fetchSearch(q: string): Promise<SearchHit[]> {
  const body = await apiRequest<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
  return body.results;
}
```

`apps/web/src/features/search/model/useSearch.ts`:

```typescript
import { useState, useEffect } from 'react';
import { fetchSearch, type SearchHit } from '../api/search.api';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < MIN_CHARS) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetchSearch(query.trim())
        .then((hits) => { if (!cancelled) setResults(hits); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return { query, setQuery, results, loading };
}
```

- [ ] **Step 3: Implement the view and slice entry**

Create `apps/web/src/features/search/ui/SearchBox.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBoxView } from './SearchBox.view';

const hits = [
  { layerKey: 'dams' as const, featureId: 'd1', name: 'Thủy điện Ya Ly', lonLat: [108.0, 14.2] as [number, number] },
  { layerKey: 'lakes' as const, featureId: 'l1', name: 'Hồ Lắk', lonLat: [108.2, 12.4] as [number, number] },
];

describe('SearchBoxView', () => {
  it('renders the input with its placeholder', () => {
    render(<SearchBoxView query="" results={[]} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByPlaceholderText('Tìm kiếm đối tượng…')).toBeInTheDocument();
  });

  it('renders each result name', () => {
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('Thủy điện Ya Ly')).toBeInTheDocument();
    expect(screen.getByText('Hồ Lắk')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked hit', async () => {
    const onSelect = vi.fn();
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Hồ Lắk'));
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });

  it('forwards typing to onQuery', async () => {
    const onQuery = vi.fn();
    render(<SearchBoxView query="" results={[]} loading={false} onQuery={onQuery} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Tìm kiếm đối tượng…'), 'h');
    expect(onQuery).toHaveBeenCalledWith('h');
  });
});
```

Run `npm run test -w @webatlas/web -- SearchBox` → FAIL, then create `apps/web/src/features/search/ui/SearchBox.view.tsx`:

```tsx
import type { SearchHit } from '../api/search.api';

const LAYER_BADGE: Record<string, string> = {
  dams: 'Đập', lakes: 'Hồ', rivers: 'Sông', stations: 'Trạm',
};

interface Props {
  query: string;
  results: SearchHit[];
  loading: boolean;
  onQuery: (q: string) => void;
  onSelect: (hit: SearchHit) => void;
}

/** Passive: input + results list. No fetching, no map access. */
export function SearchBoxView({ query, results, loading, onQuery, onSelect }: Props) {
  return (
    <div className="search-box">
      <input
        type="text"
        className="search-input"
        placeholder="Tìm kiếm đối tượng…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {loading && <span className="search-loading">Đang tìm…</span>}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((hit) => (
            <li key={`${hit.layerKey}:${hit.featureId}`}>
              <button type="button" className="search-result" onClick={() => onSelect(hit)}>
                <span className="search-badge">{LAYER_BADGE[hit.layerKey] ?? hit.layerKey}</span>
                <span>{hit.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Then create `apps/web/src/features/search/index.tsx`, wiring the hook to the command executor:

```tsx
import { useSearch } from './model/useSearch';
import { SearchBoxView } from './ui/SearchBox.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { useMapContext } from '../../app/providers/MapProvider';
import type { SearchHit } from './api/search.api';

export default function Search() {
  const { query, setQuery, results, loading } = useSearch();
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();

  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
  });

  const onSelect = (hit: SearchHit) =>
    run({ kind: 'zoomToFeature', layerKey: hit.layerKey, featureId: hit.featureId, lonLat: hit.lonLat });

  return (
    <SearchBoxView query={query} results={results} loading={loading} onQuery={setQuery} onSelect={onSelect} />
  );
}
```

- [ ] **Step 4: Swap into the top bar, delete the old component**

Mount `<Search />` inside the top bar. Then:

```bash
git rm apps/web/src/components/SearchBar.tsx
```

- [ ] **Step 5: Run, type-check, commit**

```bash
npm run test -w @webatlas/web
npm run build:web
git add apps/web/src/features/search apps/web/src/app/App.tsx apps/web/src/widgets/top-bar
git commit -m "feat(web): tìm kiếm qua API thay vì tải toàn bộ lớp WFS" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Retire dead code and verify the whole

**Files:**
- Delete: `apps/web/src/components/LayerTree.tsx`, `LayerTree.test.tsx`, `DynamicLegend.tsx`
- Modify: `apps/web/src/data/mockData.ts`, `apps/web/src/entities/layer/layerRegistry.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing still imports the dead components**

```bash
grep -rn "LayerTree\|DynamicLegend\|MapControls\|BasemapSwitcher\|SearchBar" apps/web/src --include=*.tsx --include=*.ts
```

Expected: no output. Any hit must be updated before deleting.

- [ ] **Step 2: Delete them**

```bash
git rm apps/web/src/components/LayerTree.tsx apps/web/src/components/LayerTree.test.tsx apps/web/src/components/DynamicLegend.tsx
```

- [ ] **Step 3: Remove the mock layer groups**

`layerGroups` in `apps/web/src/data/mockData.ts` is now superseded by `LAYER_DISPLAY`, but `MapProvider` still uses it to seed `layersState`. Change `MapProvider` to seed from `LAYER_DISPLAY` instead, then delete the `layerGroups` export from `mockData.ts` and its re-export from `entities/layer/layerRegistry.ts`. Seeding needs a default visibility and opacity per layer — add those two fields to `LayerDisplayMeta` and carry over the values currently in `mockData.ts` (dams/rivers/lakes/provinces/wards visible by default; rivers 0.8, lakes 0.85, hazards 0.6–0.7, rest 1).

- [ ] **Step 4: Verify the OpenLayers quarantine holds**

```bash
grep -rn "from 'ol" apps/web/src --include=*.tsx --include=*.ts \
  | grep -v "src/features/map/model/" | grep -v ".test."
```

Expected: no output. This is the Global Constraint gate.

- [ ] **Step 5: Verify no mock data remains in the render path**

```bash
grep -rn "mockData" apps/web/src --include=*.tsx --include=*.ts
```

Expected: no output, or only imports of non-layer mock fixtures. `layerGroups` specifically must be gone.

- [ ] **Step 6: Full verification**

```bash
npm run build:shared
npm run test -w @webatlas/shared
npm run lint:web
npm run build:web
npm run test -w @webatlas/web
npm run test -w @webatlas/api
```

Expected: all exit 0. Record any failure verbatim — do not paper over it.

- [ ] **Step 7: Manual check against the running app**

Start the stack (`docker compose -f infra/docker-compose.yml up -d`, `npm run dev -w @webatlas/api`, `npm run dev:web`) and confirm by eye: the rail opens and closes each panel; the map goes full-bleed when the active item is toggled off; a zoom-gated layer shows its hint below zoom 8,5; the legend shows ODbL attribution when rivers or lakes are visible; searching a dam name zooms to it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(web): gỡ các component cũ đã được thay thế" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
