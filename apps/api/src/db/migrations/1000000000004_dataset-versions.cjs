/* eslint-disable camelcase */
exports.shorthands = undefined;

const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

exports.up = (pgm) => {
  pgm.createType({ schema: 'app', name: 'dataset_version_kind' }, ['ingest', 'edit']);

  pgm.createTable(
    { schema: 'app', name: 'dataset_versions' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      layer_key: { type: 'text', notNull: true },
      kind: { type: 'app.dataset_version_kind', notNull: true },
      parent_version_id: {
        type: 'uuid',
        references: { schema: 'app', name: 'dataset_versions' },
        onDelete: 'CASCADE',
      },
      source: { type: 'text', notNull: true },
      source_version: { type: 'text' },
      label: { type: 'text', notNull: true },
      ingested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      ingested_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
      feature_count: { type: 'integer' },
      is_active: { type: 'boolean', notNull: true, default: false },
      notes: { type: 'text' },
    }
  );

  // Every version query filters by layer_key.
  pgm.createIndex({ schema: 'app', name: 'dataset_versions' }, 'layer_key');

  // "The current map" is always unambiguous: one active version per layer.
  pgm.createIndex({ schema: 'app', name: 'dataset_versions' }, 'layer_key', {
    name: 'dataset_versions_active_per_layer',
    unique: true,
    where: 'is_active',
  });

  // ingest ⇒ null parent; edit ⇒ non-null parent.
  pgm.addConstraint({ schema: 'app', name: 'dataset_versions' }, 'dataset_versions_kind_parent', {
    check: `(kind = 'ingest' AND parent_version_id IS NULL) OR (kind = 'edit' AND parent_version_id IS NOT NULL)`,
  });

  for (const name of THEMATIC) {
    const tbl = { schema: 'water', name };

    // Nullable first so we can backfill, then set NOT NULL.
    pgm.addColumn(tbl, {
      dataset_version_id: { type: 'uuid', references: { schema: 'app', name: 'dataset_versions' } },
      deleted: { type: 'boolean', notNull: true, default: false },
    });

    // One "version 1" ingest version per layer, active, holding all current rows.
    // A DO block keeps the whole backfill in one server-side statement.
    pgm.sql(`
      DO $$
      DECLARE
        v_id uuid;
        v_count integer;
      BEGIN
        SELECT count(*) INTO v_count FROM water.${name};
        INSERT INTO app.dataset_versions (layer_key, kind, source, label, feature_count, is_active)
        VALUES ('${name}', 'ingest', 'seed:${name}', 'version 1', v_count, true)
        RETURNING id INTO v_id;
        UPDATE water.${name} SET dataset_version_id = v_id;
      END $$;
    `);

    pgm.alterColumn(tbl, 'dataset_version_id', { notNull: true });
    pgm.createIndex(tbl, 'dataset_version_id');

    // external_id uniqueness moves from global to per-version.
    pgm.dropIndex(tbl, 'external_id', { name: `${name}_external_id_unique_index`, ifExists: true });
    pgm.createIndex(tbl, ['dataset_version_id', 'external_id'], { unique: true });
  }
};

exports.down = (pgm) => {
  for (const name of THEMATIC) {
    const tbl = { schema: 'water', name };
    pgm.dropIndex(tbl, ['dataset_version_id', 'external_id'], { ifExists: true });
    pgm.dropColumn(tbl, ['dataset_version_id', 'deleted']);
    pgm.createIndex(tbl, 'external_id', { unique: true });
  }

  pgm.dropTable({ schema: 'app', name: 'dataset_versions' });
  pgm.dropType({ schema: 'app', name: 'dataset_version_kind' });
};
