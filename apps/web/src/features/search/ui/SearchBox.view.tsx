import { useEffect, useState } from 'react';
import type { SearchHit } from '../api/search.api';

const LAYER_BADGE: Record<string, string> = {
  dams: 'Đập', lakes: 'Hồ', rivers: 'Sông', stations: 'Trạm',
};

interface Props {
  query: string;
  results: SearchHit[];
  loading: boolean;
  onQuery: (q: string) => void;
  onSelect: (hit: SearchHit) => void;
}

/** Passive: input + results list. No fetching, no map access. */
export function SearchBoxView({ query, results, loading, onQuery, onSelect }: Props) {
  // `results` alone used to decide whether the dropdown shows, so once there
  // were hits nothing could hide it short of emptying the query — a click on
  // the map, tabbing away, or Escape all left it floating over an unrelated
  // click target. `dismissed` tracks an explicit close; a fresh `results` set
  // (new keystroke, new fetch) always reopens it even if the previous one was
  // dismissed.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [results]);

  const open = !dismissed && results.length > 0;

  return (
    <div className="search-box">
      <input
        type="text"
        className="search-input"
        placeholder="Tìm kiếm đối tượng…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onBlur={() => setDismissed(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setDismissed(true); }}
      />
      {loading && <span className="search-loading">Đang tìm…</span>}
      {open && (
        // preventDefault on mousedown keeps focus in the input while a result
        // is being clicked, so onBlur doesn't close the list out from under
        // the click before its onClick has a chance to fire.
        <ul className="search-results" onMouseDown={(e) => e.preventDefault()}>
          {results.map((hit) => (
            <li key={`${hit.layerKey}:${hit.featureId}`}>
              <button type="button" className="search-result" onClick={() => onSelect(hit)}>
                <span className="search-badge">{LAYER_BADGE[hit.layerKey] ?? hit.layerKey}</span>{' '}
                <span>{hit.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
