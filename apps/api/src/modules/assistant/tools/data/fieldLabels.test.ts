import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { DICTIONARY, labelFor } from '@webatlas/shared';
import { clearDictionaryCache, elevationUnit, fieldsFor, loadDictionary } from './fieldLabels';

describe('fieldLabels', () => {
  beforeEach(() => clearDictionaryCache());

  it('fields carry the label and stored unit symbol', () => {
    const fields = fieldsFor(DICTIONARY, 'lakes', ['volume_mcm']);
    expect(fields).toEqual({
      volume_mcm: { label: labelFor(DICTIONARY, 'lakes', 'volume_mcm'), unit: 'triệu m³' },
    });
  });

  it('columns without an entry are omitted', () => {
    const fields = fieldsFor(DICTIONARY, 'lakes', ['volume_mcm', 'no_such_column']);
    expect(Object.keys(fields)).toEqual(['volume_mcm']);
    expect(fieldsFor(DICTIONARY, 'no_such_layer', ['name'])).toEqual({});
  });

  it('loadDictionary falls back to the code copy when the query fails', async () => {
    const pg = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Pool;
    expect(await loadDictionary(pg)).toBe(DICTIONARY);
  });

  it('a failure is not cached', async () => {
    const query = vi.fn().mockRejectedValue(new Error('down'));
    const pg = { query } as unknown as Pool;
    await loadDictionary(pg);
    const calls = query.mock.calls.length;
    await loadDictionary(pg);
    expect(query.mock.calls.length).toBeGreaterThan(calls);
  });

  it('elevation unit is the dem band stored unit symbol', async () => {
    const pg = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Pool;
    expect(await elevationUnit(pg)).toBe('m');
  });
});
