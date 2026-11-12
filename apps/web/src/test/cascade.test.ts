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
    expect(first).toBe('@layer theme, base, legacy, components, utilities;');
  });

  it('imports Tailwind and the theme in the ruled order', () => {
    const list = imports(app);
    expect(list.slice(0, 5).map((s) => s.replace(/\s+/g, ' '))).toEqual([
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "./theme-reset.css" layer(theme);',
      '@import "@webatlas/theme/tailwind-theme.css";',
      '@import "tailwindcss/preflight.css" layer(base);',
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    ]);
  });

  it('puts every legacy stylesheet in the legacy layer, compat sheet last', () => {
    const legacy = ['ol/ol.css', '../index.css', './main.css', '../features/catalogue/ui/catalogue.css',
      '../features/flood-scenario/ui/flood.css', '../features/time-slider/ui/time-slider.css', './legacy-compat.css'];
    const list = imports(app).slice(5);
    expect(list.map((s) => s.replace(/\s+/g, ' '))).toEqual(legacy.map((p) => `@import "${p}" layer(legacy);`));
  });

  it('puts every @import before any other rule', () => {
    const body = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '');
    expect(body.indexOf('@source')).toBeGreaterThan(-1);
    const lastImport = app.lastIndexOf('@import');
    const firstRule = app.search(/@(source|theme|layer\s+base)/);
    expect(lastImport).toBeLessThan(firstRule);
  });

  it('only main.tsx imports CSS, and only app.css', () => {
    const src = resolve(here, '..');
    const offenders: string[] = [];
    for (const file of sourceFiles(src)) {
      if (file.endsWith('main.tsx')) continue;
      if (/^\s*import\s[^;\n]*['"][^'"]+\.css['"]/m.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    const cssImports = [...read('../main.tsx').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);
    expect(cssImports).toEqual(['./styles/app.css']);
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
