import { useSearch } from './model/useSearch';
import { SearchBoxView } from './ui/SearchBox.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { useMapContext } from '../../app/providers/MapProvider';
import { fetchFeatureGeometry, type SearchHit } from './api/search.api';

export default function Search() {
  const { query, setQuery, results, loading, clear } = useSearch();
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();

  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
    layerExists: (id) => layersState.some((l) => l.id === id),
  });

  const onSelect = (hit: SearchHit) => {
    // clear(), not setQuery(''): it resets query + results in the same batch,
    // so the dropdown never flashes stale results before useSearch's effect
    // catches up to the emptied query.
    clear();
    // Draw the whole shape — a river lit along its length, a lake as its outline —
    // and frame it. If the geometry request fails, the point zoom still works.
    fetchFeatureGeometry(hit.layerKey, hit.featureId)
      .then(({ name, geometry }) =>
        run({
          kind: 'showGeometries',
          fit: true,
          items: [{ geometry, role: 'highlight', label: name ?? hit.name, layerKey: hit.layerKey, featureId: hit.featureId }],
        })
      )
      .catch(() =>
        run({ kind: 'zoomToFeature', layerKey: hit.layerKey, featureId: hit.featureId, lonLat: hit.lonLat })
      );
  };

  return (
    <SearchBoxView query={query} results={results} loading={loading} onQuery={setQuery} onSelect={onSelect} />
  );
}
