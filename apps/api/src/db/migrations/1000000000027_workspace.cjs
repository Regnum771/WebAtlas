/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Personal maps (P3a of docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md):
 * the `workspace` schema, kept apart from `app` and `water` because it holds users' private
 * working content.
 *
 * - maps: one per personal map. revision is bumped on every change to the map's content, so a
 *   stale client is refused (MAP_CHANGED). last_activity_at / inactivity_notice_at / archived_at
 *   serve the inactivity policy.
 * - map_layers: kind 'free' (drawn here), 'edit_copy' (a copy of a thematic layer, edited through
 *   a draft in app.dataset_versions), 'raster' and 'annotation' (reserved for P3b and P11).
 *   draft_id goes NULL when the draft is discarded, so the layer row outlives it.
 * - features: the geometry of free layers, in EPSG:4326. source_row / source_crs are filled by
 *   P3b imports.
 * - map_shares: a map shared with exactly one user or one access group.
 *
 * No grant to webatlas_assistant: personal maps are private.
 */
const ROLE = 'webatlas_assistant';
const S = 'workspace';

exports.up = (pgm) => {
  pgm.createSchema(S);

  pgm.createTable({ schema: S, name: 'maps' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: { type: 'uuid', notNull: true, references: { schema: 'app', name: 'users' }, onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true, check: 'length(title) BETWEEN 1 AND 200' },
    description: { type: 'text', notNull: true, default: '' },
    revision: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_activity_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    inactivity_notice_at: { type: 'timestamptz' },
    archived_at: { type: 'timestamptz' },
  });
  pgm.createIndex({ schema: S, name: 'maps' }, 'owner_id', {
    name: 'maps_owner_idx',
    where: 'archived_at IS NULL',
  });

  pgm.createTable({ schema: S, name: 'map_layers' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    map_id: { type: 'uuid', notNull: true, references: { schema: S, name: 'maps' }, onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: `kind IN ('free', 'edit_copy', 'raster', 'annotation')` },
    title: { type: 'text', notNull: true, check: 'length(title) BETWEEN 1 AND 200' },
    position: { type: 'integer', notNull: true },
    style: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    geometry_type: { type: 'text', check: `geometry_type IN ('point', 'line', 'polygon')` },
    fields: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
    layer_key: { type: 'text' },
    draft_id: { type: 'uuid', references: { schema: 'app', name: 'dataset_versions' }, onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, {
    constraints: { check: `kind <> 'edit_copy' OR layer_key IS NOT NULL` },
  });
  // Deferred so layers can be reordered by swapping positions inside one transaction.
  pgm.sql(`ALTER TABLE ${S}.map_layers ADD CONSTRAINT map_layers_map_position_key
    UNIQUE (map_id, position) DEFERRABLE INITIALLY DEFERRED;`);
  pgm.createIndex({ schema: S, name: 'map_layers' }, 'draft_id', { name: 'map_layers_draft_idx' });

  pgm.createTable({ schema: S, name: 'features' }, {
    id: { type: 'bigint', primaryKey: true, sequenceGenerated: { precedence: 'ALWAYS' } },
    layer_id: { type: 'uuid', notNull: true, references: { schema: S, name: 'map_layers' }, onDelete: 'CASCADE' },
    geom: { type: 'geometry(Geometry,4326)', notNull: true },
    properties: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    source_row: { type: 'integer' },
    source_crs: { type: 'text' },
  });
  pgm.createIndex({ schema: S, name: 'features' }, 'geom', { name: 'features_geom_idx', method: 'gist' });
  pgm.createIndex({ schema: S, name: 'features' }, 'layer_id', { name: 'features_layer_idx' });

  pgm.createTable({ schema: S, name: 'map_shares' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    map_id: { type: 'uuid', notNull: true, references: { schema: S, name: 'maps' }, onDelete: 'CASCADE' },
    user_id: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'CASCADE' },
    group_id: { type: 'uuid', references: { schema: 'app', name: 'access_groups' }, onDelete: 'CASCADE' },
    created_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, {
    constraints: { check: 'num_nonnulls(user_id, group_id) = 1' },
  });
  pgm.createIndex({ schema: S, name: 'map_shares' }, ['map_id', 'user_id'], {
    name: 'map_shares_user_uniq', unique: true, where: 'user_id IS NOT NULL',
  });
  pgm.createIndex({ schema: S, name: 'map_shares' }, ['map_id', 'group_id'], {
    name: 'map_shares_group_uniq', unique: true, where: 'group_id IS NOT NULL',
  });

  // Say explicitly that the assistant role has nothing here, so a future broad GRANT
  // written without reading this file is still visibly at odds with the intent.
  pgm.sql(`REVOKE ALL ON SCHEMA ${S} FROM PUBLIC, ${ROLE};`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM PUBLIC, ${ROLE};`);
};

exports.down = (pgm) => {
  pgm.dropSchema(S, { cascade: true });
};
