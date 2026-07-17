# Shell Layout Restructure — Burger Drawer, Right-Side Display Controls, Admin Route

**Status:** approved, not yet implemented
**Supersedes:** the rail/panel surface of `2026-07-17-adaptive-shell-design.md` (the persona *model* survives; see §9)
**Roadmap:** revises 2.2; reverses the "no router" call in roadmap §7

## 1. Why

The adaptive shell (roadmap 2.2, tasks 1–5) shipped a persona rail plus a sliding workspace panel. The `/run` verification of Task 6 found the panel fully encloses the rail at a higher z-index, so **every rail item is unclickable in every role** — an admin can never reach the Management workspace. Details and measurements: `plans/2026-07-17-adaptive-shell.md` Task 6.

Rather than nudge CSS offsets, this design resolves three problems at once:

1. **The collision.** The rail and panel both anchored `left: 12px`, and both fought the LayerTree for the left edge.
2. **Editing needs room.** The edit workspace is robust and will grow more tools. A 340px overlay competing for the left edge is the wrong container.
3. **Persona was premature UI.** Persona is a *default workspace preference*, not a session-mode switcher. Governance/Research have no real tools yet — only "coming soon" copy — so there is nothing to switch between. The rail was UI for an unfleshed concept.

The result deletes more than it adds.

## 2. Principle: left is doing, right is seeing

The screen splits by purpose, which is what dissolves the collision by construction:

- **Left** — tools that *change* data (editing). Behind a burger, because they are task-oriented and only some roles have them.
- **Right** — controls for what you *see* (basemap, layers, legend). Always visible; every role has them.
- **Top** — identity and cross-cutting navigation (profile, admin console).

```
+---------------------------------------------------+
| [=]  WebATLAS                    [Profile v]      |  top bar
+------+---------------------------+----------------+
|      |                           | Quản lý Dữ liệu|
| edit |                           |  Bản đồ nền    |
| draw |          MAP              |  [x] Đập & Hồ  |
| tools|                           |  [x] Sông ngòi |
|      |                           |----------------|
|      |                           | Chú giải       |
+------+---------------------------+----------------+
   ^ burger drawer (editor/admin)      ^ display controls
```

## 3. Architecture

```
AppProviders (QueryClient → Auth → Map → MapEditing)   ← map context ABOVE routes
└── BrowserRouter
    ├── TopBar                 (always)
    ├── MapView                (ALWAYS MOUNTED — never unmounts on navigation)
    ├── EditDrawer             (editor/admin only)
    ├── DisplayPanel           (always: layers + basemap + legend)
    └── Routes
        ├── "/"            → null                (map shows through)
        └── "/admin/users" → <AdminUsersRoute/>  (full-screen overlay)
```

`MapProvider` already lives in `AppProviders` above `children` (verified in `app/providers/AppProviders.tsx`), so a router mounted inside it leaves map context untouched across navigation. `MapView` renders as a **sibling of `<Routes>`**, not inside a route — so `/admin/users` overlays a still-live map. Center, zoom, and layer state survive; OpenLayers never re-initializes.

## 4. Components

### 4.1 `widgets/top-bar/` (new)

Spans the top. Brand left, burger left-most (only when the drawer has content), profile right.

The profile menu absorbs today's `AuthWidget` / `UserBadgeView` (which moves out of `.auth-widget-slot`). Contents: email + role, a **Manage users** entry wrapped in `RequireRole role="admin"` rendering a `<Link to="/admin/users">`, and Log out. Anonymous shows the existing Log in button, which keeps its current modal.

- Presenter: none needed — reads `useSession()` directly, renders links. No fetch.
- Props-only view: `TopBar.view.tsx` (`{ user, onLogout, canManageUsers }`).

### 4.2 `features/shell/` → the burger drawer (rewritten)

`useShellPresenter` reduces to drawer state: `{ hasDrawer: boolean; isOpen: boolean; toggle(); close() }`.

`hasDrawer` is `rolePersonas(role).includes('steward')` — i.e. editor/admin. Viewer and anonymous get **no burger at all** (§5).

`rolePersonas` itself is **unchanged**: admin still returns `['steward','admin']`. The `admin` persona simply no longer maps to a drawer workspace — user management is a route now (§4.4), reached from the top bar, not a persona workspace. Keeping the model as-is avoids editing `persona.ts` and its passing tests for a UI concern.

`isOpen` **defaults to `false`** (closed). The old `isOpen: true` default is what put a panel over the rail on load; a drawer that ambushes you on every login is the wrong default regardless.

`EditDrawer.view.tsx` is a props-only left drawer (`{ open, onClose, children }`) hosting `<FeatureEditing />`. It slides from the left, is dismissible, and is sized to grow (more edit tools are coming — this is the whole point of the change).

**Deleted:** `PersonaRail.view.tsx` (+test), `WorkspacePanel.view.tsx` (+test), `WorkspacePlaceholder.tsx`, and the `.persona-rail` / `.workspace-panel` CSS. Nothing renders the placeholder once viewers have no drawer.

### 4.3 `DisplayPanel` — one stacked right panel

A single right-hand column, one visual object:

1. **Quản lý Dữ liệu** — `BasemapSwitcher` becomes a **"Bản đồ nền" section at the top** of the LayerTree's content, above the layer groups. `BasemapSwitcher.tsx` stays its own component and keeps its own `useMapContext()`; it just renders inside the tree instead of floating. Its absolute positioning drops.
2. **Chú giải** — `DynamicLegend` below, so the legend sits directly under the layers it explains.

`.panels-wrapper` re-anchors from left to right. `SearchBar` stays where it is (top-center); `OGCClient` and `MapControls` are untouched.

**The existing `.toggle-panels-btn` ("Ẩn giao diện") moves with it.** It toggles `.panels-wrapper`, so it becomes the right panel's show/hide control and re-anchors bottom-**right**. It must not stay bottom-center-left, where it would read as a second burger competing with the real one. `panelsVisible` state stays in `App.tsx` as it is today.

### 4.4 `pages/admin-users/` (new)

Renders the user-management panel **directly**, full-screen over the map.

Today `UserManagement({ open, onClose })` wraps `Panel` and renders its own "Close" button — which, inside the old shell panel, produced duplicate chrome (a second close button under the panel's own ×; found during `/run`). The route renders `Panel` with the route's own dismissal (navigate back to `/`), so the duplicate chrome disappears.

**Contract change:** `Panel` is promoted to the exported surface, taking `{ onClose }`. The `open`-prop wrapper is **removed** — a route's existence *is* the "open" signal, so the boolean becomes dead weight. `features/user-management/index.tsx` exports `Panel` (renamed `UserManagementPanel`); `AdminUsersRoute` passes `onClose={() => navigate('/')}`. `index.test.tsx`'s `open={false} → null` assertions are replaced by the route's render/redirect tests (§8). The presenter, API wrappers, and both views are untouched.

Gate: `RequireRole role="admin"` with a redirect-to-`/` fallback.

## 5. Per-role result

| Role | Burger | Drawer | Right panel | Top bar |
|---|---|---|---|---|
| Anonymous | no | — | layers + legend | Log in |
| Viewer | no | — | layers + legend | profile |
| Editor | **yes** | edit tools | layers + legend | profile |
| Admin | **yes** | edit tools | layers + legend | profile + **Manage users** |

Viewer and public converge on the same lean map. That is correct, not a regression: a viewer has no tools yet. When 2.3 gives Governance/Research real query/filter tools, they earn a drawer then.

## 6. Persona: kept as a model, stashed as UI

`entities/persona/` **survives unchanged** — `PERSONAS`, `rolePersonas`, `usePersona` stay, with their passing tests. It is still how the app knows an editor gets edit tools.

What is stashed is the **switcher UI**. Persona is a default workspace *preference*, closer to a setting than to navigation. Until Governance/Research have real tools, there is nothing to switch between and no switcher is built.

`usePersona`'s localStorage pick (`webatlas.persona`) stays functional and tested but currently has no writer in the UI. That is deliberate: the model is ready for when a preferences surface exists. **This is the one piece of intentionally unreached machinery in this design** — justified because deleting and re-deriving it costs more than keeping a tested 30-line hook.

## 7. Authorization (unchanged)

The backend remains the authorization boundary. Every gate here is UX-only:

- The burger's absence for viewers hides *nothing protected* — a viewer has no edit API rights regardless.
- `/admin/users`' `RequireRole` + redirect is UX. **A non-admin who types the URL still gets 401/403 from every `/api/users` call.** The API enforces admin on every user route.
- `FeatureEditing` keeps its own `RequireRole`; `UserManagementPanel` sits behind the route's gate.

The shell reveals; the backend enforces. Unchanged from auth-foundation §2 and adaptive-shell §3.

## 8. Testing

The unit suite passed while the feature was unusable, because it asserted **DOM presence, not reachability**. That gap is the first thing to close.

- **Regression (the blocker):** with the drawer open, the burger must stay clickable.

  **jsdom cannot prove this.** jsdom has no layout engine — every `getBoundingClientRect()` returns zeros and `elementFromPoint` is meaningless, which is *precisely why* the unit suite stayed green while the rail was buried. Asserting reachability in jsdom would give false confidence, the same failure mode in a new costume.

  So this assertion belongs in the **`/run` walkthrough**, where a real browser computes real layout: with the drawer open, `document.elementFromPoint()` at the burger's centre must resolve to the burger (the check that caught the original bug). The jsdom unit test asserts only what jsdom can honestly know — that `EditDrawer` renders its children and `onClose` fires.
- **`useShellPresenter`:** `hasDrawer` true for editor/admin, false for viewer/anon; `toggle`/`close` state.
- **`TopBar`:** admin sees Manage users; editor/viewer do not; anonymous sees Log in.
- **`DisplayPanel`:** basemap section + layer groups + legend all render; basemap switching still calls `setBasemap`.
- **`AdminUsersRoute`:** renders the user table for admin; redirects to `/` for non-admin.
- **`/run` walkthrough:** all four roles, per §5's table; deep-link `/admin/users` directly; confirm the map keeps its center/zoom across navigation (the whole point of §3); confirm map pan/zoom with the drawer open.

## 9. Roadmap reversals to record

Both are deliberate; recording them beats leaving silent contradictions in the docs.

1. **"No router" (roadmap §7 YAGNI) is reversed.** A management console is the case where URLs earn their keep — deep-linkable, bookmarkable, back-button. `react-router-dom` is the one new dependency.
2. **The rail-based adaptive shell (2.2) is superseded.** Tasks 1–5 shipped a rail this design removes. The persona *model* (Task 1–2) survives; the rail/panel *views* (Task 4) and the container's routing (Task 5) are rewritten. Roadmap §1/§7 should record the reversal.

## 10. YAGNI — explicitly not building

- No persona switcher (§6) — no real personas to switch between yet.
- No Governance/Research placeholders — deleted; they advertised nothing.
- No routes beyond `/admin/users` — the map stays at `/`.
- No tabs in the right panel — stacked is enough; the app has no tab pattern.
- No persona DB field, no new roles — unchanged from adaptive-shell §9.
