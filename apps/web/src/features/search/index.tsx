import { useSearch } from './model/useSearch';
import { SearchBoxView } from './ui/SearchBox.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { useMapContext } from '../../app/providers/MapProvider';
import { isRegionProvince } from '@webatlas/shared';
import { UseAsRoiButton } from '../roi/ui/UseAsRoiButton';
import { roiOfSearchHit } from '../roi/model/candidates';
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

    if (hit.source === 'admin') {
      if (hit.layerKey === 'province' && isRegionProvince(hit.featureId)) {
        run({ kind: 'zoomToRegion', provinceCode: hit.featureId });
      } else {
        run({ kind: 'showGeometries', fit: true, items: [{ geometry: { type: 'Point', coordinates: hit.lonLat }, role: 'highlight', label: hit.name }] });
      }
      return;
    }

    if (hit.source === 'reference') {
      // Reference entities are basemap data: no feature id in the water layers,
      // no edit path. Move the map to the point directly — never call
      // fetchFeatureGeometry, the editable-feature lookup, for one of these.
      run({
        kind: 'showGeometries',
        fit: true,
        items: [{ geometry: { type: 'Point', coordinates: hit.lonLat }, role: 'highlight', label: hit.name }],
      });
      return;
    }

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
    <SearchBoxView query={query} results={results} loading={loading} onQuery={setQuery} onSelect={onSelect}
      renderAction={(hit) => <UseAsRoiButton roi={roiOfSearchHit(hit)} label={hit.name} />}
    />
  );
}
