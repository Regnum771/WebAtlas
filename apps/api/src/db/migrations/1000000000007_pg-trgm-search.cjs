/* eslint-disable camelcase */
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql(`CREATE INDEX IF NOT EXISTS dams_name_trgm ON water.dams USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS lakes_name_trgm ON water.lakes USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS rivers_name_trgm ON water.rivers USING gin (name gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS stations_name_trgm ON water.stations USING gin (name gin_trgm_ops)`);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS water.dams_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.lakes_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.rivers_name_trgm');
  pgm.sql('DROP INDEX IF EXISTS water.stations_name_trgm');
  // pg_trgm is left installed: other objects may depend on it.
};
