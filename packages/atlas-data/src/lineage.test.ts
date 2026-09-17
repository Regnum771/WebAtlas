import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { resolveLicences, upsertLineage } from './lineage';
import type { Dataset } from './types';

const ds = (id: string, licence: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence, sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// The real case: contours are derived from the DEM, which is FABDEM (non-commercial).
const graph = [
  ds('dem', 'CC-BY-NC-SA-4.0'),
  ds('contours', 'CC-BY-NC-SA-4.0', ['dem']),
  ds('rivers', 'ODbL-1.0'),
  ds('atlas', 'CC0-1.0', ['contours', 'rivers']),
];

describe('resolveLicences', () => {
  it('returns a dataset\'s own licence when it derives from nothing', () => {
    expect(resolveLicences(graph, 'rivers')).toEqual(['ODbL-1.0']);
  });

  it('inherits an upstream licence transitively — contours carry FABDEM\'s terms', () => {
    expect(resolveLicences(graph, 'contours')).toEqual(['CC-BY-NC-SA-4.0']);
  });

  it('accumulates every licence in the ancestry, which is what export must honour', () => {
    expect(resolveLicences(graph, 'atlas')).toEqual([
      'CC-BY-NC-SA-4.0',
      'CC0-1.0',
      'ODbL-1.0',
    ]);
  });

  it('throws on an unknown dataset rather than silently returning nothing', () => {
    expect(() => resolveLicences(graph, 'nope')).toThrow(/nope/);
  });

  it('walks the full ancestry rather than stopping one level up, even when an intermediate dataset has its own distinct licence', () => {
    // contours' own licence (CC0-1.0) differs from its ancestor dem's (CC-BY-NC-SA-4.0).
    // A resolver that only inspected direct dependsOn licences instead of recursing
    // would miss dem's licence entirely.
    const layeredGraph = [
      ds('dem', 'CC-BY-NC-SA-4.0'),
      ds('contours', 'CC0-1.0', ['dem']),
      ds('atlas', 'CC0-1.0', ['contours']),
    ];
    expect(resolveLicences(layeredGraph, 'atlas')).toEqual([
      'CC-BY-NC-SA-4.0',
      'CC0-1.0',
    ]);
  });
});

describe('upsertLineage error handling (M2)', () => {
  // A fake pg client: BEGIN/lineage-upsert/DELETE succeed, the source INSERT fails
  // (simulating e.g. a NOT NULL violation), and — the point of this test — ROLLBACK
  // *also* fails (simulating a lost connection). The caller must still see the
  // original source-insert error, not the rollback failure that happened while
  // trying to clean up after it.
  it('rethrows the original error, not the ROLLBACK failure, when ROLLBACK also fails', async () => {
    const originalError = new Error('insert source failed: NOT NULL violation');
    const rollbackError = new Error('connection lost');

    const client = {
      query: async (sql: string) => {
        if (sql.startsWith('BEGIN')) return {};
        if (sql.startsWith('INSERT INTO app.dataset_lineage ')) return {};
        if (sql.startsWith('DELETE FROM app.dataset_lineage_source')) return {};
        if (sql.startsWith('INSERT INTO app.dataset_lineage_source')) throw originalError;
        if (sql.startsWith('ROLLBACK')) throw rollbackError;
        throw new Error(`unexpected query in test double: ${sql}`);
      },
      release: () => {},
    };
    const pool = { connect: async () => client } as unknown as Pool;

    const d: Dataset = {
      id: 'x',
      kind: 'derived',
      lineage: {
        statement: 's',
        licence: 'CC0-1.0',
        sources: [{ citation: 'c', licence: 'CC0-1.0' }],
      },
      stages: [{ type: 'sql', statement: 'SELECT 1' }],
    };

    await expect(upsertLineage(pool, d)).rejects.toBe(originalError);
  });
});
