import { isRegionProvince } from '@webatlas/shared';
import type { createCommandExecutor } from '../../map/model/mapCommands';
import { fetchFeatureGeometry, type SearchHit } from '../api/search.api';

type Run = ReturnType<typeof createCommandExecutor>;

/**
 * Moves the map to a search hit: a region province framed whole, an admin unit or a reference
 * entity as a lit point, an editable feature drawn whole (a river along its length, a lake as its
 * outline) and framed, falling back to its point when the geometry request fails.
 */
export function goToSearchHit(hit: SearchHit, run: Run): void {
  if (hit.source === 'admin') {
    if (hit.layerKey === 'province' && isRegionProvince(hit.featureId)) {
      run({ kind: 'zoomToRegion', provinceCode: hit.featureId });
    } else {
      run({ kind: 'showGeometries', fit: true, items: [{ geometry: { type: 'Point', coordinates: hit.lonLat }, role: 'highlight', label: hit.name }] });
    }
    return;
  }

  if (hit.source === 'reference') {
    // Reference entities are basemap data: no feature id in the water layers, no edit path.
    // Move the map to the point directly; never call fetchFeatureGeometry for one of these.
    run({
      kind: 'showGeometries',
      fit: true,
      items: [{ geometry: { type: 'Point', coordinates: hit.lonLat }, role: 'highlight', label: hit.name }],
    });
    return;
  }

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
}
