/* eslint-disable camelcase */
exports.shorthands = undefined;

const ROLE = 'webatlas_assistant';
const PASSWORD = process.env.ASSISTANT_DB_PASSWORD || 'change_me_dev';

const LAYERS = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

exports.up = (pgm) => {
  // CREATE ROLE is not transactional-safe to repeat; guard it so re-running
  // migrations on an existing database does not fail.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}';
      END IF;
    END
    $$;
  `);

  // The database name is not known at authoring time (POSTGRES_DB is
  // configurable), so build the GRANT with the current database's own name.
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${ROLE}', current_database());
    END
    $$;
  `);

  // PostGIS functions live in public; without USAGE every ST_* call fails.
  pgm.sql(`GRANT USAGE ON SCHEMA public TO ${ROLE};`);
  pgm.sql(`GRANT USAGE ON SCHEMA water TO ${ROLE};`);

  // SELECT on the *_active VIEWS ONLY — never the base tables.
  //
  // This is the load-bearing choice. A view executes with its owner's
  // privileges (security_invoker is off by default), so the *_active views
  // resolve the dataset-version chain through app.dataset_versions on the
  // owner's behalf, while this role still holds nothing on the app schema.
  // Granting the base tables instead would expose deleted tombstones and every
  // superseded version, and would still not resolve "current".
  for (const layer of LAYERS) {
    pgm.sql(`GRANT SELECT ON water.${layer}_active TO ${ROLE};`);
  }

  // Belt and braces: the role was never granted anything on app, but say so
  // explicitly so the intent survives a future "GRANT ... ON ALL TABLES" written
  // without reading this file. app.users holds argon2 password hashes.
  pgm.sql(`REVOKE ALL ON SCHEMA app FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA water FROM ${ROLE};`);
  // The REVOKE above also strips the view grants, so re-apply them last.
  for (const layer of LAYERS) {
    pgm.sql(`GRANT SELECT ON water.${layer}_active TO ${ROLE};`);
  }
};

exports.down = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`REVOKE ALL ON water.${layer}_active FROM ${ROLE};`);
  }
  pgm.sql(`REVOKE ALL ON SCHEMA water FROM ${ROLE};`);
  pgm.sql(`REVOKE ALL ON SCHEMA public FROM ${ROLE};`);
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM ${ROLE}', current_database());
    END
    $$;
  `);
  pgm.sql(`DROP ROLE IF EXISTS ${ROLE};`);
};
