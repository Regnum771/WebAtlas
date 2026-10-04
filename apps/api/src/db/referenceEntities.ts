import type { Pool } from 'pg';
import {
  REFERENCE_LAYER_KEYS,
  getReferenceLayer,
  type ReferenceLayerKey,
} from '../reference/registry';

/**
 * DBSCAN neighbourhood, in degrees, used to split one name/ref into separate
 * entities. ~0.02deg is ~2.2 km at this latitude: two stretches of road sharing a
 * ref but lying further apart than that are genuinely different objects on the
 * map, and unioning them would produce a sprawling multipart geometry whose
 * bounding box is useless as an ROI. minpoints = 1 so a lone segment still forms
 * its own cluster rather than being discarded as noise.
 */
export const CLUSTER_EPS_DEGREES = 0.02;

/**
 * Rebuilds the dissolved entities for ONE reference layer.
 *
 * This module is the single writer of basemap.reference_entities (spec §4: unlike
 * the water layers there is no edit path, so the derived table has exactly one
 * writer). Delete + insert per layer inside one transaction, so a reader never
 * sees a half-built layer and a failure leaves the previous build intact.
 *
 * The scan is sequential by design — see the migration's comment on why the raw
 * basemap tables carry no trigram index. Measured 2026-09-22 on the dev DB:
 * clustering roads_region (527k rows, 33k named) takes ~1.2s.
 */
export async function buildReferenceLayer(pool: Pool, key: ReferenceLayerKey): Promise<number> {
  const def = getReferenceLayer(key);

  // Every identifier below comes from the registry, never from a request.
  //
  // OSM `ref` is multi-valued: 930 road rows carry something like 'QL.14;HCM',
  // meaning that stretch belongs to BOTH Quốc lộ 14 and the Hồ Chí Minh route.
  // Grouping on the raw string would split QL.14 into two entities over a tagging
  // artefact, so each token becomes its own entity key and a segment may be a
  // member of more than one entity. Verified: with the unnest, QL.14 dissolves to
  // one ~998 km entity over 621 segments; without it, into several fragments.
  //
  // The LEFT JOIN LATERAL yields one row per ref token, or a single NULL row when
  // `ref` is absent — which is what makes the coalesce fall back to `name`.
  const refJoin = def.refColumn
    ? `LEFT JOIN LATERAL (
         SELECT nullif(btrim(x), '') AS tok
           FROM unnest(string_to_array(coalesce(t.${def.refColumn}, ''), ';')) AS x
       ) k ON true`
    : '';
  const refExpr = def.refColumn ? 'k.tok' : 'NULL::text';
  const entityKeyExpr = `coalesce(${refExpr}, t.${def.nameColumn})`;

  // Summable columns become a single jsonb object of sums, e.g. {"population": N}.
  const attrsExpr = def.summable.length
    ? `jsonb_build_object(${def.summable
        .map((c) => `'${c}', coalesce(sum(c.${c}), 0)`)
        .join(', ')})`
    : `'{}'::jsonb`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM basemap.reference_entities WHERE layer_key = $1', [key]);

    const { rowCount } = await client.query(
      `
      WITH src AS (
        SELECT t.${def.idColumn}::text  AS osm_id,
               t.${def.nameColumn}      AS name,
               ${refExpr}               AS ref,
               t.${def.classColumn}     AS fclass,
               t.${def.geomColumn}      AS geometry,
               ${entityKeyExpr}         AS entity_key
               ${def.summable.length ? ',' + def.summable.map((c) => `t.${c}`).join(', ') : ''}
          FROM ${def.table} t
          ${refJoin}
         WHERE ${entityKeyExpr} IS NOT NULL
           AND t.${def.geomColumn} IS NOT NULL
      ),
      raw AS (
        SELECT src.*,
               ST_ClusterDBSCAN(geometry, $2, 1) OVER (PARTITION BY entity_key) AS raw_cluster
          FROM src
      ),
      -- DBSCAN numbers clusters in the order rows reach its window, which follows the table's
      -- physical order: the same data loaded in another order got other numbers, and the number
      -- is part of the entity id. The grouping itself is stable, so each key's clusters are
      -- renumbered by their smallest member id ("C" collation: independent of the database
      -- locale). OSM ids repeat in the area tables, hence the geometry tie-break (little-endian
      -- bytes, so the same on every server); raw_cluster comes last only so two numbers can never
      -- collide. With minpoints = 1 no row is noise, so raw_cluster is never NULL and the join
      -- below keeps every row; raise minpoints and it would silently drop the noise rows.
      k AS (
        SELECT entity_key, raw_cluster,
               (row_number() OVER (
                  PARTITION BY entity_key
                  ORDER BY min(osm_id COLLATE "C"),
                           min(md5(ST_AsEWKB(geometry, 'NDR')) COLLATE "C"),
                           raw_cluster
                ) - 1)::int AS cluster_id
          FROM raw
         GROUP BY entity_key, raw_cluster
      ),
      c AS (
        SELECT raw.*, k.cluster_id
          FROM raw JOIN k USING (entity_key, raw_cluster)
      )
      INSERT INTO basemap.reference_entities
        (entity_id, layer_key, entity_key, cluster_id, name, ref, fclass,
         member_ids, member_count, attrs, geom)
      SELECT $1 || ':' || md5(c.entity_key) || ':' || c.cluster_id,
             $1,
             c.entity_key,
             c.cluster_id,
             -- The commonest spelling among the members; segments of one road
             -- occasionally disagree on capitalisation or diacritics.
             mode() WITHIN GROUP (ORDER BY c.name),
             mode() WITHIN GROUP (ORDER BY c.ref),
             mode() WITHIN GROUP (ORDER BY c.fclass),
             array_agg(c.osm_id ORDER BY c.osm_id),
             count(*)::int,
             ${attrsExpr},
             ST_Multi(ST_UnaryUnion(ST_Collect(c.geometry)))
        FROM c
       GROUP BY c.entity_key, c.cluster_id
      `,
      [key, CLUSTER_EPS_DEGREES]
    );

    await client.query('COMMIT');
    return rowCount ?? 0;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already ended */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Rebuilds every reference layer (or the named subset), returning rows per layer. */
export async function buildReferenceEntities(
  pool: Pool,
  keys: readonly ReferenceLayerKey[] = REFERENCE_LAYER_KEYS
): Promise<Record<ReferenceLayerKey, number>> {
  const counts = {} as Record<ReferenceLayerKey, number>;
  for (const key of keys) {
    counts[key] = await buildReferenceLayer(pool, key);
  }
  return counts;
}
