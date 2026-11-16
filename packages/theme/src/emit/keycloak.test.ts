import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTokens } from '../tokens';
import { emitKeycloakCss, keycloakTargets } from './keycloak';

const SRC = fileURLToPath(new URL('../keycloak/', import.meta.url));
const read = (name: string) => readFileSync(`${SRC}${name}`, 'utf8');

/** Keys of a .properties file (comments and blank lines skipped). */
function keys(name: string): Set<string> {
  return new Set(
    read(name)
      .split('\n')
      .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('='))),
  );
}

const TEMPLATES = ['template.ftl', 'login.ftl'];
const msgKeys = (ftl: string) => [...read(ftl).matchAll(/msg\("([^"$]+)"/g)].map((m) => m[1]!);

describe('Keycloak login theme', () => {
  const vi = keys('messages_vi.properties');
  const en = keys('messages_en.properties');

  it('has a Vietnamese string for every message the overridden templates show', () => {
    const missing = TEMPLATES.flatMap(msgKeys).filter((k) => !vi.has(k));
    // Keycloak's own label for the identity-provider block: only shown if the realm adds one.
    expect(missing.filter((k) => k !== 'identity-provider-login-label')).toEqual([]);
  });

  it('gives the theme-only keys (wa…) in both languages', () => {
    const own = (s: Set<string>) => [...s].filter((k) => k.startsWith('wa')).sort();
    expect(own(en)).toEqual(own(vi));
    expect(own(vi).length).toBeGreaterThan(0);
  });

  it('rewords nothing in English that it leaves untranslated in Vietnamese', () => {
    expect([...en].filter((k) => !vi.has(k))).toEqual([]);
  });

  it('writes apostrophes the MessageFormat way', () => {
    // A single ' starts a quoted run in MessageFormat and swallows {0}; Keycloak needs ''.
    for (const name of ['messages_vi.properties', 'messages_en.properties']) {
      const bad = read(name)
        .split('\n')
        .filter((line) => !line.startsWith('#') && /(^|[^'])'([^']|$)/.test(line));
      expect(bad, name).toEqual([]);
    }
  });

  it('styles every class theme.properties hands to base pages', () => {
    const css = read('login.css');
    const classes = [...read('theme.properties').matchAll(/^kc\w+=(.+)$/gm)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))
      .filter((c) => c.startsWith('wa-') && c !== 'wa-kc' && c !== 'wa-kc__body');
    const unstyled = [...new Set(classes)].filter((c) => !css.includes(`.${c}`));
    // Wrappers that need no rule of their own.
    expect(unstyled.filter((c) => !['wa-label-wrap', 'wa-input-wrap', 'wa-content'].includes(c))).toEqual([]);
  });

  it('uses only custom properties it defines or the tokens supply', () => {
    const css = emitKeycloakCss(loadTokens());
    const defined = new Set([...css.matchAll(/(--wa-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--wa-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('meets the artboard sizes: 36 px inputs, 40 px button, R9 focus ring', () => {
    const css = read('login.css');
    expect(css).toMatch(/\.wa-input,[^{]*\{[^}]*height: 36px/);
    expect(css).toMatch(/\.wa-btn,[^{]*\{[^}]*height: 40px/);
    expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid var\(--wa-color-mark\)[^}]*box-shadow: 0 0 0 3px var\(--wa-color-ink\)/);
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('builds one folder Keycloak can load', () => {
    const paths = keycloakTargets.map((t) => t.path);
    expect(paths.every((p) => p.startsWith('keycloak/webatlas/login/'))).toBe(true);
    expect(paths).toContain('keycloak/webatlas/login/theme.properties');
    expect(paths).toContain('keycloak/webatlas/login/messages/messages_vi.properties');
  });
});
