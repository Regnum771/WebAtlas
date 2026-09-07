import { describe, it, expect } from 'vitest';
import { LAYER_PALETTE } from './layer-palette.js';

describe('LAYER_PALETTE', () => {
  it('gives every entry a hex color', () => {
    for (const [key, entry] of Object.entries(LAYER_PALETTE)) {
      expect(entry.color, `${key}.color`).toMatch(/^#[0-9a-f]{6}$/i);
      if (entry.stroke !== undefined) {
        expect(entry.stroke, `${key}.stroke`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('covers every layer that legend.ts derives a swatch color from', () => {
    for (const key of [
      'layer_rivers',
      'layer_lakes',
      'layer_stations',
      'layer_flood',
      'layer_drought_survey',
      'layer_saltwater_intrusion',
      'layer_flood_generation',
      'layer_provinces_2026',
      'layer_wards_2026',
    ]) {
      expect(LAYER_PALETTE[key], key).toBeDefined();
    }
  });
});
