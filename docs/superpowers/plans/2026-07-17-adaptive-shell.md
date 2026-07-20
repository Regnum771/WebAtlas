# Adaptive Shell + Persona Panels (Roadmap 2.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat pile of map overlays with a persona-workspace framework — a left rail whose entries reveal a task panel per persona — hosting the existing FeatureEditing (Data Steward) and UserManagement (Admin) features, with typed placeholders for Governance/Research.

**Architecture:** A new `entities/persona/` model (`Persona`, `rolePersonas(role)`, `usePersona()` with a localStorage pick) is the "who am I acting as" source of truth. A new `features/shell/` slice (`useShellPresenter` + passive `PersonaRail`/`WorkspacePanel` views + a `WorkspacePlaceholder`) consumes it and maps the active persona to content. `App.tsx` renders `<Shell />` instead of the loose edit/manage overlays. Frontend only, no backend/schema change; persona is UX routing, `RequireRole` still gates hosted features.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (`renderHook`, `render`, `@testing-library/user-event`), jsdom localStorage, oxlint. No TanStack Query, no `apiRequest`, no `ol/*` in this slice.

**Design doc:** `docs/superpowers/specs/2026-07-17-adaptive-shell-design.md`

## Global Constraints

- **Persona is UX routing only.** Hosted features keep their own `RequireRole` gates; the shell is never the authorization decision — the container carries the "shell reveals UX per role; backend enforces" comment (design §3 rule 2, §8).
- **No backend/schema change**, no `apiRequest`, no `ol/*` in `entities/persona` or `features/shell` (design §8 rule 3).
- **Presenter returns a view-model + handlers** (no JSX, no fetch); `*.view.tsx` are props-only (design §8 rule 1).
- **localStorage access is defensive** — absent/malformed/stale-for-role values resolve to the first available persona, never throw. Key: `webatlas.persona` (matches the `webatlas.*` namespace; `TOKEN_KEY = 'webatlas.token'` exists) (design §4.2, §8 rule 4).
- **Role → personas (exact):** admin→`['steward','admin']`; editor→`['steward']`; viewer→`['governance','research']`; null/anon→`['public']` (design §2).
- **`public` has no workspace panel** — `workspaces` = available personas minus `public`; anonymous → no rail (design §4.3).
- **Reuse `glass-panel` + absolute-positioning** styling; no new styling system (design §8 rule 5).
- **Existing component signatures (verified):** `UserManagement({ open, onClose }: { open: boolean; onClose: () => void })`; `FeatureEditing()` (no props). `useSession()` returns `{ currentUser: { id,email,full_name,role } | null, ... }`.
- **Test command:** `npm test -w @webatlas/web` (vitest, no DB). Build: `npm run build -w @webatlas/web`. Lint: `npm run lint -w @webatlas/web`. Tests use `renderHook`/`render` + real jsdom `localStorage` with `localStorage.clear()` in `beforeEach`; mock `useSession` via `vi.mock`.

---

### Task 1: Persona model — `entities/persona/persona.ts`

**Files:**
- Create: `apps/web/src/entities/persona/persona.ts`
- Test: `apps/web/src/entities/persona/persona.test.ts`

**Interfaces:**
- Consumes: `Role` from `entities/session/model/session.types`.
- Produces: `PersonaId`, `Persona`, `PERSONAS`, `rolePersonas(role)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/entities/persona/persona.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PERSONAS, rolePersonas } from './persona';

describe('rolePersonas', () => {
  it('admin gets steward + admin (superset)', () => {
    expect(rolePersonas('admin')).toEqual(['steward', 'admin']);
  });
  it('editor gets steward', () => {
    expect(rolePersonas('editor')).toEqual(['steward']);
  });
  it('viewer gets governance + research', () => {
    expect(rolePersonas('viewer')).toEqual(['governance', 'research']);
  });
  it('anonymous / undefined gets public', () => {
    expect(rolePersonas(null)).toEqual(['public']);
    expect(rolePersonas(undefined)).toEqual(['public']);
  });
});

describe('PERSONAS registry', () => {
  it('has a label + requiredRole for every id', () => {
    for (const id of ['public', 'governance', 'research', 'steward', 'admin'] as const) {
      expect(PERSONAS[id].id).toBe(id);
      expect(typeof PERSONAS[id].label).toBe('string');
    }
    expect(PERSONAS.public.requiredRole).toBeNull();
    expect(PERSONAS.steward.requiredRole).toBe('editor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- persona.test`
Expected: FAIL — cannot resolve `./persona`.

- [ ] **Step 3: Implement `persona.ts`**

Create `apps/web/src/entities/persona/persona.ts`:

```ts
import type { Role } from '../session/model/session.types';

export type PersonaId = 'public' | 'governance' | 'research' | 'steward' | 'admin';

export interface Persona {
  id: PersonaId;
  label: string;
  requiredRole: Role | null; // null = anonymous/public
}

export const PERSONAS: Record<PersonaId, Persona> = {
  public:     { id: 'public',     label: 'Public',       requiredRole: null },
  governance: { id: 'governance', label: 'Governance',   requiredRole: 'viewer' },
  research:   { id: 'research',   label: 'Research',     requiredRole: 'viewer' },
  steward:    { id: 'steward',    label: 'Data Steward', requiredRole: 'editor' },
  admin:      { id: 'admin',      label: 'Management',   requiredRole: 'admin' },
};

// Which personas a role may inhabit. admin is a superset (steward + admin).
export function rolePersonas(role: Role | null | undefined): PersonaId[] {
  if (role === 'admin') return ['steward', 'admin'];
  if (role === 'editor') return ['steward'];
  if (role === 'viewer') return ['governance', 'research'];
  return ['public'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- persona.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/entities/persona/persona.ts apps/web/src/entities/persona/persona.test.ts
git commit -m "feat(web): persona model (PERSONAS registry + rolePersonas)"
```

---

### Task 2: Persona hook — `entities/persona/usePersona.ts`

Resolves the active persona from session role + a localStorage pick, defensively.

**Files:**
- Create: `apps/web/src/entities/persona/usePersona.ts`
- Test: `apps/web/src/entities/persona/usePersona.test.ts`

**Interfaces:**
- Consumes: `useSession` from `entities/session/model/session.store`; `rolePersonas`, `PersonaId` from `./persona`.
- Produces: `usePersona()` returning `{ available: PersonaId[]; active: PersonaId; setActive: (id: PersonaId) => void }`; exported const `PERSONA_STORAGE_KEY = 'webatlas.persona'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/entities/persona/usePersona.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockRole: string | null = null;
vi.mock('../session/model/session.store', () => ({
  useSession: () => ({ currentUser: mockRole ? { id: '1', email: 'a@b.test', full_name: 'A', role: mockRole } : null }),
}));

import { usePersona, PERSONA_STORAGE_KEY } from './usePersona';

beforeEach(() => { localStorage.clear(); mockRole = null; });

describe('usePersona', () => {
  it('anonymous resolves to public with no rail personas beyond public', () => {
    mockRole = null;
    const { result } = renderHook(() => usePersona());
    expect(result.current.available).toEqual(['public']);
    expect(result.current.active).toBe('public');
  });

  it('viewer defaults to the first available persona (governance)', () => {
    mockRole = 'viewer';
    const { result } = renderHook(() => usePersona());
    expect(result.current.available).toEqual(['governance', 'research']);
    expect(result.current.active).toBe('governance');
  });

  it('viewer restores a valid stored pick (research)', () => {
    mockRole = 'viewer';
    localStorage.setItem(PERSONA_STORAGE_KEY, 'research');
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('research');
  });

  it('setActive persists a valid pick', () => {
    mockRole = 'viewer';
    const { result } = renderHook(() => usePersona());
    act(() => result.current.setActive('research'));
    expect(result.current.active).toBe('research');
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).toBe('research');
  });

  it('ignores a stored pick that is invalid for the role (falls back to first available)', () => {
    mockRole = 'editor'; // only steward
    localStorage.setItem(PERSONA_STORAGE_KEY, 'governance'); // not allowed for editor
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('steward');
  });

  it('setActive rejects an id not available to the role', () => {
    mockRole = 'editor';
    const { result } = renderHook(() => usePersona());
    act(() => result.current.setActive('admin')); // not allowed
    expect(result.current.active).toBe('steward'); // unchanged
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).not.toBe('admin');
  });

  it('malformed localStorage does not throw and falls back', () => {
    mockRole = 'viewer';
    localStorage.setItem(PERSONA_STORAGE_KEY, '{not valid persona}');
    const { result } = renderHook(() => usePersona());
    expect(result.current.active).toBe('governance');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- usePersona`
Expected: FAIL — cannot resolve `./usePersona`.

- [ ] **Step 3: Implement `usePersona.ts`**

Create `apps/web/src/entities/persona/usePersona.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { useSession } from '../session/model/session.store';
import { rolePersonas, type PersonaId } from './persona';

export const PERSONA_STORAGE_KEY = 'webatlas.persona';

function readStoredPick(): PersonaId | null {
  try {
    const raw = localStorage.getItem(PERSONA_STORAGE_KEY);
    return (raw as PersonaId | null) ?? null;
  } catch {
    return null;
  }
}

export function usePersona(): { available: PersonaId[]; active: PersonaId; setActive: (id: PersonaId) => void } {
  const { currentUser } = useSession();
  const available = useMemo(() => rolePersonas(currentUser?.role), [currentUser?.role]);

  // Version counter to re-derive active after a setActive write.
  const [tick, setTick] = useState(0);

  const active = useMemo(() => {
    const stored = readStoredPick();
    if (stored && available.includes(stored)) return stored;
    return available[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, tick]);

  const setActive = useCallback((id: PersonaId) => {
    if (!available.includes(id)) return; // reject out-of-role picks
    try { localStorage.setItem(PERSONA_STORAGE_KEY, id); } catch { /* ignore */ }
    setTick((t) => t + 1);
  }, [available]);

  return { available, active, setActive };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- usePersona`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/entities/persona/usePersona.ts apps/web/src/entities/persona/usePersona.test.ts
git commit -m "feat(web): usePersona hook (role -> available; localStorage pick, defensive)"
```

---

### Task 3: Shell presenter — `features/shell/model/useShellPresenter.ts`

Derives the shell view-model (workspaces, active, open/close) from `usePersona`.

**Files:**
- Create: `apps/web/src/features/shell/model/useShellPresenter.ts`
- Test: `apps/web/src/features/shell/model/useShellPresenter.test.ts`

**Interfaces:**
- Consumes: `usePersona`, `PersonaId`, `PERSONAS` from `entities/persona`.
- Produces: `useShellPresenter()` returning `{ workspaces: { id: PersonaId; label: string }[]; activeId: PersonaId; isOpen: boolean; select: (id: PersonaId) => void; close: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/shell/model/useShellPresenter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let available: string[] = ['public'];
let active = 'public';
const setActive = vi.fn((id: string) => { active = id; });
vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available, active, setActive }),
}));

import { useShellPresenter } from './useShellPresenter';

beforeEach(() => { available = ['public']; active = 'public'; setActive.mockClear(); });

describe('useShellPresenter', () => {
  it('anonymous/public yields no workspaces', () => {
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces).toEqual([]);
  });

  it('viewer yields governance + research workspaces with labels', () => {
    available = ['governance', 'research']; active = 'governance';
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['governance', 'research']);
    expect(result.current.workspaces[0].label).toBe('Governance');
  });

  it('admin workspaces exclude public and include steward + admin', () => {
    available = ['steward', 'admin']; active = 'steward';
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['steward', 'admin']);
  });

  it('select sets the persona and opens the panel', () => {
    available = ['governance', 'research']; active = 'governance';
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.select('research'));
    expect(setActive).toHaveBeenCalledWith('research');
    expect(result.current.isOpen).toBe(true);
  });

  it('close collapses the panel', () => {
    available = ['steward']; active = 'steward';
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useShellPresenter`
Expected: FAIL — cannot resolve `./useShellPresenter`.

- [ ] **Step 3: Implement `useShellPresenter.ts`**

Create `apps/web/src/features/shell/model/useShellPresenter.ts`:

```ts
import { useMemo, useState } from 'react';
import { usePersona } from '../../../entities/persona/usePersona';
import { PERSONAS, type PersonaId } from '../../../entities/persona/persona';

export interface Workspace { id: PersonaId; label: string; }

export function useShellPresenter(): {
  workspaces: Workspace[];
  activeId: PersonaId;
  isOpen: boolean;
  select: (id: PersonaId) => void;
  close: () => void;
} {
  const { available, active, setActive } = usePersona();

  const workspaces = useMemo(
    () => available.filter((id) => id !== 'public').map((id) => ({ id, label: PERSONAS[id].label })),
    [available]
  );

  // Panel starts open when there is a non-public workspace to show.
  const [isOpen, setIsOpen] = useState(true);

  const select = (id: PersonaId) => { setActive(id); setIsOpen(true); };
  const close = () => setIsOpen(false);

  return { workspaces, activeId: active, isOpen, select, close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- useShellPresenter`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/shell/model/
git commit -m "feat(web): useShellPresenter (workspaces from persona, open/close state)"
```

---

### Task 4: Shell views — `PersonaRail`, `WorkspacePanel`, `WorkspacePlaceholder`

Passive, props-only.

**Files:**
- Create: `apps/web/src/features/shell/ui/PersonaRail.view.tsx`
- Create: `apps/web/src/features/shell/ui/WorkspacePanel.view.tsx`
- Create: `apps/web/src/features/shell/ui/WorkspacePlaceholder.tsx`
- Test: `apps/web/src/features/shell/ui/PersonaRail.view.test.tsx`
- Test: `apps/web/src/features/shell/ui/WorkspacePanel.view.test.tsx`

**Interfaces:**
- Consumes: `PersonaId` from `entities/persona/persona`; `Workspace` from `../model/useShellPresenter`.
- Produces: `PersonaRailView` (props `{ workspaces, activeId, onSelect }`); `WorkspacePanelView` (props `{ open, title, onClose, children }`); `WorkspacePlaceholder` (props `{ persona }`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/shell/ui/PersonaRail.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonaRailView } from './PersonaRail.view';

const workspaces = [
  { id: 'governance' as const, label: 'Governance' },
  { id: 'research' as const, label: 'Research' },
];

describe('PersonaRailView', () => {
  it('renders a button per workspace and marks the active one', () => {
    render(<PersonaRailView workspaces={workspaces} activeId="research" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /governance/i })).toBeInTheDocument();
    const active = screen.getByRole('button', { name: /research/i });
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect with the workspace id', async () => {
    const onSelect = vi.fn();
    render(<PersonaRailView workspaces={workspaces} activeId="governance" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /research/i }));
    expect(onSelect).toHaveBeenCalledWith('research');
  });

  it('renders nothing when there are no workspaces (anonymous)', () => {
    const { container } = render(<PersonaRailView workspaces={[]} activeId="public" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Create `apps/web/src/features/shell/ui/WorkspacePanel.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspacePanelView } from './WorkspacePanel.view';

describe('WorkspacePanelView', () => {
  it('renders title + children when open', () => {
    render(<WorkspacePanelView open title="Data Steward" onClose={vi.fn()}><div>panel body</div></WorkspacePanelView>);
    expect(screen.getByText('Data Steward')).toBeInTheDocument();
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<WorkspacePanelView open={false} title="X" onClose={vi.fn()}><div>hidden</div></WorkspacePanelView>);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<WorkspacePanelView open title="X" onClose={onClose}><div>b</div></WorkspacePanelView>);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @webatlas/web -- PersonaRail.view WorkspacePanel.view`
Expected: FAIL — cannot resolve the view modules.

- [ ] **Step 3: Implement `PersonaRail.view.tsx`**

Create `apps/web/src/features/shell/ui/PersonaRail.view.tsx`:

```tsx
import type { PersonaId } from '../../../entities/persona/persona';
import type { Workspace } from '../model/useShellPresenter';

export function PersonaRailView({ workspaces, activeId, onSelect }: {
  workspaces: Workspace[];
  activeId: PersonaId;
  onSelect: (id: PersonaId) => void;
}) {
  if (workspaces.length === 0) return null;
  return (
    <nav className="persona-rail glass-panel" aria-label="Workspaces">
      {workspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          className={`persona-rail-item ${w.id === activeId ? 'active' : ''}`}
          aria-current={w.id === activeId ? 'true' : undefined}
          onClick={() => onSelect(w.id)}
        >
          {w.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Implement `WorkspacePanel.view.tsx`**

Create `apps/web/src/features/shell/ui/WorkspacePanel.view.tsx`:

```tsx
import type { ReactNode } from 'react';

export function WorkspacePanelView({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="workspace-panel glass-panel" aria-label={title}>
      <header className="workspace-panel-header">
        <h2>{title}</h2>
        <button type="button" className="workspace-panel-close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="workspace-panel-body">{children}</div>
    </aside>
  );
}
```

- [ ] **Step 5: Implement `WorkspacePlaceholder.tsx`**

Create `apps/web/src/features/shell/ui/WorkspacePlaceholder.tsx`:

```tsx
import type { PersonaId } from '../../../entities/persona/persona';

const COPY: Partial<Record<PersonaId, { heading: string; body: string }>> = {
  governance: { heading: 'Governance workspace', body: 'Oversight, filtering, comparison and reporting tools are coming soon.' },
  research: { heading: 'Research workspace', body: 'Attribute query, analysis, export and saved views are coming soon.' },
};

export function WorkspacePlaceholder({ persona }: { persona: PersonaId }) {
  const copy = COPY[persona] ?? { heading: 'Workspace', body: 'Coming soon.' };
  return (
    <div className="workspace-placeholder">
      <p className="workspace-placeholder-heading">{copy.heading}</p>
      <p className="workspace-placeholder-body">{copy.body}</p>
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- PersonaRail.view WorkspacePanel.view`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/shell/ui/
git commit -m "feat(web): shell views (PersonaRail, WorkspacePanel, WorkspacePlaceholder)"
```

---

### Task 5: Shell container + App.tsx wiring

Wire presenter + views, map active persona to content, and render `<Shell />` in App.tsx (removing the loose overlays).

**Files:**
- Create: `apps/web/src/features/shell/index.tsx`
- Test: `apps/web/src/features/shell/index.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/main.css` (add persona-rail / workspace-panel styles)

**Interfaces:**
- Consumes: `useShellPresenter` (Task 3); `PersonaRailView`/`WorkspacePanelView`/`WorkspacePlaceholder` (Task 4); `PERSONAS` from persona; `FeatureEditing` (`../feature-editing`, no props); `UserManagement` (`../user-management`, `{ open, onClose }`).
- Produces: default export `Shell`, rendered by `App.tsx`.

- [ ] **Step 1: Write the failing container test**

Create `apps/web/src/features/shell/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let workspaces: { id: string; label: string }[] = [];
let activeId = 'public';
vi.mock('./model/useShellPresenter', () => ({
  useShellPresenter: () => ({ workspaces, activeId, isOpen: true, select: vi.fn(), close: vi.fn() }),
}));
// Stub the hosted features so we assert ROUTING, not their internals.
vi.mock('../feature-editing', () => ({ default: () => <div>FEATURE_EDITING</div> }));
vi.mock('../user-management', () => ({ default: () => <div>USER_MANAGEMENT</div> }));

import Shell from './index';

beforeEach(() => { workspaces = []; activeId = 'public'; });

describe('Shell container', () => {
  it('anonymous/public renders no rail and no panel content', () => {
    const { container } = render(<Shell />);
    expect(container.textContent).not.toContain('FEATURE_EDITING');
    expect(container.textContent).not.toContain('USER_MANAGEMENT');
  });

  it('steward workspace hosts FeatureEditing', () => {
    workspaces = [{ id: 'steward', label: 'Data Steward' }]; activeId = 'steward';
    render(<Shell />);
    expect(screen.getByText('FEATURE_EDITING')).toBeInTheDocument();
  });

  it('admin workspace hosts UserManagement', () => {
    workspaces = [{ id: 'steward', label: 'Data Steward' }, { id: 'admin', label: 'Management' }]; activeId = 'admin';
    render(<Shell />);
    expect(screen.getByText('USER_MANAGEMENT')).toBeInTheDocument();
  });

  it('governance workspace hosts the placeholder', () => {
    workspaces = [{ id: 'governance', label: 'Governance' }, { id: 'research', label: 'Research' }]; activeId = 'governance';
    render(<Shell />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- shell/index`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement `index.tsx`**

Create `apps/web/src/features/shell/index.tsx`:

```tsx
import { useShellPresenter } from './model/useShellPresenter';
import { PERSONAS, type PersonaId } from '../../entities/persona/persona';
import { PersonaRailView } from './ui/PersonaRail.view';
import { WorkspacePanelView } from './ui/WorkspacePanel.view';
import { WorkspacePlaceholder } from './ui/WorkspacePlaceholder';
import FeatureEditing from '../feature-editing';
import UserManagement from '../user-management';

// Persona routing is UX only. Real authorization is enforced by the backend
// and by each hosted feature's own RequireRole gate; the shell only reveals
// which workspace's tools to show — it is never the access-control decision.
function WorkspaceContent({ activeId, onClose, open }: { activeId: PersonaId; onClose: () => void; open: boolean }) {
  if (activeId === 'steward') return <FeatureEditing />;
  if (activeId === 'admin') return <UserManagement open={open} onClose={onClose} />;
  if (activeId === 'governance' || activeId === 'research') return <WorkspacePlaceholder persona={activeId} />;
  return null;
}

export default function Shell() {
  const s = useShellPresenter();
  const hasWorkspace = s.workspaces.length > 0 && s.activeId !== 'public';
  return (
    <>
      <PersonaRailView workspaces={s.workspaces} activeId={s.activeId} onSelect={s.select} />
      <WorkspacePanelView open={s.isOpen && hasWorkspace} title={PERSONAS[s.activeId].label} onClose={s.close}>
        <WorkspaceContent activeId={s.activeId} onClose={s.close} open={s.isOpen && hasWorkspace} />
      </WorkspacePanelView>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- shell/index`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `<Shell />` into `App.tsx`**

In `apps/web/src/app/App.tsx`:

Remove these imports (lines 4-6):
```tsx
import FeatureEditing from '../features/feature-editing';
import UserManagement from '../features/user-management';
import { RequireRole } from '../features/auth/ui/RequireRole';
```
Add instead:
```tsx
import Shell from '../features/shell';
```

Remove the `usersOpen` state (line 20): `const [usersOpen, setUsersOpen] = useState(false);`

Replace the `auth-widget-slot` block AND the loose `<UserManagement .../>` (current lines 29-39):
```tsx
        {/* Auth entry: login button or user badge */}
        <div className="auth-widget-slot">
          <AuthWidget />
          <FeatureEditing />
          <RequireRole role="admin">
            <button type="button" className="manage-users-btn glass-panel" onClick={() => setUsersOpen(true)}>
              Manage users
            </button>
          </RequireRole>
        </div>

        <UserManagement open={usersOpen} onClose={() => setUsersOpen(false)} />
```
with:
```tsx
        {/* Auth entry: login button or user badge */}
        <div className="auth-widget-slot">
          <AuthWidget />
        </div>

        <Shell />
```

(Result: `AuthWidget` stays top-right; `<Shell />` owns the rail + workspace panel that host editing/management.)

- [ ] **Step 6: Add styles to `main.css`**

Append to `apps/web/src/styles/main.css` (reusing `glass-panel`; adjust offsets to sit clear of existing overlays — the `.panels-wrapper` is left, `.auth-widget-slot` is top-right, so anchor the rail on the LEFT edge below the panels or on the right; pick the left-center to match "left rail" intent):

```css
/* Adaptive shell (roadmap 2.2) */
.persona-rail {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  z-index: 1000; display: flex; flex-direction: column; gap: 6px; padding: 6px;
}
.persona-rail-item {
  padding: 8px 12px; border: none; background: transparent; cursor: pointer;
  border-radius: 8px; font: inherit; text-align: left; white-space: nowrap;
}
.persona-rail-item.active { background: rgba(56, 189, 248, 0.18); font-weight: 600; }
.workspace-panel {
  position: absolute; left: 12px; bottom: 12px; top: 96px; width: 340px; max-width: 90vw;
  z-index: 1001; display: flex; flex-direction: column; overflow: hidden;
}
.workspace-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; }
.workspace-panel-close { border: none; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; }
.workspace-panel-body { overflow: auto; padding: 0 12px 12px; }
.workspace-placeholder { padding: 24px 8px; text-align: center; opacity: 0.8; }
.workspace-placeholder-heading { font-weight: 600; margin-bottom: 6px; }
```

- [ ] **Step 7: Run full suite + build + lint**

Run: `npm test -w @webatlas/web`
Expected: PASS — all web tests incl. the new shell/persona tests.

Run: `npm run build -w @webatlas/web`
Expected: `tsc -b` + vite build succeed (no dangling imports from the App.tsx edit).

Run: `npm run lint -w @webatlas/web`
Expected: no new lint errors (remove any now-unused import flagged).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/shell/index.tsx apps/web/src/features/shell/index.test.tsx apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): shell container + App.tsx wiring (persona rail hosts edit/management)"
```

---

### Task 6: Manual verification (/run)

Confirm the framework in the real app. Not a code task — evidence per design §7.

**Files:** none.

- [x] **Step 1: Bring the stack up + start web**

Start Postgres + API + web (`docker compose -f infra/docker-compose.yml up -d db`; `npm run dev -w @webatlas/api`; `npm run dev -w @webatlas/web`). Ensure users exist for each role (admin via `create-admin`; seed an editor + viewer via SQL/one-off if needed).

- [x] **Step 2: Per-role walkthrough**

- **Logged out:** lean map, **no persona rail**, base panels (layer tree/search/legend) present.
- **Editor:** rail shows **Data Steward**; selecting it opens the edit panel (draw/modify/delete works as before).
- **Admin:** rail shows **Data Steward + Management**; Management opens the user table (create/edit/deactivate works).
- **Viewer:** rail shows **Governance + Research**; each opens its "coming soon" placeholder; switch between them; the pick **persists across a page reload**; the invalid pick for another role is discarded on role change.

- [x] **Step 3: Confirm map interactivity**

With a workspace panel open, confirm the map still pans/zooms and the popup still works (panel is an overlay, not a modal blocker).

- [x] **Step 4: Record the result**

**Verified 2026-07-17** (Playwright/headless Chromium against the live stack; temp users `run-t6-{admin,editor,viewer}@webatlas.test` created via the admin API and deleted afterwards — DB back to its two pre-existing admins).

**Behaviour — all logic assertions PASS:**

| Check | Result |
|---|---|
| Logged out → no rail, lean map, base panels present | ✅ `railPresent: false`, LayerTree/search/legend intact |
| Editor → rail shows Data Steward only; hosts the edit panel | ✅ layer picker + Draw/Edit existing render |
| Admin → rail shows Data Steward + Management | ✅ both entries; Management hosts the real user table (5 rows) |
| Viewer → Governance + Research placeholders | ✅ both "coming soon" placeholders render |
| Viewer pick persists across reload | ✅ `webatlas.persona: 'research'` survives reload, rail stays on Research |
| Stale out-of-role pick discarded on role change | ✅ stored `'research'` + editor role → falls back to Data Steward, no throw |
| Map pans/zooms with a panel open (overlay, not modal) | ✅ pan + wheel-zoom both work |
| Console errors | ✅ none |

**🔴 BLOCKER — `.workspace-panel` covers `.persona-rail`; the rail is unclickable.**

The Self-Review called this out as "cosmetic, not a test blocker." It is **not cosmetic** — it is a functional dead-end. Measured at 1440×900:

- `.persona-rail` → x:12–153, y:404–496, `z-index: 1000`
- `.workspace-panel` → x:12–352, y:96–888, `z-index: 1001`

The panel **fully encloses the rail at a higher z-index**. `document.elementFromPoint()` at each rail button's centre returns `aside.workspace-panel` — `clickable: false` for **every rail item in every role**. Because `isOpen` defaults to `true`, a user lands with the panel already open and can never reach the rail:

- **Admin can never switch to Management** — the panel that Data Steward opened swallows the button. Playwright timed out 30s trying to click it (only reachable after clicking ×).
- The panel also overlaps the existing `.panels-wrapper` (LayerTree header clipped; basemap switcher buried).

**Fix options** (design decision, deferred to the plan author):
1. Move the rail outside the panel's box — e.g. rail on the left edge, panel offset to `left: 165px`.
2. Reserve a rail gutter — panel `left: 165px`, keep the rail at `left: 12px`.
3. Anchor the panel on the right (`right: 12px`), leaving the whole left edge to the rail + existing panels.

Option 2/3 also resolve the `.panels-wrapper` overlap. Whichever is picked needs a regression test asserting rail hit-testability while `isOpen` — a DOM-presence test cannot catch this, which is why the unit suite is green while the feature is unusable.

**🟡 Secondary — duplicated panel chrome in the admin workspace.** `UserManagement` renders its own "Close" button + "Users" heading *inside* the shell panel, which already supplies a "Management" title and an ×. Two close affordances stacked; the table is also cramped/unstyled at 340px. Worth folding into the fix.

---

## Self-Review

**1. Spec coverage (design §1–§10):**
- §2 persona model (5 personas / role mapping) → Task 1 ✓
- §4.2 usePersona (localStorage pick, defensive, invalid-pick fallback) → Task 2 ✓
- §4.3 useShellPresenter (workspaces minus public, active/open) → Task 3 ✓
- §4.4 views (rail hidden for anon, panel, placeholder copy) → Task 4 ✓
- §4.5 container routing (steward→FeatureEditing, admin→UserManagement, gov/research→placeholder) + comment → Task 5 ✓
- §4.6 App.tsx re-homing (remove loose overlays, render Shell) → Task 5 Step 5 ✓
- §3/§8 conventions (UX-only, no apiRequest/ol, defensive localStorage) → Global Constraints + comment ✓
- §7 testing (all units + /run) → Tasks 1-6 ✓
- §9 YAGNI (no gov/research content, no persona DB field, no router) → honored ✓

**2. Placeholder scan:** none — every component has full code; every step exact command + expected output.

**3. Type/name consistency:** `PersonaId`/`PERSONAS`/`rolePersonas` (Task 1) → consumed Tasks 2,3,5. `usePersona` returns `{available,active,setActive}` (Task 2) → consumed Task 3. `useShellPresenter` returns `{workspaces,activeId,isOpen,select,close}` (Task 3) → consumed Task 5; `Workspace` type consumed by `PersonaRailView` (Task 4). View prop names (`workspaces/activeId/onSelect`; `open/title/onClose/children`; `persona`) consistent Task 4 ↔ Task 5. `UserManagement({open,onClose})` + `FeatureEditing()` (verified) consumed Task 5.

**4. Risks for the implementer:**
- **`usePersona` re-derivation:** `active` is derived from localStorage + `available`; `setActive` bumps a `tick` to force re-read. Simple and test-covered; do not "optimize" into a stale closure.
- **App.tsx import cleanup:** removing `FeatureEditing`/`UserManagement`/`RequireRole` imports — the lint step (Task 5 Step 7) catches any left dangling. `useState` is still used (`panelsVisible`), keep it.
- **Panel positioning:** the `.workspace-panel` sits left; the existing `.panels-wrapper` (LayerTree etc.) is also left — verify in `/run` they don't overlap badly; the CSS anchors the panel lower (`top: 96px`) but adjust offsets if `/run` shows collision. Cosmetic, not a test blocker.
- **UserManagement inside the shell:** it already self-gates with `RequireRole('admin')` and returns null when `!open`; the container passes `open` = panel-open-and-admin-active, so it renders only in the admin workspace. No double-gate conflict.
- **`isOpen` default true:** a freshly-logged-in user with a workspace sees the panel open. If `/run` prefers collapsed-by-default, flip the initial `useState(true)`→`false` — behavioral choice, not a correctness issue.
