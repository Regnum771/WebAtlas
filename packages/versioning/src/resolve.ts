const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * The one definition of what a version resolves to. `$1` is the version id: its chain is the
 * version and its ancestors; per external_id the nearest version's row wins, and a tombstone
 * there removes the feature (the filter runs after DISTINCT ON, so a tombstone suppresses the
 * inherited row instead of letting it resurface). `select` names the columns to return from
 * the resolved rows.
 *
 * Used to set the current flag at activation, to resolve a version that is not active yet
 * (the river hierarchy and gates, during activation), and by resolveFeatureIds. The active
 * state itself is read from the water.<layer>_active views, never through this.
 */
export function resolvedSql(layerKey: string, select = 'id'): string {
  if (!IDENTIFIER.test(layerKey)) throw new Error(`resolvedSql: "${layerKey}" is not a layer key`);
  return `
    WITH RECURSIVE chain AS (
      SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layerKey} t JOIN chain c ON t.dataset_version_id = c.id
       ORDER BY t.external_id, c.depth
    )
    SELECT ${select} FROM resolved WHERE NOT deleted`;
}
