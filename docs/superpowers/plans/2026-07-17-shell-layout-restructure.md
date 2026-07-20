# Shell Layout Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the app by purpose — left burger drawer for editing tools, right stacked panel for display controls (layers + basemap + legend), top bar for identity — and move user management to a real `/admin/users` route over an always-mounted map.

**Architecture:** Add `react-router-dom` inside `AppProviders` (below `MapProvider`, so map context survives navigation). `MapView` renders as a **sibling of `<Routes>`**, never inside one — `/admin/users` overlays a live map. The persona rail and workspace panel are deleted; `features/shell` becomes a role-gated burger drawer hosting `FeatureEditing`. `entities/persona` survives as a model with no switcher UI.

**Tech Stack:** React 19 + TypeScript, `react-router-dom` (new), Vitest + Testing Library (`renderHook`, `render`, `@testing-library/user-event`), jsdom, oxlint. No backend/schema change.

**Design doc:** `docs/superpowers/specs/2026-07-17-shell-layout-restructure-design.md`

## Global Constraints

- **Backend stays the authorization boundary** (design §7). Every gate here is UX-only. `RequireRole` on `/admin/users` is a reveal, not a protection — the API enforces admin on every `/api/users` route. Keep the existing "UX gate ONLY" comments intact when moving code.
- **jsdom cannot prove reachability** (design §8). jsdom has no layout engine: `getBoundingClientRect()` returns zeros and `elementFromPoint` is meaningless. **Never assert overlap/clickability in a unit test** — that is exactly how the original blocker shipped green. Reachability is asserted in Task 8 (`/run`) only.
- **Presenter returns a view-model + handlers** (no JSX, no fetch); `*.view.tsx` are props-only (adaptive-shell §8 rule 1).
- **No `apiRequest` / no `ol/*`** in `features/shell` or `widgets/top-bar`.
- **`rolePersonas` is UNCHANGED** — admin still returns `['steward','admin']`. Do not edit `entities/persona/persona.ts` or its tests. The `admin` persona simply maps to no drawer (design §4.2).
- **Reuse `glass-panel`** + absolute positioning; no new styling system.
- **Existing signatures (verified):** `FeatureEditing()` (no props); `useSession()` → `{ status, currentUser: CurrentUser | null, logout, ... }`; `CurrentUser = { id, email, full_name: string | null, role: Role }`; `Role = 'admin'|'editor'|'viewer'`; `UserBadgeView({ email, onLogout })`; `RequireRole({ role, fallback?, children })`; `useMapContext()` → `{ basemap, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity }`.
- **Commands:** Test `npm test -w @webatlas/web`. Build `npm run build -w @webatlas/web`. Lint `npm run lint -w @webatlas/web`.
- **Test env:** vitest `globals: true`, jsdom, `src/test/setup.ts` already runs `cleanup()` + `localStorage.clear()` after each test. Mock `useSession` via `vi.mock`.

---

### Task 1: Install router + wire `BrowserRouter` (map stays mounted)

Adds the dependency and the router shell. No behaviour change yet — `/` renders exactly what it renders today.

**Files:**
- Modify: `apps/web/package.json` (add `react-router-dom`)
- Modify: `apps/web/src/app/App.tsx`
- Test: `apps/web/src/app/App.routing.test.tsx`

**Interfaces:**
- Consumes: `AppProviders` (unchanged).
- Produces: a `BrowserRouter` inside `AppProviders`, with `MapView` as a sibling of `<Routes>`. Later tasks add routes.

- [ ] **Step 1: Install the dependency**

Run: `npm install react-router-dom@^7 -w @webatlas/web`
Expected: adds `react-router-dom` to `apps/web/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/app/App.routing.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the heavy map + children so this test is about ROUTING only.
vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/LayerTree', () => ({ default: () => <div>LAYER_TREE</div> }));
vi.mock('../components/BasemapSwitcher', () => ({ default: () => <div>BASEMAP</div> }));
vi.mock('../components/DynamicLegend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../components/OGCClient', () => ({ default: () => <div>OGC</div> }));
vi.mock('../components/MapControls', () => ({ default: () => <div>CONTROLS</div> }));
vi.mock('../components/SearchBar', () => ({ default: () => <div>SEARCH</div> }));
vi.mock('../features/auth', () => ({ default: () => <div>AUTH_WIDGET</div> }));
vi.mock('../features/shell', () => ({ default: () => <div>SHELL</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });

  it('keeps the map mounted on a non-root route (map is a sibling of Routes)', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    // The map must NOT unmount just because the URL changed.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- App.routing`
Expected: FAIL — the second test throws because `App` has no router (or the map is not preserved).

- [ ] **Step 4: Wire `BrowserRouter` into `App.tsx`**

Replace the whole of `apps/web/src/app/App.tsx` with:

```tsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import AuthWidget from '../features/auth';
import Shell from '../features/shell';
import MapView from '../features/map/ui/MapView';
import BasemapSwitcher from '../components/BasemapSwitcher';
import LayerTree from '../components/LayerTree';
import MapControls from '../components/MapControls';
import SearchBar from '../components/SearchBar';
import DynamicPopup from '../components/DynamicPopup';
import DynamicLegend from '../components/DynamicLegend';
import OGCClient from '../components/OGCClient';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import '../styles/main.css';

function App() {
  const [panelsVisible, setPanelsVisible] = useState(true);

  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users must overlay a live map, not unmount it. */}
          <MapView />
          <MapControls />

          <div className="auth-widget-slot">
            <AuthWidget />
          </div>

          <Shell />

          <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
            <LayerTree />
            <BasemapSwitcher />
            <SearchBar />
            <DynamicLegend />
            <OGCClient />
          </div>

          <DynamicPopup />

          <button
            className="toggle-panels-btn glass-panel"
            onClick={() => setPanelsVisible(!panelsVisible)}
            title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
          >
            {panelsVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
          </button>

          <Routes>
            <Route path="/" element={null} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- App.routing`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/app/App.tsx apps/web/src/app/App.routing.test.tsx package-lock.json
git commit -m "feat(web): add react-router; map renders as a sibling of Routes"
```

---

### Task 2: `useShellPresenter` → drawer state

Reduce the presenter from persona-rail state to burger-drawer state.

**Files:**
- Modify: `apps/web/src/features/shell/model/useShellPresenter.ts` (full rewrite)
- Modify: `apps/web/src/features/shell/model/useShellPresenter.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `usePersona` from `entities/persona/usePersona` (returns `{ available, active, setActive }` — unchanged).
- Produces: `useShellPresenter()` → `{ hasDrawer: boolean; isOpen: boolean; toggle: () => void; close: () => void }`. The `Workspace` type is **deleted**.

- [ ] **Step 1: Write the failing test**

Replace all of `apps/web/src/features/shell/model/useShellPresenter.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let available: string[] = ['public'];
vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available, active: available[0], setActive: vi.fn() }),
}));

import { useShellPresenter } from './useShellPresenter';

beforeEach(() => { available = ['public']; });

describe('useShellPresenter', () => {
  it('anonymous has no drawer', () => {
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.hasDrawer).toBe(false);
  });

  it('viewer has no drawer (governance/research have no tools yet)', () => {
    available = ['governance', 'research'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.hasDrawer).toBe(false);
  });

  it('editor has a drawer', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.hasDrawer).toBe(true);
  });

  it('admin has a drawer (steward is in its persona set)', () => {
    available = ['steward', 'admin'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.hasDrawer).toBe(true);
  });

  it('starts CLOSED (a drawer must never ambush the user on load)', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    expect(result.current.isOpen).toBe(false);
  });

  it('toggle opens then closes', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it('close collapses an open drawer', () => {
    available = ['steward'];
    const { result } = renderHook(() => useShellPresenter());
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useShellPresenter`
Expected: FAIL — `hasDrawer` is undefined (the presenter still returns `workspaces`/`activeId`/`select`).

- [ ] **Step 3: Rewrite the presenter**

Replace all of `apps/web/src/features/shell/model/useShellPresenter.ts` with:

```ts
import { useCallback, useState } from 'react';
import { usePersona } from '../../../entities/persona/usePersona';

// Persona is UX routing only. The drawer reveals tools per role; the backend
// enforces authorization on every write regardless of what is shown.
export function useShellPresenter(): {
  hasDrawer: boolean;
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
} {
  const { available } = usePersona();

  // Only the steward persona has real tools today. Governance/Research have
  // none yet (design §5), so viewers get no drawer at all.
  const hasDrawer = available.includes('steward');

  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { hasDrawer, isOpen, toggle, close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- useShellPresenter`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/shell/model/
git commit -m "feat(web): useShellPresenter -> burger drawer state (closed by default)"
```

---

### Task 3: `EditDrawer` view + shell container rewrite

Replace the rail/panel views with one left drawer hosting `FeatureEditing`.

**Files:**
- Create: `apps/web/src/features/shell/ui/EditDrawer.view.tsx`
- Create: `apps/web/src/features/shell/ui/EditDrawer.view.test.tsx`
- Modify: `apps/web/src/features/shell/index.tsx` (full rewrite)
- Modify: `apps/web/src/features/shell/index.test.tsx` (full rewrite)
- Delete: `apps/web/src/features/shell/ui/PersonaRail.view.tsx`
- Delete: `apps/web/src/features/shell/ui/PersonaRail.view.test.tsx`
- Delete: `apps/web/src/features/shell/ui/WorkspacePanel.view.tsx`
- Delete: `apps/web/src/features/shell/ui/WorkspacePanel.view.test.tsx`
- Delete: `apps/web/src/features/shell/ui/WorkspacePlaceholder.tsx`

**Interfaces:**
- Consumes: `useShellPresenter()` → `{ hasDrawer, isOpen, toggle, close }` (Task 2); `FeatureEditing` from `../feature-editing` (default export, no props).
- Produces: `EditDrawerView({ open, onClose, children })`; default export `Shell` rendering the burger + drawer.

- [ ] **Step 1: Write the failing view test**

Create `apps/web/src/features/shell/ui/EditDrawer.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditDrawerView } from './EditDrawer.view';

describe('EditDrawerView', () => {
  it('renders children when open', () => {
    render(<EditDrawerView open onClose={vi.fn()}><div>drawer body</div></EditDrawerView>);
    expect(screen.getByText('drawer body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <EditDrawerView open={false} onClose={vi.fn()}><div>hidden</div></EditDrawerView>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<EditDrawerView open onClose={onClose}><div>b</div></EditDrawerView>);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- EditDrawer.view`
Expected: FAIL — cannot resolve `./EditDrawer.view`.

- [ ] **Step 3: Implement `EditDrawer.view.tsx`**

Create `apps/web/src/features/shell/ui/EditDrawer.view.tsx`:

```tsx
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function EditDrawerView({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="edit-drawer glass-panel" aria-label="Công cụ biên tập">
      <header className="edit-drawer-header">
        <h2>Biên tập dữ liệu</h2>
        <button type="button" className="edit-drawer-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div className="edit-drawer-body">{children}</div>
    </aside>
  );
}
```

- [ ] **Step 4: Run view test to verify it passes**

Run: `npm test -w @webatlas/web -- EditDrawer.view`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing container test**

Replace all of `apps/web/src/features/shell/index.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let hasDrawer = false;
let isOpen = false;
const toggle = vi.fn(() => { isOpen = !isOpen; });
const close = vi.fn(() => { isOpen = false; });
vi.mock('./model/useShellPresenter', () => ({
  useShellPresenter: () => ({ hasDrawer, isOpen, toggle, close }),
}));
// Stub the hosted feature so we assert ROUTING, not its internals.
vi.mock('../feature-editing', () => ({ default: () => <div>FEATURE_EDITING</div> }));

import Shell from './index';

beforeEach(() => { hasDrawer = false; isOpen = false; toggle.mockClear(); close.mockClear(); });

describe('Shell', () => {
  it('renders no burger when the role has no drawer (viewer/anonymous)', () => {
    const { container } = render(<Shell />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the burger when the role has a drawer, closed by default', () => {
    hasDrawer = true;
    render(<Shell />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    expect(screen.queryByText('FEATURE_EDITING')).not.toBeInTheDocument();
  });

  it('clicking the burger toggles the drawer', async () => {
    hasDrawer = true;
    render(<Shell />);
    await userEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(toggle).toHaveBeenCalled();
  });

  it('hosts FeatureEditing when open', () => {
    hasDrawer = true; isOpen = true;
    render(<Shell />);
    expect(screen.getByText('FEATURE_EDITING')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run container test to verify it fails**

Run: `npm test -w @webatlas/web -- shell/index`
Expected: FAIL — `Shell` still renders `PersonaRailView`/`WorkspacePanelView` and has no burger.

- [ ] **Step 7: Rewrite the container**

Replace all of `apps/web/src/features/shell/index.tsx` with:

```tsx
import { Menu } from 'lucide-react';
import { useShellPresenter } from './model/useShellPresenter';
import { EditDrawerView } from './ui/EditDrawer.view';
import FeatureEditing from '../feature-editing';

// The drawer reveals editing tools per role. This is UX only — FeatureEditing
// keeps its own RequireRole gate and the backend enforces every write.
export default function Shell() {
  const s = useShellPresenter();
  if (!s.hasDrawer) return null;
  return (
    <>
      <button
        type="button"
        className="burger-btn glass-panel"
        onClick={s.toggle}
        aria-label="Menu"
        aria-expanded={s.isOpen}
      >
        <Menu size={18} />
      </button>
      <EditDrawerView open={s.isOpen} onClose={s.close}>
        <FeatureEditing />
      </EditDrawerView>
    </>
  );
}
```

- [ ] **Step 8: Delete the superseded rail/panel views**

```bash
git rm apps/web/src/features/shell/ui/PersonaRail.view.tsx \
       apps/web/src/features/shell/ui/PersonaRail.view.test.tsx \
       apps/web/src/features/shell/ui/WorkspacePanel.view.tsx \
       apps/web/src/features/shell/ui/WorkspacePanel.view.test.tsx \
       apps/web/src/features/shell/ui/WorkspacePlaceholder.tsx
```

- [ ] **Step 9: Run the shell suite to verify it passes**

Run: `npm test -w @webatlas/web -- shell`
Expected: PASS (7 tests: 3 EditDrawer + 4 Shell). No PersonaRail/WorkspacePanel suites remain.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/shell/
git commit -m "feat(web): shell -> burger + EditDrawer; delete persona rail/workspace panel"
```

---

### Task 4: Top bar + profile menu

Move auth into a top bar and add the admin entry to `/admin/users`.

**Files:**
- Create: `apps/web/src/widgets/top-bar/ui/TopBar.view.tsx`
- Create: `apps/web/src/widgets/top-bar/ui/TopBar.view.test.tsx`
- Create: `apps/web/src/widgets/top-bar/index.tsx`
- Create: `apps/web/src/widgets/top-bar/index.test.tsx`

**Interfaces:**
- Consumes: `useSession()` → `{ status, currentUser, logout }`; `AuthWidget` from `features/auth` (default export) for the anonymous login button + modal; `Link` from `react-router-dom`.
- Produces: `TopBarView({ email, role, onLogout })` (props-only); default export `TopBar`.

- [ ] **Step 1: Write the failing view test**

Create `apps/web/src/widgets/top-bar/ui/TopBar.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopBarView } from './TopBar.view';

const renderView = (role: 'admin' | 'editor' | 'viewer', onLogout = vi.fn()) =>
  render(
    <MemoryRouter>
      <TopBarView email="a@b.test" role={role} onLogout={onLogout} />
    </MemoryRouter>
  );

describe('TopBarView', () => {
  it('shows the user email', () => {
    renderView('editor');
    expect(screen.getByText('a@b.test')).toBeInTheDocument();
  });

  it('shows Manage users for an admin, linking to /admin/users', () => {
    renderView('admin');
    const link = screen.getByRole('link', { name: /manage users/i });
    expect(link).toHaveAttribute('href', '/admin/users');
  });

  it('hides Manage users from an editor', () => {
    renderView('editor');
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });

  it('hides Manage users from a viewer', () => {
    renderView('viewer');
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });

  it('calls onLogout when Log out is clicked', async () => {
    const onLogout = vi.fn();
    renderView('viewer', onLogout);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- TopBar.view`
Expected: FAIL — cannot resolve `./TopBar.view`.

- [ ] **Step 3: Implement `TopBar.view.tsx`**

Create `apps/web/src/widgets/top-bar/ui/TopBar.view.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { LogOut, Users } from 'lucide-react';
import type { Role } from '../../../entities/session/model/session.types';

export interface TopBarViewProps {
  email: string;
  role: Role;
  onLogout: () => void;
}

// Props-only. The admin entry is a UX reveal: the API enforces admin on every
// /api/users route regardless of whether this link is rendered.
export function TopBarView({ email, role, onLogout }: TopBarViewProps) {
  return (
    <div className="top-bar-profile">
      <span className="top-bar-email">{email}</span>
      {role === 'admin' && (
        <Link to="/admin/users" className="top-bar-link">
          <Users size={16} />
          <span>Manage users</span>
        </Link>
      )}
      <button type="button" className="top-bar-logout" onClick={onLogout}>
        <LogOut size={16} />
        <span>Log out</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run view test to verify it passes**

Run: `npm test -w @webatlas/web -- TopBar.view`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing container test**

Create `apps/web/src/widgets/top-bar/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockUser: { id: string; email: string; full_name: string | null; role: string } | null = null;
const logout = vi.fn();
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({
    status: mockUser ? 'authenticated' : 'anonymous',
    currentUser: mockUser,
    logout,
  }),
}));
vi.mock('../../features/auth', () => ({ default: () => <div>AUTH_WIDGET</div> }));

import TopBar from './index';

beforeEach(() => { mockUser = null; logout.mockClear(); });

const renderBar = () => render(<MemoryRouter><TopBar /></MemoryRouter>);

describe('TopBar', () => {
  it('shows the brand always', () => {
    renderBar();
    expect(screen.getByText('WebATLAS')).toBeInTheDocument();
  });

  it('anonymous sees the auth widget (login), not a profile', () => {
    renderBar();
    expect(screen.getByText('AUTH_WIDGET')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument();
  });

  it('an authenticated admin sees the profile with Manage users', () => {
    mockUser = { id: '1', email: 'admin@b.test', full_name: 'A', role: 'admin' };
    renderBar();
    expect(screen.getByText('admin@b.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage users/i })).toBeInTheDocument();
  });

  it('an authenticated viewer sees the profile without Manage users', () => {
    mockUser = { id: '2', email: 'v@b.test', full_name: 'V', role: 'viewer' };
    renderBar();
    expect(screen.getByText('v@b.test')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- top-bar/index`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 7: Implement the container**

Create `apps/web/src/widgets/top-bar/index.tsx`:

```tsx
import { useSession } from '../../entities/session/model/session.store';
import AuthWidget from '../../features/auth';
import { TopBarView } from './ui/TopBar.view';

export default function TopBar() {
  const { status, currentUser, logout } = useSession();
  return (
    <header className="top-bar glass-panel">
      <span className="top-bar-brand">WebATLAS</span>
      <div className="top-bar-right">
        {status === 'authenticated' && currentUser ? (
          <TopBarView email={currentUser.email} role={currentUser.role} onLogout={logout} />
        ) : (
          <AuthWidget />
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- top-bar`
Expected: PASS (9 tests: 5 view + 4 container).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/widgets/top-bar/
git commit -m "feat(web): top bar with profile + admin Manage-users link"
```

---

### Task 5: `/admin/users` route + `UserManagementPanel` contract

Promote the inner panel to the exported surface and give it a route.

**Files:**
- Modify: `apps/web/src/features/user-management/index.tsx` (export `UserManagementPanel({ onClose })`, drop the `open` wrapper)
- Modify: `apps/web/src/features/user-management/index.test.tsx` (drop the `open={false}` assertions)
- Create: `apps/web/src/pages/admin-users/index.tsx`
- Create: `apps/web/src/pages/admin-users/index.test.tsx`

**Interfaces:**
- Consumes: `useUsersPresenter`, `UserTableView`, `UserFormModalView` (all unchanged); `RequireRole`; `useNavigate`/`Navigate` from `react-router-dom`.
- Produces: named export `UserManagementPanel({ onClose }: { onClose: () => void })` from `features/user-management`; default export `AdminUsersRoute` from `pages/admin-users`.

- [ ] **Step 1: Rewrite the user-management container**

Replace all of `apps/web/src/features/user-management/index.tsx` with:

```tsx
import { useUsersPresenter } from './model/useUsersPresenter';
import { UserTableView } from './ui/UserTable.view';
import { UserFormModalView } from './ui/UserFormModal.view';

// The `open` prop is gone: a route's existence IS the open signal (design §4.4).
// The panel no longer renders its own Close button — the route owns dismissal,
// which also removes the duplicate close chrome found during /run.
export function UserManagementPanel({ onClose }: { onClose: () => void }) {
  const p = useUsersPresenter();
  return (
    <div className="user-mgmt-panel">
      <UserTableView
        users={p.users} canModify={p.canModify}
        onEdit={p.openEdit} onToggleActive={p.toggleActive} onNew={p.openCreate}
        loading={p.loading} listError={p.listError}
      />
      <UserFormModalView
        open={p.modal.mode !== 'closed'}
        mode={p.modal.mode === 'edit' ? 'edit' : 'create'}
        values={p.values} fieldErrors={p.fieldErrors} formError={p.formError}
        canSave={p.canSave} saving={p.saving}
        onField={p.setField} onSubmit={p.submitForm} onClose={p.closeModal}
      />
      <button type="button" className="user-mgmt-back" onClick={onClose}>
        Back to map
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing route test**

Create `apps/web/src/pages/admin-users/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let mockRole: string | null = null;
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({
    status: mockRole ? 'authenticated' : 'anonymous',
    currentUser: mockRole ? { id: '1', email: 'a@b.test', full_name: 'A', role: mockRole } : null,
  }),
}));
vi.mock('../../features/user-management', () => ({
  UserManagementPanel: () => <div>USER_MGMT_PANEL</div>,
}));

import AdminUsersRoute from './index';

beforeEach(() => { mockRole = null; });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>MAP_HOME</div>} />
        <Route path="/admin/users" element={<AdminUsersRoute />} />
      </Routes>
    </MemoryRouter>
  );

describe('AdminUsersRoute', () => {
  it('renders the panel for an admin', () => {
    mockRole = 'admin';
    renderAt('/admin/users');
    expect(screen.getByText('USER_MGMT_PANEL')).toBeInTheDocument();
  });

  it('redirects an editor to /', () => {
    mockRole = 'editor';
    renderAt('/admin/users');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
    expect(screen.queryByText('USER_MGMT_PANEL')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to /', () => {
    mockRole = null;
    renderAt('/admin/users');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- admin-users`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Implement the route**

Create `apps/web/src/pages/admin-users/index.tsx`:

```tsx
import { Navigate, useNavigate } from 'react-router-dom';
import { RequireRole } from '../../features/auth/ui/RequireRole';
import { UserManagementPanel } from '../../features/user-management';

// UX gate ONLY. A non-admin who types this URL is redirected, but that is not
// the protection: the API enforces admin on every /api/users route, so a forced
// render still yields 401/403 on every call.
export default function AdminUsersRoute() {
  const navigate = useNavigate();
  return (
    <RequireRole role="admin" fallback={<Navigate to="/" replace />}>
      <div className="admin-users-route">
        <UserManagementPanel onClose={() => navigate('/')} />
      </div>
    </RequireRole>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- admin-users`
Expected: PASS (3 tests).

- [ ] **Step 6: Update the user-management container test**

The old suite asserts `open={false}` renders null — a contract that no longer exists. Replace all of `apps/web/src/features/user-management/index.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./model/useUsersPresenter', () => ({
  useUsersPresenter: () => ({
    users: [], canModify: () => true, openEdit: vi.fn(), toggleActive: vi.fn(),
    openCreate: vi.fn(), loading: false, listError: null,
    modal: { mode: 'closed' }, values: {}, fieldErrors: {}, formError: null,
    canSave: true, saving: false, setField: vi.fn(), submitForm: vi.fn(), closeModal: vi.fn(),
  }),
}));
vi.mock('./ui/UserTable.view', () => ({ UserTableView: () => <div>USER_TABLE</div> }));
vi.mock('./ui/UserFormModal.view', () => ({ UserFormModalView: () => null }));

import { UserManagementPanel } from './index';

describe('UserManagementPanel', () => {
  it('renders the user table', () => {
    render(<UserManagementPanel onClose={vi.fn()} />);
    expect(screen.getByText('USER_TABLE')).toBeInTheDocument();
  });

  it('calls onClose from the back control (the route owns dismissal)', async () => {
    const onClose = vi.fn();
    render(<UserManagementPanel onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /back to map/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the user-management suite**

Run: `npm test -w @webatlas/web -- user-management`
Expected: PASS (2 tests). The presenter/view suites in that slice are untouched and still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/user-management/ apps/web/src/pages/admin-users/
git commit -m "feat(web): /admin/users route; UserManagementPanel drops the open prop"
```

---

### Task 6: Merge basemap into the layer tree

`BasemapSwitcher` becomes a "Bản đồ nền" section at the top of the tree.

**Files:**
- Modify: `apps/web/src/components/LayerTree.tsx` (render `<BasemapSwitcher />` at the top of the content)
- Modify: `apps/web/src/components/BasemapSwitcher.tsx` (drop the floating `glass-panel` wrapper)
- Test: `apps/web/src/components/LayerTree.test.tsx`

**Interfaces:**
- Consumes: `useMapContext()` → `{ basemap, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity }`; `layerGroups` from `data/mockData`.
- Produces: no new exports — `LayerTree` now contains the basemap section.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/LayerTree.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setBasemap = vi.fn();
vi.mock('../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    basemap: 'street',
    setBasemap,
    layersState: [{ id: 'layer_dams', visible: true, opacity: 1 }],
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
  }),
}));
vi.mock('../data/mockData', () => ({
  layerGroups: [
    { id: 'group_water_resources', name: 'Tài nguyên nước', layers: [{ id: 'layer_dams', name: 'Đập & Hồ chứa' }] },
  ],
}));

import LayerTree from './LayerTree';

describe('LayerTree with the merged basemap section', () => {
  it('renders the Bản đồ nền section', () => {
    render(<LayerTree />);
    expect(screen.getByText('Bản đồ nền')).toBeInTheDocument();
  });

  it('still renders the layer groups', () => {
    render(<LayerTree />);
    expect(screen.getByText('Tài nguyên nước')).toBeInTheDocument();
  });

  it('basemap buttons still switch the basemap', async () => {
    render(<LayerTree />);
    await userEvent.click(screen.getByRole('button', { name: /vệ tinh/i }));
    expect(setBasemap).toHaveBeenCalledWith('satellite');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- LayerTree`
Expected: FAIL — "Bản đồ nền" is not in the tree (the switcher is still a separate floating panel).

- [ ] **Step 3: Drop the floating wrapper from `BasemapSwitcher`**

In `apps/web/src/components/BasemapSwitcher.tsx`, replace this line:

```tsx
    <div className="basemap-switcher glass-panel">
```

with:

```tsx
    <div className="basemap-switcher">
```

(It no longer floats — it is a section inside the tree, so it must not carry its own panel chrome.)

- [ ] **Step 4: Render the section inside `LayerTree`**

In `apps/web/src/components/LayerTree.tsx`, add the import after the existing imports:

```tsx
import BasemapSwitcher from './BasemapSwitcher';
```

Then, immediately after this opening line:

```tsx
      <div className="layer-tree-content">
```

insert:

```tsx
        <div className="layer-tree-section">
          <h3 className="layer-tree-section-title">Bản đồ nền</h3>
          <BasemapSwitcher />
        </div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- LayerTree`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/LayerTree.tsx apps/web/src/components/BasemapSwitcher.tsx apps/web/src/components/LayerTree.test.tsx
git commit -m "feat(web): merge basemap switcher into Quan ly Du lieu as a section"
```

---

### Task 7: App wiring + CSS re-layout

Mount the top bar and route, drop the loose basemap/auth slots, and re-anchor the panels right.

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `TopBar` (Task 4); `AdminUsersRoute` (Task 5); `Shell` (Task 3); `LayerTree` (now containing the basemap, Task 6).
- Produces: the final layout. No new exports.

- [ ] **Step 1: Rewrite `App.tsx`**

Replace all of `apps/web/src/app/App.tsx` with:

```tsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import TopBar from '../widgets/top-bar';
import Shell from '../features/shell';
import AdminUsersRoute from '../pages/admin-users';
import MapView from '../features/map/ui/MapView';
import LayerTree from '../components/LayerTree';
import MapControls from '../components/MapControls';
import SearchBar from '../components/SearchBar';
import DynamicPopup from '../components/DynamicPopup';
import DynamicLegend from '../components/DynamicLegend';
import OGCClient from '../components/OGCClient';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import '../styles/main.css';

function App() {
  const [panelsVisible, setPanelsVisible] = useState(true);

  return (
    <AppProviders>
      <BrowserRouter>
        <div className="app-container">
          {/* MapView is a SIBLING of <Routes>, never inside one: navigating to
              /admin/users overlays a live map instead of unmounting it, so
              center/zoom/layer state survives navigation. */}
          <MapView />
          <MapControls />

          <TopBar />

          {/* Left: doing. Burger drawer with the editing tools (editor/admin). */}
          <Shell />

          <SearchBar />

          {/* Right: seeing. Layers + basemap + legend as one stacked panel. */}
          <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
            <LayerTree />
            <DynamicLegend />
            <OGCClient />
          </div>

          <DynamicPopup />

          <button
            className="toggle-panels-btn glass-panel"
            onClick={() => setPanelsVisible(!panelsVisible)}
            title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
          >
            {panelsVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
          </button>

          <Routes>
            <Route path="/" element={null} />
            <Route path="/admin/users" element={<AdminUsersRoute />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
```

- [ ] **Step 2: Update the routing test for the new tree**

`App.routing.test.tsx` (Task 1) mocks `BasemapSwitcher` and `features/auth`, which `App.tsx` no longer imports directly. Replace all of `apps/web/src/app/App.routing.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/LayerTree', () => ({ default: () => <div>LAYER_TREE</div> }));
vi.mock('../components/DynamicLegend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../components/OGCClient', () => ({ default: () => <div>OGC</div> }));
vi.mock('../components/MapControls', () => ({ default: () => <div>CONTROLS</div> }));
vi.mock('../components/SearchBar', () => ({ default: () => <div>SEARCH</div> }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../features/shell', () => ({ default: () => <div>SHELL</div> }));
vi.mock('../pages/admin-users', () => ({ default: () => <div>ADMIN_USERS</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map and no admin route at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN_USERS')).not.toBeInTheDocument();
  });

  it('renders the admin route at /admin/users', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    expect(screen.getByText('ADMIN_USERS')).toBeInTheDocument();
  });

  it('KEEPS THE MAP MOUNTED at /admin/users (map is a sibling of Routes)', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    // This is the whole point of the sibling arrangement: OpenLayers must not
    // re-initialize and the user's center/zoom must survive navigation.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Replace the shell CSS**

In `apps/web/src/styles/main.css`, delete the entire "Adaptive shell (roadmap 2.2)" block (the `.persona-rail`, `.persona-rail-item`, `.workspace-panel*`, and `.workspace-placeholder*` rules — they style deleted components) and append:

```css
/* Shell layout restructure: left = doing, right = seeing */
.top-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 52px;
  z-index: 1200; display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; border-radius: 0;
}
.top-bar-brand { font-weight: 700; letter-spacing: 0.02em; }
.top-bar-right, .top-bar-profile { display: flex; align-items: center; gap: 12px; }
.top-bar-email { opacity: 0.75; font-size: 13px; }
.top-bar-link, .top-bar-logout {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
  border: none; background: transparent; border-radius: 8px; cursor: pointer;
  font: inherit; color: inherit; text-decoration: none;
}
.top-bar-link:hover, .top-bar-logout:hover { background: rgba(56, 189, 248, 0.18); }

/* Burger + left drawer (editor/admin only) */
.burger-btn {
  position: absolute; top: 64px; left: 12px; z-index: 1100;
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border: none; cursor: pointer; border-radius: 10px;
}
.edit-drawer {
  position: absolute; top: 64px; bottom: 12px; left: 12px; width: 360px; max-width: 88vw;
  z-index: 1101; display: flex; flex-direction: column; overflow: hidden;
}
.edit-drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; flex-shrink: 0;
}
.edit-drawer-header h2 { font-size: 15px; font-weight: 600; }
.edit-drawer-close { border: none; background: transparent; cursor: pointer; display: flex; }
.edit-drawer-body { overflow-y: auto; padding: 0 12px 12px; flex: 1; }

/* Right: display controls, stacked */
.layer-tree-section { margin-bottom: 12px; }
.layer-tree-section-title { font-size: 12px; font-weight: 600; opacity: 0.7; margin-bottom: 6px; }
.basemap-switcher { display: flex; gap: 6px; }

/* Admin route: full-screen over a live map */
.admin-users-route {
  position: absolute; top: 52px; left: 0; right: 0; bottom: 0;
  z-index: 1500; overflow: auto; padding: 24px;
  background: rgba(248, 250, 252, 0.97);
}
.user-mgmt-back {
  margin-top: 16px; padding: 8px 14px; border: none; border-radius: 8px;
  cursor: pointer; font: inherit;
}
```

- [ ] **Step 4: Re-anchor the panels right (the stacked column)**

**Read this before editing.** Today `.panels-wrapper` has **no positioning at all** — it is only `transition`/`opacity`/`pointer-events`, and each child floats itself absolutely (`.layer-tree` at `top:24px; left:24px`; `.dynamic-legend` at `bottom:24px; right:24px`). To get the *one stacked right column* the design calls for (§4.3), the wrapper becomes the positioned flex container and the children stop self-positioning. Locate every rule by selector — the line numbers below are from a snapshot and drift.

**4a.** Replace the whole `.panels-wrapper` rule with:

```css
.panels-wrapper {
  position: absolute; top: 64px; right: 12px; bottom: 64px;
  z-index: 900; width: 320px; max-width: 88vw;
  display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto;
  transition: opacity 0.35s ease, transform 0.35s ease;
  opacity: 1;
  pointer-events: auto;
}
```

(`.panels-wrapper.hidden` is unchanged — leave it as-is.)

**4b.** In `.layer-tree` (~line 94), **delete** `position: absolute;`, `top: 24px;`, and `left: 24px;`. Replace `width: 300px;` with `width: 100%;` and `max-height: calc(100vh - 100px);` with `max-height: none;`. It is laid out by the wrapper now. Keep `overflow-y: auto`, `display: flex`, `flex-direction: column`.

**4c.** In `.dynamic-legend` (~line 523), **delete** `position: absolute;`, `bottom: 24px;`, and `right: 24px;`. Keep `padding` and `min-width`. It stacks under the layer tree now.

**4d.** In `.basemap-switcher` (~line 58), **delete** `position: absolute;`, `bottom: 24px;`, and `left: 24px;`. Keep `gap` and `padding`. It is an in-tree section (Task 6) and the Step 3 rule supplies its flex layout.

**4e.** In `.toggle-panels-btn` (~line 305), **delete** `left: 50%;` and `transform: translateX(-50%);`, then add `right: 12px;` and change `bottom: 24px;` to `bottom: 12px;`. It must sit with the panel it toggles — left-of-center it reads as a second burger.

**4f.** **Delete the whole `.auth-widget-slot` rule** (~line 859) — the top bar owns auth and nothing renders that class now.

- [ ] **Step 4.5: Confirm the basemap is mounted exactly ONCE**

Task 6 added `<BasemapSwitcher />` *inside* `LayerTree`. Until this task's Step 1 rewrite lands, App.tsx ALSO renders a standalone `<BasemapSwitcher />` as a sibling of `<LayerTree />` — so between Task 6 and now the switcher mounts twice (two live copies wired to the same `setBasemap`). The Step 1 rewrite fixes this by dropping both the import and the standalone render. Verify it actually did:

Run: `grep -n "BasemapSwitcher" apps/web/src/app/App.tsx`
Expected: **no matches.** If anything prints, the standalone render or its import survived the rewrite — remove it. The only `BasemapSwitcher` in the tree must be the one inside `LayerTree` (Task 6).

- [ ] **Step 5: Run the full suite**

Run: `npm test -w @webatlas/web`
Expected: PASS — all suites, including the rewritten App routing tests. No suite references `PersonaRail`, `WorkspacePanel`, or `WorkspacePlaceholder`.

- [ ] **Step 6: Build + lint**

Run: `npm run build -w @webatlas/web`
Expected: `tsc -b` + vite build succeed — no dangling imports of the deleted views or of `BasemapSwitcher`/`AuthWidget` in `App.tsx`.

Run: `npm run lint -w @webatlas/web`
Expected: no new errors. Remove any unused import it flags.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/App.tsx apps/web/src/app/App.routing.test.tsx apps/web/src/styles/main.css
git commit -m "feat(web): wire top bar + admin route; re-anchor display panels right"
```

---

### Task 8: Manual verification (/run)

Confirm the restructure in the real app. **This task carries the reachability assertion that jsdom cannot make** (design §8) — the check that would have caught the original blocker.

**Files:** none.

- [ ] **Step 1: Bring the stack up**

Start Postgres + GeoServer (`docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`), the API (`npm run dev -w @webatlas/api`), and the web dev server (`npm run dev:web`).

Create one user per role. The `create-admin` script **only hashes a password on INSERT** — its update branch sets `role`/`is_active` but never `password_hash`, so re-running it on an existing email will NOT change the password. Use a fresh email:

```bash
npm run create-admin -w @webatlas/api -- --email run-t8-admin@webatlas.test --password "RunTask8Verify!" --name "T8 Admin"
```

Then create the editor + viewer through the admin API (log in as the admin above, `POST /api/users` with `role: 'editor'` / `role: 'viewer'`).

- [ ] **Step 2: THE REGRESSION CHECK — burger reachability**

Log in as the **editor**, open the drawer, and confirm in the browser console:

```js
const b = document.querySelector('.burger-btn');
const r = b.getBoundingClientRect();
document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b  // must be true
```

Expected: `true`. If it is `false`, something overlaps the burger and the drawer cannot be closed — the exact class of bug that shipped last time. **This must pass before the branch merges.**

- [ ] **Step 3: Per-role walkthrough**

- **Logged out:** lean map; **no burger**; top bar shows Log in; right panel shows Quản lý Dữ liệu (with the Bản đồ nền section) + legend.
- **Viewer:** **no burger** (same lean map as public); top bar shows the profile, **no Manage users**.
- **Editor:** **burger present**; opening it reveals the edit tools; draw/modify/delete still work as before; no Manage users in the profile.
- **Admin:** burger + edit tools; profile shows **Manage users**.

- [ ] **Step 4: Route + map-persistence check**

As the admin: pan/zoom the map to a recognizable spot, then click **Manage users**.

- The URL becomes `/admin/users` and the user table renders (create/edit/deactivate still work).
- There is exactly **one** dismissal control (no duplicate Close under a panel header).
- Click **Back to map** (or the browser Back button) → the map is **exactly where you left it** (same center/zoom). This is the whole point of the sibling arrangement in §3 — if the map reset, `MapView` is being unmounted.
- Deep-link `http://localhost:5173/admin/users` directly in a fresh tab as admin → table renders.
- Deep-link the same URL as the **viewer** → redirected to `/`.

- [ ] **Step 5: Map interactivity**

With the drawer open, confirm the map still pans/zooms and the feature popup still opens (the drawer is an overlay, not a modal blocker).

- [ ] **Step 6: Record the result + clean up**

Note the outcome against §5's table in this plan. Delete the three `run-t8-*` users via the admin API (an admin cannot delete the account it is authenticated as — delete that one from another admin session or leave it and note it).

---

## Self-Review

**1. Spec coverage (design §1–§10):**
- §2 left/right/top split → Tasks 3, 6, 7 ✓
- §3 router + map as sibling of `<Routes>` → Task 1 (+ asserted again in Task 7 Step 2, verified live in Task 8 Step 4) ✓
- §4.1 top bar + profile + admin link → Task 4 ✓
- §4.2 drawer presenter (`hasDrawer`, `isOpen` false default), `EditDrawer`, deletions → Tasks 2, 3 ✓
- §4.3 basemap merged as a section; `.panels-wrapper` + `.toggle-panels-btn` re-anchored right → Tasks 6, 7 ✓
- §4.4 `/admin/users`, `UserManagementPanel({ onClose })`, `open` prop removed → Task 5 ✓
- §5 per-role table → Task 8 Step 3 ✓
- §6 persona kept as model, no switcher → honored (no task edits `entities/persona`; Global Constraints forbid it) ✓
- §7 authorization unchanged, UX-only gates → comments preserved in Tasks 3, 4, 5 ✓
- §8 testing, incl. jsdom-cannot-prove-reachability → Global Constraints + Task 8 Step 2 ✓
- §9 roadmap reversals → recorded in the design doc; no code task needed ✓
- §10 YAGNI (no switcher, no placeholders, no extra routes, no tabs) → honored ✓

**2. Placeholder scan:** none — every step carries real code or an exact command with expected output.

**3. Type/name consistency:** `useShellPresenter()` → `{ hasDrawer, isOpen, toggle, close }` (Task 2) consumed identically in Task 3's container + its mock. `EditDrawerView({ open, onClose, children })` (Task 3) matches its call site. `TopBarView({ email, role, onLogout })` (Task 4) matches. `UserManagementPanel({ onClose })` (Task 5) matches `pages/admin-users` and the rewritten slice test. `Role` imported from `entities/session/model/session.types` (verified: `'admin'|'editor'|'viewer'`). `useMapContext` destructuring in Task 6's mock matches `BasemapSwitcher`/`LayerTree`'s real usage. `rolePersonas` untouched throughout, per Global Constraints.

**4. Risks for the implementer:**
- **Task 7 Step 4 inverts how the panels are laid out — read it before touching CSS.** `.panels-wrapper` is *not* a positioned container today; it only carries transitions, and each child floats itself absolutely (`.layer-tree` `left:24px`, `.dynamic-legend` `right:24px`). Step 4 makes the wrapper the positioned flex column and strips the children's self-positioning. Miss 4b/4c and the "stacked right column" silently stays two floating panels that overlap. Locate every rule by selector; the line numbers drift.
- **`AuthWidget` still owns the login modal** and is now rendered *inside* `TopBar` for anonymous users. Its modal is `position: fixed` (`.modal-overlay`, z-index 2000), so it still centers over the viewport, above the top bar. Don't "fix" it.
- **The `admin` persona is now unused for routing** (`hasDrawer` only checks `steward`). That is deliberate (design §4.2) — do not delete it from `PERSONAS` or `rolePersonas`; the model stays whole.
- **`usePersona`'s localStorage pick has no UI writer** after this change (design §6). Expected — do not wire a switcher back in.
- **Task 8 Step 2 is the gate.** If reachability fails, fix the CSS before merging; a green unit suite proves nothing about overlap.
