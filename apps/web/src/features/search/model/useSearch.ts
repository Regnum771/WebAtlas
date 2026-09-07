import { useState, useEffect } from 'react';
import { fetchSearch, type SearchHit } from '../api/search.api';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < MIN_CHARS) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetchSearch(query.trim())
        .then((hits) => { if (!cancelled) setResults(hits); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return { query, setQuery, results, loading };
}
