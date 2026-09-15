import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool, closePool } from '../../db/pool';

let app: ReturnType<typeof buildApp>;

/**
 * Whether THIS machine has run the DEM load (docs/runbooks/elevation-dem.md). The data is
 * the one dataset that does not arrive with a checkout, so the value assertions below are
 * conditional — on a box without it they would fail for a reason that is not a defect.
 * The contract assertions (validation, response shape, status vocabulary) always run.
 *
 * Probed at MODULE scope, deliberately. `it.skipIf(...)` is evaluated when the test is
 * COLLECTED, which happens before any `beforeAll` body runs — setting this in beforeAll
 * leaves it false at collection time and silently skips both value tests on a machine
 * that does have the data. That failure is invisible in a green run, which is exactly
 * what makes it worth a comment.
 */
const demLoaded = await (async () => {
  const { rows } = await getPool().query<{ loaded: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'basemap' AND table_name = 'dem_region'
     ) AS loaded`
  );
  if (!rows[0].loaded) return false;
  const { rows: any } = await getPool().query<{ n: string }>(
    'SELECT count(*)::text AS n FROM (SELECT 1 FROM basemap.dem_region LIMIT 1) t'
  );
  return Number(any[0].n) > 0;
})();

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});

/** Buôn Ma Thuột: a broad basalt plateau, so the expected value is insensitive to being a few
 *  hundred metres off. 472.2 m on FABDEM; it was 473.9 m on the Copernicus load this pipeline
 *  started with — bare earth reads lower, and this assertion is what caught the switch. */
const BMT = { lon: 108.0447, lat: 12.6797, elevationM: 472.2 };

describe('GET /api/elevation', () => {
  it('rejects a request with no coordinates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/elevation' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a coordinate outside Vietnam rather than answering for it', async () => {
    // Paris. Without the bounds check this would be an honest-looking "no data here",
    // which is a worse answer than a refusal: it implies the question was reasonable.
    const res = await app.inject({ method: 'GET', url: '/api/elevation?lon=2.35&lat=48.86' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-numeric coordinate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/elevation?lon=abc&lat=12' });
    expect(res.statusCode).toBe(400);
  });

  it('answers 200 with a known status for a point inside the region', async () => {
    // 200 even when there is no value: "no elevation here" and "DEM not loaded" are
    // ordinary outcomes for a readout that fires on cursor movement, and making them
    // errors would fill the browser console on every pan past the coast.
    const res = await app.inject({ method: 'GET', url: `/api/elevation?lon=${BMT.lon}&lat=${BMT.lat}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; elevationM: number | null; source: string | null };
    expect(['ok', 'nodata', 'unavailable']).toContain(body.status);
  });

  it.skipIf(!demLoaded)('reports the real elevation, and credits the source', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/elevation?lon=${BMT.lon}&lat=${BMT.lat}` });
    const body = res.json() as { status: string; elevationM: number; source: string };
    expect(body.status).toBe('ok');
    expect(body.elevationM).toBeCloseTo(BMT.elevationM, 1);
    // The licence requires the source wherever the number surfaces, so this is a
    // condition of shipping the endpoint, not cosmetics.
    expect(body.source).toBe('FABDEM V1-2');
  });

  it.skipIf(!demLoaded)('returns nodata, not zero, for a point off the covered coverage', async () => {
    // Inside the Vietnam bounds check but outside the six clipped provinces: open sea
    // east of Khánh Hoà. Reporting 0 m here would put a boat at sea level on purpose.
    const res = await app.inject({ method: 'GET', url: '/api/elevation?lon=109.9&lat=12.0' });
    const body = res.json() as { status: string; elevationM: number | null };
    expect(body.status).toBe('nodata');
    expect(body.elevationM).toBeNull();
  });
});
