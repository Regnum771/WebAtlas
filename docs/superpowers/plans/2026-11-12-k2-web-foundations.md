# K2 — WebATLAS Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tailwind v4 and shadcn/Radix become the foundation of `apps/web`. The six shared primitives are rebuilt on it behind their current exports, and every legacy screen looks exactly as it does today.

**Architecture:**
- One CSS entry, `src/styles/app.css`, declares the cascade layers `theme, base, legacy, components, utilities`.
  - Tailwind's preflight sits in `base`.
  - All existing CSS (`ol/ol.css`, `index.css`, `main.css` with its imports, and the feature stylesheets) is imported into `legacy`. Legacy beats preflight, and Tailwind utilities beat legacy.
- A `legacy-compat.css` restores the browser defaults that preflight would take from legacy markup. It is scoped away from `[data-slot]` subtrees, which is where the new primitives live.
- Tailwind scans only `src/shared/ui`, so class names in legacy markup never turn into utilities.
- A browser script records the computed styles of every legacy element before Tailwind lands. After each task, the same pages must match that baseline.

**Tech Stack:** tailwindcss + @tailwindcss/vite 4.3.5, shadcn CLI 4.23.0 (components only, no `init`), radix-ui 1.8.1, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, sonner 2.0.8, Vite 8.1, React 19, vitest 3, puppeteer-core (already present).

**Spec:** `docs/superpowers/specs/2026-11-11-platform-reskin-design.md` (R4, R9, "Visual system → Rules", "How it fits the code → WebATLAS foundations", K2 row). The theme package from K1 is `packages/theme`; it exports `@webatlas/theme/tailwind-theme.css` and `@webatlas/theme/tokens.css`.

## Global Constraints

- **Export names and props stay:** `Button`, `Dialog`, `ConfirmDialog`, `TextField`, `Spinner`, `ToastHost`. The `toast.store` exports stay too: `showToast`, `dismissToast`, `useToasts`, `getToasts`, `isSticky`, `resetToasts`, `TOAST_AUTO_CLOSE_MS`, `MAX_TOASTS` and the types. The only importers that change are `features/auth/index.tsx`, `widgets/top-bar/ui/TopBar.view.tsx` and `features/feature-editing/ui/AttributeField.view.tsx`.
- **No visible change to any legacy element.** The legacy style comparison (Task 1) reports 0 differences after every task.
- **Corners:** 3 px (`rounded-sm`) on tags and kbd, 4 px (`rounded-md`) on buttons and inputs, 6 px (`rounded-lg`) on dialogs. No pill shapes. Borders are 1 px. A shadow (`shadow-pop`) goes only on things that float: dialogs and toasts.
- **Density:** body text 13 px (`text-body`), dialog title 14 px (`text-panel`). Buttons are 32 px (`h-control`) at `md` and 28 px (`h-control-sm`) at `sm`. Inputs are 32 px.
- **Focus (R9):** one global `:focus-visible` rule, `outline: 2px solid var(--color-mark); outline-offset: 0; box-shadow: 0 0 0 3px var(--color-ink)`. From the element outwards that gives a 2 px yellow ring, then 1 px of ink. No primitive sets its own focus style.
- UI copy stays exactly as it is ("Huỷ", "Đóng thông báo", and so on).
- Supported viewport: 768 px and wider.
- Comments in code are English. Commit messages are Vietnamese Conventional Commits, ending with the `Co-Authored-By` line.
- **Never run a recursive delete on this machine** (no `rm -r`, no `Remove-Item -Recurse`). When a step removes a file, delete that one file by name.

## Decisions This Plan Makes Beyond the Spec

These need the user's confirmation when they review the plan.

1. **Layer order `theme, base, legacy, components, utilities`.** The spec says legacy CSS "loads in a layer that wins". It wins over preflight but not over utilities. If it won over utilities, legacy's `* { margin: 0; padding: 0 }` would cancel every padding utility.
2. **A compat sheet.** `legacy-compat.css` restores the browser defaults on legacy elements, not on `[data-slot]` subtrees. Its rules are whatever the baseline comparison shows is needed.
3. **Tailwind's default palette, fonts, radii, shadows and text sizes are cleared.** Only the theme package's tokens exist (`--color-*: initial` and so on). The default spacing scale stays. shadcn's semantic colour names (`primary`, `border`, `ring`, …) become aliases of the tokens in `app.css`, so later `shadcn add` output works without edits.
4. **Tailwind scans `src/shared/ui` only** (`source(none)` plus `@source`). Each later sub-project adds the folders it converts.
5. **No `shadcn init`.** It would rewrite the CSS entry with its own tokens. `components.json` is written by hand, and the CLI's `add` fetches the components into `src/shared/ui/shadcn/`. That is a subfolder because `button.tsx` and `Button.tsx` would collide on Windows' case-insensitive file system. An `@/` path alias (to `src/`) is added because the CLI needs one; hand-written code keeps relative imports.
6. **ConfirmDialog moves to AlertDialog.** A click outside no longer cancels it. Escape and Huỷ still do.
7. **The toast store keeps its policy:** dedupe, the limit of 3, sticky errors and warnings, the 6 s timer. Sonner only renders and animates: each toast is `toast.custom` with `duration: Infinity`, and dismissing a toast in Sonner calls `dismissToast`.
8. **Two primitive API additions.** `Button` gets `variant="inverse"` for the green bar; the `.btn.on-green` rules go. `TextField` gets `after?: ReactNode`, rendered outside the input's box; it is used for units, and the two `.edit-attr-form .input-wrap` rules go.
9. **Inputs keep a dark border** (`border-ink-2`, 6.9:1), not `line`, because WCAG 1.4.11 asks for 3:1 on input boundaries. Outline buttons use `border-line`; their text identifies them.
10. **Deferred to K3, where they are first used:** the Popover, DropdownMenu, Tabs, Tooltip, Checkbox, Select and Slider components, cmdk, Vaul, NumberFlow, and loading JetBrains Mono and Newsreader. The spec's four new `verify:shell` checks (status bar, time row, dock, `Ctrl K`) test K3/K4 screens and go with them.

## Review Focus

1. **A new stylesheet imported from a component would be unlayered,** and would beat every layer, utilities included. → Task 2's cascade test fails if any `.ts`/`.tsx` file other than `main.tsx` imports CSS.
2. **`cn()` dropping a class because tailwind-merge doesn't know the custom scales.** For example, `cn('text-ink', 'text-body')` would lose the colour. → Task 3's `cn` tests.
3. **The same CSS variable name defined by legacy `tokens.css` and by the theme with a different value.** The legacy layer would silently win. → Task 2's collision test.
4. **Escape in a dialog reaching a menu or popup behind it,** or closing more than the topmost dialog, after the move to Radix. → The existing `Dialog.test.tsx` cases stay unchanged and must pass (Task 4).
5. **A toast that the user closes in Sonner (swipe or close button) staying in the store,** and coming back on the next sync. → Task 6's test "a toast dismissed inside Sonner leaves the store".

Accepted, not tested: while a Radix dialog is open, Radix hides everything else from assistive technology, including the toast band. Today no toast is raised while a dialog stays open.

---

### Task 1: Legacy style baseline

**Files:**
- Create: `apps/web/scripts/legacy-styles.mjs` (pure snapshot and diff functions), `apps/web/scripts/legacy-styles.test.mjs`, `apps/web/scripts/verify-legacy-styles.mjs` (browser runner)
- Modify: `apps/web/package.json` (script `verify:legacy-styles`); the current `Button.tsx`, `TextField.tsx`, `Spinner.tsx`, `Dialog.tsx` and `ToastHost.tsx` (add `data-slot` only)
- Modify: `apps/web/scripts/README.md` (one entry)

**Interfaces:**
- Produces: `data-slot` values on primitive roots, kept by every later task: `button`, `text-field`, `spinner`, `dialog-overlay`, `dialog-content`, `toast`. Also `diffSnapshots(before: Snapshot, after: Snapshot): string[]`, where `Snapshot = Record<string, Record<string, string>>` (element key → property → computed value).

- [ ] **Step 1: Write the failing tests** in `legacy-styles.test.mjs`:
  - `diffSnapshots` returns `[]` for equal snapshots.
  - It returns `'<key>: color rgb(0, 0, 0) → rgb(1, 1, 1)'` for a changed property.
  - It returns `'missing: <key>'` and `'added: <key>'` for keys present on one side only.
  - `elementKey` gives the second of two identical `div.row` siblings under `body > main` the key `body>main>div.row#2`. Classes are sorted, and the key ignores text.
- [ ] **Step 2:** Run `npm run test -w @webatlas/web -- scripts/legacy-styles.test.mjs`. Expect FAIL (module not found).
- [ ] **Step 3:** Implement `diffSnapshots` and `elementKey(path: string[], seen: Map<string, number>): string` in `legacy-styles.mjs`. Also export `PROPERTIES`: display, position, box-sizing, margin and padding (4 sides each), border width/style/colour (4 sides each), color, background-color, font-family, font-size, font-weight, font-style, line-height, text-decoration-line, list-style-type, vertical-align, max-width, cursor, appearance.
- [ ] **Step 4:** Run the test. Expect PASS.
- [ ] **Step 5:** Write `verify-legacy-styles.mjs`, modelled on `verify-shell.mjs` (same `CHROME_PATH`, `BASE_URL`, `VERIFY_EMAIL`/`VERIFY_PASSWORD`, login via `#login-email`, and the same tile-quiet settle). It runs at 1440×900 with `--save <file>` or `--compare <file>`.
  - Pages signed out: `/`, `/ban-do`, `/du-lieu`.
  - Pages signed in: `/ban-do`, `/ho-so`, `/quan-ly/nhom-quyen`, `/quan-ly/tu-dien`.
  - It walks `body` in document order and skips every `[data-slot]` element and its subtree, and the `.toast-host` subtree.
  - Without credentials, the signed-in pages print SKIPPED. Exit 1 on any difference, printing at most 50 lines.
- [ ] **Step 6:** Add `data-slot` attributes to the five current primitives. Run `npm run test:web`. Expect all 1516 to pass.
- [ ] **Step 7: Capture the baseline.** With the Docker stack, the API and `npm run dev:web` running, run `npm run verify:legacy-styles -w @webatlas/web -- --save ../../.superpowers/k2-legacy-baseline.json`. Then run `--compare` against the same file. Expect `0 differences` and exit 0. That proves the snapshot is deterministic; if it isn't, extend the settle wait until it is.
- [ ] **Step 8: Commit.** `test(web): ảnh chụp kiểu dáng phần cũ để chứng minh K2 không đổi giao diện`

### Task 2: Tailwind and the cascade layers

**Files:**
- Create: `apps/web/src/styles/app.css`, `apps/web/src/styles/legacy-compat.css`, `apps/web/src/test/cascade.test.ts`
- Modify: `apps/web/package.json` (deps `tailwindcss`, `@tailwindcss/vite`, `"@webatlas/theme": "*"`), `apps/web/vite.config.ts` (add `tailwindcss()` before `react()`), `apps/web/src/main.tsx` (import `./styles/app.css` only)
- Modify (remove their CSS imports): `src/app/App.tsx:10`, `src/features/map/ui/MapView.tsx:2`, `src/features/catalogue/index.tsx:11`, `src/features/flood-scenario/index.tsx:15`, `src/features/time-slider/index.tsx:5`
- Modify: `src/shared/ui/ui.css` (delete the `:focus-visible` rule; it moves to `app.css`)

**Interfaces:**
- Produces: `app.css` is the only stylesheet entry. Later tasks add rules only in `@layer components`, or as utilities in TSX.

`app.css`, in this order:
1. `@layer theme, base, legacy, components, utilities;`
2. Tailwind's three files: `tailwindcss/theme.css` in `layer(theme)`, `tailwindcss/preflight.css` in `layer(base)`, and `tailwindcss/utilities.css` in `layer(utilities) source(none)`.
3. `@source "../shared/ui";`
4. An `@theme` block clearing `--color-*`, `--font-*`, `--radius-*`, `--shadow-*` and `--text-*` (each set to `initial`).
5. `@import "@webatlas/theme/tailwind-theme.css";`
6. `@theme inline` aliases: `--default-font-family: var(--font-ui)`; background and popover → surface; foreground and popover-foreground → ink; primary → brand; primary-foreground → surface; secondary and muted → surface-2; muted-foreground → ink-2; accent → brand-tint; accent-foreground → brand; destructive → alert; border → line; input → ink-2; ring → mark.
7. `@layer base { :focus-visible { … R9 … } }`.
8. Each legacy file imported with `layer(legacy)`, in today's load order: `ol/ol.css`, `../index.css`, `./main.css`, the three feature stylesheets, then `./legacy-compat.css` last.

- [ ] **Step 1: Write the failing tests** in `cascade.test.ts`:
  - `app.css`'s first statement is exactly `@layer theme, base, legacy, components, utilities;`.
  - Each of `ol/ol.css`, `../index.css`, `./main.css`, `../features/catalogue/ui/catalogue.css`, `../features/flood-scenario/ui/flood.css`, `../features/time-slider/ui/time-slider.css` and `./legacy-compat.css` is imported with `layer(legacy)`.
  - No `.ts`/`.tsx` file under `src` except `main.tsx` contains an import ending in `.css`, and `main.tsx` imports only `./styles/app.css` (Review Focus 1).
  - Every custom property defined in `src/shared/ui/tokens.css` that `packages/theme/generated/tailwind-theme.css` also defines has the same value (Review Focus 3).
  - `app.css` contains the R9 rule's three declarations.
- [ ] **Step 2:** Run `npm run test -w @webatlas/web -- src/test/cascade.test.ts`. Expect FAIL.
- [ ] **Step 3:** Install the deps, then write `app.css`, the `vite.config.ts` change and the import moves as specified above. `legacy-compat.css` starts empty.
- [ ] **Step 4:** Run the cascade test, then `npm run test:web`, `npm run build:web` and `npm run lint:web`. Expect all to pass.
- [ ] **Step 5: Fill the compat sheet.** Run `verify:legacy-styles -- --compare` against the baseline. For each reported difference, add a rule to `legacy-compat.css` that restores the browser value with `revert`. Rerun until it reports 0.
  - Each rule's selector has the form `:where(<elements>):not([data-slot], [data-slot] *)`.
  - Expected candidates: `a` (color, text-decoration); `h1`–`h6` (font-size, font-weight); `svg`, `img`, `canvas` and `video` (display, vertical-align); `img` (max-width, height); `ol`/`ul`/`menu` (list-style); `button`/`input`/`select`/`textarea` (background-color, border, border-radius, color, font).
  - Add only what the diff demands, with a one-line English comment per rule naming what it restores.
- [ ] **Step 6:** Run `npm run verify:shell -w @webatlas/web` (with credentials). Expect no FAIL.
- [ ] **Step 7: Commit.** `feat(web): Tailwind v4 với các lớp cascade; CSS cũ nằm trong lớp legacy`

### Task 3: shadcn setup, `cn`, Button and Spinner

**Files:**
- Create: `apps/web/components.json`, `apps/web/src/shared/lib/utils.ts`, `apps/web/src/shared/lib/utils.test.ts`, `apps/web/src/shared/ui/shadcn/button.tsx` (via the CLI), `apps/web/src/shared/ui/shadcn.test.ts`
- Modify: `apps/web/tsconfig.json` and `tsconfig.app.json` (`baseUrl`, `"paths": { "@/*": ["./src/*"] }`), `vite.config.ts` and `vitest.config.ts` (`resolve.alias` `@` → `src`), `package.json` (deps `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`)
- Modify: `src/shared/ui/Button.tsx`, `Spinner.tsx`, `Button.test.tsx`, `Spinner.test.tsx`; `src/features/auth/index.tsx:23` and `src/widgets/top-bar/ui/TopBar.view.tsx:43` (`className="on-green"` → `variant="inverse"`); `src/styles/shell.css:572-582` (delete the `.btn.on-green` rules); `src/features/my-maps/ui/MapCard.view.test.tsx` (assert roles/`data-variant`, not `.btn`)
- Modify: `src/shared/ui/ui.css` (delete `.spin`, its keyframes and its reduced-motion rule; `.btn` stays for raw legacy buttons)

**Interfaces:**
- Produces:
  - `cn(...inputs: ClassValue[]): string` in `src/shared/lib/utils.ts`.
  - `ButtonProps.variant: 'outline' | 'solid' | 'quiet' | 'danger' | 'inverse'`.
  - Button renders `data-slot="button"`, `data-variant={variant}` and `data-size={size}`.
  - Spinner renders `data-slot="spinner"`.

`components.json`: `"style": "new-york"`, `"rsc": false`, `"tsx": true`, `"tailwind": { "config": "", "css": "src/styles/app.css", "baseColor": "neutral", "cssVariables": true }`, `"iconLibrary": "lucide"`, aliases `components` `@/shared/ui`, `ui` `@/shared/ui/shadcn`, `utils` `@/shared/lib/utils`, `lib` `@/shared/lib`, `hooks` `@/shared/lib/hooks`.

- [ ] **Step 1: Write the failing tests.**
  - `utils.test.ts` (Review Focus 2):
    - `cn('text-ink', 'text-body')` keeps both.
    - `cn('h-control', 'h-control-sm')` gives `h-control-sm`.
    - `cn('rounded-md', 'rounded-lg')` gives `rounded-lg`.
    - `cn('bg-brand', 'bg-alert')` gives `bg-alert`.
    - `cn('shadow-pop', 'border-line')` keeps both.
  - `shadcn.test.ts`: no file in `src/shared/ui/shadcn/` contains `focus-visible:`, `outline-none` or `ring-`.
  - `Button.test.tsx`, added to the existing 4 cases:
    - `variant="danger"` gives `data-variant="danger"`.
    - `variant="inverse"` with `aria-pressed="true"` renders and stays pressable.
    - The default variant is `outline`, and the default size is `md`.
  - `Spinner.test.tsx`: the existing 2 cases, unchanged.
- [ ] **Step 2:** Run those files with `npm run test -w @webatlas/web -- <paths>`. Expect FAIL.
- [ ] **Step 3: Set up and fetch.** Add the alias, deps and `components.json`, then run `npx shadcn@4.23.0 add button --yes` in `apps/web`.
  - If the CLI edits `app.css` or `package.json` beyond the button's deps, restore those edits by hand.
  - If it refuses to work without `init`, take the component source from `https://ui.shadcn.com/r/styles/new-york-v4/button.json` instead.
  - Strip the component's focus/ring/outline classes.
- [ ] **Step 4:** Implement `cn` with `extendTailwindMerge`. Teach it the theme's scales: `text` (label, body, num, panel, page); `radius` (sm, md, lg); `shadow` (pop); `spacing` (row, group-row, control-sm, control, header, gap). Colours need no config.
- [ ] **Step 5: Rebuild `Button`** on the shadcn button's cva. Keep today's busy logic, `type="button"` default and `busyLabel`.
  - Variants:
    - `outline`: `bg-surface text-ink border-line hover:bg-surface-2`.
    - `solid`: `bg-brand text-surface border-brand`.
    - `quiet`: `border-transparent bg-transparent hover:bg-surface-2`.
    - `danger`: `bg-alert text-surface border-alert`.
    - `inverse`: `bg-transparent text-surface border-surface aria-pressed:bg-surface aria-pressed:text-brand`.
  - Busy (`aria-disabled`) and disabled: `bg-surface-2 text-ink-2 border-line cursor-default`.
  - Base: `inline-flex items-center justify-center gap-2 rounded-md border font-semibold text-body whitespace-nowrap`.
  - Sizes: `md` `h-control px-3`, `sm` `h-control-sm px-2.5`.
- [ ] **Step 6: Rebuild `Spinner`** with utilities: `inline-block size-3.5 rounded-full border-2 border-line border-t-ink animate-spin motion-reduce:animate-none`. The current markup otherwise stays, including the `visually-hidden` label.
- [ ] **Step 7:** Run the tests from Step 1, then `npm run test:web`, `build:web` and `lint:web`, then `verify:legacy-styles -- --compare`. Expect all green, and 0 differences.
- [ ] **Step 8: Commit.** `feat(web): shadcn và cn; Button, Spinner dựng lại trên Tailwind, giữ nguyên tên xuất`

### Task 4: Dialog and ConfirmDialog on Radix

**Files:**
- Create (via `npx shadcn@4.23.0 add dialog alert-dialog --yes`): `src/shared/ui/shadcn/dialog.tsx`, `src/shared/ui/shadcn/alert-dialog.tsx`
- Modify: `src/shared/ui/Dialog.tsx`, `ConfirmDialog.tsx`, `ConfirmDialog.test.tsx`; `src/features/feature-editing/index.test.tsx` (class-name assertions → roles/text)
- Modify: `src/shared/ui/ui.css` (delete `.dialog-backdrop`, `.dialog` and `.dialog-title`; keep `.dialog-message` and `.dialog-actions`, which callers use directly)
- Modify (`.dialog` → `:is([role="dialog"],[role="alertdialog"])`): `scripts/verify-shell.mjs:386`, `verify-permissions.mjs`, `verify-catalogue.mjs`, `verify-dictionary.mjs`, `verify-personal-maps.mjs`

**Interfaces:**
- Consumes: `Button` (Task 3), `cn`.
- Produces: the same `DialogProps` and `ConfirmDialogProps`. The overlay has `data-slot="dialog-overlay"` and the content `data-slot="dialog-content"`.

- [ ] **Step 1: Write the failing tests.**
  - `ConfirmDialog.test.tsx`:
    - The irreversible confirm button has `data-variant="danger"`; a reversible one has `data-variant="solid"`.
    - The dialog has role `alertdialog`.
    - A pointer-down outside the content does not call `onCancel`.
    - Escape calls `onCancel`.
  - `Dialog.test.tsx` stays unchanged: all 6 cases must pass on the new implementation (Review Focus 4).
- [ ] **Step 2:** Run both files. Expect the new ConfirmDialog cases to FAIL.
- [ ] **Step 3: Rebuild `Dialog`** on the Radix Dialog: `open` controlled, `onOpenChange(false)` → `onClose`, the title as `DialogTitle`, `aria-describedby={undefined}`.
  - In `onEscapeKeyDown`, call `event.stopImmediatePropagation()`. Radix listens in the capture phase on `document`, so this keeps Escape from reaching listeners behind the dialog.
  - Overlay: `fixed inset-0 z-[200] bg-ink/40`.
  - Content: `fixed z-[200]`, centred, `min-w-80 max-w-[90vw] max-h-[90vh] overflow-auto p-4 bg-surface text-ink border border-line rounded-lg shadow-pop`.
  - Title: `text-panel font-semibold mb-2`.
  - Drop the hand-written `openDialogs` stack and focus code; Radix layers do both.
- [ ] **Step 4: Rebuild `ConfirmDialog`** on the Radix AlertDialog with the same look and props. Huỷ comes first in the DOM and is the `AlertDialogCancel`. The confirm button is a `Button`, so `busy` still swallows presses.
- [ ] **Step 5:** Run `npm run test:web`, `build:web` and `lint:web`, then `verify:legacy-styles -- --compare`, then `verify:permissions` and `verify:dictionary` (credentials and stack). Expect all green, and 0 differences.
- [ ] **Step 6: Commit.** `feat(web): Dialog và ConfirmDialog trên Radix; kịch bản kiểm tra tìm hộp thoại theo vai trò`

### Task 5: TextField on shadcn Input and Label

**Files:**
- Create (via `npx shadcn@4.23.0 add input label --yes`): `src/shared/ui/shadcn/input.tsx`, `src/shared/ui/shadcn/label.tsx`
- Modify: `src/shared/ui/TextField.tsx`, `TextField.test.tsx`; `src/features/feature-editing/ui/AttributeField.view.tsx:67` (`trailing` → `after`); `src/styles/main.css:597-598` (delete the two `.edit-attr-form .input-wrap` rules)

**Interfaces:**
- Produces: `TextFieldProps.after?: ReactNode`. It is rendered after the input's box, on the same row. The root has `data-slot="text-field"`. `trailing` keeps its meaning: inside the box, at the right.

- [ ] **Step 1: Write the failing tests** in `TextField.test.tsx`:
  - With `after={<span id="u">m</span>}` and `aria-describedby="u"`, the input is described by `u` together with the hint.
  - The `after` node is not inside the input's wrapper (`input.parentElement` does not contain it).
  - `aria-invalid` is set when `error` is given.
- [ ] **Step 2:** Run the file. Expect FAIL on the `after` cases.
- [ ] **Step 3: Rebuild `TextField`** keeping the current ids, `aria-describedby` joining and `forwardRef`.
  - Label: `font-semibold`.
  - Input: `h-control w-full rounded-md border border-ink-2 bg-surface px-3 text-panel text-ink aria-invalid:border-2 aria-invalid:border-alert`.
  - `trailing`: absolutely positioned at `right-1` inside a relative wrapper, with the input getting `pr-10`.
  - `after`: a flex sibling with `ml-2 text-ink-2`.
  - Error: `text-alert font-semibold text-label`, with the icon. Hint: `text-ink-2 text-label`.
- [ ] **Step 4:** Move `AttributeField` to `after`, then delete `main.css:597-598`.
- [ ] **Step 5:** Run `npm run test:web`, `build:web` and `lint:web`, then `verify:legacy-styles -- --compare`. Expect all green, and 0 differences.
- [ ] **Step 6: Commit.** `feat(web): TextField trên Input/Label của shadcn, thêm vị trí after cho đơn vị`

### Task 6: Toasts on Sonner

**Files:**
- Modify: `apps/web/package.json` (dep `sonner`), `src/shared/ui/ToastHost.tsx`, `ToastHost.test.tsx`; `src/shared/ui/ui.css` (delete the `.toast` rules); `scripts/verify-shell.mjs:474-480` (`.toast-host > .toast.bad` → `.toast-host [data-slot="toast"][role="alert"]`, and `.toast-host > *` → `.toast-host [data-sonner-toast]`)
- Unchanged: `toast.store.ts`, `toast.store.test.ts`

**Interfaces:**
- Consumes: `useToasts`, `dismissToast`, `isSticky`, `MAX_TOASTS` from `toast.store.ts`; `Button`.
- Produces: `ToastHost` still renders `<div className="toast-host" aria-live="polite">`, so `shell.css`, `flood.css` and `time-slider.css` keep placing the band.

- [ ] **Step 1: Write the failing tests** in `ToastHost.test.tsx`. The 6 existing cases stay, made async with `findBy*` where Sonner renders after a tick. Add:
  - "a toast dismissed inside Sonner leaves the store" (Review Focus 5): trigger the toast's `onDismiss` and expect `getToasts()` to be empty.
  - "a toast replaced in the store with a new action runs the new action".
  - "only MAX_TOASTS toasts render".
- [ ] **Step 2:** Run the file. Expect FAIL.
- [ ] **Step 3: Implement `ToastHost`.**
  - Render Sonner's `<Toaster theme="light" position="bottom-center" expand visibleToasts={MAX_TOASTS} gap={8} hotkey={[]} style={{ position: 'absolute', … }} />` inside the `.toast-host` div. Sonner's injected stylesheet is unlayered and sets `position: fixed; z-index: 999999999`, and only the inline `style` prop can beat it. Set `zIndex` to `auto` so toasts stay under dialogs.
  - A `useEffect` over `useToasts()`:
    - each new or changed toast → `toast.custom(() => <ToastItem toast={t} />, { id: t.id, duration: Infinity, onDismiss: () => dismissToast(t.id) })`;
    - each id no longer in the store → `sonnerToast.dismiss(id)`.
  - `ToastItem` keeps its roles, icons, buttons and the Escape handler. Its root gets `data-slot="toast"` and `flex items-center gap-3.5 rounded-lg border border-line bg-surface text-ink shadow-pop px-3.5 py-2 text-body`.
    - An error adds `border-2 border-alert` and an alert-coloured icon.
    - A warning adds `border-notice-line`.
    - A success icon is `text-ok`.
  - If jsdom lacks `matchMedia` for Sonner, add a stub to `src/test/setup.ts`.
- [ ] **Step 4:** Run `npm run test:web`, `build:web` and `lint:web`, then `verify:legacy-styles -- --compare` and `verify:shell`. Expect all green, 0 differences, and the toast check PASS at both widths.
- [ ] **Step 5: Commit.** `feat(web): thông báo hiển thị bằng Sonner, chính sách vẫn nằm ở toast.store`

### Task 7: Browser proof and ledger close

**Files:**
- Modify: `apps/web/scripts/README.md` (note the K2 selector changes), and the ledger under `.superpowers/sdd/` if subagent-driven

- [ ] **Step 1:** With the stack up and credentials set, run in order: `verify:legacy-styles -- --compare ../../.superpowers/k2-legacy-baseline.json`, `verify:shell`, `verify:permissions`, `verify:catalogue`, `verify:dictionary`, `verify:personal-maps`. Expect 0 differences, and no FAIL line in any script.
- [ ] **Step 2:** Run `npm run test:web`, `npm run test:shared`, `npm run test:theme`, `npm run build:web` and `npm run lint:web`. Expect all to pass. Record the test counts.
- [ ] **Step 3:** Take screenshots of a Button (each variant), a Dialog, a ConfirmDialog, a TextField with an error and with `after`, and each toast tone, at 1440 px. Save them to the scratchpad and compare them against artboard 1 (Tokens) on the direction canvas. Report anything off to the user; don't fix it silently.
- [ ] **Step 4: Commit** any README or ledger change: `docs(web): ghi chú K2 cho các kịch bản kiểm tra`.
