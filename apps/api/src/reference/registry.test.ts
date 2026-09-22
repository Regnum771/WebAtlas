import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import {
  REFERENCE_LAYER_KEYS,
  REFERENCE_REGISTRY,
  getReferenceLayer,
  listReferenceMetadata,
} from './registry';

describe('reference registry', () => {
  it('covers exactly the five in-scope layers', () => {
    expect([...REFERENCE_LAYER_KEYS].sort()).toEqual(
      ['landuse', 'places', 'railways', 'roads', 'water']
    );
  });

  it('maps every key to a basemap table with the basemap column names', () => {
    for (const key of REFERENCE_LAYER_KEYS) {
      const def = REFERENCE_REGISTRY[key];
      expect(def.key).toBe(key);
      expect(def.table).toMatch(/^basemap\.[a-z_]+$/);
      // basemap tables name the geometry column `geometry`, not `geom`.
      expect(def.geomColumn).toBe('geometry');
      expect(def.idColumn).toBe('osm_id');
      expect(def.nameColumn).toBe('name');
      expect(def.classColumn).toBe('fclass');
    }
  });

  it('excludes the national duplicates and the raster/derived layers', () => {
    const tables = REFERENCE_LAYER_KEYS.map((k) => REFERENCE_REGISTRY[k].table);
    expect(tables).not.toContain('basemap.roads_vn');
    expect(tables).not.toContain('basemap.places_vn');
    expect(tables).not.toContain('basemap.dem_region');
    expect(tables).not.toContain('basemap.contours');
  });

  it('uses the region tables, except railways which has no region variant', () => {
    expect(REFERENCE_REGISTRY.roads.table).toBe('basemap.roads_region');
    expect(REFERENCE_REGISTRY.water.table).toBe('basemap.water_region');
    expect(REFERENCE_REGISTRY.landuse.table).toBe('basemap.landuse_region');
    expect(REFERENCE_REGISTRY.places.table).toBe('basemap.places_region');
    expect(REFERENCE_REGISTRY.railways.table).toBe('basemap.railways_vn');
  });

  it('declares ref only where the column exists', () => {
    // Only the roads shapefile carries `ref` (route numbers like QL14).
    expect(REFERENCE_REGISTRY.roads.refColumn).toBe('ref');
    expect(REFERENCE_REGISTRY.railways.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.water.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.landuse.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.places.refColumn).toBeUndefined();
  });

  it('declares population summable on places only', () => {
    expect(REFERENCE_REGISTRY.places.summable).toEqual(['population']);
    for (const key of ['roads', 'railways', 'water', 'landuse'] as const) {
      expect(REFERENCE_REGISTRY[key].summable).toEqual([]);
    }
  });

  it('declares the geometry kind, which decides whether an ROI needs a radius', () => {
    expect(REFERENCE_REGISTRY.roads.geomKind).toBe('line');
    expect(REFERENCE_REGISTRY.railways.geomKind).toBe('line');
    expect(REFERENCE_REGISTRY.places.geomKind).toBe('point');
    expect(REFERENCE_REGISTRY.water.geomKind).toBe('area');
    expect(REFERENCE_REGISTRY.landuse.geomKind).toBe('area');
  });

  it('getReferenceLayer rejects an unknown key', () => {
    expect(() => getReferenceLayer('dams')).toThrow(NotFoundError);
    expect(() => getReferenceLayer('roads_vn')).toThrow(NotFoundError);
    expect(getReferenceLayer('roads').table).toBe('basemap.roads_region');
  });

  it('listReferenceMetadata returns one entry per key', () => {
    const meta = listReferenceMetadata();
    expect(meta).toHaveLength(REFERENCE_LAYER_KEYS.length);
    expect(meta.map((m) => m.key).sort()).toEqual([...REFERENCE_LAYER_KEYS].sort());
  });
});
