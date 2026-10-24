import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateDictionary, type Dictionary, type DictFeatureType } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool, closePool } from '../../db/pool';
import { runSync } from './sync';
import { assemble } from './service';
import type { AttributeRow, FeatureTypeRow } from './repository';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  await runSync(getPool(), { dryRun: false });
  app = buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

interface Served { version: string; featureTypes: DictFeatureType[] }

describe('GET /api/dictionary', () => {
  it('lists every feature type without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dictionary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Served;
    expect(body.featureTypes.map((f) => f.key)).toContain('dams');
    const lakes = body.featureTypes.find((f) => f.key === 'lakes')!;
    expect(lakes.attributes.find((a) => a.name === 'volume_mcm')!.storedUnit).toBe('10*6.m3');
  });

  it('round-trips into the shared types, with no internal columns and no nulls', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dictionary' });
    const { featureTypes } = res.json() as Served;
    const byKey: Dictionary = Object.fromEntries(featureTypes.map((f) => [f.key, f]));
    expect(validateDictionary(byKey)).toEqual([]);
    expect(res.body).not.toMatch(/"(origin|revision|synced_at)"/);
    expect(res.body).not.toContain(':null');
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/dictionary' });
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    const again = await app.inject({ method: 'GET', url: '/api/dictionary', headers: { 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    const other = await app.inject({ method: 'GET', url: '/api/dictionary', headers: { 'if-none-match': '"stale"' } });
    expect(other.statusCode).toBe(200);
  });
});

describe('GET /api/dictionary/:layer', () => {
  it('serves one layer by key, and 404 with the Vietnamese message for an unknown key', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/dictionary/dams' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as DictFeatureType).key).toBe('dams');

    const missing = await app.inject({ method: 'GET', url: '/api/dictionary/khong_co' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Không có lớp "khong_co" trong từ điển dữ liệu.' },
    });
  });
});

describe('a retired feature type', () => {
  it('is served with its validTo, and its attributes inherit it unless they have their own', () => {
    const type: FeatureTypeRow = {
      key: 'old', kind: 'vector', name: 'Cũ', definition: 'd', table_name: null, crs: 4326,
      geometry_type: 'Point', geometry_meaning: 'exact', valid_from: '2020-01-01', valid_to: '2026-01-01',
    };
    const attr = (name: string, valid_to: string | null): AttributeRow => ({
      feature_type: 'old', name, source: 'column', value_type: 'text', label: name, definition: 'd',
      stored_unit: null, display_units: [], display_unit: null, precision: null, cf_standard_name: null,
      code_list: null, nodata: null, scale: null, value_offset: null, valid_from: '2020-01-01', valid_to,
    });
    const [served] = assemble([type], [attr('a', null), attr('b', '2025-06-01')], []);
    expect(served!.validTo).toBe('2026-01-01');
    expect(served!.attributes[0]!.validTo).toBe('2026-01-01');
    expect(served!.attributes[1]!.validTo).toBe('2025-06-01');
    expect(validateDictionary({ old: served! })).toEqual([]);
  });
});
