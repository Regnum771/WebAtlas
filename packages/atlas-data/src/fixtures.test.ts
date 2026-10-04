import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { REFERENCE_LAYER_KEYS } from '@webatlas/shared';
import { REPO_ROOT } from './paths';

/**
 * The committed CI fixture (spec 2026-10-04-ci-basemap-fixture-design.md): what MANIFEST.json says
 * must be what the directory holds. That the fixture reproduces a real atlas's reference entities
 * is checked in CI by `basemap_fixture.py verify`, not here.
 */
const DIR = join(REPO_ROOT, 'packages/atlas-data/fixtures/basemap');

interface FixtureFile { table: string; file: string; rule: string; columns: string[]; rows: number; sha256: string }
interface Manifest {
  source: { extract: string; licence: string; attribution: string };
  schema: { file: string; sha256: string };
  files: FixtureFile[];
  referenceEntities: Record<string, { count: number; sha256: string }>;
}
const manifest = JSON.parse(readFileSync(join(DIR, 'MANIFEST.json'), 'utf8')) as Manifest;

describe('the committed basemap fixture', () => {
  it('holds exactly the five tables the reference layers and locate_place read', () => {
    expect(manifest.files.map((f) => f.table).sort()).toEqual([
      'basemap.landuse_region', 'basemap.places_region', 'basemap.railways_vn',
      'basemap.roads_region', 'basemap.water_region',
    ]);
  });

  it('keeps every row the reference build can read: named or numbered roads, named areas, all rail and places', () => {
    const rule = Object.fromEntries(manifest.files.map((f) => [f.table, f.rule]));
    expect(rule).toEqual({
      'basemap.roads_region': 'name IS NOT NULL OR ref IS NOT NULL',
      'basemap.water_region': 'name IS NOT NULL',
      'basemap.landuse_region': 'name IS NOT NULL',
      'basemap.railways_vn': 'TRUE',
      'basemap.places_region': 'TRUE',
    });
  });

  it('each file matches its sha256, row count and column list', () => {
    for (const f of manifest.files) {
      const gz = readFileSync(join(DIR, f.file));
      expect(createHash('sha256').update(gz).digest('hex'), f.file).toBe(f.sha256);
      const lines = gunzipSync(gz).toString('utf8').split('\n');
      expect(lines.pop(), `${f.file} ends with a newline`).toBe('');
      expect(lines.length, f.file).toBe(f.rows);
      expect(f.rows, f.file).toBeGreaterThan(0);
      const widths = new Set(lines.map((l) => l.split('\t').length));
      expect([...widths], `${f.file} columns`).toEqual([f.columns.length]);
      expect(f.columns).toContain('osm_id');
      expect(f.columns).toContain('geometry');
    }
  });

  it('has no dump that the manifest does not name', () => {
    const dumps = readdirSync(DIR).filter((n) => n.endsWith('.copy.gz')).sort();
    expect(dumps).toEqual(manifest.files.map((f) => f.file).sort());
  });

  it('schema.sql matches its sha256 and creates exactly the five tables, with their geometry and fclass indexes', () => {
    // load runs this file verbatim, so it is checksummed like the data.
    expect(manifest.schema.file).toBe('schema.sql');
    expect(createHash('sha256').update(readFileSync(join(DIR, 'schema.sql'))).digest('hex')).toBe(manifest.schema.sha256);
    const schema = readFileSync(join(DIR, 'schema.sql'), 'utf8');
    const tables = [...schema.matchAll(/^CREATE TABLE (basemap\.[a-z_]+) \(/gm)].map((m) => m[1]).sort();
    expect(tables).toEqual(manifest.files.map((f) => f.table).sort());
    expect([...schema.matchAll(/^CREATE INDEX /gm)]).toHaveLength(10);
    // Statements a different pg_dump version would add, and that an older psql rejects.
    expect(schema).not.toMatch(/^(SET |SELECT pg_catalog|\\)/m);
  });

  it('records the entity count and digest of every reference layer', () => {
    expect(Object.keys(manifest.referenceEntities).sort()).toEqual([...REFERENCE_LAYER_KEYS].sort());
    for (const [layer, e] of Object.entries(manifest.referenceEntities)) {
      expect(e.count, layer).toBeGreaterThan(0);
      expect(e.sha256, layer).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('names the extract it was cut from and its licence', () => {
    expect(manifest.source.extract).toMatch(/^vietnam-\d{6}-free\.shp\.zip$/);
    expect(manifest.source.licence).toBe('ODbL-1.0');
    expect(manifest.source.attribution).toContain('OpenStreetMap');
  });
});
