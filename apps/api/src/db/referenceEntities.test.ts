import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { buildReferenceEntities, buildReferenceLayer } from './referenceEntities';

const pool = getPool();

// The builder rewrites the whole table, which is also what a real run does; there
// is no other writer, so no cleanup is owed beyond leaving it populated.
beforeAll(async () => {
  await buildReferenceEntities(pool);
}, 300_000);

afterAll(async () => {
  await closePool();
});

describe('reference entity dissolve', () => {
  it('writes entities for every in-scope layer', async () => {
    const { rows } = await pool.query<{ layer_key: string; n: string }>(
      'SELECT layer_key, count(*)::text AS n FROM basemap.reference_entities GROUP BY layer_key'
    );
    const byLayer = Object.fromEntries(rows.map((r) => [r.layer_key, Number(r.n)]));
    for (const key of ['roads', 'railways', 'water', 'landuse', 'places']) {
      expect(byLayer[key], `expected entities for ${key}`).toBeGreaterThan(0);
    }
  });

  it('collapses many segments into fewer entities', async () => {
    const { rows } = await pool.query<{ entities: string; members: string }>(
      `SELECT count(*)::text AS entities, sum(member_count)::text AS members
         FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    const entities = Number(rows[0].entities);
    const members = Number(rows[0].members);
    // Measured 2026-09-22: 13,354 entities over 34,190 member rows.
    //
    // Deliberately a weak ratio. The entity count is NOT simply the count of
    // distinct names: DBSCAN splits spatially disjoint groups sharing a name, and
    // there are hundreds of separate streets called "Đường số 1" in different
    // towns — correctly separate entities. The real proof of the dissolve is the
    // QL.14 test below, not this ratio.
    expect(members).toBeGreaterThan(entities);
  });

  it('never writes an entity with no name and no ref', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE coalesce(ref, name) IS NULL`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('gives every entity a deterministic id and a non-empty member list', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE entity_id !~ '^[a-z]+:[0-9a-f]{32}:[0-9]+$'
           OR array_length(member_ids, 1) IS NULL
           OR member_count <> array_length(member_ids, 1)`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('numbers the clusters of one key from 0 with no gaps', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT 1 FROM basemap.reference_entities
          GROUP BY layer_key, entity_key
         HAVING min(cluster_id) <> 0 OR max(cluster_id) <> count(*) - 1
       ) x`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('orders the clusters of one key by their smallest member id, not by table row order', async () => {
    // DBSCAN numbers clusters in the order rows reach its window, which follows the table's
    // physical order. The same data loaded in another order then produced other entity ids
    // (measured 2026-10-04: 11,005 road member rows numbered differently). Ties on the member id
    // are broken by geometry, so they are sorted by cluster_id here and cannot count as violations.
    const { rows } = await pool.query<{ n: string }>(
      `WITH e AS (
         SELECT layer_key, entity_key, cluster_id,
                (SELECT min(m COLLATE "C") FROM unnest(member_ids) AS m) AS first_member
           FROM basemap.reference_entities
       ), o AS (
         SELECT cluster_id,
                lag(cluster_id) OVER (PARTITION BY layer_key, entity_key ORDER BY first_member, cluster_id) AS prev
           FROM e
       )
       SELECT count(*)::text AS n FROM o WHERE prev IS NOT NULL AND cluster_id < prev`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('dissolves a multi-segment national road into one entity per cluster', async () => {
    // Quốc lộ 14 runs the length of the Central Highlands: many OSM ways, one ref.
    // Note the dot — the live values are 'QL.14', not 'QL14'.
    const { rows } = await pool.query<{ entity_key: string; member_count: number; km: number }>(
      `SELECT entity_key, member_count,
              (ST_Length(geom::geography) / 1000)::float8 AS km
         FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND entity_key = 'QL.14'
        ORDER BY member_count DESC`
    );
    expect(rows.length).toBeGreaterThan(0);
    // Measured 2026-09-22: one cluster, 621 members, ~998 km — the real road.
    expect(rows[0].member_count).toBeGreaterThan(100);
    expect(rows[0].km).toBeGreaterThan(500);
  });

  it('unnests a compound ref so a shared segment joins both routes', async () => {
    // 513 road rows are tagged 'QL.14;HCM': that stretch carries Quốc lộ 14 AND
    // the Hồ Chí Minh route, so it must be a member of both entities.
    const { rows } = await pool.query<{ entity_key: string }>(
      `SELECT entity_key FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND entity_key IN ('QL.14', 'HCM')`
    );
    const keys = new Set(rows.map((r) => r.entity_key));
    expect(keys.has('QL.14')).toBe(true);
    expect(keys.has('HCM')).toBe(true);
    // And no entity key still carries the raw compound string.
    const { rows: compound } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE entity_key LIKE '%;%'`
    );
    expect(Number(compound[0].n)).toBe(0);
  });

  it('sums the registry summable columns into attrs for places', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE layer_key = 'places' AND attrs ? 'population'`
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it('leaves attrs empty for layers with no summable columns', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE layer_key <> 'places' AND attrs <> '{}'::jsonb`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('stores valid 4326 geometry for every entity', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE geom IS NULL OR ST_SRID(geom) <> 4326 OR NOT ST_IsValid(geom)`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('is idempotent: rebuilding one layer replaces rather than duplicates', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'railways'`
    );
    await buildReferenceLayer(pool, 'railways');
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'railways'`
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 120_000);

  it('rebuilding one layer does not touch another', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    await buildReferenceLayer(pool, 'railways');
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 120_000);
});
