import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';

const here = fileURLToPath(new URL('.', import.meta.url));
const SEED = resolvePath(here, '../../../../packages/atlas-data/data/seeds/hydrorivers-region.geojson');
const PREP = resolvePath(here, '../../../../packages/atlas-data/tools/prep_hydrosheds.py');

interface Reach {
  geometry: { type: string; coordinates: [number, number][] };
  properties: { HYRIV_ID: number; NEXT_DOWN: number; MAIN_RIV: number; ORD_STRA: number; LENGTH_KM: number };
}

const fc = JSON.parse(readFileSync(SEED, 'utf8')) as { type: string; features: Reach[] };

describe('committed HydroRIVERS reach seed', () => {
  it('holds every reach intersecting the six provinces, at every stream order', () => {
    expect(fc.features).toHaveLength(13045);
    const orders = fc.features.map((f) => f.properties.ORD_STRA);
    // Order 1 present proves the ORD_STRA >= 3 threshold is gone. Without the low
    // orders the name join has no small streams to attach named OSM ways to.
    expect(Math.min(...orders)).toBe(1);
    expect(Math.max(...orders)).toBe(6);
  });

  it('carries the topology columns the ingest exists for', () => {
    for (const key of ['HYRIV_ID', 'NEXT_DOWN', 'MAIN_RIV', 'ORD_STRA', 'LENGTH_KM'] as const) {
      expect(Object.keys(fc.features[0].properties)).toContain(key);
    }
    // NEXT_DOWN must be a real distribution, not a column of zeroes.
    const terminal = fc.features.filter((f) => f.properties.NEXT_DOWN === 0);
    expect(terminal).toHaveLength(184);
  });

  it('keeps reaches whole, so HYRIV_ID stays one row per reach', () => {
    // gpd.clip would cut a reach at the provincial border, splitting one LineString
    // into several parts, invalidating LENGTH_KM and breaking the NEXT_DOWN links
    // that reference the reach as a whole.
    const types = new Set(fc.features.map((f) => f.geometry.type));
    expect([...types]).toEqual(['LineString']);
    const ids = new Set(fc.features.map((f) => f.properties.HYRIV_ID));
    expect(ids.size).toBe(fc.features.length);
  });

  it('leaves exactly the measured number of links dangling out of the region', () => {
    const ids = new Set(fc.features.map((f) => f.properties.HYRIV_ID));
    const dangling = fc.features.filter(
      (f) => f.properties.NEXT_DOWN !== 0 && !ids.has(f.properties.NEXT_DOWN)
    );
    // These flow out of the six provinces. Legitimately dangling, and Task 6's gate
    // must tolerate them rather than treat them as corruption.
    expect(dangling).toHaveLength(53);
  });

  it('rounds coordinates to 5 decimals', () => {
    // HydroRIVERS sits on a 15-arcsecond grid (~0.00417 deg), so 5 decimals is far
    // finer than the source. Full float text nearly doubles the committed file.
    const over = fc.features.flatMap((f) =>
      f.geometry.coordinates.filter(([x, y]) =>
        (String(x).split('.')[1]?.length ?? 0) > 5 || (String(y).split('.')[1]?.length ?? 0) > 5
      )
    );
    expect(over).toHaveLength(0);
  });

  it('keeps the prep script region codes in step with the shared constant', () => {
    // Python cannot import the TypeScript source of truth, so guard the duplication.
    const py = readFileSync(PREP, 'utf8');
    const block = /REGION_PROVINCE_CODES\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'prep_hydrosheds.py must define REGION_PROVINCE_CODES').not.toBeNull();
    const codes = [...block![1].matchAll(/"(\d+)"/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...REGION_PROVINCE_CODES].sort());
  });
});
