import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { LayerQueryRequest, TableCondition } from '../api/workspace.api';
import { dropGoneMap, isMapNotFound, keys } from './queries';
import { closeTable, emptyFilter, useTableStore, type TableFilter } from './table.store';

export const TABLE_PAGE_SIZE = 100;
export const DEBOUNCE_MS = 300;
export const TABLE_LOAD_ERROR = 'Không tải được bảng. Thử lại.';

type Extent = [number, number, number, number];

const needsValue = (op: string) => op !== 'empty' && op !== 'notEmpty';

/** A condition whose operator takes a value is sent once it has one; until then it filters nothing. */
export function isComplete(c: TableCondition): boolean {
  return !needsValue(c.op) || (c.value !== undefined && String(c.value).trim() !== '');
}

/**
 * The search text and condition values wait for typing to pause; sort, match, view and page apply
 * at once. Typing resets the store's page to 0 straight away; that reset waits with the text, so a
 * burst of typing on page 3 sends one query, for the new text on page 0, and nothing for the old
 * text on page 0 meanwhile.
 */
function useDebouncedFilter(layerId: string | null, filter: TableFilter): TableFilter {
  const typed = JSON.stringify([filter.q, filter.conditions]);
  const [settled, setSettled] = useState({ layerId, typed, page: filter.page });
  const typing = settled.layerId === layerId && settled.typed !== typed;
  // While nothing waits to settle, the settled page follows the live one, so typing starts from the page on screen.
  useEffect(() => {
    if (!typing && settled.page !== filter.page) setSettled((s) => ({ ...s, page: filter.page }));
  }, [typing, settled.page, filter.page]);
  useEffect(() => {
    const t = setTimeout(() => setSettled((s) => ({ layerId, typed, page: s.page })), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [layerId, typed]);
  // Nothing waiting to settle, or a newly opened layer (it queries straight away): the live filter.
  // While typing settles, a sort or page change applies to the settled text on the pre-typing page.
  if (!typing) return filter;
  const [q, conditions] = JSON.parse(settled.typed) as [string, TableFilter['conditions']];
  return { ...filter, q, conditions, page: settled.page };
}

/**
 * `locate`: a feature id whose position in the filtered, sorted list is wanted; the answer for it
 * comes back as `located` (position null when the filter hides it).
 */
export function useTableQuery(viewExtent4326: Extent | null, locate: string | null = null) {
  const qc = useQueryClient();
  const { open, byLayer } = useTableStore();
  const mapId = open?.mapId ?? '';
  const layerId = open?.layerId ?? '';
  const filter = open ? (byLayer[layerId] ?? emptyFilter()) : emptyFilter();
  const debounced = useDebouncedFilter(open ? layerId : null, filter);
  const extent = filter.inView ? viewExtent4326 : null;

  const body: LayerQueryRequest = {
    conditions: debounced.conditions.filter(isComplete),
    match: debounced.match,
    offset: debounced.page * TABLE_PAGE_SIZE,
    limit: TABLE_PAGE_SIZE,
  };
  if (debounced.q) body.q = debounced.q;
  if (extent) body.bbox = extent;
  if (debounced.sort) body.sort = debounced.sort;
  if (locate !== null) body.locate = locate;

  // Keyed on the request itself: a change that sends nothing new (a condition still without its
  // value) asks nothing.
  const query = useQuery({
    queryKey: [...keys.table(mapId, layerId), body],
    queryFn: () => api.queryLayer(mapId, layerId, body),
    enabled: open !== null,
    placeholderData: keepPreviousData,
  });

  // The map's own 404: it was unshared or deleted, so its table closes too.
  useEffect(() => {
    if (open && isMapNotFound(query.error)) {
      dropGoneMap(qc, open.mapId);
      closeTable();
    }
  }, [open, query.error, qc]);

  const err = query.error;
  const error = err === null ? null : err instanceof ApiError && err.status === 400 ? err.message : TABLE_LOAD_ERROR;
  // Only this request's own, fresh answer locates: a placeholder is the previous request's, and a
  // cached answer being read again may predate a save (whether the feature still matches).
  const located = locate !== null && query.data && !query.isPlaceholderData && !query.isFetching
    ? { id: locate, position: query.data.position }
    : null;
  // page: the page the query asks for; while typing settles it stays the page on screen.
  return { data: query.data, page: debounced.page, loading: query.isFetching, error, refetch: query.refetch, located };
}
