import { useCallback, useEffect, useRef, useState } from 'react';
import { searchCatalogue, type CatalogueItem, type CatalogueKind } from '../api/catalogue.api';
import { addCatalogueLayer, useCatalogueStore } from './catalogue.store';

export type PickerStatus = 'loading' | 'ok' | 'error';

/** Search state of the "Từ Danh mục" tab: a query, a kind filter and a page; results replace each other. */
export function useCataloguePickerPresenter() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogueKind | ''>('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PickerStatus>('loading');
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  /** Bumped per request: an older answer arriving late is dropped. */
  const seq = useRef(0);
  const layers = useCatalogueStore();

  const run = useCallback(async (q: string, k: CatalogueKind | '', p: number) => {
    const mine = ++seq.current;
    setStatus('loading');
    try {
      const res = await searchCatalogue({ q, kind: k, page: p });
      if (mine !== seq.current) return;
      setItems(res.items);
      setTotal(res.total);
      setPageSize(res.pageSize);
      setStatus('ok');
    } catch {
      if (mine !== seq.current) return;
      setItems([]);
      setTotal(0);
      setStatus('error');
    }
  }, []);

  // First load, and every change of filter or page; typing waits for the search button.
  useEffect(() => {
    void run(query, kind, page);
    // `query` is deliberately left out: it applies on submit through search().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, run]);

  return {
    query, kind, page, status, items, total, pageSize,
    addedIds: new Set(layers.map((l) => l.item.id)),
    onQuery: setQuery,
    onKind: (k: CatalogueKind | '') => { setKind(k); setPage(1); },
    onPage: setPage,
    onSearch: () => { if (page === 1) void run(query, kind, 1); else setPage(1); },
    onAdd: addCatalogueLayer,
  };
}
