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
        .catch((err) => {
          // Not a UI concern (no error state is in scope here) — but swallowing
          // this entirely made "no matches" and "the API is down" indistinguishable
          // to anyone debugging a report of search not working.
          console.error('Tìm kiếm thất bại:', err);
          if (!cancelled) setResults([]);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // Resets query and results together so a consumer (e.g. after the user picks
  // a result) never renders an intermediate frame with an empty input but a
  // still-populated dropdown — setQuery('') alone would leave `results` stale
  // until this effect re-runs on the next commit.
  const clear = () => {
    setQuery('');
    setResults([]);
  };

  return { query, setQuery, results, loading, clear };
}
