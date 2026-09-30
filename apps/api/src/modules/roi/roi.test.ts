import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { closeAnalysisPool } from '../analysis/pool';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await closeAnalysisPool(); });

const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/roi/resolve', payload: payload as object });

describe('POST /api/roi/resolve', () => {
  it('returns the resolved ROI', async () => {
    const res = await post({ roi: { source: 'admin', level: 'province', code: '66' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ label: 'Tỉnh Đắk Lắk', kind: 'area' });
    expect(body.measure.areaKm2).toBeGreaterThan(18_000);
    expect(body.display.type).toMatch(/Polygon/);
    expect(body.bbox).toHaveLength(4);
    expect(body.centroid).toHaveLength(2);
    // Internal facts and the full-precision geometry never leave the server.
    expect(body).not.toHaveProperty('geojson');
    expect(body).not.toHaveProperty('facts');
  });

  it('400s a malformed ROI: bad radius, a radius on an admin unit, whole on a non-river', async () => {
    const point = { type: 'Point', coordinates: [108.05, 12.68] };
    expect((await post({ roi: { source: 'drawn', geometry: point, radiusKm: 0 } })).statusCode).toBe(400);
    expect((await post({ roi: { source: 'drawn', geometry: point, radiusKm: 101 } })).statusCode).toBe(400);
    expect((await post({ roi: { source: 'admin', level: 'province', code: '66', radiusKm: 5 } })).statusCode).toBe(400);
    expect((await post({
      roi: { source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000', whole: true },
    })).statusCode).toBe(400);
    expect((await post({})).statusCode).toBe(400);
  });

  it('404s an ROI whose feature does not exist', async () => {
    const res = await post({
      roi: { source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s a limit with the reason in the message', async () => {
    const res = await post({
      roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.4, 13.6] }, radiusKm: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/diện tích/);
  });

  it('400s a self-intersecting polygon crossing the region edge, and an unclosed ring (was 500)', async () => {
    const bowtie = { type: 'Polygon', coordinates: [[[109.0, 12.0], [109.6, 12.5], [109.6, 12.0], [109.0, 12.5], [109.0, 12.0]]] };
    const unclosed = { type: 'Polygon', coordinates: [[[108.0, 12.0], [108.1, 12.0], [108.1, 12.1], [108.0, 12.1]]] };
    const a = await post({ roi: { source: 'drawn', geometry: bowtie } });
    expect(a.statusCode).toBe(400);
    expect(a.json().error.message).toBe('Vùng tự cắt nhau — hãy vẽ lại');
    expect((await post({ roi: { source: 'drawn', geometry: unclosed } })).statusCode).toBe(400);
  });
});
