import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTokens } from '../tokens';
import { dagsterTargets, emitDagsterCss } from './dagster';

const SOURCE = readFileSync(fileURLToPath(new URL('../dagster/dagster.css', import.meta.url)), 'utf8');
const NGINX = readFileSync(
  fileURLToPath(new URL('../../../../infra/platform/dagster-frame/default.conf.template', import.meta.url)),
  'utf8',
);

describe('Dagster frame', () => {
  const css = emitDagsterCss(loadTokens());

  it('uses only custom properties it defines or the tokens supply', () => {
    const defined = new Set([...css.matchAll(/(--wa-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--wa-[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('recolours Dagster’s light themes and fonts, not its dark ones', () => {
    expect(SOURCE).toContain('--color-accent-primary: var(--wa-color-brand);');
    expect(SOURCE).toContain('--font-default: var(--wa-font-ui);');
    expect(SOURCE).not.toMatch(/themeDark/);
  });

  it('serves the generated file where the injected link points', () => {
    const [target] = dagsterTargets;
    expect(target!.path).toBe('dagster/dagster.css');
    expect(NGINX).toContain('location = /__webatlas/dagster.css');
    expect(NGINX).toContain('alias /etc/webatlas/dagster.css;');
    expect(NGINX).toContain('<link rel="stylesheet" href="/__webatlas/dagster.css">');
  });

  it('injects the frame the stylesheet styles: wordmark, "Điều phối dữ liệu", "← Về bản đồ"', () => {
    const frame = NGINX.slice(NGINX.indexOf("sub_filter '<body>'"));
    for (const c of ['wa-dg-frame', 'wa-dg-mark', 'wa-dg-title', 'wa-dg-back']) {
      expect(frame, c).toContain(`class="${c}"`);
      expect(SOURCE, c).toContain(`.${c}`);
    }
    expect(frame).toContain('Điều phối dữ liệu');
    expect(frame).toContain('${WEBATLAS_WEB_URL}/ban-do');
  });

  it('adds the fonts origin to Dagster’s CSP without dropping the rest of it (the nonce)', () => {
    expect(NGINX).toMatch(/"~\^\(\?<head>\.\*style-src \)\(\?<tail>\.\*\)\$"\s+"\$\{head\}https:\/\/fonts\.googleapis\.com \$\{tail\}"/);
    expect(NGINX).toContain('default                                $upstream_http_content_security_policy;');
  });
});
