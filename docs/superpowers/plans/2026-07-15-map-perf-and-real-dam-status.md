# Map Performance + Real Dam Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache OpenLayers styles instead of re-allocating them per feature per frame, and make the DB the source of truth for dam operational status (canonical slugs), driving the map style, popup, legend, and reservoir filter from one shared slug→{label,color} map.

**Architecture:** A new OL-free `@webatlas/shared` module (`dam-status.ts`) is the single vocabulary for dam status (slug ↔ label/color). The dams seed assigns each dam a deterministic status slug. On the frontend, WFS load-time stamps the slug + label once per dam feature; the style functions read that pre-computed slug and return cached `Style` objects (no per-frame allocation, no `feature.set`); the popup and legend read colors/labels from the shared map. OpenLayers stays quarantined to `features/map/model/`.

**Tech Stack:** TypeScript, `@webatlas/shared` (Vitest), OpenLayers 10 (`apps/web`, Vitest + jsdom), Postgres seed (`apps/api`, node, Vitest integration).

## Global Constraints

- **Canonical stored value = slug:** `dams.status` holds `'binh_thuong' | 'xa_lu' | 'nguy_hiem'`. Display strings/colors are derived on the frontend only.
- **Null/unknown status → `binh_thuong`** everywhere (the safe default).
- **Seed assignment is deterministic** (stable hash of `external_id`) so `ON CONFLICT` re-seed is reproducible (seeds are idempotent/re-run-stable).
- **Single source of truth:** after this change no component may hardcode a dam-status string or color — the style, popup, and legend all read `DAM_STATUS_DISPLAY` / the slug helpers. The three status colors are exactly: `binh_thuong → #10b981`, `xa_lu → #f59e0b`, `nguy_hiem → #ef4444`; labels: `Bình thường`, `Xả lũ`, `Nguy hiểm`.
- **`@webatlas/shared` is consumed from `dist/`** — after editing `packages/shared/src/*`, rebuild with `npm run build:shared` and commit the regenerated `dist/*` (files are tracked-but-git-ignored; stage with `git add -u packages/shared/dist/`, not `git add packages/shared/dist/`).
- **OpenLayers quarantine:** no `ol/*` import outside `apps/web/src/features/map/model/`. `dam-status.ts` (shared) is OL-free. `DynamicPopup.tsx`/`DynamicLegend.tsx` do not import `ol/*`.
- **Verification gotcha:** bare `tsc -p tsconfig.json` in `apps/web` checks NOTHING (`"files": []`). Type-check with `npm run build:web` (tsc -b + vite).
- **TS constraints (web tsconfig):** `verbatimModuleSyntax` (type-only imports use `import type`), `erasableSyntaxOnly` (no TS enums / no constructor parameter-properties), `noUnusedLocals`/`noUnusedParameters`, `jsx: react-jsx`.
- **Scope:** style-caching + dam-status-as-real-data only. No WFS-loading (bbox) changes, no bundle splitting, no changes to the other 6 layers' status.

## Directory layout (new/changed files)

```
packages/shared/src/
  dam-status.ts                 # (create) DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY, toDamStatusSlug, damStatusDisplay
  dam-status.test.ts            # (create)
  index.ts                      # (modify) export * from './dam-status'
  # dist/* regenerated via npm run build:shared

apps/api/src/db/seeds/
  damStatus.ts                  # (create) assignDamStatus(externalId) -> slug (deterministic)
  damStatus.test.ts             # (create) pure unit (no DB)
  registry.ts                   # (modify) dams columns mapper adds status: assignDamStatus(p.ID)
  seed.test.ts                  # (modify) add a DB assertion: all dams have a valid slug status

apps/web/src/features/map/model/
  wfsSource.ts                  # (modify) dams: stamp statusSlug + operationalStatus (label) once at load
  styles.ts                     # (modify) cache river/dam/province styles; dams read pre-computed slug
  styles.test.ts                # (create) cache-identity + dam color + filter-hide tests

apps/web/src/components/
  DynamicPopup.tsx              # (modify) dam status color/label from shared map
  DynamicLegend.tsx             # (modify) dam status legend rows from shared map
```

---

### Task 1: Shared dam-status vocabulary

**Files:**
- Create: `packages/shared/src/dam-status.ts`, `packages/shared/src/dam-status.test.ts`
- Modify: `packages/shared/src/index.ts`
- Regenerate: `packages/shared/dist/*`

**Interfaces:**
- Produces:
  - `const DAM_STATUS_SLUGS = ['binh_thuong','xa_lu','nguy_hiem'] as const`
  - `type DamStatusSlug = (typeof DAM_STATUS_SLUGS)[number]`
  - `interface DamStatusDisplay { label: string; color: string }`
  - `const DAM_STATUS_DISPLAY: Record<DamStatusSlug, DamStatusDisplay>`
  - `function toDamStatusSlug(v: unknown): DamStatusSlug` — returns `v` if it's a known slug; also maps the known Vietnamese labels back to their slug (so legacy display-string data coerces); everything else → `'binh_thuong'`.
  - `function damStatusDisplay(v: unknown): DamStatusDisplay` — `DAM_STATUS_DISPLAY[toDamStatusSlug(v)]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/dam-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DAM_STATUS_SLUGS,
  DAM_STATUS_DISPLAY,
  toDamStatusSlug,
  damStatusDisplay,
} from './dam-status';

describe('dam-status vocabulary', () => {
  it('has exactly the three canonical slugs', () => {
    expect([...DAM_STATUS_SLUGS]).toEqual(['binh_thuong', 'xa_lu', 'nguy_hiem']);
  });

  it('maps every slug to a label + color', () => {
    expect(DAM_STATUS_DISPLAY.binh_thuong).toEqual({ label: 'Bình thường', color: '#10b981' });
    expect(DAM_STATUS_DISPLAY.xa_lu).toEqual({ label: 'Xả lũ', color: '#f59e0b' });
    expect(DAM_STATUS_DISPLAY.nguy_hiem).toEqual({ label: 'Nguy hiểm', color: '#ef4444' });
  });

  it('toDamStatusSlug passes through known slugs', () => {
    expect(toDamStatusSlug('xa_lu')).toBe('xa_lu');
    expect(toDamStatusSlug('nguy_hiem')).toBe('nguy_hiem');
  });

  it('toDamStatusSlug coerces known Vietnamese labels back to slugs', () => {
    expect(toDamStatusSlug('Nguy hiểm')).toBe('nguy_hiem');
    expect(toDamStatusSlug('Xả lũ')).toBe('xa_lu');
    expect(toDamStatusSlug('Bình thường')).toBe('binh_thuong');
  });

  it('toDamStatusSlug defaults null/unknown to binh_thuong', () => {
    expect(toDamStatusSlug(null)).toBe('binh_thuong');
    expect(toDamStatusSlug(undefined)).toBe('binh_thuong');
    expect(toDamStatusSlug('garbage')).toBe('binh_thuong');
    expect(toDamStatusSlug(42)).toBe('binh_thuong');
  });

  it('damStatusDisplay returns the label+color for a value', () => {
    expect(damStatusDisplay('nguy_hiem')).toEqual({ label: 'Nguy hiểm', color: '#ef4444' });
    expect(damStatusDisplay(null)).toEqual({ label: 'Bình thường', color: '#10b981' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/shared -- dam-status.test.ts`
Expected: FAIL — cannot find module `./dam-status`.

- [ ] **Step 3: Implement the module**

Create `packages/shared/src/dam-status.ts`:
```ts
export const DAM_STATUS_SLUGS = ['binh_thuong', 'xa_lu', 'nguy_hiem'] as const;
export type DamStatusSlug = (typeof DAM_STATUS_SLUGS)[number];

export interface DamStatusDisplay {
  label: string;
  color: string;
}

export const DAM_STATUS_DISPLAY: Record<DamStatusSlug, DamStatusDisplay> = {
  binh_thuong: { label: 'Bình thường', color: '#10b981' },
  xa_lu: { label: 'Xả lũ', color: '#f59e0b' },
  nguy_hiem: { label: 'Nguy hiểm', color: '#ef4444' },
};

// Reverse lookup: Vietnamese label -> slug (for legacy display-string data).
const LABEL_TO_SLUG: Record<string, DamStatusSlug> = Object.fromEntries(
  (Object.keys(DAM_STATUS_DISPLAY) as DamStatusSlug[]).map((slug) => [DAM_STATUS_DISPLAY[slug].label, slug])
);

/** Coerce any DB/user value to a known slug; null/unknown -> binh_thuong. */
export function toDamStatusSlug(v: unknown): DamStatusSlug {
  if (typeof v === 'string') {
    if ((DAM_STATUS_SLUGS as readonly string[]).includes(v)) return v as DamStatusSlug;
    if (LABEL_TO_SLUG[v]) return LABEL_TO_SLUG[v];
  }
  return 'binh_thuong';
}

/** slug/value -> { label, color }, with the safe default. */
export function damStatusDisplay(v: unknown): DamStatusDisplay {
  return DAM_STATUS_DISPLAY[toDamStatusSlug(v)];
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/index.ts`, append:
```ts
export * from './dam-status';
```

- [ ] **Step 5: Run test → PASS**

Run: `npm run test -w @webatlas/shared -- dam-status.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Rebuild shared dist + commit**

```bash
npm run build:shared
git add packages/shared/src/dam-status.ts packages/shared/src/dam-status.test.ts packages/shared/src/index.ts
git add -u packages/shared/dist/
git commit -m "feat(shared): dam-status vocabulary (slug <-> label/color, single source of truth)"
```

---

### Task 2: Deterministic seed status assignment

**Files:**
- Create: `apps/api/src/db/seeds/damStatus.ts`, `apps/api/src/db/seeds/damStatus.test.ts`
- Modify: `apps/api/src/db/seeds/registry.ts`

**Interfaces:**
- Consumes: `DAM_STATUS_SLUGS`, `DamStatusSlug` (Task 1).
- Produces: `assignDamStatus(externalId: unknown): DamStatusSlug` — deterministic: a stable hash of `String(externalId)` mapped into a weighted distribution (≈70% `binh_thuong`, ≈18% `xa_lu`, ≈12% `nguy_hiem`). Same input → same output across calls. Used by the dams seed `columns` mapper.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/seeds/damStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assignDamStatus } from './damStatus';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';

describe('assignDamStatus', () => {
  it('is deterministic (same id -> same slug)', () => {
    expect(assignDamStatus('D123')).toBe(assignDamStatus('D123'));
    expect(assignDamStatus(42)).toBe(assignDamStatus(42));
  });

  it('always returns a known slug', () => {
    for (let i = 0; i < 500; i++) {
      expect(DAM_STATUS_SLUGS).toContain(assignDamStatus(`dam-${i}`));
    }
  });

  it('produces all three slugs across a representative id range (variety preserved)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(assignDamStatus(`dam-${i}`));
    expect(seen.has('binh_thuong')).toBe(true);
    expect(seen.has('xa_lu')).toBe(true);
    expect(seen.has('nguy_hiem')).toBe(true);
  });

  it('leans majority-normal (binh_thuong is the most common)', () => {
    const counts: Record<string, number> = { binh_thuong: 0, xa_lu: 0, nguy_hiem: 0 };
    for (let i = 0; i < 1000; i++) counts[assignDamStatus(`dam-${i}`)]++;
    expect(counts.binh_thuong).toBeGreaterThan(counts.xa_lu);
    expect(counts.binh_thuong).toBeGreaterThan(counts.nguy_hiem);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- damStatus.test.ts`
Expected: FAIL — cannot find module `./damStatus`.

- [ ] **Step 3: Implement the assigner**

Create `apps/api/src/db/seeds/damStatus.ts`:
```ts
import { DAM_STATUS_SLUGS, type DamStatusSlug } from '@webatlas/shared';

/** Stable non-negative hash of a string (djb2-ish), same as the frontend hashCode. */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

/**
 * Deterministically assign a dam status slug from its external id.
 * Weighted ~70/18/12 (normal/xa_lu/nguy_hiem). Same id -> same slug (idempotent seed).
 */
export function assignDamStatus(externalId: unknown): DamStatusSlug {
  const bucket = hashString(String(externalId)) % 100;
  if (bucket < 70) return DAM_STATUS_SLUGS[0]; // binh_thuong
  if (bucket < 88) return DAM_STATUS_SLUGS[1]; // xa_lu
  return DAM_STATUS_SLUGS[2];                   // nguy_hiem
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test:api -- damStatus.test.ts`
Expected: 4 tests pass. (Pure unit — no DB needed.)

- [ ] **Step 5: Wire into the dams seed mapper**

In `apps/api/src/db/seeds/registry.ts`, add the import at the top (after the existing imports):
```ts
import { assignDamStatus } from './damStatus';
```
Then in the `dams` entry's `columns` mapper, add the `status` line:
```ts
    columns: (p) => ({
      external_id: p.ID,
      name: p.Vietnamese,
      name_en: p.English_hy,
      wattage_mw: p.Wattage_PL,
      annual_output: p['Quantity_('],
      year_launched: p.Year_of_la,
      year_operational: p.Year_of_op,
      status: assignDamStatus(p.ID),
    }),
```

- [ ] **Step 6: Type-check the API**

Run: `npm run test:api -- damStatus.test.ts registry.test.ts`
Expected: `damStatus` (4) + `registry` (existing) pass. (`registry.test.ts` is pure; it will still pass — the dams schema already allows `status` via `nullableStr`.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/seeds/damStatus.ts apps/api/src/db/seeds/damStatus.test.ts apps/api/src/db/seeds/registry.ts
git commit -m "feat(api): seed dams with deterministic status slugs (real DB status)"
```

---

### Task 3: Seed integration assertion (dams carry valid slug statuses)

**Files:**
- Modify: `apps/api/src/db/seeds/seed.test.ts`

**Interfaces:**
- Consumes: `DAM_STATUS_SLUGS` (Task 1), the seed run (Task 2). This is a DB-integration test (needs the live stack); it runs when `npm run test:api` is run against the DB.

- [ ] **Step 1: Add the DB assertion**

In `apps/api/src/db/seeds/seed.test.ts`, add this test inside the `describe('seeds', ...)` block (after the "idempotent" test), and add the import at the top:
```ts
import { DAM_STATUS_SLUGS } from '@webatlas/shared';
```
```ts
  it('assigns every dam a valid status slug (not null)', async () => {
    const { rows } = await getPool().query(
      `SELECT DISTINCT status FROM water.dams`
    );
    const statuses = rows.map((r) => r.status);
    // no nulls
    expect(statuses.includes(null)).toBe(false);
    // every distinct value is a known slug
    for (const s of statuses) {
      expect(DAM_STATUS_SLUGS).toContain(s);
    }
    // variety: more than one distinct status present across 371 dams
    expect(statuses.length).toBeGreaterThan(1);
  });
```

- [ ] **Step 2: Run (requires the DB stack up)**

Run: `npm run test:api -- seed.test.ts`
Expected: with the stack up and after a re-seed, all seed tests pass including the new one. If the stack is down, this test cannot run — note it as a stack-gated verification (the pure `damStatus.test.ts` already proves the assignment logic).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/seeds/seed.test.ts
git commit -m "test(api): assert seeded dams carry valid status slugs"
```

---

### Task 4: WFS load-time dam status stamping

**Files:**
- Modify: `apps/web/src/features/map/model/wfsSource.ts`

**Interfaces:**
- Consumes: `toDamStatusSlug`, `DAM_STATUS_DISPLAY` (Task 1).
- Produces: after `featuresloadend`, each **dams** feature carries `statusSlug: DamStatusSlug` (from the DB `status`) and `operationalStatus: string` (the Vietnamese label for that slug), set **once**. Other layers unchanged. The style (Task 5) reads `statusSlug`; the popup (Task 6) reads `statusSlug` (falling back to `operationalStatus`).

- [ ] **Step 1: Add the stamping in the load handler**

In `apps/web/src/features/map/model/wfsSource.ts`, add the import (with the existing `@webatlas/shared` import — extend it):
```ts
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties, toDamStatusSlug, DAM_STATUS_DISPLAY, type EditableLayerKey } from '@webatlas/shared';
```
Then inside the `source.on('featuresloadend', ...)` callback, after the existing loop that replaces properties with the ISO-named set (right before `source.changed();`), add a dams-only pass:
```ts
    if (layerKey === 'dams') {
      for (const f of loaded) {
        if (!f.getGeometry()) continue;
        // The ISO-normalized props keep the raw DB `status` under operationalStatus? No —
        // `status` maps to operationalStatus via LAYER_ATTRIBUTE_MAP. Read whatever is there,
        // coerce to a canonical slug, and stamp both the slug and the display label once.
        const raw = f.get('operationalStatus');
        const slug = toDamStatusSlug(raw);
        f.set('statusSlug', slug, true);
        f.set('operationalStatus', DAM_STATUS_DISPLAY[slug].label, true);
      }
    }
```

Note on the mapping: `LAYER_ATTRIBUTE_MAP.dams.attributes.status === 'operationalStatus'`, so `normalizeFeatureProperties` already renames the DB `status` slug to the `operationalStatus` key. This pass reads that value, canonicalizes it to a slug, and overwrites `operationalStatus` with the display **label** while adding `statusSlug` for the style/filter. Using `true` (silent) avoids emitting change events during load.

- [ ] **Step 2: Build to type-check**

Run: `npm run build:web`
Expected: compiles clean. (`f.set(key, value, true)` is the OL silent-set signature; `f.get` returns `any`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/map/model/wfsSource.ts
git commit -m "feat(web): stamp dam statusSlug + label once at WFS load (from real DB status)"
```

---

### Task 5: Style caching + dams read pre-computed slug

**Files:**
- Modify: `apps/web/src/features/map/model/styles.ts`
- Create: `apps/web/src/features/map/model/styles.test.ts`

**Interfaces:**
- Consumes: `DAM_STATUS_DISPLAY`, `DamStatusSlug`, `toDamStatusSlug` (Task 1); the `statusSlug` stamped on dam features (Task 4); `ReservoirFilterType` (existing, from `MapModel`).
- Produces: cached style functions. `makeDamsStyle` no longer computes status from id nor calls `feature.set`; it reads `feature.get('statusSlug')` (coerced via `toDamStatusSlug` for safety), colors from `DAM_STATUS_DISPLAY`, and returns a cached `CircleStyle` keyed by `${slug}|${roundedRadius}`. The reservoir filter compares slugs: `currentFilter === statusSlug`. `riversStyle`/`makeRiverSelectStyle` return cached per-bucket `Style[]`. `provincesStyle` memoizes its label geometry on the feature.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/styles.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Style } from 'ol/style';
import { riversStyle, makeDamsStyle } from './styles';

// Minimal fake OL feature: only get() is used by the style functions.
function fakeFeature(props: Record<string, unknown>) {
  return { get: (k: string) => props[k], set: () => {} } as any;
}

describe('style caching', () => {
  it('riversStyle returns the SAME array reference for the same stream order (cached)', () => {
    const f = fakeFeature({ streamOrder: 1 });
    const a = riversStyle(f);
    const b = riversStyle(fakeFeature({ streamOrder: 1 }));
    expect(a).toBe(b);
  });

  it('riversStyle returns styles (array of ol/style Style)', () => {
    const styles = riversStyle(fakeFeature({ streamOrder: 2 }));
    expect(Array.isArray(styles)).toBe(true);
    expect(styles[0]).toBeInstanceOf(Style);
  });

  it('makeDamsStyle colors by statusSlug from the shared map', () => {
    const damsStyle = makeDamsStyle(() => 'all');
    const style = damsStyle(fakeFeature({ statusSlug: 'nguy_hiem', ratedPower: 100 }));
    // single Style with a CircleStyle image whose fill is the nguy_hiem color
    const fillColor = (style as Style).getImage()?.getFill?.().getColor();
    expect(fillColor).toBe('#ef4444');
  });

  it('makeDamsStyle caches identical (slug,radius) styles', () => {
    const damsStyle = makeDamsStyle(() => 'all');
    const a = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    const b = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    expect(a).toBe(b);
  });

  it('makeDamsStyle hides a dam whose slug does not match the active filter', () => {
    const damsStyle = makeDamsStyle(() => 'nguy_hiem');
    const hidden = damsStyle(fakeFeature({ statusSlug: 'binh_thuong', ratedPower: 100 }));
    expect(hidden).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/styles.test.ts`
Expected: FAIL — current `makeDamsStyle` computes status from id and returns a fresh `Style` each call (not cached; no `statusSlug` support), and `riversStyle` allocates fresh arrays.

- [ ] **Step 3: Refactor rivers to cached per-bucket styles**

In `apps/web/src/features/map/model/styles.ts`, replace the `riversStyle` function (lines ~4-34) with a bucketed cache:
```ts
// Stream-order -> [border width, core width]; bucket 0 is the "everything else" default.
const RIVER_WIDTHS: Record<number, [number, number]> = {
  1: [7, 3.5],
  2: [5, 2.2],
  3: [3, 1.2],
  0: [1.5, 0.5],
};

function riverBucket(cap: number): 0 | 1 | 2 | 3 {
  return cap === 1 ? 1 : cap === 2 ? 2 : cap === 3 ? 3 : 0;
}

// Precompute the 4 style arrays once at module load.
const RIVER_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) }),
        new Style({ stroke: new Stroke({ color: '#38bdf8', width: mainWidth }) }),
      ],
    ];
  })
);

// Style cho mạng lưới sông ngòi động dựa trên cấp độ sông (Cap) — cached, no per-frame allocation.
export const riversStyle = (feature: any) => {
  const cap = feature.get('streamOrder') || 6;
  return RIVER_STYLES[riverBucket(cap)];
};
```

- [ ] **Step 4: Refactor the river-select highlight to cached per-bucket styles**

Replace `makeRiverSelectStyle` (lines ~231-261) with a cached version reusing `RIVER_WIDTHS`/`riverBucket`:
```ts
// Highlight styles (cached) for ol/interaction/Select on rivers.
const RIVER_SELECT_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#fde047', width: borderWidth + 4 }) }),
        new Style({ stroke: new Stroke({ color: '#ef4444', width: mainWidth + 2 }) }),
      ],
    ];
  })
);

export function makeRiverSelectStyle() {
  return (feature: any) => {
    const cap = feature.get('streamOrder') || 6;
    return RIVER_SELECT_STYLES[riverBucket(cap)];
  };
}
```

- [ ] **Step 5: Refactor dams to read the slug + cache by (slug, radius)**

Replace `makeDamsStyle` (lines ~189-228) with:
```ts
import { DAM_STATUS_DISPLAY, toDamStatusSlug, type DamStatusSlug } from '@webatlas/shared';

// Cache CircleStyle by `${slug}|${radius}` — bounded (3 slugs x ~13 integer radii).
const damStyleCache = new Map<string, Style>();

function damStyle(slug: DamStatusSlug, radius: number): Style {
  const key = `${slug}|${radius}`;
  let style = damStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: DAM_STATUS_DISPLAY[slug].color }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
    });
    damStyleCache.set(key, style);
  }
  return style;
}

// Cartodiagram: size ~ ratedPower, color ~ operational status (real DB slug, stamped at load).
// Reads the pre-computed statusSlug (Task 4); does NOT mutate the feature or derive status from id.
export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any): Style | undefined => {
    const slug = toDamStatusSlug(feature.get('statusSlug'));

    const currentFilter = getReservoirFilter();
    if (currentFilter !== 'all' && currentFilter !== slug) return undefined;

    const wattage = feature.get('ratedPower') || 50;
    const radius = Math.round(Math.max(6, Math.min(18, 6 + wattage / 180)));
    return damStyle(slug, radius);
  };
}
```
Note: `ReservoirFilterType` is `'all' | 'binh_thuong' | 'xa_lu' | 'nguy_hiem'` (from `MapModel`), which now aligns 1:1 with the slugs — so `currentFilter !== slug` is a direct comparison. Remove the old id-based status logic and the `feature.set('operationalStatus', ...)` call entirely.

- [ ] **Step 6: Memoize the province label geometry**

In `provincesStyle` (lines ~109-156), cache the computed `labelGeometry` on the feature so the largest-polygon area loop runs once per feature, not per frame. Replace the label-geometry computation block:
```ts
  const geom = feature.getGeometry();
  let labelGeometry = feature.get('_labelGeom');
  if (!labelGeometry && geom) {
    const geomType = geom.getType();
    if (geomType === 'MultiPolygon') {
      const polygons = geom.getPolygons();
      let maxArea = -1;
      let largestPolygon = polygons[0];
      polygons.forEach((poly: any) => {
        const area = poly.getArea();
        if (area > maxArea) { maxArea = area; largestPolygon = poly; }
      });
      if (largestPolygon) labelGeometry = largestPolygon.getInteriorPoint();
    } else if (geomType === 'Polygon') {
      labelGeometry = geom.getInteriorPoint();
    }
    if (labelGeometry) feature.set('_labelGeom', labelGeometry, true);
  }
  if (!labelGeometry) labelGeometry = geom;
```
Keep the rest of `provincesStyle` (the returned fill/stroke/text styles) unchanged.

- [ ] **Step 7: Run tests → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/styles.test.ts`
Expected: 5 tests pass.

- [ ] **Step 8: Build to type-check the whole web app**

Run: `npm run build:web`
Expected: clean. Watch: the `DamStatusSlug`/`type` import must be `import type` where type-only, and `ReservoirFilterType` import is unchanged.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/map/model/styles.ts apps/web/src/features/map/model/styles.test.ts
git commit -m "perf(web): cache river/dam/province styles; dams color from real status slug (no per-frame alloc)"
```

---

### Task 6: Popup + legend read from the shared map

**Files:**
- Modify: `apps/web/src/components/DynamicPopup.tsx`, `apps/web/src/components/DynamicLegend.tsx`

**Interfaces:**
- Consumes: `damStatusDisplay`, `DAM_STATUS_DISPLAY`, `DAM_STATUS_SLUGS` (Task 1); `statusSlug`/`operationalStatus` on dam feature props (Task 4).

- [ ] **Step 1: Popup — status label + color from the shared map**

In `apps/web/src/components/DynamicPopup.tsx`, add the import:
```ts
import { damStatusDisplay } from '@webatlas/shared';
```
In the `dams` branch of `renderPopupContent`, replace the hardcoded status row (the `<div className="info-row">…operationalStatus === 'Nguy hiểm' ? … </div>` around lines 161-162) with:
```tsx
          {(() => {
            const st = damStatusDisplay(props.statusSlug ?? props.operationalStatus);
            return (
              <div className="info-row"><Activity size={14} className="text-blue-500" />
                <span>Trạng thái: <strong className="status-text" style={{ color: st.color }}>{st.label}</strong></span></div>
            );
          })()}
```
And in the cartodiagram list item that echoes the status (around line 167), replace `{props.operationalStatus || 'Bình thường'}` with:
```tsx
{damStatusDisplay(props.statusSlug ?? props.operationalStatus).label}
```

- [ ] **Step 2: Legend — dam status rows from the shared map**

In `apps/web/src/components/DynamicLegend.tsx`, add the import:
```ts
import { DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY } from '@webatlas/shared';
```
Replace the three hardcoded status legend rows (the "Theo Trạng thái" block, lines ~30-41) with a generated list:
```tsx
                  {DAM_STATUS_SLUGS.map((slug) => (
                    <div key={slug} className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="legend-color-box" style={{ background: DAM_STATUS_DISPLAY[slug].color, width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }}></span>
                      <span className="legend-label" style={{ fontSize: '12px' }}>{DAM_STATUS_DISPLAY[slug].label}</span>
                    </div>
                  ))}
```
Leave the "Theo Công suất" (size) block unchanged.

- [ ] **Step 3: Build to type-check**

Run: `npm run build:web`
Expected: clean. (Neither file imports `ol/*`; both only add a `@webatlas/shared` import.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/DynamicPopup.tsx apps/web/src/components/DynamicLegend.tsx
git commit -m "feat(web): popup + legend read dam status label/color from shared map (single source)"
```

---

### Task 7: Full verification + manual /run

**Files:** (no new source) — a verification task.

- [ ] **Step 1: Full suites + build + lint**

Run (from repo root):
```bash
npm run test:shared
npm run test -w @webatlas/web
npm run build:web
npm run lint:web
```
Expected: shared green (incl. `dam-status`), web green (incl. `styles.test.ts`), build clean, lint exit 0 (pre-existing warnings only). `npm run test:api -- damStatus.test.ts` also green (pure). `seed.test.ts` runs only with the DB stack up.

- [ ] **Step 2: Convention guard (single source of truth)**

Confirm no dam-status string/color is hardcoded outside the shared map anymore. Run:
```bash
git grep -n "Nguy hiểm\|Xả lũ\|'#ef4444'\|'#f59e0b'" -- 'apps/web/src/components/DynamicPopup.tsx' 'apps/web/src/components/DynamicLegend.tsx' 'apps/web/src/features/map/model/styles.ts' || echo "OK: no hardcoded dam-status strings/colors outside shared"
```
Expected: `OK: ...` (the only occurrences of these colors should be in `packages/shared/src/dam-status.ts`). Note: `#ef4444` also legitimately appears for flood styling and river-select — those are NOT dam status; verify any match is unrelated to dam status before treating it as a violation.

- [ ] **Step 3: Re-seed the DB (stack up) then manual /run**

Prereqs: DB + GeoServer up, API + web dev servers running.
- Re-seed so the 371 dams get real statuses: `npm run seed`.
- Load the app. Confirm:
  - Dams render a red/amber/green spread (now from real seeded data).
  - Click a dam → popup shows the correct status label + matching color; the cartodiagram line echoes the same label.
  - The legend's three status rows match the map colors.
  - Reservoir filter buttons (Tất cả / Bình thường / Xả lũ / Nguy hiểm) correctly show/hide dams by slug.
  - Pan/zoom is smooth (no per-frame style allocation).
- If the stack is down, this step is stack-gated; the unit tests already prove the vocabulary, assignment, caching, and color mapping.

- [ ] **Step 4: Commit (only if a fix was needed)**

No code change expected here. If Step 2 surfaced a stray hardcoded status/color you fixed, commit it:
```bash
git add -A
git commit -m "chore(web): remove stray hardcoded dam-status value (single-source guard)"
```

---

## Self-Review

**1. Spec coverage (design §1–§9):**
- Style caching — rivers/dams/provinces/(wards optional) (§1, §3D) → Task 5 (rivers, dams, provinces cached; wards left minimal — see note below) ✓
- Real dam status, canonical slug (§2, §3A/B/C) → Tasks 1 (shared), 2 (seed), 4 (WFS stamp) ✓
- Seed deterministic assignment (§2) → Task 2 (pure unit) + Task 3 (DB assertion) ✓
- Null → binh_thuong default (§2, §5) → Task 1 `toDamStatusSlug` ✓
- Single source of truth: style/popup/legend/filter from one map (§3D/E, §7.2) → Tasks 5, 6 + Task 7 guard ✓
- Shared dist rebuild (§7.3) → Task 1 Step 6 ✓
- OL quarantine (§7.1) → `dam-status.ts` shared/OL-free; popup/legend no `ol/*` ✓
- Testing (§6): shared unit, seed unit + DB assertion, styles cache/color/filter unit, /run visual → Tasks 1–7 ✓

**2. Placeholder scan:** every step has concrete code/commands; no TBD/TODO. The `damStatusDisplay(props.statusSlug ?? props.operationalStatus)` fallback is intentional (handles both the stamped slug and any legacy label).

**3. Type/name consistency:** `DAM_STATUS_SLUGS`, `DamStatusSlug`, `DAM_STATUS_DISPLAY`, `DamStatusDisplay`, `toDamStatusSlug`, `damStatusDisplay` (Task 1) used consistently in Tasks 2, 4, 5, 6. `assignDamStatus` (Task 2) used in the seed mapper. `statusSlug` (Task 4) read in Tasks 5, 6. `ReservoirFilterType` slug values align with `DamStatusSlug` (both `binh_thuong|xa_lu|nguy_hiem`) — verified against `MapModel.ts`. Colors/labels are stated once in Global Constraints and only defined in `dam-status.ts`.

**4. Deviations / notes for the implementer:**
- **Wards caching (design §3D "lower priority; include if clean"):** deliberately NOT included as a task — the wards style is one `Style` per feature with a per-feature hashed hue; caching by hue bucket is possible but the win is smaller and the hue space is large. YAGNI for this pass; left as a follow-up. This is a conscious scope trim, not a gap.
- **`ReservoirFilterType` already uses the slug vocabulary** (`binh_thuong|xa_lu|nguy_hiem`) — no change needed to `MapModel`/`MapProvider`; the filter now compares slugs directly instead of Vietnamese labels, which is simpler and removes the old label round-trip.
- **`styles.ts` functions take `any`** (existing pattern); the tests build minimal fake features. Do not retype the whole module — follow the existing `any` convention.
- **`f.set(k, v, true)`** is OL's silent set (no change event) — used at load (Task 4) and for the province `_labelGeom` memo (Task 5) to avoid re-render churn.
- **Seed re-run required for visual effect:** the code change alone doesn't backfill the 371 existing rows until `npm run seed` runs against the DB (idempotent upsert). Flagged in Task 7.

---

## Follow-on (out of scope)

- Wards style caching by hue bucket.
- WFS bbox/zoom-gated loading + server-side geometry simplification for rivers/wards.
- Map bundle code-splitting (OpenLayers is the bulk of the 635 kB chunk).
- Curated (non-random) authoritative dam statuses — the slug column + shared map accept them with no code change.
