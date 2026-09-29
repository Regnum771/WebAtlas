import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { LAYER_REGISTRY } from '../layers/registry';
import { RIVERS_HYDRO_LAYER } from './seeds/ingestRivers';

afterAll(async () => { await closePool(); });

describe('rivers identity space', () => {
  it('holds external_id as text in the catalog', async () => {
    const { rows } = await getPool().query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers'
          AND column_name = 'external_id'`
    );
    expect(rows[0].data_type).toBe('text');
  });

  it('stores every active external_id with a known source prefix', async () => {
    const { rows } = await getPool().query<{ total: string; prefixed: string; bare: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE external_id ~ '^(osm|hyriv|river|edit):')::text AS prefixed,
              count(*) FILTER (WHERE external_id ~ '^[0-9]+$')::text AS bare
         FROM water.rivers_active`
    );
    // The seeded OSM waterways layer; asserted as a floor so a later ingest can grow it.
    expect(Number(rows[0].total)).toBeGreaterThan(9000);
    // Every row, not most: an unprefixed id is ambiguous against HydroRIVERS.
    expect(rows[0].prefixed).toBe(rows[0].total);
    expect(rows[0].bare).toBe('0');
  });

  it('declares rivers as a text-id layer so a minted id is a uuid string', () => {
    expect(LAYER_REGISTRY.rivers.externalIdType).toBe('text');
  });

  it('prefixes the id the OSM ingest writes', () => {
    const cols = RIVERS_HYDRO_LAYER.columns({ osmId: 12207485, name: 'Sông Thu Bồn' }, 0);
    expect(cols.external_id).toBe('osm:12207485');
  });
});
