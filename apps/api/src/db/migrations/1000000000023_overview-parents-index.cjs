/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Serves the "level-1 rivers having a stream_order-5 way" subquery of the far-zoom river tile
 * (and of water.rivers_overview): without it, every tile scans ~5,900 heap blocks of
 * level-3 rows to find their parents.
 */
exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX rivers_overview_parents_idx ON water.rivers (parent_external_id)
             WHERE is_current AND feature_level = 3 AND stream_order = 5`);
  pgm.sql(`ANALYZE water.rivers`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS water.rivers_overview_parents_idx`);
};
