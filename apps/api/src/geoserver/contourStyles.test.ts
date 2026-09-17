import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests over the SLD ARTIFACTS, not over a live GeoServer — same precedent as
 * basemapStyles.test.ts. `scripts/contours/styles.py` writes each `<name>.sld`
 * to disk and those files are committed, so asserting against them asserts
 * against what the generator produces, without needing Python or a running
 * GeoServer in the test run.
 *
 * No database here: unlike basemapStyles.test.ts, every assertion is text over
 * the artifact.
 */
const SLD_DIR = join(process.cwd(), 'scripts', 'contours');
const read = (name: string) => readFileSync(join(SLD_DIR, `${name}.sld`), 'utf8');

const STYLES = ['contours_plain', 'contours_labelled'] as const;

/** Line colours, from the plain style's two rules. */
const NON_INDEX = '#9C7A4F';
const INDEX = '#8A6534';
const CASING = '#FFFFFF';

/**
 * The <FeatureTypeStyle> bodies in document order, which is GeoServer's draw
 * order: it completes each FTS across every feature before starting the next.
 */
function featureTypeStyles(sld: string): string[] {
  return [...sld.matchAll(/<FeatureTypeStyle>([\s\S]*?)<\/FeatureTypeStyle>/g)].map((m) => m[1]);
}

/** Stroke widths in document order within one chunk of SLD. */
function strokeWidths(sld: string): number[] {
  return [
    ...sld.matchAll(/<CssParameter name="stroke-width">([\d.]+)<\/CssParameter>/g),
  ].map((m) => Number(m[1]));
}

describe.each(STYLES)('%s', (style) => {
  /**
   * The whole point of the casing design. Two symbolizers inside ONE
   * FeatureTypeStyle would render per-feature — casing, line, casing, line —
   * and a neighbouring contour's white casing would overdraw the previous
   * contour's brown, biting chunks out of lines exactly where terrain is steep
   * and contours crowd together. Two FTS blocks lay every casing down first.
   */
  it('separates casings from lines into two FeatureTypeStyles', () => {
    expect(featureTypeStyles(read(style))).toHaveLength(2);
  });

  it('draws every casing beneath every line, not per feature', () => {
    const [casings, lines] = featureTypeStyles(read(style));

    expect(casings).toContain(CASING);
    expect(casings).not.toContain(NON_INDEX);
    expect(casings).not.toContain(INDEX);

    expect(lines).toContain(NON_INDEX);
    expect(lines).toContain(INDEX);
  });

  it('makes each casing wider than the line it backs', () => {
    const [casings, lines] = featureTypeStyles(read(style));
    const casingWidths = strokeWidths(casings);
    const lineWidths = strokeWidths(lines);

    expect(casingWidths).toHaveLength(lineWidths.length);
    for (const [i, lineWidth] of lineWidths.entries()) {
      expect(casingWidths[i]).toBeGreaterThan(lineWidth);
    }
  });
});

/**
 * The labelled style is derived from the plain one by replacing the trailing
 * `</FeatureTypeStyle></UserStyle></NamedLayer>`, so labels landing in the
 * SECOND (topmost) FTS is a side effect of where that anchor sits, not a stated
 * intent. If the anchor ever moves, labels render beneath the lines and only a
 * rendered tile would show it.
 */
describe('contours_labelled', () => {
  it('places its labels in the topmost FeatureTypeStyle', () => {
    const [casings, lines] = featureTypeStyles(read('contours_labelled'));

    expect(lines).toContain('<TextSymbolizer>');
    expect(casings).not.toContain('<TextSymbolizer>');
  });
});

describe('contours_plain', () => {
  it('carries no labels', () => {
    expect(read('contours_plain')).not.toContain('<TextSymbolizer>');
  });
});
