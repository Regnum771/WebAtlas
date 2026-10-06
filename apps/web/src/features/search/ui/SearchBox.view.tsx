import { useEffect, useState, type ReactNode } from 'react';
import type { SearchHit } from '../api/search.api';
import type { SearchStatus } from '../model/useSearch';
import { Message } from '../../../shared/ui/Message';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';

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
  status: SearchStatus;
  answeredQuery: string;
  onRetry: () => void;
  onQuery: (q: string) => void;
  onSelect: (hit: SearchHit) => void;
  renderAction?: (hit: SearchHit) => ReactNode;
}

/** Passive: input + results list. No fetching, no map access. */
export function SearchBoxView({ query, results, status, answeredQuery, onRetry, onQuery, onSelect, renderAction }: Props) {
  // The dropdown shows for results, for "nothing found" and for a failure.
  // `dismissed` tracks an explicit close (blur, Escape, a click on the map); a
  // fresh answer (new results, a new status or a new answered query) reopens it.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [results, status, answeredQuery]);

  const open = !dismissed && (status === 'done' || status === 'failed');

  return (
    <div className="search-box">
      <input
        type="text"
        className="search-input"
        placeholder="Tìm địa danh, hồ, sông"
        aria-label="Tìm kiếm"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onBlur={() => setDismissed(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setDismissed(true); }}
      />
      {status === 'loading' && <span className="search-spinner"><Spinner label="Đang tìm" /></span>}
      {open && (
        // preventDefault on mousedown keeps focus in the input while a result
        // or Thử lại is being clicked, so onBlur doesn't close the dropdown out
        // from under the click before its onClick has a chance to fire.
        <div className="search-results float" onMouseDown={(e) => e.preventDefault()}>
          {status === 'failed' && (
            <Message tone="error" title="Chưa tìm được" actions={<Button size="sm" onClick={onRetry}>Thử lại</Button>}>
              Máy chủ không phản hồi.
            </Message>
          )}
          {status === 'done' && results.length === 0 && (
            <Message title={`Không có kết quả cho “${answeredQuery}”`}>Thử tên ngắn hơn.</Message>
          )}
          {results.length > 0 && (
          <ul>
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
      )}
    </div>
  );
}
