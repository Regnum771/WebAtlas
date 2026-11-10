import { describe, expect, it } from 'vitest';
import { publishStages } from './publishStages';
import { ALL_DATASETS } from './registry';

const byId = (id: string) => {
  const d = ALL_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(`no dataset ${id}`);
  return d;
};

describe('publishStages', () => {
  it('keeps the basemap publish steps in order and leaves out the download and the load', () => {
    const argv = publishStages(byId('basemap')).map((s) => (s.type === 'run' ? s.argv.slice(1).join(' ') : s.type));
    expect(argv).toEqual([
      'packages/atlas-data/tools/basemap/publish-basemap.sh featuretypes',
      'packages/atlas-data/tools/basemap/styles.py',
      'packages/atlas-data/tools/basemap/publish-basemap.sh group',
      'packages/atlas-data/tools/basemap/publish-basemap.sh seed',
    ]);
  });

  it('takes a layer\'s publish-geoserver stage and not its load', () => {
    expect(publishStages(byId('dams')).map((s) => s.type)).toEqual(['publish-geoserver']);
    expect(publishStages(byId('rivers')).map((s) => s.type)).toEqual(['publish-geoserver', 'publish-geoserver']);
  });

  it('is empty for a dataset GeoServer never serves', () => {
    expect(publishStages(byId('reference_entities'))).toEqual([]);
  });
});
