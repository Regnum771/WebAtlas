import React, { useState } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { Search, MapPin } from 'lucide-react';
import type { Geometry } from 'ol/geom';
import type { Map as OlMap } from 'ol';
import { useSelection } from '../entities/selection';
import { runQuery, type QueryHit } from '../features/attribute-filter/model/runQuery';
import { flyToGeometry } from '../features/attribute-filter/model/flyToGeometry';

const SearchBar: React.FC = () => {
  const { map } = useMapContext();
  const { selectById } = useSelection();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QueryHit[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Search shares runQuery with the drawer filter: reads the already-loaded
  // features of every thematic layer (no fetch), name substring match.
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (val.trim() === '') {
      setResults([]);
      return;
    }
    const out = runQuery(map as OlMap | null, {
      layers: 'all',
      conditions: [{ field: 'geographicalName', op: 'contains', value: val }],
    });
    setResults(out.hits);
  };

  // A search hit behaves exactly like a filter result: select (opens the detail
  // panel) then frame it on the map.
  const onHitClick = (hit: QueryHit) => {
    selectById(hit.layerKey, hit.featureId);
    flyToGeometry(map as OlMap | null, hit.feature.getGeometry() as Geometry | null);
    setShowResults(false);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="search-bar-container">
      <div className="search-input-wrapper glass-panel">
        <Search className="search-icon" size={18} />
        <input
          type="text"
          placeholder="Tìm kiếm..."
          value={query}
          onChange={handleSearch}
          onFocus={() => setShowResults(true)}
          className="search-input"
        />
      </div>

      {showResults && results.length > 0 && (
        <div className="search-results glass-panel">
          {results.map((item) => (
            <button
              key={`${item.layerKey}-${item.featureId}`}
              className="search-result-item"
              onClick={() => onHitClick(item)}
              disabled={!item.feature.getGeometry()}
            >
              <MapPin size={16} className="text-blue-500" />
              <div className="result-info">
                <span className="result-name">{item.label}</span>
                <span className="result-desc">{item.layerLabel}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
