import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { allOf, viewCount, elevationBetween, fail, pass, rowCount, wfsAnswers, wmsAnswers } from './probes';
import type { ProbeContext } from './types';

const ctx = (over: Partial<ProbeContext> = {}): ProbeContext => ({
  pool: { query: vi.fn(async () => ({ rows: [{ n: '5' }] })) } as unknown as Pool,
  geoserver: vi.fn(async () => new Response('{}', { status: 200 })),
  ...over,
});

describe('rowCount', () => {
  it('passes at or above the minimum, naming the count', async () => {
    expect(await rowCount('roads', 'SELECT', 5)(ctx())).toEqual({ ok: true, detail: 'roads: 5' });
  });

  it('fails below it', async () => {
    const r = await rowCount('roads', 'SELECT', 6)(ctx());
    expect(r).toEqual({ ok: false, detail: 'roads: 5 (expected ≥ 6)' });
  });

  it('turns a query error into a failure naming the check', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('relation "x" does not exist'); }) } as unknown as Pool;
    const r = await rowCount('x', 'SELECT')(ctx({ pool }));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/^x: relation "x" does not exist$/);
  });
});

describe('allOf', () => {
  it('returns the first failure and runs nothing after it', async () => {
    const third = vi.fn(async () => pass('c'));
    const r = await allOf(async () => pass('a'), async () => fail('b broke'), third)(ctx());
    expect(r).toEqual({ ok: false, detail: 'b broke' });
    expect(third).not.toHaveBeenCalled();
  });

  it('joins the details when everything passes', async () => {
    expect(await allOf(async () => pass('a'), async () => pass('b'))(ctx())).toEqual({ ok: true, detail: 'a; b' });
  });

  it('turns a thrown check into a failure', async () => {
    const r = await allOf(async () => { throw new Error('GEOSERVER_URL is not set'); })(ctx());
    expect(r).toEqual({ ok: false, detail: 'GEOSERVER_URL is not set' });
  });
});

describe('wmsAnswers', () => {
  it('passes only on a PNG — a missing layer answers 200 with an XML exception', async () => {
    const png = ctx({ geoserver: async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }) });
    const xml = ctx({ geoserver: async () => new Response('<x/>', { status: 200, headers: { 'content-type': 'application/vnd.ogc.se_xml;charset=UTF-8' } }) });
    expect((await wmsAnswers('basemap', '1,2,3,4')(png)).ok).toBe(true);
    const r = await wmsAnswers('basemap', '1,2,3,4')(xml);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/webatlas:basemap WMS 200 application\/vnd\.ogc\.se_xml/);
  });

  it('asks for the layer in the webatlas workspace over the given bbox', async () => {
    const geoserver = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }));
    await wmsAnswers('contours_50', '108,12,108.2,12.2')(ctx({ geoserver }));
    expect(geoserver.mock.calls[0][0]).toMatch(/^\/wms\?.*layers=webatlas:contours_50.*bbox=108,12,108\.2,12\.2.*format=image\/png/);
  });
});

describe('wfsAnswers', () => {
  it('needs at least one feature', async () => {
    const one = ctx({ geoserver: async () => new Response(JSON.stringify({ features: [{}] }), { status: 200 }) });
    const none = ctx({ geoserver: async () => new Response(JSON.stringify({ features: [] }), { status: 200 }) });
    expect((await wfsAnswers('dams')(one)).ok).toBe(true);
    expect(await wfsAnswers('dams')(none)).toEqual({ ok: false, detail: 'webatlas:dams WFS returned no features' });
  });
});

describe('elevationBetween', () => {
  it('checks the sampled value against the range', async () => {
    const at = (v: string | null) => ctx({ pool: { query: vi.fn(async () => ({ rows: [{ v }] })) } as unknown as Pool });
    expect((await elevationBetween('BMT', 108, 12, 440, 500)(at('472.0'))).ok).toBe(true);
    expect((await elevationBetween('BMT', 108, 12, 440, 500)(at('12.0'))).ok).toBe(false);
    expect(await elevationBetween('BMT', 108, 12, 440, 500)(at(null))).toEqual({ ok: false, detail: 'BMT: no elevation (DEM not loaded there)' });
  });
});

describe('hardening', () => {
  it('allOf with no checks fails', async () => {
    expect(await allOf()(ctx())).toEqual({ ok: false, detail: 'no checks defined' });
  });

  it('wfs/wms failures never reject and name the layer', async () => {
    const thrower = ctx({ geoserver: (() => { throw new Error('GEOSERVER_URL is not set'); }) as never });
    const rejecter = ctx({ geoserver: async () => { throw new Error('timeout'); } });
    expect(await wfsAnswers('dams')(thrower)).toEqual({ ok: false, detail: 'webatlas:dams WFS: GEOSERVER_URL is not set' });
    expect(await wfsAnswers('dams')(rejecter)).toEqual({ ok: false, detail: 'webatlas:dams WFS: timeout' });
    expect(await wmsAnswers('basemap', '1,2,3,4')(thrower)).toEqual({ ok: false, detail: 'webatlas:basemap WMS: GEOSERVER_URL is not set' });
    expect(await wmsAnswers('basemap', '1,2,3,4')(rejecter)).toEqual({ ok: false, detail: 'webatlas:basemap WMS: timeout' });
  });

  it('wfs fails on an XML exception body and on a non-200', async () => {
    const xml = ctx({ geoserver: async () => new Response('<ows:ExceptionReport/>', { status: 200 }) });
    const bad = ctx({ geoserver: async () => new Response('no', { status: 404 }) });
    expect((await wfsAnswers('dams')(xml)).ok).toBe(false);
    expect(await wfsAnswers('dams')(bad)).toEqual({ ok: false, detail: 'webatlas:dams WFS 404' });
  });

  it('rowCount fails on an empty result set', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    expect((await rowCount('x', 'SELECT')(ctx({ pool }))).ok).toBe(false);
  });

  it('elevationBetween fails when no tile intersects', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    expect(await elevationBetween('BMT', 108, 12, 440, 500)(ctx({ pool }))).toEqual({ ok: false, detail: 'BMT: no elevation (DEM not loaded there)' });
  });

  it('viewCount rejects a bad identifier at definition time', () => {
    expect(() => viewCount('dams; DROP TABLE x')).toThrow(/invalid layer name/);
    expect(() => viewCount('Dams')).toThrow();
    expect(() => viewCount('dams')).not.toThrow();
  });
});
