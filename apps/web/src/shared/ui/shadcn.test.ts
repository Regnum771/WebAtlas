import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = resolve(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), 'shadcn');

// Focus comes only from the global R9 rule in app.css; a utility would override it.
describe('shadcn components', () => {
  it('exist', () => {
    expect(existsSync(resolve(dir, 'button.tsx'))).toBe(true);
  });
  it('set no focus, ring or outline styles of their own', () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /focus-visible:|outline-none|ring-/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('never import the npm package "cn" the shadcn CLI keeps installing', () => {
    const importers = readdirSync(dir).filter((f) => /from ["']cn["']/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(importers).toEqual([]);
    const pkg = JSON.parse(readFileSync(resolve(dir, '../../../../package.json'), 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('cn');
  });
});
