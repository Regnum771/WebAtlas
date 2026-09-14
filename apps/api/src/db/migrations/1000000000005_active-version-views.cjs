/* eslint-disable camelcase */
exports.shorthands = undefined;

const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

function viewSql(layer) {
  return `
    CREATE VIEW water.${layer}_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${layer}' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      -- Nearest version in the chain wins per external_id (lowest depth first).
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layer} t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    -- Tombstone check happens *after* DISTINCT ON picks the nearest row, so a
    -- tombstone in a nearer version suppresses an ancestor's stale row rather
    -- than letting it resurface.
    SELECT * FROM resolved WHERE NOT deleted;
  `;
}

exports.up = (pgm) => {
  for (const layer of THEMATIC) {
    pgm.sql(viewSql(layer));
  }
};

exports.down = (pgm) => {
  for (const layer of THEMATIC) {
    pgm.sql(`DROP VIEW IF EXISTS water.${layer}_active;`);
  }
};
