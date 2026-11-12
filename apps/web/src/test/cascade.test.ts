import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');
const app = read('../styles/app.css');

/** The `@import` statements of a stylesheet, in source order. */
const imports = (css: string): string[] => [...css.matchAll(/@import\s+[^;]+;/g)].map((m) => m[0]);

const customProps = (css: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return out;
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });

describe('cascade layers', () => {
  it('declares the layer order as the first statement', () => {
    const first = app.replace(/\/\*[\s\S]*?\*\//g, '').trim().split(';')[0] + ';';
    expect(first).toBe('@layer theme, base, legacy-compat, legacy, components, utilities;');
  });

  it('imports Tailwind and the theme in the ruled order', () => {
    const list = imports(app);
    expect(list.slice(0, 6).map((s) => s.replace(/\s+/g, ' '))).toEqual([
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "./theme-reset.css" layer(theme);',
      '@import "@webatlas/theme/tailwind-theme.css";',
      '@import "tailwindcss/preflight.css" layer(base);',
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
      '@import "./legacy-compat.css" layer(legacy-compat);',
    ]);
  });

  it('puts every legacy stylesheet in the legacy layer, below which the compat sheet has its own layer', () => {
    const legacy = ['ol/ol.css', '../index.css', './main.css', '../features/catalogue/ui/catalogue.css',
      '../features/flood-scenario/ui/flood.css', '../features/time-slider/ui/time-slider.css'];
    const list = imports(app).slice(6);
    expect(list.map((s) => s.replace(/\s+/g, ' '))).toEqual(legacy.map((p) => `@import "${p}" layer(legacy);`));
  });

  it('keeps test files out of the Tailwind source scan', () => {
    expect(app).toContain('@source "../shared/ui";');
    expect(app).toContain('@source not "../shared/ui/**/*.test.*";');
  });

  it('puts every @import before any other rule', () => {
    const body = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '');
    expect(body.indexOf('@source')).toBeGreaterThan(-1);
    const lastImport = app.lastIndexOf('@import');
    const firstRule = app.search(/@(source|theme|layer\s+base)/);
    expect(lastImport).toBeLessThan(firstRule);
  });

  it('only main.tsx imports CSS, and only the bare app.css', () => {
    const src = resolve(here, '..');
    const mainPath = resolve(src, 'main.tsx');
    // Static imports (also across lines, with ?query suffixes) and dynamic import('...css').
    const cssImport = /(?:(?<![@\w])import\s*(?:[^'"()]*?\bfrom\s*)?|(?<![@\w])import\s*\(\s*)['"][^'"]+\.css(?:\?[^'"]*)?['"]/;
    const offenders = sourceFiles(src)
      .filter((file) => resolve(file) !== mainPath && resolve(file) !== resolve(here, 'cascade.test.ts'))
      .filter((file) => cssImport.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    const main = readFileSync(mainPath, 'utf8');
    const statements = main.match(new RegExp(cssImport.source, 'g')) ?? [];
    expect(statements.map((s) => s.replace(/\s+/g, ' '))).toEqual([`import './styles/app.css'`]);
    expect(main).toMatch(/^import '\.\/styles\/app\.css'\s*;?\s*$/m);
  });

  it('detects CSS imports in every form the check must catch', () => {
    const cssImport = /(?:(?<![@\w])import\s*(?:[^'"()]*?\bfrom\s*)?|(?<![@\w])import\s*\(\s*)['"][^'"]+\.css(?:\?[^'"]*)?['"]/;
    for (const text of [`import './a.css';`, `import x from\n'./a.css';`, `import u from './a.css?url';`,
      `import r from "./a.css?raw"`, `const m = import('./a.css')`, `import './a.css?inline'`]) {
      expect(cssImport.test(text), text).toBe(true);
    }
    expect(cssImport.test(`import { a } from './a.ts';`)).toBe(false);
  });

  it('gives every compat rule the dialog-aware primitive exclusion', () => {
    const compat = read('../styles/legacy-compat.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const exclusion = ':not([data-slot]:not([data-slot*="dialog"]), [data-slot]:not([data-slot*="dialog"]) *)';
    const selectors = [...compat.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(/,\s*\n/)).map((s) => s.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(30);
    for (const selector of selectors) expect(selector, selector).toContain(exclusion);
  });

  it('keeps shared custom properties equal between the legacy tokens and the theme package', () => {
    const legacy = customProps(read('../shared/ui/tokens.css'));
    const theme = customProps(readFileSync(resolve(here, '../../../../packages/theme/generated/tailwind-theme.css'), 'utf8'));
    const shared = [...legacy.keys()].filter((k) => theme.has(k));
    expect(shared).toContain('--font-ui');
    for (const name of shared) expect(theme.get(name), name).toBe(legacy.get(name));
  });

  it('carries the R9 focus rule', () => {
    expect(app).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-mark\);[^}]*outline-offset:\s*0;[^}]*box-shadow:\s*0 0 0 3px var\(--color-ink\)/);
  });
});

// Review finding: `revert` in legacy-compat beats the R9 rule in the lower `base` layer.
describe('focus ring and toast band (K2 final review)', () => {
  const here = import.meta.dirname;
  it('legacy-compat leaves focus and invalid styling to R9, in Firefox too', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const compat = readFileSync(resolve(here, '../styles/legacy-compat.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(compat).not.toMatch(/-moz-focusring|-moz-ui-invalid/);
  });
  it('the toast band spans the map stage and the toast list is sized from it, not the viewport', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const shell = readFileSync(resolve(here, '../styles/shell.css'), 'utf8');
    const band = /\.toast-host \{([^}]*)\}/.exec(shell)?.[1] ?? '';
    expect(band).toMatch(/left:\s*12px/);
    expect(band).toMatch(/right:\s*12px/);
    expect(band).not.toMatch(/max-content/);
    const host = readFileSync(resolve(here, '../shared/ui/ToastHost.tsx'), 'utf8');
    expect(host).toMatch(/LIST_WIDTH = 'min\(560px, 100%\)'/);
    expect(host).not.toMatch(/100vw/);
  });
});

// K3: Tailwind scans each folder it converts, never its tests (words there become utilities).
describe('Tailwind scan list (K3)', () => {
  const dirs = ['widgets/top-bar', 'features/shell', 'features/layers-panel', 'features/legend', 'features/map/ui', 'features/search', 'features/command-palette'];
  it.each(dirs)('scans %s and skips its tests', async (dir) => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const app = readFileSync(resolve(import.meta.dirname, '../styles/app.css'), 'utf8');
    expect(app).toContain(`@source "../${dir}";`);
    expect(app).toContain(`@source not "../${dir}/**/*.test.*";`);
  });
});
