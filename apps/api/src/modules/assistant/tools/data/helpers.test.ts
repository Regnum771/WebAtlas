import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../../../db/pool';
import { layerView, activeVersionLabel, LAYER_LABELS, isFeatureId } from './helpers';

afterAll(async () => {
  await closePool();
});

describe('layerView', () => {
  it('maps a layer key to its active-version view', () => {
    expect(layerView('dams')).toBe('water.dams_active');
    expect(layerView('flood_zones')).toBe('water.flood_zones_active');
  });

  it('throws on anything outside EDITABLE_LAYER_KEYS rather than interpolating it', () => {
    // The layer key reaches this function from a model-chosen tool argument.
    // It is interpolated into SQL, so an unknown key must never get through.
    expect(() => layerView('users; DROP TABLE app.users' as never)).toThrow();
    expect(() => layerView('provinces' as never)).toThrow();
  });

  it('has a Vietnamese label for every layer key', () => {
    for (const key of Object.keys(LAYER_LABELS)) {
      expect(LAYER_LABELS[key as keyof typeof LAYER_LABELS].length).toBeGreaterThan(0);
    }
  });
});

describe('isFeatureId', () => {
  it('accepts a uuid in either case', () => {
    expect(isFeatureId('3f8a1c2d-4b5e-6f70-8192-a3b4c5d6e7f8')).toBe(true);
    expect(isFeatureId('3F8A1C2D-4B5E-6F70-8192-A3B4C5D6E7F8')).toBe(true);
  });

  it('rejects anything that would make Postgres raise 22P02 instead of returning no rows', () => {
    expect(isFeatureId('not-a-uuid')).toBe(false);
    expect(isFeatureId('')).toBe(false);
    expect(isFeatureId("1' OR '1'='1")).toBe(false);
  });
});

describe('activeVersionLabel', () => {
  it('returns the label of the active dataset version for a seeded layer', async () => {
    const label = await activeVersionLabel(getPool(), 'dams');
    expect(typeof label).toBe('string');
    expect((label ?? '').length).toBeGreaterThan(0);
  });
});
