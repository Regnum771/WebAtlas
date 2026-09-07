import { useSearch } from './model/useSearch';
import { SearchBoxView } from './ui/SearchBox.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { useMapContext } from '../../app/providers/MapProvider';
import type { SearchHit } from './api/search.api';

export default function Search() {
  const { query, setQuery, results, loading } = useSearch();
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();

  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
  });

  const onSelect = (hit: SearchHit) =>
    run({ kind: 'zoomToFeature', layerKey: hit.layerKey, featureId: hit.featureId, lonLat: hit.lonLat });

  return (
    <SearchBoxView query={query} results={results} loading={loading} onQuery={setQuery} onSelect={onSelect} />
  );
}
