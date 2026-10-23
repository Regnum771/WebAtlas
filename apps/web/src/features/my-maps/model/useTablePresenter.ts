import { useEffect, useMemo, useState } from 'react';
import { LAYER_GEOMETRY, type OgcGeometryType } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import type { GeometryType, LayerSummary, TableColumn, TableCondition, TableRow } from '../api/workspace.api';
import { columnLabel } from './columnLabel';
import { viewExtent4326, watchViewExtent4326 } from './personalLayers';
import { editCopyKey, symbolDataUrl } from './personalStyle';
import { useMapDetail } from './queries';
import { closeTable, emptyFilter, setFilter, useTableStore, type TableFilter } from './table.store';
import { DEBOUNCE_MS, TABLE_LOAD_ERROR, TABLE_PAGE_SIZE, useTableQuery } from './useTableQuery';

export type ColumnType = TableColumn['type'];
export type ConditionOp = 'contains' | 'eq' | 'neq' | 'empty' | 'notEmpty' | 'lt' | 'lte' | 'gt' | 'gte';

/** The operators each column type takes, in the order the picker lists them (as the API checks them). */
export const OPERATORS: Record<ColumnType, readonly ConditionOp[]> = {
  text: ['contains', 'eq', 'neq', 'empty', 'notEmpty'],
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'empty', 'notEmpty'],
  date: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'empty', 'notEmpty'],
};
export const OP_LABEL: Record<ConditionOp, string> = {
  contains: 'chứa', eq: 'bằng', neq: 'khác', empty: 'trống', notEmpty: 'không trống',
  lt: '<', lte: '≤', gt: '>', gte: '≥',
};
/** The API takes at most 10 conditions. */
export const MAX_CONDITIONS = 10;

const needsValue = (op: string) => op !== 'empty' && op !== 'notEmpty';

export interface OperatorOption { op: ConditionOp; label: string }
export interface TableColumnView { name: string; label: string; type: ColumnType }
/** One condition as its chip and its editor show it. */
export interface ConditionView {
  field: string;
  fieldLabel: string;
  op: string;
  opLabel: string;
  value: string;
  needsValue: boolean;
  type: ColumnType;
  /** Only the operators of the column's type. */
  ops: OperatorOption[];
}
export interface TableRowView extends TableRow {
  /** The feature's symbol as a data URL ('' when the browser cannot draw). */
  symbol: string;
  /** The text of each column's cell, in column order. */
  cells: string[];
}
export interface TablePage {
  index: number;
  size: number;
  /** 1-based first and last row shown; 0 and 0 when nothing matches. */
  from: number;
  to: number;
  canPrev: boolean;
  canNext: boolean;
}
export type ConditionPatch = Partial<Pick<TableCondition, 'field' | 'op' | 'value'>>;

type Extent = [number, number, number, number];

const OGC_TO_FAMILY: Record<OgcGeometryType, GeometryType> = { Point: 'point', MultiLineString: 'line', MultiPolygon: 'polygon' };

/**
 * The geometry a row's symbol is drawn as: the layer's declared one, the official layer's for an
 * edit copy, and for a mixed import a guess from the row's bbox (a point has no extent).
 */
function rowGeometry(layer: LayerSummary, bbox: TableRow['bbox']): GeometryType {
  if (layer.geometryType) return layer.geometryType;
  const key = editCopyKey(layer);
  if (key) return OGC_TO_FAMILY[LAYER_GEOMETRY[key]];
  if (!bbox || (bbox[0] === bbox[2] && bbox[1] === bbox[3])) return 'point';
  return 'polygon';
}

/** A property value as a cell shows it. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The current view's bbox, once the view has stayed put for DEBOUNCE_MS. OpenLayers ends a move
 * after every resize too, so dragging the dock's edge ends one on almost every frame; with "in
 * view" on, each would be a query. Only the extent the view settles on reaches the query.
 */
function useViewExtent(): Extent | null {
  const { map } = useMapContext();
  const [extent, setExtent] = useState<Extent | null>(() => (map ? viewExtent4326(map) : null));
  useEffect(() => {
    if (!map) return undefined;
    setExtent(viewExtent4326(map));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchViewExtent4326(map, (next) => {
      clearTimeout(timer);
      timer = setTimeout(() => setExtent(next), DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [map]);
  return extent;
}

/**
 * The docked table of one personal layer: its toolbar (search, conditions, match, in view), its
 * columns and rows with their symbols, sorting and paging. Filtering, sorting and paging run on
 * the server (useTableQuery); this shapes the answer for the view and turns clicks into store
 * changes.
 */
export function useTablePresenter() {
  const { open, byLayer } = useTableStore();
  const filter: TableFilter = open ? (byLayer[open.layerId] ?? emptyFilter()) : emptyFilter();
  const detail = useMapDetail(open?.mapId ?? null);
  const layer = detail.data?.layers.find((l) => l.id === open?.layerId) ?? null;
  const extent = useViewExtent();
  const query = useTableQuery(extent);
  const data = query.data;

  const columns: TableColumnView[] = useMemo(
    () => (layer && data ? data.columns.map((c) => ({ name: c.name, label: columnLabel(layer, c.name), type: c.type })) : []),
    [layer, data],
  );
  const rows: TableRowView[] = useMemo(
    () => (layer && data
      ? data.rows.map((r) => ({
        ...r,
        symbol: symbolDataUrl(layer, r.properties, rowGeometry(layer, r.bbox)),
        cells: columns.map((c) => cellText(r.properties[c.name])),
      }))
      : []),
    [layer, data, columns],
  );

  const typeOf = (field: string): ColumnType => columns.find((c) => c.name === field)?.type ?? 'text';
  const operatorsFor = (field: string): OperatorOption[] =>
    OPERATORS[typeOf(field)].map((op) => ({ op, label: OP_LABEL[op] }));
  const conditions: ConditionView[] = filter.conditions.map((c) => ({
    field: c.field,
    fieldLabel: layer ? columnLabel(layer, c.field) : c.field,
    op: c.op,
    opLabel: OP_LABEL[c.op as ConditionOp] ?? c.op,
    value: c.value === undefined ? '' : String(c.value),
    needsValue: needsValue(c.op),
    type: typeOf(c.field),
    ops: operatorsFor(c.field),
  }));

  const matched = data?.matched ?? 0;
  const index = query.page;
  const page: TablePage = {
    index,
    size: TABLE_PAGE_SIZE,
    from: matched === 0 ? 0 : index * TABLE_PAGE_SIZE + 1,
    to: Math.min((index + 1) * TABLE_PAGE_SIZE, matched),
    canPrev: index > 0,
    canNext: (index + 1) * TABLE_PAGE_SIZE < matched,
  };

  const setConditions = (next: TableCondition[]) => setFilter({ conditions: next });

  return {
    header: { title: layer?.title ?? '', total: data?.total ?? null, matched: data?.matched ?? null },
    columns,
    rows,
    page,
    sort: filter.sort,
    filter,
    conditions,
    loading: query.loading,
    error: query.error,
    /** A network error can be retried; a refused filter (the API's message) cannot. */
    canRetry: query.error === TABLE_LOAD_ERROR,
    isOwner: detail.data?.role === 'owner',
    canAddCondition: columns.length > 0 && filter.conditions.length < MAX_CONDITIONS,
    operatorsFor,

    setSearch: (q: string) => setFilter({ q }),
    addCondition: () => {
      if (columns.length === 0 || filter.conditions.length >= MAX_CONDITIONS) return;
      const [first] = columns;
      setConditions([...filter.conditions, { field: first.name, op: OPERATORS[first.type][0], value: '' }]);
    },
    updateCondition: (i: number, patch: ConditionPatch) => {
      const current = filter.conditions[i];
      if (!current) return;
      const next: TableCondition = { ...current, ...patch };
      // A field of another type keeps the operator only when that type offers it.
      if (!(OPERATORS[typeOf(next.field)] as readonly string[]).includes(next.op)) next.op = OPERATORS[typeOf(next.field)][0];
      if (needsValue(next.op)) next.value = next.value ?? '';
      else delete next.value;
      setConditions(filter.conditions.map((c, j) => (j === i ? next : c)));
    },
    removeCondition: (i: number) => setConditions(filter.conditions.filter((_, j) => j !== i)),
    setMatch: (match: TableFilter['match']) => setFilter({ match }),
    setInView: (inView: boolean) => setFilter({ inView }),
    /** Ascending, then descending, then unsorted; another column starts ascending. */
    toggleSort: (field: string) => {
      const sort = filter.sort;
      const next: TableFilter['sort'] = sort?.field !== field ? { field, dir: 'asc' } : sort.dir === 'asc' ? { field, dir: 'desc' } : null;
      setFilter({ sort: next });
    },
    prev: () => { if (page.canPrev) setFilter({ page: index - 1 }); },
    next: () => { if (page.canNext) setFilter({ page: index + 1 }); },
    retry: () => { void query.refetch(); },
    close: closeTable,
  };
}

export type TablePresenter = ReturnType<typeof useTablePresenter>;
