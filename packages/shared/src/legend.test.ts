import { describe, it, expect } from 'vitest';
import { legendFor, LEGEND_ATTRIBUTION } from './legend.js';
import { DAM_STATUS_SLUGS } from './dam-status.js';
import { LAYER_PALETTE } from './layer-palette.js';
import { BASEMAP_CONTEXT_LAYER_STATE_IDS } from './map-commands.js';

describe('legendFor', () => {
  it('returns a status section and a capacity section for dams', () => {
    const sections = legendFor('layer_dams');
    expect(sections.map((s) => s.title)).toEqual(['Theo Trạng thái', 'Theo Công suất']);
  });

  it('emits one status entry per dam status slug', () => {
    const [status] = legendFor('layer_dams');
    expect(status.entries).toHaveLength(DAM_STATUS_SLUGS.length);
    expect(status.entries.every((e) => e.swatch.startsWith('#'))).toBe(true);
  });

  it('returns a single line entry for rivers', () => {
    const sections = legendFor('layer_rivers');
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].shape).toBe('line');
  });

  it('returns an empty array for a layer with no legend', () => {
    expect(legendFor('layer_nonexistent')).toEqual([]);
  });

  // The decorative pastel fill was removed (styles.ts renders a transparent
  // fill now), so the legend must NOT carry a note apologising for it — an
  // explanation of something the map no longer does is worse than no note.
  it('returns a boundary-line entry for provinces with no decorative-fill note', () => {
    const sections = legendFor('layer_provinces_2026');
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].shape).toBe('line');
    expect(sections[0].note).toBeUndefined();
  });

  it('returns a boundary-line entry for wards with no decorative-fill note', () => {
    const sections = legendFor('layer_wards_2026');
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].shape).toBe('line');
    expect(sections[0].note).toBeUndefined();
  });

  it('returns a legend for every basemap context layer, coloured from the shared palette', () => {
    for (const id of BASEMAP_CONTEXT_LAYER_STATE_IDS) {
      const sections = legendFor(id);
      expect(sections.length, `${id} has no legend`).toBeGreaterThan(0);
      for (const entry of sections.flatMap((s) => s.entries)) {
        expect(entry.swatch, `${id} swatch`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('takes basemap swatches from LAYER_PALETTE, not hand-typed literals', () => {
    // styles.py parses the same LAYER_PALETTE entries to generate the SLD, so a
    // mismatch here means the legend would show a colour the map never renders.
    expect(legendFor('layer_bm_water')[0].entries[0].swatch).toBe(LAYER_PALETTE.layer_bm_water.color);
    expect(legendFor('layer_bm_railways')[0].entries[0].swatch).toBe(LAYER_PALETTE.layer_bm_railways.color);
  });

  it('returns a swatch for every hazard layer', () => {
    for (const id of [
      'layer_flood',
      'layer_drought_survey',
      'layer_saltwater_intrusion',
      'layer_flood_generation',
    ]) {
      const sections = legendFor(id);
      expect(sections.length, id).toBeGreaterThan(0);
      expect(sections[0].entries[0].swatch, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('carries ODbL attribution for the OSM-sourced layers', () => {
    expect(LEGEND_ATTRIBUTION.layer_rivers).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_lakes).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_dams).toBeUndefined();
  });
});
