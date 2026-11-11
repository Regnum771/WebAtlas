# K1 — Theme Package and Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new workspace package `@webatlas/theme` that holds the platform's design tokens once, validates them, checks their text contrast, and generates the stylesheets other parts of the platform consume.

**Architecture:**
- `tokens.json` is the only source. A small TypeScript library loads and validates it and computes WCAG contrast.
- A registry of **targets** turns tokens into files under `packages/theme/generated/`, which are committed so consumers (the web app, and the Docker mounts in K6–K8) never need a build step.
- A freshness test fails whenever a generated file differs from what the generator would write now.

**Tech Stack:** Node 22, TypeScript ~6.0 (same tsconfig settings as `packages/shared`), vitest ^3, tsx ^4 for the CLI.

**Spec:** `docs/superpowers/specs/2026-11-11-platform-reskin-design.md` (sections "Visual system → Tokens", "How it fits the code → Theme package", sub-project K1).

## Global Constraints

- Every token value in the spec's token table is copied **exactly** (hex upper-case as written, e.g. `#14532D`).
- Radii: `sm` 3, `md` 4, `lg` 6 (px). Shadow `pop`: `0 4px 12px rgb(20 27 45 / 12%)`.
- Sizes (px): label text 11, body 13, numbers 12.5, panel title 14, page title 20; layer row 30, group row 32, control-sm 28, control 32, header 44, panel gap 8.
- Motion: `fast` 120 ms, `base` 200 ms.
- Fonts: UI `"Archivo", "Segoe UI", system-ui, sans-serif`; numbers `"JetBrains Mono", ui-monospace, monospace`; water names `"Newsreader", Georgia, serif`.
- Text contrast floor: 4.5:1 for every pair listed in `tokens.json → contrast`.
- Generated files are written with LF line endings and UTF-8. Comments in code are in English (user rule, 2026-10-04).
- Package name `@webatlas/theme`; root scripts `generate:theme`, `test:theme`. CI runs `test:theme`.

## Decisions This Plan Makes Beyond the Spec

These need the user's confirmation when they review the plan.

1. **Supporting colour tokens.** Badges, KPI cells and the simulation tag on the artboards need tokens the spec's table doesn't list:
   - `ok` `#1F7A45`
   - `brand-line` `#A9CDB4`
   - `alert-tint` `#FBEDEC`
   - `alert-ink` `#8E1E18`
   - `alert-line` `#E7B4B0`
   - `notice-tint` `#FFF8D6`
   - `notice-line` `#E0C34A`

   They are taken from the approved artboards.
2. **K1 generates only the web targets** (`tokens.css` and `tailwind-theme.css`) and the target registry. The GeoNode, Keycloak and Dagster emitters need each product's variable and selector names, which K6–K8 discover (K7 starts with a spike). Each of those sub-projects adds its target to the registry K1 builds.
3. **Naming.** CSS custom properties are `--wa-<group>-<name>` (for example `--wa-color-brand`, `--wa-radius-md`). The Tailwind file uses Tailwind v4 namespaces (`--color-brand`, `--radius-md`, `--font-ui`, `--text-body`, `--shadow-pop`) with literal values, so it works without `tokens.css` loaded.

## Review Focus

1. **A Windows checkout converts generated files to CRLF.** `core.autocrlf` is on here; the commit of the spec warned about it. The freshness test must still pass, so add `.gitattributes` `packages/theme/generated/** text eol=lf`, and have the test compare after normalising `\r\n` → `\n`. The test is in Task 4.
2. **A token is renamed but a contrast pair still names the old one.** Validation must fail and name the missing token. It must not crash, or silently skip the pair (Task 1).
3. **Someone hand-edits a generated file.** The freshness test fails with a message that names the file and says `npm run generate:theme` (Task 4).
4. **A colour written as `#FFF`, `rgb(...)` or lower-case.** Only 6-digit hex is accepted, and case is preserved exactly. Short hex and functional notation are rejected with the token's name (Task 1).
5. **A contrast pair just under 4.5** (for example `#777777` on white, 4.48). It fails, and is not rounded up to pass (Task 2).

---

### Task 1: Package scaffold, token source and validation

**Files:**
- Create: `packages/theme/package.json`, `packages/theme/tsconfig.json` (copy `packages/shared/tsconfig.json`)
- Create: `packages/theme/tokens.json`
- Create: `packages/theme/src/tokens.ts`
- Test: `packages/theme/src/tokens.test.ts`
- Modify: root `package.json` (scripts `generate:theme`, `test:theme`)

**Interfaces:**
- Produces:
  - `type Tokens = { color: Record<string, string>; colorDark: Record<string, string>; radius: Record<string, number>; shadow: Record<string, string>; font: Record<string, string>; text: Record<string, number>; size: Record<string, number>; motion: Record<string, number>; contrast: Array<[fg: string, bg: string]> }`
  - `validateTokens(raw: unknown): Tokens` throws `TokenError` (message names the offending key)
  - `loadTokens(path?: string): Tokens` (default: the package's `tokens.json`)

- [ ] **Step 1: Write `tokens.json`.** Use the spec table plus Decision 1. Keys:
  - `color`: `brand, brand-tint, brand-line, ink, ink-2, water, surface, surface-2, line, line-2, line-3, mark, alert, alert-tint, alert-ink, alert-line, ok, notice-tint, notice-line, series-1, series-2, alarm-1, alarm-2, alarm-3, depth-1..depth-4`.
  - `colorDark`: `series-1 #3F8FD0`, `series-2 #D9702F`.
  - `depth` values: `#C9C3EA, #9A8FD6, #6B5BB8, #3F2E8C`.
  - `contrast` pairs: `[ink,surface] [ink,surface-2] [ink-2,surface] [ink-2,surface-2] [surface,brand] [surface,alert] [water,surface] [brand,brand-tint] [alert-ink,alert-tint] [ink,notice-tint] [ink-2,brand-tint] [ink,mark]`.
  - Other groups, with these exact key names:
    - `radius`: `sm 3, md 4, lg 6`
    - `shadow`: `pop`
    - `font`: `ui, num, water`
    - `text`: `label 11, body 13, num 12.5, panel 14, page 20`
    - `size`: `row 30, group-row 32, control-sm 28, control 32, header 44, gap 8`
    - `motion`: `fast 120, base 200`

    Values are in Global Constraints.
- [ ] **Step 2: Write the failing tests** in `tokens.test.ts`:
  - `loads the committed tokens`: `loadTokens().color.brand === '#14532D'`, `radius.md === 4`, `size.header === 44`.
  - `rejects short hex`: `validateTokens` on a copy with `color.ink = '#FFF'` throws `/color\.ink/`.
  - `rejects functional colour`: `color.ink = 'rgb(0 0 0)'` throws `/color\.ink/`.
  - `keeps hex case`: a copy with `color.ink = '#aBcDeF'` round-trips unchanged.
  - `rejects a contrast pair naming a missing token`: pair `['ink','nope']` throws `/contrast.*nope/`.
  - `rejects a negative size`: `radius.md = -1` throws `/radius\.md/`.
- [ ] **Step 3: Run** `npm run test -w @webatlas/theme`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `validateTokens` and `loadTokens` in `src/tokens.ts`. Validate with plain checks: colour `/^#[0-9A-Fa-f]{6}$/`; numbers finite and ≥ 0; every contrast name present in `color`. No new dependency.
- [ ] **Step 5: Run the tests.** Expected: PASS (6 tests).
- [ ] **Step 6: Commit**: `git commit -m "feat(theme): gói @webatlas/theme với tokens.json và kiểm tra hợp lệ"`

### Task 2: Contrast check

**Files:**
- Create: `packages/theme/src/contrast.ts`
- Test: `packages/theme/src/contrast.test.ts`

**Interfaces:**
- Consumes: `Tokens`, `loadTokens` (Task 1)
- Produces:
  - `contrastRatio(fg: string, bg: string): number` (WCAG 2.x relative luminance, unrounded)
  - `contrastFailures(tokens: Tokens, floor = 4.5): Array<{ fg: string; bg: string; ratio: number }>`

- [ ] **Step 1: Write the failing tests:**
  - `black on white is 21`: `contrastRatio('#000000','#FFFFFF')` within 1e-9 of 21.
  - `#777777 on white is just under the floor`: ratio in [4.47, 4.49], and `contrastFailures` on a token set with the pair `['grey','surface']` and `grey: '#777777'` returns one entry.
  - `the committed tokens pass`: `contrastFailures(loadTokens())` equals `[]`. Measured 2026-11-11: the lowest pair is `ink-2` on `brand-tint`, 5.88.
  - `order does not matter`: `contrastRatio(a,b) === contrastRatio(b,a)`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `contrast.ts` with the sRGB linearisation threshold 0.03928 and coefficients 0.2126 / 0.7152 / 0.0722.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(theme): kiểm tra độ tương phản chữ theo WCAG"`

### Task 3: Web emitters and the target registry

**Files:**
- Create: `packages/theme/src/targets.ts`, `packages/theme/src/emit/tokensCss.ts`, `packages/theme/src/emit/tailwindTheme.ts`
- Test: `packages/theme/src/emit/emit.test.ts`

**Interfaces:**
- Consumes: `Tokens`
- Produces:
  - `type Target = { id: string; path: string; emit: (t: Tokens) => string }` (`path` is relative to `packages/theme/generated/`)
  - `targets: readonly Target[]`, initially `[{ id: 'tokens-css', path: 'tokens.css', … }, { id: 'tailwind-theme', path: 'tailwind-theme.css', … }]`
  - `emitTokensCss(t: Tokens): string`
  - `emitTailwindTheme(t: Tokens): string`

  K6–K8 append their targets here.

- [ ] **Step 1: Write the failing tests:**
  - `tokens.css declares every colour`: the output contains `--wa-color-brand: #14532D;` and `--wa-color-depth-4: #3F2E8C;` inside `:root {`, and one `--wa-color-` line per `color` key (count equals `Object.keys(t.color).length`).
  - `tokens.css carries units`: it contains `--wa-radius-md: 4px;`, `--wa-text-num: 12.5px;`, `--wa-motion-fast: 120ms;`, `--wa-shadow-pop: 0 4px 12px rgb(20 27 45 / 12%);`.
  - `dark series are separate`: it contains `--wa-color-dark-series-1: #3F8FD0;`.
  - `tailwind theme uses Tailwind namespaces`: the output starts with `@theme {` and contains `--color-brand: #14532D;`, `--radius-md: 4px;`, `--font-ui: "Archivo", "Segoe UI", system-ui, sans-serif;`, `--text-body: 13px;`, `--shadow-pop: 0 4px 12px rgb(20 27 45 / 12%);`.
  - `output is deterministic and LF`: two calls give identical strings; neither contains `\r`; both end with exactly one `\n`.
  - `target ids and paths are unique`.
  - `each file starts with a generated-file banner`: the first line is `/* Generated by @webatlas/theme from tokens.json. Do not edit; run npm run generate:theme. */`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the two emitters. Keys go in insertion order of `tokens.json`. Units: `px` for radius, text and size; `ms` for motion.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(theme): sinh tokens.css và tailwind-theme.css"`

### Task 4: Generate command, committed output, freshness test, CI

**Files:**
- Create: `packages/theme/src/generate.ts`, `packages/theme/src/cli.ts`
- Create (generated, committed): `packages/theme/generated/tokens.css`, `packages/theme/generated/tailwind-theme.css`
- Test: `packages/theme/src/generated.test.ts`
- Modify: `.gitattributes` (add `packages/theme/generated/** text eol=lf`)
- Modify: `.github/workflows/*.yml`, the job that runs `test:shared` (add `npm run test:theme` after it)
- Modify: `packages/theme/package.json` (`"generate": "tsx src/cli.ts"`, `"exports"` for `./tokens.css` and `./tailwind-theme.css` pointing at `generated/`)

**Interfaces:**
- Consumes: `loadTokens`, `contrastFailures`, `targets`
- Produces:
  - `generateAll(t: Tokens): Map<string, string>` (path → content)
  - CLI `npm run generate:theme`: refuses to write when `contrastFailures` is non-empty (lists the pairs, exit code 1), otherwise writes every target with `\n` endings and prints one line per file.

- [ ] **Step 1: Write the failing tests** in `generated.test.ts`:
  - `committed files match the generator`: for each `[path, content]` of `generateAll(loadTokens())`, the file at `generated/<path>` exists, and after normalising `\r\n` to `\n` equals `content`. On mismatch, the assertion message is `generated/<path> is stale: run npm run generate:theme`.
  - `no stray generated files`: every file in `generated/` is a target path.
- [ ] **Step 2: Run them.** Expected: FAIL (no files yet).
- [ ] **Step 3: Implement** `generateAll` and `cli.ts`. Add the `.gitattributes` line, then run `npm run generate:theme`. Expected output: two lines, `generated/tokens.css` and `generated/tailwind-theme.css`.
- [ ] **Step 4: Run** `npm run test:theme`. Expected: PASS, all four test files.
- [ ] **Step 5: Prove the failure path by hand.** Temporarily set `color.ink-2` to `#9AA197` in `tokens.json` and run `npm run generate:theme`. Expected: exit 1, the failing pairs listed, nothing written. Revert `tokens.json` afterwards.
- [ ] **Step 6: Add** `npm run test:theme` to the CI job after `test:shared`. Check: `grep -n "test:theme" .github/workflows/*.yml` shows one hit.
- [ ] **Step 7: Commit**: `git commit -m "feat(theme): lệnh generate:theme, tệp sinh ra được commit, kiểm tra độ mới và CI"`

## Done when

- `npm run test:theme` passes, and `npm run generate:theme` leaves `git status` clean.
- The CI job runs `test:theme`.
- `packages/theme/generated/` holds the two web files.
- Nothing outside `packages/theme`, the root `package.json`, `.gitattributes` and the workflow changed. The web app adopts the files in K2.
