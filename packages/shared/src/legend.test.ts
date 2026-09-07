import { describe, it, expect } from 'vitest';
import { legendFor, LEGEND_ATTRIBUTION } from './legend.js';
import { DAM_STATUS_SLUGS } from './dam-status.js';

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
    expect(legendFor('layer_provinces_2026')).toEqual([]);
  });

  it('carries ODbL attribution for the OSM-sourced layers', () => {
    expect(LEGEND_ATTRIBUTION.layer_rivers).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_lakes).toContain('OpenStreetMap');
    expect(LEGEND_ATTRIBUTION.layer_dams).toBeUndefined();
  });
});
