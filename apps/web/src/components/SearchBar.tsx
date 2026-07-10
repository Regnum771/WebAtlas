import React, { useState, useEffect } from 'react';
import { useMapContext } from './MapContext';
import { Search, MapPin } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import { GEOSERVER_URL } from '../shared/config';

const DAMS_WFS_URL =
  `${GEOSERVER_URL}/ows?service=WFS&version=2.0.0&request=GetFeature` +
  `&typeNames=webatlas:dams&outputFormat=application/json&srsName=EPSG:4326`;

const SearchBar: React.FC = () => {
  const { map } = useMapContext();
  const [query, setQuery] = useState('');
  const [dams, setDams] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    fetch(DAMS_WFS_URL)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.features) {
          // Only dams with a geometry are searchable/navigable.
          const withGeom = data.features.filter((f: any) => f.geometry);
          setDams(withGeom);
          setResults(withGeom.slice(0, 10));
        }
      })
      .catch((err) => console.error('Error loading hydropower data for search:', err));
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (val.trim() === '') {
      setResults(dams.slice(0, 10));
    } else {
      const normVal = val.toLowerCase();
      setResults(
        dams.filter((f: any) => {
          const vnName = (f.properties.name || '').toLowerCase();
          const enName = (f.properties.name_en || '').toLowerCase();
          return vnName.includes(normVal) || enName.includes(normVal);
        })
      );
    }
  };

  const flyTo = (coordinates: number[]) => {
    if (!map) return;
    map.getView().animate({ center: fromLonLat(coordinates), zoom: 11, duration: 1000 });
    setShowResults(false);
    setQuery('');
  };

  return (
    <div className="search-bar-container">
      <div className="search-input-wrapper glass-panel">
        <Search className="search-icon" size={18} />
        <input
          type="text"
          placeholder="Tìm kiếm nhà máy thủy điện..."
          value={query}
          onChange={handleSearch}
          onFocus={() => setShowResults(true)}
          className="search-input"
        />
      </div>

      {showResults && results.length > 0 && (
        <div className="search-results glass-panel">
          {results.map((item: any, idx: number) => (
            <button
              key={item.properties.external_id || idx}
              className="search-result-item"
              onClick={() => flyTo(item.geometry.coordinates)}
            >
              <MapPin size={16} className="text-blue-500" />
              <div className="result-info">
                <span className="result-name">{item.properties.name}</span>
                <span className="result-desc">
                  Thủy điện {item.properties.wattage_mw ? `- ${item.properties.wattage_mw} MW` : ''}
                  {item.properties.year_operational ? ` (Vận hành: ${item.properties.year_operational})` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
