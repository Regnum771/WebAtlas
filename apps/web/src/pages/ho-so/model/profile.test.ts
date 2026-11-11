import { describe, it, expect } from 'vitest';
import { PERMISSION_LABELS, buildUnitTree, type Grant } from '@webatlas/shared';
import { scopeRows } from './profile';

const g = (permission: Grant['permission'], unit: string): Grant => ({ permission, unit });

describe('scopeRows', () => {
  it('groups grants by unit, the country first, with unit names from the tree', () => {
    const tree = buildUnitTree([
      { code: 'VN', name: 'Toàn quốc', level: 'country', parent: null },
      { code: '48', name: 'Đà Nẵng', level: 'province', parent: 'VN' },
    ]);
    const rows = scopeRows([g('submission.review', '48'), g('feature.update', 'VN'), g('feature.update', '48')], tree);
    expect(rows.map((r) => r.unitName)).toEqual(['Toàn quốc', 'Đà Nẵng']);
    expect(rows[1].permissions).toEqual([PERMISSION_LABELS['feature.update'], PERMISSION_LABELS['submission.review']]);
  });

  it('falls back to the unit code before the tree has loaded', () => {
    expect(scopeRows([g('feature.update', '48')], null)[0].unitName).toBe('48');
  });

  it('is empty without grants', () => {
    expect(scopeRows([], null)).toEqual([]);
  });
});
