import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { LAYER_REGISTRY, getLayer, listLayerMetadata } from './registry';
import { NotFoundError } from '../errors';

describe('layer registry', () => {
  it('covers exactly the editable layer keys (INV-2/INV-4)', () => {
    expect(Object.keys(LAYER_REGISTRY).sort()).toEqual([...EDITABLE_LAYER_KEYS].sort());
  });

  it('every entry has table, geomType, geomColumn=geom and an attribute schema', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      const def = LAYER_REGISTRY[key];
      expect(def.table).toBe(`water.${key}`);
      expect(def.geomColumn).toBe('geom');
      expect(['Point', 'MultiLineString', 'MultiPolygon']).toContain(def.geomType);
      expect(def.attributeColumns.length).toBeGreaterThan(0);
      // schema must reject an unknown property and accept an empty object (all attrs optional)
      expect(def.attributeSchema.safeParse({}).success).toBe(true);
    }
  });

  it('marks only dams geometry as nullable', () => {
    expect(LAYER_REGISTRY.dams.geomNullable).toBe(true);
    expect(LAYER_REGISTRY.rivers.geomNullable).toBe(false);
  });

  it('getLayer throws NotFoundError for an unknown key', () => {
    expect(() => getLayer('not_a_layer')).toThrow(NotFoundError);
  });

  it('listLayerMetadata returns one derived entry per layer', () => {
    const meta = listLayerMetadata();
    expect(meta).toHaveLength(EDITABLE_LAYER_KEYS.length);
    const dams = meta.find((m) => m.key === 'dams')!;
    expect(dams.geomType).toBe('Point');
    expect(dams.attributes).toContain('name');
  });
});
