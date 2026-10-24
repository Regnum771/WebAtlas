import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DictAttribute, DictFeatureType } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool, closePool } from '../../db/pool';
import { runSync } from './sync';
import { csvTemplate } from './template';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  await runSync(getPool(), { dryRun: false });
  app = buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

const RASTER_404 = { error: { code: 'NOT_FOUND', message: 'Lớp ảnh không có tệp mẫu.' } };

async function currentColumns(key: string): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/api/dictionary/${key}` });
  const ft = res.json() as DictFeatureType;
  return ft.attributes.filter((a) => a.source === 'column' && !a.validTo).map((a) => a.name);
}

describe('GET /api/dictionary/:layer/template.csv', () => {
  it('the CSV template has the dam columns and lon/lat', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dictionary/dams/template.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    // UTF-8 BOM, then exactly one CRLF-terminated header line.
    expect([...res.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = res.rawPayload.subarray(3).toString('utf8');
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(2);
    const header = text.split('\r\n')[0]!;
    const columns = await currentColumns('dams');
    expect(columns.length).toBeGreaterThan(0);
    expect(header.startsWith(`${columns.join(',')},`)).toBe(true);
    expect(header.endsWith(',kinh_do,vi_do')).toBe(true);
    expect(header).toBe([...columns, 'kinh_do', 'vi_do'].join(','));
  });
});

describe('GET /api/dictionary/:layer/template.gpkg', () => {
  it('the GeoPackage template opens and has the right table', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dictionary/lakes/template.gpkg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/geopackage+sqlite3');

    const path = join(tmpdir(), `dd-template-test-${randomUUID()}.gpkg`);
    await writeFile(path, res.rawPayload);
    try {
      // Lazy, like the module under test: only this path triggers the ExperimentalWarning.
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        expect(db.prepare('PRAGMA application_id').get()).toEqual({ application_id: 0x47504b47 });
        expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 10300 });

        const srs = db.prepare('SELECT srs_id FROM gpkg_spatial_ref_sys ORDER BY srs_id').all();
        expect(srs.map((r) => r.srs_id)).toEqual([-1, 0, 4326]);

        const contents = db.prepare("SELECT * FROM gpkg_contents WHERE table_name = 'lakes'").get();
        expect(contents).toMatchObject({ table_name: 'lakes', data_type: 'features', identifier: 'lakes', srs_id: 4326 });

        const geom = db.prepare("SELECT * FROM gpkg_geometry_columns WHERE table_name = 'lakes'").get();
        expect(geom).toEqual({
          table_name: 'lakes', column_name: 'geom', geometry_type_name: 'MULTIPOLYGON', srs_id: 4326, z: 0, m: 0,
        });

        const info = db.prepare('PRAGMA table_info(lakes)').all() as { name: string; type: string; pk: number }[];
        const types = Object.fromEntries(info.map((c) => [c.name, c.type]));
        expect(info[0]).toMatchObject({ name: 'fid', type: 'INTEGER', pk: 1 });
        expect(types.geom).toBe('MULTIPOLYGON');
        expect(types.volume_mcm).toBe('REAL');
        expect(types.lake_type).toBe('TEXT');
        expect(info.slice(2).map((c) => c.name)).toEqual(await currentColumns('lakes'));

        expect(db.prepare('SELECT count(*) AS n FROM lakes').get()).toEqual({ n: 0 });
      } finally {
        db.close();
      }
    } finally {
      await unlink(path);
    }
  });
});

describe('template errors and names', () => {
  it('a raster layer has no template', async () => {
    for (const ext of ['csv', 'gpkg']) {
      const res = await app.inject({ method: 'GET', url: `/api/dictionary/dem/template.${ext}` });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(RASTER_404);
    }
    const unknown = await app.inject({ method: 'GET', url: '/api/dictionary/khong_co/template.csv' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Không có lớp "khong_co" trong từ điển dữ liệu.' },
    });
  });

  it('the template file name is mau-<key>', async () => {
    const csv = await app.inject({ method: 'GET', url: '/api/dictionary/rivers/template.csv' });
    expect(csv.headers['content-disposition']).toBe('attachment; filename="mau-rivers.csv"');
    const gpkg = await app.inject({ method: 'GET', url: '/api/dictionary/dams/template.gpkg' });
    expect(gpkg.headers['content-disposition']).toBe('attachment; filename="mau-dams.gpkg"');
  });
});

describe('csvTemplate', () => {
  const attr = (name: string, extra: Partial<DictAttribute> = {}): DictAttribute => ({
    name, source: 'column', valueType: 'text', label: name, definition: 'd', validFrom: '2020-01-01', ...extra,
  });
  const lineType: DictFeatureType = {
    key: 'line', kind: 'vector', name: 'Tuyến', definition: 'd', crs: 4326, geometryType: 'LineString',
    geometryMeaning: 'exact', validFrom: '2020-01-01',
    attributes: [
      attr('a'), attr('old', { validTo: '2025-01-01' }), attr('x', { source: 'extra' }), attr('b,c'), attr('d'),
    ],
  };

  it('keeps only current column attributes, ends line layers with wkt, and quotes only when needed', () => {
    expect(csvTemplate(lineType)).toBe('﻿a,"b,c",d,wkt\r\n');
  });
});
