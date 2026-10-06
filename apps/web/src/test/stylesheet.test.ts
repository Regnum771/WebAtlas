import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

describe('design tokens and base styles', () => {
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
});
