/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * The data dictionary tables and the dictionary.manage permission (Plan A, Task 5).
 *
 * - dictionary_feature_types / _attributes / _values: the dictionary's content. This migration
 *   only creates them; the sync from packages/shared populates them.
 * - origin: maps an edited field name to {"by": uuid, "at": iso}; an absent key means the
 *   code default is in force.
 * - dictionary_history: one row per changed field. Not granted to the assistant.
 * - The permission CHECK on app.access_group_permissions gains dictionary.manage.
 */
const PERMISSIONS = [
  'feature.create', 'feature.update', 'feature.delete',
  'map.import', 'submission.review', 'users.manage',
];
const list = (xs) => xs.map((p) => `'${p}'`).join(', ');
const CHECK = 'access_group_permissions_permission_check';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.dictionary_feature_types (
      key text PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('vector', 'raster')),
      name text NOT NULL,
      definition text NOT NULL,
      table_name text,
      crs int NOT NULL,
      geometry_type text,
      geometry_meaning text NOT NULL CHECK (geometry_meaning IN ('exact', 'approximate', 'representativePoint')),
      valid_from date NOT NULL,
      valid_to date,
      origin jsonb NOT NULL DEFAULT '{}',
      revision int NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL
    )
  `);
  pgm.sql(`
    CREATE TABLE app.dictionary_attributes (
      feature_type text NOT NULL REFERENCES app.dictionary_feature_types(key) ON DELETE RESTRICT,
      name text NOT NULL,
      ord int NOT NULL,
      source text NOT NULL CHECK (source IN ('column', 'extra', 'band')),
      value_type text NOT NULL CHECK (value_type IN ('text', 'number', 'date', 'code')),
      label text NOT NULL,
      definition text NOT NULL,
      stored_unit text,
      display_units text[] NOT NULL DEFAULT '{}',
      display_unit text,
      precision smallint CHECK (precision BETWEEN 0 AND 6),
      cf_standard_name text,
      code_list text CHECK (code_list IN ('closed', 'open')),
      nodata float8,
      scale float8,
      value_offset float8,
      valid_from date NOT NULL,
      valid_to date,
      origin jsonb NOT NULL DEFAULT '{}',
      revision int NOT NULL DEFAULT 0,
      PRIMARY KEY (feature_type, name)
    )
  `);
  pgm.sql(`
    CREATE TABLE app.dictionary_values (
      feature_type text NOT NULL,
      attribute text NOT NULL,
      code text NOT NULL,
      name text NOT NULL,
      definition text,
      ord int NOT NULL,
      retired boolean NOT NULL DEFAULT false,
      color_hint text,
      origin jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY (feature_type, attribute, code),
      FOREIGN KEY (feature_type, attribute) REFERENCES app.dictionary_attributes(feature_type, name) ON DELETE RESTRICT
    )
  `);
  pgm.sql(`
    CREATE TABLE app.dictionary_history (
      id bigserial PRIMARY KEY,
      feature_type text NOT NULL,
      attribute text,
      code text,
      field text NOT NULL,
      old_value jsonb,
      new_value jsonb,
      reason text NOT NULL CHECK (reason IN ('edit', 'restore', 'sync_revert', 'sync_retire')),
      changed_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
      changed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // A new relation starts with no privileges. History stays out of the assistant's reach.
  pgm.sql(`GRANT SELECT ON app.dictionary_feature_types, app.dictionary_attributes, app.dictionary_values TO webatlas_assistant`);

  pgm.sql(`ALTER TABLE app.access_group_permissions DROP CONSTRAINT ${CHECK}`);
  pgm.sql(`ALTER TABLE app.access_group_permissions ADD CONSTRAINT ${CHECK}
           CHECK (permission IN (${list([...PERMISSIONS, 'dictionary.manage'])}))`);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM app.access_group_permissions WHERE permission = 'dictionary.manage'`);
  pgm.sql(`ALTER TABLE app.access_group_permissions DROP CONSTRAINT ${CHECK}`);
  pgm.sql(`ALTER TABLE app.access_group_permissions ADD CONSTRAINT ${CHECK}
           CHECK (permission IN (${list(PERMISSIONS)}))`);
  pgm.sql(`DROP TABLE app.dictionary_history, app.dictionary_values, app.dictionary_attributes, app.dictionary_feature_types`);
};
