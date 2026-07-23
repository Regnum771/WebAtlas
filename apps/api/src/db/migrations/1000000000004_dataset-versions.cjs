/* eslint-disable camelcase */
exports.shorthands = undefined;

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
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'app', name: 'dataset_versions' });
  pgm.dropType({ schema: 'app', name: 'dataset_version_kind' });
};
