import { useEffect, useMemo, useState } from 'react';
import { LAYER_GEOMETRY, type OgcGeometryType } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useSession } from '../../../entities/session/model/session.store';
import type { GeometryType, LayerSummary, TableColumn, TableCondition, TableRow } from '../api/workspace.api';
import { columnLabel } from './columnLabel';
import {
  clearRing, fitToExtent4326, personalFeature, ringExtent4326, ringFeature, viewExtent4326, watchViewExtent4326,
} from './personalLayers';
import { editCopyKey, symbolDataUrl } from './personalStyle';
import { isMapNotFound, useMapDetail, useMyMaps } from './queries';
import {
  closeTable, emptyFilter, resetTableStore, select, setFilter, useTableStore, type TableFilter,
} from './table.store';
import type { TableSelection } from './usePersonalEditingPresenter';
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

/** The union of EPSG:4326 boxes, or null when there are none. */
function unionOf(boxes: Extent[]): Extent | null {
  if (boxes.length === 0) return null;
  return boxes.reduce<Extent>(
    (u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])],
    [...boxes[0]],
  );
}

/** What a filter selects (not which page): the hidden-by-filter note holds only while it stays the same. */
const filterKey = (f: TableFilter) => JSON.stringify([f.q, f.conditions, f.match, f.inView, f.sort]);

interface Target { layerId: string; id: string }

/**
 * The docked table of one personal layer: its toolbar (search, conditions, match, in view), its
 * columns and rows with their symbols, sorting and paging, and the selected feature. Filtering,
 * sorting and paging run on the server (useTableQuery); this shapes the answer for the view and
 * turns clicks into store changes.
 *
 * Selection works both ways. A row click selects it; a click on the table's layer on the map
 * selects that feature too (usePersonalPopupPresenter). Either way the feature is ringed on the
 * map, which does not move. A feature selected off the current page is located: the table asks
 * for its position and shows its page, or the note that the filter hides it.
 */
export function useTablePresenter() {
  const { map } = useMapContext();
  const { open, byLayer, selectedId, locateSeq } = useTableStore();
  const filter: TableFilter = open ? (byLayer[open.layerId] ?? emptyFilter()) : emptyFilter();
  const layerId = open?.layerId ?? null;
  const detail = useMapDetail(open?.mapId ?? null);
  const layer = detail.data?.layers.find((l) => l.id === open?.layerId) ?? null;
  const extent = useViewExtent();

  // The table closes when its map is gone (revoked or deleted: it left the lists, or its read
  // answered the map's 404; whoever found out showed the message) or its layer was deleted (the
  // map's detail no longer lists it; no message). Closing unmounts the table, its ring and its form.
  const lists = useMyMaps().data;
  const mapGone = open !== null && (isMapNotFound(detail.error)
    || (lists !== undefined && ![...lists.mine, ...lists.sharedWithMe].some((m) => m.id === open.mapId)));
  const layerGone = open !== null && detail.data !== undefined && layer === null;
  useEffect(() => {
    if (mapGone || layerGone) closeTable();
  }, [mapGone, layerGone]);

  // The feature to locate: one newly selected that is not among the rows on screen, or the
  // selection once more on relocate() (a repeat map click, a save). Decided when the selection
  // changes, never when the rows do, so paging away from a selection stays put.
  const [locating, setLocating] = useState<Target | null>(null);
  const selection: Target | null = selectedId && layerId ? { layerId, id: selectedId } : null;
  const [lastSelected, setLastSelected] = useState<{ target: Target | null; seq: number }>({ target: null, seq: locateSeq });
  const [hidden, setHidden] = useState<(Target & { filter: string }) | null>(null);
  const query = useTableQuery(extent, locating && locating.layerId === layerId ? locating.id : null);
  const data = query.data;
  const last = lastSelected.target;
  const changed = last?.id !== selection?.id || last?.layerId !== selection?.layerId;
  if (changed || lastSelected.seq !== locateSeq) {
    setLastSelected({ target: selection, seq: locateSeq });
    const onScreen = data?.rows.some((r) => r.id === selection?.id) ?? false;
    const again = !changed;
    setLocating(selection && (again || !onScreen) ? selection : null);
  }

  const pageNow = filter.page;
  // A page past the end (in view on and the map zoomed in, the last page's only row deleted, rows
  // removed elsewhere): move to the last page that exists rather than show an empty page. Only on
  // the live page's own fresh answer: while typing settles, the page asked for is not the store's.
  // Declared before the locate effect, so a located page set in the same commit wins.
  const answeredPage = query.page;
  const answeredMatched = query.fresh ? (data?.matched ?? null) : null;
  useEffect(() => {
    if (answeredMatched === null || answeredPage !== pageNow || answeredPage === 0) return;
    if (answeredPage * TABLE_PAGE_SIZE < answeredMatched) return;
    setFilter({ page: Math.max(0, Math.ceil(answeredMatched / TABLE_PAGE_SIZE) - 1) });
  }, [answeredMatched, answeredPage, pageNow]);

  // The located answer: show the feature's page, or note that the filter hides it.
  const located = query.located;
  const locatingId = locating?.id ?? null;
  const key = filterKey(filter);
  useEffect(() => {
    if (!located || located.id !== locatingId || !layerId) return;
    setLocating(null);
    if (located.position === null) {
      setHidden({ layerId, id: located.id, filter: key });
      return;
    }
    setHidden(null);
    const target = Math.floor(located.position / TABLE_PAGE_SIZE);
    if (target !== pageNow) setFilter({ page: target });
  }, [located, locatingId, layerId, pageNow, key]);
  // A failed locate is not retried with every later query: the selection simply stays.
  const failed = query.error !== null;
  useEffect(() => {
    if (failed) setLocating(null);
  }, [failed]);

  // The ring follows the selection; the table closing takes it off.
  useEffect(() => {
    if (!map) return undefined;
    if (layerId && selectedId) ringFeature(map, layerId, selectedId);
    else clearRing(map);
    return () => clearRing(map);
  }, [map, layerId, selectedId]);

  const selectedOutsideFilter = hidden !== null && hidden.id === selectedId && hidden.layerId === layerId
    && hidden.filter === key;

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

  // Phóng tới: the selected row's box; a selection without a row here (the filter hides it) is
  // fitted from its ring; nothing selected, every row on the page.
  const selectedRow = selectedId === null ? null : (data?.rows.find((r) => r.id === selectedId) ?? null);
  // The selection as the form beside the table needs it: its row, or (hidden by the filter, or on a
  // page not read yet) the feature as the map holds it; null properties until either is known.
  const loaded = map && layerId && selectedId !== null && !selectedRow ? personalFeature(map, layerId, selectedId) : null;
  const selected: TableSelection | null = layer && selectedId !== null
    ? { layer, id: selectedId, properties: selectedRow?.properties ?? loaded?.properties ?? null, bbox: selectedRow?.bbox ?? null }
    : null;
  const zoomExtent = (): Extent | null => {
    if (!map) return null;
    if (selectedRow?.bbox) return selectedRow.bbox;
    if (selectedId !== null && !selectedRow) {
      const ring = ringExtent4326(map);
      if (ring) return ring;
    }
    return unionOf((data?.rows ?? []).flatMap((r) => (r.bbox ? [r.bbox] : [])));
  };
  const canZoom = map !== null && (selectedId !== null || (data?.rows ?? []).some((r) => r.bbox !== null));

  return {
    header: { title: layer?.title ?? '', total: data?.total ?? null, matched: data?.matched ?? null },
    /** The open layer, once its map is read. */
    layer,
    /** The selected feature for the editing form (usePersonalEditingPresenter). */
    selected,
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
    selectedId,
    /** The selected feature does not match the filter: the view notes it above the rows. */
    selectedOutsideFilter,
    canZoom,

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
    /** Selects a row; the effect above rings it. The map does not move. */
    selectRow: (id: string) => select(id),
    zoomToSelection: () => {
      const target = zoomExtent();
      if (map && target) fitToExtent4326(map, target);
    },
  };
}

export type TablePresenter = ReturnType<typeof useTablePresenter>;

/** Signing out resets the table store: no table, filter or selection outlives the session. */
export function useResetTableOnSignOut(): void {
  const { status } = useSession();
  useEffect(() => {
    if (status !== 'authenticated') resetTableStore();
  }, [status]);
}
