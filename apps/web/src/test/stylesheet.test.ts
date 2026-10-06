import { readdirSync, readFileSync } from 'node:fs';
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

/** Rules for the printed sheet (D19) keep their own paper colours and sizes. */
const PRINTED_SHEET = [
  '.print-sheet', '.print-content', '.print-title', '.print-map', '.print-north', '.print-meta',
  '.print-body', '.print-legend', '.print-analysis', '.print-rows', '.print-attribution', '.print-A',
];

/**
 * Drops comments, the `@media print` block and every top-level rule whose selector
 * starts with one of the printed sheet's prefixes. Other at-rules are kept whole.
 */
function withoutPrintedSheet(source: string): string {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    const semi = text.indexOf(';', i);
    if (open === -1 || (semi !== -1 && semi < open)) {
      // A statement without a block (@import), or the trailing whitespace.
      const end = semi === -1 ? text.length : semi + 1;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    let depth = 1;
    let close = open + 1;
    for (; close < text.length && depth > 0; close += 1) {
      if (text[close] === '{') depth += 1;
      else if (text[close] === '}') depth -= 1;
    }
    const prelude = text.slice(i, open).trim();
    const printed = /^@media\s+print\b/.test(prelude)
      || PRINTED_SHEET.some((prefix) => prelude.startsWith(prefix));
    if (!printed) out += text.slice(i, close);
    i = close;
  }
  return out;
}

/** Every component source under src, tests excluded (they assert the old names are gone). */
function componentSources(): { file: string; text: string }[] {
  const root = resolve(here, '..');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !/\.test\.tsx$/.test(file))
    .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
}

describe('stylesheet contract', () => {
  const tokens = read('../shared/ui/tokens.css');
  const css = ['../styles/main.css', '../styles/shell.css', '../shared/ui/ui.css']
    .map((rel) => withoutPrintedSheet(read(rel)))
    .join('\n');
  const oldNames = /--(primary|accent|danger|chrome-|text-main|text-muted|surface|border|bg-panel|glass-shadow|elev-|radius-sm|radius-md|rail-width|flyout-width|color-primary)/;

  it('cuts out the printed sheet and nothing else', () => {
    const cut = withoutPrintedSheet(
      '@import "a.css";\n.print-sheet { color: #fff; }\n.print-rows th, .print-rows td { x: 1; }\n'
      + '.print-route { top: 0; }\n@media print { .print-route { a: b; } }\n@media (min-width: 1px) { .x { y: z; } }',
    );
    expect(cut).toContain('@import "a.css";');
    expect(cut).toContain('.print-route { top: 0; }');
    expect(cut).toContain('@media (min-width: 1px) { .x { y: z; } }');
    expect(cut).not.toMatch(/print-sheet|print-rows|a: b/);
  });

  it('uses none of the old names', () => {
    expect(css).not.toMatch(oldNames);
    expect(tokens).not.toMatch(oldNames);
    expect(css).not.toMatch(/glass-panel|backdrop-filter/);
    expect(tokens).not.toMatch(/Legacy aliases/);
  });

  it('has no blue, teal or second green', () => {
    expect(css).not.toMatch(/#(3b82f6|2563eb|93c5fd|1e3a8a|0f766e|15803d|166534|38bdf8)/i);
    expect(css).not.toMatch(/rgba\(56, 189, 248|rgba\(31, 38, 135/);
  });

  it('every corner is square, 3px, or round', () => {
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      expect(['0', '3px', 'var(--radius)', '50%', '999px']).toContain(v.trim());
    }
  });

  it('every type size is on the scale', () => {
    for (const [, v] of css.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(v.trim()).toMatch(/^(var\(--text-(xs|sm|md|lg|xl)\)|inherit)$/);
    }
  });

  it('no component still asks for a glass panel', () => {
    const sources = componentSources();
    expect(sources.length).toBeGreaterThan(50);
    const offenders = sources
      .filter(({ text }) => /glass-panel|text-blue-500/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
