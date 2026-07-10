import React, { useState, useEffect } from 'react';
import { useMapContext } from './MapContext';
import { Search, MapPin } from 'lucide-react';
import { fromLonLat } from 'ol/proj';

const SearchBar: React.FC = () => {
  const { map } = useMapContext();
  const [query, setQuery] = useState('');
  const [dams, setDams] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    fetch('./thuydienvietnam.geojson')
      .then(res => res.json())
      .then(data => {
        if (data && data.features) {
          setDams(data.features);
          setResults(data.features.slice(0, 10)); // Default show first 10 dams
        }
      })
      .catch(err => console.error('Error loading hydropower data for search:', err));
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    
    if (val.trim() === '') {
      setResults(dams.slice(0, 10));
    } else {
      const filtered = dams.filter((f: any) => {
        const vnName = f.properties.Vietnamese || '';
        const enName = f.properties.English_hy || '';
        const normVal = val.toLowerCase();
        return vnName.toLowerCase().includes(normVal) || enName.toLowerCase().includes(normVal);
      });
      setResults(filtered);
    }
  };

  const flyTo = (coordinates: number[]) => {
    if (!map) return;
    map.getView().animate({
      center: fromLonLat(coordinates),
      zoom: 11,
      duration: 1000
    });
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
              key={item.properties.ID || idx}
              className="search-result-item"
              onClick={() => flyTo(item.geometry.coordinates)}
            >
              <MapPin size={16} className="text-blue-500" />
              <div className="result-info">
                <span className="result-name">{item.properties.Vietnamese || item.properties.name}</span>
                <span className="result-desc">
                  Thủy điện {item.properties.Wattage_PL ? `- ${item.properties.Wattage_PL} MW` : ''}
                  {item.properties.Year_of_op ? ` (Vận hành: ${item.properties.Year_of_op})` : ''}
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
