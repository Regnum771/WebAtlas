/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Permissions by administrative level (P1 of
 * docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md).
 *
 * - admin.unit_tree: the three-level unit tree (VN -> province -> ward) the API loads to
 *   resolve "this unit and everything below it". Levels match UnitNode['level'] in
 *   packages/shared/src/access.ts.
 * - admin.managing_unit_for(): the initial-assignment rule, the smallest unit containing the
 *   feature: province count <> 1 -> VN; exactly one province and one ward -> that ward;
 *   otherwise that province. admin.wards covers only the working region, hence the rule.
 * - water.<layer>.managing_unit: stored per row and versioned with it. It is never
 *   recomputed from geometry once set; ingest rows get it at activation, which is why the
 *   column is nullable.
 * - app.access_groups and friends: permission grants are held by groups, never by users.
 * - The editor role is retired: its users become viewers and the value is refused. The enum
 *   value stays, because Postgres cannot drop one cleanly.
 *
 * The backfill writes data, an exception to "migrations create tables, the pipeline
 * populates", as in migration 22: without it every current row would lack a unit until the
 * layer's next activation.
 */
const LAYERS = [
  'dams', 'stations', 'flood_zones', 'drought_points',
  'saltwater_intrusion', 'flood_generation', 'lakes', 'rivers',
];
const LAYER_ARRAY = `ARRAY[${LAYERS.map((l) => `'${l}'`).join(', ')}]`;

const UNIT_CODE_RE = '^(VN|[0-9]{2}|[0-9]{5})$';

const PERMISSIONS = [
  'feature.create', 'feature.update', 'feature.delete',
  'map.import', 'submission.review', 'users.manage',
];

// The two views over rivers_active, as migration 20 created them. Needed by `down`, which has
// to drop rivers_active to remove a column from it.
const RIVERS_DETAIL = `
  CREATE VIEW water.rivers_detail AS
    SELECT * FROM water.rivers_active WHERE feature_level = 3
`;
const RIVERS_OVERVIEW = `
  CREATE VIEW water.rivers_overview AS
    SELECT COALESCE(name, '') AS name_key, name, stream_order,
           ST_SimplifyPreserveTopology(geom, 0.01) AS geom
      FROM water.rivers_active
     WHERE feature_level = 1
       AND external_id IN (SELECT parent_external_id FROM water.rivers_active
                            WHERE feature_level = 3 AND stream_order = 5)
`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION admin.managing_unit_for(province_codes text[], ward_codes text[])
    RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
      SELECT CASE
               WHEN coalesce(cardinality(province_codes), 0) <> 1 THEN 'VN'
               WHEN coalesce(cardinality(ward_codes), 0) = 1 THEN ward_codes[1]
               ELSE province_codes[1]
             END
    $$
  `);

  pgm.sql(`
    CREATE VIEW admin.unit_tree AS
      SELECT 'VN'::text AS code, 'country'::text AS level, NULL::text AS parent, 'Toàn quốc'::text AS name
      UNION ALL
      SELECT code, 'province'::text, 'VN'::text, name FROM admin.provinces
      UNION ALL
      SELECT code, 'ward'::text, province_code, name FROM admin.wards
  `);
  // A new relation starts with no privileges (migrations 16-20 and 24 each hit this).
  pgm.sql(`GRANT SELECT ON admin.unit_tree TO webatlas_assistant`);

  // Per layer, in this order: the column with its check; the set-based backfill over every
  // row, history included; the partial index; then the view replaced with the column
  // appended (CREATE OR REPLACE may only append, and keeps the grants). The column list is
  // read from the view, as in migration 22, so names and order stay exactly as they were.
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active';
        EXECUTE format(
          'ALTER TABLE water.%I ADD COLUMN managing_unit text CONSTRAINT %I CHECK (managing_unit IS NULL OR managing_unit ~ %L)',
          l, l || '_managing_unit_check', '${UNIT_CODE_RE}');
        EXECUTE format('UPDATE water.%I SET managing_unit = admin.managing_unit_for(province_codes, ward_codes)', l);
        EXECUTE format('CREATE INDEX %I ON water.%I (managing_unit) WHERE is_current', l || '_current_managing_unit_idx', l);
        EXECUTE format('CREATE OR REPLACE VIEW water.%I AS SELECT %s, managing_unit FROM water.%I WHERE is_current',
          l || '_active', cols, l);
        EXECUTE format('ANALYZE water.%I', l);
      END LOOP;
    END $$;
  `);
  // rivers_detail's SELECT * was expanded when it was created; replacing it picks up the
  // appended column. rivers_overview names its columns and needs nothing.
  pgm.sql(`CREATE OR REPLACE VIEW water.rivers_detail AS SELECT * FROM water.rivers_active WHERE feature_level = 3`);

  pgm.sql(`UPDATE app.users SET role = 'viewer' WHERE role = 'editor'`);
  pgm.sql(`ALTER TABLE app.users ADD CONSTRAINT users_role_not_editor CHECK (role <> 'editor')`);

  // Not granted to webatlas_assistant: who may do what stays out of the assistant's reach,
  // like app.users.
  pgm.sql(`
    CREATE TABLE app.access_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      description text,
      created_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    CREATE TABLE app.access_group_units (
      group_id uuid NOT NULL REFERENCES app.access_groups(id) ON DELETE CASCADE,
      unit_code text NOT NULL,
      PRIMARY KEY (group_id, unit_code)
    )
  `);
  pgm.sql(`
    CREATE TABLE app.access_group_permissions (
      group_id uuid NOT NULL REFERENCES app.access_groups(id) ON DELETE CASCADE,
      permission text NOT NULL CHECK (permission IN (${PERMISSIONS.map((p) => `'${p}'`).join(', ')})),
      PRIMARY KEY (group_id, permission)
    )
  `);
  pgm.sql(`
    CREATE TABLE app.user_groups (
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      group_id uuid NOT NULL REFERENCES app.access_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS app.user_groups, app.access_group_permissions, app.access_group_units, app.access_groups`);
  // Users moved from editor to viewer stay viewers: which of them were editors is not kept.
  pgm.sql(`ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_not_editor`);

  // CREATE OR REPLACE cannot remove a column, so each view is dropped and re-created with an
  // explicit column list without managing_unit, and its grant re-applied (a drop loses it).
  // No CASCADE: a dependent view this migration does not know about must stop the rollback
  // rather than vanish. The two known ones over rivers_active go first and come back last.
  pgm.sql(`DROP VIEW water.rivers_overview, water.rivers_detail`);
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active' AND column_name <> 'managing_unit';
        EXECUTE format('DROP VIEW water.%I', l || '_active');
        EXECUTE format('CREATE VIEW water.%I AS SELECT %s FROM water.%I WHERE is_current', l || '_active', cols, l);
        EXECUTE format('GRANT SELECT ON water.%I TO webatlas_assistant', l || '_active');
        EXECUTE format('DROP INDEX IF EXISTS water.%I', l || '_current_managing_unit_idx');
        EXECUTE format('ALTER TABLE water.%I DROP COLUMN managing_unit', l);
      END LOOP;
    END $$;
  `);
  pgm.sql(RIVERS_DETAIL);
  pgm.sql(RIVERS_OVERVIEW);
  pgm.sql(`GRANT SELECT ON water.rivers_detail, water.rivers_overview TO webatlas_assistant`);

  pgm.sql(`DROP VIEW IF EXISTS admin.unit_tree`);
  pgm.sql(`DROP FUNCTION IF EXISTS admin.managing_unit_for(text[], text[])`);
};
