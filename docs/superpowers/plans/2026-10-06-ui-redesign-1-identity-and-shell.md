# UI Redesign 1: Identity and Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's rail, flyout and bottom toolbar with the new shell (green top bar, docked left panel, tool group, vertical scale slider, right-hand assistant dock) in the new visual identity, with one shared implementation of every message, field, dialog and popup state, and Vietnamese text throughout.

**Architecture:** The screen becomes one CSS grid (top bar / left panel / map column / optional assistant column); the map lives in a `position: relative` stage and every floating control is a child of that stage, so nothing repeats the map's offset arithmetic and `MapView` resizes itself with a `ResizeObserver`. Open/closed state of the assistant and the tool menus lives in one small module store. Inline messages, fields, buttons, dialogs and toasts are shared view components in `shared/ui`; features stop hand-rolling them. The panel's contents stay today's layer list and legend, stacked; sub-project 2 replaces them.

**Tech Stack:** React 19, react-router 7, OpenLayers 10, lucide-react, vitest + testing-library (jsdom), puppeteer-core for browser proof. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-ui-redesign-design.md`, sub-project 1 of its table. Decision numbers (D4, D13 …) refer to it. Exact sizes not in the spec come from the identity page it links (https://claude.ai/artifact/PPD3rVjMiih3sjiN8UUwNA).

**Branch:** `feat/ui-identity-shell`, cut from the commit that holds this plan. All commands run from the repo root.

## Global Constraints

- **Colours, exactly:** `#14532D` green (top bar only in this sub-project), `#18213A` ink, `#55607A` ink-2, `#C8CEDA` rule, `#F3F5F4` paper, `#FFFFFF` sheet, `#FFD928` mark (focus ring and selected feature, nothing else), `#B3261E` alert. Two supporting tints from the identity page: `#CBE0D2` (inactive text on green), `#FBEDEC` (ground of an error message).
- **Red means it failed or cannot be undone**, and always comes with an icon and a sentence. Success and caution are ink with an icon. No blue, no teal, no second green anywhere in the interface.
- **On is filled, off is an outline.** Corners are `0` or `3px` (`50%`/`999px` only for round marks). Floating elements have a 1px ink outline and no shadow. No `backdrop-filter`.
- **Type:** Archivo only, sizes `11.5`, `13`, `14`, `16`, `21` px on a `1.35` line; `font-stretch: 92%` inside the left panel, `100%` elsewhere; `font-variant-numeric: tabular-nums` wherever a number can change. Newsreader is not loaded in this sub-project (see Decisions 8).
- **Interface text is Vietnamese.** Few words (D14): no counts, no restated rules. Copy in this plan is exact; do not reword it.
- **Every message says what happened and what to do next.** Colour never carries a state alone: icon + words + an ARIA role (`alert` for failures, `status` for the rest).
- **Input:** a field is checked on blur; once it shows an error it rechecks on every keystroke; typed text is never cleared on error; a failed submit focuses the first field in error; Enter submits; Escape closes the topmost dialog, menu or popup and returns focus to what opened it; a busy button ignores a second press.
- **D4:** `ZOOM_SCALE_LEVELS` in `apps/web/src/features/map/model/zoomScale.ts` is not edited: 11 stops, 1:12.800.000 to 1:25.000.
- **D3:** `MapView` stays mounted on every route. It is never rendered inside a `<Route>`.
- **Every map action goes through `features/map/model/mapCommands.ts`**; no `ol` import outside `features/map/model`.
- **Supported viewport:** 768 px wide and up, 600 px high and up. Nothing below (spec, Out of scope).
- **Code comments in English.** When a touched file has Vietnamese comments, translate them in the same change. User-facing strings are not comments.
- **Commit messages in Vietnamese** (Conventional Commits), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before every commit:** `npm run test -w @webatlas/web` and `npm run build:web` (vitest does not type-check).
- **jsdom proves text, roles and behaviour, never layout.** Overlap and fit claims are proved only by Task 11's browser script.

## Decisions This Plan Makes Beyond the Spec

The spec is silent on these; each is the smallest choice that keeps today's functions reachable. They are for the reviewer to accept or change before execution.

1. **Navigation lists only routes that exist.** After this sub-project that is `Bản đồ`. Công trình, Dữ liệu, Giới thiệu and Quản lý danh mục bản đồ add their own entry in sub-projects 3 to 5. No dead links.
2. **Trợ lý moves to the top bar but stays signed-in only.** Opening it to every visitor, with sign-in inside the panel, is sub-project 3's item.
3. **The panel shows today's layer list above today's legend**, both visible at once. Sub-project 2 replaces both with Đang bật and Mục lục.
4. **Print gets a labelled home:** an `In và xuất` link at the foot of the panel (where the wireframe draws `In`).
5. **Feature editing becomes a fifth tool, `Biên tập`, shown to admins only.** The burger button and the drawer are deleted. The four reader tools are exactly the spec's.
6. **"Về vùng công tác" becomes a `Toàn vùng` link under the scale readout.** The pan-pointer button is deleted; closing a tool is what returns the map to panning.
7. **Below 1100 px wide the assistant lies over the map's right side instead of narrowing it.** At 1100 px and up it docks and the map narrows.
8. **Newsreader Italic is not loaded here.** Water names are drawn by the map styles, which sub-project 2 owns; loading a face nothing uses would break D13.
9. **One tool menu is open at a time and stays open until its button, Escape, or another tool closes it.** Closing a menu cancels a drawing in progress but keeps a finished region or result. Any change to the region of interest opens `Vùng phân tích`, so "Dùng làm vùng" from search or a popup shows its effect.
10. **A WMS layer whose first tile fails is removed and reported**, instead of sitting on the map drawing nothing.
11. **The signed-in user is one button showing the role**, opening a menu with the email, `Người dùng` (admins) and `Đăng xuất`.

## Review Focus

Inputs the spec implies but does not name. Each has a test in the task that owns the code.

1. **A second Enter while sign-in is in flight** sends one request, not two (Task 8).
2. **A WMS address that is not http(s), or an empty layer name,** is refused under its field, adds nothing to the map, and keeps what was typed (Task 6).
3. **The same failure reported repeatedly** (a retry that fails again, tiles failing in a burst) shows one popup, not a stack; at most three popups show at once (Task 3).
4. **Signing out, or a session expiring, while the assistant or `Biên tập` is open** closes both and leaves no empty panel (Tasks 4 and 6).
5. **A 40-character email at 768 px** does not push the top bar past the window; the full address stays readable in the menu (Task 7 for the markup, Task 11 for the layout).

## File Structure

**Created** (all under `apps/web/src` unless noted)

| File | Responsibility |
|---|---|
| `shared/ui/ui.css` | Styles for the shared components: `.btn`, `.field`, `.input`, `.msg`, `.toast`, `.dialog`, `.spin`, `.float`, `.link`, focus ring |
| `shared/ui/Button.tsx`, `Spinner.tsx`, `Message.tsx`, `TextField.tsx` | Inline state components |
| `shared/ui/useFormFields.ts` | Blur-then-keystroke validation for a set of fields |
| `shared/ui/Dialog.tsx` | Modal dialog: Escape, focus in, focus back. Replaces `Modal.tsx` |
| `shared/ui/toast.store.ts`, `ToastHost.tsx` | Popups on the map: store and view |
| `shared/ui/useOnline.ts`, `ConnectionStrip.tsx` | Connection-lost strip |
| `styles/shell.css` | Grid, top bar, side panel, map stage, assistant dock, tool group, scale slider, page-over-map |
| `features/shell/model/shell.store.ts` | Which tool menu is open; whether the assistant is open |
| `features/shell/ui/AppShell.view.tsx`, `SidePanel.view.tsx`, `AssistantDock.view.tsx` | The frame's three passive views |
| `app/MapScreen.tsx` | Composition: puts every feature into the frame (was `RailAndFlyout` in `App.tsx`) |
| `features/map/ui/ScaleSlider.tsx` | Vertical scale slider: view and container |
| `features/map/ui/ToolGroup.view.tsx` | The labelled tool buttons and their menus |
| `features/map/ui/MeasureTool.tsx`, `BasemapTool.tsx` | Contents of Đo and Nền bản đồ |
| `features/map/model/wmsOverlay.ts` | Adds a WMS overlay to the map and reports a failed first tile |
| `features/add-data/index.tsx`, `ui/AddWmsForm.view.tsx`, `model/validation.ts` | Contents of Thêm dữ liệu |
| `features/auth/model/loginValidation.ts` | Email and password checks |
| `entities/session/model/roleLabels.ts` | `ROLE_LABELS` |
| `widgets/top-bar/model/nav.ts`, `ui/AccountMenu.view.tsx` | Navigation list; signed-in menu |
| `test/stylesheet.test.ts`, `test/copy.test.ts` | Contract tests: tokens and forbidden styles; forbidden English strings |
| `apps/web/scripts/verify-shell.mjs` | Browser proof of the layout claims |

**Deleted:** `features/shell/index.tsx`, `features/shell/model/{useRail,useShellPresenter}.ts`, `features/shell/ui/{IconRail,EditDrawer}.view.tsx`, `features/map/ui/MapToolbar.tsx`, `components/OGCClient.tsx`, `features/auth/ui/UserBadge.view.tsx`, `shared/ui/Modal.tsx`, each with its test file.

**Modified:** `index.html`, `shared/ui/tokens.css`, `shared/ui/ConfirmDialog.tsx`, `styles/main.css`, `app/App.tsx`, `app/App.routing.test.tsx`, `features/map/ui/{MapView,MapLoadingBar}.tsx`, `features/map/model/zoomScale.ts`, `features/roi/ui/{RoiChip.view,RoiDrawButtons}.tsx`, `features/analysis/{index.tsx,ui/*.view.tsx}`, `features/auth/**`, `features/search/**`, `widgets/top-bar/**`, `features/feature-editing/**`, `features/user-management/**`, `pages/{print,admin-users}/**`, `components/DynamicPopup.tsx` (class names only).

---

### Task 1: Tokens, typeface and base styles

**Files:**
- Modify: `apps/web/index.html`, `apps/web/src/shared/ui/tokens.css`, `apps/web/src/styles/main.css:1-24`
- Create: `apps/web/src/shared/ui/ui.css`, `apps/web/src/styles/shell.css` (empty but imported), `apps/web/src/test/stylesheet.test.ts`

**Interfaces:**
- Produces (CSS custom properties): `--green --on-green --on-green-2 --ink --ink-2 --rule --paper --sheet --mark --alert --alert-soft`, `--font-ui`, `--text-xs` (11.5px) `--text-sm` (13px) `--text-md` (14px) `--text-lg` (16px) `--text-xl` (21px), `--leading` (1.35), `--radius` (3px), `--space-1..5` (unchanged), `--topbar-height` (52px), `--panel-width` (348px), `--assistant-width` (360px).
- Produces (classes, in `ui.css`): `.float` (sheet ground, 1px ink outline, `--radius`, no shadow), `.link` (ink, weight 600, underlined 1px, offset 3px), `.visually-hidden`, and the global rule `:focus-visible { outline: 3px solid var(--mark); outline-offset: 2px; box-shadow: 0 0 0 1px var(--ink); }`.
- Leaves in place until Task 11: a block at the foot of `tokens.css` headed `/* Legacy aliases — deleted in Task 11 */` mapping every old name still referenced by `main.css` onto a new token (`--text-main: var(--ink)`, `--text-muted: var(--ink-2)`, `--border`, `--border-strong`, `--border-color: var(--rule)`, `--surface: var(--sheet)`, `--surface-raised`, `--surface-sunken: var(--paper)`, `--primary`, `--primary-hover`, `--accent`, `--color-primary: var(--ink)`, `--danger: var(--alert)`, `--radius-sm`, `--radius-md: var(--radius)`, `--bg-panel`, `--bg-panel-hover: var(--sheet)`, `--chrome-bg: var(--green)`, `--chrome-bg-hover: var(--green)`, `--chrome-fg: var(--on-green)`, `--chrome-fg-muted: var(--on-green-2)`, `--glass-shadow: none`, `--elev-1`, `--elev-2: none`, `--rail-width: 0px`, `--flyout-width: var(--panel-width)`).

- [ ] **Step 1: Write the failing test** in `src/test/stylesheet.test.ts`. It reads the CSS files as text with `node:fs` (resolve from `import.meta.dirname`).

```ts
const tokens = read('../shared/ui/tokens.css');
it.each([
  ['--green', '#14532D'], ['--ink', '#18213A'], ['--ink-2', '#55607A'], ['--rule', '#C8CEDA'],
  ['--paper', '#F3F5F4'], ['--sheet', '#FFFFFF'], ['--mark', '#FFD928'], ['--alert', '#B3261E'],
  ['--topbar-height', '52px'], ['--panel-width', '348px'], ['--radius', '3px'],
  ['--text-xs', '11.5px'], ['--text-sm', '13px'], ['--text-md', '14px'], ['--text-lg', '16px'], ['--text-xl', '21px'],
])('token %s is %s', (name, value) => {
  expect(tokens).toMatch(new RegExp(`${name}:\\s*${value}\\s*;`, 'i'));
});
it('loads Archivo with its width axis and no other family', () => {
  const html = read('../../index.html');
  expect(html).toContain('family=Archivo:wdth,wght@62..125,400..800');
  expect(html).not.toMatch(/family=(Inter|Newsreader)/);
  expect(html).toMatch(/<html lang="vi">/);
  expect(html).toMatch(/<title>WebATLAS<\/title>/);
});
it('main.css no longer imports a font', () => {
  expect(read('../styles/main.css')).not.toMatch(/fonts\.googleapis|'Inter'/);
});
```

- [ ] **Step 2: Run it** — `npm run test -w @webatlas/web -- src/test/stylesheet.test.ts`. Expected: FAIL (tokens missing, `lang="en"`).

- [ ] **Step 3: Implement.**
  - `index.html`: `lang="vi"`, `<title>WebATLAS</title>`, and in `<head>` the two Google Fonts preconnects plus `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap">`.
  - `tokens.css`: replace the file with the tokens above (keep the spacing scale), `--font-ui: "Archivo", "Segoe UI", system-ui, sans-serif`, then the legacy alias block. Delete the 768 px essay comment; replace it with one line: `/* Supported viewport: 768px wide and up. See scripts/verify-shell.mjs. */`.
  - `main.css` head: imports become `tokens.css`, `../shared/ui/ui.css`, `./shell.css`; delete the Inter import and the whole legacy `:root { --primary … }` block; `body { font-family: var(--font-ui); font-size: var(--text-sm); line-height: var(--leading); font-stretch: 100%; color: var(--ink); background: var(--paper); }`.
  - `ui.css`: the classes and focus rule listed under Interfaces.

- [ ] **Step 4: Run** the test again, then the whole web suite and `npm run build:web`. Expected: PASS, build clean.

- [ ] **Step 5: Commit** — `feat(web): token màu, chữ Archivo và nền kiểu chung cho giao diện mới`.

---

### Task 2: Inline state components

**Files:**
- Create: `shared/ui/{Button,Spinner,Message,TextField}.tsx`, `shared/ui/useFormFields.ts`, and a `.test.tsx`/`.test.ts` beside each
- Modify: `shared/ui/ui.css`

**Interfaces:**
- Produces:

```ts
// Button.tsx — a busy button keeps focus, shows a spinner, and swallows clicks (and form submits).
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'outline' | 'solid' | 'quiet' | 'danger';   // default 'outline'
  size?: 'md' | 'sm';                                    // 32px / 28px high
  busy?: boolean;
  busyLabel?: string;                                    // shown in place of children while busy
}
export function Button(props: ButtonProps): JSX.Element; // type defaults to "button"

// Spinner.tsx — with a label it is role="status"; without one it is aria-hidden.
export function Spinner(props: { label?: string }): JSX.Element;

// Message.tsx — error is role="alert" and the only red one; the rest are role="status" and ink.
export type MessageTone = 'info' | 'caution' | 'success' | 'error';
export function Message(props: { tone?: MessageTone; title: string; children?: ReactNode; actions?: ReactNode }): JSX.Element;

// TextField.tsx — forwards its ref to the <input>.
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string; label: string; error?: string | null; hint?: string; trailing?: ReactNode;
}
export const TextField: ForwardRefExoticComponent<TextFieldProps & RefAttributes<HTMLInputElement>>;

// useFormFields.ts
export type Validators<K extends string> = Record<K, (value: string) => string | null>;
export function useFormFields<K extends string>(initial: Record<K, string>, validators: Validators<K>): {
  values: Record<K, string>;
  errors: Partial<Record<K, string>>;
  set: (name: K, value: string) => void;   // rechecks the field only if it is showing an error
  blur: (name: K) => void;                 // checks the field
  validateAll: () => K | null;             // checks every field; returns the first one in error, in validator key order
};
```

- Icons are from `lucide-react`: `Info` (info), `TriangleAlert` (caution), `Check` (success), `CircleAlert` (error), 16 px.
- CSS, from the identity page: `.btn` 32px high, `0 14px`, 1px ink border, weight 600; `.btn.solid` ink ground, sheet text; `.btn.quiet` rule border, weight 500; `.btn.danger` alert ground and border, sheet text; `.btn.sm` 28px, `0 10px`; `.btn[aria-disabled="true"]` rule border, ink-2 text, paper ground. `.input` 34px high, 1px ink-2 border; `.input[aria-invalid="true"]` 2px alert border. `.field` grid, 5px gap, label weight 600. `.hint` `--text-xs` ink-2; `.hint.bad` alert, weight 600, with the icon. `.msg` 1px rule border, 10px 12px, icon column 16px; `.msg.bad` 2px alert border on `--alert-soft`. `.spin` 14px ring, rule with ink top, 0.9s; no animation under `prefers-reduced-motion: reduce`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// Button.test.tsx
it('a busy button shows its busy label, is aria-busy, and ignores a press', async () => {
  const onClick = vi.fn();
  render(<Button busy busyLabel="Đang đăng nhập" onClick={onClick}>Đăng nhập</Button>);
  const b = screen.getByRole('button', { name: 'Đang đăng nhập' });
  expect(b).toHaveAttribute('aria-busy', 'true');
  await userEvent.click(b);
  expect(onClick).not.toHaveBeenCalled();
});
it('a busy submit button does not submit its form', async () => { /* form onSubmit spy stays uncalled */ });
it('defaults to type="button"', () => { /* toHaveAttribute('type', 'button') */ });

// Message.test.tsx
it('an error is an alert with the error class', () => {
  render(<Message tone="error" title="Chưa tìm được">Máy chủ không phản hồi.</Message>);
  expect(screen.getByRole('alert')).toHaveClass('msg', 'bad');
});
it.each(['info', 'caution', 'success'] as const)('%s is a status and is not red', (tone) => {
  render(<Message tone={tone} title="x" />);
  expect(screen.getByRole('status')).not.toHaveClass('bad');
});

// TextField.test.tsx
it('ties its error to the input and announces it', () => {
  render(<TextField id="e" label="Email" error="Nhập email." defaultValue="" />);
  const input = screen.getByLabelText('Email');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Nhập email.');
  expect(screen.getByRole('alert')).toHaveTextContent('Nhập email.');
});

// useFormFields.test.ts  (validator: v => v ? null : 'trống')
it('does not check a field while it is first being typed in', …);      // set('a','') → errors.a undefined
it('checks a field on blur', …);                                        // blur('a') → errors.a === 'trống'
it('rechecks on each keystroke once the field shows an error', …);      // blur, then set('a','x') → errors.a undefined
it('never changes the value when it reports an error', …);              // values.a stays what was set
it('validateAll returns the first field in error, in validator order', …);
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/shared/ui`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** the five modules and their CSS.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): thành phần dùng chung cho nút, thông báo, ô nhập và kiểm tra ô nhập`.

---

### Task 3: Dialog, confirmation and popups

**Files:**
- Create: `shared/ui/Dialog.tsx`, `shared/ui/toast.store.ts`, `shared/ui/ToastHost.tsx`, tests beside each
- Modify: `shared/ui/ConfirmDialog.tsx`, `shared/ui/ui.css`, every importer of `shared/ui/Modal` (find with Grep)
- Delete: `shared/ui/Modal.tsx`

**Interfaces:**
- Consumes: `Button` (Task 2).
- Produces:

```ts
// Dialog.tsx — role="dialog", aria-modal, labelled by its title.
// On open: remembers document.activeElement and focuses the first focusable child.
// Escape: calls onClose and stops the event, so a menu or popup behind does not also close.
// On close: returns focus to the remembered element. A click on the backdrop closes.
export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }): JSX.Element | null;

// ConfirmDialog.tsx — confirmLabel is required and repeats the verb of the title.
export interface ConfirmDialogProps {
  open: boolean; title: string; message: string; confirmLabel: string;
  irreversible?: boolean;      // true → the confirm button is variant="danger"; false → "solid"
  busy?: boolean; onConfirm: () => void; onCancel: () => void;
}
// The cancel button reads "Huỷ" and comes first in the DOM; while busy the confirm button is a busy Button.

// toast.store.ts — module store with useSyncExternalStore, the pattern of features/roi/model/roi.store.ts.
export type ToastTone = 'info' | 'success' | 'error';
export interface Toast { id: number; tone: ToastTone; title: string; body?: string; action?: { label: string; run: () => void } }
export const TOAST_AUTO_CLOSE_MS = 6000;
export const MAX_TOASTS = 3;
export function showToast(toast: Omit<Toast, 'id'>): number;
export function dismissToast(id: number): void;
export function useToasts(): Toast[];
export function getToasts(): Toast[];  // current list, for non-React callers and tests
export function resetToasts(): void;   // tests only
```

- Toast rules: `info` and `success` close themselves after `TOAST_AUTO_CLOSE_MS`; `error` stays until dismissed or its action runs. Showing a toast whose tone, title and body equal a live one returns that toast's id and restarts its timer; it does not add a second. Past `MAX_TOASTS`, the oldest non-error toast is dropped (the oldest of all if every one is an error). Running an action dismisses its toast.
- `ToastHost`: `info`/`success` render `role="status"` on ink ground with sheet text (`success` with the tick); `error` renders `role="alert"` on sheet ground with a 2px alert border, the error icon, and a close button `aria-label="Đóng thông báo"`. Escape with focus inside a toast dismisses it.

- [ ] **Step 1: Write the failing tests.**

```tsx
// Dialog.test.tsx
it('moves focus inside on open and back to the opener on close', …);
it('Escape closes it', …);
it('Escape does not reach a keydown listener on document', …);          // the layer behind stays open
it('is labelled by its title', () => { expect(screen.getByRole('dialog', { name: 'Đăng nhập' })).toBeInTheDocument(); });

// ConfirmDialog.test.tsx
it('a reversible confirm button is not red', …);                         // not.toHaveClass('danger')
it('an irreversible confirm button is red and repeats the verb', …);     // name 'Xoá', toHaveClass('danger')
it('offers Huỷ', …);

// toast.store.test.ts  (vi.useFakeTimers)
it('closes an info toast by itself after 6 s', …);
it('keeps an error toast until it is dismissed', …);                     // advance 60 s → still there
it('does not stack the same failure twice', () => {                      // Review Focus 3
  const a = showToast({ tone: 'error', title: 'Không lưu được thay đổi', body: 'Máy chủ không phản hồi.' });
  const b = showToast({ tone: 'error', title: 'Không lưu được thay đổi', body: 'Máy chủ không phản hồi.' });
  expect(b).toBe(a);
  expect(getToasts()).toHaveLength(1);
});
it('shows at most three, dropping the oldest that is not an error', …);  // Review Focus 3
it('running an action dismisses the toast', …);

// ToastHost.test.tsx
it('announces a failure as an alert with a close button', …);
it('announces a success as a status', …);
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/shared/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace each `Modal` import with `Dialog`, giving it the dialog's existing heading text as `title` and removing that heading from the children. `.dialog`: sheet ground, 1px ink outline, `--radius`, padding 14px, `min-width: 320px; max-width: 90vw`; backdrop `rgba(24, 33, 58, 0.4)`, no blur. `.toast` per the identity page.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Fix the tests of the former `Modal` users for the moved heading. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): hộp thoại, xác nhận và thông báo nổi dùng chung`.

---

### Task 4: The frame — grid, side panel, map stage, assistant dock, connection strip

**Files:**
- Create: `features/shell/model/shell.store.ts`, `features/shell/ui/{AppShell,SidePanel,AssistantDock}.view.tsx`, `app/MapScreen.tsx`, `shared/ui/useOnline.ts`, `shared/ui/ConnectionStrip.tsx`, tests beside each
- Modify: `app/App.tsx`, `app/App.routing.test.tsx`, `features/map/ui/{MapView,MapLoadingBar}.tsx` and their tests, `features/map/ui/MapToolbar.tsx` (drop the `flyoutOpen` prop only), `widgets/top-bar/index.tsx`, `styles/{shell,main}.css`
- Delete: `features/shell/model/useRail.ts`, `features/shell/ui/IconRail.view.tsx`, their tests

**Interfaces:**
- Consumes: `ToastHost` (Task 3).
- Produces:

```ts
// shell.store.ts — module store, same pattern as toast.store.ts.
export type ToolId = 'measure' | 'roi' | 'add-data' | 'basemap' | 'edit';
export interface ShellState { assistantOpen: boolean; tool: ToolId | null }
export function useShell(): ShellState;
export function getShell(): ShellState;         // current state, for effects and tests
export function toggleAssistant(): void;
export function closeAssistant(): void;
export function toggleTool(id: ToolId): void;   // opening one closes any other
export function openTool(id: ToolId): void;
export function closeTool(): void;
export function resetShell(): void;             // tests only

// AppShell.view.tsx — slots only. `assistant` null → no third column.
export function AppShellView(props: { topBar: ReactNode; panel: ReactNode; strip: ReactNode; stage: ReactNode; assistant: ReactNode | null }): JSX.Element;
// SidePanel.view.tsx — <aside className="side-panel" aria-label="Bảng bản đồ">; footer is pinned, body scrolls.
export function SidePanelView(props: { children: ReactNode; footer: ReactNode }): JSX.Element;
// AssistantDock.view.tsx — <aside className="assistant-dock" aria-label="Trợ lý"> with a close button aria-label="Đóng trợ lý".
export function AssistantDockView(props: { onClose: () => void; children: ReactNode }): JSX.Element;

export function useOnline(): boolean;                         // navigator.onLine, kept current by 'online'/'offline'
export function ConnectionStrip(): JSX.Element | null;        // null while online
export default function MapView(): JSX.Element;               // no props any more
export function MapLoadingBarView(props: { busy: boolean }): JSX.Element | null;
```

- DOM the later tasks and the browser script rely on:

```
div.app-container
  div.app-shell                       grid: rows var(--topbar-height) 1fr; columns var(--panel-width) minmax(0,1fr) [var(--assistant-width)]
    header.top-bar                    grid-column 1 / -1
    aside.side-panel                  sheet ground, 1px ink right border, font-stretch 92%
    main.map-column                   flex column
      div.connection-strip            only while offline; sheet ground, 2px ink bottom border
      div.map-stage                   position: relative; flex: 1; min-height: 0
        div.map-container             inset 0 (MapView)
        …floats: loading bar, toolbar (until Task 6), toast host
    aside.assistant-dock              only while open
  (DynamicPopup, ProposedEdit, routed pages: siblings of .app-shell, as today)
```

- z-index scale, declared once at the top of `shell.css` and used by every later task: floats in the stage `10`, open tool menu `20`, toast host `30`, feature popup `40`, routed page `90`, top bar `100`, search results `110`, dialog `200`.
- `@media (max-width: 1099px)`: `.assistant-dock` leaves the grid — `position: absolute; top: var(--topbar-height); right: 0; bottom: 0; width: min(var(--assistant-width), calc(100vw - var(--panel-width)))`, z-index `50`, 1px ink left border.
- Connection strip copy: `Mất kết nối. Dữ liệu sẽ tải lại khi có mạng.` with the `WifiOff` icon, `role="status"`.
- Panel contents for this sub-project: `<LayersPanel />`, then a rule, then `<Legend />`; footer `<Link to="/print" className="link">In và xuất</Link>`.
- Toast host position: top of the stage, centred, `top: 58px`, `max-width: calc(100% - 70px)`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// shell.store.test.ts
it('opening a tool closes the one that was open', …);
it('toggling the open tool closes it', …);
it('the assistant and a tool can be open together', …);

// MapScreen.test.tsx  (mock MapView, LayersPanel, Legend, Assistant, MapToolbar as text stubs; mock useSession)
it('shows the layer list and the legend together in the side panel', () => {
  const panel = screen.getByRole('complementary', { name: 'Bảng bản đồ' });
  expect(within(panel).getByText('LAYERS')).toBeInTheDocument();
  expect(within(panel).getByText('LEGEND')).toBeInTheDocument();
  expect(within(panel).getByRole('link', { name: 'In và xuất' })).toHaveAttribute('href', '/print');
});
it('has no rail and no flyout', () => { expect(container.querySelector('.icon-rail, .rail-flyout')).toBeNull(); });
it('docks the assistant when it is opened and the user is signed in', …);
it('closes the assistant when the session ends', () => {                 // Review Focus 4
  // render authenticated with the assistant open; rerender with status 'anonymous'
  expect(screen.queryByRole('complementary', { name: 'Trợ lý' })).toBeNull();
  expect(getShell().assistantOpen).toBe(false);
});

// ConnectionStrip.test.tsx
it('shows at once when the page loads offline', …);                       // stub navigator.onLine = false before render
it('shows on an offline event and goes on an online event', …);

// MapView.test.tsx  (replace the "flyout inset" block)
it('tells OpenLayers when its own box changes size', …);                  // stub ResizeObserver, fire its callback → updateSize called
it('mounts where ResizeObserver does not exist', …);                      // vi.stubGlobal('ResizeObserver', undefined) → no throw; a window resize calls updateSize

// App.routing.test.tsx — keep its three cases; update the mocks (MapScreen's children, no Shell, no OGCClient mock needed after Task 6).
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/features/shell src/app src/shared/ui src/features/map/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `MapView`: drop `flyoutOpen`, the `transitionend` listener and the `flyout-open` class. One effect observes the container with `ResizeObserver` and calls `model.updateSize()`; where `ResizeObserver` is undefined, listen for `window` `resize` instead.
  - `MapScreen`: everything `RailAndFlyout` did (including `primeAdminUnits`), composed into `AppShellView`. The assistant slot is `<AssistantDockView>` wrapping `<Assistant />` only when `status === 'authenticated' && assistantOpen`; an effect calls `closeAssistant()` when `status` leaves `'authenticated'`. `MapToolbar` stays mounted inside the stage for now, without `flyoutOpen`.
  - `App.tsx`: `<div className="app-container"><MapScreen /><Shell /><OGCClient /><DynamicPopup /><ProposedEdit /><Routes>…</Routes></div>`; `TopBar` moves into `MapScreen`'s `topBar` slot. `Shell` (burger and drawer) and `OGCClient` stay until Task 6.
  - `widgets/top-bar/index.tsx`: when authenticated, add `<button type="button" aria-pressed={assistantOpen} onClick={toggleAssistant}>Trợ lý</button>` in `.top-bar-right`. Task 7 restyles it.
  - CSS: write the grid in `shell.css`. In `main.css` delete `.icon-rail*`, `.rail-flyout`, every `.flyout-open` rule and every `transition: left …`; `.map-container` becomes `position: absolute; inset: 0`; `.map-toolbar` and `.map-loading-bar` become `left: 0; width: 100%` (the loading bar `top: 0`); `.edit-drawer` `left: 12px`; `.admin-users-route` gets z-index `90`; `.dynamic-popup` gets z-index `40`.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Start the app (`npm run dev:web`) and look at `/` and `/admin/users` once** to confirm the map fills its stage and survives navigation. Layout is proved properly in Task 11; this is a smoke look.
- [ ] **Step 6: Commit** — `feat(web): khung giao diện mới — lưới, bảng trái, vùng bản đồ, trợ lý neo phải, dải mất kết nối`.

---

### Task 5: Scale slider

**Files:**
- Create: `features/map/ui/ScaleSlider.tsx`, `features/map/ui/ScaleSlider.test.tsx`
- Modify: `features/map/model/zoomScale.ts`, `features/map/model/zoomScale.test.ts`, `features/map/ui/MapToolbar.tsx` and its test (remove the zoom group, the scale label and the home button with their props), `app/MapScreen.tsx`, `styles/{shell,main}.css`

**Interfaces:**
- Consumes: `createCommandExecutor`, `useMapZoom`, `ZOOM_STOPS`, `nearestStopIndex`, `scaleAtZoom`, `formatScale` (existing).
- Produces, in `zoomScale.ts`:

```ts
/** The two scales section 22 names. */
export const NAMED_SCALES: ReadonlyMap<number, string> = new Map([[100_000, 'cấp tỉnh'], [250_000, 'cấp vùng']]);
/** Is the stop at this ZOOM_STOPS index one of the named scales? (indices 7 and 8) */
export function isNamedStop(index: number): boolean;
/** The name to show under the readout: only while the view's scale is within 1 of a named scale. */
export function namedScaleAt(zoom: number): string | null;
/** The stop the + (1) or − (−1) button moves to. Moved out of MapToolbar unchanged, then clamped to the stop range. */
export function stepStopIndex(zoom: number, direction: 1 | -1): number;
```

- Produces, in `ScaleSlider.tsx`:

```ts
export interface ScaleSliderViewProps {
  stopIndex: number; zoom: number; scaleText: string; scaleName: string | null;
  onStopChange: (index: number) => void; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void;
}
export function ScaleSliderView(props: ScaleSliderViewProps): JSX.Element;
export default function ScaleSlider(): JSX.Element;   // container; issues zoomTo and resetView commands
```

- Markup: `div.scale-slider.float` holding, top to bottom, a `+` button (`aria-label="Phóng to"`), the track, a `−` button (`aria-label="Thu nhỏ"`); below it `div.scale-readout.float` holding `<output>` with the exact scale in weight 650, the scale name on its own line when there is one, and a `Toàn vùng` `.link` button.
- The track is a native `<input type="range" min=0 max=10 step=1 aria-label="Tỷ lệ bản đồ" aria-orientation="vertical">` with `aria-valuetext={scaleText}`, drawn vertical with `writing-mode: vertical-lr; direction: rtl`, so the top is the most zoomed in. Eleven `span.scale-tick` siblings sit at `top: (10 − index) × 28px` on a 280 px track; a tick whose `isNamedStop(index)` is true also has class `named` (18 px wide, 3 px thick; others 10 px by 1.5 px). Ticks are `aria-hidden`.
- Position: slider `top: 12px; right: 12px; width: 34px`; readout directly under it, right-aligned, `tabular-nums`.

- [ ] **Step 1: Write the failing tests.**

```ts
// zoomScale.test.ts — add
it('D4: the stops are exactly these eleven', () => {
  expect(ZOOM_SCALE_LEVELS).toEqual([12_800_000, 7_500_000, 5_000_000, 3_000_000, 1_750_000, 1_000_000, 500_000, 250_000, 100_000, 50_000, 25_000]);
});
it('names 1:100.000 cấp tỉnh and 1:250.000 cấp vùng, and nothing else', () => {
  expect(namedScaleAt(zoomForScale(100_000))).toBe('cấp tỉnh');
  expect(namedScaleAt(zoomForScale(250_000))).toBe('cấp vùng');
  expect(namedScaleAt(zoomForScale(500_000))).toBeNull();
  expect(namedScaleAt(zoomForScale(249_000))).toBeNull();     // near is not resting on it
});
it('marks stops 7 and 8 as named', () => {
  expect(ZOOM_STOPS.map((_, i) => isNamedStop(i)).flatMap((named, i) => (named ? [i] : []))).toEqual([7, 8]);
});
it('+ from a stop goes to the next stop; from between stops it goes to the nearer one ahead', …);
it('− at the first stop and + at the last stay put', …);
```

```tsx
// ScaleSlider.test.tsx
it('draws one tick per stop and two heavier ones', () => {
  expect(container.querySelectorAll('.scale-tick')).toHaveLength(11);
  expect(container.querySelectorAll('.scale-tick.named')).toHaveLength(2);
});
it('reads out the exact scale, and the name only when given one', () => {
  render(<ScaleSliderView {...base} scaleText="1:250.000" scaleName="cấp vùng" />);
  expect(screen.getByRole('status')).toHaveTextContent('1:250.000');     // <output>
  expect(screen.getByText('cấp vùng')).toBeInTheDocument();
  rerender(<ScaleSliderView {...base} scaleText="1:180.000" scaleName={null} />);
  expect(screen.queryByText(/cấp/)).toBeNull();
});
it('reports the stop the handle was moved to', …);                         // fireEvent.change value 3 → onStopChange(3)
it('disables + at the nearest scale and − at the farthest', …);
it('Toàn vùng resets the view', …);
it('tells assistive technology the scale, not the index', …);              // aria-valuetext === scaleText
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/features/map/model/zoomScale.test.ts src/features/map/ui/ScaleSlider.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mount `<ScaleSlider />` in the stage from `MapScreen`. Delete `.zoom-slider`, `.zoom-group`, `.zoom-scale-label` from `main.css`. Translate the Vietnamese comments of `zoomScale.ts` to English while there, and correct the two stale ones that say "eight stops" and "1:7.500.000".
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): thanh tỷ lệ dọc ở mép phải, 11 nấc, hai nấc 1:100.000 và 1:250.000 đậm hơn`.

---

### Task 6: Tool group

**Files:**
- Create: `features/map/ui/ToolGroup.view.tsx`, `features/map/ui/{MeasureTool,BasemapTool}.tsx`, `features/map/model/wmsOverlay.ts`, `features/add-data/{index.tsx,ui/AddWmsForm.view.tsx,model/validation.ts}`, tests beside each
- Modify: `app/MapScreen.tsx`, `app/App.tsx`, `features/roi/ui/{RoiChip.view,RoiDrawButtons}.tsx`, `features/analysis/index.tsx`, `features/analysis/ui/{AnalysisButtons,AnalysisParams,AnalysisResultCard}.view.tsx`, `features/feature-editing/ui/EditToolbar.view.tsx`, their tests, `styles/{shell,main}.css`
- Delete: `features/map/ui/MapToolbar.tsx`, `components/OGCClient.tsx`, `features/shell/index.tsx`, `features/shell/model/useShellPresenter.ts`, `features/shell/ui/EditDrawer.view.tsx`, their tests

**Interfaces:**
- Consumes: `useShell`, `toggleTool`, `openTool`, `closeTool` (Task 4); `Button`, `Message`, `TextField`, `useFormFields` (Task 2); `showToast` (Task 3).
- Produces:

```ts
// ToolGroup.view.tsx — ids are opaque strings; the shell store's ToolId is passed in by MapScreen.
export interface ToolDef { id: string; label: string; on?: boolean; content: ReactNode }
export function ToolGroupView(props: { tools: ToolDef[]; open: string | null; onToggle: (id: string) => void; onClose: () => void }): JSX.Element;

// MeasureTool.tsx / BasemapTool.tsx — containers; `active` is "my menu is open".
export default function MeasureTool(props: { active: boolean }): JSX.Element;
export default function BasemapTool(): JSX.Element;

// wmsOverlay.ts — the only place the overlay's ol classes are imported.
export function addWmsOverlay(map: Map, layer: { url: string; layerName: string }, onError: () => void): void;

// features/add-data/model/validation.ts
export function validateWmsUrl(value: string): string | null;     // 'Nhập địa chỉ bắt đầu bằng http:// hoặc https://.'
export function validateLayerName(value: string): string | null;  // 'Nhập tên lớp.'
export default function AddData(): JSX.Element;                    // features/add-data/index.tsx
```

- `ToolGroupView`: `div.tool-group.float` at `top: 12px; left: 12px`, one text button per tool, separated by 1px rule lines. Each button has `aria-expanded` and `aria-controls`; a tool with `on` or that is open gets class `is-on` (ink ground, sheet text). Every tool's content is rendered in a `section.tool-menu.float` (`role="region"`, `aria-label` = the tool's label) and stays mounted; all but the open one carry `hidden`. The open menu sits at `top: 46px; left: 12px; width: 320px; max-height: calc(100% - 102px); overflow: auto`. Escape with focus in the group or menu calls `onClose` and focuses that tool's button.
- Tools, in order: `measure` **Đo**, `roi` **Vùng phân tích** (`on` while a region is resolved), `add-data` **Thêm dữ liệu**, `basemap` **Nền bản đồ**, and for `currentUser.role === 'admin'` only, `edit` **Biên tập** (content `<FeatureEditing />`).
- **Đo:** two `Button`s, `Chiều dài` and `Diện tích`, `aria-pressed` for the active one; pressing the active one stops measuring; the value shows in an `<output>`. When `active` turns false, measuring is cleared.
- **Vùng phân tích**, top to bottom: the region status (`RoiChipView`, now a block with class `roi-status`, no pill); heading `Vẽ vùng` with four labelled buttons `Đa giác`, `Hình chữ nhật`, `Đường`, `Điểm` (icon plus text; keep each button's existing `aria-label`); the four analysis tools as labelled buttons; then the parameter form or the result. When the menu closes while a drawing is in progress, `stopDrawing()` is called. An effect in `MapScreen` calls `openTool('roi')` whenever the ROI store's `status` becomes `'resolving'` or its `error` or `hint` becomes non-null.
- **A tool that cannot run** stays a button with `aria-disabled="true"` and its reason beside it as text, tied with `aria-describedby`. With no region at all, the four buttons share one line under them: `Vẽ hoặc chọn một vùng trước.` Otherwise each disabled tool shows its own reason from `toolAvailability`.
- **Analysis states:** a run that fails shows `<Message tone="error" title={error} />`; a result whose `rows` is an empty array shows `<Message title="Không tìm thấy đối tượng nào trong vùng này." />` in place of the list. Run and cancel are `Button`s (`Chạy`, busy label `Đang tính`; `Huỷ` quiet).
- **Thêm dữ liệu:** heading `Thêm lớp WMS`; `TextField`s `Địa chỉ dịch vụ WMS` (placeholder `https://…/wms`) and `Tên lớp` (placeholder `workspace:tên_lớp`); submit `Thêm vào bản đồ`. On success: `showToast({ tone: 'success', title: 'Đã thêm lớp <tên lớp>' })` and the fields clear. `addWmsOverlay` removes the layer and calls `onError` once if a `tileloaderror` arrives before any `tileloadend`; the container then shows `showToast({ tone: 'error', title: 'Không thêm được lớp <tên lớp>', body: 'Kiểm tra địa chỉ và tên lớp.' })`. No `alert()`.
- **Nền bản đồ:** `role="radiogroup"` with three `role="radio"` buttons `Đường phố`, `Vệ tinh`, `Địa hình`; each issues `{ kind: 'setBasemap' }`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// ToolGroup.view.test.tsx
it('labels every tool with text', …);                                     // getByRole('button', { name: 'Vùng phân tích' }) etc.
it('keeps a closed menu mounted but hidden', …);                          // content in DOM, its region not visible
it('Escape closes the menu and returns focus to its button', …);
it('fills the button of a tool that is on', …);                           // toHaveClass('is-on')

// MapScreen.test.tsx — add
it('shows Biên tập to an admin only', …);                                 // viewer, editor, anonymous → absent
it('closes Biên tập when the session ends', …);                           // Review Focus 4: getShell().tool === 'edit', then anonymous → null
it('opens Vùng phân tích when a region starts resolving', …);
it('has no bottom toolbar, no hint strip and no floating WMS button', () => {
  expect(container.querySelector('.map-toolbar, .toolbar-rail, .ogc-trigger-btn, .burger-btn')).toBeNull();
});

// AnalysisButtons.view.test.tsx — replace
it('with no region, every tool is disabled and one line says why', () => {
  expect(screen.getAllByText('Vẽ hoặc chọn một vùng trước.')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Chọn trong vùng' })).toHaveAccessibleDescription('Vẽ hoặc chọn một vùng trước.');
});
it('a tool the region does not suit says its own reason beside it', …);  // line ROI → 'Thống kê độ cao' described by 'Cần một vùng — thêm bán kính'
it('pressing a disabled tool does not open it', …);

// AnalysisResultCard.view.test.tsx — add
it('says so in ink when nothing was found', …);                           // rows: [] → role status, no .bad

// features/add-data/model/validation.test.ts and AddWmsForm.view.test.tsx   (Review Focus 2)
it.each(['', 'ftp://x/wms', 'example.com/wms', 'not a url'])('refuses %j as an address', (v) => {
  expect(validateWmsUrl(v)).toBe('Nhập địa chỉ bắt đầu bằng http:// hoặc https://.');
});
it('accepts an https address with a query string', …);
it('a refused form adds nothing, keeps what was typed, and focuses the first bad field', async () => {
  await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'example.com/wms');
  await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
  expect(onAdd).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Địa chỉ dịch vụ WMS')).toHaveValue('example.com/wms');
  expect(screen.getByLabelText('Địa chỉ dịch vụ WMS')).toHaveFocus();
});

// wmsOverlay.test.ts
it('removes the layer and reports once when the first tile fails', …);    // dispatch 'tileloaderror' twice → onError once, layer gone
it('keeps the layer when a tile has already loaded', …);                  // 'tileloadend' then 'tileloaderror' → onError not called

// MeasureTool.test.tsx
it('stops measuring when its menu closes', …);                            // rerender active={false} → measure.clear called
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/features src/app`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move every remaining behaviour of `MapToolbar`'s container (`run`, `onMeasure`, `onBasemap`) into `MeasureTool` and `BasemapTool`, then delete `MapToolbar`. `useAnalysisTools` keeps returning `{ buttons, panel }`; `MapScreen` lays them out in the `roi` menu. Remove `glass-panel` from every element this task touches. In `main.css` delete `.map-toolbar`, `.toolbar-rail`, `.control-*`, `.measure-result`, `.ogc-*`, `.input-group`, `.add-layer-btn`, `.burger-btn`, `.edit-drawer*`, `.roi-chip*` (re-express what `roi-status` needs in `shell.css`), `.top-bar-brand`'s 44px margin, and the utility classes `.mb-2 .font-semibold .text-sm .flex .items-center .gap-2` if Grep finds no remaining user.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): nhóm công cụ có nhãn ở góc trên trái thay thanh công cụ đáy; bỏ nút WMS nổi, nút burger và dải gợi ý`.

---

### Task 7: Top bar and account menu

**Files:**
- Create: `widgets/top-bar/model/nav.ts`, `widgets/top-bar/ui/AccountMenu.view.tsx`, `entities/session/model/roleLabels.ts`, tests
- Modify: `widgets/top-bar/index.tsx`, `widgets/top-bar/ui/TopBar.view.tsx`, both tests, `features/auth/index.tsx` and its test, `styles/{shell,main}.css`
- Delete: `features/auth/ui/UserBadge.view.tsx`

**Interfaces:**
- Consumes: `useShell`, `toggleAssistant` (Task 4); `Button` (Task 2).
- Produces:

```ts
// roleLabels.ts
export const ROLE_LABELS: Record<Role, string> = { admin: 'Quản trị viên', editor: 'Biên tập viên', viewer: 'Người xem' };

// nav.ts — later sub-projects append their screen here.
export interface NavItem { to: string; label: string; visibleTo?: readonly Role[] }
export const NAV_ITEMS: readonly NavItem[] = [{ to: '/', label: 'Bản đồ' }];
export function navFor(role: Role | null): NavItem[];

// TopBar.view.tsx — passive.
export interface TopBarViewProps {
  nav: NavItem[];
  search: ReactNode;
  assistant: { open: boolean; onToggle: () => void } | null;   // null → no button
  account: ReactNode;                                          // sign-in button or AccountMenuView
}
export function TopBarView(props: TopBarViewProps): JSX.Element;

// AccountMenu.view.tsx
export function AccountMenuView(props: { email: string; role: Role; onLogout: () => void }): JSX.Element;
```

- `TopBarView`: `header.top-bar` (green ground, 52px, `0 16px`, 22px gap) holding the wordmark `<Link to="/" className="wordmark">WebATLAS</Link>` (17px, weight 700, no letter-spacing); `<nav aria-label="Điều hướng chính">` of `NavLink`s (`--text-md`; inactive `--on-green-2`; the current one white, weight 650, 3px white underline, `aria-current="page"`); the search slot pushed right with `margin-left: auto`, `width: 270px; min-width: 0; flex-shrink: 1`; the `Trợ lý` button (white outline on green; white ground with green text and `aria-pressed="true"` while open); the account slot.
- `AccountMenuView`: a button showing `ROLE_LABELS[role]` with `aria-haspopup="menu"` and `aria-expanded`. Its menu (`role="menu"`, `.float`, right-aligned under the button, `max-width: 280px`) holds the email as plain text with `title={email}` and class `account-email` (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`), `Người dùng` as a `role="menuitem"` link to `/admin/users` for admins only, and `Đăng xuất` as a `role="menuitem"` button. Escape or a click outside closes it and returns focus to the button.
- `AuthWidget` renders only the signed-out case now: a `Đăng nhập` button and the sign-in dialog (Task 8 rebuilds the dialog). The search placeholder becomes `Tìm địa danh, hồ, sông` and the input gets `aria-label="Tìm kiếm"`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// nav.test.ts
it('lists only Bản đồ in this sub-project', () => { expect(navFor(null).map((n) => n.label)).toEqual(['Bản đồ']); });
it('hides an item from a role it is not visible to', …);                  // navFor with a fixture list

// TopBar.view.test.tsx — replace
it('shows the wordmark as a link home, the navigation and the search slot', …);
it('marks the current screen', …);                                        // MemoryRouter at '/', link has aria-current="page"
it('shows no Trợ lý button when given none', …);
it('Trợ lý reports its open state', …);                                   // aria-pressed true/false, click → onToggle

// AccountMenu.view.test.tsx
it('shows the role on the button, not the email', …);                     // button name 'Quản trị viên'
it('offers Người dùng to an admin only', …);
it('Đăng xuất calls onLogout', …);
it('Escape closes the menu and returns focus to the button', …);
it('keeps the whole address available when it is cut short', () => {     // Review Focus 5
  const email = 'nguyen.thi.minh.khai.phong.tai.nguyen.nuoc@monre.example.vn';
  render(<AccountMenuView email={email} role="viewer" onLogout={vi.fn()} />);
  expect(screen.queryByText(email)).toBeNull();                           // not in the bar while the menu is closed
  await userEvent.click(screen.getByRole('button', { name: 'Người xem' }));
  expect(screen.getByText(email)).toHaveAttribute('title', email);
});

// widgets/top-bar/index.test.tsx — replace
it('an anonymous visitor sees Đăng nhập and no Trợ lý', …);
it('a signed-in user sees Trợ lý and the account menu, and no Đăng nhập', …);

// features/auth/index.test.tsx — replace
it('opens the sign-in dialog from the Đăng nhập button', …);              // getByRole('dialog', { name: 'Đăng nhập' })
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/widgets src/features/auth src/entities/session`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete the print icon link from the top bar (the panel footer has it since Task 4) and the old `.top-bar-*`, `.admin-login-btn`, `.user-badge*` rules.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): thanh trên cùng mới — tên, điều hướng, tìm kiếm, Trợ lý, Đăng nhập và trình đơn tài khoản`.

---

### Task 8: Sign-in

**Files:**
- Create: `features/auth/model/loginValidation.ts` and its test
- Modify: `features/auth/model/useLoginPresenter.ts`, `features/auth/ui/LoginModal.view.tsx`, `features/auth/index.tsx`, their tests, `styles/main.css` (delete `.login-*`, `.modal-*`)

**Interfaces:**
- Consumes: `Dialog` (Task 3); `TextField`, `Button`, `Message`, `useFormFields` (Task 2).
- Produces:

```ts
// loginValidation.ts
export function validateEmail(value: string): string | null;
//  ''                      → 'Nhập email.'
//  no '@', or '@' is last  → 'Email thiếu phần sau dấu @.'
//  anything else not matching /^\S+@\S+\.\S+$/ → 'Email chưa đúng dạng.'
export function validatePassword(value: string): string | null;   // '' → 'Nhập mật khẩu.'

// useLoginPresenter.ts
export type LoginField = 'email' | 'password';
export interface LoginFormError { title: string; body: string }
export function useLoginPresenter(onSuccess?: () => void): {
  values: Record<LoginField, string>;
  errors: Partial<Record<LoginField, string>>;
  set: (name: LoginField, value: string) => void;
  blur: (name: LoginField) => void;
  loading: boolean;
  formError: LoginFormError | null;
  /** Checks both fields. Returns the first field in error and sends nothing, or returns null and starts the request. While a request is in flight it returns null and does nothing. */
  submit: () => LoginField | null;
};
```

- Form errors, by cause:

| Cause | `title` | `body` |
|---|---|---|
| 401 | `Email hoặc mật khẩu không đúng` | `Kiểm tra lại rồi thử lần nữa.` |
| 429 | `Thử quá nhiều lần` | `Đợi một lát rồi thử lại.` |
| status 0 or `NETWORK_ERROR` | `Không kết nối được máy chủ` | `Kiểm tra mạng rồi thử lại.` |
| anything else | `Chưa đăng nhập được` | `Thử lại sau.` |

- `LoginModalView`: `Dialog` titled `Đăng nhập`; `TextField` `Email` (`id="login-email"`, `type="email"`, `autoComplete="username"`); `TextField` `Mật khẩu` (`id="login-password"`, `autoComplete="current-password"`) whose `trailing` is a `.link` button reading `Hiện` / `Ẩn` with `aria-pressed`; the form error as `<Message tone="error">` directly above the submit button; submit `Button variant="solid"` reading `Đăng nhập`, busy label `Đang đăng nhập`. The form has `noValidate` (the browser's own bubbles are not used). On submit the view calls `onSubmit()` and, if it returns a field, focuses that input.

- [ ] **Step 1: Write the failing tests.**

```ts
// loginValidation.test.ts
it.each([['', 'Nhập email.'], ['bientap', 'Email thiếu phần sau dấu @.'], ['bientap@', 'Email thiếu phần sau dấu @.'], ['a@b', 'Email chưa đúng dạng.']])('email %j → %s', …);
it('accepts a@b.vn', …);

// useLoginPresenter.test.ts — replace
it('sends nothing and names the first field in error when the form is incomplete', …);   // submit() === 'email', login not called
it('keeps the password after a 401', …);                                                  // values.password unchanged
it('maps 401, 429 and a network failure to their messages', …);                           // table above, exact strings
it('a second submit while the first is in flight sends one request', async () => {       // Review Focus 1
  login.mockReturnValue(new Promise(() => {}));
  act(() => { result.current.submit(); });
  act(() => { result.current.submit(); });
  expect(login).toHaveBeenCalledTimes(1);
});
it('calls onSuccess after a good sign-in', …);

// LoginModal.view.test.tsx — replace
it('shows the field error under its field after the field is left', …);
it('clears the error on the keystroke that fixes it', …);
it('focuses the first field in error on a failed submit', …);
it('Enter in the password field submits', …);
it('shows the form error above the submit button as an alert', …);
it('shows a busy submit button while loading', …);                                        // name 'Đang đăng nhập', aria-busy
it('Hiện shows the password and becomes Ẩn', …);
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/features/auth`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): đăng nhập bằng tiếng Việt, báo lỗi theo từng ô và theo cả biểu mẫu`.

---

### Task 9: Search states

**Files:**
- Modify: `features/search/model/useSearch.ts`, `features/search/ui/SearchBox.view.tsx`, `features/search/index.tsx`, their tests, `styles/{shell,main}.css`

**Interfaces:**
- Consumes: `Message`, `Button`, `Spinner` (Task 2).
- Produces:

```ts
export type SearchStatus = 'idle' | 'loading' | 'done' | 'failed';
export function useSearch(): {
  query: string; setQuery: (q: string) => void;
  results: SearchHit[];
  status: SearchStatus;
  /** The query the current results or failure belong to; '' while idle. */
  answeredQuery: string;
  retry: () => void;        // re-runs the request for the current query at once, without the debounce
  clear: () => void;
};
// SearchBoxView props: replace `loading: boolean` with `status`, `answeredQuery`, `onRetry: () => void`.
```

- `status` is `'idle'` under two characters, `'loading'` from the moment the debounce fires, `'done'` or `'failed'` when the request settles. The `console.error` goes; the failure is now on screen.
- View: while `loading`, a `Spinner label="Đang tìm"` at the right of the input. The dropdown opens for results as today, and also for:
  - `done` with no results: `<Message title={`Không có kết quả cho “${answeredQuery}”`}>Thử tên ngắn hơn.</Message>`
  - `failed`: `<Message tone="error" title="Chưa tìm được" actions={<Button size="sm" onClick={onRetry}>Thử lại</Button>}>Máy chủ không phản hồi.</Message>`
- Blur and Escape dismiss the dropdown in all three cases, as they do for results today; the existing `mousedown` guard keeps `Thử lại` clickable.

- [ ] **Step 1: Write the failing tests.**

```ts
// useSearch.test.ts — add  (fake timers, mocked fetchSearch)
it('is done with no results when the server finds nothing', …);          // status 'done', answeredQuery 'hồ krong bukk'
it('is failed when the request rejects, and keeps the query', …);
it('retry sends the request again without waiting', …);
it('a failure for an old query does not replace a newer answer', …);
```

```tsx
// SearchBox.view.test.tsx — add
it('finding nothing is an ink status, not an alert', () => {
  render(<SearchBoxView {...base} status="done" answeredQuery="hồ krong bukk" results={[]} query="hồ krong bukk" />);
  expect(screen.getByRole('status')).toHaveTextContent('Không có kết quả cho “hồ krong bukk”');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('a failure is an alert with Thử lại', …);                              // click → onRetry
it('says it is searching while loading', …);                              // getByRole('status', { name: 'Đang tìm' })
it('Escape hides the message', …);
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/features/search`. Expected: FAIL.
- [ ] **Step 3: Implement.** `.search-results` becomes a `.float` at z-index `110`, right-aligned under the input, `width: max(100%, 320px)`.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): tìm kiếm phân biệt đang tìm, không có kết quả và lỗi`.

---

### Task 10: Vietnamese copy and shared components in editing, users and print

**Files:**
- Create: `src/test/copy.test.ts`
- Modify: `features/feature-editing/{index.tsx,ui/*.view.tsx,model/use{AttributeForm,EditToolbar,EditExisting}Presenter.ts}`, `features/user-management/{index.tsx,ui/*.view.tsx,model/useUsersPresenter.ts}`, `pages/print/ui/PrintPage.view.tsx`, `pages/admin-users/index.tsx`, their tests, `styles/{shell,main}.css`

**Interfaces:**
- Consumes: `Button`, `TextField`, `Message` (Task 2); `ConfirmDialog`, `Dialog` (Task 3); `ROLE_LABELS` (Task 7).

**Copy.** Replace each string on the left with the one on the right. Buttons become `Button`; `Saving…`-style labels become a busy `Button`; a form-level error becomes `<Message tone="error" title=…>`; a field error goes through `TextField`'s `error`.

| File | From | To |
|---|---|---|
| `EditToolbar.view` | `Add a feature` | `Thêm đối tượng` |
| `LayerPicker.view` | `Layer` · `Select a layer…` | `Lớp` · `Chọn lớp…` |
| `DrawControls.view` | `Draw` · `Drawing…` · `Cancel` | `Vẽ` · `Đang vẽ` · `Huỷ` |
| `DrawControls.view` | `Click Draw, then place a {geomType} on the map.` | `Bấm Vẽ rồi đặt {hình} lên bản đồ.` |
| `DrawControls.view` | `Draw the {geomType} on the map to continue.` | `Vẽ {hình} lên bản đồ để tiếp tục.` |
| `AttributeForm.view` | `Save feature` · `Saving…` · `Cancel` | `Lưu` · `Đang lưu` · `Huỷ` |
| `EditModeToggle.view` | `Edit existing` · `Exit edit` | `Sửa đối tượng có sẵn` · `Thoát sửa` |
| `feature-editing/index` | `Click a feature on an editable layer to edit it.` | `Bấm một đối tượng trên bản đồ để sửa.` |
| `feature-editing/index` | button `Delete feature` | `Xoá đối tượng` |
| `feature-editing/index` | dialog `Delete feature` / `Delete this feature? This cannot be undone.` / `Delete` | title `Xoá đối tượng này?` / message `Không khôi phục được.` / `confirmLabel="Xoá"` with `irreversible` |
| `useAttributeFormPresenter` | `Invalid geometry — please redraw` | `Hình vẽ không hợp lệ. Vẽ lại.` |
| `useAttributeFormPresenter`, `useEditExistingPresenter` | `Someone else changed this layer while you were saving. Please try again.` | `Lớp này vừa được người khác thay đổi. Thử lưu lại.` |
| `useAttributeFormPresenter` | `A feature like this already exists` · `This feature no longer exists` | `Đã có đối tượng như thế này.` · `Đối tượng này không còn nữa.` |
| `useAttributeFormPresenter` | `Draw a geometry first` · `Something went wrong` | `Vẽ hình trước khi lưu.` · `Chưa lưu được. Thử lại.` |
| `useEditToolbarPresenter` | `Select a layer first` | `Chọn lớp trước.` |
| `useEditExistingPresenter` | `Could not delete — please try again` | `Chưa xoá được. Thử lại.` |
| `UserTable.view` | `Users` · `New user` · `Loading users…` | `Người dùng` · `Thêm người dùng` · `Đang tải` (with `Spinner`) |
| `UserTable.view` | headers `Email Name Role Status Created Actions` | `Email` `Họ tên` `Vai trò` `Trạng thái` `Ngày tạo` `Thao tác` |
| `UserTable.view` | `Active` · `Inactive` · `Edit` · `Deactivate` · `Activate` | `Đang hoạt động` · `Đã khoá` · `Sửa` · `Khoá` · `Mở khoá` |
| `UserTable.view` | `You can't change your own access` | `Không tự đổi quyền của chính mình được` |
| `UserFormModal.view` | `New user` · `Edit user` · `Password` · `Full name` · `Role` | `Thêm người dùng` · `Sửa người dùng` · `Mật khẩu` · `Họ tên` · `Vai trò` |
| `UserFormModal.view` | `Cancel` · `Create` · `Save` | `Huỷ` · `Tạo` · `Lưu` |
| `useUsersPresenter` | `Email already in use` · `You do not have permission` | `Email này đã có người dùng.` · `Bạn không có quyền làm việc này.` |
| `useUsersPresenter` | `Something went wrong` · `Couldn't load users` | `Chưa lưu được. Thử lại.` · `Không tải được danh sách người dùng.` |
| `user-management/index` | `Back to map` | `Về bản đồ` |
| `PrintPage.view` | `In / Xuất bản đồ` | `In và xuất` |

- `{hình}` comes from a new `GEOM_LABELS: Record<OgcGeometryType, string>` in `DrawControls.view.tsx`: `Point: 'điểm'`, `MultiLineString: 'đường'`, `MultiPolygon: 'vùng'`.
- The role column and the role `<option>`s show `ROLE_LABELS`; the editor option reads `Biên tập viên (chỉ xem)`. Dates use `toLocaleDateString('vi-VN')`. The active/locked badge is ink: filled for `Đang hoạt động`, outline for `Đã khoá`.
- `.admin-users-route` and `.print-route` become pages over the map: `position: absolute; top: var(--topbar-height); left: 0; right: 0; bottom: 0; background: var(--paper); z-index: 90`, so the top bar stays on screen (spec, Screens). `.print-controls` is a `.float`; its inputs use `.field`/`.input` and its three buttons are `Button`s. The `@media print` block and every `.print-sheet` rule stay as they are (D19). `.user-table` gets rule-coloured row lines and a 2px ink header line; add the missing rules for `.user-mgmt*` and `.user-form*`, which today fall back to browser defaults.
- Server-supplied messages passed through as `e.message` are out of scope here; they belong to the API.

- [ ] **Step 1: Write the failing test** `src/test/copy.test.ts`. It walks `src/**/*.{ts,tsx}` excluding `*.test.*` and `src/test/`, and fails listing file and string for any of these exact substrings between quotes or JSX tags:

```ts
const FORBIDDEN = ['Admin login', 'Log in', 'Logging in', 'Log out', 'Manage users', 'Cancel', 'Confirm', 'Working…',
  'Close', 'Menu', 'Save feature', 'Saving…', 'Delete feature', 'Edit existing', 'Exit edit', 'Add a feature',
  'Select a layer', 'Drawing…', 'New user', 'Edit user', 'Full name', 'Loading users', 'Back to map', 'Deactivate',
  'Activate', 'Inactive', 'Something went wrong', 'Invalid email or password', 'Cannot reach the server',
  'Too many attempts', 'Email already in use', 'You do not have permission', "Couldn't load users",
  'Could not delete', 'Please try again', 'This cannot be undone'];
// Match as JSX text (>…<) or as a whole string literal ('…' or "…" or `…`), so identifiers like onCancel or `closeMenu` never match.
```

Then update the affected view and presenter tests to the new strings, and add:

```tsx
it('asks before deleting with a red Xoá and says it cannot be recovered', …);   // feature-editing/index.test.tsx
it('shows roles and dates in Vietnamese', …);                                   // UserTable.view.test.tsx
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/test/copy.test.ts`. Expected: FAIL with the list of remaining strings.
- [ ] **Step 3: Implement** the table.
- [ ] **Step 4: Run** the whole web suite and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): chữ tiếng Việt và thành phần dùng chung cho biên tập, người dùng và trang in`.

---

### Task 11: Remove the legacy styles and prove the layout in a browser

**Files:**
- Create: `apps/web/scripts/verify-shell.mjs`
- Modify: `shared/ui/tokens.css`, `styles/main.css`, `src/test/stylesheet.test.ts`, every `.tsx` Grep finds with `glass-panel` or `text-blue-500`, `apps/web/scripts/README.md`, `apps/web/package.json` (script `"verify:shell": "node scripts/verify-shell.mjs"`)

**Interfaces:**
- Consumes: the DOM of Task 4 and the class names `.tool-group`, `.tool-menu`, `.scale-slider`, `.scale-readout`, `.toast-host`, `.side-panel`, `.assistant-dock`, `.top-bar`, plus OpenLayers' `.map-scaleline` and `.map-mouseposition`.

- [ ] **Step 1: Extend `stylesheet.test.ts` with the failing contract.** For `main.css`, `shell.css` and `ui.css` together, with the rules whose selector starts `.print-sheet`, `.print-content`, `.print-title`, `.print-map`, `.print-north`, `.print-meta`, `.print-body`, `.print-legend`, `.print-analysis`, `.print-rows`, `.print-attribution`, `.print-A` and the `@media print` block cut out first (the printed sheet is D19):

```ts
it('uses none of the old names', () => {
  expect(css).not.toMatch(/--(primary|accent|danger|chrome-|text-main|text-muted|surface|border|bg-panel|glass-shadow|elev-|radius-sm|radius-md|rail-width|flyout-width|color-primary)/);
  expect(css).not.toMatch(/glass-panel|backdrop-filter/);
  expect(read('../shared/ui/tokens.css')).not.toMatch(/Legacy aliases/);
});
it('has no blue, teal or second green', () => {
  expect(css).not.toMatch(/#(3b82f6|2563eb|93c5fd|1e3a8a|0f766e|15803d|166534|38bdf8)/i);
  expect(css).not.toMatch(/rgba\(56, 189, 248|rgba\(31, 38, 135/);
});
it('every corner is square, 3px, or round', () => {
  for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(['0', '3px', 'var(--radius)', '50%', '999px']).toContain(v.trim());
});
it('every type size is on the scale', () => {
  for (const [, v] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(v.trim()).toMatch(/^(var\(--text-(xs|sm|md|lg|xl)\)|inherit)$/);
});
it('no component still asks for a glass panel', () => { /* walk src/**/*.tsx: no 'glass-panel', no 'text-blue-500' */ });
```

- [ ] **Step 2: Run** — `npm run test -w @webatlas/web -- src/test/stylesheet.test.ts`. Expected: FAIL.

- [ ] **Step 3: Sweep.** Delete the alias block from `tokens.css` and `.glass-panel` from `main.css`, then rewrite every remaining reference by this mapping:

| Old | New |
|---|---|
| `--text-main` · `--text-muted` | `--ink` · `--ink-2` |
| `--border`, `--border-strong`, `--border-color`, greys `#e5e7eb #d1d5db #9ca3af` | `--rule` |
| `--surface`, `--bg-panel`, `#fff` | `--sheet` |
| `--surface-raised`, `--surface-sunken`, `#f3f4f6` | `--paper` |
| `--primary`, `--primary-hover`, `--accent`, `--color-primary`, `#374151`, `#111827` | `--ink` |
| text greys `#6b7280 #4b5563` | `--ink-2` |
| `--danger`, `#b91c1c #c0392b #ef4444 #dc2626` used for an error or a destructive button | `--alert` |
| `#fee2e2 #fef2f2` behind an error | `--alert-soft` |
| `--radius-sm`, `--radius-md`, any radius of 4 to 12 px | `--radius` |
| `--glass-shadow`, `--elev-*`, any `box-shadow` that is not the focus ring or the slider thumb | deleted; the element gets `1px solid var(--ink)` if it floats |
| font sizes `10px 11px 12px` · `13px` · `14px 15px` · `16px` · `20px` | `--text-xs` · `--text-sm` · `--text-md` · `--text-lg` · `--text-xl` |

  The assistant's amber "kiến thức chung" block (`.assistant-knowledge*`), the amber changed-field mark (`.proposal-*`) and the assistant's send button become ink: 1px ink outline, 3px ink left border, paper ground, label in ink-2. Colours that encode data stay: `.risk-*`, `.status-safe/-warning/-danger`, `.text-red-500/-amber-500/-emerald-500`, and legend swatches. In `DynamicPopup.tsx` remove `glass-panel` (give `.dynamic-popup` and `.dam-details-modal` the `.float` class) and `text-blue-500` (the icons inherit ink-2); nothing else in that file changes — the feature card is sub-project 3.

- [ ] **Step 4: Run** the whole web suite, `npm run build:web` and `npm run lint:web`. Expected: PASS, build clean.

- [ ] **Step 5: Write `apps/web/scripts/verify-shell.mjs`** (puppeteer-core, system Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` or `CHROME_PATH`, `headless: 'new'`, `--no-sandbox`; base URL `http://localhost:5173` or `BASE_URL`). It loads `/`, waits until no request matching `/gwc|wmts|tile|arcgis|google/` has been in flight for 4 s, runs each check, prints one `PASS`/`FAIL`/`SKIPPED` line per check, saves a screenshot per viewport to `--out` (default: the OS temp directory), and exits non-zero on any `FAIL`. Checks, at 1440×900 and at 768×900:
  1. **Nothing covers the scale bar or the readout:** for `.map-scaleline` and `.map-mouseposition`, `document.elementFromPoint` at the centre and at each corner inset by 2 px is the element or its descendant; and its rectangle intersects none of `.tool-group`, `.tool-menu:not([hidden])`, `.scale-slider`, `.scale-readout`, `.toast-host > *`. Run once with no menu open and once with `Vùng phân tích` open.
  2. **The page does not scroll sideways:** `document.documentElement.scrollWidth <= innerWidth`, and `.top-bar` has `scrollWidth <= clientWidth`.
  3. **Controls sit inside the map stage:** the rectangles of `.tool-group`, `.scale-slider` and `.scale-readout` lie within `.map-stage`.
  4. **The face loaded:** after `document.fonts.ready`, some `FontFace` with family `Archivo` has status `loaded`, and `getComputedStyle(document.body).fontFamily` starts with `Archivo`.
  5. **Signed in** (needs `VERIFY_EMAIL` and `VERIFY_PASSWORD`; `SKIPPED`, never `PASS`, without them): sign in through the dialog; open `Trợ lý`. At 1440: `.side-panel` is 348 px wide, `.assistant-dock` is 360 px wide, their rectangles do not intersect, and `.map-stage` is at least 600 px wide. At 768: `.assistant-dock` does not intersect `.side-panel`, and check 2 still holds (Review Focus 5 — use an account whose email is at least 40 characters).
  6. **The map survives navigation:** the `.map-container canvas` element is the same node before and after going to `/print` and back.

- [ ] **Step 6: Run it.** Start the stack (`docker compose up -d`, the API, `npm run dev:web`). Create the long-email account from `apps/api/` with `npx tsx -e "…usersRepository(getPool()).insert({ email, password_hash: await hashPassword(pw), full_name: 'Kiểm thử', role: 'admin' })"`, then `VERIFY_EMAIL=… VERIFY_PASSWORD=… npm run verify:shell -w @webatlas/web`. Expected: every line `PASS`, exit 0. Read both screenshots. Fix what fails in the task that owns the element and re-run until clean.

- [ ] **Step 7: Document** the script in `apps/web/scripts/README.md` (what it proves, the environment variables, that `SKIPPED` is not a pass).

- [ ] **Step 8: Commit** — `refactor(web): bỏ kiểu kính mờ, màu xanh dương và token cũ; thêm kịch bản kiểm chứng bố cục trên trình duyệt`.

---

## Coverage Against the Spec

| Spec item (sub-project 1) | Task |
|---|---|
| Tokens, colours, form rules | 1, 11 |
| Typefaces | 1 (Archivo); Newsreader deferred, Decision 8 |
| Top bar: wordmark, navigation, search, Trợ lý, Đăng nhập | 7 |
| Panel frame; rail and flyout removed; legend readable while toggling layers | 4 |
| Tool group with text labels; bottom toolbar, WMS button and hint strip removed | 6 |
| Scale slider (D4) | 5 |
| Shared state components: messages, popups, fields, dialogs | 2, 3 |
| States: field error, form error, submitting | 2, 8 |
| States: search finds nothing, search fails | 9 |
| States: succeeded, failed, popup with an action (used by sub-project 2 for Hoàn tác) | 3, 6 |
| State: connection lost | 4 |
| States: tool cannot run yet, analysis finds nothing | 6 |
| States: reversible and irreversible confirmation | 3, 10 |
| Input behaviour | 2, 3, 8 |
| Vietnamese strings | 7, 8, 10 |
| Sign-in | 8 |
| Layout proved in a browser; `build:web` before completion | 11 |
| States owned by later sub-projects (chuyên đề rows, nothing switched on, fill replaced, import checks, assistant not signed in, sample data) | not here: 2, 3, 5 |
