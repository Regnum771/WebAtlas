import { describe, it, expect } from 'vitest';

const GS = process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver';

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

describe('WFS publication', () => {
  it('serves dams as GeoJSON', async () => {
    expect(await wfsCount('dams')).toBeGreaterThan(0);
  });

  it('serves all seven layers as GeoJSON', async () => {
    for (const l of ['dams', 'rivers', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(await wfsCount(l)).toBeGreaterThan(0);
    }
  });
});
