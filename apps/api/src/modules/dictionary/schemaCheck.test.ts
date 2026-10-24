import { describe, it, expect, afterAll } from 'vitest';
import { BOOKKEEPING_COLUMNS, DICTIONARY, type DictFeatureType } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';

// Read-only: compares the code dictionary with the live dev database's catalogue.
afterAll(async () => { await closePool(); });

// Raster tables are covered in Task 4; only vector entries with a table are checked here.
const checked: DictFeatureType[] = Object.values(DICTIONARY).filter(
  (ft) => ft.kind === 'vector' && ft.table !== undefined,
);

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

async function geometryColumns(table: string): Promise<{ column: string; type: string; srid: number }[]> {
  const { schema, name } = splitTable(table);
  const { rows } = await getPool().query<{ f_geometry_column: string; type: string; srid: number }>(
    `SELECT f_geometry_column, type, srid FROM geometry_columns
      WHERE f_table_schema = $1 AND f_table_name = $2`,
    [schema, name],
  );
  return rows.map((r) => ({ column: r.f_geometry_column, type: r.type, srid: r.srid }));
}

describe('dictionary matches the database schema', () => {
  it('checks at least the eight editable layers', () => {
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });

  it('every non-bookkeeping column of each table has an attribute', async () => {
    const missing: string[] = [];
    for (const ft of checked) {
      const columns = await tableColumns(ft.table!);
      expect(columns.length, `${ft.table} has no columns (does it exist?)`).toBeGreaterThan(0);
      const geometry = new Set((await geometryColumns(ft.table!)).map((g) => g.column));
      const named = new Set(ft.attributes.filter((a) => a.source === 'column').map((a) => a.name));
      for (const c of columns) {
        if (BOOKKEEPING_COLUMNS.includes(c) || geometry.has(c)) continue;
        if (!named.has(c)) missing.push(`${ft.key}.${c}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no column attribute names a missing column', async () => {
    const extra: string[] = [];
    for (const ft of checked) {
      const columns = new Set(await tableColumns(ft.table!));
      for (const a of ft.attributes) {
        if (a.source === 'column' && !columns.has(a.name)) extra.push(`${ft.key}.${a.name}`);
      }
    }
    expect(extra).toEqual([]);
  });

  it('geometry type and SRID match the table', async () => {
    const wrong: string[] = [];
    for (const ft of checked) {
      const geoms = await geometryColumns(ft.table!);
      if (geoms.length !== 1) {
        wrong.push(`${ft.key}: expected one geometry column, found ${geoms.length}`);
        continue;
      }
      const [g] = geoms;
      if (g.type !== ft.geometryType!.toUpperCase()) wrong.push(`${ft.key}: type ${g.type} vs ${ft.geometryType}`);
      if (g.srid !== ft.crs) wrong.push(`${ft.key}: srid ${g.srid} vs ${ft.crs}`);
    }
    expect(wrong).toEqual([]);
  });
});
