import React, { useState } from 'react';
import { useMapContext } from '../app/providers/MapProvider';
import { Search, MapPin } from 'lucide-react';
import type { Geometry } from 'ol/geom';
import type { Map as OlMap } from 'ol';
import AttributeFilter from '../features/attribute-filter';
import { searchAllLayers, type SearchHit } from '../features/attribute-filter/model/searchFeatures';
import { flyToGeometry } from '../features/attribute-filter/model/flyToGeometry';

const SearchBar: React.FC = () => {
  const { map } = useMapContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Search reads the already-loaded features of every thematic layer (no fetch).
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setResults(searchAllLayers(map as OlMap | null, val));
  };

  const flyTo = (geom: unknown) => {
    flyToGeometry(map as OlMap | null, (geom as Geometry) ?? null);
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
        <AttributeFilter />
      </div>

      {showResults && results.length > 0 && (
        <div className="search-results glass-panel">
          {results.map((item, idx) => (
            <button
              key={`${item.layerKey}-${idx}`}
              className="search-result-item"
              onClick={() => flyTo(item.geometry)}
              disabled={!item.geometry}
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
