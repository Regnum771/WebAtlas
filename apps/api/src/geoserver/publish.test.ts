import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { gsRequest } from './client';
import { nativeNameFor } from './publish';

const WS = process.env.GEOSERVER_WORKSPACE ?? 'webatlas';
const STORE = `${WS}_water`;
const LAYERS = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

// Live WFS smoke test: needs a running GeoServer with the layers published
// (npm run publish:geoserver). Gated on GEOSERVER_URL so CI — which runs
// Postgres only, no GeoServer (CI design §1) — skips it; the local dev
// stack sets GEOSERVER_URL in apps/api/.env, so it still runs there.
const GS = process.env.GEOSERVER_URL;

async function wfsCount(layer: string): Promise<number> {
  const url =
    `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=webatlas:${layer}&outputFormat=application/json&count=5`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { features: unknown[]; type: string };
  expect(json.type).toBe('FeatureCollection');
  return json.features.length;
}

describe.skipIf(!GS)('WFS publication', () => {
  it('serves dams as GeoJSON', async () => {
    expect(await wfsCount('dams')).toBeGreaterThan(0);
  });

  it('serves all eight layers as GeoJSON', async () => {
    for (const l of LAYERS) {
      expect(await wfsCount(l)).toBeGreaterThan(0);
    }
  }, 120_000);

  // The public layer identity must not change (webatlas:dams stays webatlas:dams),
  // but each featuretype must be backed by its active-version resolving view so
  // the served data follows the active-version pointer.
  it('backs every published layer with its active-version view', async () => {
    for (const l of LAYERS) {
      const res = await gsRequest('GET', `/workspaces/${WS}/datastores/${STORE}/featuretypes/${l}`);
      expect(res.status, `featuretype ${l} should be published`).toBe(200);
      const json = (await res.json()) as { featureType: { name: string; nativeName: string } };
      expect(json.featureType.name, `${l} public layer name`).toBe(l);
      expect(json.featureType.nativeName, `${l} backing relation`).toBe(`${l}_active`);
    }
  });
});

describe('nativeNameFor', () => {
  it('publishes the river overview under its own name, not a _active twin', () => {
    // ensureLayer maps table -> nativeName `${table}_active`, which is right for
    // the versioned layers and wrong for this one: rivers_overview IS the
    // relation. Getting it wrong makes GeoServer look for rivers_overview_active
    // and fail with a confusing 500.
    expect(nativeNameFor('rivers_overview')).toBe('rivers_overview');
  });

  it('keeps the _active mapping for versioned layers', () => {
    expect(nativeNameFor('rivers')).toBe('rivers_active');
    expect(nativeNameFor('dams')).toBe('dams_active');
  });
});
