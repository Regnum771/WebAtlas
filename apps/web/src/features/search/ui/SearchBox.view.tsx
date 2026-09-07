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
  return (
    <div className="search-box">
      <input
        type="text"
        className="search-input"
        placeholder="Tìm kiếm đối tượng…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {loading && <span className="search-loading">Đang tìm…</span>}
      {results.length > 0 && (
        <ul className="search-results">
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
