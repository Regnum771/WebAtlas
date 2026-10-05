/* eslint-disable camelcase */
exports.shorthands = undefined;

// The union of the working-region provinces, stored. Every ROI that is not an admin unit is
// clipped to it, and recomputing the union cost ~180 ms per request.
//
// The code list below mirrors REGION_PROVINCE_CODES in packages/shared; the test in
// apps/api/src/db/workingRegion.test.ts keeps the two equal.
//
// Refreshed by packages/atlas-data (loadReplacing) whenever admin.provinces is replaced. On an
// empty admin.provinces (CI runs migrate before the seed) the union is a single row with a
// NULL geometry, so a reader gets a NULL region rather than a missing one.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE MATERIALIZED VIEW admin.working_region AS
      SELECT ST_Union(geom) AS g FROM admin.provinces
       WHERE code = ANY(ARRAY['48','51','52','56','66','68'])
  `);
  // A new relation starts with no privileges (migrations 16-20 each hit this).
  pgm.sql(`GRANT SELECT ON admin.working_region TO webatlas_assistant`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS admin.working_region`);
};
