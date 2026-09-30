import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { executePublishGeoserver } from './publishGeoserver';

const GS = process.env.GEOSERVER_URL;
const ctx = { datasetId: '__atlasdata_test__', forced: false, log: () => {} };

describe.skipIf(!GS)('publish-geoserver against the running GeoServer', () => {
  it('publishing an already-published layer is idempotent and the layer still serves WFS', async () => {
    const r = await executePublishGeoserver({} as Pool, { type: 'publish-geoserver', layer: 'dams' }, ctx);
    expect(r.summary).toMatch(/^webatlas:dams → dams_active \((unchanged|repointed)\)$/);
    const res = await fetch(
      `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:dams&outputFormat=application/json&count=1`
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { features: unknown[] }).features.length).toBe(1);
  });

  // If GeoServer ever accepts this (it should refuse a feature type with no backing relation),
  // the test fails. Delete the created featuretype by hand and report it: never loosen the assertion.
  it('fails when the backing relation does not exist', async () => {
    await expect(
      executePublishGeoserver(
        {} as Pool,
        { type: 'publish-geoserver', layer: '__atlasdata_test__missing', nativeName: '__atlasdata_test__no_such_view' },
        ctx
      )
    ).rejects.toThrow();
  }, 30_000);
});
