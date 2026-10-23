import { describe, it, expect, beforeEach } from 'vitest';
import { closeTable, getTableState, openTable, resetTableStore, select, setFilter } from './table.store';

beforeEach(() => resetTableStore());

describe('table.store', () => {
  it("opening another layer keeps each layer's filter", () => {
    openTable('m1', 'l1');
    setFilter({ q: 'đập', match: 'any' });
    openTable('m1', 'l2');
    expect(getTableState().open).toEqual({ mapId: 'm1', layerId: 'l2' });
    expect(getTableState().byLayer.l2.q).toBe('');
    setFilter({ q: 'sông' });
    openTable('m1', 'l1');
    expect(getTableState().byLayer.l1).toMatchObject({ q: 'đập', match: 'any' });
    expect(getTableState().byLayer.l2.q).toBe('sông');
    closeTable();
    expect(getTableState().open).toBeNull();
    expect(getTableState().byLayer.l1.q).toBe('đập');
  });

  it('a filter change resets the page', () => {
    openTable('m1', 'l1');
    setFilter({ page: 3 });
    expect(getTableState().byLayer.l1.page).toBe(3);
    setFilter({ q: 'a' });
    expect(getTableState().byLayer.l1.page).toBe(0);
    setFilter({ page: 2 });
    setFilter({ sort: { field: 'ten', dir: 'asc' }, page: 1 });
    expect(getTableState().byLayer.l1.page).toBe(1);
  });

  it('selection is cleared when another layer opens', () => {
    openTable('m1', 'l1');
    select('f1');
    expect(getTableState().selectedId).toBe('f1');
    openTable('m1', 'l2');
    expect(getTableState().selectedId).toBeNull();
  });
});
