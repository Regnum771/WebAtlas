import { describe, it, expect, afterAll } from 'vitest';
import { BOOKKEEPING_COLUMNS, DICTIONARY, type DictFeatureType } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';

// Read-only: compares the code dictionary with the live dev database's catalogue.
afterAll(async () => { await closePool(); });

// Every entry backed by a table, vector or raster. Flood depth has no table (Ruling 3) and is skipped.
const keyed: DictFeatureType[] = Object.values(DICTIONARY).filter((ft) => ft.table !== undefined);
const vectors = keyed.filter((ft) => ft.kind === 'vector');
const rasters = keyed.filter((ft) => ft.kind === 'raster');

function splitTable(table: string): { schema: string; name: string } {
  const [schema, name] = table.split('.');
  return { schema, name };
}

async function tableColumns(table: string): Promise<string[]> {
  const { schema, name } = splitTable(table);
  const { rows } = await getPool().query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, name],
  );
  return rows.map((r) => r.column_name);
}

// Geometry and raster columns are found by their type, whatever they are named (geom, geometry, centroid, rast).
async function spatialColumns(table: string): Promise<Set<string>> {
  const { schema, name } = splitTable(table);
  const { rows } = await getPool().query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND udt_name IN ('geometry', 'raster')`,
    [schema, name],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function geometryColumns(table: string): Promise<{ column: string; type: string; srid: number }[]> {
  const { schema, name } = splitTable(table);
  const { rows } = await getPool().query<{ f_geometry_column: string; type: string; srid: number }>(
    `SELECT f_geometry_column, type, srid FROM geometry_columns
      WHERE f_table_schema = $1 AND f_table_name = $2`,
    [schema, name],
  );
  return rows.map((r) => ({ column: r.f_geometry_column, type: r.type, srid: r.srid }));
}

/**
 * The stored types of a generic GEOMETRY column, folded to their multi form (a Polygon is a
 * one-part MultiPolygon), so a column mixing the two reads as one type.
 */
async function storedMultiTypes(table: string, column: string): Promise<string[]> {
  const { rows } = await getPool().query<{ t: string }>(
    `SELECT DISTINCT GeometryType(ST_Multi(${quoteIdent(column)})) AS t FROM ${quoteTable(table)}
      WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY 1`,
  );
  return rows.map((r) => r.t);
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function quoteTable(table: string): string {
  const { schema, name } = splitTable(table);
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

describe('dictionary matches the database schema', () => {
  it('checks every table-backed entry: eight editable layers, nine read-only layers and the DEM', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(17);
    expect(rasters.map((ft) => ft.key)).toContain('dem');
  });

  it('every non-bookkeeping column of each table has an attribute', async () => {
    const missing: string[] = [];
    for (const ft of keyed) {
      const columns = await tableColumns(ft.table!);
      expect(columns.length, `${ft.table} has no columns (does it exist?)`).toBeGreaterThan(0);
      const spatial = await spatialColumns(ft.table!);
      const named = new Set(ft.attributes.filter((a) => a.source === 'column').map((a) => a.name));
      for (const c of columns) {
        if (BOOKKEEPING_COLUMNS.includes(c) || spatial.has(c)) continue;
        if (!named.has(c)) missing.push(`${ft.key}.${c}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no column attribute names a missing column', async () => {
    const extra: string[] = [];
    for (const ft of keyed) {
      const columns = new Set(await tableColumns(ft.table!));
      for (const a of ft.attributes) {
        if (a.source === 'column' && !columns.has(a.name)) extra.push(`${ft.key}.${a.name}`);
      }
    }
    expect(extra).toEqual([]);
  });

  it('geometry type and SRID match the table', async () => {
    const wrong: string[] = [];
    for (const ft of vectors) {
      const geoms = await geometryColumns(ft.table!);
      if (geoms.length !== 1) {
        wrong.push(`${ft.key}: expected one geometry column, found ${geoms.length}`);
        continue;
      }
      const [g] = geoms;
      const expected = ft.geometryType!.toUpperCase();
      if (g.type === 'GEOMETRY') {
        // A generic column: every stored geometry must be the entry's type (or its one-part form).
        const stored = await storedMultiTypes(ft.table!, g.column);
        if (stored.length !== 1 || stored[0] !== expected) {
          wrong.push(`${ft.key}: stored types ${stored.join(',')} vs ${ft.geometryType}`);
        }
      } else if (g.type !== expected) {
        wrong.push(`${ft.key}: type ${g.type} vs ${ft.geometryType}`);
      }
      if (g.srid !== ft.crs) wrong.push(`${ft.key}: srid ${g.srid} vs ${ft.crs}`);
    }
    expect(wrong).toEqual([]);
  });

  it('raster entries with a table point at a raster column', async () => {
    const wrong: string[] = [];
    for (const ft of rasters) {
      const { schema, name } = splitTable(ft.table!);
      const { rows } = await getPool().query<{ srid: number; num_bands: number; nodata_values: number[] | null }>(
        `SELECT srid, num_bands, nodata_values FROM raster_columns
          WHERE r_table_schema = $1 AND r_table_name = $2`,
        [schema, name],
      );
      if (rows.length !== 1) {
        wrong.push(`${ft.key}: expected one raster column, found ${rows.length}`);
        continue;
      }
      const [r] = rows;
      const bands = ft.attributes.filter((a) => a.source === 'band');
      if (r.srid !== ft.crs) wrong.push(`${ft.key}: srid ${r.srid} vs ${ft.crs}`);
      if (r.num_bands !== bands.length) wrong.push(`${ft.key}: ${r.num_bands} bands vs ${bands.length} band attributes`);
      for (const b of bands) {
        const stored = r.nodata_values?.[Number(b.name) - 1] ?? undefined;
        if (stored !== b.nodata) wrong.push(`${ft.key}.${b.name}: nodata ${stored} vs ${b.nodata}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
