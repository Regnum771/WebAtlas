# Adaptive Shell + Persona Panels (Roadmap 2.2) — Design

**Date:** 2026-07-17
**Status:** Approved design — ready for implementation planning
**Roadmap:** Phase 2, item 2.2 (see `2026-07-15-product-roadmap.md` §4.3–§4.4). The structural UI change that makes the personas real; consumes 2.1 (roles now grant distinct capabilities).
**Scope:** Replace the flat pile of always-present map overlays with a coherent **persona-workspace framework** — a slim left rail whose entries reveal a task panel per persona. This is the **framework/scaffold**: it wires the *existing* features (FeatureEditing, UserManagement) into workspaces and leaves typed placeholders for the not-yet-built Governance/Research panels (2.3/2.4). Frontend only — no backend/schema change.

---

## 1. Context & goal

The current shell (`apps/web/src/app/App.tsx`) is a flat set of always-present overlays on a full-screen map: `AuthWidget`, `FeatureEditing`, a "Manage users" button + `UserManagement`, and a `panels-wrapper` (LayerTree, BasemapSwitcher, SearchBar, DynamicLegend, OGCClient). Role-gating is ad hoc (`RequireRole` wrapped around individual pieces). There is no unifying "shell" or "persona" concept — features accreted as loose overlays.

The roadmap (§4.4) mandates an **adaptive shared shell**: one map-centric app that reveals tools/panels/layers by role & persona (progressive disclosure), task-oriented panels over a monolithic toolbar, role-scoped defaults, and the backend as the sole authorization boundary (the shell only *reveals* UX).

Verified context (`apps/web/src`, 2026-07-17):
- `useSession()` (`entities/session/model/session.store`) exposes `currentUser: { id, email, full_name, role } | null`; `Role = 'admin'|'editor'|'viewer'`.
- FSD top-level: `app/ components/ entities/ features/ shared/ styles/`. No existing persona/workspace/shell concept.
- Styling convention: `glass-panel` class + absolutely-positioned slots (e.g. `.auth-widget-slot`, `.panels-wrapper`).
- `RequireRole` (`features/auth/ui/RequireRole`) is a UX-only gate.
- `FeatureEditing` (`features/feature-editing`) is `RequireRole(['admin','editor'])`-gated; `UserManagement` (`features/user-management`) is `RequireRole('admin')`-gated and takes `{ open, onClose }`.

**Goal:** an authenticated user lands in a workspace matching their persona — the rail shows only the workspaces their role permits, the active workspace's task panel slides out over the map, and the choice persists. The public (anonymous) user sees a lean map with no rail. The framework is complete and demoable with the existing edit/management features live and Governance/Research as "coming soon" placeholders.

### Non-goals (deferred)

- **Governance/Research panel content** — filter/query/export/saved-views live in 2.3/2.4. This plan ships typed placeholders only.
- **Persona persisted on the user record** — persona is a pure client UX pick (localStorage), not a DB column or auth-payload field (matches §4.1 "personas differ in UX intent, not enforced permissions").
- **Router / multi-page** — the shell is overlays/panels on the single map view, no react-router.
- **Redesign of the base map controls** (LayerTree, Search, Legend, BasemapSwitcher) — they stay as the always-on base beneath the shell.
- **Mobile-specific layout** — desktop-first; responsive polish later.

---

## 2. Persona model (5 personas over 4 roles)

| Persona id | Persona | Determined by | Workspace content |
|---|---|---|---|
| `public` | Community & Water Users | anonymous (no session) | none — lean map only (no rail) |
| `governance` | Governance | `viewer` + user pick | placeholder (2.3/2.4) |
| `research` | Research & Academia | `viewer` + user pick | placeholder (2.3/2.4) |
| `steward` | Data Steward / Producer | `editor` (and `admin`) | existing `FeatureEditing` |
| `admin` | System Operator / Admin | `admin` | `UserManagement` (+ future labels) |

**Role → allowed personas** (`rolePersonas`):
- anonymous / no session → `[public]`
- `viewer` → `[governance, research]` (user picks which)
- `editor` → `[steward]`
- `admin` → `[steward, admin]` (admin is a superset of editor per §4.1, plus management)

A `viewer` **picks** Governance vs Research from the rail; the pick persists in `localStorage`. Persona is UX routing only — `RequireRole` still guards the hosted features (defense in depth), and the backend remains the authorization boundary.

---

## 3. Architecture

Two new units: an `entities/persona/` model (the "who am I acting as" source of truth) and a `features/shell/` slice (the rail + panel that consume it).

```
apps/web/src/
  entities/persona/
    persona.ts        # Persona type; PERSONAS registry; rolePersonas(role)
    usePersona.ts     # { available, active, setActive } from session role + localStorage pick
  features/shell/
    model/useShellPresenter.ts   # workspaces for the role, active workspace, open/close state
    ui/
      PersonaRail.view.tsx       # passive left rail (button per workspace; active highlight)
      WorkspacePanel.view.tsx    # passive sliding panel (header + close + children slot)
      WorkspacePlaceholder.tsx   # shared "coming soon" content for governance/research
    index.tsx                    # container: wires rail + panel, maps activeId -> content
```

**Boundary:** the shell **hosts** workspace content but does not own it. `index.tsx` maps `activeWorkspace.id → ReactNode`:
- `steward` → `<FeatureEditing />` (existing, unchanged internally)
- `admin` → the UserManagement content (existing; see §4.3 on the `{open,onClose}` adaptation)
- `governance` / `research` → `<WorkspacePlaceholder persona={...} />`

The always-on base (`MapView`, `MapControls`, `panels-wrapper`, `DynamicPopup`) stays. The rail + panel **replace** the ad-hoc `auth-widget-slot` edit/manage buttons. `App.tsx` shrinks to: providers → `MapView` + base panels + `AuthWidget` (login/badge stays top-right) + `<Shell />`.

**Convention rules (enforced in review):**
1. `entities/persona` and the shell presenter contain no JSX-less-violations: presenter returns a view-model + handlers; `*.view.tsx` are props-only.
2. Persona is UX only; every hosted feature keeps its own `RequireRole` gate — the shell never becomes the authorization decision (§4.4, auth-foundation §2). Container carries the standard comment.
3. No `ol/*`, no `apiRequest` in the shell — it composes existing features; it fetches nothing.
4. localStorage access is defensive (invalid/absent → default persona).

---

## 4. Components

### 4.1 `entities/persona/persona.ts`

```ts
import type { Role } from '../session/model/session.types';

export type PersonaId = 'public' | 'governance' | 'research' | 'steward' | 'admin';

export interface Persona {
  id: PersonaId;
  label: string;
  requiredRole: Role | null; // null = anonymous/public
}

export const PERSONAS: Record<PersonaId, Persona> = {
  public:     { id: 'public',     label: 'Public',        requiredRole: null },
  governance: { id: 'governance', label: 'Governance',    requiredRole: 'viewer' },
  research:   { id: 'research',   label: 'Research',      requiredRole: 'viewer' },
  steward:    { id: 'steward',    label: 'Data Steward',  requiredRole: 'editor' },
  admin:      { id: 'admin',      label: 'Management',    requiredRole: 'admin' },
};

// Which personas a role may inhabit. admin is a superset (steward + admin).
export function rolePersonas(role: Role | null | undefined): PersonaId[] {
  if (role === 'admin') return ['steward', 'admin'];
  if (role === 'editor') return ['steward'];
  if (role === 'viewer') return ['governance', 'research'];
  return ['public'];
}
```

### 4.2 `entities/persona/usePersona.ts`

Reads `useSession()` role, computes `available = rolePersonas(role)`, and resolves `active`:
- Read the stored pick from `localStorage` key `webatlas.persona`.
- If the stored id is in `available`, use it; else use `available[0]`.
- `setActive(id)` writes to localStorage (only if `id` is in `available`) and updates state.
- Anonymous → `available = ['public']`, `active = 'public'`.

Returns `{ available: PersonaId[]; active: PersonaId; setActive: (id: PersonaId) => void }`. Defensive: a malformed/stale localStorage value is ignored, never throws.

### 4.3 `features/shell/model/useShellPresenter.ts`

Derives the shell view-model from `usePersona()`:
- `workspaces: { id: PersonaId; label: string }[]` = available personas **minus `public`** (public has no panel), each mapped through `PERSONAS[id].label`.
- `activeId` = `usePersona().active` (if it's `public`, there is no active workspace → panel closed).
- `isOpen: boolean` — whether the panel is expanded (a workspace can be selected but collapsed). Starts open when there is ≥1 workspace and the active persona isn't public.
- Handlers: `select(id)` → `setActive(id)` + open; `close()` → collapse; `toggle()`.

Returns `{ workspaces, activeId, isOpen, select, close }`. No fetch, no JSX.

### 4.4 Views

- **`PersonaRail.view.tsx`** (props-only): `{ workspaces, activeId, onSelect }`. Renders a vertical rail (`glass-panel`) with one button per workspace (label; active gets an aria-current + highlight). Renders **nothing** when `workspaces` is empty (anonymous/public). Calls `onSelect(id)`.
- **`WorkspacePanel.view.tsx`** (props-only): `{ open, title, onClose, children }`. A sliding container anchored to the left edge (`glass-panel`), with a header (title + close button) and a `children` slot. `open` drives the slide/visibility. Absolutely positioned, mirroring existing overlay conventions.
- **`WorkspacePlaceholder.tsx`** (props-only): `{ persona: PersonaId }`. Shared "coming soon" content naming what the workspace will do (Governance → oversight/reporting; Research → analysis/query/export), so the framework is demoable without 2.3/2.4.

### 4.5 Container — `features/shell/index.tsx`

```
Shell:
  const s = useShellPresenter()
  <PersonaRail workspaces={s.workspaces} activeId={s.activeId} onSelect={s.select} />
  <WorkspacePanel open={s.isOpen && s.activeId !== 'public'} title={label(s.activeId)} onClose={s.close}>
    {content(s.activeId)}   // steward -> FeatureEditing; admin -> UserManagement content; governance/research -> WorkspacePlaceholder
  </WorkspacePanel>
```

- The container carries the "shell reveals UX per role; backend enforces" comment.
- **UserManagement adaptation:** `UserManagement` currently takes `{ open, onClose }` and renders a modal-ish panel. Inside the shell it is always "open" when the admin workspace is active, so the container renders its inner content with `open` bound to the panel's open state and `onClose` bound to the panel close. (Minimal: pass `open={s.isOpen && s.activeId==='admin'} onClose={s.close}`.) `FeatureEditing` renders as-is (its own `RequireRole` gate still applies).

### 4.6 `App.tsx` changes

Remove the `auth-widget-slot` edit/manage buttons and the loose `FeatureEditing`/`UserManagement` mounts; render `<Shell />` instead. Keep `AuthWidget` (login/badge) top-right, `MapView` + `MapControls` + `panels-wrapper` + `DynamicPopup` as the base. `App.tsx` no longer owns `usersOpen` state (moves into the shell).

---

## 5. Data flow

1. Session changes (login/logout) → `useSession` role changes → `usePersona` recomputes `available`; if the stored pick is no longer valid for the new role, `active` falls back to `available[0]`.
2. The rail renders the available workspaces (none for anonymous → no rail, lean map).
3. User clicks a rail entry → `select(id)` sets the active persona (persisted) and opens the panel → the container swaps the panel's children to that workspace's content.
4. `close()` collapses the panel; the map stays fully interactive throughout; re-opening restores the last active workspace.
5. A `viewer`'s Governance/Research pick persists across reloads via localStorage.

---

## 6. Error handling

- **localStorage** read/parse is wrapped defensively: absent, malformed, or stale-for-role values resolve to `available[0]`, never throw.
- **No network** in the shell itself — it composes existing features, which retain their own error handling (e.g. UserManagement's `ApiError` mapping).
- **Role/persona desync** (an editor with a stale "governance" pick) is handled by the validity check in `usePersona` — the invalid pick is discarded.

---

## 7. Testing

- **`persona.ts`** — `rolePersonas`: admin→[steward,admin], editor→[steward], viewer→[governance,research], null→[public].
- **`usePersona`** (mocked session + localStorage) — available derived from role; active = valid stored pick else first available; `setActive` persists and rejects out-of-role ids; anonymous→public; malformed localStorage → default (no throw).
- **`useShellPresenter`** — workspaces = available minus public; active/open state; `select` opens + sets; `close` collapses.
- **`PersonaRail.view`** — renders a button per workspace, active highlight, `onSelect` fires; renders nothing for empty workspaces (anon).
- **`WorkspacePanel.view`** — open/closed visibility, title, close callback, children slot.
- **Container `index.tsx`** — steward→FeatureEditing present; admin→UserManagement content; governance/research→placeholder; anonymous→no rail/panel. (Mock the hosted features + session to assert routing, not their internals.)
- **Manual `/run`:** log in as editor → Data Steward workspace = the edit panel; as admin → rail shows Data Steward + Management, Management = user table; as viewer → rail shows Governance + Research (placeholders), pick persists across reload; logged out → lean map, no rail. Confirm the map stays interactive with a panel open.

---

## 8. Convention rules (enforced in review)

1. Presenter returns view-model + handlers (no JSX/fetch/`ol/*`); `*.view.tsx` props-only.
2. Persona is UX routing only; hosted features keep their `RequireRole` gates; the shell is never the authorization decision (container carries the comment).
3. No `apiRequest`/`ol/*` in the shell or persona entity.
4. localStorage access is defensive.
5. Reuse `glass-panel` + absolute-positioning conventions; no new styling system.

---

## 9. Scope boundaries (YAGNI — deferred)

- Governance/Research panel content (filter/query/export/saved views) → 2.3/2.4.
- Persona on the user record / auth payload → not needed; localStorage pick suffices.
- Router / multi-page shell.
- Mobile layout, panel resize/drag, multi-panel docking.
- Editable attribute labels workspace content → 2.5 (the Management workspace will host it later).

---

## 10. Follow-on

- **2.3 Query/filter/search** and **2.4 export/saved views** fill the Governance/Research placeholders — they mount into the existing `WorkspacePanel` with no shell change.
- **2.5 Editable labels** adds a section to the Management (admin) workspace.
- If persona ever needs to be server-assigned, `usePersona` is the single seam to swap localStorage for an API/auth-payload source, with no change to the rail/panel.
