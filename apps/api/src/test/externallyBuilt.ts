import type { Pool } from 'pg';

/**
 * Tables that neither the migrations nor atlas:seed fill: a tool CI cannot run builds them.
 * - the `scenario` schema: packages/atlas-data/tools/flood_scenario/build_scenarios.py, which reads
 *   the 720 MB Geofabrik extract;
 * - basemap.dem_region: the atlas build's DEM download (the migration creates it empty).
 * A database where the tool never ran (CI, a fresh test database) has them absent or empty.
 */
const EXTERNALLY_BUILT_SCHEMAS = ['scenario'];
const EXTERNALLY_BUILT_TABLES = ['basemap.dem_region'];

export function isExternallyBuilt(table: string): boolean {
  return EXTERNALLY_BUILT_SCHEMAS.includes(table.split('.')[0]) || EXTERNALLY_BUILT_TABLES.includes(table);
}

/**
 * False only for an externally built table that is absent or holds no rows, so checks against the
 * live schema skip what this database never built and still check it wherever it was built.
 */
export async function isBuiltHere(pool: Pool, table: string): Promise<boolean> {
  if (!isExternallyBuilt(table)) return true;
  const { rows } = await pool.query<{ rel: string | null }>(`SELECT to_regclass($1)::text AS rel`, [table]);
  if (!rows[0].rel) return false;
  const filled = await pool.query(`SELECT 1 FROM ${rows[0].rel} LIMIT 1`);
  return filled.rowCount! > 0;
}
