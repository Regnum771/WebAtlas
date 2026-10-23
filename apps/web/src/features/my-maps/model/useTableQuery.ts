import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { LayerQueryRequest } from '../api/workspace.api';
import { dropGoneMap, isMapNotFound, keys } from './queries';
import { closeTable, emptyFilter, useTableStore, type TableFilter } from './table.store';

export const TABLE_PAGE_SIZE = 100;
export const DEBOUNCE_MS = 300;
export const TABLE_LOAD_ERROR = 'Không tải được bảng. Thử lại.';

type Extent = [number, number, number, number];

/** The search text and condition values wait for typing to pause; sort, match, view and page apply at once. */
function useDebouncedFilter(layerId: string | null, filter: TableFilter): TableFilter {
  const typed = JSON.stringify([filter.q, filter.conditions]);
  const [settled, setSettled] = useState({ layerId, typed });
  useEffect(() => {
    const t = setTimeout(() => setSettled({ layerId, typed }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [layerId, typed]);
  // A newly opened layer queries straight away.
  if (settled.layerId !== layerId) return filter;
  const [q, conditions] = JSON.parse(settled.typed) as [string, TableFilter['conditions']];
  return { ...filter, q, conditions };
}

export function useTableQuery(viewExtent4326: Extent | null) {
  const qc = useQueryClient();
  const { open, byLayer } = useTableStore();
  const mapId = open?.mapId ?? '';
  const layerId = open?.layerId ?? '';
  const filter = open ? (byLayer[layerId] ?? emptyFilter()) : emptyFilter();
  const debounced = useDebouncedFilter(open ? layerId : null, filter);
  const extent = filter.inView ? viewExtent4326 : null;

  const query = useQuery({
    queryKey: [...keys.table(mapId, layerId), debounced, extent],
    queryFn: () => {
      const body: LayerQueryRequest = {
        conditions: debounced.conditions,
        match: debounced.match,
        offset: debounced.page * TABLE_PAGE_SIZE,
        limit: TABLE_PAGE_SIZE,
      };
      if (debounced.q) body.q = debounced.q;
      if (extent) body.bbox = extent;
      if (debounced.sort) body.sort = debounced.sort;
      return api.queryLayer(mapId, layerId, body);
    },
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
  return { data: query.data, loading: query.isFetching, error, refetch: query.refetch };
}
