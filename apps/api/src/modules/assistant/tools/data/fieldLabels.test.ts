import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { DICTIONARY, labelFor, type DictFeatureType } from '@webatlas/shared';
import { getDictionary } from '../../../dictionary/service';
import { clearDictionaryCache, elevationUnit, fieldsFor, loadDictionary } from './fieldLabels';

vi.mock('../../../dictionary/service', () => ({ getDictionary: vi.fn() }));
const served = vi.mocked(getDictionary);
const pool = {} as Pool;

/** A served copy of one layer with a changed label (and, optionally, a changed unit on one column). */
function servedLakes(label: string): DictFeatureType {
  return {
    ...DICTIONARY.lakes,
    attributes: DICTIONARY.lakes.attributes.map((a) => (a.name === 'volume_mcm' ? { ...a, label } : a)),
  };
}

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
    served.mockReset();
    served.mockRejectedValue(new Error('down'));
    expect(await loadDictionary(pool)).toBe(DICTIONARY);
  });

  it('a failure is not cached', async () => {
    served.mockReset();
    served.mockRejectedValue(new Error('down'));
    await loadDictionary(pool);
    await loadDictionary(pool);
    expect(served).toHaveBeenCalledTimes(2);
  });

  it('elevation unit is the dem band stored unit symbol', async () => {
    served.mockReset();
    served.mockRejectedValue(new Error('down'));
    expect(await elevationUnit(pool)).toBe('m');
  });

  describe('loadDictionary success path', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      served.mockReset();
      served.mockResolvedValue({ version: 'v', featureTypes: [servedLakes('Dung tích đã sửa')] });
    });
    afterEach(() => vi.useRealTimers());

    it('loadDictionary uses the served label', async () => {
      const dictionary = await loadDictionary(pool);
      expect(labelFor(dictionary, 'lakes', 'volume_mcm')).toBe('Dung tích đã sửa');
      // Layers the database does not serve keep the code copy.
      expect(dictionary.dams).toBe(DICTIONARY.dams);
    });

    it('a second call within 60 s does not query again', async () => {
      await loadDictionary(pool);
      vi.advanceTimersByTime(59_000);
      await loadDictionary(pool);
      expect(served).toHaveBeenCalledTimes(1);
    });

    it('a call after 60 s queries again', async () => {
      await loadDictionary(pool);
      vi.advanceTimersByTime(61_000);
      served.mockResolvedValue({ version: 'w', featureTypes: [servedLakes('Nhãn mới')] });
      const dictionary = await loadDictionary(pool);
      expect(served).toHaveBeenCalledTimes(2);
      expect(labelFor(dictionary, 'lakes', 'volume_mcm')).toBe('Nhãn mới');
    });

    it('elevationUnit reads the dem stored unit from the served dictionary', async () => {
      const dem: DictFeatureType = {
        ...DICTIONARY.dem,
        attributes: DICTIONARY.dem.attributes.map((a) => ({ ...a, storedUnit: 'cm' })),
      };
      served.mockResolvedValue({ version: 'v', featureTypes: [dem] });
      expect(await elevationUnit(pool)).toBe('cm');
    });
  });
});
