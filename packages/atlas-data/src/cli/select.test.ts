import { describe, it, expect } from 'vitest';
import { selectDatasets } from './select';
import type { Dataset } from '../types';

const ds = (id: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// contours depends on dem; rivers_overview depends on rivers.
const graph = [ds('contours', ['dem']), ds('dem'), ds('rivers_overview', ['rivers']), ds('rivers')];

describe('selectDatasets (I2)', () => {
  it('with no flags, selects everything and excludes nothing', () => {
    const { selected, excluded } = selectDatasets(graph, { only: [], except: [] });
    expect(selected.map((d) => d.id).sort()).toEqual(
      ['contours', 'dem', 'rivers', 'rivers_overview'].sort()
    );
    expect(excluded).toEqual([]);
  });

  it('--except reports the named root AND its dependent, both reasoned "--except"', () => {
    const { selected, excluded } = selectDatasets(graph, { only: [], except: ['dem'] });
    expect(selected.map((d) => d.id).sort()).toEqual(['rivers', 'rivers_overview']);
    expect(excluded.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'contours', reason: '--except' },
      { id: 'dem', reason: '--except' },
    ]);
  });

  it('--only excludes every dataset not reachable from it, reasoned "not in --only"', () => {
    const { selected, excluded } = selectDatasets(graph, { only: ['contours'], except: [] });
    expect(selected.map((d) => d.id).sort()).toEqual(['contours', 'dem']);
    expect(excluded.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'rivers', reason: 'not in --only' },
      { id: 'rivers_overview', reason: 'not in --only' },
    ]);
  });

  it('signals an empty selection when --only and --except cancel each other out', () => {
    const { selected } = selectDatasets(graph, { only: ['dem'], except: ['dem'] });
    expect(selected).toEqual([]);
  });

  it('when both flags exclude the same dataset, --except wins as the reported reason', () => {
    // dem is excluded from --only=rivers (not reachable) AND from --except=dem directly.
    const { excluded } = selectDatasets(graph, { only: ['rivers'], except: ['dem'] });
    const demEntry = excluded.find((e) => e.id === 'dem');
    expect(demEntry).toEqual({ id: 'dem', reason: '--except' });
  });
});
