import { useState, useEffect, useRef } from 'react';
import { fetchSearch, type SearchHit } from '../api/search.api';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export type SearchStatus = 'idle' | 'loading' | 'done' | 'failed';

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [answeredQuery, setAnsweredQuery] = useState('');
  // Bumped by retry() to re-run the effect for the same query; `immediate`
  // tells that run to skip the debounce.
  const [attempt, setAttempt] = useState(0);
  const immediate = useRef(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setStatus('idle');
      setAnsweredQuery('');
      return;
    }
    // Every settling request checks `cancelled`: a newer query (or clear())
    // runs this cleanup first, so a late answer or failure for an old query
    // never replaces the newer one.
    let cancelled = false;
    const send = () => {
      setStatus('loading');
      fetchSearch(trimmed)
        .then((hits) => {
          if (cancelled) return;
          setResults(hits);
          setAnsweredQuery(trimmed);
          setStatus('done');
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setAnsweredQuery(trimmed);
          setStatus('failed');
        });
    };
    if (immediate.current) {
      immediate.current = false;
      send();
      return () => { cancelled = true; };
    }
    const timer = setTimeout(send, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, attempt]);

  const retry = () => {
    if (query.trim().length < MIN_CHARS) return;
    immediate.current = true;
    setAttempt((n) => n + 1);
  };

  // Resets query, results and status together so a consumer (e.g. after the
  // user picks a result) never renders an intermediate frame with an empty
  // input but a still-populated dropdown, or a spinner that never ends: the
  // change of `query` cancels any in-flight request, so its settle handlers
  // would no longer reset `status` themselves.
  const clear = () => {
    setQuery('');
    setResults([]);
    setStatus('idle');
    setAnsweredQuery('');
  };

  return { query, setQuery, results, status, answeredQuery, retry, clear };
}
