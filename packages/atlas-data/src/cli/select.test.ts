import { describe, it, expect } from 'vitest';
import { selectDatasets, assertForceSelected, assertSupersedeSelected } from './select';
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
  it('names the direct dependency down a chain', () => {
    const chain = [ds('a'), ds('b', ['a']), ds('c', ['b'])];
    const { excluded } = selectDatasets(chain, { only: [], except: ['a'] });
    expect(excluded.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: 'a', reason: '--except' },
      { id: 'b', reason: 'depends on a' },
      { id: 'c', reason: 'depends on b' },
    ]);
  });

  it('with no flags, selects everything and excludes nothing', () => {
    const { selected, excluded } = selectDatasets(graph, { only: [], except: [] });
    expect(selected.map((d) => d.id).sort()).toEqual(
      ['contours', 'dem', 'rivers', 'rivers_overview'].sort()
    );
    expect(excluded).toEqual([]);
  });

  it('--except reports the named root AND its dependent, root reasoned "--except", dependent "depends on dem"', () => {
    const { selected, excluded } = selectDatasets(graph, { only: [], except: ['dem'] });
    expect(selected.map((d) => d.id).sort()).toEqual(['rivers', 'rivers_overview']);
    expect(excluded.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'contours', reason: 'depends on dem' },
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

describe('assertForceSelected', () => {
  it('accepts forced ids inside the selection', () => {
    const { selected } = selectDatasets(graph, { only: [], except: [] });
    expect(() => assertForceSelected(['dem'], graph, selected)).not.toThrow();
  });

  it('rejects an unknown id', () => {
    expect(() => assertForceSelected(['nope'], graph, graph)).toThrow(/unknown dataset "nope"/);
  });

  it('rejects forcing a dataset that --except removed (a contradiction, not a no-op)', () => {
    const { selected } = selectDatasets(graph, { only: [], except: ['dem'] });
    expect(() => assertForceSelected(['dem'], graph, selected)).toThrow(/not in the selected set/);
  });
});

describe('assertSupersedeSelected', () => {
  const all = [ds('admin_boundaries'), ds('dams', ['admin_boundaries']), ds('lakes', ['admin_boundaries'])];

  it('accepts ids that are registered and selected', () => {
    expect(() => assertSupersedeSelected(['dams'], all, all)).not.toThrow();
    expect(() => assertSupersedeSelected([], all, [])).not.toThrow();
  });

  it('rejects an unknown id and one that --only or --except removed', () => {
    expect(() => assertSupersedeSelected(['damz'], all, all)).toThrow(/--supersede-edits names unknown dataset "damz"/);
    expect(() => assertSupersedeSelected(['lakes'], all, [all[0], all[1]])).toThrow(
      /--supersede-edits lakes is not in the selected set/
    );
  });
});
