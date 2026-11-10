import type { Dataset, Stage } from './types';

/**
 * The stages that configure GeoServer rather than load data: `publish-geoserver` stages, and the
 * temporary `run` stages that will become one (promoteTo). Re-running only these republishes a
 * dataset into a GeoServer that has lost its configuration (a new or replaced instance) without
 * touching the data, in the order the descriptor gives (featuretypes, then styles, then groups).
 */
export function publishStages(dataset: Dataset): Stage[] {
  return dataset.stages.filter(
    (s) => s.type === 'publish-geoserver' || (s.type === 'run' && s.promoteTo === 'publish-geoserver'),
  );
}
