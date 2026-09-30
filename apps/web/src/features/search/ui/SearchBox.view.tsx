import { useEffect, useState, type ReactNode } from 'react';
import type { SearchHit } from '../api/search.api';

const LAYER_BADGE: Record<string, string> = {
  dams: 'Đập', lakes: 'Hồ', rivers: 'Sông', stations: 'Trạm',
};

/**
 * Many feature names already carry their layer word (HydroRIVERS names all
 * start with "Sông", e.g. "Sông Srêpốk"), so pairing the badge chip with the
 * raw name doubles it visually ("Sông Sông Srêpốk"). Strip a leading badge
 * word from the displayed name — the chip still shows it once.
 *
 * `name` is typed `string` on SearchHit, but there is no ErrorBoundary anywhere
 * in this app — a null/undefined value reaching `.toLowerCase()` here would
 * throw during render and unmount the whole React tree, not just this list
 * item. The API now guarantees a non-null name (coalesces to the route number
 * for ref-only roads entities), but this guards the render path anyway
 * against a future null from any source.
 */
function displayName(name: string | null | undefined, badge: string): string {
  if (!name) return '(không tên)';
  const prefix = `${badge} `;
  return name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
}

interface Props {
  query: string;
  results: SearchHit[];
  loading: boolean;
  onQuery: (q: string) => void;
  onSelect: (hit: SearchHit) => void;
  renderAction?: (hit: SearchHit) => ReactNode;
}

/** Passive: input + results list. No fetching, no map access. */
export function SearchBoxView({ query, results, loading, onQuery, onSelect, renderAction }: Props) {
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
          {results.map((hit) => {
            // Reference hits get their own badge: they're basemap data (a road,
            // railway, water body, landuse area, place), not one of the editable
            // water layers LAYER_BADGE names — showing the raw OSM layer key
            // ("roads") instead would be both untranslated and misleading.
            const badge = hit.source === 'reference' ? 'Nền bản đồ'
              : hit.source === 'admin' ? (hit.layerKey === 'province' ? 'Tỉnh' : 'Xã/phường')
                : (LAYER_BADGE[hit.layerKey] ?? hit.layerKey);
            return (
              <li key={`${hit.layerKey}:${hit.featureId}`}>
                <button type="button" className="search-result" onClick={() => onSelect(hit)}>
                  <span className="search-badge">{badge}</span>{' '}
                  <span>{displayName(hit.name, badge)}</span>
                </button>
                {renderAction?.(hit)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
