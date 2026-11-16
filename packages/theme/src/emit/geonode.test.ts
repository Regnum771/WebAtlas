import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTokens } from '../tokens';
import { emitGeonodeCss, geonodeTargets } from './geonode';

const SOURCE = readFileSync(fileURLToPath(new URL('../geonode/geonode.css', import.meta.url)), 'utf8');
const TEMPLATES = fileURLToPath(new URL('../../../../infra/platform/geonode/webatlas_bridge/templates/', import.meta.url));

describe('GeoNode theme', () => {
  const css = emitGeonodeCss(loadTokens());

  it('maps MapStore’s main variables onto the tokens, above MapStore’s own :root block', () => {
    const root = SOURCE.slice(SOURCE.indexOf('html:root {'), SOURCE.indexOf('}', SOURCE.indexOf('html:root {')));
    expect(root).toContain('--ms-primary: var(--wa-color-brand);');
    expect(root).toContain('--ms-main-color: var(--wa-color-ink);');
    expect(root).toContain('--ms-main-border-color: var(--wa-color-line);');
    expect(root).toContain('--ms-danger: var(--wa-color-alert);');
    expect(root).toContain('--ms-font-family-base: var(--wa-font-ui);');
  });

  it('uses only custom properties it defines or the tokens supply', () => {
    const defined = new Set([...css.matchAll(/(--wa-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--wa-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('scopes every header rule under .msgapi, so MapStore’s `.msgapi nav` and `.msgapi ul` resets lose', () => {
    const bare = SOURCE.split('\n').filter((line) => /^\.wa-gn-/.test(line));
    expect(bare).toEqual([]);
  });

  it('keeps the R9 focus ring and the reduced-motion switch', () => {
    expect(SOURCE).toMatch(/:focus-visible \{[^}]*outline: 2px solid var\(--wa-color-mark\)[^}]*box-shadow: 0 0 0 3px var\(--wa-color-ink\)/);
    expect(SOURCE).toContain('prefers-reduced-motion: reduce');
  });

  it('is the file the custom_theme.html override includes, and the overridden templates exist', () => {
    const [target] = geonodeTargets;
    expect(target!.path).toBe('geonode/webatlas-theme/geonode.css');
    const snippet = readFileSync(`${TEMPLATES}geonode-mapstore-client/snippets/custom_theme.html`, 'utf8');
    expect(snippet).toContain('{% wa_theme_css %}');
    // The tag reads the generated file where compose mounts generated/geonode.
    const tags = readFileSync(`${TEMPLATES}../templatetags/webatlas_ui.py`, 'utf8');
    expect(tags).toContain(`"/usr/src/webatlas/theme/${target!.path.slice('geonode/'.length)}"`);
    for (const name of ['brand_navbar.html', 'brand_navbar_default_left_menu_items.html', 'hero.html']) {
      expect(existsSync(`${TEMPLATES}geonode-mapstore-client/snippets/${name}`), name).toBe(true);
    }
    expect(existsSync(`${TEMPLATES}account/login.html`)).toBe(true);
  });

  it('styles the classes the WebATLAS header template uses', () => {
    const navbar = readFileSync(`${TEMPLATES}geonode-mapstore-client/snippets/brand_navbar.html`, 'utf8');
    const classes = new Set([...navbar.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((c) => c.startsWith('wa-gn-')));
    expect([...classes].filter((c) => !SOURCE.includes(`.${c}`))).toEqual([]);
  });
});
