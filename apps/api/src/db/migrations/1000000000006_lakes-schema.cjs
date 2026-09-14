/* eslint-disable camelcase */
exports.shorthands = undefined;

const COMMON = (pgm) => ({
  id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  created_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
  updated_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
});

exports.up = (pgm) => {
  const tbl = { schema: 'water', name: 'lakes' };
  pgm.createTable(tbl, {
    ...COMMON(pgm),
    name: { type: 'text' },
    external_id: { type: 'integer' },
    lake_type: { type: 'text' },
    area_km2: { type: 'numeric' },
    volume_mcm: { type: 'numeric' },
    shore_len_km: { type: 'numeric' },
    geom: { type: 'geometry(MultiPolygon, 4326)', notNull: true },
    dataset_version_id: {
      type: 'uuid', notNull: true,
      references: { schema: 'app', name: 'dataset_versions' },
    },
    deleted: { type: 'boolean', notNull: true, default: false },
  });
  pgm.createIndex(tbl, 'geom', { method: 'gist' });
  pgm.createIndex(tbl, 'dataset_version_id');
  pgm.createIndex(tbl, ['dataset_version_id', 'external_id'], { unique: true });

  pgm.sql(`
    CREATE VIEW water.lakes_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = 'lakes' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.lakes t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    SELECT * FROM resolved WHERE NOT deleted;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS water.lakes_active;');
  pgm.dropTable({ schema: 'water', name: 'lakes' });
};
